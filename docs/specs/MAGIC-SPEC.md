# MAGIC-SPEC: Wild Paint

Creative direction for the producer note *"Not bad right now but way too conservative. I want explosive magical
energy."* This spec takes the best of the three art-director concepts (`concept-living.md`, `concept-energy.md`,
`concept-spectacle.md`) and turns them into one vision, with effects, techniques, budgets, a build order and three
workstreams whose files don't collide.

It is a proposal only. No repo file was edited and nothing was rendered, because the machine is overloaded.

**Sources.** I read these files: `docs/ARCHITECTURE.md`, `DECISIONS.md`, `docs/specs/COMMON.md`,
`src/render/{PixelPipeline,materials,palette}.ts`, `src/world/{buildingMaterial,GroundPaint,terrainMaterial,City}.ts`,
`src/world/props/{common,sprouts,trees}.ts`, `src/fx/Particles.ts`, `src/audio/{AudioEngine,music}.ts`,
`src/game/{Splat,blastLayout}.ts`, `src/main.ts` and `src/config.ts`. I looked at these shots: `shots/merge1/contact.png`,
`shots/merge2/contact.png` and `shots/v6/regress/{grey,painted}.png`.

I also checked the branches that are in flight, because the plan has to merge with them:
- **feat/facade** rewrites about 675 lines of `buildingMaterial.ts`: tower glass, L2 hanging gardens, L3 wall vines and
  setback domes.
- **polish/look** touches `PixelPipeline.ts`, `materials.ts`, `terrainMaterial.ts`, `trees.ts`, `StreetSign.ts` and
  `CameraRig.ts`.
- **feat/supersplat** has uncommitted work in its worktree:
  - `SuperSplat.ts`, `SuperFx.ts`, `SuperMeter.ts` and `superSfx.ts`;
  - `Blast.hose`, `Blast.primary` and the `BLOOM_HOSE`/`BLOOM_REPOP` flags in `Splat.ts`;
  - edits to `Particles.ts`, `AudioEngine.ts` and `main.ts`.
- **feat/controls** adds `Input.onChargeStart`/`onChargeEnd`, `Tilt.ts` and `Turbo.ts`.

---

## 0. The vision

> **Paint is wild magic.** It arrives white-hot, it throws the city into the air, it grows, and it keeps a heartbeat.
> Grey San Francisco is still, overcast and quiet. Wherever paint lands:
> - the sun breaks through;
> - the houses leap;
> - a wall of rainbow surf rolls across the block;
> - a column of light punches into the sky;
> - giant flowers burst off the roofs and rainbows pour off the towers;
> - the music gains a layer.
>
> Every blast is a firework you can read from the ceiling.

Four verbs organize everything. Every blast does all four, every escalation does them bigger, and the sky is the
reward.

| Verb | Means | Effects |
|---|---|---|
| **IGNITE** | light | white-hot flood and window pop, neon ground, light pillars and beacons, sunbreak, fireworks |
| **LEAP** | motion | jelly jump, rainbow tsunami, paint-bird murmuration, money-shot slow motion |
| **GROW** | life | giant roof eruptions and crystals, rainbow waterfalls, firehose beanstalk |
| **SING** | beat | heartbeat pulse and music that builds with paint |
| **all four** | district scale | Sunburst, the district finale |

### Diagnosis (all three directors agree)

1. **Paint stays on surfaces.** Above the roofline there are only domes and spires. From 250-500 m a painted block is a
   flat quilt (merge2 panel 6).
2. **The event is shorter than a blink.** The pop takes 0.3 s, then come 4 hit-stop frames, and the only thing that
   peaks on the impact frame is the flash.
3. **Light stops at the paint's edge.** The grey house next door is pixel-identical to the unpainted city.
4. **Nothing lives after about 1 s**, and the music doesn't grow with the paint.

### The director's call: go up and out, not more detail

At street level the painted block is already dense: gardens, orbs on poles, bunting, every window its own hue
(v6/regress/painted.png). More surface detail on painted walls would turn into mush. The new magic therefore goes:

- **up:** pillars, surf walls, fireworks, giant growth, waterfalls, beacons;
- **out:** light spilling onto the grey, and the sun breaking through;
- **through time:** a white-hot peak on the impact frame, cooling into colour, then a living heartbeat.

---

## 1. One visual language

### 1.1 Palette: "paint is light that cools into colour"

- **Arrival.** Everything paint touches is born `GLOW_WHITE` step 7 (the core), then takes its hue at step 7 (the
  rim), then hue step 5 (the body). It cools to today's resting step within about 0.6 s. Cooling means stepping down
  a ramp, never moving toward grey.
- **Yellow and orange never go below step 3.** Their deep steps are rose-brick, which would read as mud.
- **Grey only ever receives light.** It gets sunbreak and halo spill, never a hue and never motion. "Grey never moves"
  stays law.
- **Glow budget:**
  - Glow above 0.6 appears only on cores, crests, tips and moments, at most about 3% of painted pixels at rest.
  - Resting surfaces stay at or below 0.55.
  - The only large-area glow is transient: the impact-frame pillar, the molten band, snap flashes.

### 1.2 Shapes: three families, nothing else

| Family | Used by | Rules |
|---|---|---|
| **The Seven-Band Ribbon** | the breath (existing), the tsunami face, pillars and beacons, waterfalls, rainbow bridges, beanstalk stripes | The geyser's rule: 7 bands, center = its hue, edges = the complementary hue. Every band is at least 2 game px, enforced in the shader from meters-per-pixel. Neighbouring bands are luminance-matched (steps 5 and 6), so 1-px edge steps don't crawl. A 1-2 px white core or crest. |
| **The Carved Blob** | giant flowers, toadstools, lantern plants, beanstalk leaves | The rooftop gardens' carved-ellipsoid vocabulary (`SPROUT_FS`), plus stretched spears for stems. Crystals are the only faceted shape in the game. |
| **The Pixel Sprite** | birds, firework heads and stars | Whole-game-pixel sprites from the particle vocabulary: blob, 4-point star, V-bird. |

Because the breath, the surf, the pillar, the waterfalls and the bridges are all the same ribbon, the whole show reads
as one material: the breath *becomes* the city's rainbows.

### 1.3 Motion: one rhythm, one clock

- **The eruption rhythm** (`sbErupt(t)` returns (scaleY, scaleXZ, open, flash)) is shared by everything that appears:

  | Beat | t (s) | What happens |
  |---|---|---|
  | Seed | 0 | 2x2 white sparks |
  | Stab | 0.02-0.08 | y ×1.6, xz ×0.45 |
  | Swell | 0.10-0.20 | to 125%, peaking with the building pop's stretch at about 0.12 s |
  | Snap | 0.22-0.33 | +20% overshoot, a 2-frame glow flash, the arpeggio note |
  | Settle | to 1.0 | damped wobble |
  | Live | after 1.0 | resting loop |

- **Peak pose on the impact frame.** Hit-stop freezes `uTime`, so every impact effect must already be at full drama
  at t = 0: the pillar fully extended, the foam crown, birds bursting out of the flash, the roof white-hot. The 4 frozen
  frames then read like a photograph of an explosion.
- **One beat clock**, `globals.uBeat` (phase, beat index, bar phase, paint energy) at 84 BPM. Everything that *lives*
  runs on it: pulse, pump, beacon breathing, resident fireworks, bridge sheen. The director ducks it to stillness
  (`uDuck`) during hit-stop and slow motion: the band plays on while the city holds its breath.
- **Motion rules:**
  - Move at least 2 game px or not at all. Amplitudes are computed in pixels and fade out below 1.5 px.
  - Scrolling patterns step: at 12 fps, or on beat subdivisions.
  - No new camera moves (polish/look owns the camera). The existing translation-only kick scales by tier.
- **Peak, then rest.** Big moments last at most 3 s. Resting loops are at most a quarter of the peak amplitude. No
  full-surface change runs faster than 2 Hz.

### 1.4 Pixel contract (applies to every effect below)

- **No alpha anywhere.** Dissolves use `sbDissolve(k)`, a Bayer 4x4 anchored to `uDitherOrigin`, the snapped grid, so
  the pattern travels with the world. Patterns live in world, facade, instance or sprite-pixel space. Beams are built in
  screen space with integer-pixel edges.
- **Indexed colour only.** All new materials write through `sbWrite(ramp, light, fog, glow, n, id, flags)`, with exact
  steps from `sbStep(k)` so flat bands never dither:
  - flags 1.0 (ink outline) for solid growth and the surf;
  - flags 0.5 for energy and sprites.
- **Snapping.** Everything new lives at city depth, so it needs no `snapCompensation`. The new sprite pool (`Celebration`)
  stays at the origin, unlike `Particles`, which carries the bus's compensation.
- **No per-building draws.** Per-building motion is vertex math on the existing tile meshes. Everything new is instanced
  or uniform-driven. Each texture gets at most one upload per frame.

---

## 2. Foundations (shared, built once)

| ID | What | Owner | Cost |
|---|---|---|---|
| **F1** | **`GLSL_MAGIC` in `src/render/materials.ts`.** New globals: `uDitherOrigin`, `uViewPx` (G-buffer W,H incl. margin), `uBeat`, `uDuck` (dance gain 0..1), `uSunbreak` (gain, sweep x, z, t0). Helpers: `sbStep(k) = (k + 0.15) / 7.0`, `sbMpp(clip)` (vertex: `2·clip.w / (projectionMatrix[1][1]·uViewPx.y)`), `sbDissolve(k)`, `sbErupt(t)`, `sbBand7(u, hue)` (the seven-band picker), `sbPaintField(wp)` (the existing `uPaintFog` sample, factored out of `sbFog`). `PixelPipeline.snap()` and `resize()` write `ditherOrigin` and view size into the globals (4 lines). | WS-1 (one additive commit, reviewed by polish/look) | 0 draws |
| **F2** | **Beat clock.** `src/audio/groove.ts` owns it: the AudioContext clock when audio is live, else a real-time fallback at the same tempo, so it works with sound off. During the super charge it follows supersplat's heartbeat (`heartInterval`). | WS-1 | ~0 |
| **F3** | **Magic director**, `src/game/Magic.ts` plus `src/game/Districts.ts`. It classifies each blast into a tier, owns cooldowns, the per-second spawn budget, the quality governor and reduced motion, and routes events to WS-1 uniforms, WS-2 spawns and WS-3 growth. It also handles persistence (`strugglebus.magic.v1:<city>`) and the time scale. | WS-3 | <0.05 ms per frame |
| **F4** | **Time scale.** In `main.ts`, right after the hit-stop branch: `dt *= magic.timeScale(realDt)`. `simTime` feeds `uTime`, particles, `Splatter`, `Flight` and `CameraRig`, so the whole world slows together. `applyKick`, supersplat's charge and cooldown timers, and `Tilt`/`Input` filters stay on `realDt`. | WS-3 | 0 |

**Tiers.** The director computes the tier from the `Blast` fields `count`, `maxLevel`, `strength`, the escalations,
the drop, and two new requested fields: `Blast.super = {kind: 'mega' | 'hose' | 'closer', charge} | null`.

| Tier | Rule |
|---|---|
| small | fewer than 12 buildings, no L3 escalation, drop under 120 m |
| big | 12+ buildings, or any escalation to L3, or a drop of 120 m+ |
| huge | 40+ buildings, or 6+ escalations to L3, or a drop of 250 m+ with 30+ buildings |
| mega | a released super charge (`kind` mega, charge ≥ `superMin`); always at least huge |
| hose | each of the firehose's 12 impacts per second (`Blast.hose`): the light path |
| closer | the firehose's closing blast (2 × `firehoseRadius`, 8 hit-stop frames) |

**Districts.** Fixed 384 m cells, about 4×6 SF blocks or about 350 lots. Each tracks:
- its painted count (bumped on first bloom) and L3 count;
- the centroid of its painted buildings (its "heart") and its dominant hue;
- its name, from `city.neighborhoodName(ref.hood)`.

A district is **lit** at 15 painted buildings, and **complete** at 60 painted with 8 at L3, or at 120 painted.

---

## 3. The escalation ladder

| Trigger | IGNITE | LEAP | GROW | SING |
|---|---|---|---|---|
| **Tap blast (L1 bloom)** | white-hot flood + window pop (#1), white-hot ground reveal + neon rims (#4), light pillar on the primary (#5), sunbreak field bump (#7) | jelly stretch (#2), rainbow tsunami (#3), paint-bird flock (#6) | meadow flowers on painted lawns (#4) | the existing chord + arpeggio; groove layers by local paint energy (#11) |
| **L2 (re-splat)** | windows re-pop at 0.6 heat | jelly + 1.5 m hop, garden rides along | one giant roof wonder per building (#8); towers ≥40 m start waterfalls (#9) | kick and bass enter once L2 is near (#11) |
| **L3 (Hundertwasser)** | a firework shell from its roof (#10); a 2× pillar if primary | jelly + twist; tsunami aftershock | 2-4 wonders + crystal crown (#8), a rainbow waterfall (#9) | glockenspiel and claps at an L3 share ≥20% (#11) |
| **Big / huge tap** | + 1 / 3 shells; kick 1.4× / 2× | huge: slow-motion money shot (#12) | – | – |
| **Mega blast** (released charge) | pillar up to 40 m wide and 1000 m tall; 3 shells | tsunami up to 70 m; 72 birds; slow-mo at charge ≥0.6 | everything in the 2.6× radius escalates | a full-chord swell |
| **Firehose** (4 s, 12 impacts/s) | a shell every 0.5 s from the landing point | tsunami train (one wave per 0.35 s); a bird stream at 20/s | every building in the swath climbs the ladder, so wonders, crystals and waterfalls erupt along it; **beanstalk** (#13) | "the drop": every layer |
| **Firehose closer** | giant pillar + 3-shell salvo | slow-mo (#12) | the beanstalk's flower bursts | slow-mo low-pass, re-entry on the downbeat |
| **District lit** (15 painted) | a beacon rises at its heart (#5); sunbreak sweep (#7) | heartbeat source: stadium wave (#11) | – | heartbeat layer |
| **District complete** | **Sunburst** (#14) | Sunburst | Sunburst | key change |

---

## 4. The set: 14 effects, ranked

- **Wow** is 1-10 (my judgement).
- **Days** are engineer-days including look-dev, QA shots and tuning.
- **Ratio** = wow per day.
- **Draws** are added draw calls: "T" = only while transient, "R" = resident.

| # | Effect | Verb | First trigger | WS | Wow | Days | Draws | Tris (typ / cap) | Ratio |
|---|---|---|---|---|---|---|---|---|---|
| 12 | **Money-shot slow motion** | LEAP | huge, mega, closer, finale | 3 (+1 audio) | 8 | 0.75 | 0 | 0 | **10.7** |
| 6 | **Paint-bird murmuration** | LEAP | every blast | 2 | 7 | 1 | +1 T (sprite pool) | 0 | **7.0** |
| 1 | **White-hot flood + window pop** | IGNITE | every bloom | 1 | 8 | 1.25 | 0 | 0 | **6.4** |
| 9 | **Rainbow waterfalls** | GROW | L3; towers at L2 | 2 | 8 | 1.25 (on the ribbon kit) | +1 R (shared with bridges) | 10k / 25k | **6.4** |
| 7 | **Sunbreak: colour returns to the city** | IGNITE | paint density; lit; finale | 1 (+ look sky) | 8 | 1.5 | 0 | 0 | **5.3** |
| 13 | **Firehose beanstalk** | GROW | firehose | 3 | 8 | 1.5 (on the kit) | +1 R, +1 caster | 2k / 7k | **5.3** |
| 10 | **Fireworks** | IGNITE | L3, big, mega, hose, lit, finale | 2 (+1 sfx) | 9 | 1.75 | 0 (sprite pool) | 0 | **5.1** |
| 3 | **Rainbow tsunami** | LEAP | every blast | 2 | 10 | 2 | +1 T | 1.6k / 4.8k | **5.0** |
| 4 | **Neon ground + meadow** | IGNITE | every blast | 1 | 6 | 1.25 | 0 | 0 | **4.8** |
| 2 | **Jelly jump** | LEAP | every bloom | 1 (+3 sprouts) | 8 | 1.75 | 0 | 0 | **4.6** |
| 5 | **Light pillars → district beacons** | IGNITE | every blast; lit | 2 | 9 | 2 | +1 (uniform-driven) | 0.25k | **4.5** |
| 14 | **Sunburst: the district finale** (+ rainbow bridges) | all | district complete | 3 + 2 | 10 | 3 | 0 new (bridges share #9's draw) | +3k | **3.3** |
| 8 | **Giant roof eruptions + crystal crowns** (the growth kit) | GROW | L2, L3 | 3 | 10 | 3.5 | +1-4 R per visible cell, + casters | 65k / 260k | **2.9** |
| 11 | **Heartbeat: music builds with paint** | SING | painted, lit | 1 | 8 | 3.5 | 0 | 0 | **2.3** |

The **total** is about 29.5 engineer-days: about 10 calendar days across three workstreams plus integration (§8).

**At the peak** (firehose or finale), the set adds **+12 draws**, against 120-200 today. The shadow pass adds **≤300k
triangles** at the cap (about 90k typical), and the sun pass adds about 70k typical. Resident CPU is about **0.1 ms**
per frame (§7).

### What we took, what we cut

| From | Kept | Cut (and why) |
|---|---|---|
| **living** | roof eruptions + crystals (the kit), waterfalls, murmuration, beanstalk, the eruption rhythm, meadow flowers, "magic gives way to the bus" | **Vine Rush:** feat/facade already owns wall vines and hanging gardens; offer them the rush timing instead. **World Tree, floating islands, koi and butterflies, ground wonders, lantern fruit:** strong, but slow or touching owned files (`trees.ts`); Phase 2 shortlist. |
| **energy** | white-hot flood + window pop, neon ground, pillars and beacons, sunbreak, heartbeat pulse, core→rim→body, peak pose at t = 0 | **Chain lightning:** a third way of making the wave visible, and supersplat already throws arcs on the bus. **Echo rings and halo crowns:** redundant with tsunami and pillar. **Aurora:** fill-heavy and breaks the Hopper sky; Phase 2. **Magic dust:** a city-wide sparkle carpet is mush. **Prism Beam / charge ring:** supersplat owns the charge, stream and meter. **Quarter-res aura:** a PixelPipeline change, optional request to polish/look. |
| **spectacle** | jelly jump, tsunami, fireworks, slow motion, beat dance (inside the heartbeat), music that builds, the director, the second sprite pool | **Confetti:** birds carry the airborne beat with a magical rather than party read. **Twister and charge inhale:** supersplat's SuperFx already spirals energy into the mouth. **Camera choreography:** polish/look owns the camera. **Marquee bulbs:** street-only, and Coney Island fights Hundertwasser; facade owns facades. **Balloons:** Phase 2. |

---

## 5. The effects

Every effect is described the same way: **Moment** (frame by frame), **Lives on**, **From altitude**, **Technique**,
**Perf and caps**, **Effort**.

**Scale at 390 px wide.**

| View | m per game px |
|---|---|
| Chase lens (175 m, 24°), at the bus | 0.19 |
| Chase lens, at the blast | ~0.28 |
| Vista (270 m, 38°), at the bus | 0.48 |
| Vista, on the city below | 1.1-2.7 |

### 1. White-hot flood + window pop (IGNITE, every bloom) · WS-1

**Moment.**
- **f0** (the impact plus the 4 hit-stop frames): the primary's top 6 m (`floodHead`) is `GLOW_WHITE` step 7 at glow
  1.0, with a 2-px molten lip at its front. The facade below is still grey.
- **0-0.6 s:** a band of liquid light, at least 2 px tall, pours down the facade at 55 m/s. The existing per-column
  drips lead it as white-hot streaks. Behind the band the hue arrives at step 7 and cools: step 6 by 0.15 s, resting by
  0.6 s.
- **Window pop:** as the band passes each window row, every pane flashes `GLOW_WHITE` for 0.1 s. It then shows its
  stained-glass hue at glow 0.9, easing to facade's resting glow (`uGlassGlow`/`uGlassGlow3`) over 1.5 s. Cells stagger
  0-0.12 s by hash (a pinball shuffle). A 15-house blast becomes about 300 windows popping in a downward wave.
- **Towers:** a molten curtain falls floor by floor for 3-4.5 s, with windows popping in its wake. It holds the screen
  long after the blast.
- **Escalations** re-pour at 0.6× heat.

**Lives on.** The resting state stays facade's. The heartbeat (#11) adds a beat band.

**From altitude.** A new rule keyed on `mpp` only: painted walls whose windows are under 2 px take a flat glow of
0.3 (L1) to 0.45 (L3). A painted district then reads from 500 m as a glowing block whose halo spills +2 steps onto the
grey around it. On a tower, the descending molten band stays a 1-2 px white line.

**Technique.** New file `src/world/magicSurface.ts`:
- **The function.** `GLSL_MAGIC_WALL` holds
  `void magicWall(in MagicWallIn m, inout float rampId, inout float light, inout float glow)`.
- **Inputs:** `painted`, `level`, `tb`, `hd = roofY - vYRest`, `drip`, `isGlass`, `cellHash`, `mpp`, `restGlow`.
  feat/facade passes these at **one call site** just before its `sbWrite`.
- **Core math:**
  `front = uBloom.w·max(tb,0) + uFloodHead - drip - hd`
  `molten = painted && front < max(1.6, 2·mpp)`
  `heat = exp(-front / (0.25·uBloom.w))`
  `pop = tb - (hd - uFloodHead) / uBloom.w`
- **Output by part:**

  | Part | Output |
  |---|---|
  | Molten band | `GLOW_WHITE`, `sbStep(7)`, glow 1 |
  | Wall | `light = mix(light, sbStep(7), 0.8·heat)` and `glow = max(glow, 0.5·heat)` |
  | Glass | `GLOW_WHITE` while 0 ≤ pop < 0.1; then `glow = mix(restGlow, 0.95, exp(-1.5·pop))` |

- **Uniforms:** `magicSurfaceUniforms.uMagicWall` (cooling time constant, pop length, altitude glow at L1/L3, enable),
  spread into the building material.
- **Coarse regions** share the material, so altitude gets the effect for free.

**Perf and caps.**

| Cost | Amount |
|---|---|
| Draws, tris, uploads, CPU | 0 |
| Fragment | about 20 ALU, on painted wall pixels only; branch-coherent (flat per-building varyings); under 0.2 ms on an A15 at 390×849 |
| Cap | resting glow ≤ 0.55 at L1-L2, so only molten and pop pixels cross the resolve's 0.42 tint threshold, and only briefly |

**Effort.** 1.25 d, including 0.25 d agreeing the call site with feat/facade.

### 2. Jelly jump (LEAP, every bloom) · WS-1 (WS-3 makes the gardens ride along)

**Moment.** Each building moves at its own arrival time, so the jumps ripple outward with the wave.

| Building | Motion | Today |
|---|---|---|
| **L1 house** | 2 frames of anticipation squash to 0.80, a stretch to 1.28 (capped at +4 m), a landing at 0.86, then two decaying wobbles over 0.9 s | the pop goes 0.82 → 1.13 |
| **L2** | the same, plus a **1.5 m hop** (0.42 s airborne). The sun pass uses `MeshDepthMaterial`, so the shadow stays on the street and sells the jump. The rooftop garden rides along. | – |
| **L3** | the hop, plus a **twist**: the top rotates ±12° and rings down, and the domes swing with it | – |
| **Towers ≥35 m** | no hop. The shockwave **whips** them: the top bends away from the impact by up to 4% of the height, then springs back through three oscillations. Downtown sways in sequence like grass in a gust. | – |

With #3, the surf crest arrives at the same `arrival()` time, so the houses rise like buoys on the wave.

**From altitude.** House motion fades out through the 1.5-px gate. Tower whips (4-8 m at the top, 2-6 px) are the
altitude read.

**Technique.**
- **The function:** `GLSL_JELLY` in `magicSurface.ts` holds
  `vec4 magicJelly(float tb, float level, float hgt, float mpp)`, returning (sy, hop, lean, twist).
- **At facade's vertex call site:** it replaces today's pop math (`sy`, `sxz` about `aBld.z`, center `aBld.yw`) and
  adds `hop` to y. `lean` shears along `normalize(c - uBlastRing.xy)`; add `uBlastRing` to the vertex stage. `twist`
  rotates `p.xz - c` and `n` by `twist·h01`.
- **Towers stay whole:** all parts of a tower share one paint texel, center and ground, so tiers never crack.
- **Tunables:** `uJump` = (stretch 0.28, cap 4 m, hop 1.5 m, whip 0.04) in `registerTunables('Magic jelly', ...)`.
- **Gardens (WS-3):** sprouts get an `aBld` instance attribute (paint index, ground y, center x, z) and call
  `magicJelly`, so a garden rides its building's hop and twist exactly. Today `sproutDelay` waits the pop out.

**Perf and caps.**
- About 25 vertex ALU, only on vertices with `tb < 1.6 s`. 0 draws.
- **Flight clearance:** stretch and hop are capped in meters. `tools/feel-sim` clearance runs, with the jelly
  displacement added to the rendered-surface raster, must stay at 0 frames inside geometry.

**Effort.** 1.25 d, plus 0.5 d in WS-3 for the gardens.

### 3. Rainbow tsunami (LEAP, every blast) · WS-2

**Moment.** The ring follows `R(1 - e^(-age·v/R))` with R = 1.65 r, which is 99 m for a base blast, and v = 300 m/s.
This is the same curve as `sbRing` and `arrival()`.

- **f0 plus hit-stop:** a frozen crown of `GLOW_WHITE` foam, 2-3 m tall, all around the impact.
- **0-0.14 s:** a wall of paint shoots out with the shockwave. Its height is H = 0.32·r: 19 m on a base blast, about 1.5
  Victorians.
  - **Bands up the face:** hue steps 3/4/5, then a hue+1 stripe, then a 2-px white crest.
  - **Each sector of the wall is the hue the ground behind it becomes** (the same pinwheel as `GroundPaint.rows()`,
    `floor(u·6 + 0.5)` with the spec's twist). Grey stays ahead of the wave and painted ground is left behind: the wave
    visibly *deposits* the rainbow.
- **0.14-0.76 s:** it decelerates like a breaker.
  - Houses jump (#2) exactly as the crest passes them.
  - The crest **curls forward** by 0.35·H and pitches down.
  - Grey dust puffs kick out just ahead of the face.
- **0.76-1.16 s:** it **breaks**. The lip tips over, the wall dissolves top-down into anchored pixels, and the crest
  throws spray drops in sector hues.
- **Framing rule:** the half of the ring facing the camera is only 40% as tall. You see the tall far wall in full, the
  near wall never buries the bus or hides the blooms, and the wave "rolls away from you".
- **Variants:**

  | Blast | Wave |
  |---|---|
  | Each L3 escalation in the blast | one aftershock at +0.25 s, at a third of the height (if a slot is free) |
  | Mega | H = 0.32·r, up to the 70 m cap (r up to 2.6×) |
  | Firehose | a **train**: a wave every 0.35 s along the moving landing point at 0.75·H, at most 3 live |

**From altitude.** It looks like a stone dropped into a pond of rainbow. A 300 m-drop ring is about 400 m across with a
38 m wall: about 260 px wide and 15-35 px tall at 1.2-2.5 m/px. The crest is `max(1.5 m, 2.5·mpp)` thick, so it reads
from the ceiling.

**Technique.** New file `src/fx/magic/PaintWave.ts`.

- **Geometry:** an `InstancedBufferGeometry` ring strip of 160 segments × 5 rows (base, three bands, lip), 1.6k triangles.
  At most 3 instances means **1 draw** and at most 4.8k triangles.
- **Per-instance data:** `aWave0` = (cx, cz, t0, R) and `aWave1` = (hue, twist, H, LUT row).
- **Ground on hills:** a 160×48 R32F `DataTexture` (nearest, `texelFetch`) holds ground height for 160 angles × 16 radii
  per wave, for 3 waves. The CPU fills it **progressively, one radius ring per frame** (160 `city.groundAt` calls). It
  completes in 16 frames, always ahead of the front: at 0.27 s the front is at 0.56 R, ring 9 of 16. There is **one
  `uploadRect` per frame**: the rows touched that frame.
- **Vertex shader:**
  - `k = 1 - exp(-age·v/R)`
  - `H(k) = H·smoothstep(0, .25, k)·(1 - smoothstep(.82, .97, k))·mix(1, .4, smoothstep(.2, .7, face))`
  - curl = `smoothstep(.55, .9, k)·row`
  - the base comes from the LUT (two `texelFetch` calls and a lerp across radius).
- **Fragment shader:**
  - the sector hue matches the ground pinwheel;
  - exact steps from `sbStep`, with the sun-facing side one step up and back faces one step down;
  - glow 0.2 on the body and 0.9 on the crest;
  - `sbWrite(..., flags 1.0)`, so the wall gets an ink silhouette (cel surf);
  - top-down `sbDissolve` death;
  - `DoubleSide`, depth write, drawn after the opaque city, `fogMul` 0.5, not in `SHADOW_LAYER`.
- **Spray and dust** use existing APIs only: `particles.splash` at 48 crest points at k ≈ 0.85, and `particles.puff` ×24
  at the face at t = 0.05 s. `Particles.ts` is not edited (supersplat and polish/look already touch it).

**Perf and caps.**

| Cost | Amount |
|---|---|
| Draws | 1 while a wave lives (1.2 s per blast) |
| Triangles | ≤4.8k |
| Fragment | the wall covers at most about 30% of the frame for about 1 s, at about 40 ALU, with no fragment texture reads: under 0.3 ms on an A15 |
| CPU | about 0.01 ms per wave per frame (the LUT ring) |
| Caps | 3 live waves; H ≤ 70 m; aftershocks only when a slot is free |

**Effort.** 2 d, including 0.5 d for the shared ribbon kit (`src/fx/magic/ribbonGlsl.ts`: band picker, screen-space
integer strip expansion, anchored dissolve).

### 4. Neon ground + meadow (IGNITE, every blast) · WS-1

**Moment.**
- **White-hot reveal.** As the shockwave reveals texels (the existing per-texel reveal age), each is born `GLOW_WHITE`
  (0-0.06 s), turns hue step 7 (to 0.25 s), then cools to its resting level by 0.8 s. The ring's wake is a white-hot
  disk turning into rainbow. Flung blobs land as white-hot dots that cool the same way.
- **Meadow.** On `GRASS`, pixel flowers pop on in a wave right behind the ring. Each is a 2×2 blossom at hue +2 or +4
  with a 1-px `GLOW_WHITE` center, on 1.6 m world cells, only where `mpp < 0.45`.

**Lives on.**
- **Neon rims:** the existing dark rim pixel (`pEdge < 0.07`) stays as the outline, with a bright 1-2 px line of hue
  step 6 at glow 0.3 just inside it. That is dark outline plus bright core, classic pixel-art neon, and the splat
  shapes become glowing territory borders.
- The heartbeat (#11) runs through the rims.
- **Figure and ground are preserved.** The body stays two steps under the walls (the review fix), curbs stay grey, and
  flowers sit at most one step above the paint.

**From altitude.** Rims become 1-px bright contours around every splat, so the edge glows instead of reading as a flat
sticker. Flowers melt into the flat body.

**Technique.**
- `GLSL_GROUND_PAINT` in `src/world/GroundPaint.ts` returns two more outputs: `rim` and the reveal `age`, which it
  already computes for `fresh`.
- `terrainMaterial.ts`'s paint branch uses them. `fresh` becomes the piecewise white → step 7 → rest curve.
- `mpp` is taken from `dFdx`/`dFdy` of `vWorldPos` before any branch.
- Settled texels (`age = 100`) skip all of it.
- The mask format is unchanged.

**Perf and caps.** About 25 ALU on painted-ground fragments only. 0 draws, 0 uploads.

**Effort.** 1.25 d.

### 5. Light pillars → district beacons (IGNITE, every blast; district lit) · WS-2

**Moment (transient pillar, on the primary of every non-hose blast).**

| Time (s) | What the player sees |
|---|---|
| f0 (held) | A white-hot column about 10 m wide (about 35 px at 260 m) stands **fully extended** from the roof past the top of the portrait frame. It is the single most explosive frame in the game. |
| 0.05-0.3 | It narrows to 6 m and splits into the seven-band ribbon: a 2-px white core, hue step 7, then the rainbow fanning out at step 5. "Energy slugs" (4 m segments at step 7) race up it at 420 m/s. |
| 0.3-2.0 | The band order rotates (a barber pole), and the slugs keep coming. |
| 2.0-2.6 | The base detaches and the whole column launches upward out of frame at 600 m/s, leaving a ring of sparkles on the roof (`particles.sparkles`). |

**Sizes.**

| Blast | Width | Height |
|---|---|---|
| Base | 10 m | 300 m × (1 + 0.65·strength), up to about 700 m from a 300 m drop |
| L3 primary | 2× | – |
| Mega | up to 40 m | ×(1 + 1.5·charge) |
| Firehose closer | 30 m | – |
| Hose impacts | none: the stream itself is the column | – |

**Lives on (beacons).**
- **When a district is lit,** a beacon rises at its heart: 8 m wide with a floor of 3 px, so it never gets thinner than
  3 px. It is 800 m tall, in the district's hue with a white core. It breathes by 1 px on the beat and a slug climbs it
  every bar.
- **When the district is complete,** the beacon turns gold: `YELLOW` steps 5-7 with a white core, 16 m wide and
  1500 m tall.
- **Flying through one** gives a sparkle burst and a chime (the director tests the distance).
- **Street level:** beacons stand on the horizon in the directions of your districts. They are navigation with no HUD.

**From altitude.** A field of 3-8 px columns rises out of the city into the sky band, so your progress map *is* the
skyline. With `?fog` they rise out of the fog sea.

**Technique.** New file `src/fx/magic/Beams.ts`.

- **Mesh and data:** one `InstancedMesh` (16 instances) of a 1×8-row quad column. All per-instance data lives in uniform
  arrays `uBeam[16]` (x, z, baseY, birthT) and `uBeam2[16]` (hue, height, widthM, kind), read through `gl_InstanceID`.
  That means **no buffer uploads at all**.
- **The column is built in screen space** with integer-pixel edges:

  ```glsl
  vec4 c = projectionMatrix * viewMatrix * vec4(P.x, baseY + aRow * H, P.y, 1.0);
  float mpp = sbMpp(c);
  float halfPx = max(floor(0.5 * widthM / mpp + 0.5), minHalfPx);  // integer pixels
  float xpx = floor((c.x / c.w * 0.5 + 0.5) * uViewPx.x + 0.5);    // the center on a pixel boundary
  c.x = ((xpx + aSide * halfPx) / uViewPx.x * 2.0 - 1.0) * c.w;    // edges land exactly on pixel edges
  vAcross = aSide * halfPx;
  ```

- **Fragment:** bands from `floor(abs(vAcross))` through `sbBand7`. The top 30% uses `sbDissolve`. Slugs are
  `fract((y - age·420)/55) < 0.12`.
- **Verticals:** the camera has no roll, so verticals project near-vertical, and per-row snapping gives a clean
  stair-step lean.

**Perf and caps.**

| Cost | Amount |
|---|---|
| Draws | 1 |
| Triangles | 256 |
| Uploads | uniform writes only |
| Fill | a near transient pillar is at most about 15% of the screen for 0.3 s; a beacon is about 3k px |
| Caps | 16 instances: 2 transient and 14 beacons (the nearest by camera distance, with hysteresis) |

**Effort.** 2 d.

### 6. Paint-bird murmuration (LEAP, every blast) · WS-2

**Moment.**

| Time (s) | What happens |
|---|---|
| f0 | 24 + 12·strength birds (at most 72) are born 1-2 m out of the impact, so the hit-stop frames show them bursting out of the flash |
| 0-0.3 | They burst out radially (25-45 m/s outward, 30-50 m/s up, with drag) like rainbow shrapnel, in all six blast hues |
| 0.3-0.8 | They curve onto a shared vortex ring |
| 0.8-3.2 | **A murmuration.** The ring rotates as one at 1.1 rad/s. Its radius breathes between 0.7 and 1.0 × the blast radius. It climbs 4 m/s from 25 m above the roofs and rocks (y + 6·sin(2θ + t)), so it reads as a 3D flock rather than a disc. |
| 3.2-4.5 | They peel off tangentially and blink out as twinkle stars |

**Variants.**

| Trigger | Birds |
|---|---|
| Firehose | a stream of 20 per second from the landing point |
| Finale | a triple flock from the district heart |

**Lives on.** Birds are transient. Grey gets none.

**From altitude.** Bird size is `max(1.1 m, 2·mpp)` at the spawn distance, so birds are never under 2 px. The ring is
120+ m across, about 80 px: a swirling rainbow vortex over the blast, legible as a flock.

**Technique.** New file `src/fx/magic/Celebration.ts`: the magic **sprite pool**.
- **The pool:** its own `THREE.Points` with 4096 slots and analytic paths in the vertex shader, the same pattern as
  `Particles` and `SuperFx`.
- **Position:** it sits at the origin (city depth, no snap compensation). Particles' ring is not overwritten, and
  `Particles.ts` is never edited.
- **Kinds:** `BIRD`, `SHELL` and `STAR` (#10).
- **Bird slot data:** the burst velocity plus the vortex center, ω, radius, climb, peel time and phase.
- **Bird sprite:** 5×3 px, a V (wings up) or ^ (wings down), toggling at 9 Hz per seed, and 3×2 when small. The body
  pixel is `GLOW_WHITE` at glow 0.4; the wings are the band hue at step 5-6.
- **Contract:** flags 0.5, depth written, never casts.

**Perf and caps.**

| Cost | Amount |
|---|---|
| Draws | +1 while anything is alive |
| CPU | one dirty run per spawn, merged into **one min..max range upload per frame**; about 0.03 ms per blast |
| Vertex | about 40 ALU per live bird |
| Caps | 72 per blast, 600 birds alive, `magicTune.birdsPerBlast` |

**Effort.** 1 d.

### 7. Sunbreak: colour returns to the city (IGNITE, paint density; district lit; finale) · WS-1 (+ polish/look for the sky)

**Moment.**
- After one blast the sun has partly broken through over it, and a lit district is in full late-afternoon sun.
- **At "district lit",** a circle of sunlight sweeps out from the heart at 80 m/s, like a cloud shadow retreating in
  reverse. As it passes:
  - sunlit faces climb 1-2 steps;
  - ambient drops by 20%, so shadows deepen and sharpen;
  - grey houses inside the pool reach the warm top steps of `GREY` and `GREY_LIGHT` (`#b3aca2`, `#d6d4cd`), which is
    Hopper sun on the grey.
- The sweep's front is a dithered one-cell band of +1 step.

**Lives on.** It is permanent. Each painted district sits in its own pool of raking golden light, and the unpainted
city stays under flat overcast. Inside the pool, the grey neighbours of painted houses look sunlit instead of drab.
This is the light spill the producer is missing, and the contrast is where the wow is.

**From altitude.** After hue, this is the strongest territory read: pools of hard sun and long shadows in a flatter
grey city. With `?fog`, the existing `paintClearing` already burns the marine layer back over paint, and sunbreak lights
what is revealed.

**Technique.**
- **Light term** in `sbLight` (F1, `materials.ts`), driven by the existing `uPaintFog` field (R8, 64 m cells, bumped by
  `bumpPaint` in `main.ts`):

  ```glsl
  float sb = uSunbreak.x * smoothstep(0.2, 0.7, sbPaintField(worldPos)) * sbSweep(worldPos);
  float l = uLight.y * (1.0 - 0.2 * sb) + uLight.z * sky + uLight.x * (1.0 + 0.45 * sb) * ndl * sh;
  ```

  One 15-building blast already lifts its center partly ((30 + 5·15)/255 ≈ 0.41). Painted materials keep their own
  light remap (the building material compresses painted light into the saturated middle), so the effect reads mostly on
  the grey and in the shadows, and never washes paint to pastel.
- **Sweep:** `uSunbreak.yzw` = (x, z, t0) of the newest lit district only. The speed is a tunable. No texture upload.
- **Finale:** the director bumps the field to 255 over the district's cells. The existing `pdTex.needsUpdate` path is
  one upload, at most one per frame.
- **Request to polish/look (the sky):** a `uSkyWarm[32]` azimuth LUT in the resolve's sky branch, filled at 2 Hz from
  `Districts`. It warms the sky toward lit districts using `SKY_WARM` through the existing dithered `warmS` edge. It is
  all palette.

**Perf and caps.**
- 0 draws.
- Every material pays one bilinear fetch of a 36 KB R8 texture plus 3 ALU; `sbFog` already does the same fetch, which
  `sbPaintField` shares.
- The sky LUT costs 1 array lookup.
- Tunable `magicTune.sunbreak`. The regression "grey" shot (no paint) must stay pixel-identical.

**Effort.** 1.5 d, plus 0.5 d for polish/look's sky.

### 8. Giant roof eruptions + crystal crowns (GROW, L2 and L3) · WS-3 (the growth kit)

**Trigger.**

| Level | What erupts |
|---|---|
| **L2** | one **wonder** per building, sized to its roof: height ≈ clamp(0.45·√(roof area), 5, 14) m on houses, so a 10-12 m Victorian wears a 9-14 m flower; 25-45 m on towers with roofs over 600 m² |
| **L3** | 2-4 wonders, plus a **crystal crown** (5-9 crystals, 10-40 m, leaning out) on flat-roofed buildings ≥25 m tall whose top roof holds no facade dome |
| **Firehose** | everything swept reaches L3, so the swath erupts as a parade |

**Moment.** On the section 1.3 rhythm, starting at the building's arrival time + 0.1 s, so it erupts out of the jelly
jump's stretch peak.

| Wonder | How it erupts |
|---|---|
| **Daisy or sunflower** | a seed spark; a green spear stabs up; a bud swells; 8 petals flick open around a `YELLOW` disc with `GLOW_WHITE` seeds, which flashes for 2 frames; the existing sparkle crown fires |
| **Toadstool** | a fat `WHITE` stalk punches up; the cap inflates like a balloon (xz 0.3 → 1.3 → 1.0); `WHITE` spots pop on 0.03 s apart; the gills glow at hue +3 |
| **Lantern plant** | a curled stem uncoils and 6 glowing fruit pop on in sequence |
| **Crystal crown** | crystals stab up and outward like a geode bursting (y ×1.3 overshoot); at f10 every facet catches the low sun at once, with a "tink" chord tone |

Across a 40-building escalation, 40-120 eruptions ripple outward within 0.3 s.

**Lives on.**
- **Sway:** 0.5-0.7 Hz, with the phase following world position, so a field waves like wind.
- **Within 80 m of the bus,** flower heads turn to face it.
- **Within 16 m they bow away from it** ("magic gives way to the bus"): flying low through a painted block parts a sea
  of giant flowers.
- **Crystals:** an energy band (1.5 m, glow 0.8) climbs each one every 2.4 s. The facet mirroring the sun toward the eye
  flips to step 7, so crowns flash like gems as the bus moves.
- **While the super charges:** every wonder within 120 m leans toward the bus and brightens its cores (`uCharge`). When
  the torrent fires they all release a pollen puff.

**From altitude.**
- Wonders cull at 2400 m (a factor of 2.4 on `sproutCull`).
- Stems and blobs inflate to at least 2 px.
- At 1.5 m/px a 12 m head is 8 px and a 40 m tower flower is 27 px. The skyline's silhouette changes from boxes to a
  bouquet. Crystal crowns are 20-40 px faceted gems on mid-rise roofs.

**Technique.**
- **Files:** new `src/world/props/wonders.ts`, plus `src/world/props/sprouts.ts` (a new `T.WONDER` entry in `TYPES`) and
  `common.ts` (`propErupt` = `sbErupt` with prop scaling).
- **Batching:** the entry inherits the per-cell `Batch`, alloc/release, distance cull and depth twin. Wonders use a
  **1536 m cell** instead of 768 m, which halves their draws up high.
- **One template serves every variant** (about 216 triangles, 150 vertices):

  | Part | Triangles |
  |---|---|
  | A bendable 6-sided tapered stem, 5 rings | 60 |
  | 12 `octa0` blob slots, each carved per pixel into an exact ellipsoid | 96 |
  | 5 crystal prism slots (flat facets, no carving) | 60 |

- **Variants:** daisy, tulip, toadstool, toadstool cluster, lantern plant, crystal cluster. Each reads its slot table
  (center, radii, part, delay) from a GLSL const array, the way `trees.ts` builds species. Unused slots collapse to zero
  scale.
- **Instance data:** `instanceColor` = (hue + 8·variant + 0.9·seed, amplitude, start time), the trees' packing.
- **Vertex shader:**
  - per-part `propErupt`;
  - petals rotate open from -70°;
  - the stem bends as tip·s², where tip = sway + duck(`uBus`) + charge lean (`uCharge`);
  - `uPxK` (= `pipeline.pixelWorldSize(1)`, set by the director) inflates radii to at least 2 px;
  - the jelly ride (#2) uses the same `aBld` as the gardens.
- **Fragment shader:** the `SPROUT_FS` ellipsoid carve (exact `gl_FragDepth`), with part ramps:

  | Part | Ramp |
  |---|---|
  | Petals | building hue +2/+3/+4, never the wall's hue or the ground's |
  | Disc | `YELLOW` |
  | Stem, leaf | `GREEN` |
  | Stalk, spots | `WHITE` |
  | Gills, fruit | hue +3, glow 0.45 / 0.6 |
  | Crystals | `BLUE`/`VIOLET` or hue ±1; glint at dot(reflect(-sun, n), view) > 0.92, only when the facet is ≥3 px |

  Flags 1.0 (ink).
- **Flight:**
  - `RoofSprouts.set` returns 0.55 × the wonder height to `city.raiseRoof`, because the heads duck instead.
  - Tower wonders and crowns over 30 m also add a post through `city.addObstacles`.
  - Layout reserves facade's dome anchors and the existing garden discs.
- **Hooks:**
  - The director calls `growWonders(ref, hue, level, start)` from `bloom` (L2+) and from `city.onTile` saved paint
    (start -100, already grown), next to today's `growSprouts`.
  - It is derived from building paint, so **no new save data** is needed.
  - It never grows on the building that is glinting right now (keeps the aim readable).

**Perf and caps.**

| Cost | Amount |
|---|---|
| Draws | +1 per visible 1536 m cell holding wonders: 1-2 at the floor, 2-4 up high; the same again in the sun pass |
| Triangles | about 300 visible × 216 ≈ 65k typical, plus 65k in shadow; cap 1200 wonders city-wide (oldest evicted), 260k |
| Fragment | the carve writes `gl_FragDepth` and discards, losing Apple's hidden-surface removal on 2-6% of the screen (up to 15% while parting a field). Fallback: plain polygon depth for blobs under 6 px. |
| CPU | layout at bloom only, about 0.02 ms per building, spread across the 0.3 s wave by the bloom callbacks; `Batch.write` keeps one min..max range per batch per frame |
| Tunables | `magicTune.maxWonders`, `wonderScale` (start reviews at 0.8), cull |

**Effort.** 3.5 d: the kit, eruptions and crystals.

### 9. Rainbow waterfalls (GROW, L3; towers from L2) · WS-2 (WS-3 places them)

**Trigger.**

| Building | Falls |
|---|---|
| L3, at least 8 m tall | 1, off the roof edge facing the street (`city.frontOf(ref)`) |
| Towers ≥40 m, from L2 | 1-3 |
| Firehose-hit towers | yes |

**Moment.**
- **+0.25 s after the escalation pop:** a glossy bulge of the building's hue swells over the roof edge.
- **+0.35 s:** it breaks, and the sheet unrolls downward at 45 m/s behind a fat white foam head. It arcs out about 4 m/s
  horizontally and lands in the street, not on the wall.
- **Landing:** +0.22 s on a house, +3.3 s on a 150 m tower, with a `particles.splash` at the base.

**Lives on.**
- Seven bands in rainbow order: the building's hue in the center and the complement at the edges. It is the breath's
  ribbon again.
- Foam streaks scroll down in **12 fps steps**, the classic hand-animated pixel waterfall.
- The bottom 15% frays into droplets.
- Within 200 m of the bus the base sprays (at most 6 falls).
- Waterfalls are not obstacles: fly through one and spray crosses the lens.

**From altitude.** A 150 m tower fall is a 4-8 px wide glowing ribbon, 50-100 px tall. It is the most legible vertical
signal that downtown is painted.

**Technique.** New file `src/fx/magic/Ribbons.ts`.
- **Mesh:** **one global `InstancedMesh`** shared by waterfalls (kind 0) and the finale's rainbow bridges (kind 1, #14).
  The template is a 2 × 48 strip (96 triangles), with 288 slots (256 falls, 32 bridges).
- **Culling:** `frustumCulled = false`. Instances beyond 2400 m collapse to zero area in the vertex shader. Vertex
  cost: 288 × 98 vertices, trivial.
- **Fall vertex shader:** s runs 0..1 down the fall, with drop h = s·H, out(h) = vx·√(2h/g) + lip, and width w0·(1 +
  0.5s), floored at 14·mpp so every band is at least 2 px. It is pinned clear of the wall's 0.32 m wobble.
- **Fall fragment shader:**
  - `band = floor(u·7)` through `sbBand7`, with the sun-side band one step lighter;
  - foam rows anchored in world y: `row = floor((worldY + floor(uTime·12)/12·speed)/0.6)`; where
    `hash(row, band) < 0.18` the pixel is `GLOW_WHITE` step 7 at glow 0.35;
  - the front discards where roofY - worldY > 45·(uTime - start);
  - the fray discards on 0.5 m world cells.
- **No ground pool job.** The street is already painted, and this keeps `GroundPaint` out of it.
- **Data:** written on add, which is rare, as one merged range per frame. Falls are derived from building paint and
  regrown on tile load, so nothing is saved.

**Perf and caps.**

| Cost | Amount |
|---|---|
| Draws | +1 (resident once any fall or bridge exists) |
| Triangles | about 150 typical falls ≈ 14k; cap about 28k |
| Fragment | about 25 ALU |
| CPU | spray only |
| Cap | 256 falls, the nearest kept, re-homed on tile load and unload |

**Effort.** 1.25 d, on the ribbon kit.

### 10. Fireworks (IGNITE) · WS-2 (WS-1 makes the sound)

**Trigger.**

| Trigger | Shells |
|---|---|
| Big tap | 1 |
| Huge tap | 3 |
| Each escalation to L3 in a blast | 1 from that roof (cap 3 per blast) |
| Mega | 3 |
| Firehose | 1 every 0.5 s from the landing point |
| Closer | a 3-shell salvo |
| Resident | over lit districts holding L3 buildings: 1 shell from a random L3 roof within 700 m every 2 bars, launched on the downbeat so it bursts on beat 3; global cap 1 per 2 s |
| Finale | a barrage (#14) |

**Moment.**
- **Launch:** a white-hot 2-px head rises at 70 m/s with a 4-6 px smeared tail in the shell's hue.
- **Apex,** 60-110 m above the roof after 0.9-1.5 s: one frame of white cluster (the glow pass blooms it), then 90-140
  stars burst out in one of three patterns:

  | Pattern | Look |
  |---|---|
  | Peony | a sphere of one hue with a white core |
  | Ring | a tilted ring alternating hue and hue+3 |
  | Willow | `YELLOW`/`ORANGE` stars with long drooping smears |

- **Cooling:** stars cool down their ramp 7 → 5 → 3 (never below 3 for yellow and orange). In the last 30%, a third of
  them crackle out in hash order.
- **Audio:** a rising whistle, a burst pop **tuned to a tone of the current chord** (fireworks are part of the music),
  and a granular crackle.

**From altitude.** These are the altitude spectacle. The burst radius scales with strength (30-80 m), and star size is
`max(1.2 m, 2.2·mpp)` at spawn. From 500 m, a blooming firework marks every L3 neighbourhood: the city answers you from
below.

**Technique.** In `Celebration.ts` (the pool from #6), `firework(pos, apexH, hue, pattern, delay)` writes a whole shell
**once at launch**:
- 1 `SHELL` head, with its life equal to the rise time;
- N `STAR` slots with `t0` = launch + rise, in the future. The vertex shader culls `age < 0`, so a firework costs **no
  per-frame CPU**.

Stars follow `p0 + v0·(1 - e^(-k·age))/k + droop·age`, with `F_COOL` (step = 7 - 4x, quantized), glow 0.9 and `fogMul`
0.3, so they punch through the marine layer.

**Perf and caps.**

| Cost | Amount |
|---|---|
| Draws | 0 beyond the pool |
| Per shell | about 120 slots and about 40 µs at launch |
| Caps | 6 shells airborne (about 900 sprites); the director skips shells when the pool is more than 80% live; finale 24 shells over 8 bars |

**Effort.** 1.25 d of visuals, plus 0.5 d for the `magicSfx.ts` one-shots.

### 11. Heartbeat: music builds with paint (SING, everywhere painted) · WS-1

**What you see**, on every beat at 84 BPM (0.71 s):
- **Pulse ring:** from each lit district's heart (the nearest 4), a ring of light races out **only over painted ground
  and painted roofs**, out to 200 m in one beat. It is +1 step with a white leading pixel and glow 0.3. Grey is
  untouched, so the pulse traces the painted shape and runs along #4's neon rims.
- **Downbeats:** every 4th beat the ring is twice as wide and banded in rainbow.
- **Facades:** painted walls get a 2 m band of +1 step rising up the facade each beat.
- **The pump.** Painted buildings snap down over 2 frames and spring back like speaker cones:

  | Level | Pump |
  |---|---|
  | L1 | 2%, on downbeats only (big L1 areas never churn) |
  | L2 | 3%, every beat |
  | L3 | 4%, every beat, plus a 1.5% shimmy on alternate beats |

- **Stadium wave:** phase lags with distance from the heart, so a ring of bouncing houses rolls outward once per bar.
  Overshoot is capped at +0.6 m for flight clearance.
- **Gains** scale with `uBeat.w` (local paint energy) × `uDuck`.

**What you hear.** `src/audio/groove.ts` is a beat-locked arrangement over the existing Pachelbel progression. Each
splat still advances the chord instantly, so feel is untouched. Layers enter on bar lines with a one-bar crossfade:

| Paint energy E near the bus (or L3 share) | Layer added |
|---|---|
| 0 (grey) | wind and foghorns (today) |
| > 0 | the hum (today), plus a soft sub "heartbeat" on beats 1 and 3 |
| ≥ 0.25 | a marimba ostinato arpeggiating the chord in 8ths |
| ≥ 0.5, or any L2 | kick on four, shaker 16ths, bass on the chord roots |
| L3 share ≥ 20%, or a lit district | a glockenspiel counter-melody (pentatonic over the chord), claps on 2 and 4; a choir pad replaces the hum |
| super charging | supersplat's riser and heartbeat own the pulse; the groove ducks its drums and `uBeat` follows `heartInterval` |
| firehose pour | **"the drop"**: every layer at once |
| closer, slow-mo | a low-pass sweep, then re-entry on the downbeat with a fill |
| finale | key change up a whole step, timpani roll, full choir, 8 bars of stabs, then settle |

E is the painted share within 250 m, weighted by mean level and recent blasts. Up high it is measured over the view
footprint, so from the ceiling the whole painted city is the band.

**From altitude.** Concentric sonar pulses radiate from every district heart. The band width is `max(5 m, 3·mpp)`, so
they read at 2-3 m/px. House pumps fade out through the 1.5-px gate, while towers keep dancing (a 100 m L3 tower moves
4 m, 2-3 px).

**Technique.**
- **Shaders:**
  - `GLSL_PULSE` lives in `GroundPaint.ts` next to `GLSL_BLAST_RING`. It uses `uPulse[4]` (x, z, reach, strength),
    set by the director at 2 Hz. The terrain paint branch and `magicWall` (painted roofs and walls, scaled by
    level / 3) both call it.
  - The pump is `magicPump()` in `GLSL_JELLY`'s resting path, with `uDanceC[4]` set to the district hearts.
- **Audio:**
  - `groove.ts` is a lookahead scheduler (0.12 s) using the existing kit: `Bells` for marimba and glockenspiel,
    noise + envelope for drums, `Hum` for the pad. Voice cap 24.
  - `AudioEngine.ts` gets 20 lines or fewer, after supersplat merges: construct the groove, add `beat()`, and add the
    `paintEnergy` and `l3Share` fields to `AudioFrame`.
- **Anti-strobe:** at most +1 step (+2 only on the downbeat band), at most 1.4 Hz, never a whole-surface flash.
  `prefers-reduced-motion` sets pump and pulse to 0.
- **Offline audio check:** `tools/audio-check.mjs`, peak under 0.85, no clipping.

**Perf and caps.**

| Cost | Amount |
|---|---|
| Fragment | about 30 ALU on painted fragments |
| Vertex | about 15 ALU on painted vertices (pump) |
| Draws | 0 |
| CPU | main-thread scheduling about 0.05 ms |

**Effort.** 3.5 d: 1 d for pulse and pump, 2.5 d for groove v1 and v2.

### 12. Money-shot slow motion (LEAP: huge tap, mega with charge ≥ 0.6, firehose closer, finale) · WS-3 (WS-1 for audio)

**Moment.**
- The tap, impact, flash and hit-stop are unchanged (mega keeps supersplat's 9 hit-stop frames).
- Then, instead of snapping back to 1×, time runs at **0.2× for 0.35 s** of real time and eases back to 1× over 0.7 s.
- About 1.05 s of real time shows about 0.45 s of game time. In that window:
  - the tsunami curls in slow motion;
  - every house's jelly jump unfolds in readable stages (squash, launch, hang, land);
  - birds burst like shrapnel;
  - blobs hang in the air like jewels;
  - the pillar's slugs crawl.
- **Exit:** time returns to 1× on the next downbeat (at most +0.3 s), where the groove's fill lands.

**Audio.** `AudioEngine.slowmo(depth, s)`: a master low-pass sweep (18 kHz → 900 Hz → back), the hum detuned -300
cents, and a reverse-swell "whoomp" that resolves on the exit downbeat.

**Technique.**
- `Magic.timeScale(realDt)` (F4).
- Everything animates from `simTime`/`uTime` or the particle clock, so it all slows together. Flight substeps (1/120 s)
  stay valid at any dt.
- **Requested of feat/supersplat and feat/controls:** charge and cooldown timers, and the tilt and input filters, run
  on `realDt`.

**Perf and caps.**
- 0 cost.
- Caps: once per 10 s, never on two blasts in a row, never in the opening, at most 1.2 s of real time.
- Reduced motion: 0.5× for 0.25 s.

**Effort.** 0.5 d, plus 0.25 d for audio.

### 13. Firehose beanstalk (GROW, firehose) · WS-3 (on the kit)

**Moment.**
- **1 s into the pour,** the director picks the point the stream has landed on most so far (a 32 m histogram of hose
  impact points).
- **There, a twisting stalk erupts** and climbs alongside the torrent at 40 m/s:
  - it spirals at a 3 m radius, half a turn every 20 m;
  - it is `GREEN`, wrapped in seven-band hue stripes (the ribbon again);
  - bus-sized leaves snap open every 12 m on the eruption rhythm.
- **On the closer:** the stalk overshoots by 10%, and a bud at the top swells for 0.3 s, then bursts into a **30 m
  flower**. The burst throws a pollen shockwave (`particles.burst` + `sparkles` + a bird flock), and the chord resolves.
- **Height:** min(160 m, 20 + 40 × (pour time - 1 s)), so 140 m for a full 4 s pour.

**Lives on.** It sways slowly (0.15 Hz, 1.5 m at the top), its leaves flutter, and its flower tracks the sun. It is a
permanent landmark of the player's own making. On the west side it pokes up through the marine layer: a flower blooming
on the fog sea.

**From altitude.** 140 m plus a 30 m flower is 60-110 px tall.

**Technique.**
- **Where:** `wonders.ts` exports `BeanstalkField`, one `InstancedMesh` plus a caster.
- **Template** (about 600 triangles): a 32-ring hex tube whose helix centerline the vertex shader computes from
  instance parameters (height, twist, phase, start); 8 leaf slots; 12 flower blob slots from the kit. Rings above the
  growth front collapse into the bud.
- **Obstacle:** `city.addObstacles({x, z, r: 8, top, under: -Infinity})`, so the flight soft-steers around it.
- **Persistence:** `strugglebus.magic.v1`, at most 12. The oldest wilts back into the ground over 2 s.

**Perf and caps.** +1 draw and +1 caster, only once one exists. About 600 triangles each (7k at the cap). 0 CPU per
frame.

**Effort.** 1.5 d.

### 14. Sunburst: the district finale (all four verbs; district complete) · WS-3 orchestration (WS-2 for bridges)

**Moment.** An 8-9 s beat, during which the player keeps control.

| Time (s) | What happens |
|---|---|
| 0 | The finishing blast flashes for 2 frames, holds 8 hit-stop frames, then slow-mo (#12). |
| 0-0.5 (slow-mo) | **Every painted building in the district** re-flares its windows (#1's pop) and jelly-jumps in a **stadium wave** out from the heart: `uCarnival` (x, z, t0, speed) gives buildings an extra pop arrival by distance, with no paint-texel writes and no upload. The tsunami is double height. |
| 0.3 | The giant gold pillar (#5: 16 m, 1500 m) erupts from the heart and **stays** as the district's gold beacon. |
| 1.2 (1×, downbeat) | Key change. **The sun breaks through:** the sunbreak sweep (#7) runs at 80 m/s, the paint field is bumped to full over the district, and, with `?fog` on, the fog burns off through `paintClearing`. |
| 1.5-3 | **Rainbow bridges draw themselves** (WS-2, the `Ribbons` kind 1) from this heart to every lit or complete district within 2 km (at most 6). The head is a `GLOW_WHITE` star racing along a parabola with apex 0.3 × span (at least 60 m), trailing 7 bands, red outside to violet inside like a real rainbow. On landing: a sparkle splash and a chord tone. |
| 1.6-7 | **Barrage:** every L3 roof in the district fires in spiral order, one per quarter beat (cap 24), plus 4 big shells from the heart; a triple murmuration bursts from the heart; the dance gain doubles for 8 bars. |
| 7-9 | The biggest shell in the game (300 m up, 150 m radius, readable from anywhere in SF). The music settles into the full groove. |

The street sign shows the neighbourhood's name in `GLOW_WHITE`. This is a request to polish/look, which owns
`StreetSign`: a `celebrate(name)` API.

**Lives on.**
- A gold beacon.
- Permanent bridges, with a one-band `GLOW_WHITE` sheen running along each every bar. Flying through one gives a
  chime and sparkles.
- The district dances at 1.5× and fires resident fireworks twice as often.

**From altitude.** It is designed to be watched from the ceiling. The web of bridges between districts is the best
"look what I did" screenshot in the game: 600 m spans peak 180 m up.

**Technique.**
- `Magic.finale(district)` sequences #1-#13 on the beat clock, with one new building uniform (`uCarnival`, passed to
  `magicJelly`).
- **Bridge vertex shader:** `P(s) = mix(A, B, s) + up·4·apex·s(1 - s)`, expanded across in screen space to a half-width
  of `max(widthM/2, 7·mpp)`, so each band is at least 2 px at every distance. The draw-in discards s > head(age).
- **Bridge styling:** step 5, glow 0.35, flags 0.5.
- **Persistence:** bridges are saved as district-cell pairs in `strugglebus.magic.v1` (at most 32) and rebuilt from the
  saved district summary, so beacons and bridges **show from 5 km away on reload before their tiles stream in**.

**Perf and caps.**
- One finale at a time.
- Peak: +2 transient draws (tsunami, sprite pool) on top of the resident ones.
- Spawn CPU at most 0.3 ms per frame, spread across quarter beats.
- When `workMs > 6`: half the barrage, a single flock.

**Effort.** 1.5 d of orchestration, plus 1.5 d for bridges.

---

## 6. The firehose: what supersplat owns, what magic adds

feat/supersplat owns the charge (SuperFx motes spiralling into the mouth, arcs, sparks, halo, the belly band, swell and
shudder, `SuperMeter`, `superSfx` riser and heartbeat), the torrent, the 12 impacts per second, the cooldown meter and
the "spent" bus. Magic only makes the **city** answer it.

| Phase | Magic adds | Spend per second |
|---|---|---|
| **Charging** (10 s) | Wonders within 120 m lean in and brighten (`uCharge`). `uBeat` follows supersplat's heartbeat. The groove ducks. | uniforms only |
| **Mega release** | huge tier, with sizes scaled by charge: tsunami to 70 m, pillar to 40 m × 1000 m, 3 shells, 72 birds; slow-mo at charge ≥ 0.6 | as a huge blast |
| **Pour** (4 s × 12 impacts/s) | Every hose impact runs the **light path**: jelly and flood through the normal bloom (escalating per `firehoseRepop`), white-hot ground; no pillar, no flash (supersplat caps flashes at 3/s). Director-level effects: a tsunami train (1 per 0.35 s, at most 3 live), birds at 20/s, a shell every 0.5 s, wonders, crystals and waterfalls erupting through the swath as buildings reach L2/L3, the beanstalk from 1 s, "the drop". | Caps per second: 3 waves, 20 birds, 2 shells, 40 wonder layouts (queued, at most 4 per frame) |
| **Closer** | giant pillar, a 3-shell salvo, slow-mo, the beanstalk's flower bursts, pollen puff from every leaning wonder | as a huge blast |
| **Cooldown** (60 s) | nothing new; supersplat's meter shows it | – |

**Requests to feat/supersplat:**
1. `Blast.super = {kind, charge}`, next to the `hose` and `primary` fields it already adds.
2. Charge and cooldown timers on `realDt`.
3. Expose `phase`, `charge01()` and `heartPhase()`.

---

## 7. Performance roll-up (iPhone A15, ≥30 fps; today 120-200 draws, 1.0-1.5M tris, workMs 3-5 ms)

| | Today | Magic, typical | Magic, peak (firehose / finale) |
|---|---|---|---|
| Draws, street level (Alamo Square, heavy paint) | ~130-150 | +5 to +8: Ribbons 1, Beams 1, wonders 1-2 (+1-2 in the sun pass), transient tsunami 1 + sprite pool 1 | +12 (+ beanstalk 1 + caster 1) |
| Draws, 250-500 m | ~200 | +6 to +10 (wonders 2-4 on 1536 m cells; casters only inside the 1600 m shadow window) | +14 |
| Triangles, scene | 1.0-1.5M | +90k (wonders 65k, falls 14k, waves ≤4.8k, beanstalks, bridges) | +300k at the caps |
| Triangles, sun pass | – | +70k | +150k |
| G-buffer fragment | – | +8-12% in painted views (building +20-30 ALU, ground +25-30, +1 R8 fetch everywhere) | + tsunami ≤30% of the screen for about 1 s, pillar ≤15% for 0.3 s |
| Vertex | – | jelly +25 ALU (popping only), pump +15 (painted) | same |
| CPU per frame | 3-5 ms | +0.05-0.1 ms (director 2 Hz, uniform packing, groove, wave LUT ring) | spawn bursts ≤0.3 ms, spread over arrival times and quarter beats |
| Uploads | one per texture | unchanged: the sprite pool and Ribbons merge to one range per frame, wonders one per `Batch`, the wave LUT one rect, Beams uniforms only, the paint field its existing path | same |
| Storage | – | `strugglebus.magic.v1:<city>` < 8 KB | – |

**Governor.** `magicTune.quality` ranges 0.25-1. The director drives it from the `workMs` EMA (align with
polish/perf's `Perf.ts` signal): above 6 ms for 2 s it steps down 0.25, below 4 ms for 4 s it steps up. Quality scales:
- birds per blast and stars per shell;
- the resident firework rate;
- tsunami segments (160 → 96) and the train rate;
- wonder cull distance (2400 → 1200 m);
- visible waterfalls (256 → 96);
- heartbeat centers (4 → 2).

The structural caps above hold regardless of quality.

---

## 8. Build order (most wow first)

| Sprint | Days | Effects | The result |
|---|---|---|---|
| **1. "It erupts"** | 1-4 | F1, F3-lite (tiers and routing), #12 slow-mo, #1 white-hot flood + window pop, #2 jelly jump, #3 rainbow tsunami, #6 paint birds, #5 pillars (transient) | Every tap becomes a white-hot, leaping, surf-and-pillar explosion with a flock. It answers "too conservative" on its own, with 2 transient draws. |
| **2. "It shines and grows"** | 5-8 | #4 neon ground + meadow, #7 sunbreak, #10 fireworks, #8 roof eruptions + crystals, #9 waterfalls | Re-splats grow a new skyline. Colour and sun visibly return to the city. It reads from the ceiling. |
| **3. "It sings, and it's yours"** | 8-11 | Districts + persistence, #5 beacons, #11 heartbeat + music, #13 beanstalk, #14 Sunburst + bridges | Progress written into the skyline, a city that dances to music it builds, and the firehose leaves a landmark. |

**Per workstream** (each about 10 days, in parallel):

| Workstream | Order | Days |
|---|---|---|
| **WS-1** | F1 (0.75) → #1 (1.25) → #2 (1.25) → #4 (1.25) → #7 (1.5) → #11 pulse and pump (1) → groove v1 (1.5) → groove v2, slow-mo and firework sfx (1.75) | ≈ 10.25 d |
| **WS-2** | ribbon kit (0.5) → #3 (1.5) → #6 (1) → #5 (2) → #10 (1.25) → #9 (1.25) → bridges (1.5) | ≈ 9 d |
| **WS-3** | director, tiers and time scale (1) → #12 (0.5) → garden ride for #2 (0.5) → #8 kit (3.5) → Districts + persistence (1) → #13 (1.5) → #14 (1.5) → docs and QA (0.75) | ≈ 10.25 d |

If the budget forces cuts, drop in this order: #13, then the music v2 layers, then #9. Keep #1, #2, #3 and #5 at all
costs: they carry the brief.

---

## 9. Implementation plan: three workstreams, no file collisions

### 9.1 Owners already in flight (magic never edits these directly)

| Branch | Owns | How magic gets in |
|---|---|---|
| **feat/facade** | `src/world/buildingMaterial.ts`, `BuildingMesher.ts`, `towerStyles.ts`, `props/landmarks.ts` | Through **two call sites** in `buildingMaterial.ts`, written by WS-1 as a patch on top of facade's version and reviewed by facade's owner: `magicJelly`/`magicPump` in the vertex stage where the pop is; `magicWall` before `sbWrite`. Plus spreading `magicSurfaceUniforms`. About 25 lines; every line of logic lives in `magicSurface.ts`. |
| **polish/look** | camera (`CameraRig.ts`), sky, fog and resolve in `PixelPipeline.ts`, `Bridges.ts`, `StreetSign.ts` | Requests: the sky-warm LUT (#7), `signs.celebrate(name)` (#14), review of F1's 4-line `PixelPipeline` patch. Optional: lock the half-res glow grid to `ditherOrigin` parity (a latent halo flicker), a translation-only crane on mega and finale. |
| **feat/supersplat** | `SuperSplat.ts`, `SuperFx.ts`, `SuperMeter.ts`, `superSfx.ts`, its `Splat.ts`/`Particles.ts`/`Flight.ts`/`BusModel.ts`/`AudioEngine.ts`/`main.ts` edits | Requests: `Blast.super`, timers on `realDt`, `phase`/`charge01`/`heartPhase` getters. Magic lands its `main.ts` and `AudioEngine.ts` lines **after** supersplat merges. |
| **feat/controls** | `Input.ts`, `Tilt.ts`, `Turbo.ts`, its `Flight.ts`/`CameraRig.ts` edits | Request: tilt and input filters on `realDt` (slow-mo). Nothing else. |
| **feat/osm** (paint v2 pending) | tiles, mesher roofs, terrain shading | WS-1 touches only the GLSL in `GroundPaint.ts`; the mask and storage formats are unchanged. Coordinate if paint v2 changes the mask. |

### 9.2 The magic workstreams

| Workstream | Branch | Owns (creates or edits) | Delivers |
|---|---|---|---|
| **WS-1 "Light & Beat"** | `magic/light` | **New:** `src/world/magicSurface.ts`, `src/audio/groove.ts`, `src/audio/magicSfx.ts`, `dev/magic-surface.html`. **Edits:** `src/render/materials.ts` (F1, one additive block), `src/render/PixelPipeline.ts` (4 lines, F1), `src/world/GroundPaint.ts` (GLSL only: rim, age, `GLSL_PULSE`), `src/world/terrainMaterial.ts` (the paint branch), `src/audio/AudioEngine.ts` (≤20 lines, after supersplat), the `buildingMaterial.ts` call-site patch (via facade) | F1, F2, #1, #2 (building side), #4, #7, #11, the audio for #10 and #12 |
| **WS-2 "Sky FX"** | `magic/sky` | **New only:** `src/fx/magic/ribbonGlsl.ts`, `PaintWave.ts`, `Beams.ts`, `Ribbons.ts`, `Celebration.ts`, `dev/magic-sky.html`. Calls `Particles` public APIs (`splash`, `puff`, `sparkles`, `burst`) but never edits it. | #3, #5, #6, #9 (rendering), #10 (visuals), bridges for #14 |
| **WS-3 "Growth & Director"** | `magic/growth` | **New:** `src/game/Magic.ts`, `src/game/Districts.ts`, `src/world/props/wonders.ts`, `dev/magic-growth.html`. **Edits:** `src/world/props/sprouts.ts` (`T.WONDER`, `aBld` ride), `src/world/props/common.ts` (`propErupt`), `src/main.ts` (≤40 lines of glue, after supersplat), `DECISIONS.md` and `docs/ARCHITECTURE.md` (the magic section, at the end) | F3, F4, #2 (garden ride), #8, #12, #13, #14 orchestration; placement for #9; all wiring and persistence |

The three file sets are disjoint. WS-2 is new files only. WS-1 and WS-3 meet only through imports:
- WS-3's sprouts import `GLSL_JELLY` from WS-1's `magicSurface.ts`;
- the director sets WS-1's uniforms and calls WS-2's spawn APIs.

All tunables register through `registerTunables('Magic …', ...)` in their own files, so `config.ts` is not touched.

**APIs between workstreams** (agree these on day 1, as stubs):

| Owner | API |
|---|---|
| WS-1 | `magicSurfaceUniforms`; `setBeat(phase, index, bar, energy)`; `setPulses(list)`; `setSunSweep(x, z, t0)`; `groove.update(dt, frame)`, `groove.beat()`; `sfx.firework(kind, chordTone)`, `sfx.slowmo(depth, s)` |
| WS-2 | `PaintWave.spawn(spec, tImpact, H, kind)`; `Beams.pillar(pos, hue, widthM, heightM, t)`; `Beams.setBeacons(list)`; `Ribbons.addFall(...)`/`removeFall(id)`; `Ribbons.addBridge(a, b, hue, t)`; `Celebration.flock(...)`, `stream(...)`, `firework(...)` |
| WS-3 | `Magic.onImpact(blast)`, `onBloom(ref, …, flags)`, `onTile(t)`, `onSuper(phase, charge)`, `update(dt, realDt)`, `timeScale(realDt)`, `finale(district)` |

### 9.3 Merge order

1. **Now, before the in-flight branches merge:** all three workstreams build in their new files against the dev harness
   (`createHarness()`, grey test blocks), each with its own `dev/magic-*.html` page. They touch no shared or owned
   file.
2. **Gate A,** after feat/facade, polish/look and feat/supersplat (and feat/controls) merge to main:
   1. WS-1's F1 foundation commit (`materials.ts` + 4 lines of `PixelPipeline`);
   2. WS-3's director and `main.ts` glue;
   3. WS-1's `buildingMaterial` call-site patch (facade review), `GroundPaint`/`terrainMaterial` and `AudioEngine`
      lines;
   4. WS-2 and WS-3 wiring.
3. **Each sprint ends with QA** (§10) and a merge to main. WS-3 writes the `DECISIONS.md` and `ARCHITECTURE.md` magic
   section last.

---

## 10. QA (when the machine is free; nothing was run for this spec)

- **Perf A/B:** `tools/blast.mjs perf`/`escalate`/`heavy` against main (draws, triangles, `workMs`). Add the scenarios
  `perf mega`, `perf firehose` and `perf finale`.
- **Device first:** run on a real iPhone (A15) before judging any perf number. SwiftShader is not a reference.
- **Shot strips:** `__qa.holdAt` at impact + 0.05/0.15/0.3/0.6/1.0 s, at the chase lens and at 250 m and 500 m, at the
  Painted Ladies and in FiDi.
- **Peak-pose check:** `__qa.holdFrames` through the 4 hit-stop frames (and the 8-9 for mega and finale).
- **Slow-mo determinism:** `?fixeddt=1/30`.
- **Flight clearance:** `tools/feel-sim` with the jelly, pump and wonder-duck displacement added to the rendered-surface
  raster: 0 frames inside geometry.
- **Regression:** the `grey` shot must be **pixel-identical** (nothing moves or glows in grey). Painted regressions are
  re-baselined per sprint.
- **Shimmer review:** 1/30 s frame sequences at 250 m and 500 m for beams, bridges, waterfalls and rims, as the
  altitude work did.
- **Audio:** `tools/audio-check.mjs` with all groove layers plus a fireworks barrage: peak under 0.85, no clipping.
- **Compile hitches:** pre-warm `PaintWave`, `Beams`, `Ribbons`, `Celebration`, the wonders and the beanstalk at boot
  (`renderer.compile` on hidden instances; the hitch is already known for the sign and the gardens).

## 11. Risks and guard rails

- **Mush, from too much at once.** A tap fires flood, jump, surf, neon ground, pillar and birds together.
  - Each owns a different layer: wall surface, vertex motion, a low ring at the blast's edge, the ground, one vertical
    at the primary, and the air above the roofs.
  - They share one rhythm and one palette rule.
  - Tiers and cooldowns keep the big pieces rare.
  - Nothing new is added to painted wall detail at rest.
- **The surf hiding the bloom.** The near half is at 40% height, the far wall is at most 0.32 r, and it is gone by
  1.16 s. Tune it with the shot strip before anything else.
- **Flight clearance.** Jelly is capped in meters; flowers duck from the bus; `raiseRoof` uses 0.55 h; posts are added
  for anything over 30 m and for beanstalks.
- **Fill and discard on Apple's tile-based GPU.** The tsunami, carved wonders and pillars are drawn after the opaque
  city, with coverage capped. Wonders have a polygon-depth fallback for blobs under 6 px.
- **Halo storm and photosensitivity.**
  - Resting glow is capped at 0.55, and large glow is only ever transient.
  - Flashes stay at today's 1 frame (2 at the finale); supersplat caps them at 3 per second.
  - Pulses are at most +1 step and 1.4 Hz.
  - `prefers-reduced-motion` turns pump, pulse and the jelly hop off.
- **Firehose stacking** (12 blasts/s × per-blast effects). Every effect has a hose path plus the per-second caps in §6.
- **No brown.** Warm hues never go below step 3, cooling ends at the resting middle, and wood and rock shadow toward
  violet.
- **Ownership.** `buildingMaterial.ts`, `main.ts` and `AudioEngine.ts` are the collision points. They are handled by
  keeping call sites only, landing after the owning branches merge, and keeping all logic in magic-owned files.
- **World travel** (task 24, the turbo flight to Tokyo). Magic state is keyed by city slug
  (`strugglebus.magic.v1:<slug>`). Districts are per city. Over open water nothing paints, so nothing erupts, and the
  ocean crossing stays grey and quiet. That makes the next city's first blast louder.

## 12. Open questions for the producer

1. **Wonder scale.** At L2, should flowers be taller than the houses (default `wonderScale` 1.0, with reviews starting
   at 0.8), or about house height?
2. **L1 restraint.** I recommend L1 stays "light and leap", with nothing permanent rising, so growth is the reward for
   re-splatting. Or should 1 in 4 houses already sprout a pop flower at L1?
3. **Tsunami height.** The default is 0.32 × the radius (about 19 m, 1.5 Victorians). Should it be bigger, at the risk
   of hiding the blooms?
4. **Slow motion.** Only on huge, mega, the closer and the finale (as proposed), or also on the first blast in each new
   neighbourhood?
5. **Tempo.** 84 BPM (dreamy, close to the canon) or 96 (party)? It sets how fast the whole city dances.
6. **The firehose's permanent mark.** Is the beanstalk right, or should the torrent leave no landmark (cut #13)?
