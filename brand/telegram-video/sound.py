"""Mimir × Telegram: soundtrack on the scene's clock (120 BPM, bar = 2 s, step = 125 ms), 20 s.
Every time below mirrors T in scene.js. Brighter than the earlier clips: a counter that ticks up while the
grid fills, a hard hit on the red cut, then a light groove under the phone with a message "pop" per bubble.
Run from an ft-motion checkout: python examples/mimir-telegram/sound.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'audio'))
from ftsynth import *  # noqa: E402,F403
from ftextras import stamp, tick, counter_ticks, glitch_burst, tom  # noqa: E402

m = Mix.from_project(__file__)
at, step = m.at, m.step
FILL, FULL, RED, USERS, CUT, TG, HANDLE = at(0, 1), at(1, 6), at(1, 8), at(2), at(2, 8), at(2, 10), at(2, 12)
START, LINK, NEW, BETS, WON, PRICE, APP = at(3, 4), at(4, 4), at(5, 4), at(6), at(6, 12), at(7, 4), at(8)
END, HORN, BOT, URL = at(8, 12), at(8, 14), at(9, 2), at(9, 6)

# message arrivals (scene.js buildChat): user bubbles and bot bubbles
USER_MSGS = [START + 0.05, BETS + 0.05, PRICE + 0.05]
BOT_MSGS = [START + 0.45, START + 0.85, LINK + 1.15, NEW + 0.1, BETS + 0.4, WON + 0.1, PRICE + 0.4]


def sweep(t, pan=0.0):
    m.whoosh(t - 0.3, 0.45, 600, 5000, 0.11, pan=pan)


# ── act 1: the grid fills, the clock runs, the count ticks up
m.pad(0.0, chord('Fmaj9', 2), dur=RED, att=0.5, gain=0.16, cutoff=900)
counter_ticks(m, FILL, FULL - FILL, 40, f0=900, f1=3200, gain=0.05)
for b in range(0, 2):
    m.drums(b, kick=[0, 8], hats=range(2, 16, 4), hat_gain=0.035, root=41)
m.glide(FULL - 0.6, 0.6, 400, 1600, 0.05, wet=0.2)

# ── act 2: the red cut, the giant number
sweep(RED, pan=-0.2)
m.impact(RED, gain=0.65, bright=True)
stamp(m, RED, 64, gain=0.9)
m.pad(RED, chord('Am9', 2), dur=CUT - RED, att=0.05, gain=0.18, cutoff=1400)
m.add(USERS, bell(midi(81)), 0.12, 0.2, 0.5)
m.add(USERS + 0.12, bell(midi(84)), 0.08, -0.2, 0.5)

# ── act 3: the phone swings in, a light groove, a pop per message
sweep(CUT, pan=0.4)
m.add(CUT + 0.2, tom(110, 0.14), 0.45, 0.2)
stamp(m, TG, 92, gain=0.5)
m.add(HANDLE, blip(1800), 0.07, 0.3)
roots = [41, 45, 43, 48, 46, 45]
for b in range(3, 9):
    m.drums(b, kick=[0, 6, 8, 14], snare=[4, 12], hats=range(0, 16, 2), hat_gain=0.04, root=roots[b - 3])
m.pad(START, chord('Dm9', 2), dur=NEW - START, att=0.15, gain=0.14, cutoff=1300)
m.pad(NEW, chord('Bbmaj7', 2), dur=WON - NEW, att=0.15, gain=0.14, cutoff=1400)
m.pad(WON, chord('Cadd9', 3), dur=END - WON, att=0.1, gain=0.15, cutoff=1600)
for t0 in USER_MSGS:
    m.typing(t0 - 0.35, t0 - 0.05, 6, gain=0.05)
    m.add(t0, pop(900), 0.14, 0.3, 0.2)
for t0 in BOT_MSGS:
    m.add(t0, pop(620), 0.15, -0.3, 0.2)
    m.add(t0 + 0.02, pluck(midi(76)), 0.08, -0.2, 0.3)
# link: the tap, the signature, the check
m.add(LINK + 0.1, mouseclick(), 0.2, -0.2)
m.whoosh(LINK + 0.3, 0.3, 500, 2500, 0.06, pan=0.2)
m.add(LINK + 0.75, mouseclick(), 0.2, 0.2)
m.add(LINK + 0.8, bell(midi(83)), 0.1, 0.2, 0.5)
# the push notification
m.add(NEW - 0.15, bell(midi(88)), 0.1, 0.4, 0.6)
m.add(NEW - 0.05, bell(midi(84)), 0.08, 0.4, 0.6)
# the win
stamp(m, WON + 0.1, 100, gain=0.55)
for k, n in enumerate([72, 76, 79, 84]):
    m.add(WON + 0.12 + k * 0.06, bell(midi(n)), 0.08, -0.3 + 0.2 * k, 0.5)
# open the app
m.add(APP + 0.15, mouseclick(), 0.2, -0.3)
m.whoosh(APP + 0.3, 0.5, 400, 3200, 0.09, pan=0.2)

# ── act 4: the end card
sweep(END, pan=-0.4)
m.kick(HORN, gain=0.6, dec=0.6)
m.add(HORN + 0.05, bell(midi(76)), 0.14, -0.1, 0.6)
m.pad(END, chord('Fmaj9', 3), dur=20 - END, att=0.3, gain=0.22, cutoff=1500)
m.add(BOT, bell(midi(81)), 0.1, 0, 0.6)
m.add(URL, blip(2200), 0.06, 0)
m.add(URL + 0.08, bell(midi(88)), 0.06, 0.1, 0.6)

m.render(drive=1.5, peak=0.68, fade_out=0.9)
