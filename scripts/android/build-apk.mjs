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
