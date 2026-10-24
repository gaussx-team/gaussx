package team.gaussx.beacon

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** 서비스 → 화면. 같은 프로세스 안에서만 쓴다 (화면이 0.5초마다 읽는다) */
object Status {
    @Volatile var running: Role? = null
    @Volatile var headline: String = ""
    @Volatile var detail: String = ""

    /** 멈춘 뒤에도 남겨 둔다 (왜 멈췄는지 보이게) */
    @Volatile var error: String? = null

    fun started(role: Role, headline: String) {
        running = role
        this.headline = headline
        detail = ""
        error = null
    }

    fun stopped() {
        running = null
        headline = ""
        detail = ""
    }

    fun clock(): String = SimpleDateFormat("HH:mm:ss", Locale.KOREA).format(Date())
}
