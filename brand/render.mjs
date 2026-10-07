// npm run render → x-profile.png (800×800) and x-banner.png (3000×1000), both at 2× for crisp uploads.
// Uses the installed Edge (or CHROME_PATH). Sources are plain HTML in source/, so they can be opened and edited directly.
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const root = fileURLToPath(new URL('./source/', import.meta.url))
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' }
// ES modules need http, not file://, so the sources are served locally for the capture.
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname
  const body = await readFile(join(root, decodeURIComponent(path))).catch(() => null)
  if (!body) return res.writeHead(404).end()
  res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }).end(body)
}).listen(0)
const port = server.address().port

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
})
for (const [page, out, w, h] of [
  ['profile.html', 'x-profile.png', 400, 400],
  ['banner.html', 'x-banner.png', 1500, 500],
  // the site's tab icon and iOS home-screen icon (a PNG: the horn SVG is ~300KB)
  ['icon.html', '../app/icon.png', 128, 128],
  ['icon.html?flat', '../app/apple-icon.png', 90, 90],
  ['roadmap.html', 'roadmap.png', 1920, 1080],
  ['community.html', 'community.png', 1080, 1080],
  ['holders.html', 'holders.png', 1600, 900],
  ['networks.html', 'networks.png', 1600, 900],
  ['roadmap-october.html', 'roadmap-october.png', 1920, 1080],
  ['passkey.html', 'passkey.png', 1600, 900],
  ['members100.html', 'members100.png', 1080, 1080],
  ['burn.html', 'burn.png', 1080, 1080],
  ['article-system.html', 'article-system.png', 1600, 900],
  ['article-lifecycle.html', 'article-lifecycle.png', 1600, 900],
  ['article-oracle.html', 'article-oracle.png', 1600, 900],
  ['article-fees.html', 'article-fees.png', 1600, 900],
  ['article-cover.html', 'article-cover.png', 1600, 640],
  // The brand kit: three sheets and transparent logo PNGs (512x512 at 2x).
  ['kit-logo.html', 'kit/mimir-kit-logo.png', 1600, 900],
  ['kit-color.html', 'kit/mimir-kit-colour.png', 1600, 900],
  ['kit-type.html', 'kit/mimir-kit-type.png', 1600, 900],
  ['kit-logo-export.html?horn', 'kit/logo/mimir-horn.png', 512, 512],
  ['kit-logo-export.html?horn-red', 'kit/logo/mimir-horn-red.png', 512, 512],
  ['kit-logo-export.html?mark', 'kit/logo/mimir-mark.png', 512, 512],
  ['kit-logo-export.html?mark-mono-ink', 'kit/logo/mimir-mark-ink.png', 512, 512],
  // `node render.mjs roadmap` renders only the pages whose name contains the argument.
].filter(([page]) => page.includes(process.argv[2] ?? ''))) {
  // Post images and their sources stay local (see .gitignore): skip a page this checkout does not have.
  if (!existsSync(join(root, page.split('?')[0]))) {
    console.log('skip', page, '(source not in this checkout)')
    continue
  }
  const tab = await browser.newPage()
  await tab.setViewport({ width: w, height: h, deviceScaleFactor: 2 })
  await tab.goto(`http://localhost:${port}/${page}`, { waitUntil: 'networkidle0' })
  await tab.waitForSelector('body[data-ready="1"]')
  await tab.screenshot({ path: fileURLToPath(new URL(`./${out}`, import.meta.url)), clip: { x: 0, y: 0, width: w, height: h }, omitBackground: page === 'icon.html' || page.startsWith('kit-logo-export') })
  console.log('wrote', out)
}
await browser.close()
server.close()
