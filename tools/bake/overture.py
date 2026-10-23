#!/usr/bin/env python3
"""Overture Maps extracts for the city bake (OpenStreetMap data, ODbL 1.0, via Overture).

The OSM servers (openstreetmap.org, Overpass, Geofabrik) are not reachable from the bake
machine; Overture's GeoParquet release on S3 is, and its buildings, transportation and
base themes are OpenStreetMap (plus a few other open sources, recorded per feature in
`sources`). The files are spatially sorted with a bbox struct column, so a city needs only
the row groups whose bbox statistics touch it: this reads every file's footer once (cached),
then fetches just those row groups with HTTP range reads.

City-agnostic: driven by tools/bake/cities/<slug>.json
  "bbox": [lon0, lat0, lon1, lat1]
  "overture": {"release": "2026-10-21.0", "pad": 0.004}      (pad: degrees around the bbox)

Writes $SB_OVERTURE_CACHE (default /tmp/claude-0/sbdata/overture)/<release>/<slug>/<type>.parquet
(plain parquet: WKB `geometry` + flat attribute columns; the bake reads them with pyarrow +
shapely). Types:
  building        footprints: height, min_height, num_floors, roof_* , facade_*, names, OSM ids
  building_part   building:part=* (tower massing), same attributes + building_id
  segment         transportation: roads, paths, rail (subtype, class, subclass, names, width)
  land_use        base: parks, residential, pedestrian plazas, cemeteries... (+ raw OSM tags)
  land            base: natural=* (trees and tree rows as points/lines, grass, sand, rock...)
  land_cover      base: ESA WorldCover-derived cover classes (only where OSM has nothing)
  water           base: sea, bays, lakes, rivers, reservoirs
  infrastructure  base: bridges, piers, towers, street furniture
  division        divisions: neighbourhood / macrohood / locality points with names
  division_area   divisions: their polygons

usage: python3 -I tools/bake/overture.py <slug> [--types=building,segment,...] [--refresh]
"""
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.fs as pafs
import pyarrow.parquet as pq

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.environ.get('SB_OVERTURE_CACHE', '/tmp/claude-0/sbdata/overture')
BUCKET = 'overturemaps-us-west-2'
DEFAULT_RELEASE = '2026-10-21.0'

# type -> (theme, columns to keep)
TYPES = {
    'building': ('buildings', ['id', 'names', 'sources', 'subtype', 'class', 'height', 'min_height', 'num_floors', 'min_floor',
                               'is_underground', 'facade_color', 'facade_material', 'roof_material', 'roof_shape', 'roof_direction',
                               'roof_orientation', 'roof_color', 'roof_height', 'has_parts', 'level', 'geometry', 'bbox']),
    'building_part': ('buildings', ['id', 'names', 'sources', 'building_id', 'height', 'min_height', 'num_floors', 'min_floor',
                                    'is_underground', 'facade_color', 'facade_material', 'roof_material', 'roof_shape', 'roof_direction',
                                    'roof_orientation', 'roof_color', 'roof_height', 'level', 'geometry', 'bbox']),
    'segment': ('transportation', ['id', 'names', 'sources', 'subtype', 'class', 'subclass', 'road_surface', 'road_flags', 'rail_flags',
                                   'width_rules', 'level_rules', 'geometry', 'bbox']),
    'land_use': ('base', ['id', 'names', 'sources', 'subtype', 'class', 'surface', 'source_tags', 'level', 'geometry', 'bbox']),
    'land': ('base', ['id', 'names', 'sources', 'subtype', 'class', 'surface', 'source_tags', 'level', 'elevation', 'geometry', 'bbox']),
    'land_cover': ('base', ['id', 'subtype', 'sources', 'geometry', 'bbox']),
    'water': ('base', ['id', 'names', 'sources', 'subtype', 'class', 'is_salt', 'is_intermittent', 'source_tags', 'level', 'geometry', 'bbox']),
    'infrastructure': ('base', ['id', 'names', 'sources', 'subtype', 'class', 'height', 'surface', 'source_tags', 'level', 'geometry', 'bbox']),
    'division': ('divisions', ['id', 'names', 'sources', 'subtype', 'class', 'admin_level', 'local_type', 'population', 'geometry', 'bbox']),
    'division_area': ('divisions', ['id', 'names', 'sources', 'subtype', 'class', 'admin_level', 'division_id', 'is_land', 'geometry', 'bbox']),
}
ALL = list(TYPES)


def log(*a):
    print(f'[{time.strftime("%H:%M:%S")}] overture:', *a, flush=True)


def s3fs():
    proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
    kw = {'proxy_options': proxy} if proxy else {}
    return pafs.S3FileSystem(anonymous=True, region='us-west-2', connect_timeout=30, request_timeout=120, **kw)


def footers(fs, release, theme, typ, refresh=False):
    """[(path, [(rg, xmin, xmax, ymin, ymax, rows)])] for every file of a type (cached as JSON)."""
    cdir = os.path.join(CACHE, release, 'footers')
    os.makedirs(cdir, exist_ok=True)
    cpath = os.path.join(cdir, f'{typ}.json')
    if os.path.exists(cpath) and not refresh:
        return json.load(open(cpath))
    base = f'{BUCKET}/release/{release}/theme={theme}/type={typ}'
    files = sorted(i.path for i in fs.get_file_info(pafs.FileSelector(base, recursive=True)) if i.type == pafs.FileType.File)
    t0 = time.time()

    def one(path):
        for k in range(4):
            try:
                md = pq.ParquetFile(path, filesystem=fs).metadata
                break
            except Exception as e:  # noqa: BLE001 (network: retry)
                if k == 3:
                    raise
                log(f'  footer {path}: {e}; retrying')
                time.sleep(2 * (k + 1))
        names = [md.schema.column(j).path for j in range(md.num_columns)]
        col = {n: j for j, n in enumerate(names)}
        rgs = []
        for i in range(md.num_row_groups):
            rg = md.row_group(i)

            def st(name, which):
                s = rg.column(col[name]).statistics
                return getattr(s, which) if s is not None and s.has_min_max else None
            rgs.append((i, st('bbox.xmin', 'min'), st('bbox.xmax', 'max'), st('bbox.ymin', 'min'), st('bbox.ymax', 'max'), rg.num_rows))
        return path, rgs

    with ThreadPoolExecutor(12) as ex:
        out = list(ex.map(one, files))
    json.dump(out, open(cpath, 'w'))
    log(f'{typ}: {len(files)} footers read in {time.time() - t0:.0f} s')
    return out


def wanted(rgs, bb):
    x0, y0, x1, y1 = bb
    return [r[0] for r in rgs if r[1] is None or (r[1] <= x1 and r[2] >= x0 and r[3] <= y1 and r[4] >= y0)]


def flatten(t, typ):
    """Flat columns the bake uses (names.primary, OSM ids from sources, ...); geometry stays WKB."""
    cols = {}
    for name in t.column_names:
        if name in ('names', 'sources', 'bbox', 'source_tags', 'local_type', 'road_surface', 'road_flags', 'rail_flags',
                    'width_rules', 'level_rules'):
            continue
        cols[name] = t[name]
    if 'names' in t.column_names:
        cols['name'] = pc.struct_field(t['names'], 'primary')
    if 'sources' in t.column_names:
        src = t['sources'].to_pylist()
        cols['osm_id'] = pa.array([next((s['record_id'] for s in (ss or []) if s and s.get('dataset') == 'OpenStreetMap' and s.get('record_id')), None)
                                   for ss in src], pa.string())
        cols['datasets'] = pa.array([','.join(sorted({s['dataset'] for s in (ss or []) if s and s.get('dataset')})) for ss in src], pa.string())
    if 'source_tags' in t.column_names:
        cols['tags'] = pa.array([json.dumps(dict(m)) if m else None for m in t['source_tags'].to_pylist()], pa.string())
    if 'local_type' in t.column_names:
        cols['local_type'] = pa.array([json.dumps(dict(m)) if m else None for m in t['local_type'].to_pylist()], pa.string())
    if 'width_rules' in t.column_names:
        # a single width for the whole segment (the first rule; most segments have none)
        cols['width'] = pa.array([(w[0]['value'] if w else None) for w in t['width_rules'].to_pylist()], pa.float64())
    if 'level_rules' in t.column_names:
        cols['level_max'] = pa.array([(max(r['value'] for r in lr) if lr else None) for lr in t['level_rules'].to_pylist()], pa.int32())
    for fl in ('road_flags', 'rail_flags'):
        if fl in t.column_names:
            cols[fl] = pa.array([(','.join(sorted({v for r in f for v in (r['values'] or [])})) if f else None) for f in t[fl].to_pylist()], pa.string())
    if 'road_surface' in t.column_names:
        cols['surface'] = pa.array([(rs[0]['value'] if rs else None) for rs in t['road_surface'].to_pylist()], pa.string())
    return pa.table(cols)


def extract(slug, types=ALL, refresh=False):
    cfg = json.load(open(os.path.join(HERE, 'cities', f'{slug}.json')))
    oc = cfg.get('overture', {})
    release = oc.get('release', DEFAULT_RELEASE)
    pad = float(oc.get('pad', 0.004))
    lon0, lat0, lon1, lat1 = cfg['bbox']
    bb = (lon0 - pad, lat0 - pad, lon1 + pad, lat1 + pad)
    odir = os.path.join(CACHE, release, slug)
    os.makedirs(odir, exist_ok=True)
    fs = s3fs()
    summary = {}
    for typ in types:
        theme, cols = TYPES[typ]
        dst = os.path.join(odir, f'{typ}.parquet')
        if os.path.exists(dst) and not refresh:
            n = pq.ParquetFile(dst).metadata.num_rows
            log(f'{typ}: cached {dst} ({n} rows)')
            summary[typ] = n
            continue
        ft = footers(fs, release, theme, typ)
        jobs = [(path, i) for path, rgs in ft for i in wanted(rgs, bb)]
        t0 = time.time()
        log(f'{typ}: {len(jobs)} row groups touch the bbox')

        def read(job):
            path, i = job
            for k in range(4):
                try:
                    pf = pq.ParquetFile(path, filesystem=fs)
                    have = [c for c in cols if c in pf.schema_arrow.names]
                    t = pf.read_row_group(i, columns=have)
                    break
                except Exception as e:  # noqa: BLE001
                    if k == 3:
                        raise
                    log(f'  {path}#{i}: {e}; retrying')
                    time.sleep(2 * (k + 1))
            b = t['bbox']
            m = pc.and_(pc.and_(pc.less_equal(pc.struct_field(b, 'xmin'), bb[2]), pc.greater_equal(pc.struct_field(b, 'xmax'), bb[0])),
                        pc.and_(pc.less_equal(pc.struct_field(b, 'ymin'), bb[3]), pc.greater_equal(pc.struct_field(b, 'ymax'), bb[1])))
            t = t.filter(m)
            return flatten(t, typ) if t.num_rows else None

        with ThreadPoolExecutor(8) as ex:
            parts = [p for p in ex.map(read, jobs) if p is not None]
        if parts:
            tab = pa.concat_tables(parts, promote_options='permissive')
        else:
            tab = pa.table({'id': pa.array([], pa.string()), 'geometry': pa.array([], pa.binary())})
        pq.write_table(tab, dst + '.part', compression='zstd')
        os.replace(dst + '.part', dst)
        log(f'{typ}: {tab.num_rows} features -> {dst} ({os.path.getsize(dst) / 1e6:.1f} MB) in {time.time() - t0:.0f} s')
        summary[typ] = tab.num_rows
    json.dump({'release': release, 'bbox': bb, 'counts': summary, 'license': 'ODbL-1.0 (OpenStreetMap contributors) via Overture Maps Foundation'},
              open(os.path.join(odir, 'extract.json'), 'w'), indent=1)
    return odir


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = dict((a[2:].split('=', 1) + [''])[:2] for a in sys.argv[1:] if a.startswith('--'))
    slug = args[0] if args else 'sf'
    types = flags['types'].split(',') if flags.get('types') else ALL
    extract(slug, types, refresh='refresh' in flags)


if __name__ == '__main__':
    main()
