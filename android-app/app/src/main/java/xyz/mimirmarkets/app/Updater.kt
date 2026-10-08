package xyz.mimirmarkets.app

import android.app.Activity
import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import java.io.File
import java.security.MessageDigest

/**
 * The in-app update: downloads the new APK from our own site with DownloadManager (with its notification), shows the
 * progress on a small pill, checks the file is signed with the same key as this app and is a newer build, then
 * hands it to the system installer. If Mimir may not install apps yet, it opens that setting and installs on return.
 *
 * Never a Custom Tab: Chrome treats mimirmarkets.xyz as this app's verified link and sends it straight back, which
 * looped forever (and kept bringing the app to the front after Home).
 */
class Updater(private val activity: Activity, private val pill: TextView) {
    private val dm = activity.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
    private val main = Handler(Looper.getMainLooper())
    private var downloadId = -1L
    private var ready: File? = null
    private var receiver: BroadcastReceiver? = null

    fun start(url: String) {
        if (downloadId != -1L) return toast("The update is already downloading")
        val dir = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: return toast("No storage for the update")
        val file = File(dir, FILE).also { it.delete() }
        val request = DownloadManager.Request(Uri.parse(url))
            .setTitle("Mimir Markets update")
            .setMimeType(APK_MIME)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
            .setDestinationUri(Uri.fromFile(file))
        downloadId = dm.enqueue(request)
        listen()
        show("Downloading update… 0%")
        main.post(::poll)
    }

    /** Called from onResume: install a downloaded update once the "install unknown apps" setting allows it. */
    fun resume() {
        val file = ready ?: return
        if (canInstall()) {
            ready = null
            install(file)
        }
    }

    fun release() {
        receiver?.let { runCatching { activity.unregisterReceiver(it) } }
        receiver = null
        main.removeCallbacksAndMessages(null)
    }

    private fun listen() {
        if (receiver != null) return
        receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1) == downloadId) finished()
            }
        }
        ContextCompat.registerReceiver(activity, receiver, IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE), ContextCompat.RECEIVER_EXPORTED)
    }

    private fun poll() {
        if (downloadId == -1L) return
        dm.query(DownloadManager.Query().setFilterById(downloadId))?.use { c ->
            if (c.moveToFirst()) {
                val done = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
                val total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
                if (total > 0) show("Downloading update… ${(done * 100 / total).coerceIn(0, 100)}%")
            }
        }
        main.postDelayed(::poll, 400)
    }

    private fun finished() {
        val id = downloadId
        downloadId = -1L
        main.removeCallbacksAndMessages(null)
        val ok = dm.query(DownloadManager.Query().setFilterById(id))?.use { c ->
            c.moveToFirst() && c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)) == DownloadManager.STATUS_SUCCESSFUL
        } ?: false
        val file = File(activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), FILE)
        if (!ok || !file.exists()) return fail("The update did not download. Try again.")
        val problem = verify(file)
        if (problem != null) {
            file.delete()
            return fail(problem)
        }
        hide()
        if (canInstall()) install(file)
        else {
            ready = file
            toast("Allow Mimir to install the update, then come back")
            activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
        }
    }

    /** Same signing key as the running app and a higher build, or the reason it is refused. */
    private fun verify(file: File): String? {
        val pm = activity.packageManager
        val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else @Suppress("DEPRECATION") PackageManager.GET_SIGNATURES
        val archive = pm.getPackageArchiveInfo(file.path, flags) ?: return "The update file is damaged."
        val self = pm.getPackageInfo(activity.packageName, flags)
        if (archive.packageName != activity.packageName) return "That file is not Mimir."
        val newer = if (Build.VERSION.SDK_INT >= 28) archive.longVersionCode > self.longVersionCode else @Suppress("DEPRECATION") (archive.versionCode > self.versionCode)
        if (!newer) return "You already have the latest version."
        return if (certs(archive) == certs(self) && certs(self).isNotEmpty()) null else "The update is not signed by Mimir."
    }

    private fun certs(info: android.content.pm.PackageInfo): Set<String> {
        val sigs = if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else @Suppress("DEPRECATION") info.signatures
        val sha = MessageDigest.getInstance("SHA-256")
        return sigs.orEmpty().map { s -> sha.digest(s.toByteArray()).joinToString("") { "%02x".format(it) } }.toSet()
    }

    private fun canInstall() = Build.VERSION.SDK_INT < 26 || activity.packageManager.canRequestPackageInstalls()

    private fun install(file: File) {
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.files", file)
        activity.startActivity(
            Intent(Intent.ACTION_VIEW).setDataAndType(uri, APK_MIME).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),
        )
    }

    private fun show(text: String) {
        main.post {
            pill.text = text
            if (pill.alpha < 1f) pill.animate().alpha(1f).setDuration(150).start()
        }
    }

    private fun hide() {
        main.post { pill.animate().alpha(0f).setDuration(200).start() }
    }

    private fun fail(message: String) {
        hide()
        toast(message)
    }

    private fun toast(message: String) {
        main.post { Toast.makeText(activity, message, Toast.LENGTH_LONG).show() }
    }

    companion object {
        const val APK_MIME = "application/vnd.android.package-archive"
        private const val FILE = "mimir-update.apk"

        /** Our own APK (the only file the updater will fetch). */
        fun isOurApk(uri: Uri) = uri.scheme == "https" && uri.host == MainActivity.HOST && uri.path.orEmpty().endsWith(".apk")
    }
}
