import "./globals.css";
import type { Viewport } from "next";
import { fontVariables } from "@/lib/fonts";
import { SolanaWalletProviders } from "@/lib/solana/wallet-providers";
import MotionProvider from "@/components/motion/MotionProvider";
import { Toaster } from "sonner";
import { Analytics } from "@vercel/analytics/next";

// Dark only: the site's colour scheme and theme colour. viewport-fit=cover lets the safe-area insets (notch,
// home bar) reach CSS, which the nav, the bottom tab bar and the sheets pad with.
export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#110f0e",
  viewportFit: "cover",
};

// `js` lets CSS hide pre-animation states only when scripts run; the 3s
// `motion-timeout` class is a failsafe that shows them if hydration stalls.
// `lite` marks low-power devices (4 cores or fewer, 4GB or less, Save-Data):
// smooth scroll, the hero field and the frosted nav step down there
// (lib/motion.ts `isLite`).
// `data-app` marks the installed app (the Android app's WebView adds " MimirApp/<build>" to its user agent; the old TWA
// opened the site with ?app=<build>; or the site was added to
// the home screen); it is kept per tab in sessionStorage because the APK shares Chrome's storage, so a plain
// Chrome tab never inherits it. In the app the landing page is skipped: `/` goes straight to the Arena before
// anything paints (components/app/AppBanners.tsx handles the rest).
const HEAD_SCRIPT = `(function(){var d=document.documentElement,n=navigator,c=n.connection;d.classList.add('js');if((n.hardwareConcurrency||8)<=4||(n.deviceMemory||8)<=4||(c&&c.saveData))d.classList.add('lite');setTimeout(function(){d.classList.add('motion-timeout')},3000);try{var s=sessionStorage,q=new URLSearchParams(location.search).get('app');if(q&&/^\\d+$/.test(q))s.setItem('mimir-app-build',q);if(s.getItem('mimir-app-build')||/ MimirApp\/\d+/.test(n.userAgent)||matchMedia('(display-mode: standalone)').matches||document.referrer.indexOf('android-app://xyz.mimirmarkets.app')===0){s.setItem('mimir-app','1')}if(s.getItem('mimir-app')){d.setAttribute('data-app','');var m=location.pathname.match(/^\\/([a-z]{2})?\\/?$/);if(m)location.replace('/'+(m[1]||'en')+'/arena')}}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html suppressHydrationWarning className={fontVariables}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: HEAD_SCRIPT }} />
      </head>
      <body>
        <div className="wall" aria-hidden />
        <MotionProvider>
          <SolanaWalletProviders>
            {children}
            <Toaster
              position="bottom-center"
              toastOptions={{
                style: {
                  background: "rgb(16 10 11 / 0.96)",
                  border: "0",
                  boxShadow: "inset 0 1px 0 rgb(255 255 255 / .045), 0 28px 90px rgb(0 0 0 / .62)",
                  color: "var(--cream)",
                  borderRadius: 22,
                  fontFamily: "var(--pixel)",
                },
              }}
            />
          </SolanaWalletProviders>
        </MotionProvider>
        {/* /_vercel/insights only exists on Vercel; elsewhere (Railway, CI) the script 404s. */}
        {process.env.VERCEL === "1" && <Analytics />}
      </body>
    </html>
  );
}
