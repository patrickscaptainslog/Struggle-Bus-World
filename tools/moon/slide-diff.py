#!/usr/bin/env python3
"""How much a slide changed the picture (tools/moon/slide.mjs's frames): python3 -I tools/moon/slide-diff.py <dir>

For each join, a to b is the frame across the slide and b to c a frame of flight by itself: the mean change of a pixel (0-255, all three channels) and the
share of pixels that changed by more than 24. A join is clean when it changes the picture no more than a frame does. Exit 1 if one doesn't."""
import struct
import sys
import zlib
from pathlib import Path


def read_png(path):
    data = Path(path).read_bytes()
    i, idat, w, h, ct = 8, b'', 0, 0, 2
    while i < len(data):
        n = struct.unpack('>I', data[i:i + 4])[0]
        kind, body = data[i + 4:i + 8], data[i + 8:i + 8 + n]
        i += 12 + n
        if kind == b'IHDR':
            w, h, _, ct = struct.unpack('>IIBB', body[:10])
        elif kind == b'IDAT':
            idat += body
    raw, bpp = zlib.decompress(idat), 4 if ct == 6 else 3
    stride, rows, prev, j = w * bpp, [], bytearray(w * bpp), 0
    for _ in range(h):
        f, line = raw[j], bytearray(raw[j + 1:j + 1 + stride])
        j += 1 + stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b, c = prev[x], prev[x - bpp] if x >= bpp else 0
            if f == 1:
                line[x] = (line[x] + a) & 255
            elif f == 2:
                line[x] = (line[x] + b) & 255
            elif f == 3:
                line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(bytes(line[x] for x in range(stride) if x % bpp < 3))
        prev = line
    return w, h, rows


def change(p, q):
    _, _, a = read_png(p)
    _, _, b = read_png(q)
    total = big = n = 0
    for ra, rb in zip(a, b):
        for k in range(0, len(ra), 3):
            d = abs(ra[k] - rb[k]) + abs(ra[k + 1] - rb[k + 1]) + abs(ra[k + 2] - rb[k + 2])
            total += d
            big += d > 24
            n += 1
    return total / (3 * n), big / n


def main():
    d = Path(sys.argv[1] if len(sys.argv) > 1 else 'shots/tmp/slide')
    bad = 0
    for i in range(16):
        if not (d / f'join{i}-a.png').exists():
            break
        jm, jb = change(d / f'join{i}-a.png', d / f'join{i}-b.png')
        fm, fb = change(d / f'join{i}-b.png', d / f'join{i}-c.png')
        ok = jm <= fm * 1.5 + 0.5 and jb <= fb * 1.5 + 0.01
        bad += not ok
        print(f"{'pass' if ok else 'FAIL'}  join {i}: the join changes a pixel {jm:.2f} on average, {100 * jb:.1f} % of them by more than 24; a frame by itself {fm:.2f}, {100 * fb:.1f} %")
    sys.exit(1 if bad else 0)


main()
