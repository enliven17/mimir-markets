/**
 * The Android app: a Trusted Web Activity around this site (scripts/android/build-apk.mjs writes these values on
 * every build). Only the shell lives in the APK, so a site deploy updates the app; a new APK is needed only when
 * the shell changes (name, icon, splash, package settings), and then the in-app banner offers it.
 */
export const APP_RELEASE = {
  packageId: "xyz.mimirmarkets.app",
  versionCode: 5,
  versionName: "2.0.0",
  /** Served from /public, so the download is the site's own. */
  apkPath: "/app/mimir.apk",
  sizeBytes: 1142435,
  sha256: "ecfef935d42bf4e761b92db4d926e05559823e3d2e6d91a4d54d53650d5bac80",
} as const;

/** The APK launches the site with ?app=<versionCode>, so the site knows it runs inside the app and which build. */
export const APP_VERSION_PARAM = "app";
export const appReleased = () => APP_RELEASE.versionCode > 0;
