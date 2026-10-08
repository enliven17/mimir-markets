package xyz.mimirmarkets.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import java.net.HttpURLConnection
import java.net.URL

/**
 * Phantom and Solflare answer by opening https://mimirmarkets.xyz/api/wallet-return?op=… (lib/solana/deeplink-adapter.ts).
 * Loading that in the WebView would replace the page that is waiting for the answer. Instead this invisible activity
 * requests it in the background (the server parks the answer, lib/server/wallet-relay.ts), brings MainActivity back
 * as it was, and closes; the page then collects the answer from the relay.
 *
 * The activity is exported (it has to be, to receive the link), so the incoming URI is checked strictly: https, our
 * host, exactly /api/wallet-return, a well-formed op id, and only the wallet's response fields are forwarded, to a
 * URL this activity builds itself. Anything else is dropped without a request.
 */
class WalletReturnActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        relayUrl(intent?.data)?.let { url ->
            Thread {
                var c: HttpURLConnection? = null
                try {
                    c = URL(url).openConnection() as HttpURLConnection
                    c.instanceFollowRedirects = false
                    c.connectTimeout = 15_000
                    c.readTimeout = 15_000
                    c.responseCode
                } catch (_: Exception) {
                    // The page times out and says so; nothing to recover here.
                } finally {
                    c?.disconnect()
                }
            }.start()
        }
        // Resume the running app (singleTask), never a fresh page load.
        startActivity(
            Intent(this, MainActivity::class.java)
                .setAction(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_LAUNCHER)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT),
        )
        finish()
        overridePendingTransition(0, 0)
    }

    companion object {
        /** lib/server/wallet-relay.ts: a 128-bit op id, base64url without padding (22 characters). */
        private val OP = Regex("^[A-Za-z0-9_-]{22}$")
        /** The response fields the relay keeps; nothing else is forwarded. */
        private val FIELDS = listOf("nonce", "data", "phantom_encryption_public_key", "solflare_encryption_public_key", "errorCode", "errorMessage")
        private const val MAX_VALUE = 8192

        /** The relay request for a genuine wallet answer, rebuilt from the allowed fields; null for anything else. */
        fun relayUrl(uri: Uri?): String? {
            if (uri == null || uri.scheme != "https" || uri.host != MainActivity.HOST || uri.path != "/api/wallet-return") return null
            if (uri.port != -1 && uri.port != 443) return null
            val op = uri.getQueryParameter("op")?.takeIf { OP.matches(it) } ?: return null
            val out = Uri.Builder().scheme("https").authority(MainActivity.HOST).path("/api/wallet-return").appendQueryParameter("op", op)
            for (f in FIELDS) uri.getQueryParameter(f)?.takeIf { it.length <= MAX_VALUE }?.let { out.appendQueryParameter(f, it) }
            return out.build().toString()
        }
    }
}
