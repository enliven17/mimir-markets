"""Mimir architecture: soundtrack on the scene's clock (120 BPM, bar = 2 s, step = 125 ms), 28 s.
Every time below mirrors T in scene.js. Act 1 builds a groove layer by layer; act 2 thins out to a new motif for
the planned Jev hookups; the end card resolves. Run from an ft-motion checkout: python examples/mimir-arch/sound.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'audio'))
from ftsynth import *  # noqa: E402,F403
from ftextras import stamp, tick  # noqa: E402

m = Mix.from_project(__file__)
at, step = m.at, m.step
TITLE, SRC, LLM = at(0, 1), at(5, 8), at(5, 14)
ACT2, JEV, HOOK0, CAL = at(7), at(7, 4), at(8), at(11, 8)
END, HORN, LINE, SCRIB, URL = at(12, 4), at(12, 6), at(12, 12), at(13, 2), at(13, 4)
layer_at = lambda i: at(0, 12) + i * at(1)
box_at = lambda i, j: layer_at(i) + 0.25 + j * at(0, 2)
hooks = [at(8), at(9, 4), at(10, 8), at(11, 8)]
chip_at = lambda k: SRC + 0.1 + k * step
BOXES = [3, 3, 3, 3, 4]

# ── act 1: the title over a low pad, then each layer lands on the bar with its boxes ticking in
m.pad(0.0, chord('Am9', 2), dur=layer_at(0) + 0.3, att=0.8, gain=0.2, cutoff=650)
m.kick(TITLE, gain=0.5, dec=0.5)
m.whoosh(TITLE, 0.7, 400, 2600, 0.08, pan=-0.2)
m.typing(TITLE + 0.1, TITLE + 0.5, 22, gain=0.06)
CHORDS = ['Fmaj9', 'Cadd9', 'Dm9', 'Bbmaj7', 'Am9', 'Fmaj9']
for i in range(5):
    t0 = layer_at(i)
    m.kick(t0, gain=0.6 + 0.04 * i, dec=0.45)
    m.whoosh(t0 - 0.2, 0.4, 500, 3500, 0.08, pan=0.3 * (-1) ** i)
    m.pad(t0, chord(CHORDS[i], 2 + (i > 2)), dur=2.1, att=0.15, gain=0.16, cutoff=1100 + 150 * i)
    for j in range(BOXES[i]):
        m.add(box_at(i, j), pop(620 + 60 * j + 30 * i), 0.13, -0.4 + 0.4 * j, 0.2)
        m.add(box_at(i, j) + 0.2, tick(2400 + 200 * j), 0.04, -0.3 + 0.3 * j)
    if i:  # the connector into this layer
        m.glide(t0 + 0.05, 0.35, 500, 1100, 0.05, wet=0.2)
# drums build from layer 2 on
m.drums(1, kick=[12], hats=range(12, 16, 2), hat_gain=0.05)
for b in (2, 3, 4, 5, 6):
    m.drums(b, kick=[0, 6, 8, 14] if b > 2 else [0, 8], snare=[4, 12] if b > 3 else [12], hats=range(0, 16, 2), root=[41, 43, 38, 46, 45][b - 2], hat_gain=0.07)
# data in: the source chips pop, the LLM chain types
for k in range(6):
    m.add(chip_at(k), blip(1500 + 120 * k), 0.06, -0.5 + 0.2 * k)
m.typing(LLM, LLM + 0.3, 16, gain=0.07)
m.pad(at(5, 8), chord('Fmaj9', 3), dur=ACT2 - at(5, 8) + 0.2, att=0.2, gain=0.17, cutoff=1500)
m.riser(ACT2 - 1.0, ACT2, f0=300, f1=5000, gain=0.14)

# ── act 2: the stack clears, Jev slides in, a new bell motif per hookup
m.impact(ACT2, gain=0.6, bright=True)
m.whoosh(JEV - 0.1, 0.7, 300, 2500, 0.1)
stamp(m, JEV + 0.4, 92, gain=0.4)
m.pad(ACT2, chord('Dm9', 3), dur=HOOK0 - ACT2 + 0.2, att=0.3, gain=0.18, cutoff=1200)
HOOK_CHORDS, HOOK_NOTES = ['Bbmaj7', 'Cadd9', 'Am9', 'Fmaj9'], [74, 76, 79, 81]
for k, t0 in enumerate(hooks):
    t1 = hooks[k + 1] if k < 3 else END
    m.pad(t0, chord(HOOK_CHORDS[k], 3), dur=t1 - t0 + 0.2, att=0.1, gain=0.17, cutoff=1500)
    m.kick(t0, gain=0.55, dec=0.4)
    m.add(t0 + 0.1, bell(midi(HOOK_NOTES[k])), 0.12, -0.2 + 0.2 * k, 0.6)
    m.add(t0 + 0.35, bell(midi(HOOK_NOTES[k] + 7)), 0.07, 0.2, 0.6)
    m.typing(t0 + 0.15, t0 + 0.5, 18, gain=0.06)
for b in (8, 9, 10, 11):
    m.drums(b, kick=[0, 10], snare=[8], hats=range(0, 16, 4), hat_gain=0.05, root=[46, 48, 45, 41][b - 8])
m.drums(12, kick=[0], hats=range(0, 4, 2), hat_gain=0.05)

# ── end card: suck into the cut, the horn, the line lands, the scribble, the URL
m.suck(END - 0.5, END + 0.05, gain=0.14)
m.kick(HORN, gain=0.6, dec=0.6)
m.add(HORN + 0.05, bell(midi(76)), 0.14, -0.1, 0.6)
m.pad(END, chord('Cmaj9', 3), dur=28 - END, att=0.4, gain=0.22, cutoff=1500)
m.impact(LINE, gain=0.65, bright=True)
stamp(m, LINE, 98, gain=0.5)
m.add(LINE + 0.05, bell(midi(83)), 0.1, 0.2, 0.6)
m.whoosh(SCRIB - 0.05, 0.6, 2500, 7000, 0.07, pan=0.3, wet=0.1)
for k in range(10):
    m.add(SCRIB + k * 0.065, tick(3000 + 90 * k), 0.03, 0.2)
m.add(URL, blip(2200), 0.06, 0)
m.add(URL + 0.08, bell(midi(88)), 0.06, 0.1, 0.6)

m.render(drive=1.6, peak=0.74, fade_out=1.0)
