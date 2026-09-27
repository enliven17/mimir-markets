import "./globals.css";
import { fontDisplay, fontBody, fontMono } from "@/lib/fonts";
import { SolanaWalletProviders } from "@/lib/solana/wallet-providers";
import { Toaster } from "sonner";
import NextTopLoader from "nextjs-toploader";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      suppressHydrationWarning
      className={`${fontDisplay.variable} ${fontBody.variable} ${fontMono.variable}`}
    >
      <head>
        {/* Set the theme before paint to avoid a flash of the wrong palette. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(localStorage.getItem('mimir-theme')!=='light')document.documentElement.classList.add('dark');}catch(e){document.documentElement.classList.add('dark');}})();`,
          }}
        />
      </head>
      <body className="overflow-x-hidden">
        <NextTopLoader
          color="#9945FF"
          height={2}
          showSpinner={false}
          shadow={false}
        />
        <SolanaWalletProviders>
          {children}
          <Toaster
            position="bottom-center"
            toastOptions={{
              // Theme tokens, so toasts follow the light/dark toggle.
              style: {
                background: "rgb(var(--pv-surface))",
                border: "1px solid rgb(var(--pv-border) / 0.25)",
                color: "rgb(var(--pv-text))",
                borderRadius: 0,
                fontFamily: "var(--font-body)",
              },
            }}
          />
        </SolanaWalletProviders>
      </body>
    </html>
  );
}
