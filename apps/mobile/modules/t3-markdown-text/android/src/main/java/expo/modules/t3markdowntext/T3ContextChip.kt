package expo.modules.t3markdowntext

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.text.TextPaint
import android.text.TextUtils
import kotlin.math.ceil
import kotlin.math.min

/** Shared by editable spans and inline chat images so their metrics and colors agree. */
class T3ContextChip(
  label: String,
  private val symbol: String,
  fontSize: Float,
  colors: Colors,
  maximumWidth: Float,
  private val density: Float
) {
  data class Colors(val accent: Int, val foreground: Int, val border: Int)

  private val paint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    textSize = fontSize
    typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
  }
  private val em = fontSize
  val width = ceil(min(maximumWidth.coerceAtLeast(em * 3), paint.measureText(label) + em * 2.5f))
  val height = ceil(em * 1.41f)
  private val text = TextUtils.ellipsize(
    label,
    paint,
    (width - em * 2.5f).coerceAtLeast(0f),
    TextUtils.TruncateAt.MIDDLE
  ).toString()
  private val fill = Color.argb(
    28,
    Color.red(colors.accent),
    Color.green(colors.accent),
    Color.blue(colors.accent)
  )
  private val textColor = blend(colors.accent, colors.foreground, 0.22f)
  private val borderColor = blend(colors.accent, colors.border, 0.34f)
  private val shape = RectF(density / 2, density / 2, width - density / 2, height - density / 2)
  private val icon = iconPath(symbol)

  fun draw(canvas: Canvas, x: Float, y: Float) {
    canvas.save()
    canvas.translate(x, y)
    paint.style = Paint.Style.FILL
    paint.color = fill
    canvas.drawRoundRect(shape, em / 2, em / 2, paint)
    paint.style = Paint.Style.STROKE
    paint.strokeWidth = density
    paint.color = borderColor
    canvas.drawRoundRect(shape, em / 2, em / 2, paint)
    paint.color = textColor
    canvas.save()
    val iconSize = em * 1.17f
    canvas.translate(em / 2, (height - iconSize) / 2)
    canvas.scale(iconSize / 24, iconSize / 24)
    paint.strokeWidth = 1.7f
    paint.strokeJoin = Paint.Join.ROUND
    paint.strokeCap = Paint.Cap.ROUND
    canvas.drawPath(icon, paint)
    canvas.restore()
    paint.style = Paint.Style.FILL
    val metrics = paint.fontMetrics
    canvas.drawText(text, em * 2, (height - metrics.descent - metrics.ascent) / 2, paint)
    canvas.restore()
  }

  companion object {
    fun color(
      value: String,
      fallback: Int
    ): Int = runCatching { Color.parseColor(value) }.getOrDefault(fallback)

    private fun blend(accent: Int, base: Int, weight: Float): Int = Color.rgb(
      (Color.red(accent) * weight + Color.red(base) * (1 - weight)).toInt(),
      (Color.green(accent) * weight + Color.green(base) * (1 - weight)).toInt(),
      (Color.blue(accent) * weight + Color.blue(base) * (1 - weight)).toInt(),
    )

    private fun iconPath(symbol: String) = Path().apply {
      fun line(vararg points: Float) {
        moveTo(points[0], points[1])
        for (index in 2 until points.size step 2) lineTo(points[index], points[index + 1])
      }
      when (symbol) {
        "cube" -> {
          line(12f, 2f, 21f, 7f, 21f, 17f, 12f, 22f, 3f, 17f, 3f, 7f, 12f, 2f)
          line(3f, 7f, 12f, 12f, 21f, 7f)
          line(12f, 12f, 12f, 22f)
        }
        "arrow.triangle.branch" -> {
          addCircle(6f, 4f, 2f, Path.Direction.CW)
          addCircle(6f, 20f, 2f, Path.Direction.CW)
          addCircle(18f, 4f, 2f, Path.Direction.CW)
          line(6f, 6f, 6f, 18f)
          moveTo(18f, 6f)
          cubicTo(18f, 13f, 6f, 10f, 6f, 16f)
        }
        "cursorarrow.click" -> {
          line(4f, 3f, 19f, 12f, 12f, 14f, 9f, 21f, 4f, 3f)
          line(13f, 15f, 18f, 21f)
        }
        "text.bubble" -> {
          line(3f, 4f, 21f, 4f, 21f, 17f, 10f, 17f, 5f, 21f, 5f, 17f, 3f, 17f, 3f, 4f)
          line(7f, 8f, 17f, 8f)
          line(7f, 12f, 14f, 12f)
        }
        "terminal", "play.rectangle", "photo" -> {
          addRoundRect(2f, 4f, 22f, 20f, 2f, 2f, Path.Direction.CW)
          when (symbol) {
            "terminal" -> {
              line(6f, 8f, 10f, 12f, 6f, 16f)
              line(13f, 16f, 18f, 16f)
            }
            "play.rectangle" -> line(9f, 8f, 16f, 12f, 9f, 16f, 9f, 8f)
            else -> {
              addCircle(8f, 9f, 1.5f, Path.Direction.CW)
              line(3f, 18f, 11f, 12f, 15f, 15f, 18f, 12f, 21f, 16f)
            }
          }
        }
        else -> {
          line(5f, 2f, 14f, 2f, 20f, 8f, 20f, 22f, 5f, 22f, 5f, 2f)
          line(14f, 2f, 14f, 8f, 20f, 8f)
        }
      }
    }
  }
}
