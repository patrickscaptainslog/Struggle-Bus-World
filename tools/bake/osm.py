#!/usr/bin/env python3
"""OpenStreetMap for the city bake (via the Overture extracts of tools/bake/overture.py).

City-agnostic: everything comes from the extracts of the city's bbox plus a few optional knobs
in tools/bake/cities/<slug>.json ("osm": {...}, see OSM_DEFAULTS). Provides, in the bake's
local frame (+X east, +Z south, meters):

  buildings()      OSM footprints (Overture's few non-OSM footprints flagged), holes cut into
                   hole-free pieces, with every attribute the bake carries: height, min_height,
                   num_floors, roof shape / height / direction, facade + roof colour and material,
                   class / subtype, names, the OSM id (the stable-id key)
  parts()          building:part=* per parent building (tower massing, domes, spires)
  conflate()       USA Structures rows matched to OSM footprints (occupancy + a height fallback),
                   and the rows OSM has nothing for (the fallback footprints)
  ground_raster()  the 2 m ground classes: streets by class and width, sidewalks, plazas, paths,
                   rail, parks / grass / forest / sand / rock, yards, water bodies, the coastline
  trees()          natural=tree points and tree rows (species -> the game's tree kinds)
  street_lines()   named streets (for the diegetic street sign)
  hoods()          neighbourhood names (divisions: polygons where mapped, label points else)

Data: (c) OpenStreetMap contributors, ODbL 1.0, via the Overture Maps Foundation.
"""
import json
import math
import os
import re
import struct

import numpy as np
import pyarrow.parquet as pq
import shapely
from shapely.geometry import Polygon, MultiPolygon, box
from shapely.strtree import STRtree

CACHE = os.environ.get('SB_OVERTURE_CACHE', '/tmp/claude-0/sbdata/overture')

# ground classes (2 m texture; src/world/tiles.ts `Ground`)
PAVED, GRASS, WATER, SIDEWALK, PLAZA, PATH, SAND, RAIL, FOREST, YARD, ROCK = range(11)

# roof shapes (src/world/tiles.ts `RoofShape`); 0 = untagged (the mesher's own choice)
ROOF_SHAPES = {'flat': 1, 'gabled': 2, 'hipped': 3, 'pyramidal': 4, 'skillion': 5, 'dome': 6, 'onion': 7, 'round': 8,
               'gambrel': 9, 'mansard': 10, 'half-hipped': 11, 'half_hipped': 11, 'saltbox': 12, 'cone': 13,
               'side_hipped': 3, 'quadruple_saltbox': 3, 'crosspitched': 3, 'sawtooth': 5, 'butterfly': 1, 'spherical': 6}
# facade / roof materials (src/world/tiles.ts `Material`)
MATERIALS = {'brick': 1, 'wood': 2, 'timber_framing': 2, 'plaster': 3, 'stucco': 3, 'concrete': 4, 'cement_block': 4,
             'glass': 5, 'mirror': 5, 'metal': 6, 'metal_sheet': 6, 'steel': 6, 'copper': 6, 'stone': 7, 'sandstone': 7,
             'limestone': 7, 'marble': 7, 'granite': 7, 'roof_tiles': 8, 'tiles': 8, 'tile': 8, 'slate': 9, 'grass': 10,
             'plants': 10, 'tar_paper': 11, 'asphalt': 11, 'asphalt_shingle': 11, 'bitumen': 11, 'eternit': 4, 'plastic': 12,
             'thatch': 13, 'gravel': 11}

OSM_DEFAULTS = {
    # full curb-to-curb width (m) by Overture road class; sidewalks are added beside them
    'roadWidth': {'motorway': 13.0, 'trunk': 14.0, 'primary': 15.0, 'secondary': 13.0, 'tertiary': 12.0, 'residential': 10.5,
                  'unclassified': 9.0, 'living_street': 7.0, 'service': 5.5, 'unknown': 6.0, 'track': 3.0},
    'linkWidth': 7.0,
    'serviceWidth': {'driveway': 3.5, 'alley': 4.0, 'parking_aisle': 6.0},
    'pathWidth': 2.8,           # footways, paths, cycleways, steps (a little over the 2 m texel, or they dash)
    'plazaWidth': 7.0,          # highway=pedestrian as a line
    'railWidth': 4.0,
    'sidewalk': 3.5,            # m of sidewalk beside every street that has them (not motorways, tracks, service)
    'abbrev': 'us',             # street name abbreviations on the sign (None: as mapped)
    'roofDefaults': {},         # e.g. {"house": "gabled"}: a roof shape for untagged buildings of an OSM class
}

US_SUFFIX = {'street': 'St', 'avenue': 'Ave', 'boulevard': 'Blvd', 'drive': 'Dr', 'road': 'Rd', 'lane': 'Ln', 'place': 'Pl',
             'court': 'Ct', 'terrace': 'Ter', 'alley': 'Aly', 'highway': 'Hwy', 'parkway': 'Pkwy', 'circle': 'Cir',
             'square': 'Sq', 'plaza': 'Plz', 'expressway': 'Expy', 'freeway': 'Fwy', 'way': 'Way', 'trail': 'Trl',
             'crescent': 'Cres', 'heights': 'Hts', 'point': 'Pt', 'park': 'Park', 'walk': 'Walk', 'path': 'Path',
             'row': 'Row', 'loop': 'Loop', 'gardens': 'Gdns'}
US_DIR = {'north': 'N', 'south': 'S', 'east': 'E', 'west': 'W'}


def hash32(s):
    """FNV-1a of a string (stable ids from OSM ids)."""
    h = 2166136261
    for b in s.encode('utf-8'):
        h ^= b
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def abbreviate(name, mode):
    if not name or mode != 'us':
        return name
    w = name.split()
    if len(w) >= 2 and w[-1].lower() in US_SUFFIX:
        w[-1] = US_SUFFIX[w[-1].lower()]
    if len(w) >= 3 and w[0].lower() in US_DIR:
        w[0] = US_DIR[w[0].lower()]
    return ' '.join(w)


def parse_color(s):
    """OSM colour (#rgb, #rrggbb or a CSS name) -> 0xFFRRGGBB, or 0 (none)."""
    if not s or not isinstance(s, str):
        return 0
    s = s.strip().lower()
    names = {'white': 'ffffff', 'black': '000000', 'grey': '808080', 'gray': '808080', 'red': 'ff0000', 'brown': '8b4513',
             'beige': 'f5f5dc', 'yellow': 'ffff00', 'blue': '0000ff', 'green': '008000', 'orange': 'ffa500', 'tan': 'd2b48c',
             'silver': 'c0c0c0', 'cream': 'fffdd0', 'pink': 'ffc0cb', 'maroon': '800000', 'ivory': 'fffff0', 'darkgray': 'a9a9a9',
             'lightgrey': 'd3d3d3', 'lightgray': 'd3d3d3', 'darkgrey': 'a9a9a9'}
    if s in names:
        s = '#' + names[s]
    m = re.fullmatch(r'#?([0-9a-f]{3}|[0-9a-f]{6})', s)
    if not m:
        return 0
    h = m.group(1)
    if len(h) == 3:
        h = ''.join(c * 2 for c in h)
    return 0xFF000000 | int(h, 16)


def luminance(c):
    """0..1 perceived lightness of a 0xFFRRGGBB colour."""
    r, g, b = (c >> 16) & 255, (c >> 8) & 255, c & 255
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0


def num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None


def sv(v):
    """A string column's value: '' for missing (None / NaN)."""
    if v is None or (isinstance(v, float) and v != v):
        return ''
    return str(v)


def strip_version(rid):
    return rid.split('@', 1)[0] if isinstance(rid, str) else None


class OSM:
    def __init__(self, cfg, slug, to_local, log):
        oc = cfg.get('overture', {})
        self.release = oc.get('release', '2026-10-21.0')
        self.dir = os.path.join(CACHE, self.release, slug)
        if not os.path.exists(os.path.join(self.dir, 'building.parquet')):
            raise SystemExit(f'no Overture extract in {self.dir}: run python3 -I tools/bake/overture.py {slug}')
        self.P = dict(OSM_DEFAULTS)
        self.P.update(cfg.get('osm', {}))
        self.to_local = to_local
        self.log = log
        self.frame = None

        def f(c):
            e, n = to_local.transform(c[:, 0], c[:, 1])
            return np.column_stack([e, -np.asarray(n)])
        self._proj = f

    def set_frame(self, minX, minZ, maxX, maxZ):
        self.frame = box(minX, minZ, maxX, maxZ)

    def local(self, g):
        return shapely.transform(g, self._proj)

    def read(self, typ):
        path = os.path.join(self.dir, f'{typ}.parquet')
        if not os.path.exists(path):
            return None, np.array([], dtype=object)
        t = pq.read_table(path)
        geoms = shapely.from_wkb(t['geometry'].to_numpy(zero_copy_only=False))
        # ('class' is a Python keyword: itertuples would rename it)
        d = t.drop_columns(['geometry']).to_pandas().rename(columns={'class': 'klass'})
        for c in d.columns:
            if d[c].dtype == object:
                d[c] = d[c].where(d[c].notna(), None)  # (missing strings: None, never NaN)
        g = self.local(geoms)
        if self.frame is not None:
            # only what touches the city frame (an extract may be wider: --bbox bakes)
            keep = shapely.intersects(g, self.frame)
            d, g = d[keep].reset_index(drop=True), g[keep]
        return d, g

    # ------------------------------------------------------------------ buildings
    @staticmethod
    def components(g, min_hole=60.0, min_area=12.0, simplify=0.25):
        """[(outline, [courtyards])] for one footprint, biggest first: each polygon's exterior (simplified) and
        its holes big enough to read from above (light wells are filled)."""
        polys = list(g.geoms) if g.geom_type == 'MultiPolygon' else [g] if g.geom_type == 'Polygon' else []
        out = []
        for p in polys:
            if not p.is_valid:
                p = shapely.make_valid(p)
                p = max([q for q in getattr(p, 'geoms', [p]) if q.geom_type == 'Polygon'] or [Polygon()], key=lambda q: q.area)
            if p.is_empty or p.area < min_area:
                continue
            q = shapely.simplify(Polygon(p.exterior.coords), simplify, preserve_topology=True)
            if q.geom_type != 'Polygon' or not q.is_valid or q.area < min_area:
                continue
            holes = [Polygon(r) for r in p.interiors if Polygon(r).area >= max(min_hole, 0.05 * p.area)]
            out.append((q, [shapely.simplify(h, simplify) for h in holes if h.is_valid]))
        return sorted(out, key=lambda t: -t[0].area)

    @staticmethod
    def pieces(g, min_hole=25.0, min_area=12.0, simplify=0.25):
        """Hole-free polygons covering a footprint: every hole (courtyard) is kept by cutting the polygon through
        it (the pieces become records of one building)."""
        polys = list(g.geoms) if g.geom_type == 'MultiPolygon' else [g] if g.geom_type == 'Polygon' else []
        out = []
        stack = [shapely.make_valid(p) if not p.is_valid else p for p in polys]
        guard = 0
        while stack and guard < 400:
            guard += 1
            p = stack.pop()
            if p.geom_type in ('MultiPolygon', 'GeometryCollection'):
                stack += [q for q in p.geoms if q.geom_type == 'Polygon']
                continue
            if p.geom_type != 'Polygon' or p.is_empty or p.area < min_area:
                continue
            holes = [r for r in p.interiors if Polygon(r).area >= min_hole]
            if not holes:
                q = shapely.simplify(Polygon(p.exterior.coords), simplify, preserve_topology=True)
                if q.geom_type == 'Polygon' and q.is_valid and q.area >= min_area:
                    out.append(q)
                continue
            h = max(holes, key=lambda r: Polygon(r).area)
            c = Polygon(h).centroid
            x0, z0, x1, z1 = p.bounds
            cut = box(x0 - 1, z0 - 1, c.x, z1 + 1) if x1 - x0 >= z1 - z0 else box(x0 - 1, z0 - 1, x1 + 1, c.y)
            try:
                a, b = p.intersection(cut), p.difference(cut)
            except shapely.errors.GEOSException:
                out.append(Polygon(p.exterior.coords))
                continue
            stack += [a, b]
        return sorted(out, key=lambda q: -q.area)

    def buildings(self):
        """[{key, gers, src, poly, holes, h, minH, floors, roof, facadeColor, roofColor, facadeMat, roofMat, cls,
        subtype, hasParts, name}] in local meters. A multipolygon's separate pieces become separate buildings
        ('<osm id>#<k>' for all but the biggest); courtyards stay holes (the bake cuts them at the end)."""
        d, g = self.read('building')
        out = []
        nholes = 0
        skipped = {'underground': 0, 'roof': 0, 'floating': 0, 'tiny': 0}
        for i, row in enumerate(d.itertuples(index=False)):
            if bool(getattr(row, 'is_underground', False)):
                skipped['underground'] += 1
                continue
            cls = sv(row.klass)
            if cls == 'roof':  # building=roof: canopies (fuel stations, carports) have no walls
                skipped['roof'] += 1
                continue
            minh = num(row.min_height)
            has_parts = bool(row.has_parts) if row.has_parts == row.has_parts else False
            if minh is not None and minh > 2.5 and not has_parts:
                skipped['floating'] += 1  # skyways and overhangs: nothing under them
                continue
            gg = g[i]
            if gg is None or gg.is_empty:
                continue
            comps = self.components(gg)
            if not comps:
                skipped['tiny'] += 1
                continue
            osm = strip_version(row.osm_id)
            src = 'osm' if osm else 'ovt'
            key = osm if osm else 'g' + str(row.id)
            for k, (q, holes) in enumerate(comps):
                nholes += bool(holes)
                out.append({
                    'key': key if k == 0 else f'{key}#{k}', 'gers': str(row.id), 'src': src, 'poly': q, 'holes': holes,
                    'h': num(row.height), 'minH': minh, 'floors': num(row.num_floors),
                    'roof': self.roof_attrs(row), 'facadeColor': parse_color(sv(row.facade_color)), 'roofColor': parse_color(sv(row.roof_color)),
                    'facadeMat': MATERIALS.get(sv(row.facade_material), 0), 'roofMat': MATERIALS.get(sv(row.roof_material), 0),
                    'cls': cls, 'subtype': sv(row.subtype), 'hasParts': has_parts and k == 0, 'name': sv(row.name),
                })
        self.log(f'osm: {len(out)} buildings ({sum(b["src"] == "osm" for b in out)} OpenStreetMap, '
                 f'{sum(b["src"] == "ovt" for b in out)} other Overture sources); {nholes} with courtyards; skipped {skipped}')
        return out

    @staticmethod
    def roof_attrs(row):
        shape = ROOF_SHAPES.get(sv(row.roof_shape), 0)
        return {'shape': shape, 'height': num(row.roof_height), 'direction': num(row.roof_direction),
                'orientation': sv(row.roof_orientation)}

    def parts(self):
        """{parent GERS id: [{polys, h, minH, floors, minFloor, roof, facadeColor, roofColor, facadeMat, roofMat, key}]}"""
        d, g = self.read('building_part')
        out = {}
        for i, row in enumerate(d.itertuples(index=False)):
            if bool(getattr(row, 'is_underground', False)) or g[i] is None:
                continue
            ph = self.pieces(g[i], min_area=4.0, simplify=0.15)
            if not ph:
                continue
            out.setdefault(str(row.building_id), []).append({
                'polys': ph, 'h': num(row.height), 'minH': num(row.min_height), 'floors': num(row.num_floors), 'minFloor': num(row.min_floor),
                'roof': self.roof_attrs(row), 'facadeColor': parse_color(sv(row.facade_color)), 'roofColor': parse_color(sv(row.roof_color)),
                'facadeMat': MATERIALS.get(sv(row.facade_material), 0), 'roofMat': MATERIALS.get(sv(row.roof_material), 0),
                'key': strip_version(row.osm_id) or str(row.id),
            })
        self.log(f'osm: {sum(len(v) for v in out.values())} building parts on {len(out)} buildings')
        return out

    @staticmethod
    def conflate(osm_polys, usa_polys):
        """For every OSM polygon: (best USA row, fraction of the OSM polygon it covers); for every USA row: the
        fraction of it OSM covers. osm_polys / usa_polys: arrays of shapely polygons (same frame)."""
        osm_polys = np.asarray(osm_polys, dtype=object)
        usa_polys = np.asarray(usa_polys, dtype=object)
        tree = STRtree(osm_polys)
        a_usa = shapely.area(usa_polys)
        a_osm = shapely.area(osm_polys)
        ui, oi = tree.query(usa_polys, predicate='intersects')
        inter = np.zeros(len(ui))
        for s in range(0, len(ui), 50000):
            sl = slice(s, s + 50000)
            try:
                inter[sl] = shapely.area(shapely.intersection(usa_polys[ui[sl]], osm_polys[oi[sl]]))
            except shapely.errors.GEOSException:
                for k in range(sl.start, min(sl.stop, len(ui))):
                    try:
                        inter[k] = shapely.intersection(shapely.make_valid(usa_polys[ui[k]]), shapely.make_valid(osm_polys[oi[k]])).area
                    except shapely.errors.GEOSException:
                        inter[k] = 0.0
        usa_cov = np.zeros(len(usa_polys))
        np.add.at(usa_cov, ui, inter)
        usa_cov /= np.maximum(a_usa, 1e-6)
        best = np.full(len(osm_polys), -1, dtype=np.int64)
        best_f = np.zeros(len(osm_polys))
        f = inter / np.maximum(a_osm[oi], 1e-6)
        order = np.argsort(f)  # ascending: the biggest overlap is written last
        best[oi[order]] = ui[order]
        best_f[oi[order]] = f[order]
        return best, best_f, np.minimum(usa_cov, 1.0)

    # ------------------------------------------------------------------ ground
    def segments(self):
        """Street, path and rail centerlines: [(line, kind, width, name, cls)] (bridges, tunnels, indoor and
        elevated ways left out: the ground under them is something else)."""
        d, g = self.read('segment')
        P = self.P
        out = []
        for i, row in enumerate(d.itertuples(index=False)):
            line = g[i]
            if line is None or line.is_empty or line.geom_type != 'LineString':
                continue
            flags = set(sv(row.road_flags).split(',')) | set(sv(row.rail_flags).split(','))
            if flags & {'is_bridge', 'is_tunnel', 'is_indoor', 'is_covered', 'is_under_construction'}:
                continue
            lv = row.level_max
            if lv is not None and lv == lv and int(lv) != 0:
                continue
            cls = sv(row.klass) or 'unknown'
            sub = sv(row.subclass)
            name = sv(row.name)
            if sv(row.subtype) == 'rail':
                if cls in ('standard_gauge', 'light_rail', 'narrow_gauge', 'rail', 'monorail'):
                    out.append((line, RAIL, P['railWidth'], '', cls))
                continue
            if sv(row.subtype) != 'road':
                continue
            w = num(row.width)
            if cls in ('footway', 'path', 'steps', 'cycleway', 'bridleway', 'track'):
                if sub == 'crosswalk' or sub == 'cycle_crossing':
                    continue  # part of the road it crosses
                kind = SIDEWALK if sub == 'sidewalk' else PATH
                out.append((line, kind, max(P['pathWidth'], w or 0.0) if cls != 'track' else P['roadWidth']['track'], name, cls))
                continue
            if cls == 'pedestrian':
                out.append((line, PLAZA, w or P['plazaWidth'], name, cls))
                continue
            if w is None or w < 2.0:
                if sub == 'link':
                    w = P['linkWidth']
                elif cls == 'service' and sub in P['serviceWidth']:
                    w = P['serviceWidth'][sub]
                else:
                    w = P['roadWidth'].get(cls, P['roadWidth']['unknown'])
            out.append((line, PAVED, w, name, cls))
        self.log(f'osm: {len(out)} street / path / rail segments for the ground')
        return out

    def street_lines(self, segs):
        """Named streets for the sign: [(line, display name)] (roads first; named paths and plazas too)."""
        mode = self.P.get('abbrev')
        out = []
        for line, kind, w, name, cls in segs:
            if not name or kind == RAIL:
                continue
            if kind in (PATH, SIDEWALK) and cls not in ('footway', 'path', 'steps', 'pedestrian'):
                continue
            out.append((line, abbreviate(name, mode), 0 if kind == PAVED else 1))
        return out

    def areas(self):
        """Ground polygons [(poly, class, priority)] from land use, land, land cover, water, piers and parking."""
        out = []

        def add(geom, cls, pri, trees=False):
            if geom is None or geom.is_empty or geom.geom_type not in ('Polygon', 'MultiPolygon'):
                return
            out.append((geom, cls, pri, trees))
        d, g = self.read('land_cover')
        for i, row in (enumerate(d.itertuples(index=False)) if d is not None else []):
            c = {'forest': FOREST, 'shrub': GRASS, 'grass': GRASS, 'wetland': GRASS, 'crop': GRASS, 'moss': GRASS, 'barren': ROCK, 'mangrove': FOREST}.get(row.subtype)
            if c is not None:
                add(g[i], c, 0, c == FOREST)
        d, g = self.read('land_use')
        lu_paved = {'industrial', 'commercial', 'retail', 'railway', 'construction', 'brownfield', 'garages', 'depot', 'port', 'landfill', 'quarry'}
        lu_grass = {'park', 'grass', 'garden', 'recreation_ground', 'village_green', 'meadow', 'cemetery', 'grave_yard', 'golf_course', 'fairway',
                    'green', 'tee', 'rough', 'dog_park', 'flowerbed', 'allotments', 'plant_nursery', 'orchard', 'vineyard', 'farmland',
                    'nature_reserve', 'national_park', 'common', 'greenfield', 'zoo', 'campground', 'pitch', 'stadium', 'track', 'driving_range'}
        for i, row in (enumerate(d.itertuples(index=False)) if d is not None else []):
            cls = row.klass
            surf = sv(row.surface).lower()
            hard = surf in ('asphalt', 'concrete', 'paved', 'paving_stones', 'sett', 'tartan', 'acrylic', 'clay', 'artificial_turf') and surf != 'artificial_turf'
            if cls in ('pedestrian', 'plaza', 'square'):
                add(g[i], PLAZA, 3)
            elif cls == 'bunker' or (cls == 'beach_resort'):
                add(g[i], SAND, 4)
            elif cls in ('playground', 'schoolyard'):
                add(g[i], PLAZA if hard or cls == 'schoolyard' else GRASS, 3)
            elif cls in ('pitch', 'track', 'stadium'):
                add(g[i], PLAZA if hard or cls == 'track' else GRASS, 3)
            elif cls in lu_grass:
                big = cls in ('park', 'cemetery', 'golf_course', 'recreation_ground', 'nature_reserve', 'national_park', 'zoo', 'grave_yard')
                add(g[i], GRASS, 2 if big else 3, cls in ('park', 'cemetery', 'grave_yard', 'garden', 'nature_reserve', 'national_park', 'common', 'village_green', 'zoo'))
            elif cls in lu_paved or row.subtype in ('transportation',):
                add(g[i], PAVED, 1)
        d, g = self.read('land')
        for i, row in (enumerate(d.itertuples(index=False)) if d is not None else []):
            cls = row.klass
            c = {'grass': GRASS, 'grassland': GRASS, 'meadow': GRASS, 'heath': GRASS, 'scrub': GRASS, 'shrubbery': GRASS, 'wetland': GRASS,
                 'wood': FOREST, 'forest': FOREST, 'sand': SAND, 'beach': SAND, 'dune': SAND, 'bare_rock': ROCK, 'scree': ROCK,
                 'shingle': SAND, 'stone': ROCK, 'rock': ROCK, 'glacier': ROCK}.get(cls)
            if c is not None:
                add(g[i], c, 4 if c in (SAND, ROCK) else 3, c == FOREST)
        d, g = self.read('infrastructure')
        for i, row in (enumerate(d.itertuples(index=False)) if d is not None else []):
            cls = row.klass
            if cls in ('parking', 'parking_space', 'parking_garage'):
                add(g[i], PAVED, 5)
            elif cls in ('pier', 'quay', 'boardwalk') or row.subtype == 'quay':
                add(g[i], PLAZA, 7)
            elif cls == 'platform':
                add(g[i], PLAZA, 6)
        return out

    def water(self):
        """(water polygons (lakes, ponds, pools, rivers, harbour basins), land polygons (the coastline: the sea is
        what they leave out), pier decks)"""
        d, g = self.read('water')
        wat = []
        for i, row in (enumerate(d.itertuples(index=False)) if d is not None else []):
            gg = g[i]
            if gg is None or gg.geom_type not in ('Polygon', 'MultiPolygon'):
                continue
            if row.subtype == 'ocean' or row.klass in ('ocean', 'sea', 'bay', 'strait'):
                continue  # the sea comes from the coastline (it covers piers and fill the bay polygons don't know of)
            wat.append(gg)
        d, g = self.read('land')
        land = []
        for i, row in (enumerate(d.itertuples(index=False)) if d is not None else []):
            if row.subtype == 'land' and row.klass in ('land', 'island', 'islet') and g[i] is not None \
                    and g[i].geom_type in ('Polygon', 'MultiPolygon'):
                land.append(g[i])
        d, g = self.read('infrastructure')
        piers = []
        for i, row in (enumerate(d.itertuples(index=False)) if d is not None else []):
            if row.klass in ('pier', 'quay', 'boardwalk') and g[i] is not None:
                if g[i].geom_type in ('Polygon', 'MultiPolygon'):
                    piers.append(g[i])
                elif g[i].geom_type == 'LineString':
                    piers.append(g[i].buffer(3.0, cap_style='flat'))
        return wat, land, piers

    def ground_raster(self, H, W, minX, minZ, res, dem_nodata, dem_filled, bpolys, bres, segs=None):
        """(uint8 [H, W] ground classes on the bake's 2 m grid (row 0 = minZ), bool pier mask, uint8 treeable mask
        (1 park / cemetery / garden, 2 woods: where procedural trees may grow)).
        bpolys / bres: building footprints and whether each is residential (yards vs paved lots)."""
        from rasterio.features import rasterize
        from scipy import ndimage
        P = self.P
        tr = __import__('rasterio').Affine(res, 0, minX, 0, res, minZ)
        frame = box(minX, minZ, minX + W * res, minZ + H * res)

        def rast(shapes, fill=0, dtype=np.uint8, all_touched=False):
            shapes = [(s, v) for s, v in shapes if s is not None and not s.is_empty and s.intersects(frame)]
            if not shapes:
                return np.full((H, W), fill, dtype=dtype)
            return rasterize(shapes, out_shape=(H, W), transform=tr, fill=fill, dtype=dtype, all_touched=all_touched)

        segs = self.segments() if segs is None else segs
        cls = np.full((H, W), YARD, np.uint8)
        # 1) land: cover, use, natural, parking, piers (low priority first)
        areas = sorted(self.areas(), key=lambda a: a[2])
        # where procedural trees may grow: parks, cemeteries, gardens (1) and woods (2); a pitch, fairway or
        # playground drawn over a park (a higher priority) clears it again
        treeable = rast([(a[0], (2 if a[1] == FOREST else 1) if a[3] else 3) for a in areas if a[3] or a[2] >= 3]) if areas else np.zeros((H, W), np.uint8)
        treeable[treeable == 3] = 0
        for pri in sorted({a[2] for a in areas}):
            layer = [(a[0], a[1] + 1) for a in areas if a[2] == pri]
            # (golf fairways and pitches inside a park: no trees; woods inside it: yes)
            m = rast(layer)
            cls = np.where(m > 0, m - 1, cls).astype(np.uint8)
        # blocks of mostly non-residential buildings are paved lots, not yards
        roads_core = rast([(ln.buffer(w / 2.0, cap_style='flat'), 1) for ln, k, w, _, _ in segs if k == PAVED])
        blocks, nb = ndimage.label(roads_core == 0)
        bmask = rast([(p, 1 if r else 2) for p, r in zip(bpolys, bres)])
        res_cells = np.bincount(blocks.ravel(), weights=(bmask == 1).ravel(), minlength=nb + 1)
        all_cells = np.bincount(blocks.ravel(), weights=(bmask > 0).ravel(), minlength=nb + 1)
        paved_block = (all_cells > 0) & (res_cells < 0.5 * all_cells)
        paved_block[0] = False
        cls[(cls == YARD) & paved_block[blocks]] = PAVED
        del blocks
        # 2) sidewalks beside the streets that have them, then paths, rail, plazas, roads (roads win)
        sw = P['sidewalk']
        swm = rast([(ln.buffer(w / 2.0 + sw, cap_style='flat'), 1) for ln, k, w, _, c in segs
                    if k == PAVED and c not in ('motorway', 'track', 'service', 'unknown')])
        cls[(swm > 0) & np.isin(cls, (YARD, PAVED, GRASS))] = SIDEWALK
        del swm
        for kind in (SIDEWALK, PATH, RAIL, PLAZA):
            m = rast([(ln.buffer(w / 2.0, cap_style='round' if kind != RAIL else 'flat'), 1) for ln, k, w, _, _ in segs if k == kind])
            if kind in (PATH, SIDEWALK):
                cls[(m > 0) & (cls != WATER)] = kind
            else:
                cls[m > 0] = kind
        cls[roads_core > 0] = PAVED
        # 3) water: the sea is what the coastline's land polygons leave out (where the DEM agrees it's low), plus
        #    lakes, ponds, pools, rivers; piers and quays stand over it
        wat, land, piers = self.water()
        if land:
            onland = rast([(p, 1) for p in land]) > 0
            sea = ~onland & (dem_nodata | (dem_filled < 2.0))
        else:
            sea = dem_nodata | (dem_filled < 0.3)
        sea = ndimage.binary_opening(sea, iterations=1)
        inland = rast([(p, 1) for p in wat]) > 0
        pier = rast([(p, 1) for p in piers]) > 0
        cls[(sea & ~pier) | inland] = WATER
        cls[pier] = PLAZA
        # under buildings: sidewalk (what the old bake had there; paint and trees read it)
        under = bmask > 0
        cls[under] = SIDEWALK
        self.log('osm: ground classes ' + ', '.join(f'{n} {float((cls == v).mean()) * 100:.1f}%' for n, v in
                 (('paved', PAVED), ('sidewalk', SIDEWALK), ('yard', YARD), ('grass', GRASS), ('forest', FOREST), ('plaza', PLAZA),
                  ('path', PATH), ('rail', RAIL), ('sand', SAND), ('rock', ROCK), ('water', WATER))))
        treeable[np.isin(cls, (WATER, PAVED, SIDEWALK, PLAZA, PATH, RAIL, SAND, ROCK))] = 0
        return cls, pier, treeable

    # ------------------------------------------------------------------ trees
    def trees(self):
        """[(x, z, kind, size)] from natural=tree points and tree rows (one tree per ~9 m of row).
        kind: 0 street tree, 1 park tree (eucalyptus / Monterey pine), 2 cypress."""
        d, g = self.read('land')
        out = []
        if d is None:
            return out
        for i, row in enumerate(d.itertuples(index=False)):
            cls = row.klass
            if cls not in ('tree', 'tree_row') or g[i] is None:
                continue
            tags = json.loads(sv(row.tags)) if sv(row.tags) else {}
            txt = ' '.join(str(tags.get(k, '')) for k in ('genus', 'species', 'taxon', 'species:en', 'taxon:en')).lower()
            if any(s in txt for s in ('cupressus', 'cypress', 'hesperocyparis', 'juniper', 'thuja')):
                kind = 2
            elif any(s in txt for s in ('pinus', 'pine', 'eucalyptus', 'gum', 'sequoia', 'redwood', 'cedrus', 'cedar')) or tags.get('leaf_type') == 'needleleaved':
                kind = 1
            else:
                kind = 0
            h = num(re.sub(r'[^0-9.]', '', str(tags.get('height', '')))) if tags.get('height') else None
            size = float(np.clip((h / 9.0) if h else 0.8, 0.55, 1.5)) if kind == 0 else float(np.clip((h / 14.0) if h else 0.9, 0.6, 1.4))
            if g[i].geom_type == 'Point':
                out.append((g[i].x, g[i].y, kind, size))
            elif g[i].geom_type == 'LineString':
                L = g[i].length
                for k in range(max(1, int(L / 9.0))):
                    p = g[i].interpolate((k + 0.5) * L / max(1, int(L / 9.0)))
                    out.append((p.x, p.y, kind, size))
        self.log(f'osm: {len(out)} mapped trees')
        return out

    # ------------------------------------------------------------------ names
    def hoods(self, extra=()):
        """(names [str], label points [(x, z)], polygons [(poly, name index)]): OSM neighbourhoods / quarters /
        suburbs (divisions), plus the city config's hand-placed ones (extra: [(name, x, z)]) where OSM has
        no such name. Squares and plazas mapped as microhoods are left out (the street sign names those)."""
        d, g = self.read('division')
        names, pts = [], []
        seen = set()
        if d is not None:
            for i, row in enumerate(d.itertuples(index=False)):
                if row.subtype not in ('neighborhood', 'microhood', 'macrohood') or not row.name or g[i] is None:
                    continue
                lt = json.loads(sv(row.local_type)) if sv(row.local_type) else {}
                if any(v in ('square', 'plaza') for v in lt.values()):
                    continue
                if row.name in seen:
                    continue
                seen.add(row.name)
                p = g[i] if g[i].geom_type == 'Point' else g[i].representative_point()
                names.append(row.name)
                pts.append((p.x, p.y, 0 if row.subtype == 'macrohood' else 1))
        for n, x, z in extra:
            if n not in seen:
                seen.add(n)
                names.append(n)
                pts.append((x, z, 1))
        a, ga = self.read('division_area')
        polys = []
        if a is not None:
            for i, row in enumerate(a.itertuples(index=False)):
                if row.subtype in ('neighborhood', 'microhood', 'macrohood') and row.name in names and ga[i] is not None:
                    polys.append((ga[i], names.index(row.name), 0 if row.subtype == 'macrohood' else 1))
        return names[:255], pts[:255], [p for p in polys if p[1] < 255]


class HoodIndex:
    """Neighbourhood at a point: the smallest mapped neighbourhood polygon containing it (a macrohood only
    where no neighbourhood is), else the nearest label point (neighbourhoods before macrohoods)."""

    def __init__(self, names, pts, polys):
        from scipy.spatial import cKDTree
        self.names = names
        self.polys = sorted(polys, key=lambda p: (p[2] == 0, p[0].area))
        self.ptree = STRtree([p[0] for p in self.polys]) if self.polys else None
        fine = [i for i, p in enumerate(pts) if p[2] == 1]
        self.fine = np.array(fine, dtype=np.int64)
        self.kfine = cKDTree(np.array([pts[i][:2] for i in fine])) if fine else None
        self.kall = cKDTree(np.array([p[:2] for p in pts])) if pts else None

    def at(self, x, z):
        """hood index per point (arrays)"""
        x = np.atleast_1d(np.asarray(x, dtype=np.float64))
        z = np.atleast_1d(np.asarray(z, dtype=np.float64))
        out = np.full(len(x), 255, dtype=np.int64)
        if self.kfine is not None:
            _, j = self.kfine.query(np.column_stack([x, z]))
            out = self.fine[j]
        elif self.kall is not None:
            _, out = self.kall.query(np.column_stack([x, z]))
        if self.ptree is not None:
            pts = shapely.points(x, z)
            pi, gi = self.ptree.query(pts, predicate='within')
            # smallest polygon first (sorted), so keep the first hit per point
            best = np.full(len(x), -1, dtype=np.int64)
            for a, b in sorted(zip(pi, gi), key=lambda t: (t[0], t[1]), reverse=True):
                best[a] = b
            m = best >= 0
            out[m] = np.array([self.polys[b][1] for b in best[m]], dtype=np.int64)
        return out


def names_section(tx, tz, x0, z0, tile, street_tree, street_geoms, street_names, street_rank, hood_index):
    """The street-name section of a terrain tile ('SBT2'): the tile's hood grid and the named streets in it.
      u8 hood[8*8] (32 m cells, row-major z rows; 255 = none)
      u16 nameCount, u16 lineCount
      names: { u8 byteLength, utf-8 bytes } * nameCount, pad to 2
      lines: { u16 name, u8 rank (0 street, 1 path / plaza), u8 vertCount, i16 x, z (dm from the tile origin) * vertCount } * lineCount
    """
    cx = x0 + (np.arange(8) + 0.5) * tile / 8
    cz = z0 + (np.arange(8) + 0.5) * tile / 8
    CX, CZ = np.meshgrid(cx, cz)
    hood = np.clip(hood_index.at(CX.ravel(), CZ.ravel()), 0, 255).astype(np.uint8)
    bb = box(x0 - 2, z0 - 2, x0 + tile + 2, z0 + tile + 2)
    names, lines = [], []
    for i in street_tree.query(bb, predicate='intersects') if street_tree is not None else []:
        try:
            g = street_geoms[i].intersection(bb)
        except shapely.errors.GEOSException:
            continue
        parts = list(g.geoms) if hasattr(g, 'geoms') else [g]
        for ln in parts:
            if ln.geom_type != 'LineString' or ln.length < 1.0:
                continue
            ln = shapely.simplify(ln, 0.8)
            c = np.asarray(ln.coords)
            for s in range(0, len(c) - 1, 254):  # u8 vertex counts
                cc = c[s:s + 255]
                if len(cc) < 2:
                    continue
                nm = street_names[i]
                if nm not in names:
                    names.append(nm)
                lines.append((names.index(nm), street_rank[i], np.round((cc - [x0, z0]) * 10).astype(np.int16)))
    out = hood.tobytes() + struct.pack('<HH', len(names), len(lines))
    for nm in names:
        b = nm.encode('utf-8')[:255]
        out += struct.pack('<B', len(b)) + b
    if len(out) % 2:
        out += b'\0'
    for ni, rank, cc in lines:
        out += struct.pack('<HBB', ni, rank, len(cc)) + cc.astype('<i2').tobytes()
    return out
