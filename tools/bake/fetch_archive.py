#!/usr/bin/env python3
"""The Bay Area's stage 0 archive (docs/specs/earth/LIVING.md, "Stage 0"): the 21 downloads the producer OK'd on
2026-11-04, the list's version 2, but item 18 (GEBCO), which is a click in GEBCO's own web app that the producer
makes (its 933 MB fallback tile wasn't OK'd).

Every item's size is checked against the list's figure before anything of it is fetched (a HEAD, the S3 file
indexes, or the tiles' headers): more than 20 % over, and the item is skipped with nothing of it kept. Land
polygons (20) are fetched only if the live file is within 10 % of the list's archived copy. Files are kept as they
came and never edited: zips stay zipped (15's world raster may take 5-10 GB unzipped, so the bake unzips it later,
after a check of the space).

  <archive>/overture/       Overture 2026-10-21.0 through tools/bake/overture.py, type by type: its cache
                            (footers/, raw/ row groups as they came, bay/ the flattened extracts and extract.json)
  <archive>/dem/            Copernicus GLO-30, 8 tiles
  <archive>/worldcover/     ESA WorldCover 2021, the Bay window only, through tools/bake/worldcover.py (bay.tif)
  <archive>/shipdensity/    World Bank ship density: commercial, passenger, two readmes
  <archive>/ourairports/    airports.csv, runways.csv
  <archive>/landpolygons/   land-polygons-split-4326.zip
  <archive>/geoid/          us_nga_egm96_15.tif
  <archive>/manifest.json   every file: its item, source URL, bytes, sha256, licence, credit line and time
  <archive>/status.json     every item: done, skipped (why) or failed (why), with the sizes checked
  <archive>/fetch.log       progress
  <archive>/DONE.txt        written once every item is fetched or skipped, with the skipped ones and why
  <archive>/STOPPED.txt     written instead when it stops early: C: under 6 GB free, or an item failed every try

Safe to run again: what's complete is kept and not fetched again, curl resumes a partial file (started over if the
server's copy changed), Overture resumes by row group. Two lanes at once, S3 and the other servers; below-normal
priority; memory, one Overture row group per thread.

usage: python3 -I tools/bake/fetch_archive.py <archive dir> [--footers-from=<dir>] [--only=3,13,...] [--ok=1:500,5:66]
  --footers-from  where the Overture footer indexes (<type>.json) already read live, copied in when missing
  --ok=<item>:<MB>  a new figure for an item once the producer OKs it; the 20 % rule then holds against that
"""
import ctypes
import hashlib
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable
CURL = shutil.which('curl') or 'curl'
MB = 1e6
MIN_FREE = 6e9
SLUG = 'bay'
RELEASE = '2026-10-21.0'
BUCKET = 'overturemaps-us-west-2'
OVER = 0.20  # an item more than this over its figure is skipped

THEME = {'building': 'buildings', 'building_part': 'buildings', 'segment': 'transportation', 'connector': 'transportation',
         'place': 'places', 'land_use': 'base', 'land': 'base', 'land_cover': 'base', 'water': 'base', 'infrastructure': 'base',
         'division': 'divisions', 'division_area': 'divisions'}
GLO30 = 'https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_{t}_00_DEM/Copernicus_DSM_COG_10_{t}_00_DEM.tif'
WB = 'https://datacatalogfiles.worldbank.org/ddh-published/0037580/5/'
WC_TILE = 'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{t}_Map.tif'

LIC = {
    'glo30': ('Copernicus DEM GLO-30 licence (free; credit required): '
              'https://docs.sentinel-hub.com/api/latest/static/files/data/dem/resources/license/License-COPDEM-30.pdf',
              'produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided '
              'under COPERNICUS by the European Union and ESA; all rights reserved',
              'The legal notice must carry: "The organisations in charge of the Copernicus programme by law or by delegation do '
              'not incur any liability for any use of the Copernicus WorldDEM-30" (Art. 6(c)); nothing may suggest Copernicus '
              'endorses the game (6(d))'),
    'worldcover': ('CC BY 4.0', '© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by '
                   'ESA WorldCover consortium', None),
    'ship': ('CC BY 4.0 (https://datacatalog.worldbank.org/search/dataset/0037580)',
             "Shipping lanes derived from Global Shipping Traffic Density, The World Bank (2021), CC BY 4.0. Data from IMF's World "
             'Seaborne Trade Monitoring System (Cerdeiro, Komaromi, Liu and Saeed, 2020), with support from ESMAP and PROBLUE. '
             'Modified: converted into a lane graph.', None),
    'ourairports': ('Public domain (https://ourairports.com/data/)', 'Airports: OurAirports (public domain)',
                    'Rebuilt every night: this archived copy is the one used'),
    'land': ('ODbL-1.0', '© OpenStreetMap contributors (ODbL)', None),
    'geoid': ('Public domain (PROJ-data README)', 'EGM96 geoid: NGA, via PROJ-data', None),
}

# the list, version 2: item, what, lane, kind, and the figure (bytes) the 20 % rule holds against (a range's top)
ITEMS = [
    dict(n=3, what='Overture roads, paths, rail, ferry routes', lane='s3', kind='overture', types=['segment'], fig=292 * MB),
    dict(n=6, what='Overture file indexes (footers) for 4 and 5', lane='s3', kind='footers',
         parts={'connector': 16.2 * MB, 'place': 38.0 * MB}, fig=54.2 * MB),
    dict(n=4, what='Overture road junctions (connectors)', lane='s3', kind='overture', types=['connector'], fig=101 * MB, index=6),
    dict(n=5, what='Overture places', lane='s3', kind='overture', types=['place'], fig=48 * MB, index=6),
    dict(n=7, what='Overture land use', lane='s3', kind='overture', types=['land_use'], fig=62 * MB),
    dict(n=10, what='Overture water', lane='s3', kind='overture', types=['water'], fig=67 * MB),
    dict(n=11, what='Overture bridges, piers, towers', lane='s3', kind='overture', types=['infrastructure'], fig=89 * MB),
    dict(n=12, what='Overture neighbourhood points and outlines', lane='s3', kind='overture', types=['division', 'division_area'],
         fig=48 * MB),
    dict(n=2, what='Overture building parts', lane='s3', kind='overture', types=['building_part'], fig=5.7 * MB),
    dict(n=1, what='Overture buildings', lane='s3', kind='overture', types=['building'], fig=360 * MB),
    dict(n=8, what='Overture land', lane='s3', kind='overture', types=['land'], fig=89 * MB),
    dict(n=9, what='Overture land cover', lane='s3', kind='overture', types=['land_cover'], fig=87 * MB),
    dict(n=14, what='ESA WorldCover, the Bay window', lane='s3', kind='worldcover', fig=28 * MB, lic='worldcover',
         sources=[WC_TILE.format(t='N36W123'), WC_TILE.format(t='N36W126')]),
    dict(n=13, what='Copernicus GLO-30, 8 tiles', lane='s3', kind='files', fig=216_100_743, lic='glo30',
         files=[(f'dem/Copernicus_DSM_COG_10_{t}_00_DEM.tif', GLO30.format(t=t)) for t in
                ('N36_00_W123', 'N36_00_W122', 'N37_00_W124', 'N37_00_W123', 'N37_00_W122', 'N38_00_W124', 'N38_00_W123', 'N38_00_W122')]),
    dict(n=21, what='EGM96 geoid grid', lane='web', kind='files', fig=2_710_815, lic='geoid',
         files=[('geoid/us_nga_egm96_15.tif', 'https://cdn.proj.org/us_nga_egm96_15.tif')]),
    dict(n=16, what='Ship density readmes', lane='web', kind='files', fig=2_164, lic='ship',
         files=[('shipdensity/readme.txt', WB + 'DR0084213/readme.txt'), ('shipdensity/readme_ddh.txt', WB + 'DR0045407/readme_ddh.txt')]),
    dict(n=19, what='OurAirports airports and runways', lane='web', kind='files', fig=16_730_434, lic='ourairports',
         files=[('ourairports/airports.csv', 'https://davidmegginson.github.io/ourairports-data/airports.csv'),
                ('ourairports/runways.csv', 'https://davidmegginson.github.io/ourairports-data/runways.csv')]),
    dict(n=17, what='Ship density, passenger layer', lane='web', kind='files', fig=22_849_854, lic='ship',
         files=[('shipdensity/ShipDensity_Passenger.zip', WB + 'DR0045404/ShipDensity_Passenger.zip')]),
    dict(n=15, what='Ship density, commercial layer (not unzipped)', lane='web', kind='files', fig=480_353_369, lic='ship',
         files=[('shipdensity/shipdensity_commercial_.zip', WB + 'DR0045405/shipdensity_commercial_.zip')]),
    dict(n=20, what='Land polygons (coastline), split, WGS84', lane='web', kind='files', fig=892_676_617, lic='land', within=0.10,
         files=[('landpolygons/land-polygons-split-4326.zip', 'https://osmdata.openstreetmap.de/download/land-polygons-split-4326.zip')]),
    dict(n=18, what='GEBCO_2026, the Bay and its approaches', lane='web', kind='manual',
         why="the producer's click in GEBCO's web app (download.gebco.net); its 933 MB fallback tile wasn't OK'd"),
]


class Fail(Exception):
    """An item that couldn't be fetched this try (network, a server's answer): tried again later."""


class Stopped(Exception):
    """C: is too full: stop everything, keep what's complete."""


A = None
LOG = None
LOCK = threading.Lock()
STOP = threading.Event()
PROCS = {}
ACTIVE = {}
MANIFEST = {}
STATUS = {}


def now():
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())


def log(lane, msg):
    with LOCK:
        LOG.write(f'[{time.strftime("%Y-%m-%d %H:%M:%S")}] [{lane}] {msg}\n')
        LOG.flush()


def save_json(name, obj):
    p = os.path.join(A, name)
    with open(p + '.part', 'w', encoding='utf-8') as f:
        json.dump(obj, f, indent=1, ensure_ascii=False)
    os.replace(p + '.part', p)


def save_manifest():
    with LOCK:
        files = [MANIFEST[k] for k in sorted(MANIFEST, key=lambda k: (MANIFEST[k]['item'] if isinstance(MANIFEST[k]['item'], int) else 0, k))]
        save_json('manifest.json', {'archive': "The Bay Area's stage 0 inputs: DOWNLOADS.md version 2, OK'd by the producer 2026-11-04",
                                    'updated': now(), 'files': files})


def set_status(it, status, why=None, **kw):
    with LOCK:
        STATUS[str(it['n'])] = dict({'item': it['n'], 'what': it['what'], 'status': status, 'why': why, 'time': now()}, **kw)
        save_json('status.json', {'updated': now(), 'items': [STATUS[k] for k in sorted(STATUS, key=int)]})


def free():
    return shutil.disk_usage(A).free


def guard(lane):
    if STOP.is_set():
        raise Stopped()
    if free() < MIN_FREE:
        stop(lane, f'C: has {free() / 1e9:.1f} GB free, under {MIN_FREE / 1e9:.0f} GB')
        raise Stopped()


def stop(lane, why):
    if STOP.is_set():
        return
    STOP.set()
    log(lane, f'STOPPING: {why}')
    with open(os.path.join(A, 'STOPPED.txt'), 'w', encoding='utf-8') as f:
        f.write(f'Stopped {now()}: {why}\nWhat was complete is kept; run the script again to go on.\n')
    with LOCK:
        for p in list(PROCS.values()):
            try:
                p.terminate()
            except OSError:
                pass


class _PMC(ctypes.Structure):
    _fields_ = [('cb', ctypes.c_ulong), ('PageFaultCount', ctypes.c_ulong), ('PeakWorkingSetSize', ctypes.c_size_t),
                ('WorkingSetSize', ctypes.c_size_t), ('QuotaPeakPagedPoolUsage', ctypes.c_size_t), ('QuotaPagedPoolUsage', ctypes.c_size_t),
                ('QuotaPeakNonPagedPoolUsage', ctypes.c_size_t), ('QuotaNonPagedPoolUsage', ctypes.c_size_t),
                ('PagefileUsage', ctypes.c_size_t), ('PeakPagefileUsage', ctypes.c_size_t)]


class _PE(ctypes.Structure):
    _fields_ = [('dwSize', ctypes.c_ulong), ('cntUsage', ctypes.c_ulong), ('th32ProcessID', ctypes.c_ulong),
                ('th32DefaultHeapID', ctypes.c_size_t), ('th32ModuleID', ctypes.c_ulong), ('cntThreads', ctypes.c_ulong),
                ('th32ParentProcessID', ctypes.c_ulong), ('pcPriClassBase', ctypes.c_long), ('dwFlags', ctypes.c_ulong),
                ('szExeFile', ctypes.c_char * 260)]


def memory(pid):
    """(working set, peak working set) in MB of a process (Windows), or None."""
    if os.name != 'nt':
        return None
    k = ctypes.windll.kernel32
    k.OpenProcess.restype = ctypes.c_void_p
    h = k.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return None
    c = _PMC()
    c.cb = ctypes.sizeof(_PMC)
    ok = k.K32GetProcessMemoryInfo(ctypes.c_void_p(h), ctypes.byref(c), c.cb)
    k.CloseHandle(ctypes.c_void_p(h))
    return (c.WorkingSetSize / 2 ** 20, c.PeakWorkingSetSize / 2 ** 20) if ok else None


def tree(pid):
    """pid and every process under it (a venv's python.exe is a launcher: the interpreter is its child)."""
    if os.name != 'nt':
        return [pid]
    k = ctypes.windll.kernel32
    k.CreateToolhelp32Snapshot.restype = ctypes.c_void_p
    snap = k.CreateToolhelp32Snapshot(2, 0)  # TH32CS_SNAPPROCESS
    kids = {}
    e = _PE()
    e.dwSize = ctypes.sizeof(_PE)
    ok = k.Process32First(ctypes.c_void_p(snap), ctypes.byref(e))
    while ok:
        kids.setdefault(e.th32ParentProcessID, []).append(e.th32ProcessID)
        ok = k.Process32Next(ctypes.c_void_p(snap), ctypes.byref(e))
    k.CloseHandle(ctypes.c_void_p(snap))
    out, todo = [], [pid]
    while todo:
        q = todo.pop()
        out.append(q)
        todo += [c for c in kids.get(q, []) if c not in out]
    return out


def tree_mb(pid):
    return sum((memory(q) or (0, 0))[0] for q in tree(pid))


def run(lane, args, env=None):
    """(exit code, output lines) of a child at below-normal priority, its output into the log as it comes."""
    flags = getattr(subprocess, 'BELOW_NORMAL_PRIORITY_CLASS', 0) | getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    e = dict(os.environ, PYTHONIOENCODING='utf-8', PYTHONDONTWRITEBYTECODE='1', **(env or {}))
    p = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, env=e, creationflags=flags,
                         text=True, encoding='utf-8', errors='replace', bufsize=1)
    with LOCK:
        PROCS[lane] = p
    out = []
    peak = [0.0]

    def sample():
        while p.poll() is None:
            peak[0] = max(peak[0], tree_mb(p.pid))
            time.sleep(5)
    if args[0] == PY:
        threading.Thread(target=sample, daemon=True).start()
    try:
        for line in p.stdout:
            line = line.rstrip()
            out.append(line)
            if line and not line.startswith('SIZE '):
                log(lane, '  ' + line)
        p.wait()
        if args[0] == PY:
            log(lane, f'  ({os.path.basename(args[2])} exit {p.returncode}; memory at most {peak[0]:.0f} MB, sampled every 5 s)')
    finally:
        with LOCK:
            PROCS.pop(lane, None)
    if STOP.is_set():
        raise Stopped()
    return p.returncode, out


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def record(rel, item, what, source, lic, credit, note=None):
    """The file's manifest entry, its sha256 taken now it's complete (kept if the file hasn't changed since)."""
    p = os.path.join(A, rel)
    st = os.stat(p)
    old = MANIFEST.get(rel)
    if old and old['bytes'] == st.st_size and old.get('mtime') == int(st.st_mtime):
        h = old['sha256']
    else:
        h = sha256(p)
    e = {'item': item, 'what': what, 'path': rel, 'source': source, 'bytes': st.st_size, 'sha256': h, 'licence': lic,
         'credit': credit, 'time': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(st.st_mtime)), 'mtime': int(st.st_mtime)}
    if note:
        e['note'] = note
    with LOCK:
        MANIFEST[rel] = e


def rel(*p):
    return '/'.join(p)


# ---- plain files: a HEAD for the size, then curl with resume

def head(url, tries=4, wait=30):
    """{'bytes', 'etag', 'modified'} from a HEAD (or, if a server won't answer one, a 1-byte range)."""
    err = None
    for k in range(tries):
        r = subprocess.run([CURL, '-sSIL', '--connect-timeout', '30', '--max-time', '120', url], capture_output=True, text=True,
                           encoding='utf-8', errors='replace', creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if r.returncode == 0:
            blocks = [b for b in r.stdout.replace('\r', '').split('\n\n') if b.strip()]
            lines = blocks[-1].split('\n')
            code = int(lines[0].split()[1])
            h = {a.strip().lower(): b.strip() for a, b in (ln.split(':', 1) for ln in lines[1:] if ':' in ln)}
            if code == 200 and 'content-length' in h:
                return {'bytes': int(h['content-length']), 'etag': h.get('etag'), 'modified': h.get('last-modified')}
            err = f'HTTP {code}' + ('' if code != 200 else ', no Content-Length')
            if code in (403, 405) or code == 200:
                r = subprocess.run([CURL, '-sSL', '-r', '0-0', '-D', '-', '-o', os.devnull, '--connect-timeout', '30', '--max-time', '120', url],
                                   capture_output=True, text=True, encoding='utf-8', errors='replace',
                                   creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                cr = [ln for ln in r.stdout.replace('\r', '').split('\n') if ln.lower().startswith('content-range:')]
                if r.returncode == 0 and cr and '/' in cr[-1] and cr[-1].rsplit('/', 1)[1].strip().isdigit():
                    return {'bytes': int(cr[-1].rsplit('/', 1)[1]), 'etag': None, 'modified': None}
        else:
            err = r.stderr.strip() or f'curl exit {r.returncode}'
        if k < tries - 1:
            time.sleep(wait * (k + 1))
    raise Fail(f'no size from {url}: {err}')


def download(lane, relp, url, expect):
    dst = os.path.join(A, relp)
    part = dst + '.part'
    meta = part + '.json'
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if os.path.exists(part):
        old = json.load(open(meta)) if os.path.exists(meta) else None
        if old != expect:
            log(lane, f'{relp}: the partial file is of another copy on the server: starting over')
            os.remove(part)
    with open(meta, 'w') as f:
        json.dump(expect, f)
    t0 = time.time()
    have0 = os.path.getsize(part) if os.path.exists(part) else 0
    for k in range(40):
        guard(lane)
        have = os.path.getsize(part) if os.path.exists(part) else 0
        if have == expect['bytes']:
            break
        if have > expect['bytes']:
            os.remove(part)
            raise Fail(f'{relp}: {have} B, more than the {expect["bytes"]} B the server said: removed')
        log(lane, f'{relp}: {"resuming at " + format(have, ",") + " B" if have else "starting"} ({expect["bytes"] / MB:.1f} MB) from {url}')
        with LOCK:
            ACTIVE[lane] = (relp, part, expect['bytes'], time.time(), have)
        try:
            args = [CURL, '-fsSL', '--connect-timeout', '30', '--speed-limit', '512', '--speed-time', '180', '-o', part]
            rc, out = run(lane, args + (['-C', '-'] if have else []) + [url])
        finally:
            with LOCK:
                ACTIVE.pop(lane, None)
        if rc == 33:
            log(lane, f'{relp}: the server won\'t resume: starting over')
            os.remove(part)
        elif rc != 0:
            w = min(600, 30 * (k + 1))
            log(lane, f'{relp}: curl exit {rc} ({" ".join(out)[-200:]}); again in {w} s')
            for _ in range(w):
                guard(lane)
                time.sleep(1)
    else:
        raise Fail(f'{relp}: incomplete after 40 tries')
    os.replace(part, dst)
    os.remove(meta)
    dt = max(1.0, time.time() - t0)
    log(lane, f'{relp}: complete, {expect["bytes"]:,} B in {dt / 60:.1f} min ({(expect["bytes"] - have0) / dt / 1e3:.0f} KB/s)')


def files_item(it):
    lane = it['lane']
    lic, credit, note = LIC[it['lic']]
    files = it['files']
    if all(r in MANIFEST and os.path.exists(os.path.join(A, r)) and os.path.getsize(os.path.join(A, r)) == MANIFEST[r]['bytes']
           for r, _ in files):
        return 'done', None, {'bytes': sum(MANIFEST[r]['bytes'] for r, _ in files)}
    sizes = {}
    for r, url in files:
        p = os.path.join(A, r)
        if r in MANIFEST and os.path.exists(p) and os.path.getsize(p) == MANIFEST[r]['bytes']:
            sizes[r] = {'bytes': MANIFEST[r]['bytes']}
            continue
        try:
            sizes[r] = head(url, tries=5 if it.get('within') else 4)
        except Fail as e:
            if it.get('within'):
                return 'skipped', f'the live size is unknown, so it can\'t be checked against the list ({e})', {}
            raise
    total = sum(s['bytes'] for s in sizes.values())
    fig = it['fig']
    log(lane, f'item {it["n"]}: {total:,} B live, the list says {fig:,.0f} B ({(total / fig - 1) * 100:+.1f} %)')
    checked = {'bytes': total, 'figure': fig}
    if it.get('within') and abs(total - fig) > fig * it['within']:
        purge_files(files)
        return 'skipped', f'the live file is {total:,} B, more than {it["within"] * 100:.0f} % from the list\'s {fig:,.0f} B', checked
    if total > fig * (1 + OVER):
        purge_files(files)
        return 'skipped', f'{total:,} B, {(total / fig - 1) * 100:.0f} % over the list\'s {fig:,.0f} B: nothing of it kept', checked
    for r, url in files:
        p = os.path.join(A, r)
        if not (os.path.exists(p) and os.path.getsize(p) == sizes[r]['bytes']):
            download(lane, r, url, sizes[r])
        record(r, it['n'], it['what'], url, lic, credit, note)
        save_manifest()
    return 'done', None, checked


def purge_files(files):
    for r, _ in files:
        for p in (os.path.join(A, r), os.path.join(A, r) + '.part', os.path.join(A, r) + '.part.json'):
            if os.path.exists(p):
                os.remove(p)
        with LOCK:
            MANIFEST.pop(r, None)
    save_manifest()


# ---- Overture, through tools/bake/overture.py, type by type

def odir(*p):
    return os.path.join(A, 'overture', RELEASE, *p)


def overture(lane, args):
    env = {'SB_OVERTURE_CACHE': os.path.join(A, 'overture')}
    return run(lane, [PY, '-I', os.path.join(HERE, 'overture.py'), SLUG] + args, env)


def size_of(lane, typ, footer_cap=0):
    rc, out = overture(lane, [f'--types={typ}', '--check', f'--max-footer-mb={footer_cap}'])
    if rc == 4:
        return None
    sizes = [json.loads(ln[5:]) for ln in out if ln.startswith('SIZE ')]
    if rc != 0 or not sizes:
        raise Fail(f'overture.py --check {typ}: exit {rc}: {" ".join(out[-3:])[-300:]}')
    return sizes[0]


def purge_overture(typ, keep_footers):
    """Nothing of a type kept: its row groups, its extract, and the footers read for it (not item 6's)."""
    for d in [odir('raw', typ)] + ([] if keep_footers else [odir('footers', typ)]):
        if os.path.isdir(d):
            shutil.rmtree(d)
    p = odir(SLUG, f'{typ}.parquet')
    if os.path.exists(p):
        os.remove(p)
    with LOCK:
        for k in [k for k in MANIFEST if k.startswith((rel('overture', RELEASE, 'raw', typ) + '/', rel('overture', RELEASE, SLUG, typ + '.parquet')))
                  or (not keep_footers and k.startswith(rel('overture', RELEASE, 'footers', typ) + '/'))]:
            MANIFEST.pop(k)
    save_manifest()


def record_overture(it, typ):
    ex = json.load(open(odir(SLUG, 'extract.json'), encoding='utf-8'))
    lic, credit = ex['licenses'][typ], ex['credits'][typ]
    s3 = f's3://{BUCKET}/release/{RELEASE}/theme={THEME[typ]}/type={typ}/'
    n = it['n']
    for name in sorted(os.listdir(odir('raw', typ))):
        if name.endswith('.parquet'):
            base, rg = name[:-len('.parquet')].rsplit('.rg', 1)
            record(rel('overture', RELEASE, 'raw', typ, name), n, f'{it["what"]}: a row group as it came, every row, the columns kept',
                   f'{s3}{base}.parquet#row_group={int(rg)}', lic, credit)
    fi = 6 if typ in ('connector', 'place') else n
    for name in sorted(os.listdir(odir('footers', typ))):
        if name.endswith('.footer'):
            record(rel('overture', RELEASE, 'footers', typ, name), fi, f'Overture {typ}: a file\'s footer (its index) as it came',
                   f'{s3}{name[:-len(".footer")]}.parquet#footer', lic, credit)
    record(rel('overture', RELEASE, SLUG, f'{typ}.parquet'), n, f'{it["what"]}: the Bay box\'s rows, flattened for the bake',
           f'made by tools/bake/overture.py from overture/{RELEASE}/raw/{typ}/', lic, credit)
    record(rel('overture', RELEASE, SLUG, 'extract.json'), 'overture', 'Overture extract record: box, counts, licences, credits, sources',
           'made by tools/bake/overture.py', 'as each type', 'as each type')
    save_manifest()


def footers_item(it):
    lane = it['lane']
    checked = {}
    for typ, fig in it['parts'].items():
        s = size_of(lane, typ, footer_cap=round(fig * (1 + OVER) / MB, 2))
        if s is None:
            return 'skipped', f'{typ}: its footers are over {OVER * 100:.0f} % past the list\'s {fig / MB:g} MB (fetch.log): none read', checked
        d = odir('footers', typ)
        checked[typ] = sum(os.path.getsize(os.path.join(d, n)) for n in os.listdir(d) if n.endswith('.footer'))
        s3 = f's3://{BUCKET}/release/{RELEASE}/theme={THEME[typ]}/type={typ}/'
        lic = 'as item 4' if typ == 'connector' else 'as item 5'
        for name in sorted(os.listdir(d)):
            if name.endswith('.footer'):
                record(rel('overture', RELEASE, 'footers', typ, name), 6, f'Overture {typ}: a file\'s footer (its index) as it came',
                       f'{s3}{name[:-len(".footer")]}.parquet#footer', lic, None)
        record(rel('overture', RELEASE, 'footers', f'{typ}.json'), 6, f'Overture {typ}: every row group\'s bbox statistics, from the footers',
               'made by tools/bake/overture.py from the footers', lic, None)
        save_manifest()
    total = sum(checked.values())
    log(lane, f'item 6: {total:,} B of footers, the list says {it["fig"]:,.0f} B ({(total / it["fig"] - 1) * 100:+.1f} %)')
    return 'done', None, {'bytes': total, 'figure': it['fig'], 'by_type': checked}


def overture_item(it):
    lane = it['lane']
    if it.get('index') and STATUS.get(str(it['index']), {}).get('status') != 'done':
        return 'skipped', f'its file index, item {it["index"]}, wasn\'t fetched', {}
    sizes = {}
    for typ in it['types']:
        s = size_of(lane, typ)
        if s is None:
            raise Fail(f'{typ}: no footer index in the archive (pass --footers-from)')
        sizes[typ] = s
    data = sum(s['bytes'] for s in sizes.values())
    allc = sum(s['all_columns'] for s in sizes.values())
    foot = sum(s['footers'] for s in sizes.values())
    fig = it['fig']
    checked = {'bytes': data, 'all_columns': allc, 'footers': foot, 'figure': fig,
               'row_groups': {t: s['row_groups'] for t, s in sizes.items()}}
    log(lane, f'item {it["n"]}: the row groups the Bay touches come to {data / MB:.1f} MB for the columns kept ({allc / MB:.1f} MB with '
              f'all), the list says {fig / MB:g} MB ({(data / fig - 1) * 100:+.1f} %); plus {foot / MB:.1f} MB of their files\' footers'
              + (' (item 6)' if it.get('index') else ''))
    if data > fig * (1 + OVER):
        for typ in it['types']:
            purge_overture(typ, keep_footers=bool(it.get('index')))
        return 'skipped', (f'{data / MB:.1f} MB, {(data / fig - 1) * 100:.0f} % over the list\'s {fig / MB:g} MB: nothing of it kept '
                           '(rerun with --ok once the producer OKs the new size)'), checked
    for typ in it['types']:
        guard(lane)
        rc, out = overture(lane, [f'--types={typ}', '--no-worldcover', f'--max-mb={fig * (1 + OVER) / MB:.1f}', '--max-footer-mb=0', '--threads=3'])
        if rc == 3:
            for t in it['types']:
                purge_overture(t, keep_footers=bool(it.get('index')))
            return 'skipped', f'{typ}: over the cap at its fetch (fetch.log): nothing of it kept', checked
        if rc != 0:
            raise Fail(f'overture.py {typ}: exit {rc}: {" ".join(out[-3:])[-300:]}')
        record_overture(it, typ)
    return 'done', None, checked


def worldcover_item(it):
    lane = it['lane']
    lic, credit, note = LIC[it['lic']]
    out_rel = rel('worldcover', f'{SLUG}.tif')
    if out_rel in MANIFEST and os.path.exists(os.path.join(A, out_rel)):
        return 'done', None, {'bytes': MANIFEST[out_rel]['bytes']}
    cap = it['fig'] * (1 + OVER) / MB
    rc, out = run(lane, [PY, '-I', os.path.join(HERE, 'worldcover.py'), SLUG, f'--max-mb={cap:.1f}'],
                  {'SB_WORLDCOVER_CACHE': os.path.join(A, 'worldcover')})
    got = [ln for ln in out if 'the window reads' in ln]
    checked = {'figure': it['fig'], 'read': got[-1] if got else None}
    if rc == 3:
        return 'skipped', f'the window is over {OVER * 100:.0f} % past the list\'s {it["fig"] / MB:g} MB ({got[-1] if got else "fetch.log"}): nothing fetched', checked
    if rc != 0:
        raise Fail(f'worldcover.py: exit {rc}: {" ".join(out[-3:])[-300:]}')
    record(out_rel, it['n'], it['what'] + ': the classes over the box (+0.003 degrees), read block by block from the tiles',
           ' and '.join(it['sources']), lic, credit, note)
    save_manifest()
    return 'done', None, checked


HANDLERS = {'files': files_item, 'overture': overture_item, 'footers': footers_item, 'worldcover': worldcover_item}


def do(it):
    lane = it['lane']
    if it['kind'] == 'manual':
        set_status(it, 'skipped', it['why'])
        log(lane, f'item {it["n"]} ({it["what"]}): skipped: {it["why"]}')
        return
    for k in range(4):
        guard(lane)
        set_status(it, 'fetching')
        log(lane, f'item {it["n"]} ({it["what"]}): {"again, try " + str(k + 1) if k else "start"}')
        try:
            status, why, checked = HANDLERS[it['kind']](it)
        except Stopped:
            raise
        except Fail as e:
            log(lane, f'item {it["n"]}: failed: {e}')
            if k == 3:
                set_status(it, 'failed', str(e))
                return
            w = (120, 600, 1800)[k]
            log(lane, f'item {it["n"]}: again in {w // 60} min')
            for _ in range(w):
                guard(lane)
                time.sleep(1)
            continue
        set_status(it, status, why, checked=checked)
        log(lane, f'item {it["n"]} ({it["what"]}): {status}' + (f': {why}' if why else ''))
        return


def lane_run(lane, items):
    try:
        for it in items:
            do(it)
    except Stopped:
        log(lane, 'stopped')
    except Exception:  # noqa: BLE001 (a bug: say so, stop the lane, keep the other)
        log(lane, 'CRASHED:\n' + traceback.format_exc())


def watch():
    """Every minute: the downloads under way and C:'s free space; under 6 GB, stop."""
    last = {}
    while not STOP.wait(60):
        f = free()
        if f < MIN_FREE:
            stop('watch', f'C: has {f / 1e9:.1f} GB free, under {MIN_FREE / 1e9:.0f} GB')
            return
        with LOCK:
            act = dict(ACTIVE)
            procs = dict(PROCS)
        for lane, (relp, part, total, t0, have0) in act.items():
            have = os.path.getsize(part) if os.path.exists(part) else 0
            prev = last.get(part, have0)
            last[part] = have
            log(lane, f'  {relp}: {have / MB:.1f} of {total / MB:.1f} MB, {(have - prev) / 60e3:.0f} KB/s; C: {f / 1e9:.1f} GB free')
        own = memory(os.getpid())
        mem = [f'{lane} {tree_mb(p.pid):.0f} MB' for lane, p in procs.items()]
        log('watch', f'memory: this script {own[0] if own else 0:.0f} MB' + (', ' + ', '.join(mem) if mem else '') + f'; C: {f / 1e9:.1f} GB free')


def alive(pid):
    if os.name != 'nt':
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False
    k = ctypes.windll.kernel32
    h = k.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return False
    code = ctypes.c_ulong()
    ok = k.GetExitCodeProcess(h, ctypes.byref(code))
    k.CloseHandle(h)
    return bool(ok) and code.value == 259  # STILL_ACTIVE


def main():
    global A, LOG
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = dict((a[2:].split('=', 1) + [''])[:2] for a in sys.argv[1:] if a.startswith('--'))
    if not args:
        raise SystemExit(__doc__)
    A = os.path.abspath(args[0])
    os.makedirs(A, exist_ok=True)
    lock = os.path.join(A, 'fetch.lock')
    if os.path.exists(lock):
        try:
            pid = int(open(lock).read().split()[0])
        except (ValueError, IndexError):
            pid = 0
        if pid and pid != os.getpid() and alive(pid):
            raise SystemExit(f'fetch_archive: already running (pid {pid})')
    with open(lock, 'w') as f:
        f.write(f'{os.getpid()} {now()}\n')
    if os.name == 'nt':
        ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), 0x4000)  # BELOW_NORMAL
    LOG = open(os.path.join(A, 'fetch.log'), 'a', encoding='utf-8')
    for name in ('STOPPED.txt', 'DONE.txt'):
        if os.path.exists(os.path.join(A, name)):
            os.remove(os.path.join(A, name))
    if os.path.exists(os.path.join(A, 'manifest.json')):
        MANIFEST.update({e['path']: e for e in json.load(open(os.path.join(A, 'manifest.json'), encoding='utf-8'))['files']})
    if os.path.exists(os.path.join(A, 'status.json')):
        STATUS.update({str(e['item']): e for e in json.load(open(os.path.join(A, 'status.json'), encoding='utf-8'))['items']})
    for kv in filter(None, (flags.get('ok') or '').split(',')):
        n, mb = kv.split(':')
        for it in ITEMS:
            if it['n'] == int(n):
                log('main', f'item {n}: the producer\'s new figure, {float(mb):g} MB (was {it["fig"] / MB:g})')
                it['fig'] = float(mb) * MB
    if flags.get('footers-from'):
        dst = odir('footers')
        os.makedirs(dst, exist_ok=True)
        for name in os.listdir(flags['footers-from']):
            if name.endswith('.json') and not os.path.exists(os.path.join(dst, name)):
                shutil.copy2(os.path.join(flags['footers-from'], name), os.path.join(dst, name))
                log('main', f'footer index {name} copied from {flags["footers-from"]}')
    only = {int(x) for x in flags['only'].split(',')} if flags.get('only') else None
    items = [it for it in ITEMS if only is None or it['n'] in only]
    log('main', f'start, pid {os.getpid()}, {len(items)} items, C: {free() / 1e9:.1f} GB free')
    # the footer indexes of the ten types read live on 2026-10-23, before tonight's list: kept with the archive
    for name in sorted(os.listdir(odir('footers'))) if os.path.isdir(odir('footers')) else []:
        typ = name[:-len('.json')]
        if name.endswith('.json') and typ not in ('connector', 'place') and typ in THEME:
            n = next(it['n'] for it in ITEMS if it['kind'] == 'overture' and typ in it['types'])
            record(rel('overture', RELEASE, 'footers', name), n, f'Overture {typ}: every row group\'s bbox statistics (its footers, read '
                   'live 2026-10-23 for the bake, before this list)', 'made by tools/bake/overture.py from the footers', 'ODbL-1.0', None)
    save_manifest()
    lanes = {}
    for it in items:
        lanes.setdefault(it['lane'], []).append(it)
    w = threading.Thread(target=watch, daemon=True)
    w.start()
    ts = [threading.Thread(target=lane_run, args=(lane, its)) for lane, its in lanes.items()]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    save_manifest()
    left = [it for it in ITEMS if STATUS.get(str(it['n']), {}).get('status') not in ('done', 'skipped')]
    if only is None and not left and not STOP.is_set():
        skipped = [STATUS[str(it['n'])] for it in ITEMS if STATUS[str(it['n'])]['status'] == 'skipped']
        done = [STATUS[str(it['n'])] for it in ITEMS if STATUS[str(it['n'])]['status'] == 'done']
        lines = [f'The Bay Area\'s stage 0 archive: every item fetched or skipped, {now()}.', '',
                 f'Fetched ({len(done)}): ' + ', '.join(str(s['item']) for s in sorted(done, key=lambda s: s['item'])),
                 f'Files: {len(MANIFEST)}, {sum(e["bytes"] for e in MANIFEST.values()) / 1e9:.2f} GB (manifest.json)', '',
                 f'Skipped ({len(skipped)}):'] + [f'  {s["item"]:2d}  {s["what"]}: {s["why"]}' for s in sorted(skipped, key=lambda s: s['item'])]
        with open(os.path.join(A, 'DONE.txt'), 'w', encoding='utf-8') as f:
            f.write('\n'.join(lines) + '\n')
        log('main', 'DONE: every item fetched or skipped (DONE.txt)')
    elif only is None and not STOP.is_set():
        with open(os.path.join(A, 'STOPPED.txt'), 'w', encoding='utf-8') as f:
            f.write(f'Stopped {now()}: not every item fetched or skipped. Run the script again to go on.\n'
                    + ''.join(f'  {STATUS.get(str(it["n"]), {}).get("item", it["n"]):2d}  {it["what"]}: '
                              f'{STATUS.get(str(it["n"]), {}).get("status", "not started")}: {STATUS.get(str(it["n"]), {}).get("why")}\n' for it in left))
        log('main', 'STOPPED: some items failed every try (STOPPED.txt)')
    else:
        log('main', 'end' + (' (stopped)' if STOP.is_set() else ''))
    os.remove(lock)


if __name__ == '__main__':
    try:
        main()
    except SystemExit:
        raise
    except Exception:  # noqa: BLE001
        if LOG:
            log('main', 'CRASHED:\n' + traceback.format_exc())
        raise
