package team.gaussx.beacon

import android.bluetooth.le.AdvertiseSettings
import android.content.Context

enum class Role { BEACON, RECEIVER }

/** 폰마다 저장하는 설정. 두 폰이 같은 UUID 를 써야 수신기가 비콘을 알아본다 */
class Settings(context: Context) {
    private val prefs = context.getSharedPreferences("gaussx", Context.MODE_PRIVATE)

    var role: Role
        get() = Role.entries.firstOrNull { it.name == prefs.getString("role", null) } ?: Role.BEACON
        set(v) = prefs.edit().putString("role", v.name).apply()

    var uuid: String
        get() = prefs.getString("uuid", null) ?: DEFAULT_UUID
        set(v) = prefs.edit().putString("uuid", v).apply()

    var major: Int
        get() = prefs.getInt("major", 1)
        set(v) = prefs.edit().putInt("major", v).apply()

    var minor: Int
        get() = prefs.getInt("minor", 1)
        set(v) = prefs.edit().putInt("minor", v).apply()

    /** AdvertiseSettings.ADVERTISE_TX_POWER_* */
    var txLevel: Int
        get() = prefs.getInt("txLevel", AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
        set(v) = prefs.edit().putInt("txLevel", v).apply()

    var server: String
        get() = prefs.getString("server", null) ?: "http://192.168.0.10:3001"
        set(v) = prefs.edit().putString("server", v).apply()

    var gatewayId: String
        get() = prefs.getString("gatewayId", null) ?: "gw-01"
        set(v) = prefs.edit().putString("gatewayId", v).apply()

    companion object {
        /** GaussX 비콘 UUID (백엔드 개발용 씬 demo.json 의 beacon_id 와 같다) */
        const val DEFAULT_UUID = "9d299ff3-5431-40e6-85d6-4ac08806000e"

        /** 1m 에서 잰 세기 (iBeacon 관례값). 백엔드 판정에는 쓰지 않고 참고로만 보낸다 */
        const val MEASURED_POWER = -59
    }
}
