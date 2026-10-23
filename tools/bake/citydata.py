#!/usr/bin/env python3
"""Read a baked city (public/city/<slug>/, packed regions or raw b_/t_ tiles) in Python: QA plots,
counts and comparisons without a browser. Mirrors the readers in src/world/tiles.ts.

  from citydata import City
  c = City('public/city/sf')
  for t in c.building_tiles(): ...    # dicts of numpy arrays per tile (SBB1/2/3)
  for t in c.terrain_tiles(): ...     # SBT1/2 (+ streets and the hood grid for SBT2)
"""
import gzip
import json
import os
import struct

import numpy as np


def parse_buildings(buf):
    magic = buf[:4].decode()
    if magic not in ('SBB1', 'SBB2', 'SBB3'):
        raise ValueError('bad building tile ' + magic)
    v = int(magic[3])
    count, vc, ox, oz = struct.unpack_from('<IIff', buf, 4)
    o = 24

    def arr(dt, n):
        nonlocal o
        a = np.frombuffer(buf, dtype=dt, count=n, offset=o).copy()
        o += a.nbytes
        return a
    t = {'magic': magic, 'count': count, 'originX': ox, 'originZ': oz}
    t['index'] = arr('<u4', count)
    t['stableId'] = arr('<u4', count)
    t['vertStart'] = arr('<u4', count + 1)
    t['baseY'] = arr('<f4', count)
    t['roofY'] = arr('<f4', count)
    t['groundY'] = arr('<f4', count) if v >= 2 else t['baseY'].copy()
    if v >= 3:
        t['facadeColor'] = arr('<u4', count)
        t['roofColor'] = arr('<u4', count)
        t['roofH'] = arr('<u2', count).astype(np.float32) / 10.0
    for k in ('arch', 'floors', 'front', 'front2', 'hood', 'seed'):
        t[k] = arr('u1', count)
    t['tier'] = arr('u1', count) if v >= 2 else np.zeros(count, np.uint8)
    t['taper'] = arr('u1', count) if v >= 2 else np.zeros(count, np.uint8)
    if v >= 3:
        for k in ('roofShape', 'roofDir', 'facadeMat', 'roofMat', 'source'):
            t[k] = arr('u1', count)
    else:
        for k in ('roofShape', 'roofDir', 'facadeMat', 'roofMat', 'source', 'facadeColor', 'roofColor'):
            t[k] = np.zeros(count, np.uint32 if 'Color' in k else np.uint8)
        t['roofH'] = np.zeros(count, np.float32)
    o += (-o) % 4
    vx = arr('<i2', vc).astype(np.float64) / 10 + ox
    vz = arr('<i2', vc).astype(np.float64) / 10 + oz
    t['xz'] = np.column_stack([vx, vz])
    return t


def parse_terrain(buf, classN=128):
    magic = buf[:4].decode()
    if magic not in ('SBT1', 'SBT2'):
        raise ValueError('bad terrain tile ' + magic)
    tx, tz, n, obstN, cell, ox, oz = struct.unpack_from('<iiHHfff', buf, 4)
    o = 28
    h = np.frombuffer(buf, '<i2', n * n, o).astype(np.float32) / 10
    o += n * n * 2 + n * n
    o += (-o) % 4
    obst = np.frombuffer(buf, '<i2', obstN * obstN, o).astype(np.float32) / 10
    o += obstN * obstN * 2
    tc = struct.unpack_from('<H', buf, o)[0]
    o += 4
    trees = []
    for i in range(tc):
        x, z, y, s, k = struct.unpack_from('<hhhBB', buf, o)
        trees.append((ox + x / 10, oz + z / 10, y / 10, s / 100, k))
        o += 8
    o += (-o) % 4
    cls = np.frombuffer(buf, 'u1', classN * classN, o).reshape(classN, classN).copy()
    o += classN * classN
    t = {'magic': magic, 'tx': tx, 'tz': tz, 'n': n, 'cell': cell, 'originX': ox, 'originZ': oz, 'heights': h.reshape(n, n),
         'obst': obst.reshape(obstN, obstN), 'trees': trees, 'cls': cls, 'streets': [], 'names': [], 'hood': None}
    if magic == 'SBT2':
        o += (-o) % 4
        t['hood'] = np.frombuffer(buf, 'u1', 64, o).reshape(8, 8).copy()
        o += 64
        nn, nl = struct.unpack_from('<HH', buf, o)
        o += 4
        for _ in range(nn):
            L = buf[o]
            t['names'].append(buf[o + 1:o + 1 + L].decode('utf-8'))
            o += 1 + L
        o += o % 2
        for _ in range(nl):
            ni, rank, nv = struct.unpack_from('<HBB', buf, o)
            o += 4
            c = np.frombuffer(buf, '<i2', nv * 2, o).reshape(nv, 2).astype(np.float64) / 10 + [ox, oz]
            o += nv * 4
            t['streets'].append((t['names'][ni], rank, c))
    return t


class City:
    def __init__(self, path):
        self.path = path
        self.manifest = json.load(open(os.path.join(path, 'city.json')))
        self.classN = self.manifest.get('classN', 128)

    def _payloads(self, near=None):
        """(kind, tx, tz, bytes) for every tile (near: only the regions holding these (tx, tz)): packed regions
        if present, else raw tiles."""
        files = os.listdir(self.path)
        regs = [f for f in files if f.startswith('r_') and f.endswith('.bin')]
        if near is not None and regs:
            rs = self.manifest.get('regionSize', 4)
            want = {f'r_{tx // rs}_{tz // rs}.bin' for tx, tz in near}
            regs = [f for f in regs if f in want]
        if regs:
            for f in sorted(regs):
                buf = open(os.path.join(self.path, f), 'rb').read()
                if buf[:2] == b'\x1f\x8b':
                    buf = gzip.decompress(buf)
                cnt = struct.unpack_from('<I', buf, 4)[0]
                for i in range(cnt):
                    tx, tz, bo, bl, to, tl = struct.unpack_from('<iiIIII', buf, 8 + i * 24)
                    if bl:
                        yield 'b', tx, tz, buf[bo:bo + bl]
                    if tl:
                        yield 't', tx, tz, buf[to:to + tl]
        else:
            for f in sorted(files):
                if f.endswith('.bin') and f[:2] in ('b_', 't_'):
                    tx, tz = (int(v) for v in f[2:-4].split('_'))
                    yield f[0], tx, tz, open(os.path.join(self.path, f), 'rb').read()

    def building_tiles(self, near=None):
        for kind, tx, tz, buf in self._payloads(near):
            if kind == 'b' and (near is None or (tx, tz) in near):
                yield parse_buildings(buf)

    def terrain_tiles(self, near=None):
        for kind, tx, tz, buf in self._payloads(near):
            if kind == 't' and (near is None or (tx, tz) in near):
                yield parse_terrain(buf, self.classN)

    def ll2xz(self, lat, lon):
        from pyproj import Transformer
        tr = Transformer.from_crs('EPSG:4326', self.manifest['proj'], always_xy=True)
        e, n = tr.transform(lon, lat)
        return e, -n

    def tiles_around(self, x, z, r):
        T = self.manifest['tileSize']
        return {(tx, tz) for tx in range(int(np.floor((x - r) / T)), int(np.floor((x + r) / T)) + 1)
                for tz in range(int(np.floor((z - r) / T)), int(np.floor((z + r) / T)) + 1)}
