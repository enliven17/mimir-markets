import type { Metadata } from "next";

import { SURFACE } from "@/components/arena/surface";
import { APP_RELEASE, appReleased } from "@/lib/app-release";

/* /app: the Android app (a Trusted Web Activity around this site, lib/app-release.ts). A QR code for desktop
 * visitors, a direct download on phones, and the iPhone route (add to home screen). The APK is served from this
 * site, so the download and its checksum come from the same place as the app's content. */

export const metadata: Metadata = {
  title: "Mobile app · Mimir",
  description: "Mimir on Android: the full app, with passkeys and your Solana wallet. Download the APK or scan the QR code.",
};

const STEP = "grid grid-cols-[28px_minmax(0,1fr)] gap-3 text-[14px] leading-relaxed text-muted";
const NUM = "grid h-7 w-7 place-items-center rounded-full bg-cream/[0.07] font-mono text-[12px] text-cream";

function mb(bytes: number) {
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export default function AppPage() {
  const ready = appReleased();
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-12">
      <section className="grid gap-6">
        <header className="grid gap-3">
          <p className="m-0 font-mono text-[12px] uppercase tracking-[0.2em] text-coral">Mobile</p>
          <h1 className="m-0 font-display text-app-h1 text-cream">Mimir in your pocket.</h1>
          <p className="m-0 max-w-[560px] text-[15px] leading-relaxed text-muted">
            The full app on Android: open markets, stake, follow your positions and get paid, with your passkey and your
            Solana wallet. It is the same Mimir as this site, so every update reaches the app the moment it ships.
          </p>
        </header>

        <div className={`${SURFACE} grid gap-5 p-5 sm:p-6`}>
          {ready ? (
            <>
              <div className="flex flex-wrap items-center gap-4">
                <a
                  href={APP_RELEASE.apkPath}
                  download
                  className="rounded-full bg-coral px-6 py-3 text-[15px] font-medium text-[#160909] hover:brightness-110"
                >
                  Download for Android
                </a>
                <span className="font-mono text-[12px] text-muted">
                  v{APP_RELEASE.versionName} · {mb(APP_RELEASE.sizeBytes)}
                </span>
              </div>
              <ol className="m-0 grid list-none gap-3 p-0">
                <li className={STEP}>
                  <span className={NUM}>1</span>
                  <span>Download the APK on your Android phone (or scan the code on the right from your computer).</span>
                </li>
                <li className={STEP}>
                  <span className={NUM}>2</span>
                  <span>Open it. Android asks once to allow installs from your browser: allow it for this install.</span>
                </li>
                <li className={STEP}>
                  <span className={NUM}>3</span>
                  <span>Open Mimir from your home screen, connect your Solana wallet and create your passkey account.</span>
                </li>
              </ol>
              <p className="m-0 break-all font-mono text-[11px] leading-relaxed text-dim">SHA-256 {APP_RELEASE.sha256}</p>
            </>
          ) : (
            <p className="m-0 text-[14px] text-muted">The Android app is on its way. Until then, add Mimir to your home screen (below).</p>
          )}
        </div>

        <div className={`${SURFACE} grid gap-3 p-5 sm:p-6`}>
          <h2 className="m-0 text-[15px] text-cream">iPhone, or without the APK</h2>
          <p className="m-0 text-[14px] leading-relaxed text-muted">
            Open mimirmarkets.xyz in Safari (Chrome on Android), tap Share, then <span className="text-cream">Add to Home Screen</span>. Mimir opens
            full screen with its own icon, like an app.
          </p>
        </div>

        <p className="m-0 text-[13px] leading-relaxed text-dim">
          Google Play is next. Updates to the app arrive with the site; when the app itself needs a new build, it tells you and
          the new APK installs over the old one, keeping your account.
        </p>
      </section>

      <aside className={`${SURFACE} hidden gap-4 p-6 lg:grid`} aria-label="Scan to download">
        {/* The QR code (public/app/qr.svg) opens this page on the phone, where the download button is. */}
        <img src="/app/qr.svg" alt="QR code for mimirmarkets.xyz/app" width={292} height={292} className="w-full rounded-xl" />
        <p className="m-0 text-center font-mono text-[12px] uppercase tracking-[0.2em] text-muted">Scan with your phone</p>
      </aside>
    </div>
  );
}
