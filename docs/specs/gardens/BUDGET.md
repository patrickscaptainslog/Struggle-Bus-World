# The gardens' budget

The rooftop gardens (`src/world/props/sprouts.ts`) are what painting grows: a level-2 roof gets a garden, a level-3 roof a Hundertwasser crown. They are part of what makes a splat feel rewarding, so near the bus they stay as rich as they were. This is how a city painted to level 3 stays under the floor (`CLAUDE.md`: 120-200 draws, 1.0-1.5 M triangles) in every view.

## What was wrong

The Recess review's M24 (`docs/reviews/recess-screen-2026-11-06.md`): at the bell, 1,146 level-3 roofs drew 4.04 M triangles. The base game has the same wall. Painting the 1,200 buildings nearest Alamo Square to level 3 (`tools/gardens/budget.mjs`) gave 3.42 M garden triangles in every view, from the street, from 250 m and from 1 km, and 70-74 ms frames on this laptop's UHD 620, against 18-26 ms without them.

It was the same number in every view because nothing was culled where it costs:

- **The shader hid what was far, and the GPU still paid for it.** An element past its reach collapsed in the vertex shader. Its vertices still ran, and its triangles still went to the GPU.
- **The cells never left the view.** Gardens were frustum-culled by 768 m cell, so a painted neighbourhood was one or two cells and always in view, with 24 degrees of lens on it.
- **The sun pass drew every caster in those cells**, wherever the sun's 520 m window was (1.03 M of the 3.42 M).

## What it does now

Each garden is drawn as far as the view can see it, and no farther. `RoofSprouts.update(camera)` runs once a frame, before the render:

1. **Batches stay dense.** An element that goes takes its triangles with it. The slot it leaves is filled from the end, and its garden is told the new slot. The sun pass draws the first part of each batch: the elements whose shadow can land in the sun's window.
2. **Out of the view, a garden isn't drawn.** "Out" means its body and its shadow are both out, with a little slack. It is this frame's lens, so a look behind adds what comes in before that frame renders, nearest first, up to 6,000 elements a frame.
3. **Past its reach, an element isn't drawn.** The reaches are today's (`propsTune.sproutCull`: flowers 450 m, bushes 750 m, trees 1 km, domes and spires 1.6 km). An element now shrinks away over the last fifth of its reach instead of vanishing at it, so nothing pops at the edge. Both passes shrink it by its distance from the view, so its shadow goes with it.
4. **Far forms.** Past a quarter to a third of the reach (tufts and planters at 250 m, bushes at 300 m, trees at 350 m), the small growth shrinks into its own middle and the element switches to its far form. The far form has the same vertices and program and fewer triangles: a tuft keeps its leaves and two heads, both hues; a bush keeps three clumps and two blossoms; a tree keeps its trunk, three clumps and two blossoms; a planter keeps its box, its leaves and two flowers. At 250 m a head or a blossom is about two game pixels. The near form's triangles are exactly the old ones.
5. **The budget.** Over 450,000 garden triangles in both passes, every reach is held in by 1 % a frame until the total is under, down to 35 % at most. The farthest go first, by shrinking. Under 85 % of the budget the reaches are let out again. The 450,000 is the floor's 1.5 M less the city's own 0.8-1.0 M.

The Moon draws exactly as before: every element, the old shader cull. `?lift` keeps its riding and shedding. A lifted garden's bounds stand 130 m tall, LIFT.md's highest rest and its heave.

## Numbers

Measured with `node tools/gardens/budget.mjs <url> <out>` on this laptop's UHD 620 (headless Edge, ANGLE D3D11, 1179 x 2556 at dpr 3). It paints the 1,200 buildings nearest Alamo Square to level 3 in the game's own store, out to 485 m. It reloads so the gardens come back through the tiles' restore. Then it holds the bus at each view, heading east over the square: at the street, over the square's middle at 33 m; 380 m west of it at 250 m; and 1,150 m west at 1 km. The garden figures are the frame with the gardens minus the frame without them, both passes. The ms figure is the median of 20 renders back to back, synced by a readback.

| View | Before: gardens | Before: frame | After: gardens | After: frame |
|---|---|---|---|---|
| Street | 48 draws, 3.416 M | 170 draws, 4.251 M, 76.6 ms | 30 draws, 0.441 M | 152 draws, 1.276 M, 31.8 ms |
| 250 m | 48 draws, 3.416 M | 162 draws, 4.218 M, 71.9 ms | 35 draws, 0.448 M | 149 draws, 1.249 M, 28.5 ms |
| 1 km | 48 draws, 3.416 M | 90 draws, 4.030 M, 70.7 ms | 8 draws, 0.079 M | 50 draws, 0.692 M, 20.8 ms |

Without the gardens, the same frames are:

| View | Draws | Triangles | Time |
|---|---|---|---|
| Street | 122 | 0.835 M | 27.3-27.6 ms |
| 250 m | 114 | 0.802 M | 23-24 ms |
| 1 km | 42 | 0.614 M | 20.7-20.8 ms |

With the budget off (`--budget=1e9`: exactly what's seen, nothing held), the gardens are 0.444 M at the street, 0.463 M at 250 m and 0.078 M at 1 km. Before the far forms they were 0.563 M and 0.641 M.

**Stills.** Both builds were shot at the same pose with the clock set to one moment, and compared (`tools/shotdiff.py`):

| View | Game pixels that differ | Share |
|---|---|---|
| Street | 13,476 | 2.0 % |
| 250 m | 11,106 | 3.3 % |
| 1 km | 1,934 | 0.33 % |

The differences are the far forms' missing small growth, single pixels past about 100 m beyond the bus, and the aim's glint on the building beside the bus, which isn't a garden.

**A flight.** The same run flies 480 frames from the street pose: a hard turn, a climbing turn the other way, a dive, and a turn. Every frame it audits each element against that frame's lens (`RoofSprouts.audit`). It found none missing, none in its far form too near, and no shadow left out. It made at most 1,129 moves in a frame. The gardens peaked at 516,000 triangles, and the reaches were held to 0.73 at most.

**Nothing painted.** `tools/shots.mjs --det --q=sky=off` gives frames identical to e0f1dde's in grey, fidi, soma, high, ceiling and opening. The two views with paint in them differ only in gardens: painted by 262 game pixels and swap by 115, from the far forms and from the bunting's draw order where flags overlap.

`budget.mjs` exits 1 when a view's garden triangles pass `--line` (450,000 by default), or when the flight finds a pop.

## Risks

- **One neighbourhood.** Every number here is Alamo Square at 1,200 level-3 roofs, under one sun. A denser city, or a city whose own triangles are over 1.0 M, meets the budget's hold sooner. The hold shrinks the far gardens first, and touches the ones round the bus only once the far ones are already gone. In the flight it held the reaches to 73 %: the far gardens thin out for a few seconds in a climb over a painted city.
- **Uploads.** A look behind adds a few thousand elements in one frame. Each is a small buffer write, and three.js merges the contiguous ones. Nothing here has been timed on an A15.
- **Memory.** Each garden keeps its packed elements (84 bytes each) so they can come back, about 6 MB for 1,200 level-3 gardens, beside the batches' own copies of what's drawn.
- **Pinch to zoom** (not built) narrows the lens. The reaches are in metres, as before: a zoomed lens would show the far forms bigger.
