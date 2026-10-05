"""Mimir Terminal launch: soundtrack on the scene's clock (120 BPM, bar = 2 s, step = 125 ms), 16 s.
Every time below mirrors T in scene.js. Run from an ft-motion checkout: python examples/mimir-terminal/sound.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'audio'))
from ftsynth import *  # noqa: E402,F403
from ftextras import stamp, tick, counter_ticks  # noqa: E402

m = Mix.from_project(__file__)
at, step = m.at, m.step
H1, H2, H3, SCRIB, H_OUT = at(0, 1), at(0, 4), at(0, 8), at(0, 11), at(1, 4)
B1, TYPE1, ROW0, HOT = at(1, 6), at(1, 8), at(1, 12), at(2, 8)
B2, AV0, Q, REPLY, PAY = at(3, 0), at(3, 1), at(3, 6), at(3, 11), at(4, 5)
B3, PASTE, PRICE, G0 = at(4, 12), at(4, 14), at(5, 1), at(5, 6)
END, HORN, MAIN, SCRIB2, URL, BETA = at(6, 4), at(6, 6), at(6, 9), at(6, 13), at(7, 0), at(7, 2)
row_at = lambda i: ROW0 + i * step
av_at = lambda i: AV0 + i * step * 0.5
g_at = lambda i: G0 + i * 3 * step

# ── hook: three slams in one bar, the scribble scratches under "prompt."
m.pad(0.0, chord('Am9', 2), dur=B1 + 0.2, att=0.2, gain=0.2, cutoff=900)
for t, root, g in [(H1, 86, 0.5), (H2, 92, 0.55), (H3, 100, 0.75)]:
    m.impact(t, gain=g, bright=True)
    stamp(m, t, root, gain=0.45)
m.whoosh(SCRIB - 0.05, 0.45, 2500, 7000, 0.07, pan=0.3, wet=0.1)
for k in range(10):
    m.add(SCRIB + k * 0.045, tick(3000 + 90 * k), 0.035, 0.2 + k * 0.03)
m.drums(0, kick=[0, 4, 8], hats=range(8, 16, 1), hat_gain=0.05, root=45)
m.riser(H_OUT - 0.5, B1, f0=400, f1=7000, gain=0.14)

# ── 1 · markets live: the drop, typing, five rows tick in, the bars glide, #51 lights
m.impact(B1, gain=0.75, bright=True)
for bar in range(1, 3):
    m.drums(bar, kick=[0, 6, 8, 14], snare=[4, 12], hats=range(0, 16, 2), root=41, hat_gain=0.08)
m.pad(B1, chord('Fmaj9', 2), dur=B2 - B1 + 0.2, att=0.05, gain=0.17, cutoff=1600)
m.typing(TYPE1, TYPE1 + 0.36, 12, gain=0.09)
m.add(TYPE1 + 0.38, mouseclick(), 0.16, 0)
for i in range(4):
    m.add(row_at(i), pop(620 + 70 * i), 0.15, -0.3 + 0.2 * i, 0.2)
    m.glide(row_at(i) + 0.08, 0.4, 500 + 140 * i, 900 + 300 * i, 0.035, wet=0.2)
m.add(HOT, bell(midi(76)), 0.11, 0.2, 0.5)

# ── 2 · an agent: avatars pop up a scale, two lines type, the reply streams, the price stamps
m.whoosh(B2 - 0.12, 0.35, 500, 4000, 0.1, pan=0.3)
for bar in range(3, 5):
    m.drums(bar, kick=[0, 6, 8], snare=[4, 12], hats=range(0, 16, 2), root=43, hat_gain=0.08)
m.pad(B2, chord('Cadd9', 3), dur=B3 - B2 + 0.2, att=0.05, gain=0.17, cutoff=1700)
for i, n in enumerate([60, 62, 64, 67, 69, 72, 74, 76, 79, 81]):
    m.add(av_at(i), pluck(midi(n)), 0.07, -0.4 + 0.08 * i, 0.3)
m.typing(AV0 + 0.3, AV0 + 0.6, 12, gain=0.08)
m.typing(Q, Q + 0.57, 25, gain=0.08)
m.add(REPLY, mouseclick(), 0.16, 0)
counter_ticks(m, REPLY + 0.15, 1.4, 28, gain=0.035)
stamp(m, PAY, 104, gain=0.55)
m.add(PAY + 0.02, bell(midi(81)), 0.1, 0.3, 0.5)

# ── 3 · a token: the paste hits, the price rolls up, three checks resolve
m.whoosh(B3 - 0.12, 0.35, 600, 3500, 0.1, pan=-0.3)
m.drums(4, kick=[12, 14], hats=range(12, 16, 1), hat_gain=0.06, root=46)
m.drums(5, kick=[0, 6, 8, 14], snare=[4, 12], hats=range(0, 16, 2), root=46, hat_gain=0.08)
m.drums(6, kick=[0], hats=range(0, 4, 2), hat_gain=0.06, root=46)
m.pad(B3, chord('Bbmaj7', 2), dur=END - B3 + 0.3, att=0.05, gain=0.18, cutoff=1500)
m.impact(PASTE, gain=0.45)
m.add(PASTE, mouseclick(), 0.22, 0)
for k in range(4):
    m.add(PRICE + k * 0.0625, tick(1800 + 350 * k), 0.08, 0.2)
stamp(m, PRICE + 0.19, 100, gain=0.5)
for i, (note, root) in enumerate([(64, 90), (62, 94), (76, 110)]):
    m.add(g_at(i), mouseclick(), 0.16, 0.3)
    m.add(g_at(i) + 0.02, bell(midi(note)), 0.12, 0.3, 0.5)
    stamp(m, g_at(i) + 0.02, root, gain=0.35)

# ── end card: suck into the cut, the horn, the payoff, the scribble, URL, beta
m.suck(END - 0.4, END + 0.05, gain=0.14)
m.kick(HORN, gain=0.65, dec=0.6)
m.add(HORN + 0.05, bell(midi(76)), 0.14, -0.1, 0.6)
m.pad(END, chord('Cmaj9', 3), dur=16 - END, att=0.3, gain=0.22, cutoff=1500)
m.impact(MAIN, gain=0.8, bright=True)
stamp(m, MAIN, 98, gain=0.6)
m.add(MAIN + 0.05, bell(midi(83)), 0.12, 0.2, 0.6)
m.whoosh(SCRIB2 - 0.05, 0.45, 2500, 7000, 0.07, pan=0.3, wet=0.1)
for k in range(10):
    m.add(SCRIB2 + k * 0.045, tick(3000 + 90 * k), 0.03, 0.2)
m.add(URL, blip(2200), 0.06, 0)
m.add(BETA, pop(820), 0.12, 0, 0.2)
m.add(BETA + 0.06, bell(midi(88)), 0.06, 0.1, 0.6)

m.render(drive=1.6, peak=0.7, fade_out=1.0)
