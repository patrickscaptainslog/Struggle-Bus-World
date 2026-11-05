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
]


def overrides(qa):
    why = []
    for k, v, taken in OVERRIDES:
        Q, refused = qa.thresholds({k: v}, log=lambda *a: None)
        got = Q.get(k) == v
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
    raises"""
    def __init__(self, fail):
        self.fail = fail

    def segments(self):
        if self.fail == 'segments':
            raise Boom('segments() failed')
        return []

    def read(self, typ):
        if self.fail == 'read':
            raise Boom(f'read({typ!r}) failed')
        return None, np.array([], dtype=object)


class Baked:
    manifest = {'bounds': [0.0, 0.0, 256.0, 256.0], 'tileSize': 256.0, 'landmarks': []}


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


CHECKS = [
    ("a city config's \"qa\" tightens a check, never loosens it, and never sets how the city is cut up", overrides),
    ('the bridge checks never stop the QA: what they all read failing makes the fifteen NOT READ', unread),
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
