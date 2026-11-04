"""The live sky's clear tables (docs/specs/sky/LIVE.md stage B, SKY.md 4): noon, morning, golden, sunset and dawn, every row named, written to src/sky/SkyTables.ts.
   C:/Users/Utku/sb-venv/Scripts/python.exe tools/sky/tables.py [art scripts dir]
The day is today's bytes and the blue hour (and night, LIVE.md decision 2) is S1's BLUE_TABLE, both read from the sources. The others start from art's own make_palette
(research-art.md, its states.py), as BLUE_TABLE did, then take S1's rules (DECISIONS, "The held hour"):
- The sky's four rows are art's bands turned over, dark to light; the sun side's upper bands turn toward the far side's horizon, where the resolve joins them. SKY_LOW is art's far side low, FOG the haze: dark to light, its step 4 the far side's horizon, shaped as
  BLUE_TABLE's FOG is round its own. Noon and morning draw the day's sky (the resolve's sky function), so their FOG and SKY_WARM are the day's bytes and SKY_LOW is FOG.
- LIT and LAMP are the blue table's: a light has one colour at any hour.
- Rows art has no colour for are named from their kin: between the day's row and the blue table's, as far as the table's city is from the day's toward blue.
- World rows (all but paint and the bus) stop at 0.74 of the table's paint median chroma, steps 2-5 of the six hues: the one rule's 0.75, with room for the blend.
- Then art's gate: a swatch that would read brown or taupe drops to neutral chroma, 0.016 (the run-time blend clamps the same way). Exit 1 if any swatch still fails."""
import os, re, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
ART = sys.argv[1] if len(sys.argv) > 1 else 'C:/Users/Utku/sbw-main/shots/local/sky/work/sky-art-scripts'
sys.path.insert(0, ART)
import states, render  # noqa: E402
from skylib import rgb2oklab, oklab2rgb  # noqa: E402

pal_src = open(os.path.join(ROOT, 'src/render/palette.ts'), encoding='utf8').read()
RAMP = {m.group(1): int(m.group(2)) for m in re.finditer(r'^  (\w+): (\d+),', pal_src, re.M)}
NAME = {v: k for k, v in RAMP.items()}


def rows_of(src, start):
    """The `[Ramp.X]: ['#..', ...]` rows of one object literal, from `start` to its close."""
    body = src[src.index(start):]
    body = body[:body.index('\n};')]
    out = {}
    for m in re.finditer(r'\[Ramp\.(\w+)\]: \[([^\]]+)\]', body):
        out[RAMP[m.group(1)]] = re.findall(r"'(#[0-9a-f]{6})'", m.group(2))
    return out


DAY = rows_of(pal_src, 'const RAMPS')
for r, kin in (('SKY_LOW', 'FOG'), ('SAND', 'SKY_WARM'), ('RIDGE', 'GREEN_GREY'), ('FARGLOW', 'GREY')):
    DAY[RAMP[r]] = DAY[RAMP[kin]]
BLUE = rows_of(open(os.path.join(ROOT, 'src/sky/SkyTable.ts'), encoding='utf8').read(), 'export const BLUE_TABLE')
NAMED = sorted(BLUE)
PAINT = [RAMP[n] for n in ('RED', 'ORANGE', 'YELLOW', 'GREEN', 'BLUE', 'VIOLET')]
HERO = [RAMP['BUS_YELLOW'], RAMP['BUS_BLACK']]


def arr(hexes):
    return np.array([[int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)] for h in hexes])


def hexes(rgb):
    c = np.clip(np.round(np.clip(rgb, 0, 1) * 255), 0, 255).astype(int)
    return ['#%02x%02x%02x' % tuple(v) for v in c]


def lch(rgb):
    o = rgb2oklab(np.asarray(rgb, 'f8'))
    return o[..., 0], np.hypot(o[..., 1], o[..., 2]), np.degrees(np.arctan2(o[..., 2], o[..., 1])) % 360


def from_lch(L, C, h):
    return oklab2rgb(np.stack([L, C * np.cos(np.radians(h)), C * np.sin(np.radians(h))], axis=-1))


def mix(a, b, t):
    """OKLCH by the short hue arc; a grey takes the other's hue (SKY.md 4)."""
    La, Ca, ha = lch(a)
    Lb, Cb, hb = lch(b)
    ha2 = np.where(Ca < 0.012, hb, ha)
    hb2 = np.where(Cb < 0.012, ha2, hb)
    dh = ((hb2 - ha2 + 180) % 360) - 180
    return from_lch(La + (Lb - La) * t, Ca + (Cb - Ca) * t, ha2 + dh * t)


def brown(L, C, h):
    w = (h > 35) & (h < 100)
    return w & (((L < 0.6) & (C > 0.03)) | ((L < 0.72) & (C > 0.02) & (C < 0.09)))


def clamp(rgb, cap):
    L, C, h = lch(rgb)
    C = np.minimum(C, cap)
    C = np.where(brown(L, C, h), np.minimum(C, 0.016), C)
    return from_lch(L, C, h)


def paint_median(T):
    return float(np.median(np.concatenate([lch(arr(T[r][2:6]))[1] for r in PAINT])))


def city_l(T):
    return float(lch(arr(T[RAMP['GREY']]))[0].mean())


# the haze's shape round its horizon (step 4), from BLUE_TABLE: lightness and chroma as shares of the horizon's, hue as a turn from it
bL, bC, bh = lch(arr(BLUE[RAMP['FOG']]))
HAZE_L, HAZE_C, HAZE_H = bL / bL[4], bC / bC[4], ((bh - bh[4] + 180) % 360) - 180

KEYS = [('NOON', 'noon', False), ('MORNING', 'morning', False), ('GOLDEN', 'golden', True), ('SUNSET', 'sunset', True), ('DAWN', 'dawn', True)]
tables, notes = {}, []
for const, name, bands in KEYS:
    st = states.ALL[name]()
    P = render.make_palette(st)
    render.sky_rows(st, P)
    T = {}
    for n in ('GREY', 'GREY_LIGHT', 'GREEN_GREY', 'WINDOW', 'INK', 'WATER', 'RED', 'ORANGE', 'YELLOW', 'GREEN', 'BLUE', 'VIOLET', 'BUS_YELLOW', 'BUS_BLACK',
              'GLOW_WHITE', 'SIGN_GREEN', 'WHITE', 'ROOF_DARK', 'GLASS', 'STONE', 'GRANITE', 'CLOUD', 'MOON', 'SNOW', 'FARGLOW'):
        T[RAMP[n]] = hexes(P[RAMP[n]])
    for n in ('LIT', 'LAMP'):
        T[RAMP[n]] = BLUE[RAMP[n]]
    T[RAMP['NIGHT_SKY']] = hexes(P[RAMP['NIGHT_SKY']][::-1])
    T[RAMP['TWILIGHT']] = hexes(P[RAMP['TWILIGHT']][::-1])  # (the bands' tables turn it toward the far horizon below)
    if bands:
        T[RAMP['SKY_LOW']] = hexes(P[RAMP['FOG']][::-1])
        # (the resolve's sky is one field: the sun side's 14 degrees is the far side's horizon. Art's blue hour meets there and its other tables don't,
        # so from 2.9 degrees up the sun side turns toward the far horizon, there by 14: no seam up the sky)
        sun = np.concatenate([P[RAMP['SKY_WARM']], P[RAMP['TWILIGHT']]])
        far = P[RAMP['FOG']][0:1]
        for i in range(6, 16):
            sun[i] = mix(sun[i:i + 1], far, min(1.0, (i - 5) / 6))[0]
        T[RAMP['SKY_WARM']] = hexes(sun[:8][::-1])
        T[RAMP['TWILIGHT']] = hexes(sun[8:][::-1])
        hL, hC, hh = lch(arr(T[RAMP['SKY_LOW']][7:8]))
        # (under the horizon its lightness a share of the horizon's, over it the same share of what is left to white: a bright horizon has less room)
        up = hL + (1 - hL) * (bL - bL[4]) / (1 - bL[4])
        T[RAMP['FOG']] = hexes(from_lch(np.where(np.arange(8) > 4, up, hL * HAZE_L), hC * HAZE_C, hh + HAZE_H))
    else:
        for n in ('FOG', 'SKY_WARM'):
            T[RAMP[n]] = DAY[RAMP[n]]
        T[RAMP['SKY_LOW']] = DAY[RAMP['FOG']]
    # (kin: as far toward the blue table's row as this table's city is toward blue's)
    t = float(np.clip((city_l(DAY) - city_l(T)) / (city_l(DAY) - city_l(BLUE)), 0, 1))
    for n in ('BRIDGE_ORANGE', 'RIDGE', 'SAND', 'CLOUD_SHADE'):
        r = RAMP[n]
        day = DAY.get(r)
        if day is None:  # (the day names no cloud shade: its own cloud a step down)
            cL, cC, ch = lch(arr(T[RAMP['CLOUD']]))
            day = hexes(from_lch(cL * 0.75, cC, ch))
        T[r] = hexes(mix(arr(day), arr(BLUE[r]), t))
    T[RAMP['OPEN_SEA']] = T[RAMP['WATER']]
    T[RAMP['LIMB']] = T[RAMP['FOG']]
    T[RAMP['DRY_LAND']] = T[RAMP['SAND']]
    cap = 0.74 * paint_median(T)
    for r in NAMED:
        if r in PAINT or r in HERO:
            continue
        T[r] = hexes(clamp(arr(T[r]), cap))
    missing = [NAME[r] for r in NAMED if r not in T]
    if missing:
        sys.exit(f'{name}: no row for {missing}')
    bad = [(NAME[r], s) for r in NAMED for s in range(8) if r not in PAINT and r not in HERO and brown(*[v[s] for v in lch(arr(T[r]))])]
    peak = max(float(lch(arr(T[r]))[1].max()) for r in NAMED if r not in PAINT and r not in HERO)
    notes.append(f'{name}: kin {t:.2f}, paint median {cap / 0.74:.4f}, world peak {peak:.4f} ({peak / (cap / 0.74):.3f}), brown {len(bad)}')
    if bad:
        print(name, 'brown', bad)
    tables[const] = T

# The day names the rows it never draws too, for the blend: noon's sky rows and lights, and its own kin for the rest.
DAYT = dict(DAY)
N = tables['NOON']
for n in ('NIGHT_SKY', 'TWILIGHT', 'CLOUD', 'MOON', 'SNOW', 'LIT', 'LAMP', 'CLOUD_SHADE'):
    DAYT[RAMP[n]] = N[RAMP[n]]
DAYT[RAMP['OPEN_SEA']] = DAY[RAMP['WATER']]
DAYT[RAMP['LIMB']] = DAY[RAMP['FOG']]
DAYT[RAMP['DRY_LAND']] = DAY[RAMP['SAND']]
extra = {r: DAYT[r] for r in NAMED if r not in DAY}

out = ['// Written by tools/sky/tables.py: run it again, don\'t edit by hand. The live sky\'s clear tables (LIVE.md stage B, SKY.md 4): every row named, dark to light.',
       '// ' + '; '.join(notes) + '.', '',
       "import { Ramp } from '../render/palette';", '']


def emit(const, T, doc):
    out.append(f'/** {doc} */')
    out.append(f'export const {const}: Record<number, string[]> = {{')
    for r in sorted(T):
        out.append(f"  [Ramp.{NAME[r]}]: [{', '.join(repr(h) for h in T[r])}],")
    out.append('};')
    out.append('')


emit('DAY_EXTRA', extra, "The rows today's table doesn't name, which the day keyframe needs for the blend: noon's sky rows and lights, the rest from today's kin.")
docs = {'NOON': 'Noon, the Sun 35 degrees up and higher: cleaner, cooler top steps, a deeper shade step. The day\'s sky.',
        'MORNING': 'Morning, the rising Sun at 16 degrees: crisp, cream light. The day\'s sky.',
        'GOLDEN': 'Golden hour, the setting Sun at 7 degrees: honey-rose, paint\'s own hour. The bands\' sky.',
        'SUNSET': 'Sunset, the setting Sun at 1.5 degrees: rose-gold on what stands tall, deep violet shade. The bands\' sky.',
        'DAWN': 'Dawn, the rising Sun at 1 degree: peach, a backlit city, cool violet shade. The bands\' sky.'}
for const, _, _ in KEYS:
    emit(const + '_TABLE', tables[const], docs[const])
open(os.path.join(ROOT, 'src/sky/SkyTables.ts'), 'w', encoding='utf8', newline='\n').write('\n'.join(out))
print('\n'.join(notes))
