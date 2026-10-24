package team.gaussx.beacon

import android.annotation.SuppressLint
import android.app.Service
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * 헬멧 비콘 (작업자 폰): iBeacon 을 계속 광고한다. 백엔드와는 통신하지 않는다 — 수신기가 듣고 보고한다.
 * 연결 불가(non-connectable) 광고 · 약 0.1초 간격(LOW_LATENCY) · 시간 제한 없음
 */
class AdvertiserService : Service() {
    private var advertiser: BluetoothLeAdvertiser? = null
    private var beacon: IBeacon? = null
    private var txLevel = AdvertiseSettings.ADVERTISE_TX_POWER_HIGH
    private var listening = false

    private val callback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings) {
            Status.headline = "광고 중"
            Status.error = null
        }

        override fun onStartFailure(errorCode: Int) {
            if (errorCode == ADVERTISE_FAILED_ALREADY_STARTED) {
                Status.headline = "광고 중"
                return
            }
            fail(
                "광고를 시작하지 못했어요 — " + when (errorCode) {
                    ADVERTISE_FAILED_DATA_TOO_LARGE -> "광고 내용이 너무 커요"
                    ADVERTISE_FAILED_TOO_MANY_ADVERTISERS -> "다른 앱이 광고 자리를 모두 쓰고 있어요"
                    ADVERTISE_FAILED_FEATURE_UNSUPPORTED -> "이 폰은 BLE 광고를 지원하지 않아요"
                    else -> "블루투스 내부 오류($errorCode). 블루투스를 껐다 켜 보세요"
                },
            )
        }
    }

    /** 블루투스를 껐다 켜면 광고가 조용히 멈춘다 → 다시 켜지면 다시 광고 */
    private val bluetooth = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, -1)) {
                BluetoothAdapter.STATE_TURNING_OFF -> stopAdvertising()
                BluetoothAdapter.STATE_OFF -> {
                    advertiser = null
                    Status.headline = "멈춤 — 블루투스 꺼짐"
                    Status.error = "블루투스가 꺼졌어요. 켜면 다시 광고해요"
                }
                BluetoothAdapter.STATE_ON -> advertise()
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val s = Settings(this)
        val uuid = IBeacon.parseUuid(s.uuid) ?: return fail("UUID 형식이 잘못됐어요: ${s.uuid}")
        val b = try {
            IBeacon(uuid, s.major, s.minor, Settings.MEASURED_POWER)
        } catch (e: IllegalArgumentException) {
            return fail(e.message ?: "설정이 잘못됐어요")
        }
        try {
            Foreground.start(this, ID, "헬멧 비콘 광고 중", b.id, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
        } catch (e: Exception) {
            return fail("백그라운드 동작을 시작하지 못했어요: ${e.message}")
        }
        Status.started(Role.BEACON, "광고 시작 중…")
        beacon = b
        txLevel = s.txLevel
        if (!listening) {
            val filter = IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) registerReceiver(bluetooth, filter, RECEIVER_NOT_EXPORTED)
            else registerReceiver(bluetooth, filter)
            listening = true
        }
        advertise()
        return START_STICKY
    }

    @SuppressLint("MissingPermission")
    private fun advertise() {
        val b = beacon ?: return
        val adapter = getSystemService(BluetoothManager::class.java)?.adapter
        if (adapter == null || !adapter.isEnabled) {
            Status.headline = "멈춤 — 블루투스 꺼짐"
            Status.error = "블루투스가 꺼져 있어요. 켜면 광고해요"
            return
        }
        val adv = adapter.bluetoothLeAdvertiser
        if (adv == null) {
            fail("이 폰은 BLE 광고를 지원하지 않아요. 비콘 역할은 다른 폰으로 해 주세요")
            return
        }
        stopAdvertising()
        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(txLevel)
            .setConnectable(false)
            .setTimeout(0)
            .build()
        val data = AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .setIncludeTxPowerLevel(false)
            .addManufacturerData(IBeacon.COMPANY_ID, b.manufacturerData())
            .build()
        try {
            adv.startAdvertising(settings, data, callback)
            advertiser = adv
            Status.detail = "비콘 id  ${b.id}\n세기     ${levelName(txLevel)}\n시작     ${Status.clock()}\n\n" +
                "화면을 꺼도 광고는 계속돼요 (알림이 떠 있는 동안).\n수신기 화면에 이 번호(${b.major}:${b.minor})가 보이면 연결된 거예요."
        } catch (e: SecurityException) {
            fail("블루투스 광고 권한이 없어요")
        }
    }

    @SuppressLint("MissingPermission")
    private fun stopAdvertising() {
        try {
            advertiser?.stopAdvertising(callback)
        } catch (_: Exception) {
            // 블루투스가 이미 꺼졌으면 멈출 것도 없다
        }
        advertiser = null
    }

    private fun fail(message: String): Int {
        Status.error = message
        stopSelf()
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        stopAdvertising()
        if (listening) {
            unregisterReceiver(bluetooth)
            listening = false
        }
        Status.stopped()
        super.onDestroy()
    }

    companion object {
        const val ID = 1

        fun levelName(level: Int) = when (level) {
            AdvertiseSettings.ADVERTISE_TX_POWER_ULTRA_LOW -> "아주 약하게"
            AdvertiseSettings.ADVERTISE_TX_POWER_LOW -> "약하게"
            AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM -> "보통"
            else -> "세게 (기본)"
        }
    }
}
