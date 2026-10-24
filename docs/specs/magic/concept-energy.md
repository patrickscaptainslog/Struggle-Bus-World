# Concept: Magical Energy & Light ("the paint is alive and it radiates")

Art-direction proposal for the producer note *"Not bad right now but way too conservative. I want explosive magical energy."*
Angle: **energy and light**. Paint stops being a coat of color and becomes a power source. It pours on as liquid light, it lights the grey city around it, it shoots into the sky, it arcs between buildings, and it pulses with the music.

Everything below fits the engine's hard rules. Materials write ramp + light + fog + glow, and only the resolve picks colors, so there is no free RGB and no brown. The camera's pixel grid stays snapped and nothing new may shimmer. The target is an A15 at 30 fps or better, with no per-building draws and at most one upload per texture per frame.

Sources read: `docs/ARCHITECTURE.md`, `DECISIONS.md`, `docs/specs/COMMON.md`, `src/render/{PixelPipeline,materials,palette}.ts`, `src/world/{buildingMaterial,GroundPaint}.ts`, `src/fx/Particles.ts`, `src/world/props/*`, `src/audio/AudioEngine.ts` (+ `music.ts`), `src/game/Splat.ts`, `src/main.ts`, `src/config.ts`. Shots: `shots/merge1/contact.png`, `shots/merge2/contact.png`, `shots/v6/regress/{grey,painted}.png`, `shots/merge1/blast/tap-0.15.png`.

---

## 0. Diagnosis: why the painted city feels conservative

- **The energy never leaves the surface.** In `v6/regress/painted.png` and in panels 2 and 4 of both contact sheets, the painted block is saturated but matte. Look at the grey house next door, the sky, and the street just outside the splat: they are pixel-for-pixel the frame they would be with no paint at all. The light stops at the edge of the paint.
- **Nothing rises.** Apart from the domes and spires, everything painted sits at roof height or below. From 250-500 m (panels 5 and 6) a painted district reads as a flat sticker on a map. At about 2-3 m per game pixel, windows and sprouts are gone and only patches of hue are left.
- **The glow is deliberately capped.** Stained glass is set to `glow = 0.38` (the comment says "a soft glow, not a halo storm"). The glow pass halo reaches only about 6 game pixels, because it is a half-res blur with ±3.2 texel taps. So "radiant" never happens.
- **The ground is the largest painted area on screen, and it has no internal light.** Big flat fields of red, violet and green take up about half of `painted.png`. Their only structure is a dark rim and wet blotches. The fresh glow (`0.55 * exp(-age*5)`) is gone after about 0.2 s.
- **The one moment that reads as energy is the shockwave ring** (`tap-0.15.png`). It only lives on up-facing surfaces (`sbRing`, `n.y > 0.35`), so trees and walls hide it, and it is over in 0.3 s.
- **Nothing pulses.** The music has chords but no beat (`music.ts` and `AudioEngine` have no tempo). The hum breathes on a 0.13 Hz LFO and the visuals have no clock to share with it.

What has to change: **energy must (1) leave the surface and go vertical, so it reads from altitude, (2) visibly change the light on the grey around it, (3) peak on the impact frame, so the 4 hit-stop frames show it, and (4) keep living on a shared beat.**

---

## 1. Art rules for energy (so "more" never turns to mush)

1. **Core → rim → body.** An energy shape is built from a `GLOW_WHITE` step-7 core, then a hue step-7 rim, then hue step-5 bodies. Resting painted surfaces stay in the saturated middle of their ramps, as they do today. White-hot is only for cores, edges and moments. Anything that is always white turns into mush.
2. **Neighboring energy bands have matched luminance.** Hue step 5 is `#f6707a #ffa94a #ffd23e #7ad65a #6cc0ff #bf86ff` and step 6 is the pastels. Bands of near-equal brightness do not crawl when an edge moves by one pixel. The doc's rule against high-contrast single-pixel stripes is the failure we are avoiding.
3. **Every energy feature is at least 2 game pixels, enforced in the shader.** Widths are computed from meters per pixel (clip `w`). Features fade out (LOD) or widen rather than going sub-pixel, so there is no moiré from altitude.
4. **Screen-door, never alpha.** See-through energy (pillar tops, aurora, dissolves) discards with the same 4x4 Bayer matrix as the resolve, **anchored to the snapped grid** (`uDitherOrigin`), so the pattern travels with the world. Things die the way the ring does today: they dissolve into pixels.
5. **The impact frame is the peak pose.** Hit-stop freezes `uTime`, so every effect that triggers on impact must already be at full drama at `t = 0` (a full-height pillar, bolts already striking). The frozen frames then read like a photo of a lightning strike.
6. **The escalation is earned.** L1 sparks, L2 crackles, L3 radiates. District events reach the sky, and the finale is the sky.
7. **Light is spent through the palette.** Spill onto the grey comes from the glow-pass halo, which the resolve already turns into +2 steps of the receiver's own ramp or the nearest hue tint, and from the sunbreak light term. Warm light means the grey ramps' warm top steps (`#b3aca2`, `#d6d4cd`) and `SKY_WARM`. Warm hues are never pushed below step 3, so there is no brown.

---

## 2. Foundation kit (shared by most effects, built once)

| ID | What | Where | Cost |
|---|---|---|---|
| **F1** | `globals.uDitherOrigin` (share `PixelPipeline.ditherOrigin`, as `resolveMat` already does), `globals.uViewPx` (G-buffer W, H incl. margin). GLSL helpers in `GLSL_COMMON`: `sbBayer(gl_FragCoord)` anchored, `sbScreenDoor(density)`, `sbStep(k) = (k + 0.15) / 7.0` (an exact ramp step, never dithered; the same constant Particles uses), and a vertex helper for meters per pixel, `2.0 * clip.w / (projectionMatrix[1][1] * uViewPx.y)` (Particles' `pxPerM` inverted). | `src/render/materials.ts`, `PixelPipeline.snap()` / `resize()` | 0 |
| **F2** | **Beat clock.** `globals.uBeat = (phase 0..1, beat index, bar phase 0..1, energy 0..1)` at **84 BPM** (tunable; ramps to about 126 during the firehose charge). It advances on sim `dt`, so it freezes in hit-stop. The visuals own the clock and work with sound off. `AudioEngine.pulse(downbeat)` swells the hum's `breathe` gain (+2 dB, 120 ms attack, 400 ms release) on each beat while a lit district is in range. | `src/main.ts`, `src/audio/AudioEngine.ts` + `SoundGraph` hum | about 0.01 ms CPU |
| **F3** | **Districts** (`src/game/Districts.ts`). Fixed 384 m cells (about 4x6 SF blocks), each tracking painted count, L3 count, the centroid of painted buildings, and its dominant hue. It is named by the hood under the centroid (`city.neighborhoodName`). Thresholds (tunable): **lit** = 15 painted; **finale** = 60 painted and 8 at L3 (or 120 painted). Saved as a summary, `strugglebus.districts.v1` = `{cell: [cx, cz, painted, l3, hue, litT, finaleT]}`, so beacons and aurora show from 5 km away on reload before the tiles stream in. Fed by `SplatFx.bloom` and by `city.onTile` saved paint (the same place `growSprouts` runs). It updates at 2 Hz. | new file | <0.05 ms at 2 Hz |
| **F4** | **Energy GLSL kit** `GLSL_ENERGY`: screen-space strip expansion (the ribbon trick from `Particles.ribbonAt`: perpendicular to the projected tangent, offset in whole pixels), the rainbow band picker with the luminance-matched steps from rule 2, pixel-dissolve. | new `src/fx/energyGlsl.ts` | 0 |
| **F5** | **Wide aura + grid-locked glow.** (a) Add a quarter-res aura level: extract `max(glow - 0.55, 0) * 2.2` from `glowA`, then a 2-pass blur. The resolve takes `halo = max(tGlow, 0.6 * tAura)`. Only energy cores (glow 0.6 or more) reach about 20 px, so windows at rest do not cause a halo storm. (b) Lock the half-res glow grid to the world: offset the glow extract and resolve sampling by `uDitherOrigin & 1` texels. Today a 1-pixel camera step lands on half a glow texel and can make static halo edges flicker. | `src/render/PixelPipeline.ts` | 3 blits at about 100x213 px, about 0.05 ms GPU |

All new energy meshes share these settings. `flags = 0.5` (no ink, and the resolve already gives buildings behind them a silhouette edge). Depth write on. `fogMul` 0.25-0.4, so they punch through the marine layer when `?fog` is on. Not in `SHADOW_LAYER`. `renderOrder = 10` (after opaque, which keeps Apple's hidden-surface removal for the opaque city and isolates the discard cost).

---

## 3. Ranked summary (by wow per cost)

Wow is 1-10. Cost is engineer-days including look-dev. Ratio = wow / days. Composites (#11, #12) are ranked by their incremental cost on top of the pieces they reuse.

| # | Effect | Trigger | Draws | Tris | Days | Wow | Ratio |
|---|---|---|---|---|---|---|---|
| 1 | **Molten flood + blazing windows** | every bloom; L2/L3 resting | 0 | 0 | 1 | 8 | 8.0 |
| 2 | **Neon ground** (white-hot reveal, neon splat rims, energy veins) | every blast; L2+ veins | 0 | 0 | 1 | 6 | 6.0 |
| 3 | **Rainbow chain lightning** (the wave made visible) | every blast; L2+ crackle; firehose | +1 | ≤3k | 1.5 | 8 | 5.3 |
| 4 | **Light pillars and district beacons** | every blast; L3; district lit | +1 | 256 | 2 | 10 | 5.0 |
| 5 | **Energy rings and L3 halo crowns** | every blast; L2/L3; firehose | +1 | ≤5k | 1.25 | 6 | 4.8 |
| 6 | **Sunbreak** (warm sun over paint vs grey overcast) | paint density; district lit | 0 | 0 | 1.5 | 7 | 4.7 |
| 7 | **District heartbeat** (pulse rings on the beat) | district lit (L1 soft, L3 strong) | 0 | 0 | 1.25 | 5 | 4.0 |
| 8 | **Rainbow bridges** (arcs linking painted buildings and districts) | consecutive blasts; district lit; finale | +1 | ≤3k | 2.5 | 9 | 3.6 |
| 9 | **Aurora curtains** | district finale | +1 | ≤1.2k | 3 | 10 | 3.3 |
| 10 | **Magic dust** (resident sparkle storms) | every bloom (4/10/24 motes by level); finale vortex | +1-4 | 0 (≤12k pts) | 1.75 | 5 | 2.9 |
| 11 | **Prism Beam** (firehose energy + diegetic charge and cooldown ring) | super splat | 0 new | - | +1.5 | 8 | 5.3* |
| 12 | **Supernova** (district finale) | district finale | 0 new | - | +1.5 | 10 | 6.7* |

\* incremental; needs #1, #3, #4, #5 (and #8, #9, #10 for the full finale).

**Totals:** about 6-9 new draws (today 120-200), under 15k new triangles plus at most 12k points (today 1.0-1.5M), about 0.1 ms of CPU per frame, and about 18 days for everything. Milestone 1 alone (F1 + #1 + #2, 2.5 days) changes the look with zero new draws.

---

## 4. The effects

### 1. Molten flood + blazing windows — *paint arrives as liquid light*
**Trigger:** every bloom (L1+), and escalations re-pour at 0.6x heat. L2 windows candle-flicker. L3 windows breathe on the beat.

**The moment, frame by frame** (at a 55 m/s flood):
- **f0, the impact frame plus the 4 hit-stop frames (`uTime` frozen):** the primary's top 6 m (`floodHead`) is incandescent: `GLOW_WHITE` step 7, glow 1. With F5 its aura flares into the sky band above the roof. The facade below is still grey, with a 2-px molten lip at the front.
- **0-0.1 s (a Victorian):** a 1.6 m band of liquid light pours down the facade. It is at least 2 px tall and has a white core. The existing per-column drips lead it as white-hot streaks. Behind the band the hue arrives at step 7 and **cools**: step 7 → 6 by 0.15 s, then to today's saturated resting light by 0.6 s. It is hot paint cooling, through palette steps.
- **Every window, as the band passes its row:** it pops `GLOW_WHITE` for 0.1 s, then shows its stained-glass hue at glow 0.9, easing to its resting glow over 2 s. A 15-house blast becomes 300 windows popping in a downward wave.
- **Towers (150-250 m, a 3-4.5 s flood):** a molten curtain falls down the whole tower floor by floor, with windows popping in its wake. It is the best thing that can happen to a skyscraper, and it holds the screen for seconds after the blast.

**Afterlife:** the resting window glow becomes L1 0.45 (today 0.38), L2 0.55 with one window in six candle-flickering (±1 step at 6 Hz, quantized), and L3 0.7, with a +1-step band climbing each facade on every beat.

**Street level:** painted buildings become lanterns. The stained-glass halos bleed +2 steps onto the street pixels in front of them, which is the first time the paint lights the grey.
**250-500 m:** today's window "melt" turns painted windows into dark wall tone. It is also gated on `uFogLayer2.w`, so with fog off (the current default) windows alias up there; see shared-file issues. New rule, keyed on `mpp` only: **painted walls whose windows are under 2 px take a flat glow of 0.3 (L1) to 0.5 (L3)**. A painted district then reads from 500 m as a glowing block with a soft aura on the grey around it. On a tower, the molten band is still a visible 1-2 px white line descending.

**Technique:** `src/world/buildingMaterial.ts` fragment only. `mpp`, `tb`, `roofY`, `vYRest` and the drip hash already exist.
```glsl
float hd    = roofY - vYRest;                          // depth below the tower top
float flood = uBloom.w * max(tb, 0.0) + uFloodHead;
float front = flood - drip - hd;                        // > 0 painted; meters behind the front
bool molten = painted && front < max(1.6, 2.0 * mpp);   // the band, never under 2 px
float heat  = painted ? exp(-front / (0.25 * uBloom.w)) : 0.0; // ~0.25 s cooling behind the front
float pop   = tb - (hd - uFloodHead) / uBloom.w;        // time since the front passed this row
// molten -> GLOW_WHITE, sbStep(7), glow 1
// wall    -> light = mix(light, sbStep(7.0), 0.8 * heat); glow = max(glow, 0.5 * heat)
// glass   -> pop in [0, 0.1): GLOW_WHITE; else glow = mix(rest[level], 0.95, exp(-1.5 * pop))
// L3      -> light += 0.143 * step(fract(uBeat.x - (vYRest - vBld.z) / 40.0), 0.12)
```
The building material is shared by detailed tiles and coarse regions, so altitude gets this for free.

**Pixel and shimmer:** the band height is at least 2 px via `mpp`. All steps are exact (`sbStep`). The flicker is quantized in time, and halos go through the resolve's palette path.
**Perf and caps:** 0 draws, triangles, uploads or CPU. About 20 ALU in the building fragment, which is the heaviest shader at 40-60% of pixels: under 0.2 ms on an A15 at 390x849. Resting glow is capped at 0.7, so only molten, pop and heat pixels cross the resolve's 0.42 tint threshold, and only for a moment. That keeps it from becoming a halo storm.
**Effort:** 1 day.

### 2. Neon ground — *white-hot reveal, neon splat rims, energy veins*
**Trigger:** every blast's ground paint (L1). Veins appear inside splats once the district has L2+ buildings, and they carry the heartbeat (#7).

**The moment:** as the shockwave reveals texels (the existing per-texel reveal `age`), each texel is born white-hot: `GLOW_WHITE` for 0-0.06 s, hue step 7 until 0.25 s, then cooling to its resting level by 0.8 s. The ring's wake is a white-hot disk turning into rainbow, not a single bright leading pixel. Flung blobs land as white-hot dots that cool the same way.

**Afterlife:**
- **Neon tubes.** Every splat edge keeps today's dark rim pixel as the outline (`pEdge < 0.07`). Just inside it goes a bright 1-2 px line at hue step 6, glow 0.35: dark outline plus bright core, the classic pixel-art neon. The blob shapes become glowing territory borders.
- **Energy veins.** World-anchored cellular (Voronoi-edge) lines, 1.6 m wide on a 9 m cell, at hue step 5 with glow 0.25. They light up in a travelling wave on each beat (#7), so the ground looks like it has circulation.
- **Downbeat glitter.** On the downbeat, wet blotches flash +1 step.
- **Figure/ground stays.** The body stays two steps below the walls (the review fix) and curbs stay grey. Only rims and veins lift.

**Street level:** the carpet becomes a neon map. Splat shapes are outlined in light, veins pulse under the bus, puddles glitter.
**250-500 m:** rims become 1-px bright contours around every splat, still readable at 2-3 m/px. The painted area gets a glowing outline instead of a flat sticker edge. Veins fade out by LOD.

**Technique:** `GLSL_GROUND_PAINT` in `src/world/GroundPaint.ts` returns two more outputs, `rim` (`cov - thr` in `[0.07, 0.07 + w]`) and `vein` (3x3 cell hash, `F2 - F1 < 0.08`, faded by `fwidth(cell) > 0.6`). The terrain material's paint branch (`terrainMaterial.ts`, about lines 80-89) uses them, and `fresh` becomes the piecewise white → step 7 → rest curve above. Settled texels (`serial 0`, `age = 100`) skip all of it.
**Perf and caps:** about 25 ALU on painted-ground fragments only. 0 draws, 0 uploads, and the mask format is unchanged.
**Effort:** 1 day.

### 3. Rainbow chain lightning — *the wave made visible*
**Trigger:** every blast (L1+). L2/L3 districts crackle ambiently on the beat. The firehose throws a bolt storm. The finale throws 60 bolts across the hood.

**The moment:**
- **f0 (held through hit-stop):** 3-6 jagged white-hot bolts already leap from the impact to the roofs of the nearest blooming buildings. The 4 frozen frames read as a photograph of an electric explosion.
- **0-0.3 s:** as the shockwave reaches each building (its `arrival` time, the same moment it blooms), a bolt jumps to its roof from the **nearest already-bloomed building**. The radial bloom becomes a branching lightning tree racing through the block. You can see the order of the chain reaction.
- **Each bolt:** lives 0.18 s and re-strikes, meaning a new jag, every 1/30 s of game time. Its core is white for 0.06 s, then it takes the target's hue step 6, then pixel-dissolves over the last 40%. About 30% of bolts throw a short fork. On landing the roof gets a 3-frame glow flash, and the existing sparkle crown fires.

**Afterlife:** in L2/L3 districts, on about every second beat, a bolt crackles between two painted buildings within 40 m of the bus. The candidates come from the `near` list main.ts already builds for the hum. A charged neighborhood visibly hums.

**Street level:** crisp 2-px zigzags flash in front of facades, Tesla-coil style but rainbow and playful, not menacing.
**250-500 m:** bolts stay 2 px wide and span 20-60 px. The whole blast area lights up as an electric web for 0.3 s, and it reads at any altitude.

**Technique:** `src/fx/Bolts.ts`.
- **Mesh and data:** one InstancedMesh of a 12-segment strip (24 tris). Instance attributes are `A.xyz + birthT` and `B.xyz + seed` in a 128-slot ring buffer.
- **Spawning:** the whole blast is pre-spawned at impact, with `birthT = arrival` for each, as **one** `addUpdateRange` upload. `Splat.ts` would expose its `plan` on `Blast` as `blooms: {x, y, z, at, hue}[]`; nearest-parent chaining is 96² work at most, once per blast.
- **Vertex shader:** the point at `s = i/12` is offset perpendicular to `AB` and the view by `hash(seed, i, floor(uTime * 30)) * 0.12 * |AB|`, zero at the ends. The strip is then expanded ±1 px in screen space (F4), so it is always exactly 2 px wide.
- **Fragment:** the center pixel is `GLOW_WHITE` step 7 and the edge pixel is hue step 6, both glow 1, so they get the halo and aura for free.

**Pixel and shimmer:** the bolts are deliberately 30 Hz flicker over about 0.2 s, not crawl, and they freeze cleanly in hit-stop.
**Perf and caps:** 1 draw, at most 3k tris, thin lines (negligible fill). CPU is only spawn at impact (under 0.05 ms), with 1 upload range per frame. Caps: 128 live bolts, 40 per blast (nearest first), ambient crackle at most 1 per beat.
**Effort:** 1.5 days.

### 4. Light pillars and district beacons — *the blast punches into the sky*
**Trigger:**

| Trigger | Pillar |
|---|---|
| Every blast | transient pillar on the primary: 300 m tall, up to 700 m at a 300 m drop (scales with `b.strength`) |
| L3 primary | twice as wide, with a halo ring orbiting it (#5) |
| District lit | a persistent beacon at the district heart |
| Finale | a giant 1500 m pillar, kept permanently (#12) |

**The moment** (a transient pillar):
- **f0 (held):** a white-hot column about 10 m wide (about 36 px at the impact distance of about 260 m) stands **fully extended** from the roof past the top of the frame. With F5, its aura washes the sky band and the roofs around it. It is the single most "explosive" frame in the game.
- **0.05-0.3 s:** it narrows to 6 m and splits into bands: a 2-px white core, then hue step 7, then the blast's rainbow fanning outward at step 5. "Energy slugs" (4 m segments at step 7) race up it at 420 m/s.
- **0.3-2.0 s:** the band order rotates (a twisting barber pole) and the slugs keep coming.
- **2.0-2.6 s:** the base detaches and the whole column launches upward (the bottom edge rises at 600 m/s) out of the frame. A ring of sparkles is left on the roof (`particles.sparkles`).

**Afterlife (beacon):** a 4-6 px wide column, at a constant pixel width at any distance, in the district's hue with a white core, 800 m tall. On every beat its width breathes by a pixel. Every bar, a slug climbs it. Flying through one gives a sparkle burst and a chime.

**Street level:** the transient pillar slices the whole frame vertically at the impact, the biggest possible statement on a portrait screen. Beacons stand on the horizon in the directions of lit districts. They work as navigation without a HUD ("the Mission is glowing, go back").
**250-500 m:** a field of 4-8 px beacons rises out of the city into the sky band, so the city's progress map is the skyline. From the full vista the camera is about 570 m up and the frame top sits about 14° above the horizon, so an 800 m beacon 1.5 km out reaches nearly to the top of the frame. With `?fog`, beacons rise out of the fog sea, which is gorgeous.

**Technique:** `src/fx/Beacons.ts`.
- **Mesh and data:** one InstancedMesh (16 instances) of a 1x8-row quad column. All per-instance data is in **uniform arrays** `uPillar[16]` (x, z, baseY, birthT) and `uPillar2[16]` (hue, height, widthM, kind), read via `gl_InstanceID`, so there are **no buffer uploads at all**.
- **The column is built in screen space** so its edges never shimmer:
```glsl
vec4 c = projectionMatrix * viewMatrix * vec4(P.x, baseY + aRow * H, P.y, 1.0);
float mpp = 2.0 * c.w / (projectionMatrix[1][1] * uViewPx.y);
float halfPx = max(floor(0.5 * widthM / mpp + 0.5), 2.0);       // integer, >= 2 px
float xpx = floor((c.x / c.w * 0.5 + 0.5) * uViewPx.x + 0.5);   // snap the center to a pixel boundary
c.x = ((xpx + aSide * halfPx) / uViewPx.x * 2.0 - 1.0) * c.w;   // edges land exactly on pixel edges
vAcross = aSide * halfPx;                                       // fragment: integer px bands
```
- **Fragment:** bands from `floor(abs(vAcross))`. The top 30% uses the screen-door dither (`sbScreenDoor`). Slugs are `fract((y - age * 420.0) / 55.0) < 0.12`.
- **Leaning:** the camera has no roll (CameraRig `up = (0, 1, 0)`), so verticals project near-vertical. Snapping per row gives a clean stair-step lean, never sub-pixel edges.
- **Placement:** beacons are not obstacles, and they sit at city depth, so up high they ride the steady snap.

**Perf and caps:**
- 1 draw, 256 tris, uniform writes only.
- Fill: a near transient pillar is at most about 15% of the screen for about 0.3 s. Beacons are about 3k px each.
- Cap: 16 instances, which is 2 transient plus 14 beacons (nearest districts by camera distance, with hysteresis).

**Effort:** 2 days.

### 5. Energy rings and halo crowns — *the explosion gets a 3D shape*
**Trigger:** every blast adds a horizontal echo ring. L2 primaries add a ring that climbs the tower. L3 primaries add a tilted spinning ring and leave a permanent halo crown. The firehose sends rings along the beam (#11).

**The moment:**
- **f0 (held):** a flat ring of white light, radius 8 m, floats 4 m above the impact roof.
- **0-0.35 s:** it expands on the **same curve as the ground shockwave** (`R(1 - exp(-age * v0 / R))`, `R = waveMax(r)`), so it rides above the ground ring as its echo in the air. It rises 0 → 25 m, thins from 6 m to 2 px, and turns from white to rainbow bands. It then dies the ring's way: a world-cell hash dissolve.
- **L2:** a vertical "coin" ring (horizontal axis, facing the camera) races up the tower at 200 m/s and shoots off the top.
- **L3:** a third ring, tilted 25° and spinning, also expands.

**Afterlife:** every L3 building keeps a **halo crown**: a thin 2-px ring in its hue with one white sparkle running around it, 6 m above its dome or spire. It rotates slowly and swells by a pixel on the beat.

**Street level:** you see the ring sweep past at rooftop height. Today the ring disappears behind trees and walls because it only exists on up-facing surfaces. Now the explosion has a volume.
**250-500 m:** the expanding ring reads as a nova outline even over Golden Gate Park's trees. Crowns are 3-5 px glints that mark L3 buildings from afar ("crowned buildings").

**Technique:** `src/fx/Rings.ts`.
- **Mesh:** one InstancedMesh of a 64-segment annulus (128 tris).
- **Data:** transient rings in uniform arrays (8). Crowns as an instance attribute (32 slots, written once when a building reaches L3, plus regrow on tile load, like `growSprouts`).
- **Vertex:** orientation by kind. Thickness is `max(widthM, 2 * mpp)`, expanded in the screen-perpendicular direction of the ring tangent (F4).
- **Fragment:** radial band → ramp (white leading band, then the rainbow from the blast hue, like `sbRing`).

**Perf and caps:** 1 draw, at most 5k tris, tiny fill, negligible CPU. Caps: 8 transient rings, 32 crowns (nearest).
**Effort:** 1.25 days.

### 6. Sunbreak — *warm sun breaks through over the paint; the rest stays grey overcast*
**Trigger:** continuous, driven by paint density. It is already partial after one blast and full at district lit. A visible sweep runs at district lit.

**The moment (district lit):** a circle of sunlight sweeps out from the district heart at 80 m/s, like a cloud shadow retreating in reverse. As it passes:
- sunlit faces climb 1-2 steps;
- shadows get deeper (ambient drops 25%) and sharper;
- the grey houses inside it reach the warm top steps of `GREY` / `GREY_LIGHT` (`#b3aca2`, `#d6d4cd`): late-afternoon Hopper sun on the grey.

The sky in the district's direction warms toward the horizon (`SKY_WARM`).

**Afterlife:** permanent. Each painted district sits in its own pool of golden late-afternoon light, and the unpainted city stays under flat overcast.

**Street level:** the grey neighbors of painted houses look **sunlit-golden instead of overcast**. That is the light spill the producer is missing, and contrast is where the wow comes from. The bus itself brightens as it flies into a painted district.
**250-500 m:** the strongest territory read after hue. Painted districts are pools of raking sun with long hard shadows in a flatter grey city. The sweep is unmistakable from altitude.

**Technique:**
- **Light term (`GLSL_COMMON`):** factor the existing `uPaintFog` sample (R8, 64 m cells, linear, already fetched in `sbFog` by every material) into a shared `sbPaintField(wp)`. In `sbLight`:
```glsl
float sb = uSunbreak.x * smoothstep(0.2, 0.7, sbPaintField(worldPos)) * sbSweep(worldPos);
float l = uLight.y * (1.0 - 0.25 * sb) + uLight.z * sky + uLight.x * (1.0 + 0.6 * sb) * ndl * sh;
```
  One blast (30 + 5 × 15 = 105/255 ≈ 0.41 at its center) already lights partially. A lit district saturates.
- **Sweep:** `uSunSweep` (x, z, t0, speed) is a single uniform for the newest district only. It uses a dithered 1-cell edge, and there are no texture uploads.
- **Sky:** in `RESOLVE_FS`, CPU fills `uSkyWarm[32]` (azimuth bins, from F3: strength × (1 - smoothstep(1 km, 8 km, dist)), spread ±2 bins) at 2 Hz. The sky branch does `warmS = max(warmS, clamp((lut(az) * (1.0 - 1.4 * e) - 0.5) / 0.08, 0.0, 1.0))`, and the existing dithered `warmS > ds` edge picks `SKY_WARM`. It is all palette.
- **Optional, finale only (#12): crepuscular shafts.** An 8-sample march along the view ray in the half-res glow extract: is the sample inside the sun column above a lit district, using the paint field shifted along `-uSunDir` to 600 m? The result is added to the glow buffer as `SKY_WARM` step-6 light. The resolve's halo path then turns it into dithered +2-step shafts on whatever they cross. About 0.6M fetches at half res, so it runs only during the finale or while the effect is on screen.

**Perf and caps:** 0 draws. Every material gets one extra bilinear fetch of a 34 KB R8 texture plus 2 MAD, and the sky gets 1 array lookup. The paint field keeps its existing `needsUpdate` path; when bumps get frequent, move it to `uploadRect` (one upload per frame at most).
**Effort:** 1.5 days (+1 for the optional shafts).

### 7. District heartbeat — *painted districts pulse on the beat*
**Trigger:** lit districts (up to 4 nearest). L1-heavy districts pulse softly, L3-heavy districts strongly. During the finale the whole hood pulses at double strength.

**What you see:**
- **Every beat (84 BPM):** from each lit district's heart, a ring of light races outward **only over painted ground and painted roofs**, out to 200 m in one beat (about 280 m/s). It is +1 step with a white leading pixel and glow 0.4.
- **Grey ground is untouched**, so the pulse traces the painted shape like neon through veins. It also lights up #2's veins as it passes.
- **Downbeats** (every 4th beat): the ring is twice as wide and rainbow-banded, like the blast ring.
- **Painted walls:** a 2 m +1-step band rises up each facade on each beat ("the buildings breathe up").
- **Sound:** F2's hum swell lands on the same beats. With sound off, the pulse carries the rhythm alone.

**Street level:** the ground under the bus throbs, and the painted carpet becomes alive and musical.
**250-500 m:** concentric sonar pulses radiate from every district heart; the city has heartbeats. The band width is at least 3 px, so the pulses read at 2-3 m/px.

**Technique:** `GLSL_PULSE` lives in `GroundPaint.ts`, next to its sibling `GLSL_BLAST_RING`. It uses `uPulse[4]` (x, z, reach, strength, set by F3 at 2 Hz) and `globals.uBeat`. The terrain uses it inside the paint branch only; buildingMaterial uses it on painted roofs and walls, scaled by `level / 3`.
```glsl
float sbPulse(vec3 wp, float bandW) {           // bandW = max(5.0, 3.0 * mpp)
  float best = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 c = uPulse[i];
    float d = length(wp.xz - c.xy);
    float x = (uBeat.x * c.z * 1.15 - d) / bandW; // 0 at the leading edge
    if (c.w > 0.0 && x >= 0.0 && x < 1.0 && d < c.z) best = max(best, c.w * (1.0 - x) * (1.0 - d / c.z));
  }
  return best;
}
```
**Anti-strobe:** at most +1 step (+2 on downbeats, band only), never a whole-surface flash, at most 1.4 Hz. `pulseGain` is tunable and goes to 0 under `prefers-reduced-motion`.
**Perf and caps:** about 30 ALU on painted fragments only, 0 draws, uniforms only. Cap: 4 centers.
**Effort:** 1.25 days (with F2).

### 8. Rainbow bridges — *rainbows link what you painted*
**Trigger:**
- A blast whose primary is 80-600 m from the previous blast's primary, or from the nearest lit district heart, spans an arc from there to the new one.
- District lit: arcs to the 2 nearest lit districts.
- Finale: arcs to every lit district within 2 km.

**The moment:**
- **f0:** a white-hot spark leaves the new primary's roof.
- **0-0.6 s:** the arc **draws itself**. The head (a `GLOW_WHITE` star) races along a parabola with apex 0.3 × span (at least 60 m), trailing 7 bands that unfurl from a 2-px white thread to full width.
- **At landing:** a sparkle splash plus a chord tone (`audio.bloomNote`).

**Afterlife:** the arc stays as a **permanent rainbow bridge**, red outside to violet inside like a real rainbow, at step 5, glow 0.35. On every bar a one-band `GLOW_WHITE` sheen runs along it. L3 at either end thickens it by a band of pixels. Flying through one gives a chime and sparkles.

**Street level:** rainbow arches over the rooftops ahead, literally rainbow bridges across streets, anchored on painted buildings. This is Townscaper and Hundertwasser whimsy.
**250-500 m:** a web of rainbows arcs above the city between districts: your progress, stitched together. Spans of 600 m peak 180 m up, so from altitude they visibly stand off the ground. This is the best "look what I did" screenshot in the game.

**Technique:** `src/fx/Rainbows.ts`.
- **Mesh and data:** one InstancedMesh of a 48-segment strip (96 tris). Instance attributes are `A.xyz + birthT`, `B.xyz + hue0`, `widthM + flags`, in 32 slots.
- **Writes are rare:** spawn writes one range. Arcs are saved as stableId pairs in `strugglebus.arcs.v1` (at most 64) and rebuilt as tiles load.
- **Vertex:** `P(s) = mix(A, B, s) + up * 4 * apex * s * (1 - s)`, then expanded across in screen space (F4). Half-width is `max(widthM / 2, 7 bands × 2 px / 2 × mpp)`, so **each band is at least 2 px** at every distance (about 6 m wide near, about 35 m at altitude, always about 14 px on screen).
- **Fragment:** `band = floor((v * 0.5 + 0.5) * 7.0)`. The draw-in is a discard for `s > head(age)`.

**Pixel and shimmer:** step-5 neighbors are luminance-matched, so the inevitable 1-px edge steps of a curve under camera motion are low contrast. There is no single-pixel stripe anywhere.
**Perf and caps:** 1 draw, at most 3k tris. A near arc's fill is thin bands. Cap: 32 live arcs (the farthest are culled from the draw, not from the save).
**Effort:** 2.5 days.

### 9. Aurora curtains — *the sky over a completed district comes alive*
**Trigger:** district finale (rare and earned; at most 6 curtains city-wide).

**The moment:**
- The district beacon flares.
- From its top, a curtain **unrolls sideways** in both directions along an ellipse around the district (the head moves at 120 m/s each way). Its lower edge sits 60 m above the tallest roof, and it is 120-220 m tall.
- **Lower edge:** a 2-px bright line (district hue, step 7, glow 0.8).
- **Body:** vertical rays with screen-door density falling with height, shifting hue A → A+1 → A+2 as it rises (for a green district: green → blue → violet) and dissolving into sky at the top.

**Afterlife:** a slow travelling sway (0.15 Hz, 15 m), drifting rays, and on every downbeat a brightening ripple running along the lower edge.

**Street level:** above the rooftops ahead, the curtain's lower edge cuts across the sky band and dithers over the distant city. The bus at 60-200 m flies right through it (shimmer burst and chime).
**250-500 m:** the killer altitude moment. The aurora hangs at eye level, and you fly between luminous curtains over a city you painted.

**Technique:** `src/fx/Aurora.ts`.
- **Mesh and data:** one InstancedMesh of a strip (96 columns × 1 row, 192 tris), double-sided. Per-curtain uniforms `uAur[6]`, `uAur2[6]` (center, radii, yaw, birthT, hue, height).
- **Vertex:** the angle range grows from birth. `y = lower + v * height`, and the sway is radial.
- **Fragment:**
  - density = `(1 - v)^1.5 * rays`, where `rays` are world 4 m columns; LOD drops rays when a column is under 2 px;
  - `sbScreenDoor(density)` keep or discard;
  - lower edge = `v < max(0.02, 2 * mpp / height)` at step 7;
  - body light `sbStep(5..6)`, glow `0.3 * (1 - v)`.
- **Up high (calm ≥ 0.5):** the screen door switches to a 2x2-block Bayer (4 levels), so a big dithered sheet never boils into a fine checkerboard.

**Perf and caps:**
- Triangles are trivial; fill is the cost. A near curtain can cover 30-50% of the screen with discard-heavy fragments, which on Apple's tile-based GPU loses hidden-surface removal for those pixels.
- Caps:
  - drawn last;
  - at most 2 curtains at full density;
  - the CPU estimates projected coverage, and above 35% of the screen the density and height scale down;
  - 6 curtains maximum.

**Effort:** 3 days (mostly look-dev).

### 10. Magic dust — *resident sparkle storms over painted blocks*
**Trigger:** every bloom leaves motes behind: L1 4, L2 10, L3 24. The finale adds a vortex of 3000 that spirals up for 8 s and settles into the field.

**The moment:** the existing sparkle crown fires at bloom (`particles.sparkles`). Then a few motes **stay**: they drift in slow orbits 2-12 m above the roof and twinkle as 4-point stars of 1-3 px, in the building's hue ±1 plus 40% `GLOW_WHITE`.
**Afterlife:** permanent. On each beat, motes twinkle in a sync wave (phase = distance from the district heart), a ripple of glitter. "Nothing moves in grey"; now everything painted visibly moves.

**Street level:** painted blocks glitter like fireflies and pixie dust in every frame.
**250-500 m:** a glittering haze over painted districts, and the sync wave reads as shimmering bands rolling across the district. Twinkle is deliberate there, not boil. LOD keeps fewer, larger (2-px) motes as distance grows, so there is no 1-px noise carpet.

**Technique:** `src/fx/MagicDust.ts`.
- **Buffers:** THREE.Points with a static attribute buffer (home xyz, seed, hue, birthT), with slots allocated per building through a free list and bucketed into 768 m city cells for frustum culling, exactly the RoofSprouts `Batch` pattern.
- **Vertex:** orbit, bob, twinkle and integer `gl_PointSize`. The fragment reuses Particles' star sprite (export `FRAG`'s star branch as a GLSL chunk).
- **CPU:** zero per frame. Uploads happen only at bloom (one range).

**Perf and caps:** +1 draw per visible cell (typically 2-4), at most 12k points city-wide (farthest buildings evicted, regrown on tile load), tiny fill.
**Effort:** 1.75 days.

### 11. Prism Beam — *the firehose's energy, plus a diegetic charge and cooldown ring* (with feat/supersplat)
**Trigger:** the hold-to-charge super splat.

**Charge (the hold, about 10 s):**
- The bus's halo ring (a Rings kind) fills around it in 12 hue segments, one every 0.83 s.
- Painted districts within about 1 km lend their energy:
  - dust motes stream toward the bus (Particles `fling`, re-aimed each spawn at the bus's position 0.4 s ahead);
  - **beacons lean toward the bus** (the vertex shader offsets the pillar top toward the bus by charge²): the city's light bends to you;
  - the beat clock (F2) ramps from 84 to 126 BPM, so the heartbeat races.
- At 100%, the ring snaps white and spins, with a sky-band flash on the downbeat.

**Release (about 3 s torrent):**
- The torrent gets a beam core: Beacons' screen-space column generalized from vertical to any axis, running from the mouth to the landing point. It has a 3-px white core, 7 bands, and slugs racing to the target at 300 m/s.
- An energy ring travels down the beam every 0.1 s.
- Chain lightning (#3) jumps from the landing point to every building it soaks, 8 per second.
- The landing sweep leaves a white-hot line on the ground (#2's reveal curve with a 0.8 s cooling for firehose serials).
- At the end, a pillar flares at the final landing point.

**Cooldown (60 s):** the halo ring around the bus empties to grey and **relights one segment every 5 s**. That gives an obvious, diegetic 1-minute cooldown with no HUD, matching the game's "belly glow = recharge" rule.

**Street and altitude:** the beam is a screen-constant 3-7 px wide, so it reads the same at the floor and from 500 m.
**Perf and caps:** reuses Beacons, Rings and Bolts, so no new draws.
**Effort:** +1.5 days, once #3, #4 and #5 exist.

### 12. Supernova — *the district finale*
**Trigger:** F3's finale threshold for a district (once per district, saved).

**Timeline:**
- **t = 0:** the finishing blast's flash runs 3 frames instead of 1, with 8 hit-stop frames.
- **0-0.5 s:** every painted building in the district re-flares its windows (#1's pop) in a wave from the heart. This uses a uniform `uFlare` (x, z, t0) that buildings test by distance, with no paint-texel writes.
- **0.3 s:** the giant 1500 m pillar (#4, 40 m wide) erupts from the heart.
- **0.5-1.5 s:** rainbow bridges (#8) launch to every lit district within 2 km.
- **1-3 s:** a chain-lightning storm across the district (#3, 60 bolts).
- **1.5 s:** the sunbreak sweep (#6), with crepuscular shafts for 6 s, then the aurora unrolls (#9).
- **2-8 s:** the dust vortex (#10).
- **Audio:** the progression resolves to I with a full-chord swell.
- **Sign:** the street sign shows the neighborhood name in `GLOW_WHITE`.

**Afterlife:** a permanent giant beacon, aurora, bridges and a stronger heartbeat for that district.
**Perf and caps:** one finale at a time. The dust vortex drops to half while `workMs > 6`, and the shafts run only during the finale.
**Effort:** +1.5 days of orchestration.

---

## 5. The escalation ladder (what the player gets, when)

| Moment | Energy |
|---|---|
| **L1 bloom** | molten flood + window pop (#1), white-hot ground reveal + neon rims (#2), a bolt into it (#3), dust ×4 (#10) |
| **L2** | candle-flicker windows, a tower-climbing ring (#5), ambient crackle (#3), veins in its ground (#2), dust ×10 |
| **L3** | windows breathe on the beat, a halo crown (#5), a 2× pillar (#4), dust ×24 |
| **Every blast** | chain lightning tree (#3), transient pillar (#4), echo ring (#5), sunbreak field bump (#6), a bridge if it is near the last blast (#8) |
| **District lit** | permanent beacon (#4), heartbeat source (#7), sunbreak sweep + warm sky (#6), bridges to the 2 nearest lit districts (#8) |
| **Firehose** | Prism Beam, beam rings, bolt storm, white-hot sweep, beacons lean in, diegetic charge and cooldown ring (#11) |
| **District finale** | Supernova (#12): giant beacon, aurora, bridges to all, sun shafts, dust vortex |

---

## 6. Performance roll-up (A15, 30+ fps)

- **Draws:** +1 each for Beacons, Bolts, Rings, Rainbows and Aurora, plus 1-4 for dust: **+6 to +9**, against 120-200 today. There are no per-building draws; everything is instanced or uniform-driven.
- **Triangles:** about 0.25k + 3k + 5k + 3k + 1.2k, under 15k, plus at most 12k points, against 1.0-1.5M today.
- **Uploads:** Beacons, Aurora, transient Rings and Pulses use uniforms only. Bolts, Rainbows, crowns and dust write at most one `addUpdateRange` per buffer per frame (ring-buffered, contiguous), and only on spawn frames. The paint field keeps one upload per frame at most.
- **GPU fragment:**
  - building fragment about +20 ALU and painted ground about +25;
  - every material +1 R8 fetch (sunbreak);
  - resolve: +1 aura fetch and a sky LUT;
  - aura pyramid: 3 small blits, about 0.05 ms.
  - Fill risks are the near transient pillar (at most 15% of the screen for 0.3 s) and the aurora (capped at 35% coverage, drawn last).
- **CPU:** Districts at 2 Hz under 0.05 ms, uniform packing about 0.01 ms per frame, blast spawns under 0.1 ms on impact frames (which already carry about 0.5 ms of ground work).
- **Hit-stop:** everything is keyed on `uTime`, so it freezes with the game, and the frozen pose is designed to be the peak.
- **QA:**
  - `tools/blast.mjs perf` A/B before and after each milestone (grey hover, blast, escalation, settled);
  - `__qa.holdFrames` to step through f0 and the hit-stop frames;
  - shots at the chase camera and from 250 m and 500 m;
  - a `dev/energy.html` harness page with grey blocks for look-dev.
  - Judge perf on a device, not SwiftShader.

## 7. Build order

1. **M1, "it glows" (2.5 d):** F1, #1, #2. Zero new draws, and the biggest change in look per hour.
2. **M2, "it explodes upward" (4.75 d):** F4, #3, #4, #5, F5 (aura).
3. **M3, "the city responds" (3 d):** F2 beat, F3 districts, #6 sunbreak, #7 heartbeat.
4. **M4, "the sky is the reward" (7.25 d):** #8 bridges, #9 aurora, #10 dust.
5. **M5, "the big moves" (3 d):** #11 with feat/supersplat, #12 finale.

If the budget forces cuts: drop #10, then #9. Keep #1-#4 at all costs; they carry the brief.

## 8. Risks and guard rails

- **Halo storm / white mush.** GLOW_WHITE only on cores, edges and moments. The resting glow cap is 0.7. The aura extracts only glow 0.6 and above.
- **Figure/ground** (the earlier review fix). Ground bodies stay 2 steps below walls and curbs stay grey. Only rims, veins and pulses lift.
- **Photosensitivity.** Pulses are at most +1 step and at most 1.4 Hz, never full-screen. Flashes stay at today's 1 frame (3 only at the finale). `prefers-reduced-motion` or a tunable `calmEnergy` scales pulses, crackle and flicker to 0.
- **Discard fill on tile-based GPUs.** Energy meshes are drawn last and screen coverage is capped (aurora). Pillars and beams are built in screen space at integer widths.
- **Saved-state growth.** Arcs are capped at 64 and district cells at 200. Both are small JSON entries, separate from the existing paint and ground keys.
- **No brown.** Warm hues are never used below step 3 in any energy effect. The cooling curve ends at the resting saturated middle, never a dark step.

## 9. Shared-file notes for the owners

- **`src/render/materials.ts`:** globals `uDitherOrigin`, `uViewPx`, `uBeat`, `uSunbreak`, `uSunSweep`; `sbBayer`, `sbScreenDoor`, `sbStep`, `sbPaintField`; the sunbreak term in `sbLight`.
- **`src/render/PixelPipeline.ts`:** share `ditherOrigin` with the globals, the quarter-res aura level, the parity-locked glow grid, and `uSkyWarm[32]` in the resolve sky branch.
- **Existing issue:** the altitude window melt in `buildingMaterial.ts` is gated on `uFogLayer2.w > 0.001`, which is 0 while fog is off (the current default). Painted and grey windows therefore never melt up high and can alias. #1's altitude rule keys on `mpp` alone; the grey melt should too.
- **`src/game/Splat.ts`:** expose the bloom plan on `Blast` (`blooms: {x, y, z, at, hue, level}[]`), so Bolts and Rainbows pre-spawn in one upload at impact.
- **`src/main.ts`:** owns the beat clock, the Districts wiring, and spawn calls in `SplatFx.impact` / `bloom` and `city.onTile`.
- **`src/audio`:** `AudioEngine.pulse(downbeat)`, a hum swell. The progression stays as it is.

## 10. Open questions for the producer

1. **Tempo.** Is a resting heartbeat of about 84 BPM right, racing to about 126 during the firehose charge? Or should the pulse follow the hum's slow breath?
2. **Lightning tone.** I'm proposing rainbow, glittery, short-lived bolts (Tesla-coil joy, not storm menace). Is lightning in the brand?
3. **Aurora in late afternoon.** It is physically impossible, and that is the point: fantastical over Hopper. Okay to break the grey sky that hard, but only at a district finale?
4. **Beacons as navigation.** Persistent beacons double as a "where have I painted" map with no HUD. Should they also appear before their tiles load (from the saved district summary), so the skyline shows your whole history from the first frame?
