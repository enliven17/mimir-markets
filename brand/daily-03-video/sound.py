"""Mimir daily 03: soundtrack on the scene's clock (120 BPM, bar = 2 s, step = 125 ms), 19 s.
Every time below mirrors T in scene.js. Drier and more percussive than the earlier clips: slams, glitch wipes, a
terminal that types under the whole middle section. The picture reads without it.
Run from an ft-motion checkout: python examples/mimir-daily-03/sound.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'audio'))
from ftsynth import *  # noqa: E402,F403
from ftextras import stamp, tick, counter_ticks, glitch_burst, tom  # noqa: E402

m = Mix.from_project(__file__)
at, step = m.at, m.step
Q1, Q2, WIPE1, A1, A2, WIPE2 = at(0, 1), at(0, 6), at(1), at(1, 2), at(1, 6), at(1, 12)
DEAD, FETCH, RULES, READ2, REFUND = at(2), at(2, 8), at(3), at(3, 5), at(3, 10)
LLM, CONF, RECEIPT, HASH, VERIFY = at(4, 4), at(4, 12), at(5, 8), at(6), at(6, 6)
PROPOSE, DISPUTE, FINAL, PAYOUT = at(6, 12), at(7, 2), at(7, 10), at(7, 13)
END, HORN, SLOGAN, SCRIB, URL = at(8), at(8, 2), at(8, 6), at(8, 10), at(8, 12)
TERM = [DEAD + 0.05, DEAD + 0.45, FETCH + 0.1, RULES + 0.1, READ2 + 0.1, REFUND + 0.1, LLM + 0.1, CONF + 0.1,
        RECEIPT + 0.1, HASH + 0.1, VERIFY + 0.1, PROPOSE + 0.1]
TERM_LEN = [19, 54, 75, 62, 64, 53, 55, 37, 61, 44, 34, 47]


def wipe(t):
    m.add(t, glitch_burst(0.45), 0.22, 0, 0.15)
    m.whoosh(t, 0.5, 6000, 900, 0.1, pan=-0.4)


# ── hook: two slams, a wipe, two more
m.pad(0.0, chord('Am9', 2), dur=WIPE2 + 0.4, att=0.4, gain=0.17, cutoff=700)
m.impact(Q1, gain=0.5, bright=False)
stamp(m, Q1, 70, gain=0.85)
m.add(Q2, tom(150, 0.1), 0.5, 0.3)
m.whoosh(Q2 - 0.05, 0.35, 900, 4000, 0.07, pan=0.4)
wipe(WIPE1)
stamp(m, A1, 82, gain=0.7)
m.add(A2, glitch_burst(0.25), 0.12, 0.3)
m.add(A2 + 0.02, bell(midi(81)), 0.1, 0.2, 0.5)
m.drums(1, kick=[0, 6], hats=range(0, 12, 2), hat_gain=0.05, root=45)
wipe(WIPE2)

# ── the canvas: a dry pulse, the terminal typing, a hit per step
for b in range(2, 7):
    m.drums(b, kick=[0, 3, 8, 11], snare=[4, 12], hats=range(0, 16, 1), hat_gain=0.035, root=[45, 41, 43, 46, 45][b - 2])
for t0, n in zip(TERM, TERM_LEN):
    m.typing(t0, t0 + n / 75, n, gain=0.05)
stamp(m, DEAD, 96, gain=0.7)
m.add(DEAD, bell(midi(69)), 0.1, 0, 0.5)
m.pad(DEAD, chord('Dm9', 2), dur=RULES - DEAD, att=0.1, gain=0.15, cutoff=1000)
m.whoosh(FETCH - 0.1, 0.6, 400, 3000, 0.08, pan=0.4)
m.glide(FETCH + 0.6, 0.5, 900, 1500, 0.04, wet=0.2)
m.add(FETCH + 0.55, blip(2200), 0.07, 0.3)
stamp(m, RULES, 104, gain=0.55)
m.pad(RULES, chord('Fmaj9', 2), dur=LLM - RULES, att=0.1, gain=0.15, cutoff=1300)
m.add(RULES + 0.15, pop(700), 0.15, 0.2, 0.2)
m.add(RULES + 0.55, pluck(midi(72)), 0.13, 0.3, 0.3)
m.add(READ2, pluck(midi(76)), 0.13, -0.3, 0.3)
m.add(READ2 + 0.3, bell(midi(79)), 0.08, 0, 0.5)
m.add(REFUND, glitch_burst(0.3), 0.14, -0.3)
stamp(m, REFUND, 78, gain=0.5)
m.whoosh(LLM - 0.15, 0.7, 400, 3000, 0.09, pan=-0.3)
m.pad(LLM, chord('Bbmaj7', 2), dur=RECEIPT - LLM, att=0.1, gain=0.15, cutoff=1300)
m.glide(LLM + 0.15, 0.45, 1200, 1800, 0.04, wet=0.3)
counter_ticks(m, CONF, 0.42, 9, gain=0.07)
m.add(CONF + 0.5, bell(midi(81)), 0.1, 0.2, 0.5)
m.whoosh(RECEIPT - 0.15, 0.7, 400, 3000, 0.09, pan=0.3)
m.pad(RECEIPT, chord('Cadd9', 3), dur=PROPOSE - RECEIPT, att=0.1, gain=0.15, cutoff=1500)
for k in range(8):
    m.add(RECEIPT + 0.15 + k * 0.07, tick(2000 + 120 * k), 0.04, -0.2)
stamp(m, HASH, 110, gain=0.5)
m.add(HASH + 0.5, pop(760), 0.14, 0.2, 0.2)
m.add(VERIFY + 0.25, mouseclick(), 0.2, 0.3)
m.add(VERIFY + 0.27, bell(midi(84)), 0.1, 0.3, 0.5)

# ── the takeover: it only proposes; the window time-lapses; final; payouts
m.impact(PROPOSE + 0.5, gain=0.6, bright=False)
stamp(m, PROPOSE + 0.5, 88, gain=0.55)
m.pad(PROPOSE, chord('Am9', 3), dur=END - PROPOSE + 0.2, att=0.2, gain=0.17, cutoff=1200)
m.drums(7, hats=range(0, 16, 2), hat_gain=0.04)
counter_ticks(m, DISPUTE + 0.1, 0.6, 12, f0=1400, f1=2600, gain=0.06)
m.add(FINAL, bell(midi(76)), 0.1, -0.2, 0.5)
m.add(PAYOUT, mouseclick(), 0.18, 0.3)
m.add(PAYOUT + 0.03, bell(midi(83)), 0.1, 0.3, 0.5)

# ── end: the last wipe, the horn, the slogan, the URL
wipe(END)
m.kick(HORN, gain=0.6, dec=0.6)
m.add(HORN + 0.05, bell(midi(76)), 0.14, -0.1, 0.6)
m.pad(END, chord('Cmaj9', 3), dur=19 - END, att=0.4, gain=0.22, cutoff=1500)
m.whoosh(SLOGAN - 0.1, 0.6, 500, 2600, 0.08)
m.add(SLOGAN, bell(midi(81)), 0.08, 0, 0.6)
for k in range(10):
    m.add(SCRIB + k * 0.065, tick(3000 + 90 * k), 0.03, 0.2)
m.add(URL, blip(2200), 0.06, 0)
m.add(URL + 0.08, bell(midi(88)), 0.06, 0.1, 0.6)

m.render(drive=1.6, peak=0.68, fade_out=0.9)
