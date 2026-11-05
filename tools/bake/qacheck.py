#!/usr/bin/env python3
"""qa.py's own rules on made-up input (BRIDGES.md section 4): what a city config's "qa" may set. No data and no network.

usage: python3 -I tools/bake/qacheck.py [dir]     (default: the qa.py beside it; a dir holding an older tools/bake fails)
"""
import importlib.util
import os
import sys

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


CHECKS = [
    ("a city config's \"qa\" tightens a check, never loosens it, and never sets how the city is cut up", overrides),
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
