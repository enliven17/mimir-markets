"""Mimir daily 02: soundtrack on the scene's clock (120 BPM, bar = 2 s, step = 125 ms), 13 s.
Every time below mirrors T in scene.js. The picture reads without it; the score only punches the beats.
Run from an ft-motion checkout: python examples/mimir-daily-02/sound.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'audio'))
from ftsynth import *  # noqa: E402,F403
from ftextras import stamp, tick, counter_ticks  # noqa: E402

m = Mix.from_project(__file__)
at, step = m.at, m.step
H1, MINT_H, SCRIB, H_OUT = at(0, 1), at(0, 6), at(0, 8), at(1, 2)
B1, TIER0, BAR0 = at(1, 4), at(1, 6), at(1, 14)
B2, BAL, GATE1, CHIP0, TIERP, GATE2 = at(2, 8), at(2, 11), at(2, 14), at(3), at(3, 3), at(3, 6)
B3, ROLL, SPLIT, MINT, DEX, NOYIELD = at(3, 12), at(3, 15), at(4, 2), at(4, 4), at(4, 7), at(4, 9)
END, HORN, MAIN, SCRIB2, URL = at(5), at(5, 2), at(5, 5), at(5, 10), at(5, 12)
tier_at = lambda i: TIER0 + i * 2 * step
bar_at = lambda i: BAR0 + i * step
chip_at = lambda i: CHIP0 + i * step

# ── hook: "Hold $MIMIR." slams in, the scribble scratches under the ticker, the mint types
m.pad(0.0, chord('Am9', 2), dur=B1 + 0.3, att=0.3, gain=0.2, cutoff=700)
m.impact(H1, gain=0.6, bright=True)
stamp(m, H1, 88, gain=0.5)
m.typing(MINT_H, MINT_H + 0.3, 20, gain=0.07)
m.whoosh(SCRIB - 0.05, 0.6, 2500, 7000, 0.07, pan=0.3, wet=0.1)
for k in range(10):
    m.add(SCRIB + k * 0.065, tick(3000 + 90 * k), 0.035, 0.2 + k * 0.03)
m.drums(0, hats=range(8, 16, 2), hat_gain=0.05)
m.drums(1, kick=[0], hats=range(0, 4, 2), hat_gain=0.06, root=45)
m.riser(H_OUT - 0.6, B1, f0=400, f1=6000, gain=0.14)

# ── 1 · tiers: the drop, three cards pop with rising bells, the bars grow
m.impact(B1, gain=0.7, bright=True)
m.drums(1, kick=[4, 10, 12], snare=[8], hats=range(4, 16, 2), root=41, hat_gain=0.08)
m.drums(2, kick=[0, 6], snare=[4], hats=range(0, 8, 2), root=41, hat_gain=0.08)
m.pad(B1, chord('Fmaj9', 2), dur=B2 - B1 + 0.2, att=0.1, gain=0.17, cutoff=1500)
for i in range(3):
    t = tier_at(i)
    m.add(t, pop(640 + 80 * i), 0.18, -0.3 + 0.3 * i, 0.2)
    stamp(m, t + 0.18, 90 + 18 * i, gain=0.35)
    m.add(t + 0.18, bell(midi([72, 76, 79][i])), 0.1, -0.3 + 0.3 * i, 0.5)
for i in range(4):
    m.glide(bar_at(i), 0.4, 500 + 150 * i, 900 + 400 * i, 0.04, wet=0.2)
    m.add(bar_at(i), blip(1600 + 300 * i), 0.06, 0.3)

# ── 2 · agents: the balance rolls, two gates pass, the chips pop
m.whoosh(B2 - 0.15, 0.4, 500, 4000, 0.1, pan=0.3)
m.drums(2, kick=[8, 14], snare=[12], hats=range(8, 16, 2), root=43, hat_gain=0.08)
m.drums(3, kick=[0, 6, 8], snare=[4], hats=range(0, 12, 2), root=43, hat_gain=0.08)
m.pad(B2, chord('Cadd9', 3), dur=B3 - B2 + 0.2, att=0.1, gain=0.17, cutoff=1600)
counter_ticks(m, BAL, 0.42, 8, gain=0.07)
for t, note in [(GATE1, 76), (GATE2, 79)]:
    m.add(t, mouseclick(), 0.2, 0.2)
    m.add(t + 0.02, bell(midi(note)), 0.12, 0.2, 0.5)
for i in range(3):
    m.add(chip_at(i), pop(700 + 60 * i), 0.14, 0.4 - 0.2 * i, 0.2)
m.add(TIERP, pluck(midi(69)), 0.14, -0.2, 0.3)

# ── 3 · fees: the 25% rolls up in steps, the split fills, the mint types
m.whoosh(B3 - 0.15, 0.4, 600, 3000, 0.1, pan=-0.3)
m.drums(3, kick=[12], hats=range(12, 16, 1), hat_gain=0.06, root=46)
m.drums(4, kick=[0, 6, 8, 14], snare=[4, 12], hats=range(0, 16, 2), root=46, hat_gain=0.08)
m.pad(B3, chord('Bbmaj7', 2), dur=END - B3 + 0.3, att=0.1, gain=0.18, cutoff=1400)
for k in range(5):
    m.add(ROLL + k * step, tick(2000 + 300 * k), 0.08, 0.2)
stamp(m, ROLL + 4 * step, 104, gain=0.6)
m.whoosh(SPLIT, 0.6, 800, 4000, 0.07, pan=0.3)
m.typing(MINT, MINT + 0.25, 12, gain=0.08)
m.add(DEX, blip(1900), 0.06, -0.2)
m.add(NOYIELD, blip(1500), 0.05, 0.2)

# ── end card: suck into the cut, the horn, the payoff lands, the scribble, the URL
m.suck(END - 0.5, END + 0.05, gain=0.14)
m.kick(HORN, gain=0.6, dec=0.6)
m.add(HORN + 0.05, bell(midi(76)), 0.14, -0.1, 0.6)
m.pad(END, chord('Cmaj9', 3), dur=13 - END, att=0.4, gain=0.22, cutoff=1500)
m.impact(MAIN, gain=0.75, bright=True)
stamp(m, MAIN, 98, gain=0.6)
m.add(MAIN + 0.05, bell(midi(83)), 0.12, 0.2, 0.6)
m.whoosh(SCRIB2 - 0.05, 0.6, 2500, 7000, 0.07, pan=0.3, wet=0.1)
for k in range(10):
    m.add(SCRIB2 + k * 0.065, tick(3000 + 90 * k), 0.03, 0.2)
m.add(URL, blip(2200), 0.06, 0)
m.add(URL + 0.08, bell(midi(88)), 0.06, 0.1, 0.6)

m.render(drive=1.6, peak=0.74, fade_out=0.8)
