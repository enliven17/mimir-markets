package xyz.mimirmarkets.app

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import android.widget.Toast
import java.io.File

/**
 * window.MimirApp, only in the app: the page says when it is ready (the launch screen fades), asks to retry after
 * the offline page, and hands over files it would download (the recovery phrase) to be saved in Downloads.
 * Methods run on WebView's binder thread; anything touching views goes to the main thread.
 */
class MimirBridge(
    private val context: Context,
    private val onReady: () -> Unit,
    private val onRetry: () -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun ready() {
        main.post { onReady() }
    }

    @JavascriptInterface
    fun retry() {
        onRetry()
    }

    @JavascriptInterface
    fun saveFile(name: String, mime: String, base64: String) {
        val safe = name.replace(Regex("[^A-Za-z0-9._-]"), "_").take(80).ifBlank { "mimir-download" }
        val ok = runCatching { write(safe, mime, Base64.decode(base64, Base64.DEFAULT)) }.isSuccess
        main.post { Toast.makeText(context, if (ok) "Saved to Downloads: $safe" else "Could not save $safe", Toast.LENGTH_LONG).show() }
    }

    private fun write(name: String, mime: String, bytes: ByteArray) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, name)
                put(MediaStore.Downloads.MIME_TYPE, mime)
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val resolver = context.contentResolver
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: error("no Downloads")
            resolver.openOutputStream(uri)!!.use { it.write(bytes) }
            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
        } else {
            // API 26-28: the app's own Downloads folder (no storage permission needed).
            val dir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: error("no Downloads")
            File(dir, name).writeBytes(bytes)
        }
    }
}
