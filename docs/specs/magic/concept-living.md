# Living Paint: painted San Francisco erupts into fantastical life

Art-direction concept for Struggle Bus. My angle is living paint and magical growth.
Producer's note: "Not bad right now but way too conservative. I want explosive magical energy."

This is a proposal only. I edited no repo file and rendered nothing, because the machine is overloaded.
It is based on these files: `docs/ARCHITECTURE.md`, `DECISIONS.md`, `docs/specs/COMMON.md`,
`src/render/{PixelPipeline,materials,palette}.ts`, `src/world/{buildingMaterial,GroundPaint,terrainMaterial}.ts`,
`src/world/props/{common,sprouts,trees,landmarks}.ts`, `src/fx/Particles.ts`, `src/audio/AudioEngine.ts`,
`src/game/Splat.ts`, `src/main.ts` and `src/config.ts`. It also draws on these shots: `shots/merge1/contact.png`,
`shots/merge2/contact.png` and `shots/v6/regress/{grey,painted}.png`.

---

## 1. Diagnosis: why it reads conservative

1. **The paint only colors surfaces.** Walls, roofs and ground change color, but a painted block keeps the
   grey block's silhouette. The L3 crown is the tallest thing paint grows: an onion dome or ball spire of
   about 5 to 7 m, scaled x0.6 to x2.8. From the 175 m chase camera these read as pins on the Painted Ladies
   row (v6/regress/painted.png).
2. **Everything alive is knee-high.** Tufts are 0.85 m, bushes 1.7 m and garden trees 4.4 m. They sit on
   houses that are 10 to 12 m tall, seen from 175 m away.
3. **The magic disappears from altitude.** Sprouts cull at `propsTune.sproutCull` (1000 m) times a
   per-type factor:

   | Sprout type | Cull distance |
   |---|---|
   | Tufts, flags | 450 to 500 m |
   | Bushes | 750 m |
   | Trees | 1000 m |
   | Domes, spires | 1600 m |

   From 250 to 500 m up, the city under the view is 600 to 1500 m from the lens. A painted district
   therefore turns into flat colored rectangles (merge1 frame 5, merge2 frame 6).
4. **Nothing big moves after the pop.** Wall wobble is 0.32 m and sprout sway amplitude is 0.06 to 0.26.
   Glow is held at 0.38 on windows and 0.16 on gold, on purpose ("a soft glow, not a halo storm").
5. **Grey versus painted is only a contrast of hue, not of life.** "Grey never moves" is a great rule, but
   painted areas barely move either.

**What to change.** Change the skyline: growth should reach 2 to 4 times the height of the building it
sprouts from. Make every eruption a 1/3-second explosive gesture with a shared rhythm (section 3). Keep it
alive and reacting to the bus forever. Design every effect for three zoom levels: street, chase and vista.
Pay for it with shaders and instancing, not draw calls.

## 2. Pixel scale at 390 px (the current config)

`config.render.pixelWidth` is now 390. The 0.3 m figures in ARCHITECTURE date from the 240 px era.
Meters per game pixel = 2·d·tan(hfov/2) / 390.

| View | Distance from lens | m per game px |
|---|---|---|
| Chase lens (24°), at the bus | 175 m | 0.19 |
| Chase lens, mid-distance | 400-800 m | 0.44-0.87 |
| Vista lens (38°), at the bus | 270 m | 0.48 |
| Vista, city under the view (bus 250-500 m up) | 600-1500 m | 1.1-2.7 |

Rule of thumb: anything that must read from altitude is either at least 10 m across and 30 m tall, or it
glows. The glow pass blooms a dithered halo (`GLOW_EXTRACT_FS` takes the step-6 color × glow × (1-fog)),
and that halo survives where the shape itself is sub-pixel.

## 3. The eruption rhythm (shared by every growth effect)

`t` is the time since the element's own bloom time. For a building that is its shockwave arrival; for the
primary target it is the impact frame. Frame numbers assume 60 fps.

| Frames | t (s) | Beat | What the player sees |
|---|---|---|---|
| f0 | 0 | **Seed** | 2x2 px `GLOW_WHITE` seed sparks mark every spot where something will rise. Vines are already 6 m up (like `floodHead`). |
| f1-f5 | 0.02-0.08 | **Stab** | A thin, over-stretched shoot (y ×1.6, xz ×0.45, never under 2 px wide) spears up to 60-70% of its final height. |
| f6-f12 | 0.10-0.20 | **Swell** | Heads, caps and crystals inflate to 125%. This is timed to the building pop's stretch peak: `uBloom` pops `-squash·e^(-7k)cos(10.5k) + overshoot·e^(-5k)sin(10.5k)`, which peaks at tb ≈ 0.12 s. House and flower read as one upward blast. |
| f13-f20 | 0.22-0.33 | **Snap** | Petals and caps flick open with 20% overshoot. Cores flash glow 1.0 for 2 frames (a halo). The existing sparkle crown fires and the arpeggio note rings. |
| f21-f60 | 0.35-1.0 | **Settle** | Damped wobble (`propPop` curve). |
| after 1 s | | **Live** | Sway, breathing glow, fruit pulse. Growth tracks the bus or ducks out of its way, and creatures visit. |

- **The seed beat exists because hit-stop freezes time.** During the 4 hit-stop frames `dt = 0`, so
  `uTime` stands still. Every growth curve therefore already shows its seed state at t = 0, the frame the
  flash and hit-stop hold. The frozen frames promise the eruption.
- **Implementation:** write the rhythm once in GLSL, in `src/world/props/common.ts` next to
  `propGrow`/`propPop`, as `propErupt(t)`. It returns (scaleY, scaleXZ, open 0..1, flash 0..1).

Two standing rules for the Live beat:

- **Magic gives way to the bus.** Within about 16 m of the bus, flower heads, crown lobes and stalks bend
  away from a `uBus` uniform (bus position plus radius) in the vertex shader. The bus parts a field of
  giant flowers like a hand through tall grass and never clips one. The obstacle field therefore never has
  to rise the full height of a 40 m flower.
- **Grey never moves.** Creatures, sway and pulses exist only where paint is. The contrast becomes the
  reward.

## 4. Ranked summary

**How the score works:** score = wow² / (dev days + runtime penalty).

- Wow is squared because the producer's complaint is too little wow, not too much cost.
- The runtime penalty is 0 for no new draws, 0.5 for +1 draw per visible cell (or one global draw), and
  1.0 when a shadow caster is added on top of that.
- Items marked "+kit" depend on #3 and are scored on their incremental cost. Together, #3-5 score 35.5.
- The order follows the score, except that an add-on is listed right after the item it depends on.

| # | Effect | Triggered by | Wow | Dev days | Added draws | Added tris (typical / cap) | Score |
|---|---|---|---|---|---|---|---|
| 1 | **Vine Rush** up every wall and tower | L1-L3 (runners per level), firehose | 9 | 1.5 | 0 | 0 / 0 | **54** |
| 2 | **Paint-bird murmuration** bursting out of each blast | every blast, firehose stream | 7 | 1 | 0 (in the particle draw) | 0 | **49** |
| 3 | **Giant roof eruptions** (flowers, toadstools, lantern plants); builds the shared building kit, "the kit" | L1 (1 in 4 houses), L2, L3 | 10 | 2.5 | +1 per visible painted cell, +1 caster | 65k / 260k | 28.6 (35.5 for the #3-5 package) |
| 4 | **Crystal crowns and shards** (+kit) | L3 on buildings at least 25 m tall, firehose, sidewalks | 7 | +1 | 0 (in the kit's draw) | +10k / +40k | **49** |
| 5 | **Splat-seeded ground wonders** (+kit): every flung blob grows something | every blast (L1 included), firehose trail | 8 | +1.5 | 0 (in the kit's draw) | +25k / +130k | **42.7** |
| 6 | **Lantern fruit** on painted trees, falling and splatting | trees at L2-L3 | 5 | 0.75 | 0 | 0 | 33.3 |
| 7 | **Rainbow waterfalls** pouring off roofs | L3, towers at L2, firehose | 9 | 2 | +1 per visible cell | 10k / 26k | 32.4 |
| 8 | **Firehose beanstalk** | super-splat firehose | 9 | 2 | +1, +1 caster | 1k / 10k | 27 |
| 9 | **Floating garden islands** above the fog sea | firehose on a park, district finale | 10 | 3 | +1, +1 caster | 5k / 36k | 25 |
| 10 | **Living meadow and paint heartbeat** | L1 ground paint, settled paint | 5 | 1 | 0 | 0 | 25 |
| 11 | **Air koi and butterflies** (ambient life) | L2 and L3, waterfall pools, finale | 7 | 1.5 | +1 | 384 points | 24.5 |
| 12 | **World Tree**, the district finale | a neighborhood at least 60% painted | 10 | 3.5 | +1, +1 caster | 10k / 45k | 22.2 |

The total is about 21 dev days. Section 8 rolls up the budget and section 9 gives the build order.

---

## 5. The effects

### 1. Vine Rush: vines erupt from the street and race up every painted wall

**Trigger.** Every painted wall gets vine "runners". Each runner hashes to a level, L1, L2 or L3, so each
re-splat makes a new wave of runners surge up. The firehose fires all three levels at once.

**The moment, frame by frame.**
- f0: the color flood starts 6 m under the roof (`floodHead`), as today. At the foot of the building, every
  runner column shows a white-hot spark that has climbed 6 m.
- f1 to about 1 s: the runners race up at 45-50 m/s, wavy, in `GREEN` with leaf pairs every 1.3 m. Each tip
  is a 1.6 m `GLOW_WHITE` spark at glow 0.95, followed by 3 m of the building's hue at step 7. A dozen comets
  per facade climb while the flood pours down from the roof at 55 m/s, and on a house the two meet within
  about 0.15 s.
- On a 150 m tower, the flood and the runners meet at mid-height around 1.5 s, and the runners reach the
  crown at about 3 s.
- At L2, one leaf in four snaps into a blossom (building hue +2 or +4, glow 0.45) as the tip passes.
- At L3, one leaf in nine becomes a lantern fruit (hue +3, glow 0.6) and a "sap pulse" of glow runs up each
  vine every 3 s.

**How it lives on.** Static leaves (walls already wobble and the vines ride the wobble). At L3 the glowing
sap pulses keep climbing the towers forever. At L1 and L2 the runners skip glass so the stained glass still
glows. At L3 they overgrow it.

**At street level.** Painted Victorians are laced with green, flower-studded runners. Every blast sends a
wave of white sparks racing up a whole row of facades at once, which is the explosive energy beat.

**From 250-500 m.** At 1.1-2.7 m/px the leaves melt away, but the runners do not. Runner spacing widens to
at least 4 game px and their width to at least 1.5 px. Downtown towers become green-and-rainbow pinstriped
columns, with white sparks climbing 300 m in 3 s after a long-range shot. This is the cheapest way to make
a painted skyline read from the ceiling.

**Technique.** Edit `src/world/buildingMaterial.ts`, fragment shader only, inside the `painted && isWall`
path.
- **Data already there:** level `vPaint.g`, bloom time `vPaint.b`, the escalation flag `vPaint.a`,
  `vFacade` (f.x is meters along the facade; f.y is meters above the building's ground, the same frame the
  window rows use), the seed `bIdx`/`vMeta.z`, and `mpp` (computed before any branch).
- **Columns:** column = floor(f.x / cell) with cell = max(3.0, 4·mpp). The runner's level comes from
  h21(column, bIdx) (30% L1, 30% L2, 25% L3, 15% none).
- **Path and width:** x(y) = x0 + 0.7·sin(0.27y + φ) + 0.3·sin(0.71y + φ2). Half-width is
  max(0.35 + 0.2·level, 1.1·mpp).
- **Growth front:** runners below the current level are fully grown. Runners at the current level grow
  with front = 6 + 48·tb, so a re-splat surges new runners without regrowing the old ones (the escalation
  resets `bloomTime`). Saved paint restores with an old bloom time, so everything shows fully grown.
- **Leaves:** 0.7 × 0.45 m ellipses in facade space, only when mpp < 0.35. Above that they melt into the
  runner.
- **New uniform:** `uVine` (speed, spacing, head start, enable) goes into `paintUniforms`, read from a new
  `magicTune` registered with `registerTunables('Magic', ...)`.
- Coarse region meshes use the same material, so it works up high for free.

**Pixel art and shimmer.** All geometry of the pattern is in facade meters, so it is anchored to the world
and nothing crawls when the camera translates. Spacing and width floors driven by mpp prevent
single-pixel stripes (ARCHITECTURE: "they crawl"). The only moving edge is the growth front, which is real
motion. Element lights are constants per element, so the resolve's `flatLight` test keeps them free of
dither and calm mode rounds them cleanly.

**Perf.**

| Cost | Amount |
|---|---|
| Draws | 0 |
| Triangles | 0 |
| CPU | 0 |
| Fragment | about 40 ALU ops plus 4 hashes on painted wall pixels only; branch-coherent (flat varyings per building) |
| Estimate | +3-5% on the G-buffer pass in a painted view |
| Cap | mpp gates the detail; `magicTune.vines` set to 0 turns it off |

**Effort.** 1.5 days, including a device tuning pass.

---

### 2. Paint-bird murmuration: every blast explodes into a flock

**Trigger.** Every blast: 24 + 12·strength birds, at most 72 per blast and 600 alive. The firehose
streams 20 birds per second out of its impact.

**The moment, frame by frame.**
- f0: the birds are born 1-2 m out of the impact, so the hit-stop frames show them bursting out of the flash.
- 0-0.3 s: they burst out radially (25-45 m/s outward, 30-50 m/s up, drag) like firework shrapnel, in all
  six blast hues.
- 0.3-0.8 s: they curve onto a shared vortex ring around the impact.
- 0.8-3.2 s: a murmuration. The ring rotates as one at 1.1 rad/s. Its radius breathes between 0.7 and 1.0 ×
  the blast radius, it climbs 4 m/s from 25 m above the roofs, and it rocks (y + 6·sin(2θ + t)), so it reads
  as a swirling 3D flock rather than a disc.
- 3.2-4.5 s: they peel off tangentially, ahead of the bus, and dissolve into twinkle stars that blink out,
  reusing the sparkle blink-out.

**How it lives on.** It is transient. Birds hand off to the ambient fauna (#11) where the paint is L2 or
higher.

**At street level.** At the chase camera a 1.1 m bird is 6 px. A rainbow flock wheels over the blast and
past the lens, and the next blast launches another.

**From 250-500 m.** Bird size scales with the blast (strength is up to 2 from 300 m of drop), so birds are
2-2.5 m, or 1-2 px. The ring is 120+ m across, about 80 px: a swirling rainbow vortex of specks over the
blast, legible as a murmuration.

**Technique.** Edit `src/fx/Particles.ts`. Add a new kind `K_BIRD = 6` and a method
`flock(center, radius, hues, count, strength)`, called from main's `SplatFx.impact`.

- **Slot layout:** `aP0` = p0 and t0; `aV0` = burst velocity and life; `aP1` = vortex center and ω;
  `aV1` = (radius, climb, peel time, kind); `aExt` = (phase θ0, tilt, exit speed, –).
- **Path:** analytic, in the vertex shader, as the other kinds are. Phase 1 is ballistic with drag, phase 2
  the helix, blended with smoothstep.
- **Sprite:** new shape 3. A 5x3 px sprite draws wings-up as a V and wings-down as a ^, toggling at 9 Hz per
  seed. At 3 px it drops to 3x2. The body pixel is `GLOW_WHITE` with glow 0.4; wings are the band hue at
  step 5-6.
- **Watch out for one existing branch:** `if (kind < 0.5 || kind > 4.5)` routes kinds above 4.5 to the
  ribbon/stream path. It must become `kind < 0.5 || (kind > 4.5 && kind < 5.5)`.

**Pixel art and shimmer.** Sprites are whole game pixels and the shapes come from integer sprite-pixel
offsets. The flap is a deliberate 2-frame animation. As with all particles, flags are 0.5 (no ink outline),
depth is written and there is no shadow.

**Perf.**

| Cost | Amount |
|---|---|
| Draws | 0 (the existing Points draw) |
| Pool | 72 of 8000 slots per blast; a blast already spawns about 2.5k |
| CPU | one dirty run of about 72 slots at impact, about 0.03 ms |
| Vertex | about 40 ALU per live bird |
| Cap | `magicTune.birdsPerBlast`, plus a hard cap of 600 alive |

**Effort.** 1 day.

---

### 3. Giant roof eruptions: flowers, toadstools and lantern plants burst from roofs (the kit)

**Trigger.**

| Level | Building | What erupts |
|---|---|---|
| L1 | 1 house in 4 | a "pop flower", 5-8 m |
| L2 | every building | one wonder, sized to the roof |
| L3 | every building | 2-4 wonders |
| Firehose | buildings it hits | L3 at once |

Wonders are sized to the roof, with height ≈ clamp(0.45·sqrt(roof area), 5, 14) m on houses. A 10-12 m
Victorian gets a flower 9-14 m tall with a head 6-8 m across, so its height doubles. Towers (roofs over
600 m²) get 25-45 m flowers on their crowns.

**The moment, frame by frame.** Each wonder follows the section 3 rhythm.
- **Daisy or sunflower:** seed spark on the roof; a green spear stabs up; a bud swells; 8 flattened
  ellipsoid petals flick open around a `YELLOW` and `GLOW_WHITE` seed disc, which flashes for 2 frames; a
  sparkle crown fires.
- **Toadstool:** a fat `WHITE` stalk punches up. The cap inflates like a balloon (xz 0.3 → 1.3 → 1.0, with
  jelly squash). White spots pop on one by one, 0.03 s apart, and the gills on the underside glow at hue +3.
- **Lantern plant:** a curled stem uncoils and 6 glowing fruit pop on in sequence.
- Across a 40-building wave, 40-120 eruptions ripple outward within 0.3 s.

**How it lives on.**
- Slow sway at 0.5-0.7 Hz, with phase following world position, so a field waves like wind.
- Within 80 m of the bus, flower heads turn to face it.
- Within 16 m they bow away ("Magic gives way to the bus"), so flying low through a painted block parts a
  sea of giant flowers.
- **Super-splat charge tie-in:** a `uCharge` uniform (0..1) makes every wonder within 120 m lean toward the
  bus and brighten its cores while it charges, as if feeding it. When the torrent fires they all release a
  pollen puff. It is cheap and makes the charge feel alive.

**At street level.** A painted row stops being colored boxes and becomes a garden of houses wearing
flowers bigger than themselves. Low-sun shadows of the giant flowers rake across the streets (they cast).
That is Hopper light on Townscaper whimsy.

**From 250-500 m.**
- The cull factor rises to 2.4, so wonders stay visible to 2400 m.
- Stems inflate to at least 2 px.
- At 1.5 m/px a 12 m head is 8 px and a 40 m tower flower 27 px. The skyline changes silhouette, from boxes
  to a bouquet.
- Calm mode rounds the carved gradients into 2-3 flat bands that read like hand-pixelled spheres.

**Technique.**

New file `src/world/props/wonders.ts`, plus `sprouts.ts`:
- A new `T.WONDER` entry in `TYPES` inherits the per-cell `Batch`, `alloc`/`release`, distance cull and
  depth twin.
- `layoutRoof` places wonders by level, reserving `discs` so they don't overlap the dome or trees.

One template geometry serves every variant, the way `trees.ts` builds every species from one template:

| Part | Triangles |
|---|---|
| A bendable 6-sided tapered stem, 5 rings | 60 |
| 12 `octa0` blob slots, each carved per pixel into an exact ellipsoid | 96 |
| 5 crystal prism slots (#4) | 60 |
| **Total** | **about 216 (about 150 vertices)** |

- **Variants:** daisy, tulip, toadstool, toadstool cluster, lantern plant, crystal cluster. Each variant
  reads its slot table (center, radii, part, growth delay) from a GLSL const array, as `T_TRUNK`/`T_MASS`
  do for trees. Unused slots collapse to zero scale, so they produce no fragments.
- **Instance data:** `instanceMatrix` carries position, yaw and scale. In `instanceColor`, x = hue +
  8·variant + 0.9·seed (the same packing as the trees' kind·8 + hueSlot), y = amplitude, z = start time.
- **Vertex shader** (follows the `sproutVertex()` pattern):
  - per-part curves from `propErupt`;
  - petal centers rotate about the head center from closed (-70°) to open;
  - the stem bends as tip·s², where tip = sway + duck(`uBus`) + charge lean (`uCharge`), and the head
    follows the tip;
  - `uPxK` (meters per pixel at 1 m, which main sets each frame from `pipeline.pixelWorldSize(1)`) inflates
    stem and blob radii to at least 2 px.
- **Fragment shader:** the same ellipsoid carve as `SPROUT_FS` (with an exact `gl_FragDepth`), with part
  ramps:

  | Part | Ramp and treatment |
  |---|---|
  | Petal | building hue +2/+3/+4 (never the wall's own hue or the ground's); tip one step lighter |
  | Disc | `YELLOW`, with phyllotaxis seeds in `GLOW_WHITE`, picked by hashing the hit normal |
  | Stem, leaf | `GREEN` |
  | Cap | hue; spots in `WHITE` step 6 from spherical cells on the instance-space hit normal |
  | Gills | hue +3, glow 0.45 |
  | Stalk | `WHITE` |
  | Fruit | hue +3, glow 0.6, pulsing |

- **Obstacles:** `RoofSprouts.set` returns 0.55 × the wonder height toward `city.raiseRoof`, because the
  heads duck instead. Tower wonders over 30 m also register a post with `city.addObstacles`, so the flight
  soft-steers around them the way it does around Sutro Tower.
- **main.ts:** the `bloom` callback calls `growSprouts` only when level ≥ 2. Call it at L1 too, with a flag
  that keeps the L1 tufts hidden (today they are laid out but never shown), so only the L1 pop flower
  appears. Set `uBus` and `uCharge` every frame.

**Pixel art and shimmer.** Carved ellipsoids are exact per-pixel shapes in instance space. Cap spots are
anchored to the hit normal in instance space. Motion is slow sway, so edges step one pixel at a time. The
min-pixel inflate removes sub-2-px stems. Flags are 1.0, so ink silhouettes separate the giants from busy
ground paint. The palette stays: stalks `WHITE`, wood `VIOLET`, gold `YELLOW`. There is no brown and none
is possible.

**Perf.**

| Cost | Amount |
|---|---|
| Draws | +1 per visible 768 m sprout cell that holds a wonder (1-3 at the floor, 3-8 up high), plus the same in the sun pass |
| Triangles | about 300 visible wonders × 216 ≈ 65k, plus about 65k in the shadow pass |
| Fragment | carved blobs write `gl_FragDepth` and discard, which defeats the A15's hidden-surface removal for those pixels, as today's gardens already do; heads cover 2-6% of the screen, up to about 15% while the bus parts a flower field |
| CPU | layout at bloom time only, about 0.02 ms per building, spread across the 0.3 s wave by the bloom callback |
| Caps | `magicTune.maxWonders` 1200 city-wide (oldest evicted, as `RoofSprouts` already does at `maxBuildings`); cull 2400 m; `magicTune.wonderScale` |

`Batch.write` adds one update range per slot. Slots are allocated consecutively, so the ranges are
contiguous. If the profiler shows hundreds of `bufferSubData` calls on an escalation frame, keep one
min..max span per `Batch` per frame, the way `Particles.flush` does.

**Effort.** 2.5 days.

---

### 4. Crystal crowns and shards (+kit): a geode explodes out of the roof

**Trigger.**
- L3 on any building at least 25 m tall: a crown of 5-9 crystals, 10-40 m long, leaning outward.
- Buildings hit by the firehose.
- Small 2-5 m shards on sidewalks and plazas from the ground wonders (#5).

**The moment, frame by frame.**
- f0: the roof edge flashes with seed sparks.
- f2-f8: crystals stab up and outward like a geode bursting, each overshooting ×1.3 in y and snapping back.
- f10: every facet catches the low sun at once, with a "tink" chord tone.

**How it lives on.**
- An energy band (1.5 m, glow 0.8) pulses up each crystal every 2.4 s, so the crown charges and discharges.
- The facet that mirrors the sun toward the eye flips to `GLOW_WHITE` step 7. As the bus moves, crowns
  flash like gems.
- When the bus passes within 40 m, the crown rings with 1 frame of glow 1.0 and a chime in the current
  chord.

**At street level.** Glittering blue and violet geodes loom over the painted row. Shards edge the sidewalks.

**From 250-500 m.** Downtown towers wear 20-40 px crowns of flat facets with pulsing glow: an Emerald-City
skyline. It is the second-best altitude read, after waterfalls.

**Technique.** Use the kit's prism slots (crystal-cluster variant) with flat face normals and no carving.
- **Facets:** each facet lands on one ramp step and the resolve's `flatLight` test keeps it free of dither.
  The result is crisp pixel-art gems.
- **Ramps:** `BLUE` or `VIOLET`, or the building hue ±1, with the energy band in `GLOW_WHITE`.
- **Glint:** dot(reflect(-sun, n), view) > 0.92. It is enabled only when the facet is at least 3 px
  (crystal size / mpp), so tiny facets never twinkle.

**Perf.** It shares the kit's draw: 12 tris per prism, 108 per crown. The cap comes from
`magicTune.maxWonders`.

**Effort.** +1 day.

---

### 5. Splat-seeded ground wonders (+kit): every flung blob grows something

**Trigger.** Every blast, from L1 up:

| Ground class | What grows | Density |
|---|---|---|
| `GRASS` | flowers, toadstools, fairy rings (6-9 mushrooms in a 5 m circle), lantern plants | 9% of 8 m lattice cells |
| `SIDEWALK` | crystal shards | 4% |
| `PAVED` (streets) | nothing | – |

Streets stay clear, which keeps the "curbs stay grey, the blocks still read" review fix intact.

The firehose lays a parade route: a forced wonder every 5 m along its swept landing track, at most 150 per
torrent.

**The moment, frame by frame.**
- 0.42-1.0 s after the impact, the 64 flung blobs (`fling`, 0.42 s + 0.007 s/m) land with their existing
  splash.
- 2 frames later: a seed spark.
- Then the wonder erupts on the rhythm (spear 0.1 s, full height 0.25 s).
- Inside the splat, wonders reveal behind the shockwave at arrival(d, r) + 0.05 s, so a ring of giants rises
  outward with the wave.

**How it lives on.** The same Live rules as #3. Fairy rings glow faintly (gills).

**At street level.** Parks become meadows of 4-8 m flowers. Every blast leaves a constellation of new
growth exactly where the paint blobs landed: cause and effect the player can read.

**From 250-500 m.** Painted parks become polka-dotted, with 4-8 px heads, and fairy rings read as circles.
Golden Gate Park after a session looks like a flower bed.

**Technique.**
- **Placement comes from the ground mask, not the dot list,** so a reload regrows the identical garden with
  no new save data.
- **New hook:** `GroundPaint.onLanded(key, rect, spec, tImpact)`, called from `land()` per touched tile.
  Restore reuses the existing `onTileReady`.
- **New helper** in `wonders.ts`: it scans the touched rectangle on a jittered 8 m lattice (1024 cells per
  256 m tile) and places a wonder in a cell when all of these hold:
  - `GroundPaint.sample(x, z).cov` > 0.6;
  - the class comes from the tile's CPU class grid (the one the terrain class texture is built from; keep it
    after upload if it isn't kept, which is 16 KB per tile);
  - the cell is not within 5 m of a tree (`treeIndex`) or a footprint (`City.buildingAt`);
  - hash(cell) < the density for its class.
- **Timing:** start time = tImpact + arrival(dist, r) + 0.05 for live blasts, and -100 (already grown) for
  restored tiles.
- **Hue:** the mask's hue + 2, so a red flower never sits on red ground.
- **Batching:** instances go into the same per-cell wonder `Batch` (0 extra draws). They are cleared in
  `detach` and regrown on attach.
- **Optional ground escalation:** a mask v3 encoding (coverage 3 bits + hue 3 bits + ground level 2 bits;
  `STORE_PREFIX` becomes `strugglebus.ground.v3:` with a v2 decode path) lets a re-splatted park grow bigger
  wonders, at size × (1 + 0.4·level).

**Perf.**

| Cost | Amount |
|---|---|
| Draws | 0 extra |
| CPU | the lattice scan is about 0.05 ms per tile at land or attach (defer to one tile per frame) |
| Caps | 40 per tile, 600 ground wonders city-wide; cull 1400 m for shards and small flowers |
| Triangles | about 25k typical |

**Effort.** +1.5 days (+0.5 days if mask v3 is built).

---

### 6. Lantern fruit: painted trees hang glowing fruit that drop and splat

**Trigger.** Painted trees at L2 and L3: street trees, park trees and rooftop garden trees (through the
kit's lantern variant).

**The moment.** 0.5 s after a tree's pop, fruit pops on one by one across the crown in 0.3 s. Each piece
flashes as a `GLOW_WHITE` 2-3 px orb, then settles to hue +3 at step 6.

**How it lives on.**
- The fruit pulses (glow 0.45-0.65, 2.5 s period, phase per tree), so groves glow like lantern festivals.
- Every 0.8-2 s, a fruit on a painted tree within 120 m of the bus drops, bounces and bursts into a mini
  paint splash. Sometimes a butterfly (#11) flies out of it.

**At street level.** Painted groves glow warm and pulse. Fruit drops give the street constant small life.

**From 250-500 m.** The fruit is sub-pixel, but its glow halo is not. Painted groves read as warm glowing
clusters against the cool grey.

**Technique.**
- **`src/world/props/trees.ts`, fragment blossom block** (`dens` from `uBlossom` by level): at level ≥ 2, a
  blossom cell with hash < 0.12 (L2) or 0.2 (L3) becomes fruit:
  - radius 1.6× the blossom cell;
  - ramp `propHueRamp(hue + 3)`, light 0.82;
  - glow = 0.45 + 0.2·sin(2.5·uTime + 6.28·seed), quantized to 3 levels;
  - at LOD 1 it uses the coarse blossom grid that already exists, so it never shows single crawling pixels.
- **Fruit drops, in `main.ts`:** a timer picks a tree from `treeIndex` with `tf.paintLevel(i) >= 2` within
  120 m and calls `particles.fling(crown point, ground point, 0.55, hue + 3, 1.0)`. The existing fling
  already ends in a landing splash.

**Perf.**

| Cost | Amount |
|---|---|
| Draws | 0 |
| Fragment | a few ALU on painted crowns |
| CPU | one fling every about 1.5 s |

**Effort.** 0.75 days.

---

### 7. Rainbow waterfalls pour off the roofs

**Trigger.**

| Trigger | Falls |
|---|---|
| L3 buildings at least 8 m tall | 1 |
| Towers at least 40 m tall, from L2 | 1-3 |
| Firehose-hit towers | yes |
| World Tree boughs (#12), island rims (#9) | yes |

**The moment, frame by frame.**
- +0.25 s after the escalation pop, a glossy bulge of the building's hue swells over the roof edge.
- +0.35 s: it breaks, and the sheet unrolls downward at 45 m/s behind a fat white foam head. It shoots out
  in an arc (horizontal speed about 4 m/s) and lands in the street, not on the wall.
- It lands +0.22 s later on a house and +3.3 s later on a 150 m tower, with `particles.splash` and `burst`
  at the base.
- A pool of its hue spreads across the street.

**How it lives on.**
- Seven bands fall in rainbow order: the building hue in the center and the edges complementary, the same
  rule as the geyser ribbon, a deliberate visual rhyme with the breath.
- Foam streaks scroll down in 12 fps steps.
- The bottom 15% frays into droplets.
- Within 200 m of the bus, the base sprays 1 drop every 0.1 s.
- Koi (#11) leap out of the pools.

**At street level.** House falls arc over the sidewalk into the street, and tower falls are thundering
ribbons. Waterfalls are not obstacles: fly through one and spray crosses the lens.

**From 250-500 m.** A 150 m tower fall is a 4-8 px wide glowing ribbon, 50-100 px tall. It is the most
legible vertical signal that downtown is painted.

**Technique.**
- **Type:** a new `T.CASCADE` type in `sprouts.ts` `TYPES` (per-cell batching, no caster).
  `RoofSprouts.set` gets an optional `groundY` (main passes `ref.baseY`).
- **Template:** a 2-wide × 16-tall ribbon (64 tris) plus a carved lip blob. The instance places it at the
  roof edge (roof frame v = +hd), facing the street. Scale is (width, H = roofY - groundY, 1).
- **Vertex shader:** s runs 0..1 down the fall. Drop h = s·H. Profile out(h) = vx·sqrt(2h/g) + lip, and
  width w0·(1 + 0.5s). The fall is pinned so it never intersects the wall (the walls wobble 0.32 m; this
  sheet stays well clear).
- **Fragment shader:**
  - band = floor(u·7) → hue ramp; the sun-side band is one step lighter;
  - foam: rows anchored in world y, row = floor((worldY + floor(uTime·12)/12·speed)/0.6); hash(row, band)
    < 0.18 gives `GLOW_WHITE` step 7 with glow 0.35;
  - front: discard where roofY - worldY > 45·(uTime - start);
  - fray: discard by hash on 0.5 m world cells, with probability rising over s 0.85 → 1.
- **Pool:** a single `city.ground.blast(spec)` with a small radius at first growth. It persists through the
  mask with no new save data.

**Pixel art and shimmer.** Scrolling in 12 fps steps is the classic hand-animated pixel-art waterfall, and
no sub-pixel crawl is possible. Bands are at least 2 px (the width floor is 14·mpp). It dissolves through
discard and is never alpha.

**Perf.**

| Cost | Amount |
|---|---|
| Draws | +1 per visible painted cell |
| Triangles | 64 per fall; cap 400 falls (26k), typically 150 (10k) |
| Fragment | about 25 ALU |
| CPU | spray only (at most 6 near falls) |

**Effort.** 2 days.

---

### 8. Firehose beanstalk: the torrent grows a beanstalk into the sky

**Trigger.** The hold-to-charge super-splat firehose (10 s charge, a torrent of a few seconds, then a
cooldown of about 60 s). One beanstalk per torrent, where the torrent dwelt longest.

**The moment, frame by frame.**
- **During the torrent (0 to about 3 s):** a twisting stalk erupts from the impact and climbs at 40 m/s
  alongside the torrent stream. It spirals with a 3 m radius and half a turn every 20 m. The torrent's
  bands wrap it as spiral stripes (`GREEN` with hue stripes). Leaves the size of the bus unfurl every 12 m,
  each with a 0.2 s snap.
- **On release:** the stalk overshoots. A bud on top swells for 0.3 s, then bursts into a 30 m flower with a
  pollen shockwave (`particles.burst` + `sparkles`, bird stream), and the chord resolves.
- **Height:** min(160 m, 40 m/s × torrent time).

**How it lives on.** It sways slowly (0.15 Hz, 1.5 m at the top), its leaves flutter, its top flower tracks
the sun, and koi spiral it (#11). It is a permanent landmark of the player's own making.

**At street level.** A living tower 6 m thick dwarfs the Victorians. Flying around it, leaves sweep past
the lens.

**From 250-500 m.** 160 m plus a 30 m flower is 70-110 px tall. On the west side it pokes up through the
marine layer, whose top is 120-175 m: a flower blooming on top of the fog sea.

**Technique.**
- **New file** `src/world/props/landmarkWonders.ts`: an `InstancedMesh` with a caster.
- **Template:** a tapered hex tube with 32 rings (384 tris) whose helix centerline is computed in the
  vertex shader from instance parameters (height, twist, phase), plus 8 leaf slots and 12 flower blobs
  (kit GLSL). Rings above the growth front collapse into the bud tip.
- **Obstacle:** a post via `city.addObstacles({ x, z, r: 8, top, under: -Infinity })`, so the flight
  soft-steers around it.
- **Persistence:** in `strugglebus.magic.v1`. At most 16; the oldest wilts back into the ground over 2 s.

**Perf.**

| Cost | Amount |
|---|---|
| Draws | +1 plus 1 caster, only once one exists |
| Triangles | about 600 each |
| CPU | 0 per frame |

**Effort.** 2 days (after the kit).

---

### 9. Floating garden islands rise above the fog sea

**Trigger.** Either a firehose torrent that floods at least about 3,000 m² of `GRASS`, or the district
finale (#12), which raises 3-7 islands from the district's largest parks.

**The moment, frame by frame.**
- **0-0.4 s:** a `GLOW_WHITE` crack traces each island's outline on the painted ground. A terrain-shader
  uniform list of discs is evaluated like `sbRing`.
- **0.4 s:** the disc lurches up 1.5 m with a ring of hue-tinted puffs.
- **0.5-4.5 s:** it rises with an ease-out to its float height:
  - local fog top + 25-70 m where the marine layer is thick (using the `layerTopBase(x, z)` CPU mirror),
    so islands sit on the fog sea in the sunshine;
  - 80-140 m elsewhere.
- **Look:**
  - Underside: an inverted rock cone studded with crystals, with dangling roots, in deep `VIOLET` steps plus
    `BLUE` crystal points (rock is violet, never brown).
  - Top: turf, 3-6 garden trees, a toadstool, and one waterfall pouring off the rim that dissolves into
    droplets halfway down.
  - The hole left behind becomes a glowing pool in the terrain shader: deep hue with sparkles, read from the
    same disc uniform.

**How it lives on.** Islands bob in place (±2 m at 0.08-0.12 Hz) and turn slowly on their own axis
(1°/s). They don't drift, so their obstacle post stays exact. Long low-sun shadows sweep over the city as
they turn. Birds and koi circle them.

**At street level.** Islands overhead, with waterfalls falling from the sky and shadows passing over.

**From 250-500 m.** This is the altitude image: a ring of garden islands floating on the fog sea at the
bus's own altitude, and the player can fly among them.

**Technique.**
- **Where:** in `landmarkWonders.ts`.
- **Template:** about 900 tris: a lathe turf disc of 16 segments, a 16×4 rock cone with noise baked on the
  CPU, 6 tree blob slots, a cap and a cascade strip.
- **Instances:** one `InstancedMesh` plus a caster. Bob and spin are pure functions of time in the vertex
  shader (no per-frame CPU).
- **Obstacle:** a post with `top` = the highest bob of the crown and `under` = the lowest bob of the
  underside. Because `obstacleAt(x, z, fromY)` honors `under`, the bus can fly under an island, and a climb
  stops beneath it, exactly as under the Golden Gate deck.
- **Persistence:** in `strugglebus.magic.v1`. At most 40.

**Perf.**

| Cost | Amount |
|---|---|
| Draws | +1 plus 1 caster |
| Triangles | 900 each (36k at the cap) |
| CPU | 0 per frame |

**Effort.** 3 days.

---

### 10. Living meadow and paint heartbeat: the ground paint grows and breathes

**Trigger.**
- L1 ground paint on `GRASS` gets a flower carpet. `SIDEWALK` gets gem cobbles: every third paving cell is
  one step lighter.
- All settled paint gets the heartbeat.

**The moment.** As each texel reveals behind the shockwave (age 0.15-0.65 s, staggered by hash), pixel
flowers pop on across lawns. Each is a 2x2 px blossom at hue +2 or +4 with a 1 px `GLOW_WHITE` center
(near only). The lawn blooms in a wave right behind the ring.

**How it lives on.** About every 4 s, a soft swell of light rolls across all painted ground: one ramp step
brighter, glow 0.18, in a band about 9 m wide. The paint breathes.

**At street level.** Painted lawns read as meadows rather than flat paint, and the swell rolling under the
bus makes the ground feel alive.

**From 250-500 m.** The flowers melt into a constant lift, so there is no dither soup. The heartbeat
survives as slow bands of light crossing painted districts in calm mode (the step is crisp).

**Technique.** Edit `src/world/terrainMaterial.ts`, inside the `sbGroundPaint` branch.
- Extend `sbGroundPaint` to also return the reveal age; it already computes it for `fresh`.
- **mpp:** compute it from `dFdx`/`dFdy` of `vWorldPos` before any branch, as the building shader does.
- **Flowers:** on 1.6 m world cells, a flower when hash < 0.18 and mpp < 0.45 (a cell is at least 3.5 px).
- **Heartbeat:** v = fract(dot(wp.xz, dir)·0.004 + 1.5·sbgNoise(0.003·wp.xz) - 0.22·uTime); a band where
  v < 0.035.
- **Figure and ground:** flowers sit at most one step above the ground paint (still under the walls, per
  the "ground paint sits below the walls" review fix).

**Perf.**

| Cost | Amount |
|---|---|
| Draws | 0 |
| Triangles | 0 |
| Fragment | about 20 ALU on painted ground |

**Effort.** 1 day.

---

### 11. Air koi and butterflies: the painted city fills with life

**Trigger.**

| Paint | What appears |
|---|---|
| L2+ | butterflies around wonders, gardens and fruit drops |
| L3 | koi over Hundertwasser roofs and leaping from waterfall pools |
| Finale | cloud koi around the World Tree |

**The moment.**
- When a giant flower snaps open, a pair of butterflies bursts out of it.
- Koi leap out of a waterfall's pool, swim up the falls like salmon, and swim off into the air.

**How it lives on.**
- **Butterflies:** 0.6-0.9 m (3-5 px near) with a 2-frame wing flap, looping around flowers within 150 m of
  the bus.
- **Koi:** 3-5 m (15-25 px near), in `ORANGE` with `WHITE` patches, `RED`, or `BLUE`/`VIOLET`. They swim
  slow figure-eights 8-30 m above L3 roofs, flicking their tails, and sometimes "breach": a `GLOW_WHITE`
  ripple-ring sprite appears in mid-air where they surface, as if the air were water.
- **Cloud koi:** 20-30 m, circling the World Tree at 150-250 m.
- **Where life lives:** grey areas get none.

**At street level.** The painted city is full of life. This is where "nothing moves in grey" pays off.

**From 250-500 m.** Butterflies vanish (they are street-level detail). Koi become drifting 2-3 px specks.
Cloud koi stay at 12-17 px, legible around each World Tree.

**Technique.**
- **New file** `src/fx/Fauna.ts`: one `THREE.Points` with 384 fixed slots. They are re-homed, not a ring
  buffer.
- **Paths:** analytic per kind in the vertex shader. Butterflies use a jittery 3-frequency Lissajous around
  their anchor, with bob. Koi use a smooth figure-eight and orient the sprite along screen velocity, the
  same smear-direction code `Particles` already has.
- **Sprite shapes:**
  - butterfly: two 2x2 wing blocks that alternate wide and narrow at 9 Hz;
  - koi: a capsule body plus a 2 px forked tail that flicks, with patches from a hash of the sprite pixel
    along the body axis, so the pattern is stable;
  - cloud koi use the same shape, staying under the `maxPx` 28 cap.
- **Re-homing:** every 0.25 s, main passes painted anchors near the bus (wonder heads and L3 roof centers
  from `buildingsNear`), and Fauna re-homes at most 8 slots whose anchor is more than 250 m away, in one
  dirty range.
- **Contract:** the same as particles: `sbWrite` flags 0.5, depth written, no shadow.

**Perf.**

| Cost | Amount |
|---|---|
| Draws | +1 |
| Vertices | 384 |
| CPU | at most 0.03 ms per re-home tick |
| Cap | `magicTune.fauna` scales the active slots |

**Effort.** 1.5 days.

---

### 12. World Tree: the district finale

**Trigger.** A neighborhood reaches 60% of its buildings painted. It happens once per neighborhood; SF has
about 50.

**The moment, frame by frame.** A 6 s beat, and the player keeps control.

| Time (s) | What happens |
|---|---|
| 0.0 | The ground at the district's heart (its largest park near the neighborhood centroid) splits in a star of `GLOW_WHITE` cracks (terrain disc uniform). The music drops to a held chord. |
| 0.4 | A trunk punches up out of the ground: a y-stretch spear, 0 → 60 m in 0.6 s, twisting, with rainbow bands spiraling up `VIOLET` bark. |
| 1.0-2.5 | Roots heave out across the surrounding streets like serpents (chains of carved blobs rising out of the paint). The trunk climbs on to 140-180 m and branches flick out. |
| 2.5-3.5 | The crown explodes open: 24-30 giant carved lobes pop out from the trunk in a wave, each with 25% overshoot. Blossoms and lantern fruit appear everywhere, with a flash, a sparkle storm, and a triple murmuration (#2) bursting out of the crown. |
| 3.5-6.0 | The district's fog burns off (`bumpPaint` to full over the neighborhood: the sun breaks through, task 17). Islands (#9) tear free and rise. Cloud koi (#11) emerge from the crown. |

**How it lives on.** The crown sways slowly, fruit pulses, waterfalls (#7) pour from its boughs, and koi
circle it. Crown lobes duck from the bus like the flowers do, so you can thread the canopy.

**At street level.** A tree 10 times the height of the Victorians, with roots across the streets.

**From 250-500 m.** A 180 m tree on a hill rises out of the fog sea, visible 2-4 km away like Sutro Tower.
Every conquered district gets one, so progress is written into the skyline. At 2.5 m/px the tree is 72 px
tall with a 30 px crown.

**Technique.**
- **Where:** in `landmarkWonders.ts`.
- **Template:** about 0.9k tris: a 24-ring trunk tube (384), 30 lobe slots (240) and 6 root chains of 5
  blobs (240), plus two cascade strips.
- **Instances:** one `InstancedMesh` plus a caster for all World Trees. Growth curves run per part from the
  start time.
- **Obstacle:** the trunk is a post with r 12 m and top at the crown base.
- **Finale trigger:**
  - per-neighborhood building totals come from the bake (add `count` to `manifest.neighborhoods[i]`; this is
    a `tools/bake` change);
  - a per-neighborhood painted counter is bumped on a building's first bloom and saved in
    `strugglebus.magic.v1`, together with each finale's (hood, x, z, hue, height, seed).
- **Audio:** a new `AudioEngine.finale()` resolves the progression to the tonic with a synthesized pad and
  bells. With sound off, the visuals carry it.

**Perf.**

| Cost | Amount |
|---|---|
| Draws | +1 plus 1 caster |
| Instances | at most 50 at about 0.9k tris; 5-15 visible ≈ 10k |
| CPU | once per finale (about 0.5 ms, on that frame only) |

**Effort.** 3.5 days, including the trigger, persistence and audio.

---

## 6. Firehose and finale integration (the two big moments)

**The firehose is a growth ray**, which is the super-splat's identity from this angle.

- **While charging:** `uCharge` makes nearby wonders lean in and brighten.
- **While the torrent pours:**
  - every building it hits jumps straight to L3, so every level's vine runners race together and wonders,
    crystals and waterfalls all erupt at once;
  - a parade route of ground wonders every 5 m along the swept landing track (at most 150);
  - birds stream out at 20 per second;
  - a beanstalk grows alongside the stream.
- **On release:** the beanstalk's flower bursts. If the torrent flooded a park, islands lift off.
- **Hook:** `Splatter` exposes one `growth(x, z, strength, kind)` entry point that the firehose code calls
  per stamp. Every cap above applies per torrent and per second, so a torrent is lavish but bounded.

**The district finale** is the earned, once-per-neighborhood version: #12 plus #9 plus #11's cloud koi,
plus the fog burning off.

## 7. Shared rules (pixel art, palette, glow, persistence)

- **Contract:** every effect writes the indexed G-buffer through `sbWrite` (ramp, light, fog via
  `sbFog`, glow), with no free RGB. No change to `src/render/*` is needed.
- **Ramps used:**

  | Ramp | Used for |
  |---|---|
  | `GREEN` | foliage, vines |
  | the six hue ramps | petals, caps, birds, koi, bands |
  | `WHITE` | stalks, foam, spots |
  | `GLOW_WHITE` | seeds, cores, sparks |
  | `YELLOW` | gold, pollen |
  | `VIOLET` | wood, island rock |
  | `BLUE` | crystals, water |

  Nothing is brown, because wood and rock shadow toward violet.
- **No alpha anywhere.** Fading is dissolve by discard on world cells (0.5 m) or sprite pixels, as the
  shockwave ring and puffs already do.
- **Anchoring:** patterns live in world, facade, instance or sprite-pixel space, never screen space. Only
  motion moves pixels.
- **Minimum width of 2 game pixels:** `uPxK` (`pipeline.pixelWorldSize(1)`, set by main into module-owned
  uniforms) drives vertex inflation of stems and blobs and the mpp floors in the vine and meadow patterns.
  Detail melts into flat tones beyond the floors, the way windows already melt from the layer view.
- **Scrolling textures are animated in 12 fps steps** (waterfalls). Growth is geometric (vertex), so it has
  no texture crawl.
- **Glow budget:** glow above 0.5 only on small cores (seeds, tips, fruit, crystal bands: at most about 3%
  of painted pixels). Large surfaces stay at 0.3 or below. The glow pass is a fixed cost; this only keeps the
  halo legible instead of a "halo storm".
- **Hue rules:** growth takes building hue +2/+3/+4 and never the ground hue under it. Touching-neighbor
  rules stay with the buildings.
- **Shadows:** wonders, beanstalks, islands and World Trees cast (enable `SHADOW_LAYER` through the depth
  twins, as sprouts do). Waterfalls, particles and fauna don't.
- **Snapping:** everything here lives at city depth, so no `snapCompensation` is needed. The vista snaps at
  the city, and nothing new rides with the bus.
- **Persistence:** buildings, ground masks and the magic key.
  - Derived with no new data: vines, roof wonders, crystals, waterfalls, fruit and the meadow come from
    building paint; ground wonders come from the ground masks (optional mask v3 for ground level).
  - New: `strugglebus.magic.v1`, under 4 KB, holding beanstalks, islands, per-neighborhood painted counts
    and finales.
- **Audio hooks** (in `AudioEngine`, which the audio module owns):
  - `growth(count, size, hue)`: a woody "thoomp" plus an upward slide, folded into the existing capped
    arpeggio (6 notes, 55 ms) so the snap beats land on its notes;
  - `flock(strength)`: a flutter burst plus chirps in chord tones;
  - a waterfall noise bed scaled by nearby falls;
  - `crystalChime()`;
  - `finale()`.
  With sound off, every beat has a visual twin (seed spark, snap flash).

## 8. Budget roll-up and governor

| | Today | First sprint (#1-5, #7) | Everything |
|---|---|---|---|
| Draws, floor (Alamo Square, heavy paint) | 129 | +5 to +9 | +7 to +13 |
| Draws, 250-500 m | ~198 | +9 to +20 | +15 to +25 |
| Triangles (scene) | 1.0-1.5M | +75k typical / +300k cap | +100k / +400k cap |
| Triangles (sun pass) | – | +65k (wonder casters) | +80k |
| G-buffer fragment | – | +8-12% in painted views | +10-15% |
| CPU, average per frame | 3-5 ms work | +0.03-0.08 ms | +0.05-0.15 ms |
| CPU, impact frame | – | +0.1-0.3 ms (birds, deferred lattice scan) | same; +0.5 ms once per finale |
| Uploads | one per texture | unchanged (instance ranges merged per batch) | unchanged |

**Draws up high:** if +20 draws up high is too many, give the `WONDER` and `CASCADE` types a 1536 m cell
instead of 768 m (`CELL` per type). That roughly halves their draws up high. The sun pass already
frustum-culls casters to the 1600 m window.

**Governor:** `magicTune.quality` (0.25-1), driven from `Perf` frame-time numbers in main. A frame-time
moving average above 28 ms for 2 s steps quality down by 0.25; below 20 ms it recovers. Quality scales:
- wonder cull distance (2400 → 1200 m);
- ground-wonder density;
- active fauna slots;
- waterfall spray;
- the vine and meadow detail floors.

The structural caps above hold regardless of quality.

## 9. Build order

1. **Sprint 1, "it erupts" (about 9.5 days):** #1 Vine Rush, #2 murmuration, #3 kit plus roof eruptions,
   #4 crystals, #5 ground wonders, #7 waterfalls. This alone answers "too conservative": every blast grows a
   skyline, sends sparks up every wall and launches a flock, and it reads from the ceiling.
2. **Sprint 2, "it's alive" (about 5.25 days):** #6 lantern fruit, #10 meadow, #11 koi and butterflies,
   #8 beanstalk (with feat/supersplat).
3. **Sprint 3, "the finale" (about 6.5 days):** #9 islands, #12 World Tree plus the finale trigger (bake
   neighborhood counts, magic.v1).

Every step should end with the usual QA. Use `tools/blast.mjs perf`/`escalate`/`heavy` for draws, triangles
and work time against main. Shoot the Painted Ladies and FiDi at the chase lens and at 250 and 500 m.
Shoot a frozen strip through the 4 hit-stop frames (`__qa.holdFrames`) to check that the seed beat reads.
Run on a real iPhone before judging any perf number; SwiftShader is not a perf reference.

## 10. Risks and open questions

- **Figure and ground:** flowers twice the height of a house could bury the street plan and the aim glint.
  Mitigations: `wonderScale` is tunable; wonders never grow on the building currently glinting; flowers
  duck from the bus; streets stay clear of ground wonders.
- **Fragment cost of the ellipsoid carve on the A15:** `gl_FragDepth` plus discard on large near-camera
  heads. If it shows, carve only the head and petals (stems are plain prisms), or fall back to polygon depth
  for blobs under 6 px through a second, cheaper template.
- **Glow discipline:** the producer wants explosive, but the halo storm the team already avoided is real.
  The rule is to keep large glow transient (the 2-frame snap and the racing tips) and small glow permanent.
- **Producer calls:** Should the World Tree moment take the camera for a beat? I recommend not: keep
  control, use a 0.5 s hit-stop and let the fog lift. Should L1 already grow pop flowers? I recommend yes,
  so the first blast is explosive too.
- **Ownership:** the work touches several modules, so it needs one coordinating owner or a clear merge
  order. In order: World (`buildingMaterial.ts`, `terrainMaterial.ts`, `GroundPaint.ts`), then Props
  (`sprouts.ts`, `trees.ts`, `common.ts`, and the new `wonders.ts` and `landmarkWonders.ts`), then FX
  (`Particles.ts`, the new `Fauna.ts`), then Audio, then game glue (`main.ts`, the `Splat.ts` growth hook).
  No shared render file changes.
