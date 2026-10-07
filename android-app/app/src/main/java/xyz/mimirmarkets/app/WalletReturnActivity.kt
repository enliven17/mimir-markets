package xyz.mimirmarkets.app

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import java.net.HttpURLConnection
import java.net.URL

/**
 * Phantom and Solflare answer by opening https://mimirmarkets.xyz/api/wallet-return?op=… (lib/solana/deeplink-adapter.ts).
 * Loading that in the WebView would replace the page that is waiting for the answer. Instead this invisible activity
 * requests the same URL in the background (the server parks the answer, lib/server/wallet-relay.ts), brings
 * MainActivity back as it was, and closes; the page then collects the answer from the relay.
 */
class WalletReturnActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        intent?.data?.toString()?.let { url ->
            Thread {
                var c: HttpURLConnection? = null
                try {
                    c = URL(url).openConnection() as HttpURLConnection
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
}
