import "./globals.css";
import type { Viewport } from "next";
import { fontVariables } from "@/lib/fonts";
import { SolanaWalletProviders } from "@/lib/solana/wallet-providers";
import MotionProvider from "@/components/motion/MotionProvider";
import { Toaster } from "sonner";

// Dark only: the site's colour scheme and theme colour.
export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#110f0e",
};

// `js` lets CSS hide pre-animation states only when scripts run; the 3s
// `motion-timeout` class is a failsafe that shows them if hydration stalls.
// `lite` marks low-power devices (4 cores or fewer, 4GB or less, Save-Data):
// smooth scroll, the hero field and the frosted nav step down there
// (lib/motion.ts `isLite`).
const HEAD_SCRIPT = `(function(){var d=document.documentElement,n=navigator,c=n.connection;d.classList.add('js');if((n.hardwareConcurrency||8)<=4||(n.deviceMemory||8)<=4||(c&&c.saveData))d.classList.add('lite');setTimeout(function(){d.classList.add('motion-timeout')},3000);})();`;

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
      </body>
    </html>
  );
}
