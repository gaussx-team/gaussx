package team.gaussx.beacon

import android.annotation.SuppressLint
import android.app.Service
import android.bluetooth.BluetoothManager
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.util.Locale
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/**
 * 수신기 (구역에 두는 폰): 같은 UUID 의 iBeacon 을 계속 스캔하고, 1초마다 들은 RSSI 를 그대로 백엔드에 보낸다.
 *   POST {서버}/api/gateway  { gatewayId, readings: [{ beaconId, rssi: [...], txPower }] }
 * 안 · 밖 판정(중앙값 · 문턱 · 유지 시간)은 백엔드가 한다 — 여기서는 거르지 않는다.
 * 들린 게 없어도 보낸다 (수신기가 살아 있다는 신호). 보내지 못한 보고는 쌓아 두지 않는다.
 */
class ReceiverService : Service() {
    private val lock = Any()
    private var heard = HashMap<String, MutableList<Int>>()
    private val txPower = HashMap<String, Int>()

    private var scanner: BluetoothLeScanner? = null
    @Volatile private var scanning = false
    @Volatile private var stopped = false
    private var scanStartedAt = 0L
    private var lastScanTry = 0L
    private var lastHeardAt = 0L
    private var loop: ScheduledExecutorService? = null
    private var wakeLock: PowerManager.WakeLock? = null

    private lateinit var uuid: UUID
    private lateinit var url: String
    private lateinit var gatewayId: String

    private val callback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) = take(result)

        override fun onBatchScanResults(results: MutableList<ScanResult>) {
            results.forEach { take(it) }
        }

        override fun onScanFailed(errorCode: Int) {
            if (errorCode == SCAN_FAILED_ALREADY_STARTED) return
            scanning = false
            Status.error = "스캔을 시작하지 못했어요 — " + when (errorCode) {
                SCAN_FAILED_APPLICATION_REGISTRATION_FAILED -> "블루투스 등록 실패. 블루투스를 껐다 켜 보세요"
                SCAN_FAILED_FEATURE_UNSUPPORTED -> "이 폰은 BLE 스캔을 지원하지 않아요"
                SCAN_FAILED_OUT_OF_HARDWARE_RESOURCES -> "블루투스 자원이 모자라요. 다른 블루투스 앱을 꺼 보세요"
                SCAN_FAILED_SCANNING_TOO_FREQUENTLY -> "너무 자주 시작했어요"
                else -> "내부 오류($errorCode)"
            } + " (10초 뒤 다시 시도해요)"
        }
    }

    private fun take(r: ScanResult) {
        val b = IBeacon.parse(r.scanRecord?.getManufacturerSpecificData(IBeacon.COMPANY_ID)) ?: return
        if (b.uuid != uuid) return
        synchronized(lock) {
            heard.getOrPut(b.id) { ArrayList() }.add(r.rssi)
            txPower[b.id] = b.txPower
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    @SuppressLint("WakelockTimeout")
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (loop != null) return START_STICKY // 이미 돌고 있다
        val s = Settings(this)
        uuid = IBeacon.parseUuid(s.uuid) ?: return fail("UUID 형식이 잘못됐어요: ${s.uuid}")
        url = s.server.trimEnd('/') + "/api/gateway"
        gatewayId = s.gatewayId
        try {
            Foreground.start(
                this, ID, "수신기 동작 중 · $gatewayId", s.server,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
            )
        } catch (e: Exception) {
            return fail("백그라운드 동작을 시작하지 못했어요: ${e.message}")
        }
        Status.started(Role.RECEIVER, "스캔 시작 중…")
        RadarState.clear()
        stopped = false
        // 화면이 꺼져도 1초 보고가 늦지 않게 (수신기는 충전기에 꽂아 두는 폰)
        wakeLock = getSystemService(PowerManager::class.java)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "gaussx:receiver")
            .apply { acquire() }
        startScan()
        // 고정 간격(fixed rate)은 프로세스가 잠들었다 깨면 밀린 실행을 몰아서 하므로 '끝나고 1초 뒤'로
        loop = Executors.newSingleThreadScheduledExecutor().also {
            it.scheduleWithFixedDelay({ tick() }, 1, 1, TimeUnit.SECONDS)
        }
        return START_STICKY
    }

    @SuppressLint("MissingPermission")
    private fun startScan() {
        lastScanTry = SystemClock.elapsedRealtime()
        val adapter = getSystemService(BluetoothManager::class.java)?.adapter
        if (adapter == null || !adapter.isEnabled) {
            Status.error = "블루투스가 꺼져 있어요. 켜면 스캔해요"
            return
        }
        val sc = adapter.bluetoothLeScanner
        if (sc == null) {
            Status.error = "BLE 스캐너를 열 수 없어요 (10초 뒤 다시 시도해요)"
            return
        }
        // 필터가 있어야 화면이 꺼져도 스캔이 계속된다
        val (data, mask) = IBeacon.filter(uuid)
        val filter = ScanFilter.Builder().setManufacturerData(IBeacon.COMPANY_ID, data, mask).build()
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
            .setMatchMode(ScanSettings.MATCH_MODE_AGGRESSIVE)
            .setNumOfMatches(ScanSettings.MATCH_NUM_MAX_ADVERTISEMENT)
            .setReportDelay(0)
            .build()
        try {
            sc.startScan(listOf(filter), settings, callback)
            scanner = sc
            scanning = true
            scanStartedAt = SystemClock.elapsedRealtime()
            Status.error = null
        } catch (e: Exception) {
            Status.error = "스캔을 시작하지 못했어요: ${e.message} (10초 뒤 다시 시도해요)"
        }
    }

    @SuppressLint("MissingPermission")
    private fun stopScan() {
        try {
            scanner?.stopScan(callback)
        } catch (_: Exception) {
            // 블루투스가 이미 꺼졌으면 멈출 것도 없다
        }
        scanner = null
        scanning = false
    }

    /** 블루투스를 껐다 켜면 다시 · 30분 넘게 스캔하면 안드로이드가 약한 스캔으로 바꾸므로 20분마다 다시 시작 */
    private fun keepScanning() {
        val now = SystemClock.elapsedRealtime()
        val on = getSystemService(BluetoothManager::class.java)?.adapter?.isEnabled == true
        when {
            !on -> {
                if (scanning) stopScan()
                Status.error = "블루투스가 꺼졌어요. 켜면 다시 스캔해요"
            }
            !scanning && now - lastScanTry > 10_000 -> startScan()
            scanning && now - scanStartedAt > RESTART_MS -> {
                stopScan()
                startScan()
            }
        }
    }

    private fun tick() {
        if (stopped) return
        try {
            keepScanning()
            val batch: Map<String, List<Int>>
            val tx: Map<String, Int>
            synchronized(lock) {
                batch = heard
                heard = HashMap()
                tx = HashMap(txPower)
            }
            val now = SystemClock.elapsedRealtime()
            if (batch.isNotEmpty()) lastHeardAt = now

            val readings = JSONArray()
            for ((id, rssi) in batch) {
                readings.put(JSONObject().put("beaconId", id).put("rssi", JSONArray(rssi)).put("txPower", tx[id]))
            }
            val reply = Http.post(url, JSONObject().put("gatewayId", gatewayId).put("readings", readings))
            if (stopped) return
            Status.headline = if (reply.ok) "보고 중 · $gatewayId" else "보고 실패 · $gatewayId"
            Status.detail = render(batch, reply, now)
        } catch (e: Exception) {
            // 예외가 나면 반복이 멈추므로 여기서 잡고 다음 1초에 다시
            Status.error = "내부 오류: ${e.message}"
        }
    }

    /** 수신기 화면: 백엔드 응답 · 지난 1초에 들린 비콘 · 백엔드 판정 */
    private fun render(batch: Map<String, List<Int>>, reply: Http.Reply, now: Long): String {
        val judged = HashMap<String, JSONObject>()
        val head = when {
            reply.error != null ->
                "✕ 백엔드에 보내지 못했어요: ${reply.error}\n  $url\n  같은 와이파이인지 · 백엔드가 켜져 있는지 · 노트북 방화벽이 ${port()} 포트를 막는지 확인"
            !reply.ok ->
                "✕ 백엔드가 거절했어요 (${reply.code}): ${Http.message(reply.body)}" +
                    if (reply.code == 404) "\n  주소가 백엔드(포트 3001)인지 확인" else ""
            else -> try {
                val json = JSONObject(reply.body ?: "{}")
                val devices = json.optJSONArray("devices") ?: JSONArray()
                for (i in 0 until devices.length()) devices.optJSONObject(i)?.let { judged[it.optString("beaconId")] = it }
                RadarState.update(json.optJSONObject("radar")) // 이 수신기 기준 레이더 (백엔드가 계산)
                "✓ ${Status.clock()} 보고 · $gatewayId = ${json.optString("zoneId", "?")} 구역"
            } catch (_: Exception) {
                "✕ 응답을 읽지 못했어요. 주소가 백엔드(포트 3001)인지 확인"
            }
        }
        val sb = StringBuilder(head).append("\n\n")
        if (batch.isEmpty()) {
            sb.append(
                if (lastHeardAt == 0L || now - lastHeardAt > 5_000) {
                    "들리는 비콘이 없어요\n· 비콘 폰에서 '시작'을 눌렀는지\n· 두 폰의 UUID 가 같은지\n· 이 폰의 위치(GPS)가 켜져 있는지"
                } else {
                    "이번 1초에는 들린 비콘 없음"
                },
            )
        } else {
            sb.append("지난 1초에 들린 비콘 (major:minor · 중앙값 · 횟수)\n")
            for ((id, rssi) in batch.entries.sortedBy { it.key }) {
                sb.append(String.format(Locale.ROOT, "%-7s %4d dBm · %2d회", id.substringAfter(':'), median(rssi), rssi.size))
                val d = judged[id]
                when {
                    d != null -> sb.append("\n        → ").append(presence(d))
                    reply.ok -> sb.append("\n        → 백엔드에 등록 안 된 비콘 (demo.json devices[].beacon_id)")
                }
                sb.append('\n')
            }
        }
        return sb.toString()
    }

    private fun presence(d: JSONObject): String {
        val label = d.optString("label", d.optString("deviceId"))
        val state = when (d.optString("state")) {
            "in" -> "안 (${d.optString("zoneId")})"
            "out" -> "밖"
            else -> "알 수 없음"
        }
        val p = d.optJSONObject("pending") ?: return "$label · $state"
        val kind = when (p.optString("kind")) {
            "enter" -> "들어오는 중"
            "exit" -> "나가는 중"
            else -> "구역 바뀌는 중"
        }
        return "$label · $state · $kind ${p.optDouble("forS")}초"
    }

    /** 설정한 백엔드 주소의 포트 (안 적었으면 http 기본 80 · https 443) */
    private fun port(): Int = try {
        val u = URI(url)
        if (u.port > 0) u.port else if (u.scheme == "https") 443 else 80
    } catch (_: Exception) {
        3001
    }

    private fun median(v: List<Int>): Int {
        val s = v.sorted()
        return if (s.size % 2 == 1) s[s.size / 2] else (s[s.size / 2 - 1] + s[s.size / 2]) / 2
    }

    private fun fail(message: String): Int {
        Status.error = message
        stopSelf()
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        stopped = true
        loop?.shutdownNow()
        loop = null
        stopScan()
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
        Status.stopped()
        RadarState.clear()
        super.onDestroy()
    }

    companion object {
        const val ID = 2
        private const val RESTART_MS = 20 * 60_000L
    }
}
