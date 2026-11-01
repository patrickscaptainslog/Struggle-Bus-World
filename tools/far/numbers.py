#!/usr/bin/env python3
# SPIKE.md section 6's numbers for one run and pose, from what the captures left: <run>/<pose>-numbers.json.
#   python -I tools/far/numbers.py <spike-far dir> <run> [<run> ...]        (runs: day2-A, day2-B, day2-B2; poses sunset, presidio, downtown)
# Reads: <run>/<pose>-report.json (tools/altitude.mjs --log-far), the --seq bursts, <run>/det (tools/shots.mjs --det --seq --pan, hold-<pose>),
# <dir>/day2-fps/*/fps.json (tools/fps.mjs, interleaved against MAIN), public/city/sf. Numbers no tool gives here are null, with the reason in `note`.
import glob
import io
import contextlib
import json
import os
import re
import subprocess
import sys
from importlib.machinery import SourceFileLoader

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
load = lambda n, p: SourceFileLoader(n, p).load_module()
sw = load('swapstat', os.path.join(HERE, 'swapstat.py'))
me = load('metrics', os.path.join(HERE, 'metrics.py'))
sh = load('shimmer', os.path.join(ROOT, 'tools', 'shimmer.py'))
# (bandflip's figure per band: `city` is the gate's, on the city's own pixels)
flips = load('bandflip', os.path.join(HERE, 'bandflip.py')).flips

base = sys.argv[1]
POSES = ['sunset', 'presidio', 'downtown']


def seqstat(pre, n=5):
    vals = []
    for i in range(n):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            sh.main(f'{pre}-{i}.png', f'{pre}-{i + 1}.png')
        vals.append(float(buf.getvalue().splitlines()[0].split('residual after per-band shift ')[1].rstrip('%')))
    return round(float(np.mean(vals)), 2)


# tools/far/pal.py's tables, its script body left out
_pal = {'__file__': os.path.join(HERE, 'pal.py')}
exec(compile(open(_pal['__file__'], encoding='utf8').read().split('for path in sys.argv[1:]:')[0], 'pal', 'exec'), _pal)


def palette(paths):
    """Share on palette, brown px, over many shots."""
    from PIL import Image
    keys, brown = _pal['keys'], np.array(sorted(_pal['brown_key']) or [-1])
    off = bro = total = 0
    for p in paths:
        a = np.asarray(Image.open(p).convert('RGB'))[1::3, 1::3].astype(np.int64)
        k = (a[..., 0] << 16) | (a[..., 1] << 8) | a[..., 2]
        off += int((~np.isin(k, keys)).sum())
        bro += int(np.isin(k, brown).sum())
        total += k.size
    return {'frames': len(paths), 'game_px': total, 'off_palette_px': off, 'brown_px': bro}


def bare(path):
    """GREY_LIGHT in rows 195-330 and its one-tone runs, % of the frame (tools/far/pal.py's measure)."""
    from PIL import Image
    g = _pal
    a = np.asarray(Image.open(path).convert('RGB'))[1::3, 1::3].astype(np.int64)
    k = (a[..., 0] << 16) | (a[..., 1] << 8) | a[..., 2]
    band = k[195:330]
    gl = np.isin(band, np.array(sorted(g['grey_light'])))
    same = np.ones_like(band, bool)
    pad = np.pad(band, ((1, 1), (3, 3)), mode='edge')
    for dy in range(-1, 2):
        for dx in range(-3, 4):
            same &= pad[1 + dy:1 + dy + band.shape[0], 3 + dx:3 + dx + band.shape[1]] == band
    return {'grey_light_pct': round(float(gl.sum() / k.size * 100), 2), 'one_tone_runs_pct': round(float((gl & same).sum() / k.size * 100), 2)}


def fps_rows(run, pose):
    names = {'day2-A': 'main*', 'day2-B2': 'b2-*', 'day2-B3': 'b3-*'}.get(run)
    if not names:
        return None
    rows = {}
    for path in sorted(glob.glob(os.path.join(base, 'day2-fps', names, 'fps.json'))):
        rep = json.load(open(path))
        s = rep['spots'].get(pose)
        if not s:
            continue
        for phase, r in s.items():
            rows.setdefault(phase, []).append({k: r[k] for k in ('fpsMedian', 'low1Median', 'frameMsMedian', 'workMsMedian', 'calls', 'triangles')})
    return rows


def panflip(pre, *args):
    """tools/far/panflip.py's three bands, percent."""
    out = subprocess.run([sys.executable, '-I', '-X', 'utf8', os.path.join(HERE, 'panflip.py'), pre, *args], capture_output=True, text=True).stdout
    return {m[0]: float(m[1]) for m in re.findall(r'(\d+-\d+) ([\d.]+)%', out.splitlines()[0])} if out else None


# where the wedge stands, per pose (the ceiling's camera from day2-A's report; the stream centre 950 m ahead of the bus): tools/far/absent.py
WEDGE = {'sunset': ('-6017.4', '2428', '90', '38', '-4855', '2428'), 'presidio': ('-4104.1', '-2038.2', '180', '38', '-4104', '-876'), 'downtown': ('-471.4', '81.3', '45', '38', '350', '-740')}


def absent(pose):
    out = subprocess.run([sys.executable, '-I', '-X', 'utf8', os.path.join(HERE, 'absent.py'), 'sf', *WEDGE[pose]], capture_output=True, text=True).stdout
    return json.loads(out) if out else None


def bytes_at_boot(with_raster):
    d = os.path.join(ROOT, 'public', 'city', 'sf')
    files = ['city.json', 'far.bin', 'horizon.bin'] + (['far16.bin'] if with_raster else [])
    return {f: os.path.getsize(os.path.join(d, f)) for f in files}


for run in sys.argv[2:]:
    d = os.path.join(base, run)
    flagged = run != 'day2-A'
    for pose in POSES:
        rep = json.load(open(os.path.join(d, f'{pose}-report.json')))
        far = {r['label']: r for r in rep.get('far', [])}
        n = {'run': run, 'pose': pose}
        st = {}
        for label, name in (('cruise', '30 m'), ('250m', '250 m'), ('ceiling', 'ceiling')):
            r = far.get(label)
            if r:
                st[name] = {k: r.get(k) for k in ('calls', 'triangles', 'workMs', 'frameMs')}
        n['draws_tris_flight'] = st
        c = far.get('ceiling', {})
        n['worker'] = {k: c.get(k) for k in ('mergeMs', 'boxes', 'roofCells', 'chunks', 'instancesSubmitted', 'boxesInView', 'boxesOnScreen')} if flagged else None
        if flagged and c.get('perChunk'):
            pc = [x[2] for x in c['perChunk']]
            n['boxes_per_chunk'] = {'min': min(pc), 'median': sorted(pc)[len(pc) // 2], 'max': max(pc)}
        n['frame'] = fps_rows(run, pose)
        n['thermal'] = None
        n['bytes_at_boot'] = bytes_at_boot(flagged)
        n['gpu_bytes'] = {'textures_computed': 'class R8 + mode mips 1.33 MB, tone + wall RG8 with mips 2.66 MB', 'box_vertex_data': 70912 * 16, 'tower_looks': 2271 * 12} if flagged else 0
        for tag in ('cruise', '250m', 'ceiling'):
            pre = os.path.join(d, f'{pose}-seq-{tag}')
            if os.path.exists(pre + '-5.png'):
                n.setdefault('seqstat_residual_pct', {})[tag] = seqstat(pre)
                n.setdefault('flight_burst_flips_pct', {})[tag] = flips(pre)
        det = os.path.join(d, 'det')
        n['same_camera_burst_flips_pct'] = flips(os.path.join(det, f'{pose}-seq'))
        n['turn_flips_pct'] = panflip(os.path.join(det, f'{pose}-pan'))
        dive = os.path.join(d, 'dive', f'{pose}-dive')
        n['dive_flips_pct'] = panflip(dive, '5', '20', '8', '12') if os.path.exists(dive + '-5.png') else None
        ceil = os.path.join(base, {'day2-A': 'day2-ceil-A', 'day2-B2': 'day2-ceil-B2'}.get(run, ''), f'{pose}-report.json')
        if os.path.exists(ceil):
            r = json.load(open(ceil))['far'][0]
            n['ceiling_flight'] = {k: r.get(k) for k in ('calls', 'triangles')}
        n['absent_in_every_form'] = absent(pose)
        cam = os.path.join(d, f'{pose}-ceiling.png')
        n['bare_far_land'] = bare(cam)
        n['bands'] = me.report(cam, ((212, 265), (265, 318), (375, 648)))
        hold = {}
        for sun in ('day', 'high', 'low', 'night'):
            a, b = os.path.join(det, f'hold-{pose}-{sun}-0.png'), os.path.join(det, f'hold-{pose}-{sun}-1.png')
            if os.path.exists(a):
                hold[sun] = sw.stats(sw.game(a), sw.game(b), 195, 375)
        n['hold_still_swap'] = hold
        frames = sorted(glob.glob(os.path.join(d, f'{pose}-*.png')) + glob.glob(os.path.join(det, f'{pose}-*.png')) + glob.glob(os.path.join(det, f'hold-{pose}-*.png')))
        n['palette'] = palette(frames)
        n['note'] = 'frame, thermal on the iPhone: no phone here. frame: this laptop UHD 620, Edge headless, tools/fps.mjs interleaved with MAIN; a 60 Hz lock hides anything under 16.7 ms.'
        path = os.path.join(d, f'{pose}-numbers.json')
        json.dump(n, open(path, 'w'), indent=1)
        print(path.replace(chr(92), '/').split('spike-far/')[-1], 'ok', n['palette'], n['same_camera_burst_flips_pct'])
