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
import android.widget.TextView
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
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewFeature

/**
 * Mimir Markets as an app: one WebView on the site, no browser UI. The site runs in app mode (the user agent ends in
 * " MimirApp/<versionCode>"; app/layout.tsx and components/app/AppBanners.tsx read it).
 *
 * - Edge to edge: the page draws behind the status and navigation bars (they are transparent, icons light) and pads
 *   itself; the bars' heights reach it as --app-inset-top/--app-inset-bottom (WebView may report env() as 0).
 * - Pull down at the top of the page to reload (SwipeRefreshLayout; off while a sheet is open in the page).
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
    private lateinit var refresh: SwipeRefreshLayout
    private lateinit var updater: Updater
    /** The system bars in CSS px (the page's own units), kept for the head script and pushed on change. */
    @Volatile private var insetTop = 0
    @Volatile private var insetBottom = 0
    private var refreshAllowed = true
    private val main = Handler(Looper.getMainLooper())
    private var launchDone = false
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private lateinit var bridge: MimirBridge
    /** The registered window.MimirApp shim (re-registered when the insets change, so the next page reads them). */
    private var shimHandle: ScriptHandler? = null
    private var listenerBridge = false

    private val pickFiles = registerForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        fileCallback?.onReceiveValue(uris.toTypedArray())
        fileCallback = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        // Light icons on our ink bars, whatever the phone's light/dark setting.
        enableEdgeToEdge(SystemBarStyle.dark(Color.TRANSPARENT), SystemBarStyle.dark(Color.TRANSPARENT))
        // No grey scrim behind 3-button navigation: the page's own ink shows through.
        if (android.os.Build.VERSION.SDK_INT >= 29) window.isNavigationBarContrastEnforced = false
        // Android's splash only bridges to our own launch screen, which is drawn in the first frame.
        splash.setKeepOnScreenCondition { false }

        web = WebView(this)
        launch = launchScreen()
        // Pull to refresh, natively: a drag down only counts when the page is at its top and no sheet is open.
        refresh = SwipeRefreshLayout(this).apply {
            setColorSchemeColors(CORAL)
            setProgressBackgroundColorSchemeColor(PANEL)
            setOnChildScrollUpCallback { _, _ -> !refreshAllowed || web.scrollY > 0 }
            setOnRefreshListener { web.reload() }
            addView(web, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }
        val pill = updatePill()
        updater = Updater(this, pill)
        val root = FrameLayout(this).apply {
            setBackgroundColor(INK)
            addView(refresh, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            addView(launch, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            addView(pill, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, android.view.Gravity.TOP or android.view.Gravity.CENTER_HORIZONTAL))
        }
        setContentView(root)
        // Edge to edge: the page draws behind the transparent status and navigation bars and pads itself (its app
        // bar and tab bar), using the heights handed in as CSS variables. Only the side insets (cutouts in
        // landscape) and the keyboard are padded natively.
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, 0, bars.right, ime.bottom)
            insetTop = px(bars.top)
            insetBottom = if (ime.bottom > 0) 0 else px(bars.bottom)
            pushInsets()
            registerShim()
            refresh.setProgressViewOffset(false, bars.top, bars.top + dp(64))
            (pill.layoutParams as FrameLayout.LayoutParams).topMargin = bars.top + dp(64)
            pill.requestLayout()
            WindowInsetsCompat.CONSUMED
        }

        configure(web)
        // A recreated activity restores its page; if there is nothing to restore (the system recreated us before the
        // first page committed, e.g. a theme overlay change on launch) load the start page instead of staying blank.
        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) web.loadUrl(startUrl(intent))
        main.postDelayed({ hideLaunch() }, 8_000)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // An App Link while the app runs: open it here (wallet answers go to WalletReturnActivity instead). Only
        // pages: a file or an API URL handed back by a browser would bounce between us and it.
        val uri = intent.data?.takeIf { isSite(it) } ?: return
        if (Updater.isOurApk(uri)) updater.start(uri.toString()) else if (isPage(uri)) web.loadUrl(withApp(uri).toString())
    }

    override fun onResume() {
        super.onResume()
        updater.resume()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onDestroy() {
        updater.release()
        main.removeCallbacksAndMessages(null)
        web.destroy()
        super.onDestroy()
    }

    // ── WebView ──────────────────────────────────────────────────────────────────────────────────────────────

    @SuppressLint("SetJavaScriptEnabled")
    private fun configure(w: WebView) {
        w.setBackgroundColor(INK)
        w.overScrollMode = View.OVER_SCROLL_NEVER
        // An app, not a page: no scrollbars on the edge.
        w.isVerticalScrollBarEnabled = false
        w.isHorizontalScrollBarEnabled = false
        with(w.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            // Only the web: no file:// or content:// from pages (the offline page is an asset, which these don't cover).
            allowFileAccess = false
            allowContentAccess = false
            @Suppress("DEPRECATION") allowFileAccessFromFileURLs = false
            @Suppress("DEPRECATION") allowUniversalAccessFromFileURLs = false
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
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SAFE_BROWSING_ENABLE)) {
            WebSettingsCompat.setSafeBrowsingEnabled(w.settings, true)
        }
        bridge = MimirBridge(
            this,
            onReady = ::hideLaunch,
            onRetry = ::retry,
            onRefreshAllowed = { refreshAllowed = it },
            onUpdate = { url -> Uri.parse(url).takeIf { Updater.isOurApk(it) }?.let { updater.start(it.toString()) } },
            insets = ::insetsJson,
        )
        // window.MimirApp exists only on https://mimirmarkets.xyz: a message port plus a document-start shim, and every
        // message is checked again (main frame, our origin). Older WebViews: a JS interface refused off our site.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) && WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            listenerBridge = true
            WebViewCompat.addWebMessageListener(w, "MimirAppPort", setOf(ORIGIN)) { _, message, sourceOrigin, isMainFrame, _ ->
                if (isMainFrame && sourceOrigin.toString().trimEnd('/') == ORIGIN) message.data?.let { bridge.dispatch(it) }
            }
            registerShim()
        } else {
            w.addJavascriptInterface(bridge.Legacy(), "MimirApp")
        }
        // Before any page script: route blob/data downloads (the recovery file) to the bridge.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(w, DOWNLOAD_SHIM, setOf("https://$HOST"))
        }

        w.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                // The offline page's Try again (it is an asset, off our origin, so it has no bridge).
                if (uri.scheme == "mimirapp") {
                    if (uri.host == "retry") retry()
                    return true
                }
                if (isSite(uri)) return false
                openOutside(uri)
                return true
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                bridge.originOk = url?.let { isSite(Uri.parse(it)) } == true
            }

            override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
                bridge.originOk = url?.let { isSite(Uri.parse(it)) } == true
            }

            override fun onPageFinished(view: WebView, url: String) {
                refresh.isRefreshing = false
                refreshAllowed = true
                pushInsets()
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

        // Our APK is the in-app update. Other files from our own site never go to a browser (it hands our verified
        // link straight back to the app, in a loop that kept reopening the app); files from elsewhere still do.
        w.setDownloadListener { url, _, _, _, _ ->
            val uri = Uri.parse(url)
            when {
                Updater.isOurApk(uri) -> updater.start(url)
                isSite(uri) -> Unit
                url.startsWith("http") -> openOutside(uri)
            }
        }
    }

    private fun startUrl(intent: Intent?): String {
        val link = intent?.data?.takeIf { isSite(it) && isPage(it) }
        return withApp(link ?: Uri.parse(START_URL)).toString()
    }

    /** ?app=<build> as well as the user agent, for an older site deploy that only reads the query. */
    private fun withApp(uri: Uri): Uri =
        if (uri.getQueryParameter("app") != null) uri
        else uri.buildUpon().appendQueryParameter("app", BuildConfig.VERSION_CODE.toString()).build()

    private fun isSite(uri: Uri) = uri.scheme == "https" && (uri.host == HOST || uri.host == "www.$HOST")

    /** A page of the site, not a file or an API call. */
    private fun isPage(uri: Uri): Boolean {
        val path = uri.path.orEmpty()
        return !path.startsWith("/api/") && !FILE_PATH.containsMatchIn(path)
    }

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

    /** The update's progress, a small pill under the status bar (Updater.kt). */
    private fun updatePill(): TextView = TextView(this).apply {
        setTextColor(Color.parseColor("#F3EAD6"))
        textSize = 13f
        setPadding(dp(14), dp(8), dp(14), dp(8))
        background = android.graphics.drawable.GradientDrawable().apply {
            cornerRadius = dp(20).toFloat()
            setColor(PANEL)
        }
        alpha = 0f
        elevation = dp(6).toFloat()
    }

    private fun hideLaunch() {
        if (launchDone) return
        launchDone = true
        launch.animate().alpha(0f).setDuration(220).withEndAction { launch.visibility = View.GONE }.start()
    }

    private fun showOffline() {
        val html = assets.open("offline.html").bufferedReader().use { it.readText() }
            .replace("/app/icon-192.png", "icon-192.png")
            .replace("location.reload()", "location.href='mimirapp://retry'")
        web.loadDataWithBaseURL("file:///android_asset/", html, "text/html", "utf-8", null)
        hideLaunch()
    }

    /** The bars' heights as CSS variables on the page (also read synchronously by the head script on load). */
    private fun pushInsets() {
        if (!::web.isInitialized) return
        web.evaluateJavascript(
            "(function(s){s.setProperty('--app-inset-top','${insetTop}px');s.setProperty('--app-inset-bottom','${insetBottom}px')})(document.documentElement.style)",
            null,
        )
    }

    private fun insetsJson() = """{"top":$insetTop,"bottom":$insetBottom}"""

    /** (Re)register the window.MimirApp shim with the current insets: the head script reads them synchronously. */
    private fun registerShim() {
        if (!listenerBridge || !::web.isInitialized) return
        shimHandle?.remove()
        shimHandle = WebViewCompat.addDocumentStartJavaScript(web, MimirBridge.shim(insetsJson()), setOf(ORIGIN))
    }

    private fun px(raw: Int) = Math.round(raw / resources.displayMetrics.density)

    private fun retry() = main.post { web.loadUrl(withApp(Uri.parse(START_URL)).toString()) }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    companion object {
        const val HOST = "mimirmarkets.xyz"
        const val START_URL = "https://$HOST/en/arena"
        const val ORIGIN = "https://$HOST"
        val INK = Color.parseColor("#110F0E")
        val CORAL = Color.parseColor("#FF5148")
        val PANEL = Color.parseColor("#1C1817")
        private val FILE_PATH = Regex("\\.[a-z0-9]{2,5}$", RegexOption.IGNORE_CASE)

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
