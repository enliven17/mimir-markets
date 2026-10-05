// Frame-accurate render of index.html (a HyperFrames composition: window.__timelines.root).
//   node render.mjs sheet          → out/sheet.png (16 stills)
//   node render.mjs stills 6,13.5  → out/still-<t>.png
//   node render.mjs                → out/terminal.mp4 (60 fps, with out/audio.wav when present)
// Every frame is a seek of the paused timeline, so nothing depends on wall-clock speed.
// Uses the installed Edge (or CHROME_PATH) and ffmpeg on PATH.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from '../node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js'

const here = fileURLToPath(new URL('.', import.meta.url))
const out = join(here, 'out')
mkdirSync(out, { recursive: true })
const W = 1920, H = 1080, FPS = 60, DURATION = 30

const types = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' }
const server = createServer(async (req, res) => {
  const raw = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  const path = raw === '/' ? '/index.html' : raw
  const body = await readFile(join(here, path)).catch(() => null)
  if (!body) return res.writeHead(404).end()
  res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }).end(body)
}).listen(0)

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--force-color-profile=srgb', '--disable-gpu-vsync'],
})
const page = await browser.newPage()
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
await page.goto(`http://localhost:${server.address().port}/`, { waitUntil: 'networkidle0' })
await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map((i) => i.decode().catch(() => {}))) })

const seek = (t) => page.evaluate((t) => { window.__timelines.root.seek(t, false) }, t)
const shot = async (t, path) => { await seek(t); return page.screenshot({ path, type: 'png' }) }

const mode = process.argv[2] ?? 'video'
if (mode === 'sheet') {
  const n = 16, files = []
  for (let i = 0; i < n; i++) {
    const t = (DURATION * (i + 0.5)) / n
    files.push(join(out, `s${i}.png`))
    await shot(t, files.at(-1))
  }
  await run('ffmpeg', ['-v', 'error', '-y', ...files.flatMap((f) => ['-i', f]),
    '-filter_complex', `${files.map((_, i) => `[${i}]scale=480:-1[v${i}]`).join(';')};${files.map((_, i) => `[v${i}]`).join('')}xstack=inputs=${n}:layout=${[0, 1, 2, 3].flatMap((r) => [0, 1, 2, 3].map((c) => `${c * 480}_${r * 270}`)).join('|')}`,
    join(out, 'sheet.png')])
  console.log('→ out/sheet.png')
} else if (mode === 'stills') {
  for (const t of (process.argv[3] ?? '1').split(',').map(Number)) { await shot(t, join(out, `still-${t}.png`)); console.log(`→ out/still-${t}.png`) }
} else {
  const audio = join(out, 'audio.wav')
  const args = ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    ...(existsSync(audio) ? ['-i', audio, '-c:a', 'aac', '-b:a', '256k', '-shortest'] : []),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(out, 'terminal.mp4')]
  const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] })
  const frames = DURATION * FPS
  for (let f = 0; f < frames; f++) {
    await seek(f / FPS)
    const buf = await page.screenshot({ type: 'png' })
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r))
    if (f % 120 === 0) process.stdout.write(`  frame ${f}/${frames}\n`)
  }
  ff.stdin.end()
  await new Promise((r) => ff.on('close', r))
  console.log('→ out/terminal.mp4')
}
await browser.close()
server.close()

function run(cmd, args) {
  return new Promise((ok, fail) => spawn(cmd, args, { stdio: 'inherit' }).on('close', (c) => (c ? fail(new Error(`${cmd} ${c}`)) : ok())))
}
