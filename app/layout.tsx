import "./globals.css";
import type { Viewport } from "next";
import { fontVariables } from "@/lib/fonts";
import { SolanaWalletProviders } from "@/lib/solana/wallet-providers";
import MotionProvider from "@/components/motion/MotionProvider";
import { Toaster } from "sonner";
import NextTopLoader from "nextjs-toploader";

// Dark only (docs/REDESIGN.md 1): radio's colour scheme and theme colour.
export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#110f0e",
};

// `js` lets CSS hide pre-animation states only when scripts run; the 3s
// `motion-timeout` class is a failsafe that shows them if hydration stalls.
const HEAD_SCRIPT = `(function(){var d=document.documentElement;d.classList.add('js');setTimeout(function(){d.classList.add('motion-timeout')},3000);})();`;

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
        <NextTopLoader color="#ff5148" height={2} showSpinner={false} shadow={false} />
        <MotionProvider>
          <SolanaWalletProviders>
            {children}
            <Toaster
              position="bottom-center"
              toastOptions={{
                style: {
                  background: "rgb(14 7 9 / 0.91)",
                  backdropFilter: "blur(7px) saturate(108%)",
                  WebkitBackdropFilter: "blur(7px) saturate(108%)",
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
