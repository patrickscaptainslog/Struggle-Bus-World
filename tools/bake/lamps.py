#!/usr/bin/env python3
"""A city's street lamps, from the road list the bake itself reads (docs/specs/sky/SKY.md 4.4):

  python -I tools/bake/lamps.py sf london amsterdam   ->  public/city/<slug>/lamps.bin

Every drivable class but `service`, named or not (OSM's names thin out fast outside the rich world, its roads don't): a lamp every 38 m,
alternating sides, 7 m off the centre line. No heights: the game reads them from far.bin in a worker at load. Only what stands inside the
bake's bounds: nothing lights a shore past them.

The file, gzip'd ('SBL1', little-endian; reader: src/sky/lampWorker.ts):
  magic[4], u32 chunks, f32 grid (2 m), f32 chunk (4000 m)
  chunks * { i16 ci, i16 cj, u32 n }
  then each chunk's lamps in that order: u16 dx[n], u16 dz[n]: steps of the grid from the chunk's corner, sorted by z then x and delta coded,
  each value the difference from the one before it modulo 65536

The road list is OpenStreetMap through Overture: the file is a derivative database, ODbL (public/city/DATA_LICENSE.md). The Overture extracts
are read, never written: point SB_OVERTURE_CACHE at them from a worktree.
"""
import gzip
import json
import os
import struct
import sys

import numpy as np
from pyproj import Transformer

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import osm as OSMmod  # noqa: E402

SPACING = 38.0   # m along a road
OFFSET = 7.0     # m off its centre line
SHORTEST = 8.0   # m: a stub gets no lamp
GRID = 2.0       # m
CHUNK = 4000.0   # m
ROOT = os.path.join(HERE, '..', '..', 'public', 'city')


def lamps_of(lines):
    """(x, z) of every lamp, walking each line once: the first at half a spacing (or mid line), then every SPACING, the side flipping each time."""
    xs, zs = [], []
    for line in lines:
        c = np.asarray(line.coords)[:, :2]
        if c.shape[0] < 2:
            continue
        d = np.hypot(*(c[1:] - c[:-1]).T)
        keep = d > 1e-6
        if not keep.all():
            c = c[np.concatenate([[True], keep])]
            d = d[keep]
            if c.shape[0] < 2:
                continue
        s = np.concatenate([[0.0], np.cumsum(d)])
        if s[-1] < SHORTEST:
            continue
        u = np.arange(min(SPACING / 2, s[-1] / 2), s[-1], SPACING)
        x = np.interp(u, s, c[:, 0])
        z = np.interp(u, s, c[:, 1])
        # the segment each lamp stands on, for the way off the line
        k = np.clip(np.searchsorted(s, u, side='right') - 1, 0, d.size - 1)
        tx, tz = (c[k + 1, 0] - c[k, 0]) / d[k], (c[k + 1, 1] - c[k, 1]) / d[k]
        side = np.where(np.arange(u.size) % 2 == 0, 1.0, -1.0)
        xs.append(x - tz * OFFSET * side)
        zs.append(z + tx * OFFSET * side)
    return np.concatenate(xs), np.concatenate(zs)


def pack(x, z):
    ci = np.floor(x / CHUNK).astype('i4')
    cj = np.floor(z / CHUNK).astype('i4')
    ix = np.round((x - ci * CHUNK) / GRID).astype('i4')
    iz = np.round((z - cj * CHUNK) / GRID).astype('i4')
    order = np.lexsort((ix, iz, ci, cj))
    ci, cj, ix, iz = ci[order], cj[order], ix[order], iz[order]
    # one lamp to a grid cell: two ways that cross stand a lamp in the same place
    q = (cj.astype('i8') * 100000 + ci) * 10000000 + iz.astype('i8') * 3000 + ix
    keep = np.concatenate([[True], q[1:] != q[:-1]])
    ci, cj, ix, iz = ci[keep], cj[keep], ix[keep], iz[keep]
    chunks = sorted({(int(a), int(b)) for a, b in zip(ci, cj)}, key=lambda t: (t[1], t[0]))
    head = [b'SBL1', struct.pack('<Iff', len(chunks), GRID, CHUNK)]
    body = []
    for a, b in chunks:
        m = (ci == a) & (cj == b)
        n = int(m.sum())
        head.append(struct.pack('<hhI', a, b, n))
        for v in (ix[m], iz[m]):
            dv = v.copy()
            dv[1:] = v[1:] - v[:-1]
            body.append((dv & 0xffff).astype('<u2').tobytes())
    return b''.join(head) + b''.join(body), int(keep.sum()), len(chunks)


def main(slugs):
    for slug in slugs:
        cfg = json.load(open(os.path.join(HERE, 'cities', f'{slug}.json'), encoding='utf8'))
        man = json.load(open(os.path.join(ROOT, slug, 'city.json'), encoding='utf8'))
        to_local = Transformer.from_crs('EPSG:4326', man['proj'], always_xy=True)
        o = OSMmod.OSM(cfg, slug, to_local, lambda s: None)
        b = man['bounds']
        o.set_frame(b[0], b[1], b[2], b[3])
        lines = [line for line, kind, _, _, cls in o.segments() if kind == OSMmod.PAVED and cls != 'service']
        x, z = lamps_of(lines)
        inb = (x >= b[0]) & (x <= b[2]) & (z >= b[1]) & (z <= b[3])
        raw, n, nc = pack(x[inb], z[inb])
        out = os.path.join(ROOT, slug, 'lamps.bin')
        gz = gzip.compress(raw, 9, mtime=0)
        with open(out, 'wb') as f:
            f.write(gz)
        print(f'{slug}: {len(lines)} roads, {n} lamps in {nc} chunks, {len(raw)} B, gzip {len(gz)} B -> {os.path.normpath(out)}', flush=True)


if __name__ == '__main__':
    main(sys.argv[1:] or ['sf'])
