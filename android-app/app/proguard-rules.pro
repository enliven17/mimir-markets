# The page calls these through window.MimirApp; keep them for R8.
-keepclassmembers class xyz.mimirmarkets.app.MimirBridge {
    @android.webkit.JavascriptInterface <methods>;
}
