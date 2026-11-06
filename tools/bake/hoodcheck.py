#!/usr/bin/env python3
"""The checks of a city's neighbourhoods (tools/bake/hoods.py; docs/specs/factions/C18.md): each count beside its limit,
exit 1 on any failure. Against the city's own baked tiles and Overture extract, the ones hoods.py read:
  file     'SBN1' at a version it reads, and city.json's "hoods" saying what the file holds
  land     every land square of the frame (half its 2 m texels not WATER) in a neighbourhood and nothing else in one; none
           in two: the table as src/world/hoods.ts gives it holds every square's key once
  parks    whole: the squares each park holds (it covers a quarter of their land, and no bigger park holds them) in one
           neighbourhood on each piece of land, but a park of more than hoods.PARK_WHOLE squares, which a split may cut
           (the Presidio); a park named for a neighbourhood it lies in or touches is held by that one (Mission
           Dolores Park by the Mission), the longest name it holds first
  hearts   each on its own neighbourhood's squares, none on a tagged square, at least 450 m apart (the godless aside);
           none on built ground while open ground was clear for it, none out of its parks while one had open, untagged
           ground clear for it (clear: 450 m from every other god's heart, where the bake could have put it), none
           whose ring reaches past the frame while a square off its edge was clear, and no ring square a neighbour holds
           that could come over to it (not a park's, a heart's ring, a neighbour at 0.25 km2 or cut in two by it); no
           tagged square in a ring while its park or tier had a clean ring clear for it
  sizes    0.25-3 km2; under 0.25 only a whole piece of land, and godless (Alcatraz)
  names    one each, none empty or over 255 bytes, no two that are one place (hoods.norm: Castro, Castro District),
           none with a slash of its own beside another; every place the bake seeds from named on the neighbourhood
           holding its point, or left off only where that one shows two names already; no place off the map named, and
           no umbrella beside its own parts (Inner and Outer Sunset beside the Sunset District)
  twice    (--twice) hoods.py run twice, into two folders: the same bytes as each other and as the checked files
  broken   (--broken) every check on a copy of the file broken on purpose, each copy failing the check it breaks
usage: python -I tools/bake/hoodcheck.py <slug> [--dir=DIR] [--twice] [--broken]
  --dir  the folder holding hoods.bin and city.json (a copy, to check a broken file); the tiles are the city's own
"""
import os
import sys

os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')
os.environ.setdefault('OMP_NUM_THREADS', '1')

import gzip
import hashlib
import json
import math
import re
import shutil
import subprocess
import tempfile

import numpy as np
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
import hoods as H  # noqa: E402
from citydata import City  # noqa: E402


class Report:
    def __init__(self, quiet=False):
        self.failed = []
        self.quiet = quiet

    def __call__(self, name, value, limit, ok):
        if not ok:
            self.failed.append(name)
        if not self.quiet:
            print(f'{"pass" if ok else "FAIL"}  {name}: {value}  ({limit})', flush=True)


class World:
    """What the checks hold the file to, read from the city's baked tiles and its Overture extract."""

    def __init__(self, slug):
        self.slug = slug
        self.city = os.path.join(ROOT, 'public', 'city', slug)
        man = json.load(open(os.path.join(self.city, 'city.json'), encoding='utf-8'))
        x0, z0, x1, z1 = man['bounds']
        self.ix0, self.iz0 = math.floor(x0 / H.SQ), math.floor(z0 / H.SQ)
        self.w, self.h = math.ceil(x1 / H.SQ) - self.ix0, math.ceil(z1 / H.SQ) - self.iz0
        # land: the tiles' own texels, counted here (not hoods.py's reading of them)
        land = np.zeros(self.w * self.h)
        per = int(round(man['tileSize'] / H.SQ))
        for t in City(self.city).terrain_tiles():
            i0 = int(round(t['originX'] / H.SQ)) - self.ix0
            j0 = int(round(t['originZ'] / H.SQ)) - self.iz0
            if i0 < 0 or j0 < 0 or i0 + per > self.w or j0 + per > self.h:
                continue
            k = t['cls'].shape[0] // per
            sh = ((t['cls'] & 15) != H.WATER).reshape(per, k, per, k).mean(axis=(1, 3))
            for b in range(per):
                for a in range(per):
                    land[(j0 + b) * self.w + i0 + a] = sh[b, a]
        self.land = land >= H.LAND
        lab, self.npieces = ndimage.label(self.land.reshape(self.h, self.w), structure=np.ones((3, 3)))
        self.piece = lab.ravel() - 1
        # the parks and the squares each holds, by hoods.py's readers (its projection, its 8 m lattice)
        hd = H.Hoods(slug, out=tempfile.mkdtemp(prefix='hoodcheck-'))
        hd.read_tiles()
        lu, lg = hd.read('land_use', ['id', 'subtype', 'class', 'name', 'osm_id'])
        parks = []
        for r, g in zip(lu, lg):
            if (r.get('subtype'), r.get('class')) in H.PARK_LIKE and g.geom_type in ('Polygon', 'MultiPolygon'):
                sq, n = hd.cover(g)
                if len(sq):
                    parks.append((-float(n.sum()), r.get('name') or '', str(r.get('id')), sq, n))
        parks.sort(key=lambda p: p[:3])
        hd.read_sources()
        held = np.zeros(self.w * self.h, bool)
        self.parks = []
        for m2, name, pid, sq, n in parks:
            f = n / np.maximum(hd.landN[sq], 1)
            own = sq[(f >= H.PARK_SQUARE) & ~held[sq]]
            held[own] = True
            if len(own):
                self.parks.append((name or f'park {pid}', own))
        # each square's open ground (grass, plaza, path, sand, forest or rock) by hoods.py's reading, and whether a park
        # covers a quarter of it: what a heart stands on
        self.open = hd.open.copy()
        self.landshare = hd.land.copy()
        self.parksq = held.copy()
        # places off the map: outlines mostly past the frame with under 0.25 km2 of land on it (hoods.OFF_MAP), whose names
        # no neighbourhood carries, unless a point of the same name is on the map
        areas, ag = hd.src['areas']
        divs, dg = hd.src['divs']
        on_map = {H.norm(r['name']) for r, g in zip(divs, dg) if r.get('name') and g is not None and g.geom_type == 'Point'
                  and hd.frame.contains(g)}
        self.off_map = []
        for r, g in zip(areas, ag):
            nm = (r.get('name') or '').strip()
            if (r.get('subtype') not in H.HOOD_SUBS or r.get('class') != 'land' or not nm or H.norm(nm) in on_map
                    or g.geom_type not in ('Polygon', 'MultiPolygon')):
                continue
            sq, n = hd.cover(g)
            if (len(sq) and float(n.sum()) * H.STEP * H.STEP < H.MIN_SQUARES * H.SQ * H.SQ
                    and g.intersection(hd.frame).area < H.OFF_MAP * g.area):
                self.off_map.append(nm)
        # the places hoods.py seeds from (its reading of the extract: points, outlines, big parks), each with the square
        # its point is on, and their names as a sign shows them (a park "of <the city>" is the park)
        hd.seeds()
        self.places = [(re.sub(rf'\s+of\s+{re.escape(hd.city_name)}\b', '', s['name']) if hd.city_name else s['name'],
                        s['at'], s['kind']) for s in hd.S if s['name']]
        shutil.rmtree(hd.out, ignore_errors=True)

    def key(self, s):
        return H.pack(self.ix0 + s % self.w, self.iz0 + s // self.w)

    def cell(self, key, t):
        """The file's grid cell of a square's key, -1 off it."""
        ix = ((key >> 16) ^ 0x8000) - 0x8000
        iz = ((key & 0xffff) ^ 0x8000) - 0x8000
        i, j = ix - t['ix0'], iz - t['iz0']
        return j * t['w'] + i if 0 <= i < t['w'] and 0 <= j < t['h'] else -1


def table(t):
    """The table as src/world/hoods.ts gives it: names, hearts, each one's squares (keys), the tagged keys, the godless."""
    squares = [[] for _ in t['names']]
    tagged = []
    for c in np.nonzero(t['grid'])[0].tolist():
        key = H.pack(t['ix0'] + c % t['w'], t['iz0'] + c // t['w'])
        squares[int(t['grid'][c]) - 1].append(key)
        if t['tagged'][c]:
            tagged.append(key)
    return dict(names=list(t['names']), hearts=list(t['hearts']), squares=squares, tagged=tagged,
                godless=[f != 0 for f in t['flags']])


def digest(tb):
    """sha-256 of the table in a canonical JSON, the same as tools/world/hoods-check.mjs prints for the shipped parser."""
    canon = json.dumps([tb['names'], tb['hearts'], [sorted(s) for s in tb['squares']], sorted(tb['tagged']), tb['godless']],
                       separators=(',', ':'), ensure_ascii=False)
    return hashlib.sha256(canon.encode('utf-8')).hexdigest()


SPLIT_WORDS = {w for ws in H.STRIPS.values() for w in ws} | set(H.NORTH_SOUTH.values())


def base_of(part):
    """A name without the strip a split gave it ("Outer Richmond West" is Outer Richmond's), else itself."""
    for w in sorted(SPLIT_WORDS, key=len, reverse=True):
        if part.endswith(' ' + w):
            return part[:-len(w) - 1]
    if len(part.split()) > 1 and part.split()[-1].isdigit():
        return part.rsplit(' ', 1)[0]
    return part


def carried(names):
    """{a place's name (hoods.norm): the neighbourhoods carrying it}: each name of a merged one, and a split's base
    ("Outer Richmond West" carries Outer Richmond)."""
    out = {}
    for k, nm in enumerate(names):
        for part in nm.split(' / '):
            out.setdefault(H.norm(part), set()).add(k)
            out.setdefault(H.norm(base_of(part)), set()).add(k)
    return out


def gods(W, t):
    """{god: its heart's grid cell}, and a function giving which of some cells are at least 450 m from every other god's
    heart (where the bake could have put that god's heart)."""
    hc = {k: W.cell(t['hearts'][k], t) for k in range(len(t['names'])) if not t['flags'][k]}
    xy = {k: ((W.ix0 + c % W.w + 0.5) * H.SQ, (W.iz0 + c // W.w + 0.5) * H.SQ) for k, c in hc.items()}

    def clear(k, cells):
        others = np.array([xy[j] for j in hc if j != k]).reshape(-1, 2)
        if not len(others):
            return np.ones(len(cells), bool)
        cx = (W.ix0 + cells % W.w + 0.5) * H.SQ
        cz = (W.iz0 + cells // W.w + 0.5) * H.SQ
        return np.hypot(cx[:, None] - others[:, 0], cz[:, None] - others[:, 1]).min(axis=1) >= H.HEARTS_APART - 1e-6
    return hc, clear


def heart_ground(W, t):
    """(built, off its parks): gods whose heart is on built ground (under a quarter of open ground) while their
    neighbourhood had open ground clear of the other gods' hearts, off the frame's edge; gods whose heart is in none of
    their parks while one had an open, untagged square clear of them, off the edge."""
    g = t['grid']
    hc, clear = gods(W, t)
    built, off = [], []
    for k, h in hc.items():
        sq = np.nonzero(g == k + 1)[0]
        inner = np.array([len(ring_cells(W, s)) == 8 for s in sq.tolist()], bool)
        ok = clear(k, sq) & ~t['tagged'][sq] & (W.open[sq] >= H.OPEN_HEART) & inner
        if W.open[h] < H.OPEN_HEART and ok.any():
            built.append(f'{t["names"][k]} (open {W.open[h]:.2f})')
        if not W.parksq[h] and (ok & W.parksq[sq]).any():
            off.append(t['names'][k])
    return built, off


def ring_cells(W, c):
    """Grid cell c's ring of 8, those inside the frame."""
    i, j = c % W.w, c // W.w
    return [(j + dj) * W.w + i + di for dj in (-1, 0, 1) for di in (-1, 0, 1)
            if (di or dj) and 0 <= i + di < W.w and 0 <= j + dj < W.h]


def connected(W, cells):
    """Grid cells in one piece, corners touching."""
    if not len(cells):
        return True
    i, j = cells % W.w, cells // W.w
    m = np.zeros((j.max() - j.min() + 1, i.max() - i.min() + 1), bool)
    m[j - j.min(), i - i.min()] = True
    return ndimage.label(m, structure=np.ones((3, 3)))[1] == 1


def heart_rings(W, t):
    """(at the edge, gaps, short): gods whose heart's ring reaches past the frame while a square of theirs off its edge
    was clear for them; gods whose ring holds a neighbour's land square that could have come over (not a park's, not
    the neighbour's heart or in its heart's ring, the neighbour above 0.25 km2 and not cut in two by it, the god under
    3 km2); and every god's ring short of 8 of its own, with why."""
    g = t['grid']
    hc, clear = gods(W, t)
    size = np.bincount(g, minlength=len(t['names']) + 1)
    rings = {k: ring_cells(W, h) for k, h in hc.items()}
    edge, gaps, short = [], [], []
    for k, h in hc.items():
        if len(rings[k]) < 8:
            sq = np.nonzero(g == k + 1)[0]
            inner = np.array([len(ring_cells(W, s)) == 8 for s in sq.tolist()])
            if (inner & clear(k, sq) & ~t['tagged'][sq]).any():
                edge.append(t['names'][k])
        why = ['frame'] * (8 - len(rings[k]))
        for q in rings[k]:
            u = int(g[q]) - 1
            if u == k:
                continue
            if u < 0:
                why.append('water')
                continue
            if W.parksq[q]:
                why.append('a park')
                continue
            if u in hc and (q == hc[u] or q in rings[u]):
                why.append('a ring')
                continue
            if size[u + 1] - 1 < H.MIN_SQUARES or size[k + 1] + 1 > H.MAX_SQUARES:
                why.append('a size')
                continue
            rest = np.nonzero(g == u + 1)[0]
            if not connected(W, rest[rest != q]):
                why.append('a neighbour in two')
                continue
            gaps.append(f'{t["names"][k]} ({t["names"][u]})')
            why.append('could come')
        if why:
            short.append(f'{t["names"][k]} {8 - len(why)}: {", ".join(sorted(set(why)))}')
    return edge, gaps, short


def tagged_rings(W, t):
    """Gods whose ring of 8 holds a tagged square (it stops at the streets: a god over a cemetery's edge) while their own
    park, or their tier (open ground, built ground), had a square clear for them, off the frame's edge, whose ring held
    none."""
    g = t['grid']
    hc, clear = gods(W, t)
    park = np.full(len(g), -1)
    for p, (_, own) in enumerate(W.parks):
        park[own] = p
    tier = lambda s: (0, int(park[s])) if park[s] >= 0 and W.open[s] >= H.OPEN_HEART else (1 if W.open[s] >= H.OPEN_HEART else 2, -1)
    dirty = lambda s: any(t['tagged'][q] for q in ring_cells(W, s))
    out = []
    for k, h in hc.items():
        if not dirty(h):
            continue
        sq = np.nonzero(g == k + 1)[0]
        ok = clear(k, sq) & ~t['tagged'][sq]
        if any(ok[i] and len(ring_cells(W, s)) == 8 and tier(s) == tier(h) and not dirty(s) for i, s in enumerate(sq.tolist())):
            out.append(t['names'][k])
    return out


def contains(pw, w):
    """Words w a run in words pw."""
    return bool(w) and any(pw[k:k + len(w)] == w for k in range(len(pw) - len(w) + 1))


def named_parks(W, t):
    """Parks kept whole named for a neighbourhood they lie in or touch but held by another: [(park, holder, the ones
    it's named for)]. hoods.py gives such a park to the one whose name it holds, the longest first (Mission Dolores Park,
    the Mission's)."""
    g, names = t['grid'], t['names']
    out = []
    for name, own in W.parks:
        pw = H.words(name) if name and not name.startswith('park ') else []
        if not pw or len(own) > H.PARK_WHOLE:
            continue
        for piece in sorted(set(W.piece[own].tolist())):
            cs = own[W.piece[own] == piece]
            holders = set(g[cs].tolist()) - {0}
            if len(holders) != 1:
                continue   # (cut: the parks check's)
            holder = holders.pop()
            near = {holder}
            for s in cs.tolist():
                for q in (s - 1, s + 1, s - W.w, s + W.w):
                    if 0 <= q < len(g) and abs(q % W.w - s % W.w) <= 1 and g[q]:
                        near.add(int(g[q]))
            cands = [(len(H.words(base_of(p))), k) for k in near for p in names[k - 1].split(' / ')
                     if contains(pw, H.words(base_of(p)))]
            if not cands:
                continue
            top = max(n for n, _ in cands)
            best = {k for n, k in cands if n == top}
            if holder not in best:
                out.append((name, holder, best))
    return out


def umbrellas(names):
    """Names beside two or more of their own parts called Inner, Outer, Upper, Lower... and the name (the Sunset District
    beside Inner Sunset and Outer Sunset): the umbrella hoods.py leaves out."""
    bases = [(k, H.words(base_of(p))) for k, nm in enumerate(names) for p in nm.split(' / ')]
    out = []
    for k, w in bases:
        quals = {v[0] for j, v in bases if j != k and len(v) > 1 and v[1:] == w and v[0] in H.QUALIFIERS}
        if w and len(quals) >= 2:
            out.append(f'{names[k]} (beside {len(quals)} of its parts)')
    return out


def places(W, t):
    """(misplaced, lost, left off) for the places the bake seeds from: a name on a neighbourhood that doesn't hold the
    place's point; a name on none, where the neighbourhood holding the point had room for it; a name on none because
    that neighbourhood shows two already."""
    car = carried(t['names'])
    mis, lost, off = [], [], []
    for nm, s, kind in W.places:
        k = int(t['grid'][s]) - 1
        if k < 0:
            continue
        holder = t['names'][k]
        got = car.get(H.norm(nm))
        if got:
            if k not in got:
                mis.append(f'{nm} (its point in {holder}; on {", ".join(sorted(t["names"][j] for j in got))})')
        elif ' / ' in holder:
            off.append(f'{nm} (in {holder})')
        else:
            lost.append(f'{nm} (its point in {holder})')
    return mis, lost, off


def check(W, t, man_hoods, rep):
    """Every check on a parsed file t (hoods.unpack_hoods), into rep."""
    n = len(t['names'])
    rep('file: version', f'{t["major"]}.{t["minor"]}', f'{H.HOODS_VERSION[0]}.x', t['major'] == H.HOODS_VERSION[0])
    same_grid = (t['ix0'], t['iz0'], t['w'], t['h']) == (W.ix0, W.iz0, W.w, W.h)
    rep('file: grid', f'{t["ix0"]},{t["iz0"]} {t["w"]}x{t["h"]}', f'the frame {W.ix0},{W.iz0} {W.w}x{W.h}', same_grid)
    if not same_grid:
        return
    g = t['grid']
    counts = {'count': n, 'squares': int((g > 0).sum()), 'godless': sum(1 for f in t['flags'] if f),
              'tagged': int((t['tagged'] & (g > 0)).sum())}
    bad = [k for k, v in counts.items() if (man_hoods or {}).get(k) != v]
    rep('file: city.json "hoods"', ', '.join(f'{k} {v}' for k, v in counts.items()), 'the same as the file', not bad and man_hoods is not None)
    # land
    missing = int((W.land & (g == 0)).sum())
    extra = int((~W.land & (g > 0)).sum())
    rep('land: land squares in no neighbourhood', missing, '0', missing == 0)
    rep('land: squares in one that aren\'t land', extra, '0', extra == 0)
    tb = table(t)
    keys = [k for s in tb['squares'] for k in s]
    rep('land: squares in two', len(keys) - len(set(keys)), '0 (every key once)', len(keys) == len(set(keys)))
    # parks
    cut = []
    for name, own in W.parks:
        if len(own) > H.PARK_WHOLE:
            continue
        for p in sorted(set(W.piece[own].tolist())):   # (a park on two pieces of land is whole on each: no neighbourhood crosses water)
            hs = set(g[own[W.piece[own] == p]].tolist())
            if len(hs) > 1:
                cut.append(f'{name} ({len(own)} squares in {len(hs)})')
    big = sum(1 for _, own in W.parks if len(own) > H.PARK_WHOLE)
    rep('parks: cut in two', len(cut), f'0 of {len(W.parks) - big}, {big} of over {H.PARK_WHOLE} squares aside' +
        (f'; {"; ".join(cut[:6])}' if cut else ''), not cut)
    npk = [f'{p} in {t["names"][h - 1]}' for p, h, _ in named_parks(W, t)]
    rep('parks: named for a neighbourhood they touch, held by another', len(npk), '0' +
        (f'; {"; ".join(npk[:6])}' if npk else ''), not npk)
    # hearts
    off, tag = [], []
    pts = []
    for k, (key, nm) in enumerate(zip(tb['hearts'], tb['names'])):
        c = W.cell(key, t)
        if c < 0 or g[c] != k + 1:
            off.append(nm)
            continue
        if t['tagged'][c]:
            tag.append(nm)
        if not tb['godless'][k]:
            pts.append(((W.ix0 + c % W.w + 0.5) * H.SQ, (W.iz0 + c // W.w + 0.5) * H.SQ, nm))
    rep('hearts: off their own squares', len(off), '0' + (f'; {", ".join(off[:6])}' if off else ''), not off)
    rep('hearts: on a tagged square', len(tag), '0' + (f'; {", ".join(tag[:6])}' if tag else ''), not tag)
    if not off:
        built, offpark = heart_ground(W, t)
        rep('hearts: on built ground while their neighbourhood had open ground for them', len(built), '0' +
            (f'; {"; ".join(built[:8])}' if built else ''), not built)
        rep('hearts: out of their parks while one had open, untagged ground for them', len(offpark), '0' +
            (f'; {"; ".join(offpark[:8])}' if offpark else ''), not offpark)
        edge, gaps, short = heart_rings(W, t)
        rep('hearts: ring past the frame while a square off its edge was clear for them', len(edge), '0' +
            (f'; {"; ".join(edge[:8])}' if edge else ''), not edge)
        rep('hearts: a ring square a neighbour holds that could come over', len(gaps), '0' +
            (f'; {"; ".join(gaps[:8])}' if gaps else ''), not gaps)
        rep('hearts: rings short of 8 of their own', len(short), f'reported, of {len(gods(W, t)[0])} gods' +
            (f'; {"; ".join(short[:12])}' if short else ''), True)
        dirty = tagged_rings(W, t)
        rep('hearts: a tagged square in the ring while their park or tier had a clean ring clear for them', len(dirty), '0' +
            (f'; {"; ".join(dirty[:8])}' if dirty else ''), not dirty)
    near = []
    if len(pts) > 1:
        from scipy.spatial import cKDTree
        xy = np.array([p[:2] for p in pts])
        for a, b in sorted(cKDTree(xy).query_pairs(H.HEARTS_APART - 1e-6)):
            near.append(f'{pts[a][2]} and {pts[b][2]} {math.hypot(*(xy[a] - xy[b])):.0f} m')
        closest = min(math.hypot(*(xy[a] - xy[b])) for a in range(len(xy)) for b in range(a + 1, len(xy)))
    else:
        closest = math.inf
    rep('hearts: closer than 450 m', len(near), f'0, the closest {closest:.0f} m' + (f'; {"; ".join(near[:6])}' if near else ''), not near)
    # sizes
    sizes = np.array([len(s) for s in tb['squares']])
    km2 = sizes * H.SQ_KM2
    over = [f'{nm} {a:.2f} km2' for nm, a in zip(tb['names'], km2) if a > 3.0]
    under = []
    for k, (nm, s) in enumerate(zip(tb['names'], tb['squares'])):
        if len(s) >= H.MIN_SQUARES:
            continue
        cs = [W.cell(key, t) for key in s]
        pieces = set(W.piece[cs].tolist())
        whole = len(pieces) == 1 and int((W.piece == next(iter(pieces))).sum()) == len(s)
        if not (whole and tb['godless'][k]):
            under.append(f'{nm} {len(s)} squares')
    rep('sizes: over 3 km2', len(over), '0' + (f'; {", ".join(over)}' if over else ''), not over)
    rep('sizes: under 0.25 km2 and not a whole piece of land with no god', len(under), '0' + (f'; {", ".join(under)}' if under else ''), not under)
    if len(sizes):
        rep('sizes: squares min / median / max', f'{sizes.min()} / {int(np.median(sizes))} / {sizes.max()} '
            f'({km2.min():.3f} / {np.median(km2):.3f} / {km2.max():.3f} km2)', 'reported', True)
    empty = [k for k, s in enumerate(tb['squares']) if not s]
    rep('sizes: neighbourhoods with no squares', len(empty), '0', not empty)
    # names
    norms = {}
    for nm in tb['names']:
        norms.setdefault(H.norm(nm), []).append(nm)
    dup = [' = '.join(v) for v in norms.values() if len(v) > 1]
    blank = [nm for nm in tb['names'] if not nm.strip() or len(nm.encode('utf-8')) > 255]
    slash = [nm for nm in tb['names'] if len(nm.split(' / ')) > 1 and any('/' in p for p in nm.split(' / '))]
    rep('names: two that are one place', len(dup), '0' + (f'; {"; ".join(dup[:6])}' if dup else ''), not dup)
    rep('names: empty or over 255 bytes', len(blank), '0', not blank)
    rep('names: a merged name with a slash of its own in it', len(slash), '0 (it reads as three)' +
        (f'; {"; ".join(slash[:6])}' if slash else ''), not slash)
    parts = {H.norm(p) for nm in tb['names'] for p in nm.split(' / ')}
    offm = [nm for nm in W.off_map if H.norm(nm) in parts]
    rep('names: a place off the map on a neighbourhood', len(offm), f'0 of {len(W.off_map)} places off the map' +
        (f'; {"; ".join(offm[:6])}' if offm else ''), not offm)
    umb = umbrellas(tb['names'])
    rep('names: an umbrella beside its own parts', len(umb), '0' + (f'; {"; ".join(umb[:6])}' if umb else ''), not umb)
    mis, lost, off = places(W, t)
    rep('names: a place named on a neighbourhood that doesn\'t hold its point', len(mis), f'0 of {len(W.places)} places'
        + (f'; {"; ".join(mis[:8])}' if mis else ''), not mis)
    rep('names: a place named nowhere, where its neighbourhood had room', len(lost), '0' +
        (f'; {"; ".join(lost[:8])}' if lost else ''), not lost)
    rep('names: a place left off for two names already', len(off), 'reported' + (f'; {"; ".join(off[:8])}' if off else ''), True)
    return tb


def broken(W, t, man_hoods):
    """Each check on a copy broken on purpose, through the file's own bytes: (case, the check it breaks, caught)."""
    out = []
    g = t['grid']
    land = np.nonzero(g)[0]
    cases = []

    def case(name, target, f):
        c = {k: (v.copy() if hasattr(v, 'copy') else v) for k, v in t.items()}
        c['hearts'] = list(t['hearts'])
        c['flags'] = list(t['flags'])
        c['names'] = list(t['names'])
        mh = dict(man_hoods or {})
        f(c, mh)
        cases.append((name, target, c, mh))
    case('a land square in none', 'land: land squares in no neighbourhood',
         lambda c, mh: c['grid'].__setitem__(int(land[len(land) // 2]), 0) or mh.update(squares=mh['squares'] - 1))
    water = np.nonzero(~W.land & (g == 0))[0]
    case('a water square in one', 'land: squares in one that aren\'t land',
         lambda c, mh: c['grid'].__setitem__(int(water[0]), 1) or mh.update(squares=mh['squares'] + 1))
    # a park cut: one square of the biggest park kept whole given to a neighbour of another neighbourhood
    for name, own in W.parks:
        if 2 <= len(own) <= H.PARK_WHOLE:
            s0 = int(own[0])
            other = next((int(v) for v in g[np.isin(np.arange(len(g)), [s0 - 1, s0 + 1, s0 - W.w, s0 + W.w])] if v and v != g[s0]), None)
            if other:
                case(f'{name} cut', 'parks: cut in two', lambda c, mh, s0=s0, other=other: c['grid'].__setitem__(s0, other))
                break
    # a park named for the neighbourhood holding it, given to a neighbour named otherwise
    named = lambda k, pw: any(contains(pw, H.words(base_of(p))) for p in t['names'][k - 1].split(' / '))
    for name, own in W.parks:
        pw = H.words(name) if name and not name.startswith('park ') else []
        k = int(g[own[0]]) if len(own) else 0
        if (not pw or len(own) > H.PARK_WHOLE or not k or set(g[own].tolist()) != {k} or not named(k, pw)
                or int((g == k).sum()) <= len(own)):
            continue
        nbr = next((int(g[q]) for s in own.tolist() for q in (s - 1, s + 1, s - W.w, s + W.w)
                    if 0 <= q < len(g) and g[q] and g[q] != k and not named(int(g[q]), pw)), None)
        if nbr:
            case(f'{name} given away', 'parks: named for a neighbourhood they touch, held by another',
                 lambda c, mh, own=own, nbr=nbr: c['grid'].__setitem__(own, nbr))
            break
    # two hearts close: one neighbourhood's heart moved to its square nearest another's heart
    best = None
    for k in range(len(t['names'])):
        if t['flags'][k]:
            continue
        ck = W.cell(t['hearts'][k], t)
        xk, zk = ck % W.w, ck // W.w
        for m in range(len(t['names'])):
            if m == k or t['flags'][m]:
                continue
            sq = np.nonzero(g == m + 1)[0]
            d = np.hypot(sq % W.w - xk, sq // W.w - zk) * H.SQ
            j = int(np.argmin(d))
            if best is None or d[j] < best[0]:
                best = (float(d[j]), m, int(sq[j]))
    if best:
        _, m, s = best
        case('two hearts close', 'hearts: closer than 450 m', lambda c, mh: c['hearts'].__setitem__(m, W.key(s)))
    # a heart moved off open ground, and one moved out of its park, each onto its own other square
    hc, _ = gods(W, t)
    for target, moved, there in (('hearts: on built ground while their neighbourhood had open ground for them', 'onto built ground',
                                  lambda h, s: W.open[h] >= H.OPEN_HEART and W.open[s] < H.OPEN_HEART),
                                 ('hearts: out of their parks while one had open, untagged ground for them', 'out of its park',
                                  lambda h, s: W.parksq[h] and not W.parksq[s])):
        pick = next(((k, int(s)) for k, h in hc.items() for s in np.nonzero(g == k + 1)[0].tolist()
                     if there(h, s) and not t['tagged'][s]), None)
        if pick:
            case(f'a heart moved {moved}', target, lambda c, mh, k=pick[0], s=pick[1]: c['hearts'].__setitem__(k, W.key(s)))
    # a heart moved to the frame's edge, and a god's own ring square given to the neighbour beside it
    pick = next(((k, int(s)) for k in hc for s in np.nonzero(g == k + 1)[0].tolist()
                 if len(ring_cells(W, s)) < 8 and not t['tagged'][s]), None)
    if pick:
        case('a heart moved to the frame\'s edge', 'hearts: ring past the frame while a square off its edge was clear for them',
             lambda c, mh, k=pick[0], s=pick[1]: c['hearts'].__setitem__(k, W.key(s)))
    gap = next(((q, int(g[r]) - 1) for k, h in hc.items() for q in ring_cells(W, h) if g[q] == k + 1 and not W.parksq[q]
                for r in ring_cells(W, q) if g[r] and g[r] != k + 1 and not (int(g[r]) - 1 in hc and (
                    q == hc[int(g[r]) - 1] or q in ring_cells(W, hc[int(g[r]) - 1])))), None)
    if gap:
        case('a ring square given away', 'hearts: a ring square a neighbour holds that could come over',
             lambda c, mh, q=gap[0], u=gap[1]: c['grid'].__setitem__(q, u + 1))
    # a square of a god's ring tagged, where another square of its tier keeps a clean ring
    tagq = None
    for k, h in hc.items():
        for q in ring_cells(W, h):
            if g[q] != k + 1 or t['tagged'][q]:
                continue
            tt = dict(t, tagged=t['tagged'].copy())
            tt['tagged'][q] = True
            if t['names'][k] in tagged_rings(W, tt):
                tagq = q
                break
        if tagq is not None:
            break
    if tagq is not None:
        case('a ring square tagged', 'hearts: a tagged square in the ring while their park or tier had a clean ring clear for them',
             lambda c, mh, q=tagq: c['tagged'].__setitem__(q, True) or mh.update(tagged=mh['tagged'] + 1))
    k0 = next(k for k in range(len(t['names'])) if not t['flags'][k])
    case('a heart off its squares', 'hearts: off their own squares',
         lambda c, mh: c['hearts'].__setitem__(k0, t['hearts'][(k0 + 1) % len(t['names'])]))
    case('a heart tagged', 'hearts: on a tagged square',
         lambda c, mh: c['tagged'].__setitem__(W.cell(t['hearts'][k0], t), True) or mh.update(tagged=mh['tagged'] + 1))
    # sizes: the biggest with its neighbours as one, till it's over 3 km2; and one cut to its last 3 squares
    sizes = np.bincount(g, minlength=len(t['names']) + 1)[1:]
    order = np.argsort(-sizes, kind='stable')

    def touching(ids):
        nb = set()
        for s in np.nonzero(np.isin(g, [i + 1 for i in ids]))[0].tolist():
            for s2 in (s - 1, s + 1, s - W.w, s + W.w):
                if 0 <= s2 < len(g) and g[s2] and int(g[s2]) - 1 not in ids:
                    nb.add(int(g[s2]) - 1)
        return sorted(nb, key=lambda v: (-sizes[v], v))
    grown = [int(order[0])]
    while sum(sizes[grown]) <= H.MAX_SQUARES and touching(grown):
        grown.append(touching(grown)[0])
    if sum(sizes[grown]) > H.MAX_SQUARES:
        case(f'{len(grown)} as one', 'sizes: over 3 km2',
             lambda c, mh: c['grid'].__setitem__(np.isin(c['grid'], [i + 1 for i in grown]), grown[0] + 1))
    small = next(int(k) for k in order[::-1] if not t['flags'][int(k)])
    sq = np.nonzero(g == small + 1)[0]
    nb = touching([small])
    if len(sq) > 3 and nb:
        case('one cut to its last 3 squares', 'sizes: under 0.25 km2 and not a whole piece of land with no god',
             lambda c, mh: c['grid'].__setitem__(sq[:-3], nb[0] + 1))
    case('two names the same', 'names: two that are one place',
         lambda c, mh: c['names'].__setitem__(1, c['names'][0].upper() + ' District'))
    case('a merged name with a slash', 'names: a merged name with a slash of its own in it',
         lambda c, mh: c['names'].__setitem__(0, c['names'][0] + ' / North/South'))
    if W.off_map:
        case('a place off the map named', 'names: a place off the map on a neighbourhood',
             lambda c, mh: c['names'].__setitem__(0, W.off_map[0]))
    case('two names swapped', 'names: a place named on a neighbourhood that doesn\'t hold its point',
         lambda c, mh: c['names'].__setitem__(slice(0, 2), [c['names'][1], c['names'][0]]))
    case('a name gone', 'names: a place named nowhere, where its neighbourhood had room',
         lambda c, mh: c['names'].__setitem__(0, 'Nowhere At All'))
    case('an umbrella', 'names: an umbrella beside its own parts',
         lambda c, mh: c['names'].__setitem__(slice(0, 2), ['Inner ' + base_of(c['names'][2]), 'Outer ' + base_of(c['names'][2])]))
    for name, target, c, mh in cases:
        rep = Report(quiet=True)
        try:
            u = H.unpack_hoods(H.pack_hoods(c))
            check(W, dict(u, major=u['major']), mh, rep)
            caught = target in rep.failed
        except (ValueError, AssertionError) as e:
            caught = False
            target += f' (unreadable: {e})'
        out.append((name, target, caught, [f for f in rep.failed if f != target]))
    # the file's own bytes, broken: cut short, a magic it doesn't know, a version past it
    raw = gzip.decompress(open(os.path.join(W.dir, 'hoods.bin'), 'rb').read())
    for name, bad in (('cut short', raw[:len(raw) // 2]), ('magic', b'SBX1' + raw[4:]),
                      ('version 2', raw[:4] + (2).to_bytes(2, 'little') + raw[6:])):
        try:
            H.unpack_hoods(bad)
            out.append((f'a file {name}', 'file: unreadable', False, []))
        except ValueError:
            out.append((f'a file {name}', 'file: unreadable', True, []))
    return out


def twice(slug, dirs):
    """hoods.py twice into two fresh folders: (both runs the same, the same as the checked files)."""
    outs = []
    for k in range(2):
        d = tempfile.mkdtemp(prefix=f'hoods-{slug}-{k}-')
        r = subprocess.run([sys.executable, '-I', '-B', os.path.join(HERE, 'hoods.py'), slug, f'--out={d}'],
                           capture_output=True, text=True, encoding='utf-8')
        if r.returncode:
            print(r.stdout[-2000:], r.stderr[-2000:])
            raise SystemExit(f'hoods.py {slug} failed: exit {r.returncode}')
        outs.append(d)
    read = lambda d, f: open(os.path.join(d, f), 'rb').read()
    same = all(read(outs[0], f) == read(outs[1], f) for f in ('hoods.bin', 'city.json'))
    same_checked = all(read(outs[0], f) == read(dirs, f) for f in ('hoods.bin', 'city.json'))
    sizes = [len(read(outs[0], 'hoods.bin')), len(read(outs[0], 'city.json'))]
    for d in outs:
        shutil.rmtree(d, ignore_errors=True)
    return same, same_checked, sizes


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = dict((a[2:].split('=', 1) + [''])[:2] for a in sys.argv[1:] if a.startswith('--'))
    if not args:
        raise SystemExit(__doc__)
    slug = args[0]
    d = os.path.abspath(flags['dir']) if flags.get('dir') else os.path.join(ROOT, 'public', 'city', slug)
    W = World(slug)
    W.dir = d
    rep = Report()
    print(f'hoodcheck {slug}: {d}', flush=True)
    man = json.load(open(os.path.join(d, 'city.json'), encoding='utf-8'))
    try:
        t = H.unpack_hoods(open(os.path.join(d, 'hoods.bin'), 'rb').read())
    except (OSError, ValueError) as e:
        rep('file: readable', str(e), 'hoods.bin, SBN1', False)
        raise SystemExit(1)
    tb = check(W, t, man.get('hoods'), rep)
    if tb:
        print(f'      table digest {digest(tb)} (tools/world/hoods-check.mjs prints the shipped parser\'s)', flush=True)
    if 'twice' in flags:
        same, same_checked, sizes = twice(slug, d)
        rep('twice: two runs byte for byte', 'the same' if same else 'they differ', 'the same', same)
        rep('twice: and the checked files', 'the same' if same_checked else 'they differ',
            f'the same (hoods.bin {sizes[0]} B, city.json {sizes[1]} B)', same_checked)
    if 'broken' in flags:
        for name, target, caught, also in broken(W, t, man.get('hoods')):
            rep(f'broken: {name}', f'{"fails" if caught else "PASSES"} {target}' + (f' (and {", ".join(also)})' if also else ''),
                'fails', caught)
    print(f'{"FAIL" if rep.failed else "PASS"}: {len(rep.failed)} failed' + (f' ({", ".join(rep.failed)})' if rep.failed else ''), flush=True)
    raise SystemExit(1 if rep.failed else 0)


if __name__ == '__main__':
    main()
