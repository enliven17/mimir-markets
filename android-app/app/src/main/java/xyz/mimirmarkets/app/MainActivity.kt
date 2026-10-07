package xyz.mimirmarkets.app

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ImageView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

/**
 * Mimir Markets as an app: one WebView on the site, no browser UI. The site runs in app mode (the user agent ends in
 * " MimirApp/<versionCode>"; app/layout.tsx and components/app/AppBanners.tsx read it).
 *
 * - Launch: Android's splash (the horn on ink) hands over to our launch screen, which stays until the page calls
 *   window.MimirApp.ready() (or finishes loading, or 8 s pass), then fades.
 * - mimirmarkets.xyz stays in the WebView; any other link opens in a Custom Tab or its own app (wallets, X).
 * - Passkeys: WebView WebAuthn through Credential Manager where the device's WebView supports it.
 * - Downloads: blob/data files (the recovery phrase) are saved to Downloads through the bridge.
 * - Offline: the bundled offline page with a Retry.
 */
class MainActivity : ComponentActivity() {

    private lateinit var web: WebView
    private lateinit var launch: View
    private val main = Handler(Looper.getMainLooper())
    private var launchDone = false
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    private val pickFiles = registerForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        fileCallback?.onReceiveValue(uris.toTypedArray())
        fileCallback = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        // Light icons on our ink bars, whatever the phone's light/dark setting.
        enableEdgeToEdge(SystemBarStyle.dark(Color.TRANSPARENT), SystemBarStyle.dark(Color.TRANSPARENT))
        // Android's splash only bridges to our own launch screen, which is drawn in the first frame.
        splash.setKeepOnScreenCondition { false }

        web = WebView(this)
        launch = launchScreen()
        val root = FrameLayout(this).apply {
            setBackgroundColor(INK)
            addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            addView(launch, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }
        setContentView(root)
        // Edge to edge, but the page sits between the bars: WebView does not report env(safe-area-inset-*) on every
        // version, so the bars are padded natively and drawn in ink (the site's insets then read 0, which it handles).
        // WebView ignores its own padding, so the container is padded and the WebView sits inside it.
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            WindowInsetsCompat.CONSUMED
        }

        configure(web)
        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl(startUrl(intent))
        main.postDelayed({ hideLaunch() }, 8_000)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // An App Link while the app runs: open it here (wallet answers go to WalletReturnActivity instead).
        intent.data?.takeIf { isSite(it) }?.let { web.loadUrl(withApp(it).toString()) }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onDestroy() {
        main.removeCallbacksAndMessages(null)
        web.destroy()
        super.onDestroy()
    }

    // ── WebView ──────────────────────────────────────────────────────────────────────────────────────────────

    @SuppressLint("SetJavaScriptEnabled")
    private fun configure(w: WebView) {
        w.setBackgroundColor(INK)
        w.overScrollMode = View.OVER_SCROLL_NEVER
        with(w.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportMultipleWindows(false)
            userAgentString = "$userAgentString MimirApp/${BuildConfig.VERSION_CODE}"
        }
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(w, true)
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_AUTHENTICATION)) {
            WebSettingsCompat.setWebAuthenticationSupport(w.settings, WebSettingsCompat.WEB_AUTHENTICATION_SUPPORT_FOR_APP)
        }
        w.addJavascriptInterface(MimirBridge(this, ::hideLaunch, ::retry), "MimirApp")
        // Before any page script: route blob/data downloads (the recovery file) to the bridge.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(w, DOWNLOAD_SHIM, setOf("https://$HOST"))
        }

        w.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                if (isSite(uri)) return false
                openOutside(uri)
                return true
            }

            override fun onPageFinished(view: WebView, url: String) {
                if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) view.evaluateJavascript(DOWNLOAD_SHIM, null)
                // A page that never calls ready() (an error page, an old deploy) still lets the app in.
                main.postDelayed({ hideLaunch() }, 1_500)
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) showOffline()
            }
        }

        w.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                pickFiles.launch(params.acceptTypes.firstOrNull { it.isNotBlank() } ?: "*/*")
                return true
            }
        }

        // Plain (non-blob) downloads: hand them to the browser's download handling.
        w.setDownloadListener { url, _, _, _, _ ->
            if (url.startsWith("http")) openOutside(Uri.parse(url))
        }
    }

    private fun startUrl(intent: Intent?): String {
        val link = intent?.data?.takeIf { isSite(it) }
        return withApp(link ?: Uri.parse(START_URL)).toString()
    }

    /** ?app=<build> as well as the user agent, for an older site deploy that only reads the query. */
    private fun withApp(uri: Uri): Uri =
        if (uri.getQueryParameter("app") != null) uri
        else uri.buildUpon().appendQueryParameter("app", BuildConfig.VERSION_CODE.toString()).build()

    private fun isSite(uri: Uri) = uri.scheme == "https" && (uri.host == HOST || uri.host == "www.$HOST")

    /** Wallet links open the wallet app; other https links open a Custom Tab in our colours; the rest by intent. */
    private fun openOutside(uri: Uri) {
        val host = uri.host.orEmpty()
        val walletLink = host.endsWith("phantom.app") || host.endsWith("phantom.com") || host.endsWith("solflare.com")
        try {
            if ((uri.scheme == "http" || uri.scheme == "https") && !walletLink) {
                CustomTabsIntent.Builder()
                    .setDefaultColorSchemeParams(CustomTabColorSchemeParams.Builder().setToolbarColor(INK).build())
                    .setShowTitle(true)
                    .build()
                    .launchUrl(this, uri)
            } else {
                startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
            }
        } catch (_: ActivityNotFoundException) {
            // No app for it (e.g. a wallet that is not installed): try the plain browser.
            runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
        }
    }

    // ── launch screen and offline ────────────────────────────────────────────────────────────────────────────

    private fun launchScreen(): View = FrameLayout(this).apply {
        setBackgroundColor(INK)
        addView(
            ImageView(context).apply {
                setImageResource(R.drawable.splash_art)
                scaleType = ImageView.ScaleType.CENTER_INSIDE
            },
            FrameLayout.LayoutParams(dp(300), dp(300), android.view.Gravity.CENTER),
        )
    }

    private fun hideLaunch() {
        if (launchDone) return
        launchDone = true
        launch.animate().alpha(0f).setDuration(220).withEndAction { launch.visibility = View.GONE }.start()
    }

    private fun showOffline() {
        val html = assets.open("offline.html").bufferedReader().use { it.readText() }
            .replace("/app/icon-192.png", "icon-192.png")
            .replace("location.reload()", "MimirApp.retry()")
        web.loadDataWithBaseURL("file:///android_asset/", html, "text/html", "utf-8", null)
        hideLaunch()
    }

    private fun retry() = main.post { web.loadUrl(withApp(Uri.parse(START_URL)).toString()) }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    companion object {
        const val HOST = "mimirmarkets.xyz"
        const val START_URL = "https://$HOST/en/arena"
        val INK = Color.parseColor("#110F0E")

        /** Anchors with `download` and a blob:/data: href (clicked in the page or programmatically) go to the bridge. */
        private val DOWNLOAD_SHIM = """
            (function(){
              if (window.__mimirDl) return; window.__mimirDl = true;
              function grab(a){
                var href = a && a.href || '';
                if (!a || !a.hasAttribute('download') || !(href.indexOf('blob:') === 0 || href.indexOf('data:') === 0)) return false;
                fetch(href).then(function(r){ return r.blob(); }).then(function(b){
                  var fr = new FileReader();
                  fr.onload = function(){ MimirApp.saveFile(a.getAttribute('download') || 'mimir-download', b.type || 'application/octet-stream', String(fr.result).split(',')[1] || ''); };
                  fr.readAsDataURL(b);
                });
                return true;
              }
              var click = HTMLAnchorElement.prototype.click;
              HTMLAnchorElement.prototype.click = function(){ if (!grab(this)) click.call(this); };
              document.addEventListener('click', function(e){
                var a = e.target && e.target.closest && e.target.closest('a[download]');
                if (a && grab(a)) e.preventDefault();
              }, true);
            })();
        """.trimIndent()
    }
}
