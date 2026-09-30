// Still frames of the site's pieces: the ASCII wave field behind the hero and
// the pixel scribble under "Settle.". Same glyph ramp, colours and seed.

const CHARS = '.:-=+*#%@'
const CREAM = [243, 234, 214]
const CORAL = [255, 81, 72]

/**
 * Draw one frame of the wave field. `cx`,`cy` move the wave centre (0..1),
 * `mask(x, y)` returns 0..1 to fade the field out behind copy.
 */
export function drawField(canvas, { cell = 14, frame = 40, cx = 0.5, cy = 0.5, spread = 12, mask = () => 1 } = {}) {
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  canvas.width = Math.round(w * dpr)
  canvas.height = Math.round(h * dpr)
  const g = canvas.getContext('2d')
  g.scale(dpr, dpr)
  g.font = `${cell}px ui-monospace, "Mono", monospace`
  g.textBaseline = 'alphabetic'
  const cw = cell * 0.6
  const cols = Math.ceil(w / cw)
  const rows = Math.ceil(h / cell)
  const phase = frame * 0.03
  const last = CHARS.length - 1
  for (let y = 0; y < rows; y++) {
    const rn = Math.cos(y * 0.3 + frame * 0.02)
    for (let x = 0; x < cols; x++) {
      const dx = x / cols - cx
      const dy = (y / rows - cy) * (h / w) * 3
      const dist = Math.sqrt(dx * dx + dy * dy) * spread
      const wave = Math.sin(dist - phase) * 0.5 + 0.5
      let val = wave * 0.7 + Math.sin(x * 0.3 + frame * 0.01) * 0.3 * rn
      val = Math.max(0, Math.min(1, val))
      const fade = mask(x / cols, y / rows)
      if (fade <= 0.02) continue
      const mix = Math.max(0, Math.min(1, (wave - 0.6) * 2.5))
      const alpha = (0.18 + val * 0.42) * fade
      const c = CREAM.map((b, i) => Math.round(b * (1 - mix) + CORAL[i] * mix))
      g.fillStyle = `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`
      g.fillText(CHARS[(val * last) | 0], x * cw, y * cell + cell * 0.85)
    }
  }
}

/** The hero scribble: chunky pixels, seeded so it matches the site. */
export function drawScribble(canvas, px = 4) {
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  const cols = Math.max(8, Math.floor(w / px))
  const rows = Math.max(4, Math.floor(h / px))
  canvas.width = cols
  canvas.height = rows
  const g = canvas.getContext('2d')
  let seed = 7
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const pts = []
  const plot = (x, y) => pts.push([Math.round(x), Math.round(y)])
  for (let x = 1; x < cols - 2; x += 0.5)
    plot(x, rows * 0.36 + Math.sin((x / cols) * Math.PI * 1.6 + 0.4) * rows * 0.05 + (rnd() - 0.5) * 0.5)
  for (let k = 0; k < 1; k += 0.05) plot(cols - 2 - k * 3, rows * 0.36 + k * rows * 0.26)
  for (let x = cols - 5; x > cols * 0.06; x -= 0.5)
    plot(x, rows * 0.62 + Math.sin((x / cols) * Math.PI * 1.3 + 2) * rows * 0.05 + (rnd() - 0.5) * 0.5)
  pts.forEach(([x, y], i) => {
    g.fillStyle = i % 7 === 0 ? '#ff5148' : '#ff2b2b'
    g.fillRect(x, y, 1, i % 4 === 0 ? 2 : 1)
  })
}
