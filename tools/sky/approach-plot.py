#!/usr/bin/env python3
# The destination's size on screen against time, from tools/sky/approach-check.mjs's numbers: approach-plot.py <growth.json> <out.png> [--before=<before.json>]
# Two views of one thing. Left, px against seconds, the way the eye takes it: the disc rising. Right, the same on a log scale, where a steady rate of growth is a straight line, so a stall or a jump can't hide.
# Time runs back from the end of the way in, so three speeds lie on one clock. Needs matplotlib (the bake venv has it).
import json
import sys

import matplotlib

matplotlib.use('Agg')
import matplotlib.pyplot as plt

args = sys.argv[1:]
opts = {a[2:].split('=')[0]: a.split('=', 1)[1] for a in args if a.startswith('--')}
files = [a for a in args if not a.startswith('--')]
data = json.load(open(files[0]))
out = files[1]
before = json.load(open(opts['before'])) if 'before' in opts else None

INK, MUTED, GRID, SURFACE = '#0b0b0b', '#52514e', '#e4e3df', '#fcfcfb'
SERIES = {'3000': '#2a78d6', '6000': '#eb6834', '10000': '#1baf7a'}
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10, 'axes.edgecolor': GRID, 'axes.labelcolor': MUTED, 'xtick.color': MUTED, 'ytick.color': MUTED, 'text.color': INK})


def way(rows, last, key):
    """From the view reaching the body to the end of the way in: (seconds from that end, px)."""
    end = next(i for i, r in enumerate(rows) if r['leg'] == last and i > 0 and rows[i - 1]['leg'] != last and (last != 'wait' or rows[i - 1]['leg'] != 'orbit'))
    return rows, end


def series(rows, key, start_leg, end_leg, off):
    a = next(i for i, r in enumerate(rows) if r['leg'] == start_leg)
    if end_leg == 'wait':
        leave = next(i for i, r in enumerate(rows) if r['leg'] == 'leave')
        end = next(i for i, r in enumerate(rows) if i > leave and r['leg'] == 'wait')
    else:
        end = next(i for i, r in enumerate(rows) if r['leg'] == end_leg)
    t1 = rows[end]['t']
    # the disc from when the view lands on it
    b = next(i for i, r in enumerate(rows) if i >= a and r[off] < 1)
    return [r['t'] - t1 for r in rows[b:end]], [r[key] for r in rows[b:end]]


fig, axes = plt.subplots(2, 2, figsize=(11, 8), dpi=130, facecolor=SURFACE, sharex='col', gridspec_kw={'hspace': 0.28, 'wspace': 0.2})
rowsOf = {'moon': ('moonPx', 'cruise', 'orbit', 'moonOff', 'The Moon, on the way out'), 'earth': ('earthPx', 'homeCruise', 'wait', 'earthOff', 'Earth, on the way home')}
for y, (name, (key, a, b, off, title)) in enumerate(rowsOf.items()):
    for x, log in enumerate([False, True]):
        ax = axes[y][x]
        ax.set_facecolor(SURFACE)
        ax.grid(True, color=GRID, linewidth=0.8)
        ax.set_axisbelow(True)
        for s in ('top', 'right'):
            ax.spines[s].set_visible(False)
        if before:
            rows = before['flights']['6000']
            t, px = series(rows, key, a, b, off)
            ax.plot(t, px, color='#8a8984', linewidth=1.6, linestyle='-', label='before, 6,000 km/s', zorder=1)
        for g5, rows in data['flights'].items():
            t, px = series(rows, key, a, b, off)
            ax.plot(t, px, color=SERIES[g5], linewidth=2, solid_capstyle='round', label=f'{int(g5):,} km/s', zorder=2)
        if log:
            ax.set_yscale('log')
            ax.set_ylim(8, 2400)
            ax.set_yticks([10, 15, 30, 60, 120, 250, 500, 1000, 2000])
            ax.set_yticklabels(['10', '15', '30', '60', '120', '250', '500', '1K', '2K'])
            ax.minorticks_off()
        else:
            ax.set_ylim(0, 860)
        if name == 'moon':
            ax.axhline(15, color=MUTED, linewidth=1)
            ax.text(ax.get_xlim()[1], 15 * (1.05 if log else 1) + (0 if log else 8), 'far floor 15 px ', ha='right', va='bottom', fontsize=8, color=MUTED)
        ax.axhline(data['W'], color=MUTED, linewidth=1)
        ax.text(ax.get_xlim()[0], data['W'] * (1.05 if log else 1) + (0 if log else 8), ' frame width', ha='left', va='bottom', fontsize=8, color=MUTED)
        ax.set_title(f"{title}{': log scale, steady growth is a straight line' if log else ''}", loc='left', fontsize=11, color=INK, pad=8)
        if y == 1:
            ax.set_xlabel('seconds before the end of the way in')
        if x == 0:
            ax.set_ylabel('disc across, game px')
        if y == 0 and x == 0:
            ax.legend(frameon=False, loc='upper left', title='G5', title_fontsize=9, fontsize=9)
fig.suptitle(f"Size on screen, from the view reaching the body to the end of the way in (tau {data['tau']} s, {data['iso'][:10]}, {data['W']} px wide, lens included)", x=0.07, ha='left', fontsize=12, color=INK)
fig.savefig(out, facecolor=SURFACE, bbox_inches='tight')
print('wrote', out)
