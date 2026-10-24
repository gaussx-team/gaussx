package team.gaussx.beacon

import java.util.Locale
import kotlin.math.atan2
import kotlin.math.roundToInt

/** 레이더 화면 계산 (안드로이드 없이 — 단위 테스트). 좌표 = 이 수신기 기준 m (x 오른쪽 · y 앞) */
object RadarMath {
    private val RANGES = doubleArrayOf(2.0, 3.0, 5.0, 10.0, 20.0, 50.0)

    /** 레이더 반지름이 나타낼 거리: 가장 먼 것이 들어가는 가장 작은 칸 */
    fun range(farthest: Double): Double = RANGES.firstOrNull { it >= farthest } ?: RANGES.last()

    /** 거리 고리 (m) */
    fun rings(range: Double): List<Double> = when {
        range <= 2.0 -> listOf(0.5, 1.0, 1.5, 2.0)
        range <= 3.0 -> listOf(1.0, 2.0, 3.0)
        range <= 5.0 -> listOf(1.0, 2.0, 3.0, 4.0, 5.0)
        range <= 10.0 -> listOf(2.0, 4.0, 6.0, 8.0, 10.0)
        range <= 20.0 -> listOf(5.0, 10.0, 15.0, 20.0)
        else -> listOf(10.0, 20.0, 30.0, 40.0, 50.0)
    }

    fun ringLabel(m: Double): String = if (m % 1.0 == 0.0) "${m.toInt()}m" else "${m}m"

    /** 앞 = 0°, 시계 방향 + (−180 ~ 180) */
    fun bearing(x: Double, y: Double): Double = Math.toDegrees(atan2(x, y))

    /** 이 수신기에서 본 방향 → 말 (앞 = 구역 쪽) */
    fun direction(x: Double, y: Double): String {
        val a = ((bearing(x, y) % 360) + 360) % 360
        return when {
            a < 22.5 || a >= 337.5 -> "앞쪽"
            a < 67.5 -> "오른쪽 앞"
            a < 112.5 -> "오른쪽"
            a < 157.5 -> "오른쪽 뒤"
            a < 202.5 -> "뒤쪽"
            a < 247.5 -> "왼쪽 뒤"
            a < 292.5 -> "왼쪽"
            else -> "왼쪽 앞"
        }
    }

    fun formatDistance(d: Double): String =
        if (d < 10) String.format(Locale.ROOT, "%.1f m", d) else "${d.roundToInt()} m"
}
