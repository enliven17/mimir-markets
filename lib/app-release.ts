/**
 * The Android app: a Trusted Web Activity around this site (scripts/android/build-apk.mjs writes these values on
 * every build). Only the shell lives in the APK, so a site deploy updates the app; a new APK is needed only when
 * the shell changes (name, icon, splash, package settings), and then the in-app banner offers it.
 */
export const APP_RELEASE = {
  packageId: "xyz.mimirmarkets.app",
  versionCode: 6,
  versionName: "2.1.0",
  /** Served from /public, so the download is the site's own. */
  apkPath: "/app/mimir.apk",
  sizeBytes: 1152896,
  sha256: "224de113d307942b8906d8737755364e25788f70fca0e327a62795ab8520edf0",
} as const;

/** The APK launches the site with ?app=<versionCode>, so the site knows it runs inside the app and which build. */
export const APP_VERSION_PARAM = "app";
export const appReleased = () => APP_RELEASE.versionCode > 0;
