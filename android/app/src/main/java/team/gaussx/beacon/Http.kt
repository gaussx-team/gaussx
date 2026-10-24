package team.gaussx.beacon

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI

/** 백엔드로 JSON POST. 실패해도 쌓아 두지 않는다 (지금 위치만 의미가 있다) */
object Http {
    class Reply(val code: Int, val body: String?, val error: String?) {
        val ok get() = error == null && code in 200..299
    }

    fun post(url: String, json: JSONObject, timeoutMs: Int = 2000): Reply {
        var c: HttpURLConnection? = null
        return try {
            c = URI(url).toURL().openConnection() as HttpURLConnection
            c.requestMethod = "POST"
            c.connectTimeout = timeoutMs
            c.readTimeout = timeoutMs
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            c.outputStream.use { it.write(json.toString().toByteArray(Charsets.UTF_8)) }
            val code = c.responseCode
            val stream = if (code in 200..299) c.inputStream else c.errorStream
            Reply(code, stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }, null)
        } catch (e: Exception) {
            Reply(0, null, e.message ?: e.javaClass.simpleName)
        } finally {
            c?.disconnect()
        }
    }

    /** 백엔드 오류 본문 { message } → 한 줄 */
    fun message(body: String?): String = try {
        when (val m = JSONObject(body ?: "").opt("message")) {
            is JSONArray -> (0 until m.length()).joinToString(" · ") { m.optString(it) }
            null -> body.orEmpty().take(200)
            else -> m.toString()
        }
    } catch (_: Exception) {
        body.orEmpty().take(200)
    }
}
