// SUPERSEDED by build-webview.mjs (android-app/, a native WebView shell, versionCode 5+). Kept for reference.
// Builds the signed Android APK (and the Play bundle): a Trusted Web Activity around mimirmarkets.xyz.
//
//   cd scripts/android && npm install && npm run build
//
// Needs a JDK 17 and the Android SDK in ~/.bubblewrap/config.json, the dev server on :3123 for the icons
// (twa-manifest.json iconUrl), and the release key at ~/.mimir-android/mimir-release.jks with its password in
// ~/.mimir-android/keystore-password.txt (or KEYSTORE_PASSWORD). Keep that key backed up: every future update and
// the Play listing must be signed with it.
//
// Bump appVersionCode/appVersion in twa-manifest.json for a new build. The script copies the APK to
// public/app/mimir.apk and writes its version, size and SHA-256 into lib/app-release.ts, which the /app page and
// the in-app update strip read.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(HERE, '../..')
const PROJECT = join(HERE, 'android')
const password = process.env.KEYSTORE_PASSWORD ?? readFileSync(join(homedir(), '.mimir-android/keystore-password.txt'), 'utf8').trim()

const manifest = JSON.parse(readFileSync(join(HERE, 'twa-manifest.json'), 'utf8'))
manifest.signingKey.path = manifest.signingKey.path.replace(/^~/, homedir().replace(/\\/g, '/'))
// The app opens the site with its build number, so the site can tell an old APK to update (lib/app-release.ts).
manifest.startUrl = `/en/arena?app=${manifest.appVersionCode}`
mkdirSync(PROJECT, { recursive: true })
writeFileSync(join(PROJECT, 'twa-manifest.json'), JSON.stringify(manifest, null, 2))

const bubblewrap = (...args) =>
  execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['bubblewrap', ...args], {
    cwd: PROJECT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, BUBBLEWRAP_KEYSTORE_PASSWORD: password, BUBBLEWRAP_KEY_PASSWORD: password },
  })

// Regenerate the Android project from the manifest, build it with Gradle, then align and sign it ourselves
// (`bubblewrap build` runs the same Gradle task but fails on this machine's SDK layout).
const win = process.platform === 'win32'
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', shell: win, ...opts })
// A running Gradle daemon keeps the old build's files locked, and `update` rewrites the project.
if (existsSync(join(PROJECT, 'gradlew.bat'))) run(join(PROJECT, win ? 'gradlew.bat' : 'gradlew'), ['--stop'], { cwd: PROJECT })
bubblewrap('update', '--skipVersionUpgrade', '--manifest=./twa-manifest.json')
// Our launch screen (brand/source/splash.html, rendered per density into ./splash) instead of the icon blown up.
for (const d of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
  copyFileSync(join(HERE, 'splash', `splash-${d}.png`), join(PROJECT, 'app/src/main/res', `drawable-${d}`, 'splash.png'))
}
patchWalletReturn()
run(join(PROJECT, win ? 'gradlew.bat' : 'gradlew'), ['assembleRelease', '--no-daemon'], { cwd: PROJECT })

const sdk = JSON.parse(readFileSync(join(homedir(), '.bubblewrap/config.json'), 'utf8')).androidSdkPath
const buildTools = join(sdk, 'build-tools', readdirSync(join(sdk, 'build-tools')).sort().at(-1))
const unsigned = join(PROJECT, 'app/build/outputs/apk/release/app-release-unsigned.apk')
const aligned = join(PROJECT, 'app-release-aligned.apk')
const apk = join(PROJECT, 'app-release-signed.apk')
run(join(buildTools, win ? 'zipalign.exe' : 'zipalign'), ['-f', '-p', '4', unsigned, aligned])
run(join(buildTools, win ? 'apksigner.bat' : 'apksigner'), [
  'sign', '--ks', manifest.signingKey.path, '--ks-key-alias', manifest.signingKey.alias,
  '--ks-pass', 'env:KS_PASS', '--key-pass', 'env:KS_PASS', '--out', apk, aligned,
], { env: { ...process.env, KS_PASS: password } })
run(join(buildTools, win ? 'apksigner.bat' : 'apksigner'), ['verify', '--print-certs', apk])
const out = join(ROOT, 'public/app/mimir.apk')
copyFileSync(apk, out)
const bytes = readFileSync(out)
const release = {
  versionCode: manifest.appVersionCode,
  versionName: manifest.appVersion,
  sizeBytes: statSync(out).size,
  sha256: createHash('sha256').update(bytes).digest('hex'),
}

const file = join(ROOT, 'lib/app-release.ts')
let src = readFileSync(file, 'utf8')
src = src
  .replace(/versionCode: \d+,/, `versionCode: ${release.versionCode},`)
  .replace(/versionName: "[^"]*",/, `versionName: "${release.versionName}",`)
  .replace(/sizeBytes: \d+,/, `sizeBytes: ${release.sizeBytes},`)
  .replace(/sha256: "[^"]*",/, `sha256: "${release.sha256}",`)
writeFileSync(file, src)
console.log('built', release)

/**
 * Phantom and Solflare answer a request by opening https://<host>/api/wallet-return?op=… (lib/solana/deeplink-adapter.ts).
 * The app owns that host (App Links), so the answer lands here, not in the page. Left alone, the launcher would load
 * that URL in the app and reload the page that is waiting for it. Instead the launcher forwards the link to the
 * server (which parks the answer, lib/server/wallet-relay.ts) and closes: the app's page comes back to the front,
 * untouched, and collects the answer from the relay. `bubblewrap update` regenerates both files, so this runs
 * after every update.
 */
function patchWalletReturn() {
  const activity = join(PROJECT, 'app/src/main/java', ...manifest.packageId.split('.'), 'LauncherActivity.java')
  let java = readFileSync(activity, 'utf8')
  if (!java.includes('isWalletReturn')) {
    java = java.replace(
      'import android.os.Bundle;',
      ['import android.os.Bundle;', 'import java.net.HttpURLConnection;', 'import java.net.URL;'].join('\n'),
    )
    const hooks = `
    /** A wallet's answer (Phantom / Solflare deeplink), not a page to open. */
    private boolean isWalletReturn() {
        Uri uri = getIntent() == null ? null : getIntent().getData();
        return uri != null && "/api/wallet-return".equals(uri.getPath());
    }

    @Override
    protected boolean shouldLaunchImmediately() {
        return !isWalletReturn();
    }

    /** Hands the answer to the server, off the main thread; the waiting page polls for it. */
    private void relayWalletReturn(final Uri uri) {
        new Thread(() -> {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(uri.toString()).openConnection();
                c.setConnectTimeout(15000);
                c.setReadTimeout(15000);
                c.getResponseCode();
            } catch (Exception ignored) {
                // The page times out and says so; nothing to recover here.
            } finally {
                if (c != null) c.disconnect();
            }
        }).start();
    }
`
    java = java.replace(
      /(protected void onCreate\(Bundle savedInstanceState\) \{\s*super\.onCreate\(savedInstanceState\);)/,
      `$1
        if (isWalletReturn() && !isFinishing()) {
            relayWalletReturn(getIntent().getData());
            finish();
            return;
        }`,
    )
    java = java.replace(/(\n    @Override\s*\n    protected Uri getLaunchingUrl\(\))/, `${hooks}$1`)
    if (!java.includes('relayWalletReturn(getIntent().getData())') || !java.includes('shouldLaunchImmediately')) throw new Error('LauncherActivity patch did not apply')
    writeFileSync(activity, java)
  }
  const androidManifest = join(PROJECT, 'app/src/main/AndroidManifest.xml')
  let xml = readFileSync(androidManifest, 'utf8')
  if (!xml.includes('android.permission.INTERNET')) {
    xml = xml.replace(/(<manifest[^>]*>)/, '$1\n    <uses-permission android:name="android.permission.INTERNET" />')
    if (!xml.includes('android.permission.INTERNET')) throw new Error('AndroidManifest patch did not apply')
    writeFileSync(androidManifest, xml)
  }
}
