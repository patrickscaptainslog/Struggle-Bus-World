#!/usr/bin/env python3
"""Overture Maps extracts for the city bake (OpenStreetMap data, ODbL 1.0, via Overture; places under their providers' licences).

The OSM servers (openstreetmap.org, Overpass, Geofabrik) are not reachable from the bake
machine; Overture's GeoParquet release on S3 is, and its buildings, transportation and
base themes are OpenStreetMap (plus a few other open sources, recorded per feature in
`sources`). The files are spatially sorted with a bbox struct column, so a city needs only
the row groups whose bbox statistics touch it: this reads every file's footer once (cached),
then fetches just those row groups with HTTP range reads.

City-agnostic: driven by tools/bake/cities/<slug>.json
  "bbox": [lon0, lat0, lon1, lat1]
  "overture": {"release": "2026-10-21.0", "pad": 0.004}      (pad: degrees around the bbox)

Writes $SB_OVERTURE_CACHE (default tools/bake/.cache/overture)/<release>/<slug>/<type>.parquet
(plain parquet: WKB `geometry` + flat attribute columns, nested ones as JSON; the bake reads them with pyarrow +
shapely), and <slug>/extract.json: the box, and each type's rows, licence, credit and the sources its rows name. Types:
  building        footprints: height, min_height, num_floors, roof_* , facade_*, names, OSM ids
  building_part   building:part=* (tower massing), same attributes + building_id
  segment         transportation: roads, paths, rail, ferry routes (subtype, class, subclass, names, width; as JSON:
                  connectors, the junctions it meets and where along it, access_restrictions, speed_limits)
  connector       transportation: the junctions themselves (points)
  place           places: marinas, terminals, airports...: names, basic_category, taxonomy, brand, addresses,
                  websites, confidence (never emails, phones or socials). Not ODbL: each provider's own licence
  land_use        base: parks, residential, pedestrian plazas, cemeteries... (+ raw OSM tags)
  land            base: natural=* (trees and tree rows as points/lines, grass, sand, rock...)
  land_cover      base: ESA WorldCover-derived cover classes (only where OSM has nothing)
  water           base: sea, bays, lakes, rivers, reservoirs
  infrastructure  base: bridges, piers, towers, street furniture
  division        divisions: neighbourhood / macrohood / locality points with names
  division_area   divisions: their polygons
A run without --types fetches DEFAULT, the ten the bake reads (all but connector and place): a type added here is
fetched only when asked for. Then, when the run has every DEFAULT type, the city's ESA WorldCover 10 m crop
(tools/bake/worldcover.py; "worldcover": false in the config or --no-worldcover skips it). A crop that can't be
fetched exits 2 (the extracts are written and cached: a rerun only retries WorldCover), as bake.py would at its start.

Kept as they came, shared by every city and every rerun, so an interrupted fetch picks up where it stopped:
  <release>/footers/<type>/<file>.footer       a file's footer: its index of row groups, columns and statistics
  <release>/footers/<type>.json                every row group's bbox statistics, rows and bytes (all columns)
  <release>/raw/<type>/<file>.rg<n>.parquet    a row group the city touches: all its rows, the type's columns
--refresh rebuilds the city's extracts from the row groups held (one lacking a column the type now keeps is
fetched again). --max-footer-mb=N: a type with no footers cached reads them only if they come to N MB or less
(0: never), or exits 4. --max-mb=N: a type whose row groups and footers come to more than N MB fetches nothing and
exits 3. --threads=N: row groups fetched at once (default 4). --check: each type's size, as a line
`SIZE {json}` (the touched footers are read to know it, and kept), and nothing else fetched or written.

usage: python3 -I tools/bake/overture.py <slug> [--types=building,segment,...] [--refresh] [--no-worldcover]
                                         [--max-mb=N] [--max-footer-mb=N] [--threads=N] [--check]
"""
import json
import os
import struct
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.fs as pafs
import pyarrow.parquet as pq

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.environ.get('SB_OVERTURE_CACHE', os.path.join(os.path.dirname(os.path.abspath(__file__)), '.cache', 'overture'))
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
                                   'width_rules', 'level_rules', 'connectors', 'access_restrictions', 'speed_limits', 'geometry', 'bbox']),
    'connector': ('transportation', ['id', 'sources', 'geometry', 'bbox']),
    'place': ('places', ['id', 'names', 'sources', 'confidence', 'basic_category', 'taxonomy', 'operating_status', 'brand', 'addresses',
                         'websites', 'geometry', 'bbox']),
    'land_use': ('base', ['id', 'names', 'sources', 'subtype', 'class', 'surface', 'source_tags', 'level', 'geometry', 'bbox']),
    'land': ('base', ['id', 'names', 'sources', 'subtype', 'class', 'surface', 'source_tags', 'level', 'elevation', 'geometry', 'bbox']),
    'land_cover': ('base', ['id', 'subtype', 'sources', 'geometry', 'bbox']),
    'water': ('base', ['id', 'names', 'sources', 'subtype', 'class', 'is_salt', 'is_intermittent', 'source_tags', 'level', 'geometry', 'bbox']),
    'infrastructure': ('base', ['id', 'names', 'sources', 'subtype', 'class', 'height', 'surface', 'source_tags', 'level', 'geometry', 'bbox']),
    'division': ('divisions', ['id', 'names', 'sources', 'subtype', 'class', 'admin_level', 'local_type', 'population', 'geometry', 'bbox']),
    'division_area': ('divisions', ['id', 'names', 'sources', 'subtype', 'class', 'admin_level', 'division_id', 'is_land', 'geometry', 'bbox']),
}
ALL = list(TYPES)
# what a run fetches when --types doesn't say: the ten the bake reads, written out, so a type added to TYPES never
# changes what a city's default run fetches, and the default run still ends with the city's WorldCover crop
DEFAULT = ['building', 'building_part', 'segment', 'land_use', 'land', 'land_cover', 'water', 'infrastructure', 'division',
           'division_area']

# licence and on-screen credit by theme (docs.overturemaps.org/attribution, last updated 2026-05-15). Places have no
# theme licence: each row is under its provider's (its sources' dataset), and Foursquare's Apache 2.0 brings a NOTICE.txt.
# Both credits get trimmed at bake time to the providers the city's rows name (extract.json's "sources")
LICENSE = {'buildings': 'ODbL-1.0', 'transportation': 'ODbL-1.0', 'base': 'ODbL-1.0', 'divisions': 'ODbL-1.0',
           'places': 'by provider (sources.dataset): CDLA-Permissive-2.0 (Meta, Microsoft and others), Apache-2.0 '
                     '(Foursquare, with its NOTICE.txt), CC0-1.0 (AllThePlaces)'}
OSM_CREDIT = ('© OpenStreetMap contributors (ODbL) · Overture Maps Foundation · TomTom · Esri Community Maps contributors · '
              'Google Open Buildings · Microsoft · ESA WorldCover · geoBoundaries')
CREDIT = {'places': 'Places: Meta, Microsoft, Foursquare, AllThePlaces and others via Overture'}


def log(*a):
    print(f'[{time.strftime("%H:%M:%S")}] overture:', *a, flush=True)


def s3fs():
    proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
    kw = {'proxy_options': proxy} if proxy else {}
    return pafs.S3FileSystem(anonymous=True, region='us-west-2', connect_timeout=30, request_timeout=120, **kw)


def retry(what, fn, tries=8):
    """fn(), retried with growing waits (5 s up to a minute: about 5 minutes in all) over a slow link that drops."""
    for k in range(tries):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001 (network: retry)
            if k == tries - 1:
                raise
            w = min(60, 5 * 2 ** k)
            log(f'  {what}: {e}; retrying in {w} s')
            time.sleep(w)


def footer_path(release, typ, path):
    return os.path.join(CACHE, release, 'footers', typ, os.path.basename(path)[:-len('.parquet')] + '.footer')


def part_path(release, typ, path, i):
    return os.path.join(CACHE, release, 'raw', typ, f'{os.path.basename(path)[:-len(".parquet")]}.rg{i:04d}.parquet')


def footer_len(fs, path):
    """Bytes a file's footer takes (its last 8 bytes say how long it is, magic included)."""
    def one():
        with fs.open_input_file(path) as f:
            b = f.read_at(8, f.size() - 8)
        if b[4:] != b'PAR1':
            raise OSError(f'{path}: no parquet magic at its end')
        return struct.unpack('<I', b[:4])[0] + 8
    return retry(f'tail {os.path.basename(path)}', one)


def file_meta(fs, release, typ, path):
    """(FileMetaData, bytes fetched) of a file, from its footer saved as it came under footers/<type>/, which is fetched
    the first time: so a file's footer is read once, never once per row group."""
    fp = footer_path(release, typ, path)
    got = 0
    if not os.path.exists(fp):
        def one():
            with fs.open_input_file(path) as f:
                n = f.size()
                b = f.read_at(8, n - 8)
                if b[4:] != b'PAR1':
                    raise OSError(f'{path}: no parquet magic at its end')
                k = struct.unpack('<I', b[:4])[0] + 8
                return f.read_at(k, n - k)
        b = retry(f'footer {os.path.basename(path)}', one)
        os.makedirs(os.path.dirname(fp), exist_ok=True)
        with open(fp + '.part', 'wb') as f:
            f.write(b)
        os.replace(fp + '.part', fp)
        got = len(b)
    with open(fp, 'rb') as f:
        b = f.read()
    return pq.read_metadata(pa.BufferReader(b'PAR1' + b)), got


def footers(fs, release, theme, typ, refresh=False, max_mb=None):
    """[(path, [(rg, xmin, xmax, ymin, ymax, rows[, bytes])])] for every file of a type (cached as JSON; bytes, the row
    group's compressed size over all columns, only in caches written since it was kept). max_mb: with no cache, read
    the footers only if they come to that many MB or less (0: never), or exit 4."""
    cdir = os.path.join(CACHE, release, 'footers')
    os.makedirs(cdir, exist_ok=True)
    cpath = os.path.join(cdir, f'{typ}.json')
    if os.path.exists(cpath) and not refresh:
        return json.load(open(cpath))
    if max_mb is not None and max_mb <= 0:
        log(f'{typ}: no footers cached in {cdir}, and --max-footer-mb=0 reads none')
        sys.exit(4)
    base = f'{BUCKET}/release/{release}/theme={theme}/type={typ}'
    files = sorted(i.path for i in fs.get_file_info(pafs.FileSelector(base, recursive=True)) if i.type == pafs.FileType.File)
    t0 = time.time()
    if max_mb is not None:
        new = [p for p in files if not os.path.exists(footer_path(release, typ, p))]
        with ThreadPoolExecutor(8) as ex:
            need = sum(ex.map(lambda p: footer_len(fs, p), new))
        log(f'{typ}: {len(files)} files, {len(new)} footers to read: {need / 1e6:.1f} MB (cap {max_mb:g} MB)')
        if need > max_mb * 1e6:
            log(f'{typ}: the footers are over the cap: none read')
            sys.exit(4)
    done = [0, 0]
    lock = threading.Lock()

    def one(path):
        md, got = file_meta(fs, release, typ, path)
        names = [md.schema.column(j).path for j in range(md.num_columns)]
        col = {n: j for j, n in enumerate(names)}
        rgs = []
        for i in range(md.num_row_groups):
            rg = md.row_group(i)

            def st(name, which):
                s = rg.column(col[name]).statistics
                return getattr(s, which) if s is not None and s.has_min_max else None
            rgs.append((i, st('bbox.xmin', 'min'), st('bbox.xmax', 'max'), st('bbox.ymin', 'min'), st('bbox.ymax', 'max'), rg.num_rows,
                        sum(rg.column(j).total_compressed_size for j in range(rg.num_columns))))
        with lock:
            done[0] += 1
            done[1] += got
            log(f'  {typ} footers: {done[0]}/{len(files)}, {done[1] / 1e6:.1f} MB read, {done[1] / 1e3 / max(1.0, time.time() - t0):.0f} KB/s')
        return path, rgs

    with ThreadPoolExecutor(4) as ex:
        out = list(ex.map(one, files))
    json.dump(out, open(cpath + '.part', 'w'))
    os.replace(cpath + '.part', cpath)
    log(f'{typ}: {len(files)} footers read in {time.time() - t0:.0f} s')
    return out


def wanted(rgs, bb):
    x0, y0, x1, y1 = bb
    return [r[0] for r in rgs if r[1] is None or (r[1] <= x1 and r[2] >= x0 and r[3] <= y1 and r[4] >= y0)]


def rg_bytes(md, i, cols):
    """Compressed bytes of row group i's column chunks for the top-level columns cols."""
    rg = md.row_group(i)
    keep = set(cols)
    return sum(rg.column(j).total_compressed_size for j in range(rg.num_columns) if md.schema.column(j).path.split('.')[0] in keep)


def held(pp, cols):
    """True if the row group is kept whole, with every column the type keeps now."""
    if not os.path.exists(pp):
        return False
    meta = pq.read_schema(pp).metadata or {}
    return set(cols) <= set(json.loads(meta.get(b'sb_columns', b'[]')))


def conform(t, schema):
    """t with schema's columns in its order (absent ones null), cast where a file's types differ."""
    if t.schema.equals(schema, check_metadata=False):
        return t
    cols = [(t[f.name] if f.type == t.schema.field(f.name).type else t[f.name].cast(f.type)) if f.name in t.column_names
            else pa.chunked_array([pa.nulls(t.num_rows, f.type)]) for f in schema]
    return pa.Table.from_arrays(cols, schema=schema.remove_metadata())


def jsons(col):
    return pa.array([json.dumps(v, ensure_ascii=False, default=str) if v else None for v in col.to_pylist()], pa.string())


def flatten(t, typ):
    """Flat columns the bake uses (names.primary, OSM ids from sources, ...), nested ones as JSON; geometry stays WKB.
    Also {(dataset, license): rows} of the sources the rows name."""
    cols = {}
    skip = ('names', 'sources', 'bbox', 'source_tags', 'local_type', 'road_surface', 'road_flags', 'rail_flags', 'width_rules',
            'level_rules')
    for name in t.column_names:
        if name in skip:
            continue
        typ_ = t.schema.field(name).type
        # a nested column the bake has no flat form for (connectors, access_restrictions, speed_limits, taxonomy, brand,
        # addresses, websites): JSON, whole
        cols[name] = jsons(t[name]) if pa.types.is_nested(typ_) else t[name]
    if 'names' in t.column_names:
        cols['name'] = pc.struct_field(t['names'], 'primary')
    seen = {}
    if 'sources' in t.column_names:
        src = t['sources'].to_pylist()
        cols['osm_id'] = pa.array([next((s['record_id'] for s in (ss or []) if s and s.get('dataset') == 'OpenStreetMap' and s.get('record_id')), None)
                                   for ss in src], pa.string())
        cols['datasets'] = pa.array([','.join(sorted({s['dataset'] for s in (ss or []) if s and s.get('dataset')})) for ss in src], pa.string())
        for ss in src:
            for k in {(s.get('dataset'), s.get('license')) for s in (ss or []) if s}:
                seen[k] = seen.get(k, 0) + 1
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
    return pa.table(cols), seen


def fetch_parts(fs, release, typ, cols, jobs, mds, threads):
    """Every row group in jobs not yet held, whole, into raw/<type>/ (each written whole or not at all)."""
    todo = [j for j in jobs if not held(part_path(release, typ, *j), cols)]
    if not todo:
        return
    rdir = os.path.dirname(part_path(release, typ, *todo[0]))
    os.makedirs(rdir, exist_ok=True)
    for n in os.listdir(rdir):
        if n.endswith('.part'):
            os.remove(os.path.join(rdir, n))
    need = sum(rg_bytes(mds[p], i, cols) for p, i in todo)
    have = {p: [c for c in cols if c in mds[p].schema.to_arrow_schema().names] for p in {p for p, _ in todo}}
    t0 = time.time()
    done = [0, 0]
    lock = threading.Lock()
    log(f'{typ}: {len(todo)} row groups to fetch, {need / 1e6:.1f} MB')

    def get(job):
        path, i = job
        pp = part_path(release, typ, path, i)
        t = retry(f'{os.path.basename(path)}#{i}',
                  lambda: pq.ParquetFile(path, filesystem=fs, metadata=mds[path], pre_buffer=True).read_row_group(i, columns=have[path]))
        meta = dict(t.schema.metadata or {})
        meta[b'sb_columns'] = json.dumps(cols).encode()
        meta[b'sb_source'] = f's3://{path}#row_group={i}'.encode()
        pq.write_table(t.replace_schema_metadata(meta), pp + '.part', compression='zstd')
        os.replace(pp + '.part', pp)
        with lock:
            done[0] += 1
            done[1] += rg_bytes(mds[path], i, cols)
            dt = max(1.0, time.time() - t0)
            rate = done[1] / dt
            log(f'  {typ}: {done[0]}/{len(todo)} row groups, {done[1] / 1e6:.1f}/{need / 1e6:.1f} MB, {rate / 1e3:.0f} KB/s, '
                f'{(need - done[1]) / max(rate, 1.0) / 60:.0f} min to go')

    with ThreadPoolExecutor(max(1, threads)) as ex:
        list(ex.map(get, todo))


def extract(slug, types=DEFAULT, refresh=False, worldcover=True, max_mb=None, max_footer_mb=None, threads=4, check=False):
    cfg = json.load(open(os.path.join(HERE, 'cities', f'{slug}.json')))
    oc = cfg.get('overture', {})
    release = oc.get('release', DEFAULT_RELEASE)
    pad = float(oc.get('pad', 0.004))
    lon0, lat0, lon1, lat1 = cfg['bbox']
    bb = (lon0 - pad, lat0 - pad, lon1 + pad, lat1 + pad)
    odir = os.path.join(CACHE, release, slug)
    os.makedirs(odir, exist_ok=True)
    fs = s3fs()
    epath = os.path.join(odir, 'extract.json')
    ex = json.load(open(epath)) if os.path.exists(epath) else {}
    if ex.get('release') != release or ex.get('bbox') != list(bb):
        ex = {}
    ex.update(release=release, bbox=list(bb))
    ex.pop('license', None)  # (one licence for every type, before places: wrong for them)
    ex.setdefault('counts', {})
    for k in ('licenses', 'credits', 'sources'):
        ex.setdefault(k, {})

    def save():
        for t in ex['counts']:
            ex['licenses'].setdefault(t, LICENSE[TYPES[t][0]])
            ex['credits'].setdefault(t, CREDIT.get(TYPES[t][0], OSM_CREDIT))
        json.dump(ex, open(epath + '.part', 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
        os.replace(epath + '.part', epath)

    for typ in types:
        theme, cols = TYPES[typ]
        dst = os.path.join(odir, f'{typ}.parquet')
        if os.path.exists(dst) and not refresh and not check:
            n = pq.ParquetFile(dst).metadata.num_rows
            log(f'{typ}: cached {dst} ({n} rows)')
            ex['counts'].setdefault(typ, n)
            continue
        ft = footers(fs, release, theme, typ, max_mb=max_footer_mb)
        jobs = [(path, i) for path, rgs in ft for i in wanted(rgs, bb)]
        files = sorted({p for p, _ in jobs})
        # the size before anything is fetched: the footers of the files the city touches (not yet held), then
        # their touched row groups, the columns kept
        new = [p for p in files if not os.path.exists(footer_path(release, typ, p))]
        if max_mb is not None and new:
            with ThreadPoolExecutor(8) as tp:
                fneed = sum(tp.map(lambda p: footer_len(fs, p), new))
            if fneed > max_mb * 1e6:
                log(f'{typ}: {len(new)} footers come to {fneed / 1e6:.1f} MB, over the cap of {max_mb:g} MB: nothing fetched')
                sys.exit(3)
        with ThreadPoolExecutor(4) as tp:
            got = dict(zip(files, tp.map(lambda p: file_meta(fs, release, typ, p), files)))
        mds = {p: g[0] for p, g in got.items()}
        fb = sum(g[1] for g in got.values())
        rb = sum(rg_bytes(mds[p], i, cols) for p, i in jobs)
        allb = sum(sum(mds[p].row_group(i).column(j).total_compressed_size for j in range(mds[p].row_group(i).num_columns)) for p, i in jobs)
        log(f'{typ}: {len(jobs)} row groups in {len(files)} files touch the bbox: {rb / 1e6:.1f} MB for the columns kept '
            f'({allb / 1e6:.1f} MB with all of them), footers {fb / 1e6:.1f} MB read now')
        if check:
            held_n = sum(held(part_path(release, typ, p, i), cols) for p, i in jobs)
            print('SIZE ' + json.dumps({'type': typ, 'row_groups': len(jobs), 'files': len(files), 'bytes': rb, 'all_columns': allb,
                                        'footers': sum(os.path.getsize(footer_path(release, typ, p)) for p in files),
                                        'footers_read_now': fb, 'held': held_n}), flush=True)
            continue
        if max_mb is not None and rb + fb > max_mb * 1e6:
            for p in files:
                if got[p][1]:
                    os.remove(footer_path(release, typ, p))
            log(f'{typ}: {(rb + fb) / 1e6:.1f} MB, over the cap of {max_mb:g} MB: nothing fetched, the footers read for it removed')
            sys.exit(3)
        t0 = time.time()
        fetch_parts(fs, release, typ, cols, jobs, mds, threads)
        # the city's rows from the parts, flattened, one row group at a time
        parts = [part_path(release, typ, p, i) for p, i in jobs]
        schema = pa.unify_schemas([pq.read_schema(pp) for pp in parts], promote_options='permissive') if parts else None
        w = None
        n = 0
        seen = {}
        try:
            for pp in parts:
                t = conform(pq.read_table(pp), schema)
                b = t['bbox']
                m = pc.and_(pc.and_(pc.less_equal(pc.struct_field(b, 'xmin'), bb[2]), pc.greater_equal(pc.struct_field(b, 'xmax'), bb[0])),
                            pc.and_(pc.less_equal(pc.struct_field(b, 'ymin'), bb[3]), pc.greater_equal(pc.struct_field(b, 'ymax'), bb[1])))
                t = t.filter(m)
                if not t.num_rows:
                    continue
                f, s = flatten(t, typ)
                for k, v in s.items():
                    seen[k] = seen.get(k, 0) + v
                if w is None:
                    w = pq.ParquetWriter(dst + '.part', f.schema, compression='zstd')
                w.write_table(f if f.schema.equals(w.schema) else conform(f, w.schema))
                n += f.num_rows
        finally:
            if w is not None:
                w.close()
        if w is None:
            pq.write_table(pa.table({'id': pa.array([], pa.string()), 'geometry': pa.array([], pa.binary())}), dst + '.part', compression='zstd')
        os.replace(dst + '.part', dst)
        log(f'{typ}: {n} features -> {dst} ({os.path.getsize(dst) / 1e6:.1f} MB) in {time.time() - t0:.0f} s')
        ex['counts'][typ] = n
        ex['licenses'][typ] = LICENSE[theme]
        ex['credits'][typ] = CREDIT.get(theme, OSM_CREDIT)
        ex['sources'][typ] = [{'dataset': d, 'license': li, 'rows': v} for (d, li), v in sorted(seen.items(), key=lambda kv: -kv[1])]
        save()
    if check:
        return odir
    save()
    if worldcover and cfg.get('worldcover', True) and set(DEFAULT) <= set(types):
        # the city's ESA WorldCover crop with its extracts (the bake's tree evidence, the QA's reference): a city
        # whose WorldCover can't be read finds out now, not when its bake starts
        import importlib.util
        sys.dont_write_bytecode = True
        spec = importlib.util.spec_from_file_location('sb_worldcover', os.path.join(HERE, 'worldcover.py'))
        wc = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(wc)
        try:
            wc.ensure(slug, [tuple(cfg['bbox'])], log=log, refresh=refresh)
        except (SystemExit, Exception) as e:  # noqa: BLE001
            log(f'worldcover: NOT fetched ({e}). The extracts are cached; rerun to retry (the bake needs it: it fails '
                'at its start without it), or set "worldcover": false in the config to bake without tree evidence')
            sys.exit(2)
    return odir


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = dict((a[2:].split('=', 1) + [''])[:2] for a in sys.argv[1:] if a.startswith('--'))
    slug = args[0] if args else 'sf'
    types = flags['types'].split(',') if flags.get('types') else DEFAULT
    bad = [t for t in types if t not in TYPES]
    if bad:
        raise SystemExit(f'overture: unknown types {bad} (known: {", ".join(ALL)})')

    def num(k):
        return float(flags[k]) if flags.get(k) else None
    extract(slug, types, refresh='refresh' in flags, worldcover='no-worldcover' not in flags, max_mb=num('max-mb'),
            max_footer_mb=num('max-footer-mb'), threads=int(flags.get('threads') or 4), check='check' in flags)


if __name__ == '__main__':
    main()
