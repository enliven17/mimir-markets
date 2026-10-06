"""Mimir CLI is coming: soundtrack on the scene's clock (120 BPM, bar = 2 s, step = 125 ms), 18 s.
Every time below mirrors T in scene.js. Run from an ft-motion checkout: python examples/mimir-cli/sound.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'audio'))
from ftsynth import *  # noqa: E402,F403
from ftextras import stamp, tick, counter_ticks  # noqa: E402

m = Mix.from_project(__file__)
at, step = m.at, m.step
H1, H2, SCRIB, H_OUT = at(0, 1), at(0, 6), at(0, 10), at(1, 6)
WIN, A, A_OUT, A_RUN, BAN = at(1, 8), at(1, 10), at(2, 3), at(2, 5), at(2, 8)
B, B_TYPE, ROWS = at(3, 6), at(3, 7), at(3, 12)
C, C_ADD, SAVED, ASK, THINK, REPLY = at(4, 10), at(4, 11), at(5, 7), at(5, 9), at(6, 1), at(6, 4)
END, HORN, MAIN, SCRIB2, INSTALL, URL = at(7, 6), at(7, 8), at(7, 11), at(7, 15), at(8, 1), at(8, 3)

# ── hook: two slams, the scribble under "coming."
m.pad(0.0, chord('Am9', 2), dur=WIN + 0.3, att=0.2, gain=0.2, cutoff=900)
m.impact(H1, gain=0.6, bright=True); stamp(m, H1, 86, gain=0.5)
m.impact(H2, gain=0.75, bright=True); stamp(m, H2, 100, gain=0.5)
m.whoosh(SCRIB - 0.05, 0.45, 2500, 7000, 0.07, pan=0.3, wet=0.1)
for k in range(10):
    m.add(SCRIB + k * 0.045, tick(3000 + 90 * k), 0.035, 0.2 + k * 0.03)
m.drums(0, kick=[0, 6, 8], hats=range(8, 16, 1), hat_gain=0.05, root=45)
m.riser(H_OUT - 0.5, WIN, f0=400, f1=7000, gain=0.14)

# ── install and run: keys, the banner falls in row by row
m.impact(WIN, gain=0.7, bright=True)
for bar in range(1, 4):
    m.drums(bar, kick=[0, 6, 8, 14] if bar > 1 else [8, 14], snare=[4, 12] if bar > 1 else [12], hats=range(0, 16, 2), root=41, hat_gain=0.08)
m.pad(WIN, chord('Fmaj9', 2), dur=B - WIN + 0.2, att=0.05, gain=0.17, cutoff=1600)
m.typing(A, A + 0.52, 23, gain=0.09)
m.add(A_OUT, blip(1500), 0.05, 0.2)
m.typing(A_RUN, A_RUN + 0.17, 5, gain=0.09)
for i in range(17):
    m.add(BAN + i * 0.04, tick(900 + 120 * i), 0.05, -0.3 + 0.04 * i)
stamp(m, BAN + 0.2, 96, gain=0.55)
m.add(BAN + 0.25, bell(midi(76)), 0.1, 0, 0.5)

# ── markets: a clear, the command, three rows
m.suck(B - 0.3, B + 0.02, gain=0.1)
m.drums(4, kick=[0, 6, 8], snare=[4], hats=range(0, 10, 2), root=43, hat_gain=0.08)
m.pad(B, chord('Cadd9', 3), dur=C - B + 0.2, att=0.05, gain=0.17, cutoff=1700)
m.typing(B_TYPE, B_TYPE + 0.18, 7, gain=0.09)
for i in range(3):
    m.add(ROWS + i * step, pop(640 + 80 * i), 0.15, -0.2 + 0.2 * i, 0.2)

# ── your agent: add, saved, ask, the reply streams
m.suck(C - 0.3, C + 0.02, gain=0.1)
for bar in range(5, 7):
    m.drums(bar, kick=[0, 6, 8, 14], snare=[4, 12], hats=range(0, 16, 2), root=46, hat_gain=0.08)
m.drums(7, kick=[0, 6], snare=[4], hats=range(0, 10, 2), root=46, hat_gain=0.07)
m.pad(C, chord('Bbmaj7', 2), dur=END - C + 0.3, att=0.05, gain=0.18, cutoff=1500)
m.typing(C_ADD, C_ADD + 1.1, 64, gain=0.08)
m.add(SAVED, bell(midi(79)), 0.12, 0.2, 0.5); m.add(SAVED, mouseclick(), 0.16, 0.2)
m.typing(ASK, ASK + 0.65, 34, gain=0.08)
m.add(THINK, blip(1300), 0.05, 0)
m.add(REPLY, mouseclick(), 0.18, 0)
counter_ticks(m, REPLY, 1.3, 26, gain=0.035)

# ── end card: the horn, the payoff, the scribble, the install line, the URL
m.suck(END - 0.4, END + 0.05, gain=0.14)
m.kick(HORN, gain=0.65, dec=0.6)
m.add(HORN + 0.05, bell(midi(76)), 0.14, -0.1, 0.6)
m.pad(END, chord('Cmaj9', 3), dur=18 - END, att=0.3, gain=0.22, cutoff=1500)
m.impact(MAIN, gain=0.8, bright=True); stamp(m, MAIN, 98, gain=0.6)
m.add(MAIN + 0.05, bell(midi(83)), 0.12, 0.2, 0.6)
m.whoosh(SCRIB2 - 0.05, 0.45, 2500, 7000, 0.07, pan=0.3, wet=0.1)
for k in range(10):
    m.add(SCRIB2 + k * 0.045, tick(3000 + 90 * k), 0.03, 0.2)
m.typing(INSTALL, INSTALL + 0.45, 23, gain=0.08)
m.add(URL, blip(2200), 0.06, 0)
m.add(URL + 0.08, bell(midi(88)), 0.06, 0.1, 0.6)

m.render(drive=1.6, peak=0.7, fade_out=1.0)
