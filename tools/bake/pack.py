#!/usr/bin/env python3
"""Pack baked 256 m tiles into gzip'd 1 km region bundles for the phone.

Fewer, compressed requests: the client streams ~9-16 regions around the bus
and inflates them with DecompressionStream('gzip').

Region file r_<rx>_<rz>.bin (gzip of):
  magic 'SBR1', u32 count,
  count * { i32 tx, i32 tz, u32 bOff, u32 bLen, u32 tOff, u32 tLen }   (offsets from start of the inflated buffer; len 0 = absent)
  ...tile payloads (each 4-byte aligned)

usage: python3 -I tools/bake/pack.py sf
"""
import gzip
import json
import os
import shutil
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
REGION = 4  # tiles per region edge


def main():
    slug = sys.argv[1] if len(sys.argv) > 1 else 'sf'
    src = os.path.join(ROOT, 'public', 'city', slug)
    cache = os.path.join(HERE, '.cache', slug)
    os.makedirs(cache, exist_ok=True)
    # move raw tiles out of public/ (they're bake intermediates)
    for f in os.listdir(src):
        if (f.startswith('b_') or f.startswith('t_')) and f.endswith('.bin'):
            shutil.move(os.path.join(src, f), os.path.join(cache, f))
    for f in os.listdir(src):
        if f.startswith('r_') and f.endswith('.bin'):
            os.remove(os.path.join(src, f))
    man = json.load(open(os.path.join(src, 'city.json')))
    regions = {}
    for tx, tz, _ in man['tiles']:
        regions.setdefault((tx // REGION, tz // REGION), []).append((tx, tz))
    total = 0
    out_regions = []
    for (rx, rz), tl in sorted(regions.items()):
        entries = []
        payload = b''
        head_len = 8 + 24 * len(tl)
        for tx, tz in sorted(tl):
            rec = [tx, tz, 0, 0, 0, 0]
            for kind, slot in (('b', 2), ('t', 4)):
                p = os.path.join(cache, f'{kind}_{tx}_{tz}.bin')
                if os.path.exists(p):
                    data = open(p, 'rb').read()
                    payload += b'\0' * ((-(head_len + len(payload))) % 4)
                    rec[slot] = head_len + len(payload)
                    rec[slot + 1] = len(data)
                    payload += data
            entries.append(rec)
        head = struct.pack('<4sI', b'SBR1', len(entries)) + b''.join(struct.pack('<iiIIII', *e) for e in entries)
        blob = gzip.compress(head + payload, compresslevel=9, mtime=0)
        with open(os.path.join(src, f'r_{rx}_{rz}.bin'), 'wb') as f:
            f.write(blob)
        total += len(blob)
        out_regions.append([rx, rz, len(blob)])
    man['regionSize'] = REGION
    man['regions'] = out_regions
    with open(os.path.join(src, 'city.json'), 'w') as f:
        json.dump(man, f)
    print(f'{len(out_regions)} regions, {total / 1e6:.1f} MB gzip')


if __name__ == '__main__':
    main()
