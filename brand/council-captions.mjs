// Meet the council: one X post a day. Renders source/council-card.html for each persona and writes its caption.
//   node brand/council-captions.mjs <out dir>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const out = process.argv[2]
mkdirSync(out, { recursive: true })
const data = JSON.parse(readFileSync(new URL('./source/council-data.json', import.meta.url), 'utf8'))

/** The day's line for each persona: its temperament in plain words, in "stake" language. */
const LINES = {
  optimist: 'Always sees the bullish case. When the evidence is balanced, it leans toward progress and pays a small premium for hope.',
  pessimist: 'Expects things to disappoint. Doubts every rosy chart and every headline that sounds too good.',
  contrarian: 'No AI at all. It reads the pool and stakes the smaller side, every time. It doesn\'t think, it resists. When the crowd is wrong, it gets paid.',
  statistician: 'Rare but decisive. Skips most markets and only moves when the data is overwhelming, then stakes bigger.',
  'whale-watcher': 'No analysis. It finds the largest staker in the market and follows them, on the theory that the rich know something.',
  'crypto-maxi': 'Crypto markets only. Filters out everything else and carries a bullish bias on adoption.',
  'sports-pundit': 'Sports only. Reads form, head-to-head and injuries like a pre-game studio show.',
  weatherman: 'Weather only. Trusts temperatures, rain and wind in numbers, and ignores the adjectives.',
  doomer: 'Worst case is the base case. Where the Pessimist doubts, the Doomer assumes the crash.',
  yapper: 'Touches every market with micro stakes. Its win rate matters less than keeping every market alive.',
  socrates: 'Attacks the question before the answer. If a claim has no clear answer, it doesn\'t pretend: it abstains.',
  kahneman: 'Starts from the base rate. Asks how often this kind of thing happens at all before it trusts a good story.',
  taleb: 'Prices the tail. Asks what would make the consensus wrong and how cheap that is. Absence of evidence is not evidence of absence.',
  feynman: 'Wants the mechanism. If it can\'t explain why something will happen in plain words, it doesn\'t stake on it.',
  munger: 'Inverts. Works the problem backwards and asks who benefits from the claim being believed.',
  ada: 'Turns the claim into arithmetic: the threshold, the current value, the distance and the time left. If it can\'t be reduced, it says so.',
  meadows: 'Reads the system. Looks for the feedback loop and the delay behind every number.',
  machiavelli: 'Reads intent. Treats announcements as moves, not facts, and asks what the actor actually did.',
  aurelius: 'Separates what the evidence controls from what it doesn\'t. Rules on the stated source, unmoved by the noise around it.',
  'lao-tzu': 'Stakes on reversion. What is stretched returns to the middle, and extremes rarely hold until the deadline.',
}

const all = []
for (const p of data) {
  const nn = String(p.n).padStart(2, '0')
  const name = p.name.replace(/^The /, '')
  const line = LINES[p.slug]
  if (!line || /\bbet(s|ting)?\b/i.test(line)) throw new Error(`caption for ${p.slug} missing or says bet`)
  const caption = [
    `Meet the council, ${nn}/20: ${name}`,
    '',
    line,
    '',
    `${p.track === 'philosopher' ? 'One of the philosophers' : 'One of the classic jury'} on Mimir's AI council. It stakes from its own Arc wallet and has its own token.`,
    '',
    `$${p.ticker} on pump.fun`,
    `CA: ${p.mint}`,
    '',
    `mimirmarkets.xyz/launch/${p.slug}`,
  ].join('\n')
  const base = `day-${nn}-${p.slug}`
  writeFileSync(`${out}/${base}.txt`, caption + '\n')
  execFileSync(process.execPath, ['_one.mjs', `council-card.html?slug=${p.slug}`, `${out}/${base}.png`, '1600', '900'], { cwd: new URL('.', import.meta.url) })
  all.push(`==================== DAY ${nn} · ${base}.png ====================\n${caption}\n`)
  console.log(base)
}
writeFileSync(`${out}/all-captions.txt`, all.join('\n'))
