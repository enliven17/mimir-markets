/**
 * The Android app: a Trusted Web Activity around this site (scripts/android/build-apk.mjs writes these values on
 * every build). Only the shell lives in the APK, so a site deploy updates the app; a new APK is needed only when
 * the shell changes (name, icon, splash, package settings), and then the in-app banner offers it.
 */
export const APP_RELEASE = {
  packageId: "xyz.mimirmarkets.app",
  versionCode: 10,
  versionName: "2.4.0",
  /** Served from /public, so the download is the site's own. */
  apkPath: "/app/mimir.apk",
  sizeBytes: 1168436,
  sha256: "9dc2beb5e95fb9525fe718443d2edd58c68f25fd551cc8e881c21ee34c618631",
} as const;

/** The APK launches the site with ?app=<versionCode>, so the site knows it runs inside the app and which build. */
export const APP_VERSION_PARAM = "app";
export const appReleased = () => APP_RELEASE.versionCode > 0;
