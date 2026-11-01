"""city.json's `landmarks` and `start` blocks from a city config: the one reading of those rows, bake.py's and relandmark.py's,
so a bake and a patch can't drift apart."""
import math


def landmark_rows(cfg, ll2xz, ground):
    """ll2xz(lon, lat) gives (x, z), ground(x, z) the height under a row (m)"""
    rows = []
    for lm in cfg.get('landmarks', []):
        x, z = ll2xz(lm['lon'], lm['lat'])
        rec = {'kind': lm['kind'], 'x': x, 'z': z, 'y': float(ground(x, z)), 'height': lm['height']}
        if 'points' in lm:
            rec['points'] = [list(ll2xz(lo, la)) for la, lo in lm['points']]
        if 'deck' in lm:
            rec['deck'] = [[*ll2xz(lo, la), top] for la, lo, top in lm['deck']]
        rows.append(rec)
    return rows


def start_block(cfg, ll2xz):
    sx, sz = ll2xz(cfg['start']['lon'], cfg['start']['lat'])
    return {'x': sx, 'z': sz, 'heading': math.radians(cfg['start']['heading_deg']), 'speed': cfg['start'].get('speed', 30), 'opening': cfg['start'].get('opening', '')}
