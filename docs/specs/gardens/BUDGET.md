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
2. **Out of the view, a garden isn't drawn.** "Out" means its body and its shadow are both out, with a little slack. Its shadow is a capsule from the garden down the sun's way, as long as its top's shadow can fall, off its roof and down to its building's ground, with the sun as low as the pipeline takes it (0.02) and no longer than the sun's window. It is this frame's lens, so a look behind adds what comes in before that frame renders, nearest first, up to 12,000 elements a frame (a cut from the street's back to its front at Alamo Square takes 6,000-8,000). What goes has its own 6,000 and goes after: until it's gone it only costs, so it never holds up what's coming in. A caster coming into the sun's window takes what's left of the moves in, one leaving it what's left of the moves out.
3. **Past its reach, an element isn't drawn.** The reaches are today's (`propsTune.sproutCull`: flowers 450 m, bushes 750 m, trees 1 km, domes and spires 1.6 km). An element now shrinks away over the last fifth of its reach instead of vanishing at it, so nothing pops at the edge. Both passes shrink it by its distance from the view, so its shadow goes with it.
4. **Far forms.** Past a quarter to a third of the reach (tufts and planters at 250 m, bushes at 300 m, trees at 350 m), the small growth shrinks into its own middle and the element switches to its far form. The far form has the same vertices and program and fewer triangles: a tuft keeps its leaves and two heads, both hues; a bush keeps three clumps and two blossoms; a tree keeps its trunk, three clumps and two blossoms; a planter keeps its box, its leaves and two flowers. At 250 m a head or a blossom is about two game pixels. The near form's triangles are exactly the old ones.
5. **The budget.** Over 450,000 garden triangles in both passes, every reach is held in by 1 % a frame until the total is under, down to 35 % at most. The farthest go first, by shrinking. The total counts what a frame's moves didn't get to yet, in or out. The reaches are let out again, by half a percent a frame, once the total has been under for 30 frames and what 1 % more reach would add (its elements coming in, and its far forms giving back) still fits. So the hold lets out wherever there's room, at the street after a climb too. The 450,000 is the floor's 1.5 M less the city's own 0.8-1.0 M.

The Moon draws exactly as before: every element, the old shader cull. `?lift` keeps its riding and shedding. A garden's bounds stand 130 m tall, LIFT.md's highest rest and its heave, from its house's leap on (`shed()`). Before the leap it's on its roof and only crouches, so its bounds are a roof's. (Built first, every garden under `?lift` stood 130 m tall. That drew every garden as if 65 m nearer, and the hold went down to 0.35-0.6 at the street.)

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

## After the review

The review of ae95923 found three majors, and they held against the code. After a sudden big turn the gardens newly in view were missing for one to three frames, because what went spent the frame's moves before anything came in. The hold never let out at the street once a climb had pulled it in: it waited for 85 % of the budget, and the street sits above that. And the check passed by construction. The review's low-sun shadow loss held too, from the 160 m clamp and the 0.12 floor on the sun, and so did a garden's shadow falling past its roof to the street. What changed is in "What it does now", 2 and 5, and under `?lift` above. The same run on the same laptop:

| | ae95923 | Now |
|---|---|---|
| Gardens: street / 250 m / 1 km | 0.423 / 0.449 / 0.079 M | 0.408 / 0.441 / 0.075 M |
| The hold in those views | 0.937 / 0.975 / 1 | 1 / 1 / 1 |
| Back at the street after the flight, facing the flight's last heading | stays at 0.762 | 0.786, then 0.881 within 60 frames, at 447,598 triangles: as far as there's room |
| Snaps of the lens at the street, one render each (90, 270, 180, 0, 180, 0) | 2,118 / 583 / 147 / 1,068 / 147 / 1,088 missing | none missing |
| The flight: missing, early, shadows; peak; hold | 0, 0, 0; 516,212; 0.729 | 0, 0, 0; 527,465; 0.818 |
| `?lift`, gardens at the street; hold | 0.447 M; 0.605 (fails) | 0.408 M; 1 |
| `?lift&lifted` flight, 610,501 checks of leapt gardens | not checked | 0, 0, 0; hold 0.703 at most, back to 1 at the street |

The hold is 1 in all three views, so with the budget off they draw the same. The shadow is a capsule down the sun's way now, where it was slack all round, and it reaches down to the street.

**The review's probe, re-run.** It shoots each of four headings with the cull as built (A) and with every garden in reach drawn (B), at the sun the sky-off pose has, at 0.1 and at 0.05. Ten of the twelve pairs are identical; on ae95923 none were (0.03-0.66 % of pixels). Noon at 0 degrees differs by 0.069 %: single pixels on mid-distance gardens, from the hold letting out between A and B (the probe sets the budget off and renders three frames for each). The lowest sun at 90 degrees differs by 0.010 %, a few specks on the far edge. A 90-degree snap takes 9.4 ms of `update()` and a 36 ms render with 868 kB uploaded, and leaves none missing; ae95923 took 5.5 ms, 52 ms and 520 kB and left 2,144 missing. A 180-degree snap takes 5.9 ms, 36 ms and 429 kB. In a flight `update()` takes 0.7 ms median, 1.6 ms p95 and 6.7 ms at most (it was 1.5, 2.8 and 8.4).

## Risks

- **One neighbourhood.** Every number here is Alamo Square at 1,200 level-3 roofs, under one sun. A denser city, or a city whose own triangles are over 1.0 M, meets the budget's hold sooner. The hold shrinks the far gardens first, and touches the ones round the bus only once the far ones are already gone. In the flight it held the reaches to 82 % (70 % under `?lift&lifted`): the far gardens thin out for a few seconds in a climb over a painted city. Some headings at the street need more than the budget: after the flight, facing its last heading, the hold rested at 0.88, so the small growth gives way to the far form at 220 m instead of 250 m there. The shadows reaching the street cost 8-13 % more triangles in the views than without them.
- **Uploads.** A look behind adds a few thousand elements in one frame. Each is a small buffer write, and three.js merges the contiguous ones. Nothing here has been timed on an A15. Now that nothing waits, a one-frame turn uploads more in that frame (868 kB for a 90-degree snap here). Up to 12,000 elements come in in one frame.
- **Memory.** Each garden keeps its packed elements (84 bytes each) so they can come back, about 6 MB for 1,200 level-3 gardens, beside the batches' own copies of what's drawn.
- **Pinch to zoom** (not built) narrows the lens. The reaches are in metres, as before: a zoomed lens would show the far forms bigger.
