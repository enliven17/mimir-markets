"""Mimir launch: soundtrack on the scene's clock (120 BPM, bar = 2 s, step = 125 ms).
Every time below mirrors T in scene.js. Run from an ft-motion checkout: python examples/mimir-launch/sound.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'audio'))
from ftsynth import *  # noqa: E402,F403
from ftextras import stamp, tick, counter_ticks  # noqa: E402

m = Mix.from_project(__file__)
at, step = m.at, m.step
SCRIB, HERO_OUT, CARD, CREATOR = at(0, 11), at(1, 8), at(1, 10), at(1, 14)
CHALLENGE, STAKE0, CLOSE, RESOLVE, EVID = at(2, 8), at(2, 10), at(4), at(4, 4), at(4, 6)
VERDICT, CONF, HASH, DISPUTE, COUNCIL, VOTE0 = at(5), at(5, 2), at(5, 4), at(5, 6), at(5, 12), at(6)
FIRM, PAYOUT, PULL0, END, HORN, SLOGAN, URL = at(6, 10), at(7), at(7, 4), at(8, 4), at(8, 6), at(8, 10), at(9)
stake_at = lambda i: STAKE0 + i * 2 * step
vote_at = lambda i: VOTE0 + i * 0.5 * step
pop_at = lambda i: COUNCIL + 0.12 + i * 0.03
pull_at = lambda i: PULL0 + i * 2 * step
row_at = lambda i: PAYOUT + 0.2 + i * step
YES = {0, 5, 9}  # optimist, crypto-maxi, yapper

# ── hero: the slogan dithers in over a low pad, the scribble scratches under "Settle."
m.pad(0.0, chord('Am9', 2), dur=CARD + 0.4, att=0.9, gain=0.2, cutoff=650)
m.whoosh(0.1, 1.0, 400, 2600, 0.08, pan=-0.2)
m.add(0.15, bell(midi(69)), 0.08, -0.2, 0.6)
m.kick(0.15, gain=0.35, dec=0.5)
m.whoosh(SCRIB, 0.6, 2500, 7000, 0.07, pan=0.3, wet=0.1)
for k in range(10):
    m.add(SCRIB + k * 0.065, tick(3000 + 90 * k), 0.035, 0.2 + k * 0.03)
m.whoosh(HERO_OUT, 0.5, 3000, 500, 0.12)

# ── 1 · create: the card lands, the creator stakes
m.kick(CARD, gain=0.6)
m.whoosh(CARD - 0.25, 0.5, 300, 3400, 0.12)
m.add(CREATOR, pop(620), 0.2, -0.1, 0.25)
m.add(CREATOR + 0.02, pluck(midi(64)), 0.14, 0, 0.3)
m.pad(CARD + 0.4, chord('Fmaj9', 2), dur=CHALLENGE - CARD, att=0.4, gain=0.18, cutoff=1000)

# ── 2 · challenge: drums in, eight stakes pop on the rollup, the clock ticks to the deadline
m.whoosh(CHALLENGE - 0.2, 0.4, 500, 4000, 0.1)
m.drums(2, kick=[8, 14], hats=range(8, 16, 2), root=41, hat_gain=0.07)
m.drums(3, kick=[0, 6, 8, 14], snare=[4, 12], hats=range(0, 16, 2), root=43, hat_gain=0.08)
m.pad(CHALLENGE, chord('Cadd9', 3), dur=CLOSE - CHALLENGE, att=0.2, gain=0.17, cutoff=1500)
scale = [64, 67, 69, 71, 72, 74, 76, 79]
for i in range(8):
    t = stake_at(i)
    m.add(t, pop(640 + 45 * i), 0.18, 0.5 - (i % 2) * 0.2, 0.2)
    m.add(t + 0.01, pluck(midi(scale[i])), 0.12, 0.3, 0.35)
    m.add(t + 0.03, blip(2400 + 80 * i), 0.05, 0.6)
for k in range(10):  # the clock: one tick per half second, the last three brighter
    t = CLOSE - (10 - k) * 0.5
    if t >= CARD:
        m.add(t, tick(1800 if k < 7 else 2600), 0.06 if k < 7 else 0.12, -0.3)
m.riser(CLOSE - 1.5, CLOSE, f0=300, f1=6000, gain=0.2)

# ── deadline: the hit, then quiet while the oracle reads
m.impact(CLOSE, gain=0.85, bright=True)
m.pad(CLOSE, chord('Dm9', 2), dur=VERDICT - CLOSE + 0.2, att=0.6, gain=0.18, cutoff=700)
m.whoosh(RESOLVE - 0.15, 0.5, 600, 3000, 0.1, pan=0.3)
for i in range(3):
    t0 = EVID + i * 0.375
    m.typing(t0, t0 + 0.3, 30, gain=0.09)
m.glide(EVID, VERDICT - EVID, 900, 1400, 0.04, wet=0.3)

# ── 3 · verdict: a stamp, the confidence rolls, the hash types, the dispute window runs
stamp(m, VERDICT, 98, gain=0.75)
m.add(VERDICT, bell(midi(74)), 0.1, 0, 0.6)
counter_ticks(m, CONF, 0.4, 9, gain=0.08)
m.typing(HASH, HASH + 0.3, 14, gain=0.08)
m.whoosh(DISPUTE + 0.1, COUNCIL - DISPUTE - 0.1, 400, 2200, 0.07, pan=-0.3)
m.pad(VERDICT, chord('Bbmaj7', 2), dur=COUNCIL - VERDICT + 0.3, att=0.1, gain=0.18, cutoff=1300)

# ── council: twenty jurors pop in, then vote one by one
m.whoosh(COUNCIL - 0.2, 0.45, 500, 3500, 0.1)
for i in range(20):
    m.add(pop_at(i), pop(700 + 25 * i), 0.07, -0.6 + i * 0.06, 0.2)
for i in range(20):
    m.add(vote_at(i), blip(1760 if i in YES else 1320), 0.1, -0.6 + i * 0.06, 0.2)
m.drums(6, kick=[0, 8], hats=range(0, 12, 1), hat_gain=0.05, root=45)
m.pad(COUNCIL + 0.3, chord('Am9', 3), dur=PAYOUT - COUNCIL - 0.3, att=0.3, gain=0.17, cutoff=1500)
m.add(FIRM, bell(midi(81)), 0.14, 0.2, 0.5)
m.drums(6, kick=[14], snare=[12], hats=range(12, 16, 1), hat_gain=0.06)

# ── 4 · payout: the drop, rows land, each pull clicks and chimes
m.impact(PAYOUT, gain=0.7, bright=False)
m.drums(7, kick=[0, 6, 8, 14], snare=[4, 12], hats=range(0, 16, 2), root=41, hat_gain=0.08)
m.drums(8, kick=[0], hats=range(0, 4, 2), root=41, hat_gain=0.06)
m.pad(PAYOUT, chord('Fmaj9', 3), dur=END - PAYOUT + 0.3, att=0.1, gain=0.2, cutoff=1900)
for i in range(4):
    m.add(row_at(i), pop(760 + 60 * i), 0.12, 0.3, 0.2)
    m.add(pull_at(i), mouseclick(), 0.22, 0.4)
    m.add(pull_at(i) + 0.03, bell(midi([72, 76, 79, 84][i])), 0.1, 0.35, 0.5)

# ── end card: everything dithers off, the horn and the slogan on the brightest chord
m.suck(END - 0.5, END + 0.05, gain=0.14)
m.kick(HORN, gain=0.55, dec=0.6)
m.pad(END, chord('Cmaj9', 3), dur=20 - END, att=0.5, gain=0.22, cutoff=1500)
m.add(HORN + 0.05, bell(midi(76)), 0.16, -0.1, 0.6)
m.add(HORN + 0.3, bell(midi(83)), 0.1, 0.2, 0.6)
m.whoosh(SLOGAN, 0.8, 500, 2600, 0.08)
for k in range(10):
    m.add(SLOGAN + 0.6 + k * 0.065, tick(3000 + 90 * k), 0.03, 0.2)
m.add(URL, blip(2200), 0.06, 0)
m.add(URL + 0.08, bell(midi(88)), 0.06, 0.1, 0.6)

m.render(drive=1.6, peak=0.78, fade_out=0.6)
