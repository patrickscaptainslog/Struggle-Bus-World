#!/usr/bin/env python3
"""qa.py's own rules on made-up input (BRIDGES.md section 4): what a city config's "qa" may set, and that the bridge
checks never stop the QA (what they all read failing makes every one NOT READ). No data and no network.

usage: python3 -I tools/bake/qacheck.py [dir]     (default: the qa.py beside it; a dir holding an older tools/bake fails)
"""
import importlib.util
import os
import sys

import numpy as np

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


# ---------------------------------------------------------------- what a city config's "qa" may set
# (key, the config's value, taken): a limit or a floor only tighter, and the same for what says how strictly a check
# measures (a reach, the share that flags a cell, the cover that makes one wooded, trees per ha); never how the city is
# cut up (the cells, WorldCover's grid), which no direction makes stricter; the report's lengths freely
OVERRIDES = [
    ('unsupportedMax', 0.5, False), ('unsupportedMax', 0.01, True),
    ('streetFigureMin', 0.5, False), ('streetFigureMin', 0.95, True),
    ('bridgeGate', 'off', False), ('bridgeGate', 'fail', True),
    ('support', 1000.0, False), ('support', 10.0, True),
    ('openCellTrees', 80, False), ('openCellTrees', 4, True),
    ('waterDiff', 0.99, False), ('waterDiff', 0.3, True),
    ('sandDiff', 0.99, False), ('sandDiff', 0.2, True),
    ('woodCover', 0.99, False), ('woodCover', 0.4, True),
    ('woodPerHa', 0.0, False), ('woodPerHa', 20.0, True),
    ('cell', 4096.0, False), ('cell', 32.0, False), ('wcRes', 40.0, False), ('wcRes', 1.0, False),
    ('worst', 100, True), ('crops', 2, True), ('cropMax', 1200.0, True),
    # (a finite real number only, as json.load reads a config's NaN, Infinity and true: every comparison with NaN is false,
    # so taken, no check could be over again)
    ('unsupportedMax', float('nan'), False), ('streetFigureMin', float('nan'), False), ('standInsMax', float('nan'), False),
    ('deckFreeEndMax', float('-inf'), False), ('streetFigureMin', float('inf'), False), ('minFlagged', True, False),
]


def overrides(qa):
    why = []
    for k, v, taken in OVERRIDES:
        Q, refused = qa.thresholds({k: v}, log=lambda *a: None)
        got = Q.get(k) is v or Q.get(k) == v  # (is: a NaN taken is never equal to itself)
        listed = any(r[0] == k for r in refused)
        if got != taken or listed == taken:
            why.append(f'{k} {v!r}: ' + ('taken' if got else 'refused') + (', listed' if listed else ', not listed') +
                       f', want {"taken" if taken else "refused and listed"}')
    return why



# ---------------------------------------------------------------- the bridge checks when what they read fails
class Boom(Exception):
    pass


class Extract:
    """the extract as bridge_checks() reads it: an empty frame, or one whose segments(), read() or bridges.py's plan()
    raises; kept: the ground's segments, osm.segments()'s [(line, kind, width, name, cls)]"""
    def __init__(self, fail, kept=()):
        self.fail = fail
        self.kept = list(kept)

    def segments(self):
        if self.fail == 'segments':
            raise Boom('segments() failed')
        return self.kept

    def read(self, typ, columns=None):
        if self.fail == 'read':
            raise Boom(f'read({typ!r}) failed')
        return None, np.array([], dtype=object)


class Baked:
    def __init__(self, landmarks=()):
        self.manifest = {'bounds': [0.0, 0.0, 256.0, 256.0], 'tileSize': 256.0, 'landmarks': list(landmarks)}


def unread(qa):
    """every failure gives the fifteen, each NOT READ saying why; nothing to read gives the fifteen NOT READ too"""
    import bridges as B
    why = []
    ground = B.Ground((0.0, 0.0, 256.0, 256.0), np.full((128, 128), B.Ground.WATER, np.uint8), 2.0, np.zeros((65, 65), np.float32), 4.0)
    Q = qa.thresholds({}, log=lambda *a: None)[0]
    plan = B.plan
    for fail in (None, 'segments', 'read', 'plan'):
        if fail == 'plan':
            def boom(*a, **k):
                raise Boom('plan() failed')
            B.plan = boom
        try:
            recs, _ = qa.bridge_checks({}, Baked(), Extract(fail), ground, Q, lambda lo, la: (lo, -la), lambda x, z: (-z, x), '.', log=lambda *a: None)
        except Exception as e:  # noqa: BLE001
            why.append(f'{fail or "an empty frame"}: raised {e!r}'[:120])
            continue
        finally:
            B.plan = plan
        if len(recs) != 15 or any(r['read'] for r in recs):
            why.append(f'{fail or "an empty frame"}: {len(recs)} checks, {sum(1 for r in recs if r["read"])} read')
        elif fail and not all('failed' in r['why'] for r in recs):
            why.append(f'{fail}: ' + ', '.join(r['key'] for r in recs if 'failed' not in r['why']) + " don't say why")
    return why



# ---------------------------------------------------------------- deckFreeEnd: a drawn deck's end over the ground
def deck_ends(qa):
    """a kept way within 12 m is why a drawn deck's end should land, never a pass: a hero's deck from (20, 128) to
    (236, 128) on flat ground at 0, a path at grade 8 m from each end (or none), its ends 30 m or 0.8 m up; and one whose
    ends are off the frame, where the ground isn't known, measures neither (no NaN). The deck's other checks read what
    they read (no towers, no plan): only deckFreeEnd's value is looked at"""
    import bridges as B
    from shapely.geometry import LineString
    why = []
    ground = B.Ground((0.0, 0.0, 256.0, 256.0), np.full((128, 128), 1, np.uint8), 2.0, np.zeros((65, 65), np.float32), 4.0)
    Q = qa.thresholds({}, log=lambda *a: None)[0]
    paths = [(LineString([(12.0, 128.0), (12.0, 250.0)]), 5, 2.8, '', 'footway'), (LineString([(244.0, 128.0), (244.0, 250.0)]), 5, 2.8, '', 'footway')]
    for top, kept, x0, want, over in ((30.0, paths, 20.0, 30.0, True), (0.8, paths, 20.0, 0.8, False), (30.0, [], 20.0, 30.0, True),
                                      (0.8, [], 20.0, 0.8, False), (30.0, [], -20.0, 0.0, False)):
        row = {'kind': 'ggb', 'deck': [[x0, 128.0, top], [128.0, 128.0, 40.0], [256.0 - x0, 128.0, top]]}
        recs, _ = qa.bridge_checks({}, Baked([row]), Extract(None, kept), ground, Q, lambda lo, la: (lo, -la), lambda x, z: (-z, x), '.',
                                   log=lambda *a: None)
        c = next(r for r in recs if r['key'] == 'deckFreeEnd')
        what = f'ends {top:g} m up' + (' off the frame' if x0 < 0 else '') + ', ' + ('a kept path at each' if kept else 'nothing by them')
        if not (c['read'] and c['value'] is not None and abs(c['value'] - want) <= 1e-3 and c['over'] == over):  # (a NaN is never within)
            why.append(f'{what}: ' + (f'{c["value"]:.2f} m, ' + ('over' if c['over'] else 'not over') if c['read'] else f'NOT READ ({c["why"]})')
                       + f', want {want:g} m, ' + ('over' if over else 'not over'))
    return why



# ---------------------------------------------------------------- bridges.py's classes: a tower over its deck
def tower_over(qa):
    """a tower's height tag is over its own ground, a deck's top is over the sea: a 300 m deck 10 m over ground at 50 m,
    a tower beside it 40 m over that ground (90 m) stands 30 m over the deck, an XL; 20 m over it (70 m) doesn't, an L;
    in the water a tower's ground is the sea's 0"""
    import bridges as B
    from shapely.geometry import LineString
    why = []
    for base, top, deck, want in ((50.0, 40.0, 60.0, 'XL'), (50.0, 20.0, 60.0, 'L'), (0.0, 227.0, 75.0, 'XL'), (0.0, 60.0, 75.0, 'L')):
        d = {'length': 300.0, 'line': LineString([(0.0, 0.0), (300.0, 0.0)]), 'y': np.full(11, deck), 'hAbove': np.full(11, deck - base),
             'tags': {}, 'waterLen': 0.0, 'waterRun': 0.0, 'uses': {'road'}}
        tws = [{'xz': np.array([150.0, 10.0]), 'top': top, 'base': base, 'n': 1, 'ids': ['w1'], 'ref': None}]
        got = B.classify(d, tws, None)
        if got != want:
            why.append(f'a tower {top:g} m over ground at {base:g} m by a deck topped at {deck:g} m: {got}, want {want}')
    return why


def joined_edges(qa):
    """two decks joined end to end cover the ground each covered, whichever ends meet: a deck along x from 0 to 100 m
    over z -2 to +8, and one 20 m on over z -5 to +1, each run either way (a deck's edges are offsets along its normal,
    which turns round when it's run backwards)"""
    import bridges as B
    from shapely.geometry import LineString
    why = []

    def deck(x0, x1, z0, z1):
        sg = 1.0 if x1 > x0 else -1.0  # (its normal: +z running east, -z running west)
        lo, hi = sorted((sg * z0, sg * z1))
        line = LineString([(x0, 0.0), (x1, 0.0)])
        return {'line': line, 's': np.array([0.0, line.length]), 'left': np.full(2, lo), 'right': np.full(2, hi), 'length': line.length,
                'members': [{'ways': []}], 'levels': {1}, 'uses': {'road'}, 'coreLevels': {1}, 'stacked': False, 'name': '', 'tags': {}}
    for ea in (0, 1):
        for eb in (0, 1):
            g0 = 120.0 if ea else -20.0           # (b's end eb meets a's end ea across 20 m)
            g1 = g0 + (100.0 if ea else -100.0)
            a = deck(0.0, 100.0, -2.0, 8.0)
            b = deck(g0, g1, -5.0, 1.0) if eb == 0 else deck(g1, g0, -5.0, 1.0)
            j = B._joined(a, ea, b, eb)
            c = np.asarray(j['line'].coords)
            sg = 1.0 if c[-1][0] > c[0][0] else -1.0
            for x, want, nm in ((50.0, (-2.0, 8.0), 'a'), ((g0 + g1) / 2, (-5.0, 1.0), 'b')):
                s = abs(x - c[0][0])
                got = tuple(sorted(sg * float(np.interp(s, j['s'], j[k])) for k in ('left', 'right')))
                if max(abs(got[0] - want[0]), abs(got[1] - want[1])) > 1e-6:
                    why.append(f'a\'s end {ea} to b\'s end {eb}: {nm} covers z {got[0]:g} to {got[1]:g}, want {want[0]:g} to {want[1]:g}')
    return why


CHECKS = [
    ("a city config's \"qa\" tightens a check, never loosens it, and never sets how the city is cut up", overrides),
    ('the bridge checks never stop the QA: what they all read failing makes the fifteen NOT READ', unread),
    ("deckFreeEnd measures a drawn deck's end over the ground, a kept way by it or not", deck_ends),
    ("a tower stands over its deck by its top over the sea, not over its own ground (bridges.py's XL)", tower_over),
    ("two decks joined end to end cover the ground each covered, either one run backwards (bridges.py's join)", joined_edges),
]


def main():
    d = sys.argv[1] if len(sys.argv) > 1 else HERE
    if d not in sys.path:
        sys.path.insert(0, d)
    qa = load(os.path.join(d, 'qa.py'), 'sb_qa_check')
    fails = 0
    for what, fn in CHECKS:
        try:
            why = fn(qa)
        except Exception as e:  # noqa: BLE001 (a rule that throws fails its check, the others still run)
            why = [f'raised {e!r}'[:200]]
        fails += bool(why)
        print(('PASS ' if not why else 'FAIL ') + what + ('' if not why else ': ' + '; '.join(why[:4])))
    print(f'{len(CHECKS) - fails} of {len(CHECKS)} pass ({d})')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
