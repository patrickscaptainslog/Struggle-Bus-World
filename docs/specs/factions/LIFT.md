# The Lift: the first look at the stages

Step 6's first slice (FACTIONS.md section 5). What the producer approved: "a first look at the stages: Rainbow's colours and the Lift, where houses float and you fly under them, in one neighbourhood behind a link, with stills for your phone." Rainbow's stage 4 is FACTIONS.md section 2's "4 · Liftoff": every painted house jumps and doesn't come down, each on its own rainbow geyser over a lake of paint.

## The link

| Query | What it does |
|---|---|
| `?lift` | The Lift in one neighbourhood. Off unless asked for, never on a Moon page. A Rainbow house at level 3 that a Rainbow breath hits again lifts: three breaths make a house level 3, the fourth lifts it. |
| `&lifted` | The neighbourhood staged at level 3, Rainbow, for this session only, and lifted as a wave out from its heart. |
| `&hood=<name>` | Which neighbourhood, by its name in `hoods.bin`, as the bake normalises names (case, accents and punctuation don't matter; either part of an "A / B" name counts). Default Alamo Square. A city without it takes, of the neighbourhoods with a god and 8 or more buildings a square, the one whose heart is nearest the map's middle (San Francisco without Alamo Square: Fillmore District; Amsterdam: Frederik Hendrikbuurt; London: Paddington). |
| `&slowmo=0` | No slow motion at the lift-off (decision 13), to compare. |

The bus starts at the neighbourhood's edge on the sun's side, facing in, so the houses are front-lit, and there's no Golden Gate opening. `&lat=&lon=` and `&heading=` still override the start.

## What it is

- **Where the lift lives.** In memory only (`src/world/Lift.ts`): never in the paint texel and never in a store. The GPU computes each house's motion from its crouch start, rest height and seed in `tLift`, a texture laid out like `uPaint`; the CPU runs the same function (`src/world/liftGlsl.ts`) for the flight and the aim. A reload brings every house down. `&lifted`'s paint is `PaintState.stage`, session only; a real hit afterwards saves as it always has, a level-3 record, never a lift.
- **The motion.** A 0.30 s crouch (35 cm down, a 16 % squash), a launch at 3.2 times its height a second with a 16 % stretch, a 13 % overshoot at 0.57 s, settled in about a second, then a bob of its own forever. Rest heights 15 to 50 m: small houses 38 to 50 m, big buildings 18 to 32, spread evenly by a hash so a row breaks up into houses that each jumped (the first outside look found 15 % read as one block on legs), no lifted roof over 75 m above its ground. Three in four houses leave room for a 30 m pass under them (87 % at the 15 % spread).
- **Slow motion**, at stage 4 only (decision 12 and 13): a tap's or MEGA's lift-off at 0.35x for 0.9 s of wall clock, the wave's front reaching the bus at 0.30x for 1.2 s, none again within 8 s. The firehose's lifts take none.
- **What's drawn.** The house moves in its own vertex shader, every part. Its roof's dome or spire, bunting and turf ride with it; its small growth (tufts, bushes, trees, planters) bursts off as petals at the jump, which is the triangle bound. One draw for the undersides (lit from below by the jet, a gold halo and caustics round it, paint dripping off the edges), one for the geysers (round, opening toward the belly into a mushroom of foam, a spiral of the faction's hues rushing up at 8 m/s, a splash ring at the foot), the lake in the terrain's shader (it floods 12 m past each floating house on the neighbourhood's squares, so a lifted block is one lake, yards and streets with it, rings running out from each jet), the floating shadows through a twin of each building mesh on the sun's layer (no draw added: a detailed tile there makes no caster proxy). Landmarks, bridges, tagged squares and parks never lift. Only Rainbow lifts.
- **Flight and aim.** A floating house is a deck (`src/world/LiftField.ts`): under it the floor is the ground, over it its roof. A breath from below passes under it, one from above lands on its drawn roof. A floating house is seen from below by anything under its middle, and the flight's underside counts the bellies within 16 m, so a bus pulled up under one house is let down under a lower one ahead, never put on its roof through it; the bus's body is kept out of the bellies. A house never jumps into the bus or the camera: it holds its crouch, up to 3 s, while either is over its roof; one beside it rises past. Under the houses the camera drops to the Golden Gate's low shot (longer, flatter: 120 m back at 3 degrees), and the look stays on there (under the Golden Gate it's off): the controls' ruling holds, a landing near the bus flies and one anywhere else looks.
- **Flag off**, nothing is fetched (the Lift is its own chunk, `hoods.bin` isn't asked for), no shader source differs by a byte, and every query is the code it was.

## Shortcuts and calls, surfaced

- A floating house sheds its garden's small growth as petals: the alternative is about a million triangles in Alamo Square alone.
- Per-building lifts stand in for the squares' stage 4: no five-second wait (the areas' clock, `feat/recess`), and Rainbow on Rainbow only. The areas will call `lift.start(ref, t)` when a square reaches 4.
- `&lifted` doesn't stage the streets (ground paint saves): the lakes under the houses are the ground paint.
- The sound is borrowed from existing calls.
- Parks stay on the ground, the other four factions don't lift, and there's no stage-1 mark yet (it is the areas' five-second wait made visible).
- The far field past the loaded regions still draws the neighbourhood on the ground.
- A floating house's shadow has no domes in it (its twin draws the mesh's collapsed growth as it is).

## Checks

- `node tools/factions/lift-check.mjs`: the motion, the heights on real data in three cities, the pick, the field's identity, and the real `Flight` at 120 Hz on Alamo Square with every house up: under the Painted Ladies at the floor and at a held 20 m, over the layer, in from the edge, and a pull up under the layer.
- What none of this checks: an A15, Safari on iOS (float textures read in a vertex shader there), how the slow motion feels on a phone, and the producer's eye.
