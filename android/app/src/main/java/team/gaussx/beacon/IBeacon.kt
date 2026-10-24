package team.gaussx.beacon

import java.util.Locale
import java.util.UUID

/**
 * iBeacon 광고 내용 = 제조사 데이터 (회사 id 0x004C) 23바이트:
 * [0x02, 0x15, UUID 16, major 2, minor 2, 1m 기준 세기 1] (숫자는 큰 쪽 바이트부터)
 *
 * 안드로이드 폰은 광고할 때 MAC 주소가 수시로 바뀐다 → 백엔드는 비콘을 "uuid:major:minor" (소문자)로 찾는다.
 * 시중 헬멧 비콘도 대부분 iBeacon 을 내므로 수신기는 그대로 쓸 수 있다.
 */
data class IBeacon(val uuid: UUID, val major: Int, val minor: Int, val txPower: Int) {
    init {
        require(major in 0..0xFFFF) { "major 는 0~65535 여야 해요: $major" }
        require(minor in 0..0xFFFF) { "minor 는 0~65535 여야 해요: $minor" }
        require(txPower in -128..127) { "txPower 는 -128~127 이어야 해요: $txPower" }
    }

    /** 백엔드가 쓰는 비콘 id */
    val id: String get() = "${uuid.toString().lowercase(Locale.ROOT)}:$major:$minor"

    /** 광고에 싣는 제조사 데이터 (회사 id 는 빼고) */
    fun manufacturerData(): ByteArray {
        val b = ByteArray(LENGTH)
        b[0] = 0x02
        b[1] = 0x15
        putLong(b, 2, uuid.mostSignificantBits)
        putLong(b, 10, uuid.leastSignificantBits)
        b[18] = (major shr 8).toByte()
        b[19] = major.toByte()
        b[20] = (minor shr 8).toByte()
        b[21] = minor.toByte()
        b[22] = txPower.toByte()
        return b
    }

    companion object {
        /** 애플 회사 id — iBeacon 형식이 이 id 로 실린다 */
        const val COMPANY_ID = 0x004C
        const val LENGTH = 23

        private val UUID_TEXT = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

        /** 백엔드와 같은 형식만 받는다 (UUID.fromString 은 "1-1-1-1-1" 도 받아 준다) */
        fun parseUuid(text: String): UUID? {
            val t = text.trim().lowercase(Locale.ROOT)
            return if (UUID_TEXT.matches(t)) UUID.fromString(t) else null
        }

        /** 스캔 결과의 제조사 데이터(0x004C) → iBeacon. 다른 광고면 null */
        fun parse(data: ByteArray?): IBeacon? {
            if (data == null || data.size < LENGTH || data[0] != 0x02.toByte() || data[1] != 0x15.toByte()) return null
            val uuid = UUID(getLong(data, 2), getLong(data, 10))
            val major = (u8(data[18]) shl 8) or u8(data[19])
            val minor = (u8(data[20]) shl 8) or u8(data[21])
            return IBeacon(uuid, major, minor, data[22].toInt())
        }

        /** 스캔 필터: 이 UUID 의 iBeacon 만 (앞 18바이트가 같으면). 화면이 꺼져도 스캔하려면 필터가 있어야 한다 */
        fun filter(uuid: UUID): Pair<ByteArray, ByteArray> {
            val data = IBeacon(uuid, 0, 0, 0).manufacturerData()
            val mask = ByteArray(LENGTH) { i -> if (i < 18) 0xFF.toByte() else 0 }
            return data to mask
        }

        private fun u8(b: Byte) = b.toInt() and 0xFF

        private fun putLong(b: ByteArray, at: Int, v: Long) {
            for (i in 0 until 8) b[at + i] = (v shr (56 - 8 * i)).toByte()
        }

        private fun getLong(b: ByteArray, at: Int): Long {
            var v = 0L
            for (i in 0 until 8) v = (v shl 8) or (b[at + i].toLong() and 0xFF)
            return v
        }
    }
}
