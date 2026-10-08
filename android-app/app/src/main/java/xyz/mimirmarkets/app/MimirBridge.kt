package xyz.mimirmarkets.app

import android.app.AlertDialog
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * window.MimirApp, only in the app and only for https://mimirmarkets.xyz.
 *
 * The page says when it is ready (the launch screen fades), asks to retry, opens our /app page in the phone's
 * browser for an update, and hands over the recovery file to be saved. Two ways in, both locked to our origin:
 *   - WebViewCompat.addWebMessageListener (when supported): the page gets a `MimirAppPort` object only on our
 *     origin, and a document-start shim (SHIM) wraps it as window.MimirApp; every message is checked again here
 *     (main frame, our origin) before it does anything.
 *   - addJavascriptInterface (older WebViews): the same methods, each refused unless the WebView's current page is
 *     ours ([originOk], kept up to date by MainActivity on every navigation).
 * Sync getters (insets, nativeRefresh) are answered from state pushed into the shim, never by a call into the app.
 */
class MimirBridge(
    private val activity: MainActivity,
    private val onReady: () -> Unit,
    private val onRetry: () -> Unit,
    /** False while a sheet or dialog is open in the page, so a downward drag inside it is not a refresh. */
    private val onRefreshAllowed: (Boolean) -> Unit,
    /** The in-app update: our own APK URL (Updater.kt checks the host and the signature). */
    private val onUpdate: (String) -> Unit,
    /** The system bars' heights in CSS px, as JSON {"top":n,"bottom":n}. */
    private val insets: () -> String,
) {
    private val main = Handler(Looper.getMainLooper())

    /** True while the WebView shows a page of our site (the fallback path's gate). */
    @Volatile var originOk = false

    /** One message from the page: {"m": method, "a": [args]}. Unknown or malformed messages are ignored. */
    fun dispatch(raw: String) {
        val msg = runCatching { JSONObject(raw) }.getOrNull() ?: return
        val a = msg.optJSONArray("a") ?: JSONArray()
        when (msg.optString("m")) {
            "ready" -> main.post { onReady() }
            "retry" -> main.post { onRetry() }
            "refresh" -> main.post { onRefreshAllowed(a.optBoolean(0, true)) }
            "update" -> a.optString(0).takeIf { it.isNotEmpty() }?.let { url -> main.post { onUpdate(url) } }
            "open" -> openInBrowser(a.optString(0))
            "save" -> saveFile(a.optString(0), a.optString(1), a.optString(2))
        }
    }

    // ── the fallback interface (older WebViews without the message listener) ─────────────────────────────────

    inner class Legacy {
        @JavascriptInterface fun ready() = gate { dispatch("""{"m":"ready"}""") }
        @JavascriptInterface fun retry() = gate { dispatch("""{"m":"retry"}""") }
        @JavascriptInterface fun insets(): String = if (originOk) insets.invoke() else "{}"
        @JavascriptInterface fun nativeRefresh(): Boolean = originOk
        @JavascriptInterface fun setRefreshAllowed(allowed: Boolean) = gate { dispatch(JSONObject().put("m", "refresh").put("a", JSONArray().put(allowed)).toString()) }
        @JavascriptInterface fun update(url: String) = gate { dispatch(JSONObject().put("m", "update").put("a", JSONArray().put(url)).toString()) }
        @JavascriptInterface fun openInBrowser(url: String) = gate { dispatch(JSONObject().put("m", "open").put("a", JSONArray().put(url)).toString()) }
        @JavascriptInterface fun saveFile(name: String, mime: String, base64: String) =
            gate { dispatch(JSONObject().put("m", "save").put("a", JSONArray().put(name).put(mime).put(base64)).toString()) }

        private fun gate(block: () -> Unit) {
            if (originOk) block()
        }
    }

    // ── actions ──────────────────────────────────────────────────────────────────────────────────────────────

    /**
     * Opens one of our own pages in the phone's browser rather than in the app. A plain link to mimirmarkets.xyz is an
     * app link, so Android would hand it straight back to us: target the default browser by package instead. Used for
     * the update ("open /app in your browser and download there"). Only our own https pages.
     */
    private fun openInBrowser(url: String) {
        val uri = Uri.parse(url)
        if (uri.scheme != "https" || uri.host != MainActivity.HOST) return
        main.post {
            val pm = activity.packageManager
            val probe = Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com"))
            val default = pm.resolveActivity(probe, PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo?.packageName
            val browser = default?.takeIf { it != activity.packageName && it != "android" }
                ?: pm.queryIntentActivities(probe, PackageManager.MATCH_ALL).map { it.activityInfo.packageName }.firstOrNull { it != activity.packageName }
            val intent = Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (browser != null) intent.setPackage(browser)
            runCatching { activity.startActivity(intent) }
        }
    }

    /**
     * The only file the page may save: the recovery file (components/arc/RecoveryPanel.tsx), text/plain, small. The
     * user is told what it is first and can copy the phrase instead of keeping a file.
     */
    private fun saveFile(name: String, mime: String, base64: String) {
        if (!RECOVERY_NAME.matches(name) || mime.substringBefore(';').trim() != "text/plain") return
        val bytes = runCatching { Base64.decode(base64, Base64.DEFAULT) }.getOrNull() ?: return
        if (bytes.isEmpty() || bytes.size > MAX_FILE_BYTES) return
        main.post {
            if (activity.isFinishing) return@post
            AlertDialog.Builder(activity)
                .setTitle("Your recovery phrase")
                .setMessage("This file holds your recovery phrase. Anyone who reads it can take your account. Keep it offline.")
                .setPositiveButton("Save file") { _, _ -> write(name, bytes) }
                .setNeutralButton("Copy instead") { _, _ -> copy(String(bytes, Charsets.UTF_8)) }
                .setNegativeButton("Cancel", null)
                .show()
        }
    }

    private fun copy(text: String) {
        val clip = ClipData.newPlainText("Mimir recovery phrase", text)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            clip.description.extras = PersistableBundle().apply { putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true) }
        }
        (activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(clip)
        Toast.makeText(activity, "Copied. Paste it somewhere offline, then clear your clipboard.", Toast.LENGTH_LONG).show()
    }

    private fun write(name: String, bytes: ByteArray) {
        val ok = runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, name)
                    put(MediaStore.Downloads.MIME_TYPE, "text/plain")
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }
                val resolver = activity.contentResolver
                val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: error("no Downloads")
                resolver.openOutputStream(uri)!!.use { it.write(bytes) }
                values.clear()
                values.put(MediaStore.Downloads.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
            } else {
                // API 26-28: the app's own Downloads folder (no storage permission needed).
                val dir = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: error("no Downloads")
                File(dir, name).writeBytes(bytes)
            }
        }.isSuccess
        Toast.makeText(activity, if (ok) "Saved to Downloads: $name" else "Could not save $name", Toast.LENGTH_LONG).show()
    }

    companion object {
        /** RecoveryPanel's file name: mimir-recovery-<6 hex>.txt; nothing else is ever written. */
        private val RECOVERY_NAME = Regex("^mimir-recovery-[a-f0-9]{6}\\.txt$")
        private const val MAX_FILE_BYTES = 16 * 1024

        /**
         * Document-start script for our origin only: window.MimirApp over the message port, with the sync getters
         * answered from STATE (replaced with the current insets each time the script is registered).
         */
        fun shim(insetsJson: String) = """
            (function(){
              if (window.MimirApp || !window.MimirAppPort) return;
              var port = window.MimirAppPort, insets = ${JSONObject.quote(insetsJson)};
              function send(m, a){ try { port.postMessage(JSON.stringify({m: m, a: a || []})); } catch (e) {} }
              port.onmessage = function(e){ try { var d = JSON.parse(e.data); if (d.insets) insets = d.insets; } catch (x) {} };
              window.MimirApp = Object.freeze({
                ready: function(){ send('ready'); },
                retry: function(){ send('retry'); },
                insets: function(){ return insets; },
                nativeRefresh: function(){ return true; },
                setRefreshAllowed: function(v){ send('refresh', [!!v]); },
                update: function(u){ send('update', [String(u)]); },
                openInBrowser: function(u){ send('open', [String(u)]); },
                saveFile: function(n, t, b){ send('save', [String(n), String(t), String(b)]); }
              });
            })();
        """.trimIndent()
    }
}
