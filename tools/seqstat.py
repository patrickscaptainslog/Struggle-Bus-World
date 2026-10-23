#!/usr/bin/env python3
# Usage: python3 -I tools/seqstat.py shots/altitude/seq/downtown-seq-ceiling 5   (frames prefix-0..prefix-N from tools/altitude.mjs --seq)
# residual flips over a frame sequence: seqstat.py prefix n
import sys
from importlib.machinery import SourceFileLoader
import numpy as np
sh = SourceFileLoader('sh', __file__.replace('seqstat.py', 'shimmer.py')).load_module()
import io, contextlib
pre, n = sys.argv[1], int(sys.argv[2])
vals = []
for i in range(n):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        sh.main(f'{pre}-{i}.png', f'{pre}-{i+1}.png')
    line = buf.getvalue().splitlines()[0]
    vals.append(float(line.split('residual after per-band shift ')[1].rstrip('%')))
print(f'{pre}: residual per frame ' + ' '.join(f'{v:.2f}' for v in vals) + f'  mean {np.mean(vals):.2f}%')
