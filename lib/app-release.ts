/**
 * The Android app: a Trusted Web Activity around this site (scripts/android/build-apk.mjs writes these values on
 * every build). Only the shell lives in the APK, so a site deploy updates the app; a new APK is needed only when
 * the shell changes (name, icon, splash, package settings), and then the in-app banner offers it.
 */
export const APP_RELEASE = {
  packageId: "xyz.mimirmarkets.app",
  versionCode: 4,
  versionName: "1.2.0",
  /** Served from /public, so the download is the site's own. */
  apkPath: "/app/mimir.apk",
  sizeBytes: 1167471,
  sha256: "7da0a3925341f7f2a80ba5bb7d443db31ed6033d53a75b2993316b9f7c4f37f7",
} as const;

/** The APK launches the site with ?app=<versionCode>, so the site knows it runs inside the app and which build. */
export const APP_VERSION_PARAM = "app";
export const appReleased = () => APP_RELEASE.versionCode > 0;
