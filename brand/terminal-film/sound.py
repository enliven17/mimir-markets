"""Mimir Terminal launch film: soundtrack (120 BPM, bar = 2 s), 30 s. Times mirror the timeline in index.html.
Built with ft-motion's synth: run from an ft-motion checkout as examples/mimir-terminal-film/sound.py."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'audio'))
from ftsynth import *  # noqa: E402,F403
from ftextras import stamp, tick, counter_ticks  # noqa: E402

m = Mix.from_project(__file__)

# ── 0 · hook: three lines land on the beat, the scribble, the badge with its sheen
m.pad(0.0, chord('Am9', 2), dur=4.4, att=0.4, gain=0.2, cutoff=800)
for t, root in [(0.2, 88), (1.2, 92), (2.2, 98)]:
    m.impact(t, gain=0.45 if t < 2 else 0.65, bright=True)
    stamp(m, t, root, gain=0.4)
m.whoosh(2.65, 0.5, 2500, 7000, 0.07, pan=0.3, wet=0.1)
for k in range(10):
    m.add(2.7 + k * 0.05, tick(3000 + 90 * k), 0.03, 0.2)
m.add(3.2, pop(720), 0.14, 0, 0.2)
m.glide(3.5, 0.6, 1800, 5200, 0.04, wet=0.3)
m.drums(1, kick=[8, 12], hats=range(8, 16, 2), hat_gain=0.05, root=45)
m.riser(3.2, 4.0, f0=300, f1=6000, gain=0.14)

# ── 1 · the window flies in, markets live
m.impact(4.0, gain=0.75, bright=True)
m.whoosh(3.9, 0.9, 400, 5000, 0.12, pan=-0.2)
for bar in range(2, 5):
    m.drums(bar, kick=[0, 6, 8, 14], snare=[4, 12], hats=range(0, 16, 2), root=41, hat_gain=0.07)
m.pad(4.0, chord('Fmaj9', 2), dur=7.2, att=0.2, gain=0.16, cutoff=1500)
m.typing(5.2, 5.75, 12, gain=0.08)
m.add(6.0, mouseclick(), 0.18, 0)
for i in range(5):
    m.add(6.0 + i * 0.12, blip(1400 + 180 * i), 0.05, -0.2 + 0.1 * i)
m.whoosh(6.4, 0.5, 900, 4000, 0.07, pan=0.3)
m.add(8.6, bell(midi(76)), 0.1, 0.2, 0.5)

# ── 2 · an agent: typing, the reply streams in, the cards float out
m.suck(10.6, 11.05, gain=0.1)
m.impact(11.0, gain=0.55)
for bar in range(5, 9):
    m.drums(bar, kick=[0, 6, 8], snare=[4, 12], hats=range(0, 16, 2), root=43, hat_gain=0.07)
m.pad(11.0, chord('Cadd9', 3), dur=7.2, att=0.2, gain=0.16, cutoff=1600)
m.typing(11.1, 11.65, 12, gain=0.08)
m.add(11.8, pluck(midi(72)), 0.12, -0.2, 0.3)
m.typing(12.4, 13.4, 25, gain=0.08)
m.add(13.6, mouseclick(), 0.16, 0)
counter_ticks(m, 13.9, 3.0, 40, gain=0.035)
m.whoosh(13.0, 0.7, 600, 3500, 0.09, pan=0.4)
m.add(13.3, pop(780), 0.12, 0.4, 0.2)
m.whoosh(14.6, 0.7, 600, 3500, 0.09, pan=0.4)
stamp(m, 14.8, 100, gain=0.45)

# ── 3 · a token: the paste, the card, three flags pop out
m.suck(17.6, 18.05, gain=0.1)
m.impact(18.0, gain=0.55)
for bar in range(9, 12):
    m.drums(bar, kick=[0, 6, 8, 14], snare=[4, 12], hats=range(0, 16, 2), root=46, hat_gain=0.08)
m.pad(18.0, chord('Bbmaj7', 2), dur=6.6, att=0.2, gain=0.17, cutoff=1400)
m.add(18.9, mouseclick(), 0.22, 0)
m.glide(18.9, 0.25, 3000, 1200, 0.05)
for i in range(3):
    m.add(19.5 + i * 0.12, blip(1600 + 200 * i), 0.05, 0.1)
for t, note in [(20.4, 64), (20.9, 62), (21.4, 76)]:
    m.whoosh(t - 0.05, 0.5, 700, 4000, 0.07, pan=0.4)
    m.add(t + 0.1, bell(midi(note)), 0.11, 0.3, 0.5)
    stamp(m, t + 0.1, 96 if note < 70 else 108, gain=0.4)

# ── 4 · end card: the window falls away, the horn, the payoff, the URL
m.suck(23.8, 24.3, gain=0.12)
m.whoosh(24.3, 1.0, 5000, 300, 0.1, pan=0)
m.kick(25.1, gain=0.6, dec=0.6)
m.add(25.15, bell(midi(76)), 0.14, -0.1, 0.6)
m.pad(25.0, chord('Cmaj9', 3), dur=5.0, att=0.4, gain=0.22, cutoff=1500)
m.impact(25.9, gain=0.8, bright=True)
stamp(m, 25.9, 98, gain=0.6)
m.add(25.95, bell(midi(83)), 0.12, 0.2, 0.6)
m.whoosh(26.55, 0.6, 2500, 7000, 0.07, pan=0.3, wet=0.1)
for k in range(10):
    m.add(26.6 + k * 0.05, tick(3000 + 90 * k), 0.03, 0.2)
m.add(27.0, blip(2200), 0.06, 0)
m.add(27.4, bell(midi(88)), 0.07, 0.1, 0.6)

m.render(drive=1.6, peak=0.7, fade_out=1.2)
