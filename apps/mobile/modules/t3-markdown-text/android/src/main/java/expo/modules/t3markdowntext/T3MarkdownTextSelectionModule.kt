package expo.modules.t3markdowntext

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.text.Spanned
import android.text.style.ReplacementSpan
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.widget.TextView
import com.facebook.react.bridge.ReactContext
import com.facebook.react.uimanager.UIManagerHelper
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.max
import kotlin.math.min
import org.json.JSONObject
import org.json.JSONArray
import java.net.URLEncoder

private const val OBJECT_REPLACEMENT_CHARACTER = "\uFFFC"

private fun copyTextWithoutInlineImages(
  text: CharSequence,
  start: Int,
  end: Int
): String {
  if (text !is Spanned) return text.subSequence(start, end).toString()

  return buildString {
    for (index in start until end) {
      val isInlineImage =
        text[index].toString() == OBJECT_REPLACEMENT_CHARACTER &&
          text.getSpans(index, index + 1, ReplacementSpan::class.java).isNotEmpty()
      if (!isInlineImage) append(text[index])
    }
  }
}

private class SanitizingSelectionActionModeCallback(
  private val textView: TextView,
  private val delegate: ActionMode.Callback?,
  var contextClipboardConfig: String
) : ActionMode.Callback {
  override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean =
    delegate?.onCreateActionMode(mode, menu) ?: true

  override fun onPrepareActionMode(mode: ActionMode, menu: Menu): Boolean =
    delegate?.onPrepareActionMode(mode, menu) ?: false

  override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean {
    if (item.itemId == android.R.id.copy) {
      val start = min(textView.selectionStart, textView.selectionEnd)
      val end = max(textView.selectionStart, textView.selectionEnd)
      if (start >= 0 && end > start) {
        val originalText = textView.text.subSequence(start, end).toString()
        val config = runCatching { JSONObject(contextClipboardConfig) }.getOrNull()
        val ranges = config?.optJSONArray("ranges")
        val canonical = StringBuilder(originalText)
        var hasContext = false
        if (ranges != null) for (index in ranges.length() - 1 downTo 0) {
          val range = ranges.optJSONObject(index) ?: continue
          val first = max(start, range.optInt("start"))
          val last = min(end, range.optInt("end"))
          if (last > first) {
            canonical.replace(first - start, last - start, range.optString("text"))
            hasContext = true
          }
        }
        val selectedText = if (hasContext) canonical.toString().replace(OBJECT_REPLACEMENT_CHARACTER, "") else copyTextWithoutInlineImages(textView.text, start, end)
        if (hasContext || selectedText != originalText) {
          val clipboard =
            textView.context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
          val payload = runCatching { JSONObject(config?.optString("fragment") ?: "") }.getOrNull()
          val records = payload?.optJSONArray("records")
          val copied = JSONArray()
          val ids = mutableSetOf<String>()
          if (records != null) {
            for (index in 0 until records.length()) {
              val record = records.getJSONObject(index)
              if (selectedText.contains("/${record.optString("contextId")})")) {
                ids.add(record.optString("contextId"))
                if (record.has("screenshotContextId")) ids.add(record.getString("screenshotContextId"))
              }
            }
            for (index in 0 until records.length()) if (ids.contains(records.getJSONObject(index).optString("contextId"))) copied.put(records.getJSONObject(index))
          }
          if (hasContext && payload != null && copied.length() > 0) {
            payload.put("records", copied)
            val attribute = URLEncoder.encode(payload.toString(), "UTF-8").replace("+", "%20")
            val escaped = selectedText.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            clipboard.setPrimaryClip(ClipData.newHtmlText(null, selectedText, "<pre data-t3-context-fragment=\"$attribute\">$escaped</pre>"))
          } else clipboard.setPrimaryClip(ClipData.newPlainText(null, selectedText))
          mode.finish()
          return true
        }
      }
    }
    return delegate?.onActionItemClicked(mode, item) ?: false
  }

  override fun onDestroyActionMode(mode: ActionMode) {
    delegate?.onDestroyActionMode(mode)
  }
}

class T3MarkdownTextSelectionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("T3MarkdownTextSelection")

    Function("installCopySanitizer") { reactTag: Int, contextClipboardConfig: String ->
      val reactContext = appContext.reactContext as? ReactContext ?: return@Function
      reactContext.runOnUiQueueThread {
        val textView =
          runCatching {
            UIManagerHelper.getUIManagerForReactTag(reactContext, reactTag)?.resolveView(reactTag)
          }
            .getOrNull() as? TextView ?: return@runOnUiQueueThread
        val currentCallback = textView.customSelectionActionModeCallback
        if (currentCallback is SanitizingSelectionActionModeCallback) {
          currentCallback.contextClipboardConfig = contextClipboardConfig
          return@runOnUiQueueThread
        }
        textView.customSelectionActionModeCallback =
          SanitizingSelectionActionModeCallback(textView, currentCallback, contextClipboardConfig)
      }
    }
  }
}
