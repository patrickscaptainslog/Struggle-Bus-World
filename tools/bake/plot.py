#!/usr/bin/env python3
"""Top-down QA plots of baked cities, side by side (old vs new): ground classes, footprints (every lot
line, shaded by height), roof shapes, trees, street names. No browser needed.

usage: python3 -I tools/bake/plot.py <out.png> --at=<lat>,<lon>[,<radius m>] [--title=...] [--names] <cityDir> [<cityDir> ...]
       (each cityDir: a baked public/city/<slug> or a copy; label it with dir=label)
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import matplotlib  # noqa: E402

matplotlib.use('Agg')
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.collections import PolyCollection  # noqa: E402

from citydata import City  # noqa: E402

# QA colours per ground class (src/world/tiles.ts Ground), not the game's palette
CLASS_RGB = {0: (0.30, 0.31, 0.33), 1: (0.55, 0.68, 0.50), 2: (0.36, 0.52, 0.70), 3: (0.74, 0.74, 0.72), 4: (0.85, 0.82, 0.74),
             5: (0.80, 0.72, 0.56), 6: (0.93, 0.87, 0.64), 7: (0.45, 0.36, 0.42), 8: (0.30, 0.47, 0.30), 9: (0.62, 0.66, 0.56),
             10: (0.62, 0.58, 0.58)}
CLASS_NAME = ['road', 'grass', 'water', 'sidewalk', 'plaza', 'path', 'sand', 'rail', 'forest', 'yard', 'rock']
ROOF_MARK = {2: '^', 3: 'D', 4: 'P', 5: '>', 6: 'o', 7: 'o', 8: 's', 9: 'v', 10: 'h', 11: 'd', 12: '<', 13: '*'}


def panel(ax, city, x, z, r, label, names=False):
    near = city.tiles_around(x, z, r + 40)
    T = city.manifest['tileSize']
    n = city.classN
    img = np.ones((int(2 * r / 2) + 1, int(2 * r / 2) + 1, 3))
    trees = []
    streets = []
    for t in city.terrain_tiles(near):
        cls = t['cls']
        # paste the tile's 2 m class texture into the panel image
        ox, oz = t['originX'], t['originZ']
        i0 = int(round((ox - (x - r)) / 2.0))
        j0 = int(round((oz - (z - r)) / 2.0))
        rgb = np.zeros((n, n, 3))
        for k, c in CLASS_RGB.items():
            rgb[cls == k] = c
        ii0, jj0 = max(0, i0), max(0, j0)
        ii1, jj1 = min(img.shape[1], i0 + n), min(img.shape[0], j0 + n)
        if ii1 > ii0 and jj1 > jj0:
            img[jj0:jj1, ii0:ii1] = rgb[jj0 - j0:jj1 - j0, ii0 - i0:ii1 - i0]
        trees += [(tr[0], tr[1], tr[4]) for tr in t['trees'] if abs(tr[0] - x) < r and abs(tr[1] - z) < r]
        streets += t['streets']
    ax.imshow(img, extent=(x - r, x + r, z + r, z - r), interpolation='nearest')
    polys, hs, edge = [], [], []
    marks = []
    nb = 0
    for t in city.building_tiles(near):
        vs, xz = t['vertStart'], t['xz']
        for i in range(t['count']):
            ring = xz[vs[i]:vs[i + 1]]
            if not len(ring) or np.abs(ring[:, 0] - x).min() > r + 30 or np.abs(ring[:, 1] - z).min() > r + 30:
                continue
            polys.append(ring)
            hs.append(t['roofY'][i] + t['roofH'][i] - t['groundY'][i])
            edge.append(1.2 if t['tier'][i] == 0 else 0.5)
            if t['tier'][i] == 0 and (i == 0 or t['index'][i - 1] != t['index'][i]):
                nb += 1
            if t['roofShape'][i] in ROOF_MARK:
                c = ring.mean(axis=0)
                marks.append((c[0], c[1], ROOF_MARK[t['roofShape'][i]]))
    order = np.argsort(hs)
    pc = PolyCollection([polys[k] for k in order], array=np.array([hs[k] for k in order]), cmap='magma', clim=(0, 45),
                        edgecolors='k', linewidths=[edge[k] * 0.35 for k in order], alpha=0.92)
    ax.add_collection(pc)
    if trees:
        tt = np.array([(a, b) for a, b, _ in trees])
        ax.scatter(tt[:, 0], tt[:, 1], s=6, c=[(0.12, 0.42, 0.18)], marker='o', linewidths=0)
    for mx, mz, m in marks:
        ax.plot(mx, mz, marker=m, ms=3.5, mfc='cyan', mec='k', mew=0.3)
    if names and streets:
        seen = set()
        for nm, rank, c in streets:
            if rank or nm in seen or len(c) < 2:
                continue
            mid = c[len(c) // 2]
            if abs(mid[0] - x) > r * 0.9 or abs(mid[1] - z) > r * 0.9:
                continue
            seen.add(nm)
            d = c[-1] - c[0]
            ang = -np.degrees(np.arctan2(d[1], d[0]))
            if ang > 90:
                ang -= 180
            if ang < -90:
                ang += 180
            ax.text(mid[0], mid[1], nm.upper(), fontsize=5, color='w', rotation=ang, ha='center', va='center',
                    bbox=dict(boxstyle='round,pad=0.1', fc=(0, 0.3, 0.2, 0.8), ec='none'))
    ax.set_xlim(x - r, x + r)
    ax.set_ylim(z + r, z - r)
    ax.set_aspect('equal')
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_title(f'{label}: {nb} buildings, {len(polys)} parts, {len(trees)} trees', fontsize=8)
    return pc


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = dict((a[2:].split('=', 1) + [''])[:2] for a in sys.argv[1:] if a.startswith('--'))
    out, dirs = args[0], args[1:]
    at = [float(v) for v in flags['at'].split(',')]
    lat, lon = at[0], at[1]
    r = at[2] if len(at) > 2 else 220.0
    fig, axs = plt.subplots(1, len(dirs), figsize=(6.2 * len(dirs), 6.6), dpi=170)
    axs = np.atleast_1d(axs)
    pc = None
    for ax, d in zip(axs, dirs):
        path, label = (d.split('=', 1) + [None])[:2]
        c = City(path)
        x, z = c.ll2xz(lat, lon)
        pc = panel(ax, c, x, z, r, label or os.path.basename(path.rstrip('/')), names='names' in flags)
    fig.suptitle(flags.get('title', f'{lat:.5f}, {lon:.5f}'), fontsize=10)
    if pc is not None:
        cb = fig.colorbar(pc, ax=list(axs), fraction=0.02, pad=0.01)
        cb.set_label('height (m)', fontsize=7)
    handles = [plt.Line2D([], [], marker='s', ls='', mfc=CLASS_RGB[k], mec='k', mew=0.2, ms=6, label=CLASS_NAME[k]) for k in CLASS_RGB]
    fig.legend(handles=handles, loc='lower center', ncol=11, fontsize=6, frameon=False)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    fig.savefig(out, bbox_inches='tight')
    print('wrote', out)


if __name__ == '__main__':
    main()
