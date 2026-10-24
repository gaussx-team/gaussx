package team.gaussx.beacon

import org.junit.Assert.assertEquals
import org.junit.Test

class RadarMathTest {
    @Test
    fun `범위는 가장 먼 것이 들어가는 가장 작은 칸`() {
        assertEquals(2.0, RadarMath.range(1.1), 0.0)
        assertEquals(3.0, RadarMath.range(2.2), 0.0)
        assertEquals(5.0, RadarMath.range(5.0), 0.0)
        assertEquals(10.0, RadarMath.range(7.0), 0.0)
        assertEquals(50.0, RadarMath.range(80.0), 0.0) // 50m 넘으면 50m 에서 자른다
    }

    @Test
    fun `고리와 이름`() {
        assertEquals(listOf(0.5, 1.0, 1.5, 2.0), RadarMath.rings(2.0))
        assertEquals(listOf(2.0, 4.0, 6.0, 8.0, 10.0), RadarMath.rings(10.0))
        assertEquals("1m", RadarMath.ringLabel(1.0))
        assertEquals("0.5m", RadarMath.ringLabel(0.5))
    }

    @Test
    fun `방향 - 위가 앞(구역 쪽), 시계 방향`() {
        assertEquals("앞쪽", RadarMath.direction(0.0, 2.0))
        assertEquals("오른쪽 앞", RadarMath.direction(1.5, 1.0))
        assertEquals("오른쪽", RadarMath.direction(2.0, 0.0))
        assertEquals("왼쪽 앞", RadarMath.direction(-0.5, 1.0))
        assertEquals("왼쪽", RadarMath.direction(-2.0, 0.1))
        assertEquals("뒤쪽", RadarMath.direction(0.0, -1.0))
        assertEquals("왼쪽 뒤", RadarMath.direction(-1.0, -1.0))
        assertEquals(90.0, RadarMath.bearing(2.0, 0.0), 1e-9)
    }

    @Test
    fun `거리 글자 - 10m 아래는 소수 한 자리`() {
        assertEquals("1.8 m", RadarMath.formatDistance(1.8))
        assertEquals("0.5 m", RadarMath.formatDistance(0.46))
        assertEquals("12 m", RadarMath.formatDistance(12.4))
    }
}
