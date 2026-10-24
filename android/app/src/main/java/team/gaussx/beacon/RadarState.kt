package team.gaussx.beacon

import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject

/**
 * 백엔드가 보고 응답에 실어 주는 레이더 (이 수신기 기준 m: x = 오른쪽, y = 앞 · 구역 쪽). 1초마다 바뀐다.
 * 위치 계산은 백엔드가 한다 (두 수신기의 보고가 다 모이는 곳). 이 폰은 지금 값과 '가까워지는 중' 비교용 몇 초만 둔다.
 */
object RadarState {
    class Receiver(val id: String, val label: String, val x: Double, val y: Double, val online: Boolean)

    class Blip(
        val deviceId: String,
        val label: String,
        /** in · out · unknown (구역 판정) */
        val state: String,
        val zoneId: String?,
        /** 이 수신기까지 어림 거리 (못 들으면 null) */
        val distance: Double?,
        /** 위치 (수신기 두 대가 들을 때만) · 오차 반지름 */
        val x: Double?,
        val y: Double?,
        val err: Double?,
        val rssi: Double?,
        val heardBy: List<String>,
    )

    class Snapshot(
        /** 받은 시각 (elapsedRealtime) */
        val at: Long,
        val zoneName: String?,
        /** 이 수신기 구역의 바닥 사각형 (꼭짓점 [x, y]) */
        val zone: List<DoubleArray>,
        val receivers: List<Receiver>,
        val blips: List<Blip>,
    )

    @Volatile
    var snapshot: Snapshot? = null
        private set

    private val palette = intArrayOf(0xFF4FC3F7.toInt(), 0xFFFFB74D.toInt(), 0xFFF06292.toInt(), 0xFFAED581.toInt(), 0xFFBA68C8.toInt())
    private val colors = HashMap<String, Int>()
    private val history = HashMap<String, ArrayDeque<Pair<Long, Double>>>()

    @Synchronized
    fun update(json: JSONObject?) {
        if (json == null) return
        val now = SystemClock.elapsedRealtime()
        val zone = json.optJSONObject("zone")
        val polygon = zone?.optJSONArray("polygon")
        val blips = objects(json.optJSONArray("blips")).map { b ->
            Blip(
                deviceId = b.optString("deviceId"),
                label = b.optString("label", b.optString("deviceId")),
                state = b.optString("state"),
                zoneId = b.optString("zoneId").takeIf { !b.isNull("zoneId") },
                distance = num(b, "distance"),
                x = num(b, "x"),
                y = num(b, "y"),
                err = num(b, "err"),
                rssi = num(b, "rssi"),
                heardBy = b.optJSONArray("heardBy")?.let { a -> (0 until a.length()).map { a.optString(it) } } ?: emptyList(),
            )
        }
        snapshot = Snapshot(
            at = now,
            zoneName = zone?.optString("name"),
            zone = (0 until (polygon?.length() ?: 0)).mapNotNull { i ->
                polygon!!.optJSONArray(i)?.let { p -> doubleArrayOf(p.optDouble(0), p.optDouble(1)) }
            },
            receivers = objects(json.optJSONArray("receivers")).map { r ->
                Receiver(r.optString("id"), r.optString("label", r.optString("id")), r.optDouble("x"), r.optDouble("y"), r.optBoolean("online"))
            },
            blips = blips,
        )
        for (b in blips) {
            val d = b.distance ?: continue
            val h = history.getOrPut(b.deviceId) { ArrayDeque() }
            h.addLast(now to d)
            while (h.isNotEmpty() && now - h.first().first > 6_000) h.removeFirst()
        }
    }

    @Synchronized
    fun clear() {
        snapshot = null
        history.clear()
    }

    /** 단말마다 같은 색 (레이더 점 · 아래 글자) */
    @Synchronized
    fun color(deviceId: String): Int = colors.getOrPut(deviceId) { palette[colors.size % palette.size] }

    /** −1 가까워지는 중 · 0 · +1 멀어지는 중 (3초쯤 전과 비교해 20% 넘게 바뀌었나) */
    @Synchronized
    fun trend(deviceId: String): Int {
        val h = history[deviceId] ?: return 0
        val last = h.lastOrNull() ?: return 0
        val past = h.firstOrNull { last.first - it.first in 2_500..4_500 } ?: return 0
        val ratio = last.second / past.second
        return if (ratio < 0.8) -1 else if (ratio > 1.25) 1 else 0
    }

    private fun num(o: JSONObject, key: String): Double? =
        if (o.isNull(key)) null else o.optDouble(key).takeIf { !it.isNaN() }

    private fun objects(a: JSONArray?): List<JSONObject> =
        if (a == null) emptyList() else (0 until a.length()).mapNotNull { a.optJSONObject(it) }
}
