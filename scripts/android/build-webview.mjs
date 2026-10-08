// Builds the signed Android app (android-app/: Mimir's own WebView shell) as an APK for the site and an AAB for
// Google Play. It supersedes the Trusted Web Activity built by build-apk.mjs (kept for reference).
//
//   node scripts/android/build-webview.mjs
//
// Needs JDK 17 (JAVA_HOME, else the Adoptium path below), the Android SDK (android-app/local.properties) and the
// release key at ~/.mimir-android/mimir-release.jks with its password in ~/.mimir-android/keystore-password.txt
// (or KEYSTORE_PASSWORD): the same key as the TWA builds, so this installs over them. Bump versionCode/versionName
// in android-app/app/build.gradle.kts for a new build. The APK goes to public/app/mimir.apk, and its version, size
// and SHA-256 into lib/app-release.ts (the /app page and the in-app update strip read it).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const PROJECT = join(ROOT, 'android-app')
const KEYSTORE = join(homedir(), '.mimir-android/mimir-release.jks')
// Prefer KEYSTORE_PASSWORD (e.g. from a password manager); the plain-text file next to the keystore still works but
// anyone who copies that folder gets both the key and its password.
const passwordFile = join(homedir(), '.mimir-android/keystore-password.txt')
const password = process.env.KEYSTORE_PASSWORD ?? readFileSync(passwordFile, 'utf8').trim()
if (!process.env.KEYSTORE_PASSWORD) {
  console.warn(`warning: the keystore password was read from ${passwordFile}. Move it to a password manager and pass KEYSTORE_PASSWORD instead.`)
}
const win = process.platform === 'win32'
const JAVA_HOME = process.env.JAVA_HOME ?? 'C:/Program Files/Eclipse Adoptium/jdk-17.0.19.10-hotspot'

const gradle = join(PROJECT, win ? 'gradlew.bat' : 'gradlew')
execFileSync(gradle, ['assembleRelease', 'bundleRelease', '--no-daemon'], {
  cwd: PROJECT,
  stdio: 'inherit',
  shell: win,
  env: { ...process.env, JAVA_HOME, MIMIR_KEYSTORE: KEYSTORE, MIMIR_KEYSTORE_PASSWORD: password },
})

const apk = join(PROJECT, 'app/build/outputs/apk/release/app-release.apk')
const aab = join(PROJECT, 'app/build/outputs/bundle/release/app-release.aab')
if (!existsSync(apk)) throw new Error('no signed APK: is the keystore readable?')

// Same signer as before, or Android refuses the update.
const sdk = readFileSync(join(PROJECT, 'local.properties'), 'utf8').match(/sdk\.dir=(.*)/)[1].replace(/\\:/g, ':').trim()
const buildTools = join(sdk, 'build-tools', readdirSync(join(sdk, 'build-tools')).sort().at(-1))
execFileSync(join(buildTools, win ? 'apksigner.bat' : 'apksigner'), ['verify', '--print-certs', apk], { stdio: 'inherit', shell: win, env: { ...process.env, JAVA_HOME } })

const gradleFile = readFileSync(join(PROJECT, 'app/build.gradle.kts'), 'utf8')
const versionCode = Number(gradleFile.match(/versionCode = (\d+)/)[1])
const versionName = gradleFile.match(/versionName = "([^"]+)"/)[1]

const out = join(ROOT, 'public/app/mimir.apk')
copyFileSync(apk, out)
const desktop = join(homedir(), 'Desktop/mimir.apk')
if (existsSync(join(homedir(), 'Desktop'))) copyFileSync(apk, desktop)
const release = { versionCode, versionName, sizeBytes: statSync(out).size, sha256: createHash('sha256').update(readFileSync(out)).digest('hex') }

const file = join(ROOT, 'lib/app-release.ts')
writeFileSync(
  file,
  readFileSync(file, 'utf8')
    .replace(/versionCode: \d+,/, `versionCode: ${release.versionCode},`)
    .replace(/versionName: "[^"]*",/, `versionName: "${release.versionName}",`)
    .replace(/sizeBytes: \d+,/, `sizeBytes: ${release.sizeBytes},`)
    .replace(/sha256: "[^"]*",/, `sha256: "${release.sha256}",`),
)
console.log('built', release, '\nplay bundle:', existsSync(aab) ? aab : '(none)')
