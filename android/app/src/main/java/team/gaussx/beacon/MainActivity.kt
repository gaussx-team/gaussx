package team.gaussx.beacon

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseSettings
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS
import android.provider.Settings.ACTION_LOCATION_SOURCE_SETTINGS
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.view.View
import android.view.WindowManager
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.RadioGroup
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import org.json.JSONObject
import kotlin.math.roundToInt

/** 역할 고르기 · 설정 · 시작/멈추기 · 상태 · 레이더. 실제 일은 서비스가 한다 (화면을 꺼도 계속) */
class MainActivity : Activity() {
    private lateinit var settings: Settings
    private lateinit var intro: View
    private lateinit var form: View
    private lateinit var radarBox: View
    private lateinit var radar: RadarView
    private lateinit var radarInfo: TextView
    private lateinit var calibrate: Button
    private var resumed = false
    private lateinit var role: RadioGroup
    private lateinit var uuid: EditText
    private lateinit var major: EditText
    private lateinit var minor: EditText
    private lateinit var txLevel: Spinner
    private lateinit var server: EditText
    private lateinit var gateway: EditText
    private lateinit var beaconBox: View
    private lateinit var receiverBox: View
    private lateinit var toggle: Button
    private lateinit var headline: TextView
    private lateinit var detail: TextView
    private var screenKept = false

    private val ui = Handler(Looper.getMainLooper())
    private val refresh = object : Runnable {
        override fun run() {
            render()
            ui.postDelayed(this, 500)
        }
    }

    /** 광고 세기 (스피너 순서) */
    private val levels = listOf(
        AdvertiseSettings.ADVERTISE_TX_POWER_HIGH,
        AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM,
        AdvertiseSettings.ADVERTISE_TX_POWER_LOW,
        AdvertiseSettings.ADVERTISE_TX_POWER_ULTRA_LOW,
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        settings = Settings(this)
        role = findViewById(R.id.role)
        uuid = findViewById(R.id.uuid)
        major = findViewById(R.id.major)
        minor = findViewById(R.id.minor)
        txLevel = findViewById(R.id.txLevel)
        server = findViewById(R.id.server)
        gateway = findViewById(R.id.gateway)
        beaconBox = findViewById(R.id.beaconBox)
        receiverBox = findViewById(R.id.receiverBox)
        toggle = findViewById(R.id.toggle)
        headline = findViewById(R.id.headline)
        detail = findViewById(R.id.detail)
        intro = findViewById(R.id.intro)
        form = findViewById(R.id.form)
        radarBox = findViewById(R.id.radarBox)
        radar = findViewById(R.id.radar)
        radarInfo = findViewById(R.id.radarInfo)
        calibrate = findViewById(R.id.calibrate)

        txLevel.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, levels.map { AdvertiserService.levelName(it) })
        load()
        role.setOnCheckedChangeListener { _, _ -> showRoleFields() }
        toggle.setOnClickListener { if (Status.running != null) stop() else start() }
        calibrate.setOnClickListener { calibrate(reset = false) }
        calibrate.setOnLongClickListener {
            calibrate(reset = true)
            true
        }
    }

    override fun onResume() {
        super.onResume()
        resumed = true
        ui.post(refresh)
    }

    override fun onPause() {
        resumed = false
        radar.running = false
        ui.removeCallbacks(refresh)
        super.onPause()
    }

    private fun load() {
        role.check(if (settings.role == Role.RECEIVER) R.id.roleReceiver else R.id.roleBeacon)
        uuid.setText(settings.uuid)
        major.setText(settings.major.toString())
        minor.setText(settings.minor.toString())
        txLevel.setSelection(levels.indexOf(settings.txLevel).coerceAtLeast(0))
        server.setText(settings.server)
        gateway.setText(settings.gatewayId)
        showRoleFields()
    }

    private fun selectedRole() = if (role.checkedRadioButtonId == R.id.roleReceiver) Role.RECEIVER else Role.BEACON

    private fun showRoleFields() {
        val r = selectedRole()
        beaconBox.visibility = if (r == Role.BEACON) View.VISIBLE else View.GONE
        receiverBox.visibility = if (r == Role.RECEIVER) View.VISIBLE else View.GONE
    }

    /** 입력 확인 → 저장. 잘못된 칸에 안내를 띄운다 */
    private fun save(): Boolean {
        val r = selectedRole()
        val u = IBeacon.parseUuid(uuid.text.toString()) ?: return invalid(uuid, "UUID 형식이 아니에요 (예: ${Settings.DEFAULT_UUID})")
        if (r == Role.BEACON) {
            val ma = major.text.toString().trim().toIntOrNull()?.takeIf { it in 0..0xFFFF } ?: return invalid(major, "0~65535")
            val mi = minor.text.toString().trim().toIntOrNull()?.takeIf { it in 0..0xFFFF } ?: return invalid(minor, "0~65535")
            settings.major = ma
            settings.minor = mi
            settings.txLevel = levels[txLevel.selectedItemPosition.coerceIn(0, levels.size - 1)]
        } else {
            val sv = server.text.toString().trim().trimEnd('/')
            if (!Regex("^https?://\\S+$").matches(sv)) return invalid(server, "http://노트북IP:3001 형식으로 (예: http://192.168.0.10:3001)")
            val gw = gateway.text.toString().trim()
            if (gw.isEmpty()) return invalid(gateway, "수신기 id 를 넣어 주세요 (예: gw-01)")
            settings.server = sv
            settings.gatewayId = gw
        }
        settings.role = r
        settings.uuid = u.toString()
        return true
    }

    private fun invalid(field: EditText, message: String): Boolean {
        field.error = message
        field.requestFocus()
        return false
    }

    /** 권한 → 블루투스 켜기 → (수신기) 위치 켜기 → 서비스 시작. 중간에 멈추면 결과를 받고 다시 여기로 */
    @SuppressLint("MissingPermission") // 블루투스 켜기 요청 전에 required() 로 BLUETOOTH_CONNECT 를 받는다
    private fun start() {
        if (!save()) return
        val r = settings.role
        val missing = required(r).filter { !granted(it) }
        if (missing.isNotEmpty()) {
            requestPermissions((missing + optional().filter { !granted(it) }).toTypedArray(), REQ_PERMISSIONS)
            return
        }
        val adapter = getSystemService(BluetoothManager::class.java)?.adapter
        if (adapter == null) return error("이 폰에는 블루투스가 없어요")
        if (!adapter.isEnabled) {
            try {
                startActivityForResult(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE), REQ_BLUETOOTH)
            } catch (_: SecurityException) {
                error("블루투스를 켜 주세요 (설정 → 연결)")
            }
            return
        }
        if (r == Role.BEACON && !adapter.isMultipleAdvertisementSupported) {
            return error("이 폰은 BLE 광고를 지원하지 않아요. 비콘 역할은 다른 폰으로 해 주세요")
        }
        if (r == Role.RECEIVER && !locationOn()) {
            AlertDialog.Builder(this)
                .setTitle("위치를 켜 주세요")
                .setMessage("안드로이드는 위치(GPS)가 켜져 있어야 주변 비콘을 보여 줘요. 이 앱은 위치를 기록하지 않아요.")
                .setPositiveButton("설정 열기") { _, _ -> startActivity(Intent(ACTION_LOCATION_SOURCE_SETTINGS)) }
                .setNegativeButton("취소", null)
                .show()
            return
        }
        Status.error = null
        startForegroundService(Intent(this, if (r == Role.BEACON) AdvertiserService::class.java else ReceiverService::class.java))
        render()
    }

    private fun stop() {
        stopService(Intent(this, AdvertiserService::class.java))
        stopService(Intent(this, ReceiverService::class.java))
        render()
    }

    private fun error(message: String) {
        Status.error = message
        render()
    }

    private fun granted(permission: String) = checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

    /** 없으면 시작하지 않는다 */
    private fun required(r: Role): List<String> = buildList {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            add(Manifest.permission.BLUETOOTH_CONNECT)
            add(if (r == Role.BEACON) Manifest.permission.BLUETOOTH_ADVERTISE else Manifest.permission.BLUETOOTH_SCAN)
        }
        if (r == Role.RECEIVER) {
            add(Manifest.permission.ACCESS_FINE_LOCATION)
            add(Manifest.permission.ACCESS_COARSE_LOCATION)
        }
    }

    /** 없어도 동작은 한다 (알림만 안 보인다) */
    private fun optional(): List<String> =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) listOf(Manifest.permission.POST_NOTIFICATIONS) else emptyList()

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQ_PERMISSIONS) return
        val r = settings.role
        if (required(r).all { granted(it) }) {
            start()
            return
        }
        val why = if (r == Role.BEACON) {
            "헬멧 비콘은 '근처 기기' 권한이 있어야 광고할 수 있어요."
        } else {
            "수신기는 '근처 기기'와 '정확한 위치' 권한이 있어야 비콘을 들을 수 있어요. 위치는 기록하지 않아요."
        }
        AlertDialog.Builder(this)
            .setTitle("권한이 필요해요")
            .setMessage("$why\n\n거부했다면 설정 → 앱 → GaussX 비콘 → 권한에서 허용해 주세요.")
            .setPositiveButton("설정 열기") { _, _ ->
                startActivity(Intent(ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
            }
            .setNegativeButton("닫기", null)
            .show()
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_BLUETOOTH) return
        if (resultCode == RESULT_OK) start() else error("블루투스를 켜야 시작할 수 있어요")
    }

    private fun locationOn(): Boolean {
        val lm = getSystemService(LocationManager::class.java) ?: return true
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            lm.isLocationEnabled
        } else {
            lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
        }
    }

    /** 0.5초마다 부르므로 바뀐 것만 다시 그린다 (같은 글자를 넣어도 다시 그려서 배터리를 쓴다) */
    private fun TextView.show(value: CharSequence) {
        if (text.toString() != value.toString()) text = value
    }

    /** 레이더 아래 글: 헬멧마다 거리 · 방향 · 구역 */
    private fun radarText(): CharSequence {
        val snap = RadarState.snapshot ?: return "레이더: 백엔드 응답을 기다리는 중…"
        val sb = SpannableStringBuilder()
        if (snap.receivers.isEmpty()) {
            sb.append("수신기가 1대라 거리만 보여요. 방향은 수신기 2대부터 (백엔드 demo.json gateways)\n")
        } else if (snap.receivers.none { it.online }) {
            sb.append("다른 수신기(${snap.receivers.joinToString { it.label }})가 꺼져 있어 거리만 보여요\n")
        }
        if (snap.blips.isEmpty()) sb.append("들리는 헬멧이 없어요")
        for (b in snap.blips) {
            val dot = sb.length
            sb.append("● ")
            sb.setSpan(ForegroundColorSpan(RadarState.color(b.deviceId)), dot, dot + 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            sb.append(b.label)
            when {
                b.x != null && b.y != null && b.distance != null ->
                    sb.append("  약 ${RadarMath.formatDistance(b.distance)} · ${RadarMath.direction(b.x, b.y)}")
                b.distance != null -> sb.append("  약 ${RadarMath.formatDistance(b.distance)} · 방향 모름 (이 수신기만 들려요)")
                else -> sb.append("  이 수신기에는 안 들려요")
            }
            when (RadarState.trend(b.deviceId)) {
                -1 -> sb.append(" · 가까워지는 중")
                1 -> sb.append(" · 멀어지는 중")
            }
            val zone = when (b.state) {
                "in" -> "${b.zoneId} 안"
                "out" -> "구역 밖"
                else -> "구역 판정 중"
            }
            sb.append("\n    $zone · 수신기 ${b.heardBy.size}대가 들음")
            b.rssi?.let { sb.append(" · ${it.roundToInt()} dBm") }
            sb.append('\n')
        }
        return sb
    }

    /** 1m 보정 (길게 누르면 지우기). 백엔드가 이 수신기의 최근 3초 세기를 '1m 세기'로 쓴다 */
    private fun calibrate(reset: Boolean) {
        val url = settings.server.trimEnd('/') + "/api/gateway/calibrate"
        val body = JSONObject().put("gatewayId", settings.gatewayId).put("reset", reset)
        calibrate.isEnabled = false
        Thread {
            val reply = Http.post(url, body)
            val message = when {
                reply.error != null -> "백엔드에 보내지 못했어요: ${reply.error}"
                !reply.ok -> Http.message(reply.body)
                reset -> "1m 보정을 지웠어요 (씬 값으로)"
                else -> try {
                    val json = JSONObject(reply.body ?: "{}")
                    "1m 보정: ${json.optDouble("ref1mDbm").roundToInt()} dBm (기준 헬멧: ${json.optString("label")})\n" +
                        "저장했어요 — 관리자 화면 '수신기 배치'에서도 바꿀 수 있어요"
                } catch (_: Exception) {
                    "1m 보정을 했어요"
                }
            }
            runOnUiThread {
                calibrate.isEnabled = true
                Toast.makeText(this, message, Toast.LENGTH_LONG).show()
            }
        }.start()
    }

    private fun render() {
        val running = Status.running
        val receiver = running == Role.RECEIVER
        intro.visibility = if (running == null) View.VISIBLE else View.GONE
        form.visibility = if (running == null) View.VISIBLE else View.GONE
        radarBox.visibility = if (receiver) View.VISIBLE else View.GONE
        radar.running = receiver && resumed
        if (receiver) radarInfo.show(radarText())
        toggle.show(if (running != null) "멈추기" else "시작")
        val editable = running == null
        for (v in listOf<View>(uuid, major, minor, txLevel, server, gateway)) v.isEnabled = editable
        for (i in 0 until role.childCount) role.getChildAt(i).isEnabled = editable
        headline.show(
            when (running) {
                null -> "멈춤"
                Role.BEACON -> "헬멧 비콘 · ${Status.headline}"
                Role.RECEIVER -> "수신기 · ${Status.headline}"
            },
        )
        detail.show(
            listOfNotNull(
                Status.error?.let { "⚠ $it" },
                Status.detail.takeIf { running != null && it.isNotBlank() },
            ).joinToString("\n\n"),
        )
        // 동작 중에는 화면을 켜 둔다 (수신기는 충전기에 꽂아 두는 폰)
        val keep = running != null
        if (keep != screenKept) {
            if (keep) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            screenKept = keep
        }
    }

    companion object {
        private const val REQ_PERMISSIONS = 1
        private const val REQ_BLUETOOTH = 2
    }
}
