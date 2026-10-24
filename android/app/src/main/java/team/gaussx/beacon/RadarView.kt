package team.gaussx.beacon

import android.content.Context
import android.graphics.Canvas
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.os.SystemClock
import android.util.AttributeSet
import android.view.View
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * 레이더: 가운데 = 이 수신기, 위 = 앞(구역 쪽), 옆 = 다른 수신기 쪽. 거리는 실제 비율(선형)로, 범위는 저절로 맞춘다.
 *   수신기 두 대가 들으면 점 + 오차 원, 이 수신기만 들으면 그 거리 고리(방향 모름)로 그린다.
 * 화면에 보이는 동안 초당 30번 다시 그린다 — 1초마다 오는 값을 부드럽게 따라간다.
 */
class RadarView(context: Context, attrs: AttributeSet?) : View(context, attrs) {
    var running = false
        set(v) {
            val was = field
            field = v
            if (v && !was) invalidate()
        }

    private val dp = resources.displayMetrics.density
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER }
    private val path = Path()
    private val clip = Path()
    private val box = RectF()
    private val dash = DashPathEffect(floatArrayOf(5 * dp, 5 * dp), 0f)

    /** 화면에 그리는 위치 (단말 → x, y). 1초마다 오는 값을 부드럽게 따라간다 */
    private val shown = HashMap<String, DoubleArray>()
    private val seen = HashSet<String>()
    private var lastFrame = 0L

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val size = min(MeasureSpec.getSize(widthMeasureSpec), (440 * dp).toInt())
        setMeasuredDimension(size, size)
    }

    override fun onDraw(c: Canvas) {
        val now = SystemClock.elapsedRealtime()
        val dt = if (lastFrame == 0L) 1000L else (now - lastFrame).coerceAtMost(1000L)
        lastFrame = now
        val ease = 1 - exp(-dt / 350.0)

        val snap = RadarState.snapshot
        val cx = width / 2f
        val cy = height / 2f
        val outer = min(cx, cy) - 4 * dp

        // 범위: 다른 수신기 · 비콘이 다 들어가게 (오차 원은 테두리에서 잘려도 된다)
        var far = 1.0
        snap?.receivers?.forEach { far = max(far, hypot(it.x, it.y)) }
        snap?.blips?.forEach { b -> b.distance?.let { far = max(far, it) } }
        val range = RadarMath.range(far * 1.15)
        val scale = outer / range.toFloat()
        val sx = { x: Double -> cx + (x * scale).toFloat() }
        val sy = { y: Double -> cy - (y * scale).toFloat() }

        c.save()
        clip.reset()
        clip.addCircle(cx, cy, outer, Path.Direction.CW)
        c.clipPath(clip)

        // 바탕
        paint.style = Paint.Style.FILL
        paint.color = BG
        c.drawCircle(cx, cy, outer, paint)

        // 구역 (이 수신기가 지키는 바닥)
        val zone = snap?.zone.orEmpty()
        if (zone.size >= 3) {
            path.reset()
            path.moveTo(sx(zone[0][0]), sy(zone[0][1]))
            for (p in zone.drop(1)) path.lineTo(sx(p[0]), sy(p[1]))
            path.close()
            paint.color = ZONE_FILL
            c.drawPath(path, paint)
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = 1.5f * dp
            paint.color = ZONE_LINE
            c.drawPath(path, paint)
            val zx = zone.sumOf { it[0] } / zone.size
            val zy = zone.sumOf { it[1] } / zone.size
            text.textSize = 12 * dp
            text.isFakeBoldText = false
            text.color = ZONE_TEXT
            c.drawText(snap?.zoneName.orEmpty(), sx(zx), sy(zy), text)
        }

        // 거리 고리 · 십자
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 1 * dp
        paint.color = GRID
        val rings = RadarMath.rings(range)
        for (m in rings) c.drawCircle(cx, cy, (m * scale).toFloat(), paint)
        c.drawLine(cx - outer, cy, cx + outer, cy, paint)
        c.drawLine(cx, cy - outer, cx, cy + outer, paint)
        text.textSize = 11 * dp
        text.color = GRID_TEXT
        // 고리 숫자는 아래쪽(수신기 뒤 — 보통 비어 있다)에
        for (m in rings) c.drawText(RadarMath.ringLabel(m), cx + 16 * dp, cy + (m * scale).toFloat() - 4 * dp, text)

        // 수신 중 표시: 1.5초마다 퍼지는 고리
        if (running && snap != null) {
            val phase = (now % 1500) / 1500f
            paint.color = PULSE
            paint.alpha = ((1 - phase) * 110).toInt()
            paint.strokeWidth = 2 * dp
            c.drawCircle(cx, cy, outer * phase, paint)
            paint.alpha = 255
        }

        // 다른 수신기
        for (r in snap?.receivers.orEmpty()) {
            drawReceiver(c, sx(r.x), sy(r.y), if (r.online) RECEIVER else OFFLINE, r.label + if (r.online) "" else " (꺼짐)")
        }

        // 헬멧
        seen.clear()
        for ((i, b) in snap?.blips.orEmpty().withIndex()) {
            val color = RadarState.color(b.deviceId)
            if (b.x != null && b.y != null) {
                seen += b.deviceId
                val s = shown.getOrPut(b.deviceId) { doubleArrayOf(b.x, b.y) }
                s[0] += ease * (b.x - s[0])
                s[1] += ease * (b.y - s[1])
                val px = sx(s[0])
                val py = sy(s[1])
                paint.style = Paint.Style.FILL
                paint.color = color
                paint.alpha = 50
                c.drawCircle(px, py, max(10 * dp, ((b.err ?: 0.0) * scale).toFloat()), paint) // 오차
                paint.alpha = 255
                c.drawCircle(px, py, 7 * dp, paint)
                paint.style = Paint.Style.STROKE
                paint.strokeWidth = 2 * dp
                paint.color = WHITE
                c.drawCircle(px, py, 7 * dp, paint)
                drawLabel(c, "${b.label} ${RadarMath.formatDistance(b.distance ?: hypot(s[0], s[1]))}", px, py - 13 * dp, color)
            } else if (b.distance != null) {
                // 방향 모름: 그 거리쯤 어딘가 (±30% 띠 + 점선)
                val r = (b.distance * scale).toFloat()
                paint.style = Paint.Style.STROKE
                paint.color = color
                paint.alpha = 45
                paint.strokeWidth = max(6 * dp, r * 0.6f)
                c.drawCircle(cx, cy, r, paint)
                paint.alpha = 255
                paint.strokeWidth = 2 * dp
                paint.pathEffect = dash
                c.drawCircle(cx, cy, r, paint)
                paint.pathEffect = null
                val a = Math.toRadians(-45.0 + 90.0 * (i % 4)) // 라벨이 겹치지 않게 단말마다 다른 자리
                drawLabel(c, "${b.label} ${RadarMath.formatDistance(b.distance)} · 방향 모름", cx + r * sin(a).toFloat(), cy - r * cos(a).toFloat(), color)
            }
        }
        shown.keys.retainAll(seen)

        // 가운데 = 이 수신기
        drawReceiver(c, cx, cy, WHITE, "나")
        c.restore()

        // 앞 표시 (위쪽 = 구역 쪽)
        path.reset()
        path.moveTo(cx, cy - outer + 2 * dp)
        path.lineTo(cx - 7 * dp, cy - outer + 13 * dp)
        path.lineTo(cx + 7 * dp, cy - outer + 13 * dp)
        path.close()
        paint.style = Paint.Style.FILL
        paint.color = WHITE
        c.drawPath(path, paint)
        text.textSize = 11 * dp
        text.color = WHITE
        c.drawText("앞 (구역 쪽)", cx, cy - outer + 26 * dp, text)

        // 응답이 없거나 오래됐으면
        val waiting = when {
            snap == null -> "백엔드 응답을 기다리는 중…"
            now - snap.at >= 3_000 -> "${(now - snap.at) / 1000}초째 응답 없음 — 마지막 값"
            else -> null
        }
        if (waiting != null) drawLabel(c, waiting, cx, cy + outer * 0.6f, WARN)

        if (running) postInvalidateDelayed(33)
    }

    private fun drawReceiver(c: Canvas, x: Float, y: Float, color: Int, label: String) {
        paint.style = Paint.Style.FILL
        paint.color = color
        c.drawRect(x - 6 * dp, y - 6 * dp, x + 6 * dp, y + 6 * dp, paint)
        text.textSize = 11 * dp
        text.isFakeBoldText = false
        text.color = color
        c.drawText(label, x, y + 20 * dp, text)
    }

    private fun drawLabel(c: Canvas, s: String, x: Float, y: Float, color: Int) {
        text.textSize = 13 * dp
        text.isFakeBoldText = true
        val w = text.measureText(s)
        box.set(x - w / 2 - 6 * dp, y - 15 * dp, x + w / 2 + 6 * dp, y + 5 * dp)
        paint.style = Paint.Style.FILL
        paint.color = LABEL_BG
        c.drawRoundRect(box, 6 * dp, 6 * dp, paint)
        text.color = color
        c.drawText(s, x, y, text)
        text.isFakeBoldText = false
    }

    private companion object {
        val BG = 0xFF0B1F2E.toInt()
        val GRID = 0x5581C784
        val GRID_TEXT = 0x9981C784.toInt()
        val PULSE = 0xFF81C784.toInt()
        val ZONE_FILL = 0x2264B5F6
        val ZONE_LINE = 0x8864B5F6.toInt()
        val ZONE_TEXT = 0xCC90CAF9.toInt()
        val RECEIVER = 0xFFB0BEC5.toInt()
        val OFFLINE = 0xFF616161.toInt()
        val WHITE = 0xFFFFFFFF.toInt()
        val WARN = 0xFFFFD54F.toInt()
        val LABEL_BG = 0xCC0B1F2E.toInt()
    }
}
