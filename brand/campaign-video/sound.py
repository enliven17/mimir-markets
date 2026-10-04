"""Mimir, "Testnet campaign is live": soundtrack on the scene's clock (120 BPM, bar = 2 s, step = 125 ms), 15 s.
Every time below mirrors T in scene.js. The picture reads without it; the score only punches the beats.
Run from an ft-motion checkout: python examples/mimir-campaign/sound.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'audio'))
from ftsynth import *  # noqa: E402,F403
from ftextras import stamp, tick, counter_ticks  # noqa: E402

m = Mix.from_project(__file__)
at, step = m.at, m.step
H1, LIVE, SCRIB, H_OUT = at(0, 1), at(0, 6), at(0, 8), at(1, 2)
B1, ROW0, STAKE0, COPY = at(1, 4), at(1, 6), at(1, 10), at(2, 4)
B2, BROW0 = at(2, 8), at(2, 10)
B3, TYPE, JOIN, BONUS, SHARE = at(3, 12), at(3, 14), at(4, 4), at(4, 7), at(4, 10)
BOOST, MULT, EARLY, B_OUT = at(5), at(5, 3), at(5, 7), at(5, 14)
END, HORN, MAIN, SCRIB2, URL = at(6), at(6, 1), at(6, 4), at(6, 9), at(6, 11)
row_at = lambda i: ROW0 + i * 2 * step
stake_at = lambda i: STAKE0 + i * 2 * step
brow_at = lambda i: BROW0 + i * 3 * step

# ── hook: the title slams in, the live pill pings, the scribble scratches
m.pad(0.0, chord('Am9', 2), dur=B1 + 0.3, att=0.3, gain=0.2, cutoff=700)
m.impact(H1, gain=0.6, bright=True)
stamp(m, H1, 88, gain=0.5)
m.add(LIVE, blip(1800), 0.07, 0.2)
m.add(LIVE + 0.06, bell(midi(81)), 0.07, 0.2, 0.5)
m.whoosh(SCRIB - 0.05, 0.6, 2500, 7000, 0.07, pan=0.3, wet=0.1)
for k in range(10):
    m.add(SCRIB + k * 0.065, tick(3000 + 90 * k), 0.035, 0.2 + k * 0.03)
m.drums(0, hats=range(8, 16, 2), hat_gain=0.05)
m.drums(1, kick=[0], hats=range(0, 4, 2), hat_gain=0.06, root=45)
m.riser(H_OUT - 0.6, B1, f0=400, f1=6000, gain=0.14)

# ── 1 · volume: the drop, rows slam, stakes pop, the score rolls
m.impact(B1, gain=0.7, bright=True)
m.drums(1, kick=[4, 10, 12], snare=[8], hats=range(4, 16, 2), root=41, hat_gain=0.08)
m.drums(2, kick=[0, 6], snare=[4], hats=range(0, 8, 2), root=41, hat_gain=0.08)
m.pad(B1, chord('Fmaj9', 2), dur=B2 - B1 + 0.2, att=0.1, gain=0.17, cutoff=1500)
for i in range(2):
    stamp(m, row_at(i) + 0.08, 92 + 12 * i, gain=0.35)
for i in range(3):
    t = stake_at(i)
    m.add(t, pop(640 + 80 * i), 0.16, 0.3, 0.2)
    counter_ticks(m, t, 0.42, 6, gain=0.06)
m.add(COPY, pluck(midi(76)), 0.14, -0.2, 0.3)

# ── 2 · agents and baskets: three rows, three rising stamps
m.whoosh(B2 - 0.15, 0.4, 500, 4000, 0.1, pan=0.3)
m.drums(2, kick=[8, 14], snare=[12], hats=range(8, 16, 2), root=43, hat_gain=0.08)
m.drums(3, kick=[0, 6, 8], snare=[4], hats=range(0, 12, 2), root=43, hat_gain=0.08)
m.pad(B2, chord('Cadd9', 3), dur=B3 - B2 + 0.2, att=0.1, gain=0.17, cutoff=1600)
for i in range(3):
    t = brow_at(i)
    stamp(m, t + 0.08, 90 + 18 * i, gain=0.4)
    m.add(t + 0.08, bell(midi([72, 76, 79][i])), 0.1, -0.3 + 0.3 * i, 0.5)

# ── 3 · invite: the link types, a friend joins, the bonuses land
m.whoosh(B3 - 0.15, 0.4, 600, 3000, 0.1, pan=-0.3)
m.drums(3, kick=[12], hats=range(12, 16, 1), hat_gain=0.06, root=46)
m.drums(4, kick=[0, 6, 8, 14], snare=[4, 12], hats=range(0, 16, 2), root=46, hat_gain=0.08)
m.pad(B3, chord('Bbmaj7', 2), dur=BOOST - B3 + 0.3, att=0.1, gain=0.18, cutoff=1400)
m.typing(TYPE, TYPE + 0.6, 30, gain=0.08)
m.add(JOIN, mouseclick(), 0.2, 0.2)
m.add(JOIN + 0.02, bell(midi(76)), 0.12, 0.2, 0.5)
stamp(m, BONUS, 100, gain=0.5)
stamp(m, SHARE, 108, gain=0.5)

# ── 4 · the boost: suck in, ×1.5 hits hard, the badge rings
m.suck(BOOST - 0.4, BOOST + 0.05, gain=0.12)
m.drums(5, kick=[0, 6, 8, 14], snare=[4, 12], hats=range(0, 14, 2), root=45, hat_gain=0.08)
m.pad(BOOST, chord('Am9', 2), dur=END - BOOST + 0.2, att=0.05, gain=0.2, cutoff=1800)
m.riser(MULT - 0.5, MULT, f0=600, f1=7000, gain=0.12)
m.impact(MULT, gain=0.85, bright=True)
stamp(m, MULT, 110, gain=0.6)
m.add(EARLY, bell(midi(84)), 0.13, 0, 0.6)
m.add(EARLY, pop(900), 0.14, 0, 0.2)

# ── end card: suck into the cut, the horn, the payoff lands, the scribble, the URL
m.suck(END - 0.5, END + 0.05, gain=0.14)
m.kick(HORN, gain=0.6, dec=0.6)
m.add(HORN + 0.05, bell(midi(76)), 0.14, -0.1, 0.6)
m.pad(END, chord('Cmaj9', 3), dur=15 - END, att=0.4, gain=0.22, cutoff=1500)
m.impact(MAIN, gain=0.75, bright=True)
stamp(m, MAIN, 98, gain=0.6)
m.add(MAIN + 0.05, bell(midi(83)), 0.12, 0.2, 0.6)
m.whoosh(SCRIB2 - 0.05, 0.6, 2500, 7000, 0.07, pan=0.3, wet=0.1)
for k in range(10):
    m.add(SCRIB2 + k * 0.065, tick(3000 + 90 * k), 0.03, 0.2)
m.add(URL, blip(2200), 0.06, 0)
m.add(URL + 0.08, bell(midi(88)), 0.06, 0.1, 0.6)

m.render(drive=1.6, peak=0.74, fade_out=0.8)
