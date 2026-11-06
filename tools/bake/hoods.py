#!/usr/bin/env python3
"""A baked city's neighbourhoods (docs/specs/factions/FACTIONS.md section 3, "Neighbourhoods", approved 2026-11-06), for the
areas by docs/specs/factions/C18.md: every 128 m square of land in the map's frame in exactly one neighbourhood, each with
its heart, from the city's own baked tiles (which it reads and never changes) and its Overture extract (tools/bake/overture.py).
Nothing in the game reads them yet.

Writes, beside the tiles in public/city/<slug>/ (or --out):
  hoods.bin   'SBN1' (gzip of): each square's neighbourhood, the hearts, the godless, the tagged squares and the names, the
              table feat/recess's src/factions/neighbourhoods.ts takes (src/world/hoods.ts reads it and has the layout)
  city.json   gains "hoods": the file's version and its counts

The squares are the areas' own: 128 m on the map's origin (areas.ts squareKey), keyed packSquare(ix, iz). The rules, in the
order the section's list of fixes needs them:
  land     a square in the frame (city.json bounds) is land when half its 2 m ground texels aren't WATER
  islands  land squares 8-connected are one piece of land, and no neighbourhood crosses water
  seeds    the divisions' points (neighbourhoods, quarters, suburbs, and towns, villages and hamlets: never the map's own city)
           within 200 m of land, squares and plazas left out; their outlines of 0.02-8 km2; named parks with 0.5 km2 of land,
           each a neighbourhood of its own. A point or outline named after a whole borough (its name a county's or a locality's,
           or its own outline over 8 km2: London's "City of Westminster") is left out, and names that are one place
           (Castro, Castro District) are one seed
  sparse   on a piece of land too big for one neighbourhood, a lattice 1.2 km apart on the origin where no seed is within
           1.8 km, each point moved to the most open ground within 400 m and named from the nearest unused place, park or
           land feature on its piece of land, else street; a piece of land with no seed gets one, named for its islands
  assign   a square to the big park covering half its land, else the smallest outline covering half, else the nearest seed
           on its piece of land
  parks    never cut in two: a park's squares (those it covers a quarter of) go to the neighbourhood its middle is in, a big
           park's to its own; a park of over a quarter of 3 km2 can be split with the neighbourhood it makes
  merge    a neighbourhood's pieces apart from its biggest, and neighbourhoods under 0.25 km2, join the neighbour they share
           the longest border with, keeping both names ("A / B"); a whole piece of land under it stays, godless (Alcatraz)
  split    anything over 3 km2 into strips across its longer side, parks whole, named West and East, or North and South
  hearts   one square each: in its biggest park, else its highest open ground, never on a tagged place, at least 450 m from
           every other heart; a neighbourhood whose heart can't be placed joins the neighbour in its way
  tagged   squares where worship, cemetery, memorial, school or hospital cover a quarter of the land: stages 4 and 5 stay off
A rerun on the same inputs writes the same bytes.

usage: python -I tools/bake/hoods.py <slug> [--out=DIR] [--json=FILE]
  --out   where hoods.bin and city.json go (default public/city/<slug>/; city.json is read from there if it has one)
  --json  each neighbourhood's sources, heart and size, for QA and the maps (not shipped)
"""
import os
import sys

os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')
os.environ.setdefault('OMP_NUM_THREADS', '1')

import gzip
import json
import math
import re
import struct
import time
import unicodedata

import numpy as np
import pyarrow.parquet as pq
import shapely
from pyproj import Transformer
from scipy import ndimage
from scipy.spatial import cKDTree

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
from citydata import City  # noqa: E402

CACHE = os.environ.get('SB_OVERTURE_CACHE', os.path.join(HERE, '.cache', 'overture'))
HOODS_VERSION = (1, 0)          # major, minor (src/world/hoods.ts)

SQ = 128.0                      # the areas' square (areas.ts areaTune.size)
SQ_KM2 = SQ * SQ / 1e6
SUB = 16                        # samples a square's side: an 8 m lattice for what covers what
STEP = SQ / SUB
WATER = 2                       # ground classes (src/world/tiles.ts Ground)
OPEN = (1, 4, 5, 6, 8, 10)      # GRASS, PLAZA, PATH, SAND, FOREST, ROCK: ground a god could stand on

LAND = 0.5                      # a square's share of land texels to be land
MIN_SQUARES = math.ceil(0.25 / SQ_KM2)       # 16: under 0.25 km2 a piece merges (neighbourhoods.ts godMin)
MAX_SQUARES = int(3.0 / SQ_KM2)              # 183: over 3 km2 a neighbourhood splits
HEARTS_APART = 450.0            # m between hearts' square centres
BIG_PARK = 0.5e6                # m2 of land: a named park this big is a neighbourhood of its own
OUTLINE_M2 = (0.02e6, 8e6)      # outlines used: smaller are plazas, bigger a borough
NEAR_LAND = 200.0               # a point this far off the land still seeds (a pier's end, a beach)
FILL = 1200.0                   # sparse: a lattice this far apart...
SPARSE = 1.5 * FILL             # ...where no seed is within one and a half of its steps (San Francisco's Sunset, its points
#                                 1.2-1.4 km apart, isn't sparse; the Marin Headlands, with none, are)
FILL_MOVE = 400.0               # each lattice point to the most open ground within this
FILL_NAME = 1500.0              # a lattice point's name from a place, park or land feature this near, else a street's
COVER = 0.5                     # a park or an outline takes a square it covers this share of
PARK_SQUARE = 0.25              # a park's squares, kept in one neighbourhood: those it covers this share of...
PARK_WHOLE = MAX_SQUARES // 4   # ...up to this many (0.74 km2); a bigger park may be split with the neighbourhood it makes
TAGGED = 0.25                   # tagged places covering this share of a square's land: it stops at the streets
OPEN_HEART = 0.25               # a heart on high ground stands on this share of open ground at least

HOOD_SUBS = ('neighborhood', 'microhood', 'macrohood')
TOWN_CLASSES = ('town', 'village', 'hamlet')  # locality points that name a place on a city's map (Sausalito), never 'city'
ADMIN_SUBS = ('country', 'dependency', 'region', 'county', 'localadmin', 'locality', 'macrocounty', 'borough')
PARK_LIKE = {('park', 'park'), ('park', 'village_green'), ('park', 'dog_park'), ('protected', 'national_park'),
             ('protected', 'state_park'), ('protected', 'nature_reserve')}
# names for a sparse place: any named park or protected area, and the land's named features
NAME_PARKS = ('park', 'protected')
NAME_LAND = ('island', 'islet', 'peak', 'hill', 'cape', 'peninsula', 'beach', 'valley', 'cliff', 'ridge', 'saddle', 'bay')
# the places the map tags: stages 4 and 5 stay off them (FACTIONS.md section 3)
TAG_LAND_USE = {'religious', 'cemetery', 'grave_yard', 'hospital', 'clinic', 'school', 'university', 'college',
                'kindergarten', 'schoolyard'}
TAG_SUBTYPES = ('religious', 'cemetery')
TAG_AMENITY = {'place_of_worship', 'grave_yard', 'hospital', 'school', 'university', 'college', 'kindergarten', 'monastery'}
TAG_BUILDING_SUBS = ('religious', 'education')
SMALL_MEMORIALS = {'plaque', 'blue_plaque', 'bench', 'stolperstein', 'stone', 'tile'}
STRIPS = {2: ('West', 'East'), 3: ('West', 'Central', 'East'), 4: ('West', 'Central West', 'Central East', 'East'),
          5: ('West', 'Central West', 'Central', 'Central East', 'East')}
NORTH_SOUTH = {'West': 'North', 'East': 'South', 'Central West': 'Central North', 'Central East': 'Central South'}
FLAG_SMALL, FLAG_NO_GROUND = 1, 2   # why a neighbourhood has no god: too small (a piece of land under 0.25 km2), no
#                                     square for its heart (every one tagged)


def log(*a):
    print(*a, flush=True)


def tags_of(v):
    try:
        return json.loads(v) if isinstance(v, str) and v else {}
    except ValueError:
        return {}


def norm(name):
    """A name as one place: case, accents, punctuation and spaces gone, 'St.' as 'Saint', and 'the', 'district' and
    'neighbo(u)rhood' dropped, so Castro District is Castro, and Sea Cliff Seacliff."""
    s = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode().lower()
    s = re.sub(r'\bst\b\.?', 'saint', s)
    words = re.sub(r'[^a-z0-9]+', ' ', s).split()
    return ''.join(w for w in words if w not in ('the', 'district', 'neighborhood', 'neighbourhood'))


def norm_admin(name):
    """A borough's name without its kind: 'City of Westminster' and 'Westminster', 'Royal Borough of Kensington and Chelsea'
    and 'Kensington and Chelsea' are one."""
    s = re.sub(r'^(the |royal |london )*(city|town|borough|county|municipality|district) of ', '', name.strip().lower())
    s = re.sub(r' (county|borough|municipality)$', '', s)
    return norm(s)


def pack(ix, iz):
    """areas.ts packSquare: ix and iz as two 16-bit halves."""
    return ((ix & 0xffff) << 16 | (iz & 0xffff)) & 0xffffffff


def pack_hoods(t):
    """hoods.bin's bytes before gzip (src/world/hoods.ts has the layout) from a dict: ix0, iz0, w, h, grid (u16 a square:
    0 none, else its neighbourhood + 1), hearts (keys), flags, tagged (a bool a square) and names."""
    n = len(t['names'])
    body = bytearray(b'SBN1' + struct.pack('<HHiiHHI', HOODS_VERSION[0], HOODS_VERSION[1], t['ix0'], t['iz0'], t['w'], t['h'], n))
    body += struct.pack(f'<{n}I', *t['hearts'])
    body += bytes(t['flags'])
    body += b'\0' * ((-len(body)) % 4)
    body += np.asarray(t['grid'], '<u2').tobytes()
    body += np.packbits(np.asarray(t['tagged'], np.uint8), bitorder='little').tobytes()
    body += b'\0' * ((-len(body)) % 4)
    for nm in t['names']:
        b = nm.encode('utf-8')
        if len(b) > 255:
            raise SystemExit(f'a name over 255 bytes: {nm}')
        body += bytes([len(b)]) + b
    return bytes(body)


def unpack_hoods(body):
    """pack_hoods' dict from hoods.bin's bytes (gzipped or not), read as src/world/hoods.ts reads them; ValueError for a
    file it can't read."""
    if body[:2] == b'\x1f\x8b':
        body = gzip.decompress(body)
    if len(body) < 24 or body[:4] != b'SBN1':
        raise ValueError('not SBN1')
    major, minor, ix0, iz0, w, h, n = struct.unpack_from('<HHiiHHI', body, 4)
    if major != HOODS_VERSION[0]:
        raise ValueError(f'version {major}')
    nb = (w * h + 7) // 8
    grid_at = (24 + 5 * n + 3) & ~3
    names_at = (grid_at + 2 * w * h + nb + 3) & ~3
    if names_at + n > len(body):
        raise ValueError('counts past the bytes')
    hearts = list(struct.unpack_from(f'<{n}I', body, 24))
    flags = list(body[24 + 4 * n:24 + 5 * n])
    grid = np.frombuffer(body, '<u2', w * h, grid_at).copy()
    tagged = np.unpackbits(np.frombuffer(body, np.uint8, nb, grid_at + 2 * w * h), bitorder='little')[:w * h].astype(bool)
    if grid.max(initial=0) > n:
        raise ValueError('a square past the neighbourhoods')
    names, o = [], names_at
    for _ in range(n):
        if o >= len(body) or o + 1 + body[o] > len(body):
            raise ValueError('cut short in the names')
        names.append(body[o + 1:o + 1 + body[o]].decode('utf-8'))
        o += 1 + body[o]
    return dict(major=major, minor=minor, ix0=ix0, iz0=iz0, w=w, h=h, grid=grid, hearts=hearts, flags=flags,
                tagged=tagged, names=names)


class Hoods:
    def __init__(self, slug, out=None):
        self.slug = slug
        self.city = os.path.join(ROOT, 'public', 'city', slug)
        self.out = out or self.city
        self.cfg = json.load(open(os.path.join(HERE, 'cities', f'{slug}.json'), encoding='utf-8'))
        man_dir = self.out if os.path.exists(os.path.join(self.out, 'city.json')) else self.city
        self.man_path = os.path.join(man_dir, 'city.json')
        self.man = json.load(open(self.man_path, encoding='utf-8'))
        release = self.cfg.get('overture', {}).get('release', '2026-10-21.0')
        self.ov = os.path.join(CACHE, release, slug)
        self.release = release
        tr = Transformer.from_crs('EPSG:4326', self.man['proj'], always_xy=True)

        def f(c):
            e, n = tr.transform(c[:, 0], c[:, 1])
            return np.column_stack([e, -np.asarray(n)])
        self._proj = f
        x0, z0, x1, z1 = self.man['bounds']
        self.frame = shapely.box(x0, z0, x1, z1)
        self.ix0, self.iz0 = math.floor(x0 / SQ), math.floor(z0 / SQ)
        self.w, self.h = math.ceil(x1 / SQ) - self.ix0, math.ceil(z1 / SQ) - self.iz0
        self.sx0, self.sz0 = self.ix0 * SQ, self.iz0 * SQ   # the lattice's corner
        self.missing = []
        # the map's own city, never a neighbourhood's name ('San Francisco'; 'Amsterdam (Jordaan)' is Amsterdam)
        self.city_name = re.sub(r'\s*\(.*\)\s*$', '', self.man.get('name', '')).strip()
        self.notes = []

    # ------------------------------------------------------------------ the baked tiles

    def read_tiles(self):
        """Per square: land and open ground shares, the highest open ground; the 8 m lattice's land samples."""
        W, H = self.w, self.h
        T = float(self.man['tileSize'])
        N = int(self.man.get('classN', 128))
        per = int(round(T / SQ))           # squares a tile's side
        k = N // per                       # texels a square's side
        st = N // (per * SUB)              # texels a sample's side
        self.land = np.zeros(H * W)
        self.open = np.zeros(H * W)
        self.high = np.full(H * W, -np.inf)
        self.samples = np.zeros((H * SUB, W * SUB), bool)
        tiles = 0
        for t in City(self.city).terrain_tiles():
            i0 = int(round(t['originX'] / SQ)) - self.ix0
            j0 = int(round(t['originZ'] / SQ)) - self.iz0
            if i0 < 0 or j0 < 0 or i0 + per > W or j0 + per > H:
                continue   # past the frame: a tile that only holds the buildings crossing its edge
            tiles += 1
            cls = t['cls'] & 15
            water = cls == WATER
            op = np.isin(cls, OPEN)
            ls = (~water).reshape(per, k, per, k).mean(axis=(1, 3))
            os_ = op.reshape(per, k, per, k).mean(axis=(1, 3))
            self.samples[j0 * SUB:(j0 + per) * SUB, i0 * SUB:(i0 + per) * SUB] = ~water[st // 2::st, st // 2::st]
            hts = t['heights']
            n = hts.shape[0]
            hc = cls[np.ix_(np.minimum(np.round(np.arange(n) * (N / (n - 1))).astype(int), N - 1),
                            np.minimum(np.round(np.arange(n) * (N / (n - 1))).astype(int), N - 1))]
            hopen = np.where(np.isin(hc, OPEN), hts, -np.inf)
            hs = (n - 1) // per
            for b in range(per):
                for a in range(per):
                    s = (j0 + b) * W + i0 + a
                    self.land[s] = ls[b, a]
                    self.open[s] = os_[b, a]
                    self.high[s] = hopen[b * hs:(b + 1) * hs + 1, a * hs:(a + 1) * hs + 1].max()
        self.is_land = self.land >= LAND
        self.samples &= np.repeat(np.repeat(self.is_land.reshape(H, W), SUB, 0), SUB, 1)
        self.landN = self.samples.reshape(H, SUB, W, SUB).sum(axis=(1, 3)).ravel()
        lab, n = ndimage.label(self.is_land.reshape(H, W), structure=np.ones((3, 3)))
        self.comp = lab.ravel() - 1          # -1: water
        self.ncomp = n
        idx = np.nonzero(self.is_land)[0]
        self.land_idx = idx
        self.cx = (self.ix0 + idx % W + 0.5) * SQ
        self.cz = (self.iz0 + idx // W + 0.5) * SQ
        self.tree = cKDTree(np.column_stack([self.cx, self.cz]))
        log(f'tiles {tiles} in the frame; squares {W} x {H}, land {len(idx)} in {n} pieces of land')

    def centre(self, s):
        return (self.ix0 + s % self.w + 0.5) * SQ, (self.iz0 + s // self.w + 0.5) * SQ

    def key(self, s):
        return pack(self.ix0 + s % self.w, self.iz0 + s // self.w)

    def near_land(self, x, z):
        """(distance to the nearest land square, that square) for a point."""
        d, j = self.tree.query([x, z], k=min(9, len(self.land_idx)))
        best = (math.inf, -1)
        for dj, jj in zip(np.atleast_1d(d), np.atleast_1d(j)):
            dx = max(abs(self.cx[jj] - x) - SQ / 2, 0.0)
            dz = max(abs(self.cz[jj] - z) - SQ / 2, 0.0)
            dd = math.hypot(dx, dz)
            if dd < best[0] or (dd == best[0] and self.land_idx[jj] < best[1]):
                best = (dd, int(self.land_idx[jj]))
        return best

    def cover(self, g):
        """(squares, land samples inside g) for a polygon g, squares in order."""
        b = g.bounds
        i0 = max(0, int(math.floor((b[0] - self.sx0) / STEP)))
        j0 = max(0, int(math.floor((b[1] - self.sz0) / STEP)))
        i1 = min(self.w * SUB, int(math.ceil((b[2] - self.sx0) / STEP)) + 1)
        j1 = min(self.h * SUB, int(math.ceil((b[3] - self.sz0) / STEP)) + 1)
        if i1 <= i0 or j1 <= j0:
            return np.zeros(0, np.int64), np.zeros(0, np.int64)
        X, Z = np.meshgrid(self.sx0 + (np.arange(i0, i1) + 0.5) * STEP, self.sz0 + (np.arange(j0, j1) + 0.5) * STEP)
        shapely.prepare(g)
        inside = shapely.contains_xy(g, X, Z) & self.samples[j0:j1, i0:i1]
        jj, ii = np.nonzero(inside)
        s = ((jj + j0) // SUB) * self.w + (ii + i0) // SUB
        return np.unique(s, return_counts=True)

    def mark(self, g, raster):
        """raster |= g's samples (the land's alone)."""
        b = g.bounds
        i0 = max(0, int(math.floor((b[0] - self.sx0) / STEP)))
        j0 = max(0, int(math.floor((b[1] - self.sz0) / STEP)))
        i1 = min(self.w * SUB, int(math.ceil((b[2] - self.sx0) / STEP)) + 1)
        j1 = min(self.h * SUB, int(math.ceil((b[3] - self.sz0) / STEP)) + 1)
        if i1 <= i0 or j1 <= j0:
            return
        X, Z = np.meshgrid(self.sx0 + (np.arange(i0, i1) + 0.5) * STEP, self.sz0 + (np.arange(j0, j1) + 0.5) * STEP)
        shapely.prepare(g)
        raster[j0:j1, i0:i1] |= shapely.contains_xy(g, X, Z) & self.samples[j0:j1, i0:i1]

    # ------------------------------------------------------------------ the Overture extract

    def read(self, typ, cols, filters=None):
        """(rows, geometries in the map's frame) of the city's extract, only what's within a kilometre of the frame."""
        path = os.path.join(self.ov, f'{typ}.parquet')
        if not os.path.exists(path):
            self.missing.append(typ)
            return [], np.array([], dtype=object)
        have = pq.ParquetFile(path).schema_arrow.names
        t = pq.read_table(path, columns=[c for c in cols if c in have] + ['geometry'], filters=filters)
        g = shapely.transform(shapely.from_wkb(t['geometry'].to_numpy(zero_copy_only=False)), self._proj)
        keep = shapely.intersects(g, self.frame.buffer(1000.0))
        rows = t.drop_columns(['geometry']).to_pylist()
        return [r for r, k in zip(rows, keep) if k], g[keep]

    def read_sources(self):
        divs, dg = self.read('division', ['id', 'subtype', 'class', 'name', 'local_type', 'osm_id'])
        areas, ag = self.read('division_area', ['id', 'subtype', 'class', 'name', 'division_id', 'osm_id'])
        lu, lg = self.read('land_use', ['id', 'subtype', 'class', 'name', 'tags', 'osm_id'])
        land, ng = self.read('land', ['id', 'subtype', 'class', 'name', 'tags', 'osm_id'])
        infra, ig = self.read('infrastructure', ['id', 'subtype', 'class', 'name', 'tags'])
        bld, bg = self.read('building', ['id', 'subtype', 'class', 'name'],
                            filters=[('subtype', 'in', list(TAG_BUILDING_SUBS) + ['medical'])])
        if self.missing:
            self.notes.append(f'not in the extract {self.ov}: {", ".join(self.missing)}')
        self.src = dict(divs=(divs, dg), areas=(areas, ag), lu=(lu, lg), land=(land, ng), infra=(infra, ig), bld=(bld, bg))
        log(f'overture {self.release}: {len(divs)} division points, {len(areas)} outlines, {len(lu)} land use, '
            f'{len(land)} land, {len(infra)} infrastructure, {len(bld)} buildings that may be tagged')

    # ------------------------------------------------------------------ seeds

    def seeds(self):
        divs, dg = self.src['divs']
        areas, ag = self.src['areas']
        admin = set()
        for r in divs + areas:
            if r['subtype'] in ADMIN_SUBS and r.get('name'):
                admin.add(norm_admin(r['name']))
        own = {norm(self.city_name)} | {norm_admin(self.city_name)}
        # the outlines' own sizes, by division: a point whose outline is over 8 km2 names a borough
        div_m2 = {}
        for r, g in zip(areas, ag):
            if r.get('class') == 'land' and r.get('division_id'):
                div_m2[r['division_id']] = max(div_m2.get(r['division_id'], 0.0), g.area)
        squares = set()   # (names of squares and plazas: an outline has no local type of its own)
        plaza = set()
        for i, r in enumerate(divs):
            lt = tags_of(r.get('local_type'))
            if any(v in ('square', 'plaza') for v in lt.values()):
                squares.add(r['name'])
                plaza.add(i)
        self.dropped = []
        S = []   # seeds: dict(name, kind, x, z, comp, ...)
        by_norm = {}

        def borough(r, area_m2):
            nm = r['name']
            return (norm_admin(nm) in admin and r['subtype'] in HOOD_SUBS) or area_m2 > OUTLINE_M2[1]

        def add(name, kind, x, z, src, sub):
            d, s = self.near_land(x, z)
            if d > NEAR_LAND:
                return None
            key = norm(name)
            comp = int(self.comp[s])
            if key in by_norm and S[by_norm[key]]['comp'] == comp:
                S[by_norm[key]]['also'].append((name, x, z, src))   # one place, two names or two points: one seed
                return by_norm[key]
            S.append(dict(name=name, kind=kind, x=float(x), z=float(z), comp=comp, src=src, sub=sub, also=[], polys=[]))
            by_norm.setdefault(key, len(S) - 1)
            return len(S) - 1

        order = sorted(range(len(divs)), key=lambda i: (HOOD_SUBS.index(divs[i]['subtype']) if divs[i]['subtype'] in HOOD_SUBS else 9,
                                                        divs[i].get('name') or '', str(divs[i].get('id'))))
        for i in order:
            r, g = divs[i], dg[i]
            nm = (r.get('name') or '').strip()
            if not nm or g is None or g.geom_type != 'Point':
                continue
            town = r['subtype'] == 'locality' and r.get('class') in TOWN_CLASSES
            if r['subtype'] not in HOOD_SUBS and not town:
                continue
            if i in plaza or norm(nm) in own:   # (a square's own point, never its namesake's: Union Square is both)
                continue
            if borough(r, div_m2.get(r.get('id'), 0.0)):
                self.dropped.append(f'{nm} (named after a whole borough)')
                continue
            add(nm, 'point', g.x, g.y, f'division {r["subtype"]} {r.get("osm_id") or r.get("id")}', r['subtype'])
        # outlines, smallest first when they cover a square
        self.outlines = []
        aorder = sorted(range(len(areas)), key=lambda i: (ag[i].area, areas[i].get('name') or ''))
        for i in aorder:
            r, g = areas[i], ag[i]
            nm = (r.get('name') or '').strip()
            if (r['subtype'] not in HOOD_SUBS or r.get('class') != 'land' or not nm or nm in squares or norm(nm) in own
                    or g.geom_type not in ('Polygon', 'MultiPolygon')):
                continue
            if not OUTLINE_M2[0] <= g.area <= OUTLINE_M2[1] or norm_admin(nm) in admin:
                if g.area > OUTLINE_M2[1] or norm_admin(nm) in admin:
                    self.dropped.append(f'{nm} outline, {g.area / 1e6:.2f} km2 (a whole borough)')
                continue
            sq, n = self.cover(g)
            if not len(sq):
                continue
            key = norm(nm)
            si = by_norm.get(key)
            if si is None:
                p = g.representative_point()
                si = add(nm, 'outline', p.x, p.y, f'division_area {r["subtype"]} {r.get("osm_id") or r.get("id")}', r['subtype'])
                if si is None:   # its point is far off the land: the outline alone, from a square it covers
                    s0 = int(sq[np.argmax(n)])
                    x, z = self.centre(s0)
                    si = add(nm, 'outline', x, z, f'division_area {r["subtype"]} {r.get("osm_id") or r.get("id")}', r['subtype'])
            S[si]['polys'].append(i)
            self.outlines.append((g.area, si, sq, n, g))
        # parks: every park-like polygon (for parks kept whole and for hearts); the big named ones are neighbourhoods
        lu, lg = self.src['lu']
        self.parks = []
        for i, (r, g) in enumerate(zip(lu, lg)):
            if (r.get('subtype'), r.get('class')) not in PARK_LIKE or g.geom_type not in ('Polygon', 'MultiPolygon'):
                continue
            sq, n = self.cover(g)
            if not len(sq):
                continue
            self.parks.append(dict(i=i, name=(r.get('name') or '').strip(), g=g, sq=sq, n=n, m2=float(n.sum()) * STEP * STEP,
                                   src=f'land_use {r.get("class")} {r.get("osm_id") or r.get("id")}'))
        self.parks.sort(key=lambda p: (-p['m2'], p['name'], p['i']))
        # the squares each park holds: those it covers PARK_SQUARE of that no bigger park holds (they're kept whole)
        held = np.zeros(self.w * self.h, bool)
        for p in self.parks:
            f = p['n'] / np.maximum(self.landN[p['sq']], 1)
            p['own'] = p['sq'][(f >= PARK_SQUARE) & ~held[p['sq']]]
            held[p['own']] = True
        self.big = []
        for pi, p in enumerate(self.parks):
            if not p['name'] or p['m2'] < BIG_PARK or norm(p['name']) in own:
                continue
            # (the park's biggest piece of land: a park on two islands is its pieces' business)
            comp = int(np.bincount(self.comp[p['sq']], weights=p['n']).argmax())
            si = by_norm.get(norm(p['name']))
            if si is not None and S[si]['comp'] == comp:   # a place and its park, one name: the place's seed takes the park
                S[si]['park'] = pi
                self.big.append((pi, si))
                continue
            x, z = self.centre(int(p['sq'][np.argmax(p['n'])]))
            S.append(dict(name=p['name'], kind='park', x=float(x), z=float(z), comp=comp, src=p['src'], sub='park',
                          also=[], polys=[], park=pi))
            by_norm.setdefault(norm(p['name']), len(S) - 1)
            self.big.append((pi, len(S) - 1))
        self.S = S
        log(f'seeds: {sum(s["kind"] == "point" for s in S)} points, {sum(s["kind"] == "outline" for s in S)} outlines alone, '
            f'{len(self.outlines)} outlines in all, {len(self.big)} big parks; {len(self.parks)} parks; '
            f'left out: {", ".join(self.dropped) or "none"}')

    def sparse(self):
        """Lattice points on a piece of land too big to be one neighbourhood where no seed is within SPARSE, and one seed
        for a piece of land with none (Treasure Island and Yerba Buena Island, Alcatraz)."""
        S = self.S
        geoms = [shapely.Point(s['x'], s['z']) for s in S if s['kind'] != 'park']
        geoms += [self.src['areas'][1][a] for s in S for a in s['polys']]
        geoms += [self.parks[s['park']]['g'] for s in S if s['kind'] == 'park']
        tree = shapely.STRtree(geoms) if geoms else None
        big = np.bincount(self.comp[self.land_idx], minlength=self.ncomp) > MAX_SQUARES
        x0, z0, x1, z1 = self.man['bounds']
        fill = []
        for gz in range(math.ceil(z0 / FILL), math.floor(z1 / FILL) + 1):
            for gx in range(math.ceil(x0 / FILL), math.floor(x1 / FILL) + 1):
                x, z = gx * FILL, gz * FILL
                d, s = self.near_land(x, z)
                if d > FILL_MOVE or not big[self.comp[s]]:
                    continue
                p = shapely.Point(x, z)
                if tree is not None:
                    j = tree.query_nearest(p, return_distance=True)
                    if len(j[1]) and j[1][0] <= SPARSE:
                        continue
                # the most open ground within FILL_MOVE
                cand = [int(self.land_idx[k]) for k in self.tree.query_ball_point([x, z], FILL_MOVE)]
                if not cand:
                    cand = [s]
                best = min(cand, key=lambda c: (-round(self.open[c], 3), math.hypot(self.centre(c)[0] - x, self.centre(c)[1] - z), c))
                fill.append(best)
        have = {s['comp'] for s in S} | {int(self.comp[f]) for f in fill}
        for c in range(self.ncomp):
            if c in have:
                continue
            cs = np.nonzero(self.comp == c)[0]
            mx, mz = np.mean([self.centre(s)[0] for s in cs]), np.mean([self.centre(s)[1] for s in cs])
            fill.append(int(min(cs, key=lambda s: (-round(self.open[s], 3), math.hypot(self.centre(s)[0] - mx, self.centre(s)[1] - mz), s))))
        self.fill = sorted(set(fill))
        for s in self.fill:
            x, z = self.centre(s)
            S.append(dict(name=None, kind='fill', x=x, z=z, comp=int(self.comp[s]), src='lattice', sub='fill', also=[], polys=[]))
        log(f'sparse: {len(self.fill)} lattice points')

    def comps_of(self, g):
        """{piece of land: land samples or points of g on it}: a polygon by the samples it covers, a line or a point by
        the squares under it (a point off the land by its nearest land square within NEAR_LAND)."""
        out = {}
        if g.geom_type in ('Polygon', 'MultiPolygon'):
            sq, n = self.cover(g)
            for s, k in zip(sq.tolist(), n.tolist()):
                c = int(self.comp[s])
                out[c] = out.get(c, 0) + k
            if out:
                return out
            g = g.representative_point()
        if g.geom_type in ('LineString', 'MultiLineString'):
            pts = [g.interpolate(d) for d in np.arange(0.0, g.length + 1e-9, STEP * 4)]
        else:
            pts = [g if g.geom_type == 'Point' else g.representative_point()]
        for p in pts:
            i, j = int((p.x - self.sx0) // SQ), int((p.y - self.sz0) // SQ)
            s = j * self.w + i if 0 <= i < self.w and 0 <= j < self.h else -1
            if s < 0 or not self.is_land[s]:
                d, s = self.near_land(p.x, p.y)
                if d > NEAR_LAND:
                    continue
            c = int(self.comp[s])
            out[c] = out.get(c, 0) + 1
        return out

    def name_fills(self):
        """A lattice seed's name: the nearest unused place, park or land feature on its own piece of land within FILL_NAME,
        else the nearest street's; a piece of land's one seed takes its islands' names, both of them (Treasure Island /
        Yerba Buena Island)."""
        used = {norm(s['name']) for s in self.S if s['name']}
        divs, dg = self.src['divs']
        lu, lg = self.src['lu']
        land, ng = self.src['land']
        cands = []
        for r, g in zip(divs, dg):
            if r.get('name') and r['subtype'] in HOOD_SUBS + ('locality',) and r.get('class') != 'city':
                cands.append((r['name'].strip(), g, 'place'))
        for r, g in zip(lu, lg):
            if r.get('name') and r.get('subtype') in NAME_PARKS:
                cands.append((r['name'].strip(), g, 'park'))
        for r, g in zip(land, ng):
            if r.get('name') and r.get('class') in NAME_LAND:
                cands.append((r['name'].strip(), g, r.get('class')))
        own = {norm(self.city_name)}
        cands = [c for c in cands if norm(c[0]) not in own and norm(c[0])]
        fills = [s for s in self.S if s['kind'] == 'fill']
        if not fills:
            return
        comps = [self.comps_of(c[1]) for c in cands]
        tree = shapely.STRtree([c[1] for c in cands]) if cands else None
        streets = None
        lone = {c: sum(1 for s in self.S if s['comp'] == c) == 1 for c in range(self.ncomp)}
        for s in fills:
            p = shapely.Point(s['x'], s['z'])
            pick = None
            if lone[s['comp']]:
                # the islands covering a fifth of the piece of land, most first, two at most; else the park that covers
                # most of it, the smallest of equals (Alcatraz Island, not the recreation area round it)
                tot = int(self.landN[self.comp == s['comp']].sum())
                cover = [(comps[k][s['comp']], cands[k][1].area, cands[k][0], cands[k][2]) for k in range(len(cands))
                         if cands[k][1].geom_type in ('Polygon', 'MultiPolygon') and comps[k].get(s['comp'], 0) >= 0.2 * tot
                         and norm(cands[k][0]) not in used]
                isl = sorted((-n, nm) for n, a, nm, kind in cover if kind in ('island', 'islet'))
                names = []
                for _, nm in isl:
                    if not any(norm(nm) == norm(x) for x in names):
                        names.append(nm)
                if not names:
                    parks = sorted((-n, a, nm) for n, a, nm, kind in cover if kind == 'park')
                    names = [parks[0][2]] if parks else []
                if names:
                    pick = ' / '.join(names[:2])
            if not pick and tree is not None:
                hits = tree.query(p.buffer(FILL_NAME))
                ranked = sorted((cands[h][1].distance(p), cands[h][1].area, cands[h][0]) for h in hits
                                if s['comp'] in comps[h] and cands[h][2] != 'islet')
                for d, a, nm in ranked:
                    if norm(nm) not in used:
                        pick = nm
                        break
            if not pick:
                if streets is None:
                    streets = self.streets()
                for d, nm in sorted((g.distance(p), nm) for nm, g in streets):
                    if norm(nm) not in used:
                        pick = nm
                        break
            if not pick:
                pick = f'{self.city_name} {len(used)}'
                self.notes.append(f'a lattice seed at {s["x"]:.0f}, {s["z"]:.0f} found no name: {pick}')
            s['name'] = pick
            used.add(norm(pick))

    def streets(self):
        """(name, line) for the named streets in the tiles, the street sign's own (rank 0)."""
        out = {}
        for t in City(self.city).terrain_tiles():
            for nm, rank, c in t['streets']:
                if rank == 0 and len(c) > 1:
                    out.setdefault(nm, []).append(shapely.LineString(c))
        return [(nm, shapely.MultiLineString(ls)) for nm, ls in sorted(out.items())]

    # ------------------------------------------------------------------ assignment

    def assign(self):
        W, H = self.w, self.h
        own = np.full(W * H, -1, np.int64)
        land = self.land_idx
        # nearest seed on the square's piece of land (big parks only on a piece with no other seed)
        for c in range(self.ncomp):
            cs = land[self.comp[land] == c]
            ss = [i for i, s in enumerate(self.S) if s['comp'] == c and s['kind'] != 'park']
            if not ss:
                ss = [i for i, s in enumerate(self.S) if s['comp'] == c]
            if not ss:
                continue
            pts = np.array([[self.S[i]['x'], self.S[i]['z']] for i in ss])
            xs = (self.ix0 + cs % W + 0.5) * SQ
            zs = (self.iz0 + cs // W + 0.5) * SQ
            _, j = cKDTree(pts).query(np.column_stack([xs, zs]))
            own[cs] = np.array(ss)[j]
        # outlines, smallest first: a square to the smallest covering half its land
        taken = np.zeros(W * H, bool)
        for area, si, sq, n, _ in sorted(self.outlines, key=lambda o: (o[0], o[1])):
            m = (n >= COVER * self.landN[sq]) & ~taken[sq] & (self.comp[sq] == self.S[si]['comp'])
            own[sq[m]] = si
            taken[sq[m]] = True
        # big parks over everything, on their own piece of land
        best = np.zeros(W * H)
        for pi, si in self.big:
            p = self.parks[pi]
            f = p['n'] / np.maximum(self.landN[p['sq']], 1)
            m = (f >= COVER) & (f > best[p['sq']]) & (self.comp[p['sq']] == self.S[si]['comp'])
            own[p['sq'][m]] = si
            best[p['sq'][m]] = f[m]
        self.own = own
        # territories: one per seed with squares
        self.T = {}
        for si, s in enumerate(self.S):
            sq = np.nonzero(own == si)[0]
            if len(sq):
                self.T[si] = dict(parts=[[s['name'], sq]], kind=s['kind'], seed=si, park=s.get('park'), split=None)
        log(f'assigned: {len(self.T)} neighbourhoods from {len(self.S)} seeds')

    def owner_at(self, x, z, comp):
        """The seed a place on piece of land comp goes to by the assignment's rules, for a point: the smallest outline
        holding it, else the nearest seed (a big park's own, on a piece of land with no other)."""
        p = shapely.Point(x, z)
        for area, si, sq, n, g in sorted(self.outlines, key=lambda o: (o[0], o[1])):
            if self.S[si]['comp'] == comp and g.contains(p):
                return si
        ss = [i for i, s in enumerate(self.S) if s['comp'] == comp and s['kind'] != 'park'] or \
             [i for i, s in enumerate(self.S) if s['comp'] == comp]
        return min(ss, key=lambda i: (math.hypot(self.S[i]['x'] - x, self.S[i]['z'] - z), i)) if ss else -1

    def parks_whole(self):
        """A park's squares (it covers PARK_SQUARE of their land) to the neighbourhood its middle is in, by the
        assignment's own rules at its centroid, biggest park first (Dolores Park, between two points, is whole in the one
        nearer its middle). A big park's squares are its own neighbourhood's. A square a bigger park holds isn't taken
        by a smaller one (seeds())."""
        moved = 0
        own = self.own
        bigs = {pi: si for pi, si in self.big}
        for pi, p in enumerate(self.parks):
            ps = p['own']
            if not len(ps):
                continue
            mid = p['g'].centroid
            for c in sorted(set(self.comp[ps].tolist())):
                cs = ps[self.comp[ps] == c]
                to = bigs[pi] if pi in bigs and self.S[bigs[pi]]['comp'] == c else self.owner_at(mid.x, mid.y, c)
                if to < 0:
                    continue
                if to not in self.T:   # a seed whose own squares outlines took: the park makes it a neighbourhood
                    s = self.S[to]
                    self.T[to] = dict(parts=[[s['name'], np.zeros(0, np.int64)]], kind=s['kind'], seed=to, park=s.get('park'), split=None)
                moved += int((own[cs] != to).sum())
                own[cs] = to
        self.rebuild()
        log(f'parks whole: {moved} squares moved')

    def rebuild(self):
        """Territories from self.own after squares moved: each part keeps its squares that are still its territory's."""
        T = {}
        for ti, t in self.T.items():
            sq = np.nonzero(self.own == ti)[0]
            if not len(sq):
                continue
            mine = set(sq.tolist())
            parts = []
            for nm, ps in t['parts']:
                keep = np.array(sorted(mine & set(ps.tolist())), np.int64)
                parts.append([nm, keep])
            got = set().union(*[set(p[1].tolist()) for p in parts]) if parts else set()
            rest = np.array(sorted(mine - got), np.int64)
            if len(rest):
                parts[0][1] = np.union1d(parts[0][1], rest)
            parts = [p for i, p in enumerate(parts) if i == 0 or len(p[1])]
            t = dict(t, parts=parts)
            T[ti] = t
        self.T = T

    def squares(self, ti):
        return np.nonzero(self.own == ti)[0]

    def borders(self, sq, ti):
        """{neighbour: shared edges} for squares sq of territory ti (4-adjacent; 8-adjacent corners if none)."""
        W = self.w
        out = {}
        for diag in (False, True):
            steps = ((1, 0), (-1, 0), (0, 1), (0, -1)) if not diag else ((1, 1), (1, -1), (-1, 1), (-1, -1))
            i, j = sq % W, sq // W
            for di, dj in steps:
                ii, jj = i + di, j + dj
                ok = (ii >= 0) & (ii < W) & (jj >= 0) & (jj < self.h)
                nb = self.own[(jj[ok] * W + ii[ok])]
                nb = nb[(nb >= 0) & (nb != ti)]
                for v, c in zip(*np.unique(nb, return_counts=True)):
                    out[int(v)] = out.get(int(v), 0) + int(c)
            if out:
                break
        return out

    def join(self, small, big):
        """Territory small into big, its parts after big's."""
        self.own[self.own == small] = big
        self.T[big]['parts'] += self.T[small]['parts']
        del self.T[small]

    def pieces(self, ti):
        sq = self.squares(ti)
        m = np.zeros(self.w * self.h, bool)
        m[sq] = True
        lab, n = ndimage.label(m.reshape(self.h, self.w), structure=np.ones((3, 3)))
        lab = lab.ravel()
        return [sq[lab[sq] == k] for k in range(1, n + 1)]

    def merge(self):
        """Pieces apart from a neighbourhood's biggest, then neighbourhoods under MIN_SQUARES, into the neighbour with the
        longest shared border; a whole piece of land under it stays (godless)."""
        exclaves = joined = 0
        for ti in sorted(self.T):
            if ti not in self.T:
                continue
            ps = sorted(self.pieces(ti), key=lambda p: (-len(p), int(p[0])))
            pk = self.T[ti].get('park')
            if pk is not None:   # a big park in pieces round its lake stays whole
                f = self.parks[pk]['n'] / np.maximum(self.landN[self.parks[pk]['sq']], 1)
                mine = set(self.parks[pk]['sq'][f >= PARK_SQUARE].tolist())
                ps = ps[:1] + [p for p in ps[1:] if not mine & set(p.tolist())]
            for p in ps[1:]:
                b = self.borders(p, ti)
                if not b:
                    continue
                to = max(sorted(b), key=lambda v: b[v])
                self.own[p] = to
                exclaves += 1
        self.rebuild()
        self.small = set()
        while True:
            cand = sorted((len(self.squares(ti)), ti) for ti in self.T if ti not in self.small)
            cand = [(n, ti) for n, ti in cand if n < MIN_SQUARES]
            if not cand:
                break
            n, ti = cand[0]
            b = self.borders(self.squares(ti), ti)
            if not b:
                self.small.add(ti)   # a whole piece of land: no god (Alcatraz)
                continue
            to = max(sorted(b), key=lambda v: (b[v], -len(self.squares(v))))
            self.join(ti, to)
            joined += 1
        log(f'merged: {exclaves} pieces apart, {joined} neighbourhoods under {MIN_SQUARES} squares; '
            f'{len(self.small)} pieces of land too small for a god')

    def split(self):
        """Over MAX_SQUARES: k strips across the longer side, each connected within the parent and none over MAX_SQUARES
        (k grows till none is), a park of up to PARK_WHOLE squares in one strip."""
        n_split = 0
        nxt = max(self.T) + 1 if self.T else 0
        for ti in sorted(self.T):
            sq = self.squares(ti)
            if len(sq) <= MAX_SQUARES:
                continue
            k = math.ceil(len(sq) / MAX_SQUARES)
            while True:
                strip, axis_x = self.strips(sq, k)
                if np.bincount(strip, minlength=k).max() <= MAX_SQUARES or k >= len(sq):
                    break
                k += 1
            words = STRIPS.get(k) or tuple(str(n + 1) for n in range(k))
            if not axis_x:
                words = tuple(NORTH_SOUTH.get(w_, w_) for w_ in words)
            t = self.T[ti]
            base = t['parts'][0][0]
            ids = [ti] + list(range(nxt, nxt + k - 1))
            nxt += k - 1
            for g in range(k):
                tg = ids[g]
                gs = sq[strip == g]
                if g:
                    self.own[gs] = tg
                parts = [[f'{base} {words[g]}', gs]]
                for nm, ps in t['parts'][1:]:   # a merged name goes with the strip holding most of it
                    got = np.intersect1d(ps, gs)
                    share = [len(np.intersect1d(ps, sq[strip == h])) for h in range(k)]
                    if len(got) and int(np.argmax(share)) == g:
                        parts.append([nm, got])
                self.T[tg] = dict(t, parts=parts, split=(ti, g, k))
            n_split += 1
        self.rebuild()
        log(f'split: {n_split} over {MAX_SQUARES} squares, now {len(self.T)} neighbourhoods')

    def strips(self, sq, k):
        """(strip of each square, across x?) for squares sq in k strips of about equal size along their longer side."""
        W = self.w
        i, j = sq % W, sq // W
        axis_x = (i.max() - i.min()) >= (j.max() - j.min())
        pos = (i if axis_x else j).astype(float)
        # units: the squares a park holds go together; a park bigger than PARK_WHOLE (the neighbourhood's own: the
        # Presidio, Golden Gate Park) is what's being split
        unit = np.arange(len(sq))
        where = {int(s): u for u, s in enumerate(sq)}
        for p in self.parks:
            ps = [where[s] for s in p['own'].tolist() if s in where]
            if 1 < len(ps) and len(p['own']) <= PARK_WHOLE:
                u0 = min(unit[ps])
                for u in set(unit[ps].tolist()):
                    unit[unit == u] = u0
        us = sorted(set(unit.tolist()), key=lambda u: (pos[unit == u].mean(), int(sq[unit == u].min())))
        target = len(sq) / k
        strip = np.zeros(len(sq), np.int64)
        acc, g = 0, 0
        for u in us:
            m = unit == u
            if acc + m.sum() / 2 > target * (g + 1) and g < k - 1:
                g += 1
            strip[m] = g
            acc += m.sum()
        # each strip in one piece: its other pieces to the strip of the same parent they touch most (a park's whole)
        for _ in range(8):
            moved = False
            for g in range(k):
                m = np.zeros(W * self.h, bool)
                m[sq[strip == g]] = True
                lab, nl = ndimage.label(m.reshape(self.h, W), structure=np.ones((3, 3)))
                if nl <= 1:
                    continue
                lab = lab.ravel()
                sizes = np.bincount(lab[sq[strip == g]])
                keep = int(np.argmax(sizes[1:])) + 1
                for piece in range(1, nl + 1):
                    if piece == keep:
                        continue
                    idx = np.nonzero((strip == g) & (lab[sq] == piece))[0]
                    touch = {}
                    for q in idx:
                        for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                            s2 = int(sq[q]) + dj * W + di
                            if s2 in where and strip[where[s2]] != g:
                                touch[int(strip[where[s2]])] = touch.get(int(strip[where[s2]]), 0) + 1
                    if touch:
                        to = max(sorted(touch), key=lambda v: touch[v])
                        grp = np.isin(unit, unit[idx])
                        strip[grp] = to
                        moved = True
            if not moved:
                break
        return strip, axis_x

    # ------------------------------------------------------------------ tagged places

    def tagged(self):
        """Per square: the share of its land under places the map tags (worship, cemetery, memorial, school, hospital),
        and whether any is in it at all, a memorial's point included (a heart never stands on one)."""
        R = np.zeros_like(self.samples)
        polys = points = 0
        lu, lg = self.src['lu']
        for r, g in zip(lu, lg):
            t = tags_of(r.get('tags'))
            hit = (r.get('subtype') in TAG_SUBTYPES or r.get('class') in TAG_LAND_USE or t.get('amenity') in TAG_AMENITY
                   or t.get('landuse') in ('religious', 'cemetery') or t.get('healthcare') == 'hospital'
                   or self.memorial(t))
            if hit and g.geom_type in ('Polygon', 'MultiPolygon'):
                self.mark(g, R)
                polys += 1
        bld, bg = self.src['bld']
        for r, g in zip(bld, bg):
            if (r.get('subtype') in TAG_BUILDING_SUBS or r.get('class') == 'hospital') and g.geom_type in ('Polygon', 'MultiPolygon'):
                self.mark(g, R)
                polys += 1
        any_ = R.reshape(self.h, SUB, self.w, SUB).any(axis=(1, 3)).ravel()
        for key in ('land', 'infra'):
            rows, gs = self.src[key]
            for r, g in zip(rows, gs):
                t = tags_of(r.get('tags'))
                if not self.memorial(t):
                    continue
                if g.geom_type in ('Polygon', 'MultiPolygon'):
                    self.mark(g, R)
                    polys += 1
                else:
                    p = g.representative_point() if g.geom_type != 'Point' else g
                    i = int((p.x - self.sx0) // SQ)
                    j = int((p.y - self.sz0) // SQ)
                    if 0 <= i < self.w and 0 <= j < self.h:
                        any_[j * self.w + i] = True
                        points += 1
        share = R.reshape(self.h, SUB, self.w, SUB).sum(axis=(1, 3)).ravel() / np.maximum(self.landN, 1)
        any_ |= share > 0
        self.tag = self.is_land & (share >= TAGGED)
        self.tag_any = self.is_land & any_
        log(f'tagged: {polys} places mapped as areas, {points} memorials as points; {int(self.tag.sum())} squares tagged '
            f'(a quarter of their land), {int(self.tag_any.sum())} with any')

    @staticmethod
    def memorial(t):
        m = t.get('memorial')
        return (t.get('historic') in ('memorial', 'monument') and m not in SMALL_MEMORIALS) or (bool(m) and m not in SMALL_MEMORIALS)

    # ------------------------------------------------------------------ hearts

    def candidates(self, ti):
        """The squares a heart may take, best first: its biggest park's, its other parks' by size, then the highest open
        ground, then any; tagged squares never, and squares with any tagged place only after every clean one."""
        sq = self.squares(ti)
        mine = set(sq.tolist())
        W = self.w
        ring = {}
        for s in sq.tolist():
            n = 0
            for dj in (-1, 0, 1):
                for di in (-1, 0, 1):
                    if (di or dj) and 0 <= s % W + di < W and (s + dj * W + di) in mine:
                        n += 1
            ring[s] = n
        tiers = []
        seen = set()
        parks = []
        for pi, p in enumerate(self.parks):
            inside = np.isin(p['sq'], sq)
            if not inside.any():
                continue
            f = p['n'] / np.maximum(self.landN[p['sq']], 1)
            ps = p['sq'][inside & (f >= PARK_SQUARE)]
            if len(ps):
                parks.append((-float(p['n'][inside].sum()), pi, ps, f[inside & (f >= PARK_SQUARE)]))
        for _, pi, ps, f in sorted(parks, key=lambda t: (t[0], t[1])):
            p = self.parks[pi]
            mx = np.average([self.centre(s)[0] for s in ps], weights=f)
            mz = np.average([self.centre(s)[1] for s in ps], weights=f)
            order = sorted(zip(ps.tolist(), f.tolist()), key=lambda t: (-round(t[1], 2), -ring[t[0]],
                           round(math.hypot(self.centre(t[0])[0] - mx, self.centre(t[0])[1] - mz), 1), t[0]))
            order = [s for s, _ in order if s not in seen]
            tiers += [(s, 'park', p['name'] or 'a park', 0, len(order)) for s in order]
            seen |= set(order)
        high = sorted((s for s in sq.tolist() if s not in seen), key=lambda s: (
            self.open[s] < OPEN_HEART, -round(float(self.high[s]) if np.isfinite(self.high[s]) else -1e9, 1),
            -round(self.open[s], 2), -ring[s], s))
        n_open = sum(1 for s in high if self.open[s] >= OPEN_HEART)
        tiers += [(s, 'high ground', None, 1, n_open) if self.open[s] >= OPEN_HEART else (s, 'built ground', None, 2, len(high) - n_open)
                  for s in high]
        clean = [c for c in tiers if not self.tag_any[c[0]]]
        light = [c for c in tiers if self.tag_any[c[0]] and not self.tag[c[0]]]
        return clean + light

    def hearts(self):
        """The most hemmed in first: a park heart before high ground, the park with the fewest squares first, the
        smallest neighbourhood first; each takes its best square at least HEARTS_APART from those placed. One that
        fails goes first next round; one that still fails after 6 rounds is given back, to join the neighbour in its way."""
        cands = {ti: self.candidates(ti) for ti in self.T}

        def prio(ti):
            c = cands[ti]
            return (c[0][3], c[0][4], len(self.squares(ti)), ti) if c else (9, 0, 0, ti)
        first = []
        for rnd in range(7):
            order = first + [ti for ti in sorted(self.T, key=prio) if ti not in first]
            placed = {}
            pts = []
            failed = []
            for ti in order:
                if not cands[ti]:   # every square tagged: no god, its heart only a square to name (FLAG_NO_GROUND)
                    placed[ti] = (int(self.squares(ti)[0]), 'none', None)
                    continue
                if ti in self.small:   # too small for a god: its heart is its most open square, wherever the others are
                    placed[ti] = cands[ti][0][:3]
                    continue
                pick = None
                for s, kind, what, _, _ in cands[ti]:
                    x, z = self.centre(s)
                    if all(math.hypot(x - a, z - b) >= HEARTS_APART for a, b in pts):
                        pick = (s, kind, what)
                        break
                if pick is None:
                    failed.append(ti)
                    continue
                placed[ti] = pick
                pts.append(self.centre(pick[0]))
            if not failed:
                self.heart = placed
                return []
            first = failed + [ti for ti in first if ti not in failed]
        self.heart = placed
        return failed

    # ------------------------------------------------------------------ the whole

    def run(self):
        t0 = time.time()
        self.read_tiles()
        self.read_sources()
        self.seeds()
        self.sparse()
        self.name_fills()
        self.assign()
        self.parks_whole()
        self.tagged()
        joins = []
        for rnd in range(12):
            self.merge()
            self.split()
            failed = self.hearts()
            if not failed:
                break
            # a neighbourhood with no room for a heart joins its neighbour (both names kept)
            for ti in failed:
                if ti not in self.T:
                    continue
                b = self.borders(self.squares(ti), ti)
                if not b:
                    self.small.add(ti)
                    continue
                to = max(sorted(b), key=lambda v: (b[v], -len(self.squares(v))))
                joins.append(f'{self.name(ti)} into {self.name(to)}')
                self.join(ti, to)
        else:
            raise SystemExit(f'hearts: no placement after 12 rounds ({", ".join(self.name(t) for t in failed)})')
        if joins:
            log(f'hearts: no room for {len(joins)}, joined: {"; ".join(joins)}')
        self.write(time.time() - t0)

    def name(self, ti):
        """Its own name, and the biggest it took in by a merge ("Western Addition / Japantown"): two at most, so a sign
        can hold it; a third is in the bake's log alone. A name that holds a slash of its own (Amsterdam's
        "Nieuwmarkt/Lastage") is never joined to another, which would read as three."""
        t = self.T[ti]
        names = [t['parts'][0][0]]
        for nm, ps in sorted(t['parts'][1:], key=lambda p: (-len(p[1]), p[0])):
            if nm and all(norm(nm) != norm(x) for x in names):
                names.append(nm)
        if len(names) > 1 and '/' in names[0]:
            off = names[1:]
            names = names[:1]
        else:
            slash = [x for x in names[1:] if '/' in x]
            names = [x for x in names if x not in slash]
            off = names[2:] + slash
            names = names[:2]
        if off:
            nt = f'{names[0]}: also takes in {", ".join(off)}, left off its name'
            if nt not in self.notes:
                self.notes.append(nt)
        out = ' / '.join(names)
        # a park "of <the map's city>" is the park ('Presidio of San Francisco' is the Presidio)
        if self.city_name:
            out = re.sub(rf'\s+of\s+{re.escape(self.city_name)}\b', '', out)
        return out

    def write(self, took):
        W, H = self.w, self.h
        ids = sorted(self.T, key=lambda ti: (self.name(ti).casefold(), ti))
        n = len(ids)
        names = [self.name(ti) for ti in ids]
        assert len({norm(x) for x in names}) == n, 'two neighbourhoods share a name'
        grid = np.zeros(W * H, '<u2')
        hearts, flags, rows = [], [], []
        for k, ti in enumerate(ids):
            sq = self.squares(ti)
            grid[sq] = k + 1
            s, kind, what = self.heart.get(ti, (int(sq[0]), 'none', None))
            fl = 0
            if ti in self.small or len(sq) < MIN_SQUARES:
                fl |= FLAG_SMALL
            if kind == 'none' or self.tag[s]:
                fl |= FLAG_NO_GROUND
            hearts.append(self.key(s))
            flags.append(fl)
            t = self.T[ti]
            seed = self.S[t['seed']]
            x, z = self.centre(s)
            rows.append(dict(id=k, name=names[k], squares=int(len(sq)), km2=round(len(sq) * SQ_KM2, 3),
                             heart=dict(key=self.key(s), ix=self.ix0 + s % W, iz=self.iz0 + s // W, x=x, z=z, kind=kind,
                                        park=what, ground=round(float(self.high[s]), 1) if np.isfinite(self.high[s]) else None),
                             godless=fl, source=seed['kind'], src=seed['src'], parts=[nm for nm, _ in t['parts']],
                             split=list(t['split']) if t['split'] else None, piece=int(seed['comp'])))
        body = pack_hoods(dict(ix0=self.ix0, iz0=self.iz0, w=W, h=H, grid=grid, hearts=hearts, flags=flags, tagged=self.tag,
                               names=names))
        gz = gzip.compress(body, compresslevel=9, mtime=0)
        os.makedirs(self.out, exist_ok=True)
        with open(os.path.join(self.out, 'hoods.bin'), 'wb') as f:
            f.write(gz)
        land = int(self.is_land.sum())
        m = self.man
        m['hoods'] = {'version': HOODS_VERSION[0], 'minor': HOODS_VERSION[1], 'bytes': len(gz), 'count': n, 'squares': land,
                      'godless': int(sum(1 for fl in flags if fl)), 'tagged': int(self.tag.sum())}
        with open(os.path.join(self.out, 'city.json'), 'w', encoding='utf-8') as f:
            json.dump(m, f)
        sizes = np.array([r['squares'] for r in rows])
        log(f'hoods.bin: {n} neighbourhoods over {land} squares, {len(body)} bytes, {len(gz)} gzipped; squares min '
            f'{sizes.min()} median {int(np.median(sizes))} max {sizes.max()} ({sizes.min() * SQ_KM2:.3f} / '
            f'{np.median(sizes) * SQ_KM2:.3f} / {sizes.max() * SQ_KM2:.3f} km2); godless {m["hoods"]["godless"]}; '
            f'tagged {m["hoods"]["tagged"]}; {took:.0f} s')
        for r in rows:
            h = r['heart']
            log(f'  {r["name"][:44]:44} {r["squares"]:4d} sq {r["km2"]:6.3f} km2  heart {h["ix"]},{h["iz"]} '
                f'{h["kind"]}{(" " + h["park"]) if h["park"] else ""}{(" " + str(h["ground"]) + " m") if h["kind"] != "park" and h["ground"] is not None else ""}'
                f'{"  GODLESS " + str(r["godless"]) if r["godless"] else ""}  [{r["source"]}]')
        for nt in self.notes:
            log('note: ' + nt)
        self.rows = rows
        self.summary = dict(slug=self.slug, count=n, squares=land, bytes=[len(body), len(gz)], tagged=int(self.tag.sum()),
                            tagged_any=int(self.tag_any.sum()), godless=m['hoods']['godless'], dropped=self.dropped,
                            missing=self.missing, notes=self.notes, grid=[self.ix0, self.iz0, W, H])


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = dict((a[2:].split('=', 1) + [''])[:2] for a in sys.argv[1:] if a.startswith('--'))
    if len(args) < 1:
        raise SystemExit(__doc__)
    h = Hoods(args[0], out=os.path.abspath(flags['out']) if flags.get('out') else None)
    h.run()
    if flags.get('json'):
        with open(flags['json'], 'w', encoding='utf-8') as f:
            json.dump(dict(h.summary, hoods=h.rows), f, indent=1, ensure_ascii=False)


if __name__ == '__main__':
    main()
