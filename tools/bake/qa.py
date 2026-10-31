#!/usr/bin/env python3
"""Plausibility QA of an OSM city bake: its trees, water and sand against ESA WorldCover 10 m (2021).

bake.py runs it at the end of every OSM bake (its arrays freed first); standalone it checks any baked
city dir, a --out test bake or an older bake made before it existed:

  python3 -I tools/bake/qa.py <slug> [--dir=public/city/<name>] [--crops=8]

What it compares (on the city frame, cut into 128 m cells; WorldCover on the bake's frame at 4 m):
  trees   every baked tree is matched to OSM's mapped trees (the extract) or is procedural (park / woods
          trees: kinds 1-2, street trees: kind 0). A procedural park / woods tree is "unsupported" when no
          WorldCover tree pixel (tree cover or mangroves) lies within 'support' m of it; a cell holding
          'openCellTrees' or more of them is "trees on open land" (a park polygon planted over its lawns,
          marsh or beach). A park / wood / open-space cell WorldCover sees as wooded but the bake left bare
          is "missing trees"; WorldCover woods over OSM scrub / heath are reported, not failed (the bake
          trusts OSM there: osm.TREE_SHRUB). Street trees along frontages are reported, not checked:
          WorldCover's 10 m pixels miss most single street trees (no tree pixel within 20 m of 42 % of
          San Francisco's mapped street trees, 12 % of London's), so the report sets the procedural ones'
          share beside the mapped street trees' share.
  water   the baked water share of a cell (pier decks over WorldCover water count as water) against
          WorldCover's permanent water (80); a difference of 'waterDiff' or more is a disagreement
          (a tidal marsh drawn as grass, a coastline or a lake OSM lacks, a lake that isn't there).
  sand    baked sand where WorldCover sees neither bare ground (60) nor water, and WorldCover bare
          ground where the bake has grass or woods.
Writes:
  city.json stats.qa                         the summary (pass, the failed checks, counts, the parks)
  tools/bake/.cache/qa/<name>/report.md      the checks, the worst disagreements with lat / lon and a
                                             reason, the largest parks / open spaces with their numbers
  tools/bake/.cache/qa/<name>/park_<k>.png   top-down crops of them: WorldCover (left), the bake (right):
                                             ground classes, buildings, every tree by source, the
                                             WorldCover tree outline
  tools/bake/.cache/qa/<name>/cells.png      the frame with every flagged cell
Exit status: 0 PASS, 3 FAIL (a threshold exceeded; bake.py exits 3 too unless --qa=warn) with a loud
'!!! QA FAIL' block on stdout. Thresholds: QA_DEFAULTS (FAIL when a share exceeds its ...Max and the
count behind it reaches 'minFlagged' cells / 'minUnsupported' trees: a small --bbox test bake's few
cells don't fail on one lagoon); a city config's "qa": {...} overrides any of them. Calibration (2026-10
test bakes, five frames in San Francisco and London): the old "trees in every park" rule scored
unsupported 2-39 % (FAIL in three: the Crissy Field frame 39 % with 19 of 65 cells on open land), the
evidence rule <= 0.11 % and 0 cells; water and sand on all of San Francisco 0.06 % and 0.10 %.
"""
import json
import math
import os
import sys
import time

import numpy as np

sys.dont_write_bytecode = True  # (no __pycache__ in tools/bake)
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

QA_DEFAULTS = {
    'cell': 128.0,           # m: the comparison cells
    'wcRes': 4.0,            # m: WorldCover on the frame (nearest), the baked classes sampled at the same grid
    'support': 20.0,         # m: a procedural tree is supported when a WorldCover tree pixel lies this close (square reach)
    'unsupportedMax': 0.05,  # FAIL: share of the procedural park / woods trees without that support (street trees: reported)
    'openCellTrees': 8,      # a cell is "trees on open land" with this many unsupported park / woods trees (~5 / ha)...
    'openCellsMax': 0.01,    # FAIL: ...in more than this share of the land cells
    'waterDiff': 0.5,        # a cell disagrees on water when the baked and WorldCover water shares differ this much
    'waterCellsMax': 0.02,   # FAIL: share of all cells
    'sandDiff': 0.4,         # a cell disagrees on sand at this share (see the module doc)
    'sandCellsMax': 0.02,    # FAIL: share of the land cells
    'woodCover': 0.6,        # "missing trees": WorldCover tree cover of at least this in a cell mostly grass / woods...
    'woodPerHa': 8.0,        # ...that has fewer trees than this per ha of land
    'woodCellsMax': 0.10,    # FAIL: share of such wooded green cells
    'minFlagged': 5,         # ...and a cell check fails only with at least this many flagged cells
    'minUnsupported': 50,    # ...and "unsupported" only with at least this many trees (small test bakes: a handful of cells)
    'worst': 30,             # disagreements listed in the report
    'crops': 8,              # parks / open spaces cropped
    'cropMax': 2400.0,       # m: the longest side of a crop (bigger parks: their middle)
}

# ground classes (src/world/tiles.ts Ground; osm.py)
PAVED, GRASS, WATER, SIDEWALK, PLAZA, PATH, SAND, RAIL, FOREST, YARD, ROCK = range(11)
CLASS_NAME = ['road', 'grass', 'water', 'sidewalk', 'plaza', 'path', 'sand', 'rail', 'forest', 'yard', 'rock']
# WorldCover classes and its legend colours
WC_NAME = {0: 'no data', 10: 'tree cover', 20: 'shrubland', 30: 'grassland', 40: 'cropland', 50: 'built-up', 60: 'bare / sparse',
           70: 'snow / ice', 80: 'water', 90: 'herbaceous wetland', 95: 'mangroves', 100: 'moss / lichen'}
WC_RGB = {0: (1, 1, 1), 10: (0.0, 0.39, 0.0), 20: (1.0, 0.73, 0.13), 30: (1.0, 1.0, 0.30), 40: (0.94, 0.59, 1.0), 50: (0.98, 0.0, 0.0),
          60: (0.71, 0.71, 0.71), 70: (0.94, 0.94, 0.94), 80: (0.0, 0.39, 0.78), 90: (0.0, 0.59, 0.63), 95: (0.0, 0.81, 0.46), 100: (0.98, 0.90, 0.63)}
# the parks / open spaces the report crops: OSM land use and land (natural=*) classes (Overture's)
LU_OPEN = {'park', 'garden', 'cemetery', 'grave_yard', 'nature_reserve', 'national_park', 'zoo', 'golf_course', 'recreation_ground',
           'common', 'village_green', 'grass', 'meadow', 'dog_park', 'campground'}
LAND_OPEN = {'wood', 'forest', 'grassland', 'heath', 'scrub', 'wetland', 'beach', 'sand', 'dune', 'meadow', 'grass'}
SRC_RGB = {'mapped': (0.16, 0.38, 0.85), 'park': (0.05, 0.30, 0.10), 'street': (0.85, 0.40, 0.05)}


def _log(*a):
    print(f'[{time.strftime("%H:%M:%S")}] qa:', *a, flush=True)


def share(mask, b):
    """per b x b block: the share of True (a bool mask whose shape is a multiple of b)"""
    h, w = mask.shape
    return mask.reshape(h // b, b, w // b, b).mean(axis=(1, 3), dtype=np.float32)


def top_classes(vals, names):
    """'grass 60%, road 20%': the (up to 3) main classes of an array (names: a list or a dict by code)"""
    v, c = np.unique(vals, return_counts=True)
    order = np.argsort(-c)
    nm = (lambda q: names[q] if q < len(names) else str(q)) if isinstance(names, list) else (lambda q: names.get(q, str(q)))
    return ', '.join(f'{nm(int(v[k]))} {c[k] / vals.size * 100:.0f}%' for k in order[:3] if c[k] / vals.size >= 0.05)


def load_city(city):
    """(cls uint8 [H, W] at the class texel (2 m), trees float [n, 3] x, z, kind) inside the frame"""
    m = city.manifest
    minX, minZ, maxX, maxZ = m['bounds']
    n = city.classN
    res = m['tileSize'] / n
    W, H = int(round((maxX - minX) / res)), int(round((maxZ - minZ) / res))
    cls = np.full((H, W), WATER, np.uint8)  # (bake.py writes no terrain tile for an all-water tile)
    trees = []
    for t in city.terrain_tiles():
        j0, i0 = int(round((t['originX'] - minX) / res)), int(round((t['originZ'] - minZ) / res))
        if 0 <= i0 <= H - n and 0 <= j0 <= W - n:  # (tiles outside the frame hold edge buildings' records only)
            cls[i0:i0 + n, j0:j0 + n] = t['cls']
        trees += [(x, z, k) for x, z, y, s, k in t['trees'] if minX <= x < maxX and minZ <= z < maxZ]
    return cls, res, np.array(trees, np.float64).reshape(-1, 3)


def run(slug, city_dir, log=_log, crops=None):
    """The QA of the baked city in city_dir (config tools/bake/cities/<slug>.json). True = PASS."""
    from pyproj import Transformer
    from scipy import ndimage
    from scipy.spatial import cKDTree
    import shapely
    from shapely.geometry import box
    from citydata import City
    import osm as O
    import worldcover as WCm

    t0 = time.time()
    name = os.path.basename(os.path.normpath(city_dir))
    cfg = json.load(open(os.path.join(HERE, 'cities', f'{slug}.json')))
    if cfg.get('worldcover', True) is False:
        log('skipped: the config bakes without WorldCover ("worldcover": false), the reference of the QA')
        return True
    Q = dict(QA_DEFAULTS, **cfg.get('qa', {}))
    if crops is not None:
        Q['crops'] = crops
    out = os.path.join(HERE, '.cache', 'qa', name)
    os.makedirs(out, exist_ok=True)
    for f in os.listdir(out):
        if f.endswith('.png') or f == 'report.md':
            os.remove(os.path.join(out, f))
    city = City(city_dir)
    man = city.manifest
    proj = man['proj']
    minX, minZ, maxX, maxZ = man['bounds']
    to_local = Transformer.from_crs('EPSG:4326', proj, always_xy=True)
    inv = Transformer.from_crs(proj, 'EPSG:4326', always_xy=True)

    def lonlat(x, z):
        lo, la = inv.transform(x, -z)
        return float(la), float(lo)

    cls, res2, T = load_city(city)
    # mapped (OSM natural=tree / tree_row) or procedural: the baked position is the mapped one to the decimetre
    osm = O.OSM(cfg, slug, to_local, lambda *a: None)
    osm.set_frame(minX, minZ, maxX, maxZ)
    mapped = np.array([(x, z) for x, z, k, s in osm.trees()], np.float64).reshape(-1, 2)
    src = np.where(T[:, 2] == 0, 2, 1).astype(np.int8)  # 0 mapped, 1 park / woods, 2 street
    if len(mapped) and len(T):
        d, _ = cKDTree(mapped).query(T[:, :2])
        src[d < 0.2] = 0

    # WorldCover on the frame at wcRes; the baked classes sampled on the same grid
    r = float(Q['wcRes'])
    step = int(round(r / res2))
    W4, H4 = int(round((maxX - minX) / r)), int(round((maxZ - minZ) / r))
    wc = WCm.local_grid(slug, proj, minX, minZ, W4, H4, r, extra_bounds=[tuple(cfg['bbox'])], log=log)
    cls4 = cls[::step, ::step][:H4, :W4]
    k = int(round(Q['support'] / r))
    wtree = WCm.tree_mask(wc)  # (tree cover + mangroves)
    sup = ndimage.maximum_filter(wtree.astype(np.uint8), size=2 * k + 1) > 0

    def at4(x, z):
        return (np.clip(((z - minZ) / r).astype(int), 0, H4 - 1), np.clip(((x - minX) / r).astype(int), 0, W4 - 1))
    ti, tj = at4(T[:, 0], T[:, 1])
    tsup = sup[ti, tj] if len(T) else np.zeros(0, bool)

    # ---------------------------------------------------------------- cells
    b = int(round(Q['cell'] / r))
    ny, nx = H4 // b, W4 // b
    cell_ha = Q['cell'] ** 2 / 1e4
    wc_ok = wc != 0
    w_wc = share(wc == WCm.WATER, b)
    w_b = share((cls4 == WATER) | ((cls4 == PLAZA) & (wc == WCm.WATER)), b)  # (a pier deck over the water is water)
    land_b = 1.0 - share(cls4 == WATER, b)
    wc_land = share(wc_ok & (wc != WCm.WATER), b)
    wct = share(wtree, b) / np.maximum(wc_land, 1e-6)  # WorldCover tree cover of the land
    # what the map lets WorldCover plant (osm.tree_codes: parks, woods, open space; not scrub / heath, pitches, beaches...)
    codes = osm.tree_raster(H4, W4, minX, minZ, r)
    allow = share(np.isin(codes, (O.TREE_PARK, O.TREE_WOODS, O.TREE_OPEN)), b)
    shrub = share(codes == O.TREE_SHRUB, b)
    del codes
    green = share(np.isin(cls4, (GRASS, FOREST)), b) / np.maximum(land_b, 1e-6)
    sand_b = share(cls4 == SAND, b)
    bare_wc = share(wc == WCm.BARE, b)
    gr_abs = share(np.isin(cls4, (GRASS, FOREST)), b)
    del wc_ok
    ci = np.clip((T[:, 1] - minZ) // Q['cell'], 0, ny - 1).astype(int) if len(T) else np.zeros(0, int)
    cj = np.clip((T[:, 0] - minX) // Q['cell'], 0, nx - 1).astype(int) if len(T) else np.zeros(0, int)
    cid = ci * nx + cj

    def per_cell(m):
        return np.bincount(cid[m], minlength=ny * nx).reshape(ny, nx)
    n_all = per_cell(np.ones(len(T), bool))
    # the checks weigh the procedural park / woods trees; street trees along frontages are reported beside the
    # mapped street trees (WorldCover's 10 m pixels miss most single street trees, mapped or not)
    proc = src == 1
    unsup = proc & ~tsup
    n_uns = per_cell(unsup)
    street = src == 2
    mstreet = (src == 0) & (T[:, 2] == 0) if len(T) else np.zeros(0, bool)
    land_cells = land_b >= 0.2
    flags = []

    def cell_desc(i, j):
        s4 = (slice(i * b, (i + 1) * b), slice(j * b, (j + 1) * b))
        return f'bake: {top_classes(cls4[s4], CLASS_NAME)}; WorldCover: {top_classes(wc[s4], WC_NAME)}'

    # trees on open land
    for i, j in zip(*np.nonzero(land_cells & (n_uns >= Q['openCellTrees']))):
        flags.append(('trees on open land', float(n_uns[i, j]), i, j,
                      f'{n_uns[i, j]} procedural park / woods trees with no '
                      f'WorldCover tree cover within {Q["support"]:.0f} m; WorldCover tree cover {wct[i, j] * 100:.0f}% of the land; '
                      + cell_desc(i, j)))
    # missing trees: a park / wood WorldCover sees wooded, left bare
    wooded = land_cells & (green >= 0.6) & (wct >= Q['woodCover']) & (land_b * cell_ha >= 0.5) & (allow >= 0.5)
    # (not a failure: WorldCover's tree class over OSM's scrub / heath, its shrub-as-tree confusion, left unplanted)
    shrub_wc = land_cells & (green >= 0.6) & (wct >= Q['woodCover']) & (shrub >= 0.5)
    per_ha = n_all / np.maximum(land_b * cell_ha, 1e-6)
    for i, j in zip(*np.nonzero(wooded & (per_ha < Q['woodPerHa']))):
        flags.append(('missing trees', float(wct[i, j] * land_b[i, j] * cell_ha * 70 - n_all[i, j]), i, j,
                      f'WorldCover tree cover {wct[i, j] * 100:.0f}% on grass / woods ({green[i, j] * 100:.0f}% of the land) but '
                      f'{n_all[i, j]} trees ({per_ha[i, j]:.1f} / ha); ' + cell_desc(i, j)))
    # water
    dw = w_b - w_wc
    for i, j in zip(*np.nonzero(np.abs(dw) >= Q['waterDiff'])):
        what = ('land in the bake where WorldCover sees water (a tidal marsh or flat, a lake or a channel OSM draws as land?)'
                if dw[i, j] < 0 else 'water in the bake where WorldCover sees land (a missing land polygon, a coastline, fill?)')
        flags.append(('water', float(abs(dw[i, j]) * cell_ha), i, j,
                      f'{what}: baked water {w_b[i, j] * 100:.0f}%, WorldCover water {w_wc[i, j] * 100:.0f}%; ' + cell_desc(i, j)))
    # sand
    s1 = land_cells & (sand_b >= Q['sandDiff']) & (bare_wc + w_wc < 0.1)
    s2 = land_cells & (bare_wc >= Q['sandDiff']) & (gr_abs >= Q['sandDiff']) & (sand_b < 0.1)
    for i, j in zip(*np.nonzero(s1 | s2)):
        what = (f'sand in the bake ({sand_b[i, j] * 100:.0f}%) where WorldCover sees neither bare ground nor water'
                if s1[i, j] else f'WorldCover sees bare ground / sand ({bare_wc[i, j] * 100:.0f}%) where the bake has grass or woods')
        flags.append(('sand', float(max(sand_b[i, j], bare_wc[i, j]) * cell_ha), i, j, what + '; ' + cell_desc(i, j)))

    kinds = ('trees on open land', 'missing trees', 'water', 'sand')
    nflag = {kd: sum(1 for f in flags if f[0] == kd) for kd in kinds}
    nland = int(land_cells.sum())
    nproc = int(proc.sum())
    # (key, what, share, max share, detail, count, min count): a FAIL needs both over
    mc, mt = int(Q['minFlagged']), int(Q['minUnsupported'])
    checks = [
        ('unsupported', 'procedural park / woods trees with no WorldCover tree cover within %.0f m' % Q['support'],
         int(unsup.sum()) / max(1, nproc), Q['unsupportedMax'], f'{int(unsup.sum()):,} of {nproc:,}', int(unsup.sum()), mt),
        ('openCells', f'land cells with trees on open land (>= {Q["openCellTrees"]} unsupported park / woods trees)',
         nflag['trees on open land'] / max(1, nland), Q['openCellsMax'], f'{nflag["trees on open land"]} of {nland:,}', nflag['trees on open land'], mc),
        ('woodCells', f'wooded park / wood cells (WorldCover >= {Q["woodCover"] * 100:.0f}%) with < {Q["woodPerHa"]:.0f} trees / ha',
         nflag['missing trees'] / max(1, int(wooded.sum())), Q['woodCellsMax'], f'{nflag["missing trees"]} of {int(wooded.sum()):,}', nflag['missing trees'], mc),
        ('waterCells', f'cells whose baked water differs from WorldCover water by >= {Q["waterDiff"] * 100:.0f}% of the cell',
         nflag['water'] / max(1, ny * nx), Q['waterCellsMax'], f'{nflag["water"]} of {ny * nx:,}', nflag['water'], mc),
        ('sandCells', 'land cells whose sand disagrees with WorldCover bare ground',
         nflag['sand'] / max(1, nland), Q['sandCellsMax'], f'{nflag["sand"]} of {nland:,}', nflag['sand'], mc),
    ]
    failed = [c[0] for c in checks if c[2] > c[3] and c[5] >= c[6]]
    ok = not failed

    # ---------------------------------------------------------------- trees overall
    land4 = cls4 != WATER
    tre4 = wtree
    sup4 = sup[:ny * b, :nx * b]
    ha_tree = float((land4 & sup4).sum()) * r * r / 1e4
    ha_open = float((land4 & ~sup4).sum()) * r * r / 1e4
    nsrc = {kd: int((src == v).sum()) for kd, v in (('mapped', 0), ('park', 1), ('street', 2))}
    tree_stats = {
        **nsrc,
        'wcTreeCover': round(float((land4 & tre4).sum()) / max(1, int(land4.sum())), 4),
        'perHaNearWcTrees': round(float((proc & tsup).sum()) / max(ha_tree, 1e-6), 2),
        'perHaOpen': round(float(unsup.sum()) / max(ha_open, 1e-6), 2),
        'unsupportedPark': int(unsup.sum()), 'unsupportedStreet': int((street & ~tsup).sum()),
        # (reported, not checked: the procedural street trees' unsupported share beside the mapped street trees')
        'streetUnsupported': round(float((street & ~tsup).sum()) / max(1, int(street.sum())), 4),
        'mappedStreet': int(mstreet.sum()),
        'mappedStreetUnsupported': round(float((mstreet & ~tsup).sum()) / max(1, int(mstreet.sum())), 4),
        'scrubWoodedCells': int(shrub_wc.sum()),
    }
    del land4, tre4, sup4
    scrub_cells = sorted(zip(*np.nonzero(shrub_wc)), key=lambda c: -wct[c])
    scrub_ex = [(*lonlat(minX + (j + 0.5) * Q['cell'], minZ + (i + 0.5) * Q['cell']), float(wct[i, j])) for i, j in scrub_cells[:5]]

    # ---------------------------------------------------------------- parks / open spaces
    frame = box(minX, minZ, maxX, maxZ)
    cand = []
    for typ, classes in (('land_use', LU_OPEN), ('land', LAND_OPEN)):
        dd, gg = osm.read(typ)
        if dd is None:
            continue
        for i, row in enumerate(dd.itertuples(index=False)):
            if row.klass not in classes or gg[i] is None or gg[i].geom_type not in ('Polygon', 'MultiPolygon'):
                continue
            try:
                g = shapely.make_valid(gg[i]).intersection(frame)
            except shapely.errors.GEOSException:
                continue
            if g.is_empty or g.area < 1e4:
                continue
            nm = O.sv(getattr(row, 'name', None)) or f'{row.klass} (unnamed)'
            cand.append((g.area, nm, row.klass, g))
    cand.sort(key=lambda c: -c[0])
    parks = []
    for a, nm, kl, g in cand:
        if len(parks) >= Q['crops']:
            break
        if any(g.intersection(p['geom']).area / max(1.0, g.union(p['geom']).area) >= 0.6 for p in parks):
            continue  # (the same place mapped twice)
        parks.append({'name': nm, 'class': kl, 'geom': g})
    from rasterio.features import rasterize
    import rasterio
    for p in parks:
        g = p['geom']
        x0, z0, x1, z1 = g.bounds
        j0, i0 = max(0, int((x0 - minX) // r)), max(0, int((z0 - minZ) // r))
        j1, i1 = min(W4, int((x1 - minX) // r) + 1), min(H4, int((z1 - minZ) // r) + 1)
        pm = rasterize([(g, 1)], out_shape=(i1 - i0, j1 - j0), transform=rasterio.Affine(r, 0, minX + j0 * r, 0, r, minZ + i0 * r),
                       fill=0, dtype=np.uint8) > 0
        wcw = wc[i0:i1, j0:j1]
        supw = sup[i0:i1, j0:j1]
        landw = pm & (wcw != WCm.WATER)
        inside = np.zeros(len(T), bool)
        bb = (T[:, 0] >= x0) & (T[:, 0] <= x1) & (T[:, 1] >= z0) & (T[:, 1] <= z1) if len(T) else inside
        shapely.prepare(g)
        inside[bb] = shapely.contains_xy(g, T[bb, 0], T[bb, 1])
        ha = float(pm.sum()) * r * r / 1e4
        ha_o = float((pm & ~supw).sum()) * r * r / 1e4
        n_o = int((inside & proc & ~tsup).sum())
        p.update(ha=round(ha, 1), wcTree=round(float((landw & WCm.tree_mask(wcw)).sum()) / max(1, int(landw.sum())), 3),
                 mapped=int((inside & (src == 0)).sum()), park=int((inside & (src == 1)).sum()), street=int((inside & (src == 2)).sum()),
                 haOpen=round(ha_o, 1), procOpen=n_o)
        p['trees'] = p['mapped'] + p['park'] + p['street']
        p['perHa'] = round(p['trees'] / max(ha, 1e-6), 1)
        p['perHaOpen'] = round(n_o / ha_o, 1) if ha_o > 0.05 else 0.0
        la, lo = lonlat(*g.representative_point().coords[0])
        p['lat'], p['lon'] = round(la, 5), round(lo, 5)

    # ---------------------------------------------------------------- crops + overview
    try:
        draw_crops(city, parks, cls, res2, wc, r, T, src, minX, minZ, maxX, maxZ, Q, out)
        draw_cells(cls, res2, flags, scrub_cells, Q, minX, minZ, maxX, maxZ, out)
    except Exception as e:  # noqa: BLE001 (the numbers stand without the pictures)
        log(f'crops failed: {e!r}')

    # ---------------------------------------------------------------- report + stats
    flags.sort(key=lambda f: -f[1])
    worst = []
    for kd, score, i, j, why in flags[:int(Q['worst'])]:
        la, lo = lonlat(minX + (j + 0.5) * Q['cell'], minZ + (i + 0.5) * Q['cell'])
        worst.append((kd, la, lo, score, why))
    summary = {
        'pass': ok, 'failed': failed, 'cells': ny * nx, 'landCells': nland,
        'checks': {c[0]: {'value': round(c[2], 4), 'max': c[3], 'count': c[5], 'min': c[6]} for c in checks},
        'flags': nflag, 'trees': tree_stats, 'scrubWoodedExamples': [[round(la, 5), round(lo, 5)] for la, lo, w in scrub_ex],
        'parks': [{k: p[k] for k in ('name', 'ha', 'wcTree', 'trees', 'mapped', 'park', 'street', 'perHa', 'haOpen', 'procOpen', 'perHaOpen')}
                  for p in parks],
        'report': os.path.relpath(os.path.join(out, 'report.md'), ROOT).replace('\\', '/'),
    }
    write_report(out, name, slug, man, Q, checks, ok, tree_stats, worst, parks, ny, nx, len(T), nproc, scrub_ex)
    mp = os.path.join(city_dir, 'city.json')
    m2 = json.load(open(mp))
    m2.setdefault('stats', {})['qa'] = summary
    with open(mp, 'w') as f:
        json.dump(m2, f)
    verdict = 'PASS' if ok else 'FAIL'
    lines = [f'{"FAIL" if c[0] in failed else "ok"}: {c[1]}: {c[2] * 100:.2f}% ({c[4]}), max {c[3] * 100:.1f}% (and >= {c[6]})'
             + ('  <-- FAIL' if c[0] in failed else '') for c in checks]
    if ok:
        log('PASS (' + '; '.join(f'{c[0]} {c[2] * 100:.2f}%' + (f' ({c[5]}, under the minimum {c[6]})' if c[2] > c[3] else '') for c in checks)
            + f') in {time.time() - t0:.0f} s; ' + summary['report'])
    else:
        bar = '!' * 78
        print('\n'.join(['', bar, f'!!! QA FAIL: {name} ({slug}): ' + ', '.join(failed), *[f'!!! {s}' for s in lines],
                         f'!!! report: {summary["report"]}', bar, '']), flush=True)
    return ok


def draw_crops(city, parks, cls, res2, wc, r, T, src, minX, minZ, maxX, maxZ, Q, out):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.collections import PolyCollection
    import worldcover as WCm
    from plot import CLASS_RGB
    if not parks:
        return
    T_ = city.manifest['tileSize']
    wins = []
    for p in parks:
        x0, z0, x1, z1 = p['geom'].bounds
        x0, z0, x1, z1 = max(minX, x0 - 60), max(minZ, z0 - 60), min(maxX, x1 + 60), min(maxZ, z1 + 60)
        cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
        hw, hh = min((x1 - x0) / 2, Q['cropMax'] / 2), min((z1 - z0) / 2, Q['cropMax'] / 2)
        wins.append((cx - hw, cz - hh, cx + hw, cz + hh))
    near = {(tx, tz) for x0, z0, x1, z1 in wins for tx in range(int(x0 // T_), int(x1 // T_) + 1) for tz in range(int(z0 // T_), int(z1 // T_) + 1)}
    rings = []
    for t in city.building_tiles(near):
        vs, xz = t['vertStart'], t['xz']
        rings += [xz[vs[i]:vs[i + 1]] for i in range(t['count']) if t['tier'][i] == 0]
    rc = np.array([q.mean(axis=0) for q in rings]) if rings else np.zeros((0, 2))
    lut = np.ones((256, 3))
    for kc, v in CLASS_RGB.items():
        lut[kc] = v
    wlut = np.ones((256, 3))
    for kc, v in WC_RGB.items():
        wlut[kc] = v
    for n, (p, (x0, z0, x1, z1)) in enumerate(zip(parks, wins), 1):
        span = max(x1 - x0, z1 - z0)
        w_in = 6.5
        h_in = float(np.clip(w_in * (z1 - z0) / max(1.0, x1 - x0), 2.5, 9.0))
        fig, axs = plt.subplots(1, 2, figsize=(2 * w_in + 0.6, h_in + 1.0), dpi=150)
        ext = (x0, x1, z1, z0)
        # left: WorldCover + every tree (black)
        j0, i0 = int((x0 - minX) // r), int((z0 - minZ) // r)
        wcw = wc[i0:int(np.ceil((z1 - minZ) / r)), j0:int(np.ceil((x1 - minX) / r))]
        axs[0].imshow(wlut[wcw], extent=(minX + j0 * r, minX + (j0 + wcw.shape[1]) * r, minZ + (i0 + wcw.shape[0]) * r, minZ + i0 * r),
                      interpolation='nearest')
        # right: the baked ground classes (2 m), buildings, trees by source, the WorldCover tree outline
        a0, b0 = int((x0 - minX) // res2), int((z0 - minZ) // res2)
        a1, b1 = int(np.ceil((x1 - minX) / res2)), int(np.ceil((z1 - minZ) / res2))
        axs[1].imshow(lut[cls[b0:b1, a0:a1]], extent=(minX + a0 * res2, minX + a1 * res2, minZ + b1 * res2, minZ + b0 * res2), interpolation='nearest')
        sel = (rc[:, 0] > x0 - 80) & (rc[:, 0] < x1 + 80) & (rc[:, 1] > z0 - 80) & (rc[:, 1] < z1 + 80) if len(rc) else np.zeros(0, bool)
        if sel.any():
            axs[1].add_collection(PolyCollection([rings[k] for k in np.nonzero(sel)[0]], facecolors=(0.42, 0.36, 0.48), edgecolors='none'))
        tw = WCm.tree_mask(wcw).astype(float)
        xs = minX + (j0 + np.arange(wcw.shape[1]) + 0.5) * r
        zs = minZ + (i0 + np.arange(wcw.shape[0]) + 0.5) * r
        if tw.any() and not tw.all():
            axs[1].contour(xs, zs, tw, levels=[0.5], colors=[(0.55, 1.0, 0.2)], linewidths=0.6)
        m = (T[:, 0] >= x0) & (T[:, 0] < x1) & (T[:, 1] >= z0) & (T[:, 1] < z1) if len(T) else np.zeros(0, bool)
        ms = float(np.clip(5.0 * 700.0 / span, 0.4, 7.0))
        axs[0].scatter(T[m, 0], T[m, 1], s=ms * 0.6, c='k', marker='o', linewidths=0)
        for kd, v in (('park', 1), ('street', 2), ('mapped', 0)):
            mm = m & (src == v)
            axs[1].scatter(T[mm, 0], T[mm, 1], s=ms, c=[SRC_RGB[kd]], marker='o', linewidths=0, label=f'{kd} {int(mm.sum())}')
        for ax in axs:
            for gp in (list(p['geom'].geoms) if p['geom'].geom_type == 'MultiPolygon' else [p['geom']]):
                if gp.geom_type == 'Polygon':
                    c = np.asarray(gp.exterior.coords)
                    ax.plot(c[:, 0], c[:, 1], color=(0.9, 0.0, 0.7), lw=0.8, ls='--')
            ax.set_xlim(x0, x1)
            ax.set_ylim(z1, z0)
            ax.set_aspect('equal')
            ax.set_xticks([])
            ax.set_yticks([])
        axs[0].set_title('ESA WorldCover 2021 + every baked tree', fontsize=8)
        axs[1].set_title(f'the bake (lime: WorldCover tree cover)', fontsize=8)
        crop = ' (its middle)' if span >= Q['cropMax'] - 1 else ''
        fig.suptitle(f'{p["name"]} ({p["class"]}){crop}: {p["ha"]:.0f} ha, WorldCover tree cover {p["wcTree"] * 100:.0f}%; {p["trees"]} trees '
                     f'({p["mapped"]} mapped, {p["park"]} park, {p["street"]} street) = {p["perHa"]:.1f} / ha; on WorldCover-open land '
                     f'({p["haOpen"]:.0f} ha): {p["procOpen"]} procedural ({p["perHaOpen"]:.1f} / ha)', fontsize=8)
        hs = [plt.Line2D([], [], marker='s', ls='', mfc=CLASS_RGB[kc], mec='k', mew=0.2, ms=5, label=CLASS_NAME[kc]) for kc in CLASS_RGB]
        hs += [plt.Line2D([], [], marker='o', ls='', mfc=SRC_RGB[kd], mec='none', ms=4, label=f'{kd} tree') for kd in SRC_RGB]
        hw_ = [plt.Line2D([], [], marker='s', ls='', mfc=WC_RGB[kc], mec='k', mew=0.2, ms=5, label=WC_NAME[kc]) for kc in (10, 20, 30, 40, 50, 60, 80, 90)]
        fig.legend(handles=hw_ + hs, loc='lower center', ncol=11, fontsize=5.5, frameon=False)
        slugn = ''.join(ch if ch.isalnum() else '-' for ch in p['name'].lower()).strip('-')[:40]
        p['png'] = f'park_{n}_{slugn}.png'
        fig.savefig(os.path.join(out, p['png']), bbox_inches='tight')
        plt.close(fig)


def draw_cells(cls, res2, flags, scrub_cells, Q, minX, minZ, maxX, maxZ, out):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.patches import Rectangle
    from plot import CLASS_RGB
    lut = np.ones((256, 3))
    for kc, v in CLASS_RGB.items():
        lut[kc] = v
    s = max(1, int(round(8.0 / res2)))
    img = lut[cls[::s, ::s]]
    w = float(np.clip((maxX - minX) / 800.0, 6, 16))
    fig, ax = plt.subplots(figsize=(w, w * (maxZ - minZ) / (maxX - minX) + 0.6), dpi=130)
    ax.imshow(img, extent=(minX, maxX, maxZ, minZ), interpolation='nearest')
    col = {'trees on open land': (0.9, 0.1, 0.1), 'missing trees': (0.1, 0.6, 0.1), 'water': (0.1, 0.3, 0.95), 'sand': (0.95, 0.6, 0.0)}
    c = Q['cell']
    for i, j in scrub_cells:
        ax.add_patch(Rectangle((minX + j * c, minZ + i * c), c, c, fill=False, ec=(0.6, 0.3, 0.8), lw=0.6, ls=':'))
    for kd, score, i, j, why in flags:
        ax.add_patch(Rectangle((minX + j * c, minZ + i * c), c, c, fill=False, ec=col[kd], lw=1.0))
    ax.set_xlim(minX, maxX)
    ax.set_ylim(maxZ, minZ)
    ax.set_aspect('equal')
    ax.set_xticks([])
    ax.set_yticks([])
    hs = [plt.Line2D([], [], marker='s', ls='', mfc='none', mec=v, ms=7, label=f'{kd} ({sum(1 for f in flags if f[0] == kd)})') for kd, v in col.items()]
    hs.append(plt.Line2D([], [], marker='s', ls='', mfc='none', mec=(0.6, 0.3, 0.8), ms=7, label=f'info: WorldCover woods over OSM scrub / heath ({len(scrub_cells)})'))
    ax.legend(handles=hs, loc='lower left', fontsize=7)
    ax.set_title('QA: flagged 128 m cells on the baked ground', fontsize=9)
    fig.savefig(os.path.join(out, 'cells.png'), bbox_inches='tight')
    plt.close(fig)


def write_report(out, name, slug, man, Q, checks, ok, ts, worst, parks, ny, nx, ntrees, nproc, scrub_ex=()):
    minX, minZ, maxX, maxZ = man['bounds']
    L = [f'# Bake QA: {name} ({man.get("name", slug)}): **{"PASS" if ok else "FAIL"}**', '',
         f'Written {time.strftime("%Y-%m-%d %H:%M")} by `tools/bake/qa.py` against ESA WorldCover 10 m (2021). Frame '
         f'{(maxX - minX) / 1000:.2f} x {(maxZ - minZ) / 1000:.2f} km, {ny * nx:,} cells of {Q["cell"]:.0f} m; {man.get("buildingCount", 0):,} buildings.',
         '', '| check | value | threshold | |', '|---|---|---|---|']
    for key, what, v, mx, detail, n, mn in checks:
        verdict = 'ok' if v <= mx else '**FAIL**' if n >= mn else f'ok (over the share, under the minimum of {mn})'
        L.append(f'| {what} | {v * 100:.2f}% ({detail}) | <= {mx * 100:.1f}% (or < {mn}) | {verdict} |')
    L += ['', '## Trees', '',
          f'{ntrees:,} trees: {ts["mapped"]:,} mapped (OSM natural=tree / tree_row), {ts["park"]:,} procedural park / woods trees, '
          f'{ts["street"]:,} procedural street trees. WorldCover tree cover: {ts["wcTreeCover"] * 100:.1f}% of the land. Procedural park / '
          f'woods trees: {ts["perHaNearWcTrees"]:.1f} / ha of the land within {Q["support"]:.0f} m of WorldCover tree cover, '
          f'{ts["perHaOpen"]:.2f} / ha of the rest ({ts["unsupportedPark"]:,} unsupported).', '',
          "Street trees (reported, not checked: WorldCover's 10 m pixels miss most single street trees): "
          f'{ts["streetUnsupported"] * 100:.1f}% of the {ts["street"]:,} procedural ones along frontages have no WorldCover tree pixel '
          f'within {Q["support"]:.0f} m, against {ts["mappedStreetUnsupported"] * 100:.1f}% of the {ts["mappedStreet"]:,} mapped street trees.', '',
          f'WorldCover sees woods (>= {Q["woodCover"] * 100:.0f}% tree cover) over OSM scrub / heath in {ts["scrubWoodedCells"]:,} cells, left '
          'without procedural trees (not a failure: the WorldCover tree class takes in tall dense shrubs; the OSM scrub tag wins)'
          + (': ' + '; '.join(f'{la:.5f}, {lo:.5f} ({w * 100:.0f}%)' for la, lo, w in scrub_ex) if scrub_ex else '') + '.', '',
          '## How to read this', '',
          '- **trees on open land**: procedural trees standing where WorldCover sees no tree cover within the support reach: a '
          'park polygon planted over its lawns, marsh or beach. Unsupported OSM-woods trees (woods are strong evidence of their '
          "own) count too; a few are fine, a cluster is the old bug. Street trees along frontages don't count (see Trees).",
          '- **missing trees**: WorldCover sees a wood over a park / woods / open-space cell (not scrub, heath, pitches...) '
          'the bake left (almost) bare: the evidence gate '
          'too strict, a polygon classed open space over a real wood, or WorldCover misregistered.',
          '- **water**: the baked water vs WorldCover permanent water. Land where WorldCover sees water is usually a tidal marsh, '
          'a flat or a lagoon OSM maps as wetland (drawn as grass), or a pier / fill area; water where WorldCover sees land is '
          'a land polygon the extract lacks (the sea comes from the coastline), worth a look.',
          '- **scrub / heath** (info, dotted purple on the cell map): WorldCover sees woods where OSM maps scrub or heath. '
          'The bake trusts OSM there (the WorldCover tree class takes in tall dense shrubs: dense coastal scrub reads as '
          'tree cover); a wood mapped inside the scrub still gets its trees. Worth a look at the imagery when a city has a '
          'lot of it.',
          '- **sand**: baked sand where WorldCover sees vegetation or buildings (a beach polygon that moved), or WorldCover bare '
          'ground where the bake has grass (an unmapped beach, dunes, a dirt field, a construction site).',
          '- The crops: left WorldCover (green = tree cover, yellow = grassland, red = built-up, grey = bare, blue = water) with '
          'every baked tree in black: black dots on yellow / grey / blue are trees on open land. Right: the bake (ground '
          'classes, buildings, trees: blue mapped, dark green procedural park / woods, orange procedural street), the lime '
          'outline is WorldCover tree cover, the dashed magenta line the park.', '',
          '![flagged cells](cells.png)', '', f'## Worst disagreements (top {len(worst)})', '',
          '| # | kind | lat, lon | score | reason |', '|---|---|---|---|---|']
    for n, (kd, la, lo, score, why) in enumerate(worst, 1):
        L.append(f'| {n} | {kd} | {la:.5f}, {lo:.5f} | {score:.1f} | {why} |')
    if not worst:
        L.append('| | none | | | |')
    L += ['', '(score: trees for "trees on open land", the expected trees missing for "missing trees", ha for water / sand)', '',
          f'## The largest parks and open spaces ({len(parks)})', '',
          '| park | lat, lon | ha | WorldCover trees | trees (mapped / park / street) | per ha | WorldCover-open land: ha, procedural trees, per ha |',
          '|---|---|---|---|---|---|---|']
    for p in parks:
        L.append(f'| {p["name"]} ({p["class"]}) | {p["lat"]}, {p["lon"]} | {p["ha"]:.1f} | {p["wcTree"] * 100:.0f}% | {p["trees"]} '
                 f'({p["mapped"]} / {p["park"]} / {p["street"]}) | {p["perHa"]:.1f} | {p["haOpen"]:.1f}, {p["procOpen"]}, {p["perHaOpen"]:.1f} |')
    L.append('')
    for p in parks:
        if p.get('png'):
            L += [f'### {p["name"]}', '', f'![{p["name"]}]({p["png"]})', '']
    L += ['## Thresholds', '', 'Defaults in `tools/bake/qa.py` QA_DEFAULTS; the city config\'s `"qa": {...}` overrides:', '',
          '```', json.dumps({k: Q[k] for k in QA_DEFAULTS}, indent=1), '```', '']
    with open(os.path.join(out, 'report.md'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(L))


def main():
    sys.stdout.reconfigure(errors='backslashreplace')
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = dict((a[2:].split('=', 1) + [''])[:2] for a in sys.argv[1:] if a.startswith('--'))
    slug = args[0] if args else 'sf'
    d = flags.get('dir') or os.path.join(ROOT, 'public', 'city', slug)
    ok = run(slug, d, crops=int(flags['crops']) if flags.get('crops') else None)
    sys.exit(0 if ok else 3)


if __name__ == '__main__':
    main()
