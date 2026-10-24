package team.gaussx.beacon

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.UUID

class IBeaconTest {
    private val uuid = UUID.fromString(Settings.DEFAULT_UUID)

    private fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }

    @Test
    fun `광고 바이트는 iBeacon 규격 그대로 (큰 쪽 바이트부터, 세기는 부호 있는 1바이트)`() {
        val b = IBeacon(uuid, 1, 2, -59)
        assertEquals("0215" + "9d299ff3543140e685d64ac08806000e" + "0001" + "0002" + "c5", hex(b.manufacturerData()))
    }

    @Test
    fun `백엔드 비콘 id 는 uuid 소문자 major minor`() {
        assertEquals("9d299ff3-5431-40e6-85d6-4ac08806000e:1:1", IBeacon(uuid, 1, 1, -59).id)
        assertEquals(uuid, IBeacon.parseUuid(" 9D299FF3-5431-40E6-85D6-4AC08806000E "))
        assertNull(IBeacon.parseUuid("1-1-1-1-1"))
        assertNull(IBeacon.parseUuid("9d299ff3543140e685d64ac08806000e"))
    }

    @Test
    fun `되읽기 - 부호 없는 major minor 와 음수 세기`() {
        for (b in listOf(IBeacon(uuid, 0, 0, 0), IBeacon(uuid, 65535, 258, -59), IBeacon(UUID.randomUUID(), 40000, 1, -128))) {
            assertEquals(b, IBeacon.parse(b.manufacturerData()))
        }
    }

    @Test
    fun `iBeacon 이 아니면 null`() {
        assertNull(IBeacon.parse(null))
        assertNull(IBeacon.parse(ByteArray(22)))
        assertNull(IBeacon.parse(IBeacon(uuid, 1, 1, -59).manufacturerData().also { it[1] = 0x16 }))
    }

    @Test
    fun `스캔 필터는 UUID 만 본다`() {
        val (data, mask) = IBeacon.filter(uuid)
        fun matches(b: ByteArray) = b.indices.all { i -> (b[i].toInt() and mask[i].toInt()) == (data[i].toInt() and mask[i].toInt()) }
        assertTrue(matches(IBeacon(uuid, 1, 2, -59).manufacturerData()))
        assertTrue(matches(IBeacon(uuid, 7, 9, -70).manufacturerData()))
        assertFalse(matches(IBeacon(UUID(0, 0), 1, 2, -59).manufacturerData()))
        assertArrayEquals(ByteArray(5), mask.copyOfRange(18, 23))
    }

    @Test(expected = IllegalArgumentException::class)
    fun `major 가 범위 밖이면 거부`() {
        IBeacon(uuid, 65536, 0, -59)
    }
}
