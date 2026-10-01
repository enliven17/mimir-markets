"""Mimir daily 01: soundtrack on the scene's clock (120 BPM, bar = 2 s, step = 125 ms), 12 s.
Every time below mirrors T in scene.js. The picture reads without it; the score only punches the beats.
Run from an ft-motion checkout: python examples/mimir-daily-01/sound.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'audio'))
from ftsynth import *  # noqa: E402,F403
from ftextras import stamp, tick, counter_ticks  # noqa: E402

m = Mix.from_project(__file__)
at, step = m.at, m.step
H1, H1_OUT, H2, H2_OUT = at(0, 1), at(0, 12), at(0, 12), at(1, 4)
TURN, SCRIB, TURN_OUT = at(1, 4), at(1, 9), at(1, 15)
B1, PRESS, B2, STAKE0 = at(2), at(2, 6), at(2, 12), at(2, 14)
B3, EVID, STAMP, CONF, HASH, DISPUTE = at(3, 8), at(3, 9), at(3, 12), at(3, 14), at(4), at(4, 2)
END, HORN, NAME, URL = at(4, 8), at(4, 10), at(4, 14), at(5, 2)
stake_at = lambda i: STAKE0 + i * 2 * step
REPLIES = [0.45, 0.7, 0.95, 1.2]  # the replies counter rolls (scene.js, the hook's `ev`)

# ── hook: a low pad, hats creep in, each reply count ticks, then a dead thud on "Nobody settles it."
m.pad(0.0, chord('Am9', 2), dur=TURN + 0.3, att=0.6, gain=0.2, cutoff=600)
m.kick(H1, gain=0.5, dec=0.5)
m.whoosh(0.05, 0.6, 400, 2600, 0.08, pan=-0.2)
m.drums(0, hats=range(4, 12, 2), hat_gain=0.05)
for k, t in enumerate(REPLIES):
    m.add(t, blip(1500 + 250 * k), 0.08, 0.3)
    m.add(t + 0.02, tick(2600 + 200 * k), 0.05, -0.2)
m.impact(H2, gain=0.55, bright=False)
stamp(m, H2, 72, gain=0.55)
m.suck(H2 + 0.4, TURN, gain=0.12)

# ── turn: "Don't argue. Settle." lands on the beat, the scribble scratches, a riser into the beats
m.kick(TURN, gain=0.75, dec=0.45)
m.add(TURN, bell(midi(69)), 0.12, -0.1, 0.6)
m.add(TURN + 0.25, bell(midi(76)), 0.08, 0.2, 0.6)
m.pad(TURN, chord('Fmaj9', 2), dur=B1 - TURN + 0.2, att=0.2, gain=0.18, cutoff=1100)
m.whoosh(SCRIB - 0.05, 0.6, 2500, 7000, 0.07, pan=0.3, wet=0.1)
for k in range(10):
    m.add(SCRIB + k * 0.065, tick(3000 + 90 * k), 0.035, 0.2 + k * 0.03)
m.drums(1, kick=[8], hats=range(8, 16, 2), hat_gain=0.06, root=41)
m.riser(TURN_OUT - 0.75, B1, f0=300, f1=6000, gain=0.18)

# ── 1 · stake a side: the drop, full drums, the click on Yes
m.impact(B1, gain=0.75, bright=True)
m.drums(2, kick=[0, 6, 8, 14], snare=[4, 12], hats=range(0, 16, 2), root=41, hat_gain=0.08)
m.pad(B1, chord('Cadd9', 3), dur=B3 - B1, att=0.1, gain=0.17, cutoff=1600)
m.add(PRESS, mouseclick(), 0.25, -0.2)
m.add(PRESS + 0.01, pop(620), 0.2, -0.1, 0.25)
m.add(PRESS + 0.03, pluck(midi(64)), 0.16, 0, 0.3)

# ── 2 · agents challenge: five stakes pop on the rollup, a rising run
m.whoosh(B2 - 0.15, 0.35, 500, 4000, 0.1, pan=0.3)
scale = [67, 69, 71, 72, 76]
for i in range(5):
    t = stake_at(i)
    m.add(t, pop(640 + 50 * i), 0.18, 0.5 - (i % 2) * 0.3, 0.2)
    m.add(t + 0.01, pluck(midi(scale[i])), 0.13, 0.3, 0.35)
    m.add(t + 0.03, blip(2400 + 90 * i), 0.05, 0.6)

# ── 3 · the oracle: evidence types, the stamp, the confidence rolls, the hash types
m.drums(3, kick=[0, 6, 8], snare=[4, 12], hats=range(0, 16, 2), root=43, hat_gain=0.08)
m.whoosh(B3 - 0.15, 0.4, 600, 3000, 0.1, pan=-0.3)
m.typing(EVID, EVID + 0.2, 26, gain=0.09)
m.typing(EVID + 0.19, EVID + 0.39, 26, gain=0.09)
stamp(m, STAMP, 98, gain=0.85)
m.add(STAMP, bell(midi(74)), 0.12, 0, 0.6)
m.pad(B3, chord('Dm9', 2), dur=STAMP - B3 + 0.1, att=0.1, gain=0.17, cutoff=900)
m.pad(STAMP, chord('Bbmaj7', 2), dur=END - STAMP + 0.3, att=0.05, gain=0.18, cutoff=1400)
counter_ticks(m, CONF, 0.35, 9, gain=0.08)
m.typing(HASH, HASH + 0.25, 12, gain=0.08)
m.whoosh(DISPUTE + 0.05, END - DISPUTE - 0.05, 400, 2200, 0.06, pan=0.3)
m.drums(4, kick=[0, 4], hats=range(0, 8, 1), hat_gain=0.05, root=46)

# ── end card: suck into the cut, the horn on the brightest chord, the name, the URL
m.suck(END - 0.5, END + 0.05, gain=0.14)
m.kick(HORN, gain=0.6, dec=0.6)
m.pad(END, chord('Cmaj9', 3), dur=12 - END, att=0.4, gain=0.22, cutoff=1500)
m.add(HORN + 0.05, bell(midi(76)), 0.16, -0.1, 0.6)
m.add(HORN + 0.3, bell(midi(83)), 0.1, 0.2, 0.6)
m.whoosh(NAME - 0.1, 0.6, 500, 2600, 0.08)
m.add(NAME, bell(midi(79)), 0.08, 0, 0.6)
m.add(URL, blip(2200), 0.06, 0)
m.add(URL + 0.08, bell(midi(88)), 0.06, 0.1, 0.6)

m.render(drive=1.6, peak=0.74, fade_out=0.8)
