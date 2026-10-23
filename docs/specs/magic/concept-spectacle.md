# Concept: Spectacle & Motion ("the city throws a party")

**The angle.** In the painted city everything moves and celebrates. Buildings jump, squash and dance on the beat. The paint arrives as a towering tsunami of colour. Confetti and fireworks fill the air, rainbow twisters rise, huge hits go into slow motion, the camera choreographs every blast, a finished district throws a carnival, and the music grows with the paint. "Nothing moves in grey" stays the rule, so the contrast is the point: **grey is still, paint is a party.**

This doc complements `concept-energy.md` (light, glow, beams, aurora). Where both need the same thing (a beat clock, a district tracker, the dither origin in `globals`), it is the same foundation, built once. The two concepts stack: energy gives the paint its light, this concept gives it its motion.

Read for this: ARCHITECTURE, DECISIONS, COMMON, `PixelPipeline.ts`, `materials.ts`, `palette.ts`, `buildingMaterial.ts`, `GroundPaint.ts`, `Particles.ts`, `props/*`, `AudioEngine.ts`, `Splat.ts`, `main.ts`, `CameraRig.ts`, and the contact sheets `shots/merge1|merge2/contact.png` and `shots/v6/regress/painted.png`. No repo file was edited and no browser was run.

---

## 0. Diagnosis: why it reads as conservative

From the shots (merge1 #2/#4/#5, merge2 #2/#6, v6 painted):

1. **The colour lies flat.** Paint lives on surfaces: walls, roofs and a ground carpet. Apart from domes, spires and garden trees, nothing rises above the roofline. From altitude (merge2 #6, merge1 #5) a painted block is a quilt of saturated rectangles lying on the map, with nothing in the air over it.
2. **The event lasts less than a blink.** Every building pops inside about 0.3 s, with an 18 % squash and a 0.55 s pop. At the chase camera that is one flicker. Then the 4 hit-stop frames end and the scene is done.
3. **Nothing celebrates afterwards.** After about 1 s the only motion is sprout sway, bunting flutter, the slow wall wobble (0.32 m) and the occasional twinkle. The city is painted, but it is not happy.
4. **The camera never reacts.** A 2.2 m translation kick is the only cinematic beat. A 76-building blast from 300 m gets the same treatment as a 3-house tap.
5. **The music does not grow.** The chord advances per splat and the hum fades in near paint, but a fully painted district sounds like the first painted house.

## 1. Rules for motion in this engine (so "more" never becomes boiling pixels)

| # | Rule | Why, in this engine |
|---|---|---|
| R1 | **Move 2+ game pixels or not at all.** Every vertex animation computes its amplitude in pixels at the vertex (`mpp = 2·clip.w / (projectionMatrix[1][1] · viewH)`) and fades it out below about 1.5 px. | Sub-pixel motion toggles edge pixels on and off: shimmer on every beat. At the chase camera 1 px is 0.19 m at the bus and about 0.28 m at the blast. From 250-500 m it is 0.48 m at the bus and **1.2-2.5 m on the city** (390 px frame). |
| R2 | **Step time, not just space.** Patterns that travel across a surface (marquee bulbs, curl lines) advance one whole cell per beat subdivision. They never scroll smoothly. | A smooth sub-pixel scroll crawls. A stepped one reads as a deliberate pixel-art animation. |
| R3 | **Camera choreography is translation-only.** Lock the orientation and translate. Hold the grid scale with `pipeline.steadySnap` during the move. | `PixelPipeline.snap()` makes a pure translation perfectly crisp: whole-pixel steps plus the upscale shift, with the dither anchored. A rotation or a FOV change resamples every pixel, which is the swim the vista lens work fought. |
| R4 | **One clock.** Dance, marquee, resident fireworks and the groove all run on `uBeat`. | Many things moving on one clock reads as choreography. Many things on their own clocks reads as noise. |
| R5 | **Peak, then rest.** The big spectacle is an event of 3 s or less. The afterlife is a gentle loop at a quarter of the peak amplitude or less. No full-surface change faster than 2 Hz. | It keeps every frame screenshot-worthy and keeps it readable. |
| R6 | **Indexed colour only.** New geometry goes through `sbWrite` (ramp, light, fog, glow). Fades and deaths are dithered `discard` anchored to the snapped grid, never alpha. Colour cools by stepping down a ramp, never by going grey. Yellow and orange never go below step 3, because their deep steps go brick. | The resolve quantizes everything. There is no free RGB and no brown. |
| R7 | **To read from altitude, rise above the roofs.** Only what stands up out of the city plane reads at 1-2.5 m/px: wave walls, fireworks, twisters, balloons, confetti clouds, towers whipping. | This is why almost every effect below has a vertical component. |
| R8 | **Near objects get the snap remainder at their own depth.** | Up high the grid snaps at the city's depth (`snapCompensation`). Anything that lives at the city's depth must not take the bus's compensation (today *all* particles do, see S5). |

---

## 2. Foundations (shared, built once)

| ID | What | Where | Cost |
|---|---|---|---|
| **S1** | **`Spectacle` director.** It scores every blast from `Blast` (count, maxLevel, strength, L3 escalations, drop) into a tier: **small** (fewer than 12 buildings and no L3), **big** (12+ buildings, any L3, or drop 120 m+), **huge** (28+ buildings, 6+ escalations to L3, or drop 250 m+ with 40+ buildings), plus **firehose** and **finale**. It owns the cooldowns (huge every 10 s at most, crane every 5 s), the particle budget (live fraction of each pool), perf adaptation (EMA of `workMs` above 6 ms drops a tier, below 4 ms restores it) and reduced motion (`prefers-reduced-motion`: dance gain 0, no camera moves, slow-mo shortened, confetti halved). It is fed from the existing `SplatFx.impact` / `bloom` callbacks in `main.ts`, and from the supersplat state machine (charge 0..1, release, stream tick, end). | new `src/game/Spectacle.ts`; hooks in `main.ts` | <0.02 ms |
| **S2** | **Beat clock** `globals.uBeat = (beat phase, beat index, bar phase, energy)`. This is the same clock as concept-energy F2: define it once, tempo 84-96 BPM (tunable). When audio is live it is derived from the AudioContext clock (the groove scheduler, effect #11). Otherwise it falls back to wall time at the same tempo, so motion stays choreographed with sound off. `energy` is #11's paint energy E (0..1). Also `uDance = (gain, L1 amp, L2 amp, L3 amp)`, which the director ducks to 0 in hit-stop and slow-mo. | `materials.ts` globals, `main.ts` | ~0 |
| **S3** | **Time scale.** `main.ts` gets `dt *= spectacle.timeScale(realDt)` after the hit-stop branch. `simTime` feeds `globals.uTime` (pops, flood, ring, ground reveal) and the particle clock, so the whole world slows together. `applyKick` already runs on `realDt`. | `main.ts` | 0 |
| **S4** | **Pixel helpers in `GLSL_COMMON`:** `globals.uDitherOrigin` (share `PixelPipeline.ditherOrigin`, as the resolve already does) and `globals.uViewPx` (G-buffer W, H). Add `sbMpp(clip)` and `sbDissolve(k)` = `bayer4(gl_FragCoord.xy + uDitherOrigin) < k`. Same as concept-energy F1. | `materials.ts`, `PixelPipeline.snap()/resize()` | 0 |
| **S5** | **Per-vertex snap compensation.** Expose `globals.uSnapComp = (snapShift.xyz, snapDepth)` from `snap()`. New effect shaders add `p += uSnapComp.xyz · (1 − viewDepth / uSnapComp.w) · uVistaOn`, so a balloon next to the bus and a firework over the city each sit exactly right up high. A **second `Particles` pool** for celebration particles (confetti, fireworks, orbits) stays at the origin. Today `particles.object.position = snapCompensation(bus)` is applied to every particle, so far bursts would jitter by up to the snap remainder. Its own ring also stops long-lived confetti from being overwritten by the next blast's splash: the ring buffer wraps, it has no free list. | `PixelPipeline.ts`, `main.ts`, `Particles.ts` (shader include) | +1 draw while alive |
| **S6** | **`GLSL_JELLY`**: one shared vertex function giving a building's pop / dance displacement from its paint texel, used by `buildingMaterial` *and* by the rooftop sprouts. Sprouts get a per-instance `aBld = (paint index, ground y, center x, z)`, so a garden rides its building's jump exactly. Today sprouts can't follow a pop, which is why `sproutDelay` waits it out. | `buildingMaterial.ts`, `props/sprouts.ts` (`RoofSprouts.set(..., baseY)`, `Batch` gets one more `InstancedBufferAttribute`) | 1 texelFetch per sprout vertex |

---

## 3. Ranked summary (wow per cost)

Wow is 1-10 (art-director judgement). Days are engineer-days including look-dev, QA shots and tuning. Ratio = wow / days.

| Rank | Effect | Triggers | New draws | New tris | Days | Wow | Ratio |
|---|---|---|---|---|---|---|---|
| 1 | **Money-shot slow motion** | huge blast, firehose release, finale | 0 | 0 | 0.75 | 8 | **10.7** |
| 2 | **Confetti storms** (tumbling 2-px chips) | L2/L3 escalations, big blasts, firehose, finale | 0 (S5 pool) | 0 | 1 | 7 | **7.0** |
| 3 | **Jelly jump** (blooms jump, hop, whip, twist) | every bloom, by level | 0 | 0 | 1.25 | 8 | **6.4** |
| 4 | **Fireworks** (shells, peonies, willows, crackle) | big/huge, L3, firehose, resident L3 domes, finale | 0 (S5 pool) | 0 | 1.5 | 9 | **6.0** |
| 5 | **Window cascade + marquee bulbs** | L1 cascade, L2 bulbs, L3 winks, finale | 0 | 0 | 1 | 6 | **6.0** |
| 6 | **Rainbow tsunami** (the wave as a 27-54 m wall of surf) | every blast; firehose train | +1 transient | ≤4.8k | 2 | 10 | **5.0** |
| 7 | **Translation-only camera choreography** | every tap (lean-in), big/huge (crane), firehose, finale | 0 | 0 | 1.5 | 7 | **4.7** |
| 8 | **Beat dance** (pump, shimmy, stadium wave) | resident on all paint, by level and music energy | 0 | 0 | 1.75 | 8 | **4.6** |
| 9 | **Rainbow twister + charge inhale** | firehose (charge and torrent), huge, finale; small L3 dust devils | +1 transient | ≤8k | 2 | 8 | **4.0** |
| 10 | **Balloon flotilla** | L3 reached, district lit, finale; resident trickle | +1 | ≤15k | 2 | 7 | **3.5** |
| 11 | **Music that builds with paint** (beat-locked groove layers) | paint energy near the bus, L3 share, firehose, finale | 0 | 0 | 3 | 8 | **2.7** |
| 12 | **District carnival** (finale orchestration) | district complete | 0 new | 0 | +1.5 | 10 | **6.7\*** |

\* Incremental cost on top of #1-#11, which it sequences.

**Totals.** At most 3 new draws at the peak (wave, twister, celebration pool) and +1 resident (balloons), against 120-200 today. At most 30k new triangles at the peak, against 1.0-1.5M. About 0.05 ms resident CPU per frame and spawn bursts under 0.4 ms, spread across arrival times. Budget: about 19 days for all twelve (the beat clock is counted in #8, S6 in #3), plus about 1 day for the other foundations: about 20 days.

**If only three get built:** #1 + #3 + #6 (about 4 days). They compound: the wave rolls through the block, each house jumps as the crest lifts it, and the whole moment plays in slow motion.

---

## 4. The effects (in rank order)

### 1. Money-shot slow motion
**Trigger:** director tier **huge**, the firehose release, and the district finale. Cooldown 10 s, never on two blasts in a row, never in the opening.

**What the player sees:**
- **Tap → impact:** unchanged (squash, inhale, jet). Impact frame: palette flash, kick, then the existing 4 hit-stop frames.
- **Then, instead of snapping back to 1x:** time runs at **0.2x for 0.35 s** (real time), easing to 1.0x over the next 0.7 s (smoothstep). About 1.05 s of real time shows about 0.45 s of game time.
- **During it:** the shockwave ring crawls outward and every house's jelly jump (#3) unfolds in readable stages: squash, launch, hang, land. The tsunami crest (#6) curls in slow motion. Burst-fountain drops and flung blobs hang in the air like jewels. Sparkle stars twinkle slowly, and the bus hangs in its rear-up pose.
- **Exit:** time returns to 1x exactly on the next downbeat of the beat clock (S2), where the groove's drum fill (#11) lands.

**Afterlife:** none. It is punctuation.

**Street level:** you see the blast's anatomy for the first time: rows of Victorians leaping one after another as the wave passes them.
**250-500 m:** the 76-building ring expands slowly over the quilt of roofs, towers whip in sequence (#3) and shells rise (#4). It turns an altitude shot into a set piece.

**Technique:**
- `Spectacle.timeScale(realDt)`, applied in `main.ts` right after `if (hitStop > 0)`: `dt *= ts`.
- Everything that animates reads `simTime` / `globals.uTime` or the particle clock, so it all slows together: building pops (`paint.b` bloom times), the color flood, `sbRing`, `GroundPaint` reveals (`uGroundLive` times are sim clock), particles, `Splatter.update`, `Flight.step`, `CameraRig.update`.
- The camera springs integrate the scaled dt, so they slow too and don't lurch. `applyKick` stays on `realDt`.
- **Audio:** `AudioEngine.slowmo(depth, seconds)`:
  - a master low-pass sweep (18 kHz → 900 Hz → back),
  - the hum detuned −300 cents over 0.15 s,
  - a reverse-swell "whoomp" that resolves on the exit downbeat.

  One-shots already scheduled keep their real timing, which is fine: the boom is what you hear in slow motion.

**Pixel art:** slower motion means fewer changed pixels per frame. No new surfaces.

**Perf and caps:** 0 draws, 0 triangles, about 0 CPU. Flight substeps (1/120 s) stay valid at any dt. Cap: once per 10 s and 1.2 s of real time at most. Under reduced motion: 0.5x for 0.25 s.

**Effort:** 0.5 days + 0.25 days audio.

### 2. Confetti storms
**Trigger:**
- **L2/L3 escalation:** a confetti cannon from that roof (cap 8 cannons per blast).
- **Big/huge blast:** a confetti cloud over the whole blast radius.
- **Firehose:** a continuous confetti geyser at the impact.
- **Finale:** a district blizzard and ticker tape streaming off towers.

**What the player sees:**
- **Cannon (at the building's bloom time + 0.08 s):** a cone of 60-120 chips shoots 15-25 m up, smeared into streaks by their speed (the existing motion smear).
- **At the apex they open into a tumbling cloud.** Each chip is a **2×1-pixel bar** that cycles through four poses: flat, diagonal, upright, edge-on (a single pixel). It flips every 3-5 frames at its own rate and alternates between two steps of its ramp, lit front and shaded back. This is the pixel-art confetti signature: it glitters without any free colour.
- **They fall at 2.5-4 m/s terminal velocity** with a lateral flutter of ±0.8 m (two sines).
- **They land on roofs and streets** and lie still for 1.5 s as single pixels, so a big hit leaves the block littered with colour. Then they blink out in a Bayer-ordered hash.

**Afterlife:** a few seconds of litter. Confetti is an event (R5); the resident celebration is fireworks and balloons.

**Street level:** dense, close and parallaxing in front of the city; near blasts throw it into the lens.
**250-500 m:** chips are spawned at `max(0.55 m, 2·mpp)` from the camera distance at spawn (`pipeline.pixelWorldSize(d)`), so up high a cloud is 1-2 px glitter. A cloud of twinkling coloured pixels hovering over the painted block reads as confetti.

**Technique (in `Particles.ts`):**
- New kind `K_CONFETTI` (analytic, like every kind):
  - drag launch, then drag-limited fall: `p = p0 + v0·(1−e^{−kt})/k + (0, −vt·(t − (1−e^{−kt})/k), 0)`;
  - plus flutter `x += A·sin(ωt + φ)`, `z += A·cos(1.3ωt + φ)`;
  - the floor `aP1.x` comes from `city.roofAt ?? groundAt` at the landing estimate `p0.xz + v0.xz/k`. Once `y ≤ floor` it clamps, and flutter and tumble stop.
- New sprite shape 3 (a 3×3 sprite, only a 2-pixel chip lit):
  ```glsl
  float pose = floor(fract(age * vFlip + seed) * 4.0);        // flat, diagonal, upright, edge-on
  bool on = pose < 0.5 ? (c.y == 0.0 && c.x >= 0.0) : pose < 1.5 ? (c.x == c.y && c.x >= 0.0)
          : pose < 2.5 ? (c.x == 0.0 && c.y >= 0.0) : (c == vec2(0.0));
  if (!on) discard;
  st = mod(pose, 2.0) < 1.0 ? stFront : stBack;               // two steps of its own ramp (yellow/orange: 4/6)
  ```
- Hues: the blast's six, 15 % `WHITE` and 8 % `GLOW_WHITE` glints. `flags = 0.5`.
- Lives in the S5 celebration pool (8000 slots), so long-lived chips aren't overwritten by the splash and have no bus compensation.

**Perf and caps:**
- 0 draws beyond S5. About 40 ALU per chip vertex.
- Spawns ride the arrival times (each cannon fires at its building's bloom), so 3000 chips (about 290 KB written) spread over about 0.3 s, at most 0.2 ms per frame.
- Caps: at most 4000 chips alive, halved when `workMs > 6`.

**Effort:** 1 day.

### 3. Jelly jump: blooms that jump, hop, whip and twist
**Trigger:** every bloom. The style follows the level and the building's height.

**What the player sees** (per building, starting at its arrival time, so the jumps ripple outward):
- **L1 house:** frames 0-2, an anticipation squash to 0.78. Then a springy stretch to **1.30x** (capped at +4 m), back down to 0.85 on landing, then two decaying wobbles over 0.9 s. Today the pop is 0.82 → 1.13.
- **L2 (rooftop garden):** the same, plus a **1.5 m hop**. The whole building leaves the ground for 0.42 s (its sun shadow stays on the street, which reads as a jump) and lands with a squash. Its garden rides along and bursts out on landing.
- **L3 (Hundertwasser):** the hop, plus a **twist**: the top rotates ±12° about the vertical and rings down. The onion dome swings with it.
- **Towers (over 35 m):** no hop. The shockwave **whips** them: the top bends up to 4 % of the height *away from the impact*, then springs back through three oscillations. Downtown, the skyline sways in sequence as the wave passes, like grass in a gust.

**Afterlife:** hands off to the beat dance (#8) at rest.

**Street level:** at the blast 1 px is about 0.28 m. A 10 m house stretching 3 m is 11 px of travel and a 1.5 m hop is 5 px. The row of Painted Ladies leaps like piano keys.
**250-500 m:** houses' stretch is 1.5-2.5 px, gated by R1 (still visible as a twitch). Tower whips are 4-8 m at the top, 2-6 px: the readable altitude motion.

**Technique (`buildingMaterial.ts` vertex, via S6's `GLSL_JELLY`):**
```glsl
// sy: vertical scale about the ground; hop: lift (m); lean: top shear away from the blast (m); twist: rad at the top
vec4 sbJelly(float tb, float lv, float hgt) {
  if (tb < 0.0 || tb > 1.6) return vec4(1.0, 0.0, 0.0, 0.0);
  float e = exp(-4.2 * tb), s = sin(13.0 * tb);
  float tall = smoothstep(35.0, 80.0, hgt);                     // towers whip instead of jumping
  float st = min(uJump.x * (0.75 + 0.25 * lv) * hgt, uJump.y) / hgt;  // stretch, capped in meters (flight clearance)
  float sy = 1.0 - (1.0 - tall) * (0.22 * exp(-30.0 * tb) - st * e * s);
  float hop = (1.0 - tall) * step(1.5, lv) * uJump.z * max(0.0, sin(3.1416 * clamp(tb / 0.42, 0.0, 1.0)));
  float lean = tall * uJump.w * hgt * e * sin(9.0 * tb + 1.2);
  float twist = (1.0 - tall) * step(2.5, lv) * 0.21 * e * s;
  return vec4(sy, hop, lean, twist);
}
```
- Applied where the pop is today: about the base `aBld.z` and the center `aBld.yw`.
- The lean direction is `normalize(c − uBlastRing.xy)`: add `uBlastRing` to the vertex uniforms (it is already bound for the fragment ring).
- The twist rotates both `p.xz − c` and `n` by `twist · h01`.
- All parts of a tower share the paint texel, center and ground, so tiers never crack (as the flood rule requires).
- Tunables: `uJump = (stretch 0.30, cap 4 m, hop 1.5 m, whip 0.04)` in a `registerTunables('Jelly', ...)`.
- Sprouts get the same function through S6, so gardens ride the hop and twist. Painted trees already pop (`propPop`); raise `treePop` to match and add the hop to the tree vertex chunk for L2+.

**Pixel art:** the motion is large and brief. R1 gates the residue (fade when `st·hgt / mpp < 1.5`).

**Shadows:** the sun pass uses `MeshDepthMaterial`, so shadows don't jump. That is deliberate: a shadow left on the street sells the hop.

**Perf and caps:** about 25 ALU per vertex, only on vertices whose `tb < 1.6`. 0 draws, 0 triangles.
- **Flight:** the stretch is capped in meters (4 m, about one storey) and lasts 0.9 s. The bus rides 2-3 storeys up and recoils upward after a breath. Verify with `tools/feel-sim` clearance runs, with the displacement added to the rendered-surface raster.

**Effort:** 0.75 days + 0.5 days for sprouts riding (S6).

### 4. Fireworks
**Trigger:**
- **Big blast:** 1 shell. **Huge:** 3.
- **Each escalation to L3 in a blast:** a shell from that roof (cap 4).
- **Firehose:** a shell every 0.4 s from the moving impact.
- **Resident:** every L3 building within 700 m fires a small shell every 8-14 s (staggered by a `stableId` hash), launched on downbeats so bursts land on beat 3. Global cap: one launch per 0.6 s.
- **Finale:** a barrage (#12).

**What the player sees:**
- **Launch:** a white-hot head (`GLOW_WHITE` step 7, 2 px, glow 1) rises at 70 m/s with a 4-6 px tail in the shell's hue (the existing motion smear stretches it) and a slight wobble.
- **Apex** (0.9-1.5 s, 60-110 m above the roof; finale up to 250 m): a one-frame cluster of white pixels (the glow pass blooms it), then 90-140 stars burst out, in one of three patterns:
  - **Peony:** a sphere of one hue with a white core.
  - **Ring:** a tilted ring of alternating hue and hue + 3.
  - **Willow:** `YELLOW`/`ORANGE` stars with long drooping smears.
- **Stars cool** by stepping down their ramp (7 → 5 → 3 over their life, never below 3 for yellow and orange). In the last 30 %, a third of them crackle: they blink out in hash order.
- **Hues** cycle the rainbow shell by shell (the blast hue sequence).
- **Audio:** a rising whistle (band-passed noise sweep), a burst "pop" tuned to a chord tone of the current chord (so fireworks are part of the music), and a crackle of granular noise.

**Afterlife:** resident shells keep painted Hundertwasser neighbourhoods celebrating, sparse and on the beat (R4, R5).

**Street level:** shells rise from roofs ahead. A burst at 60-110 m above the ground sits near the horizon line of the chase view, in front of the far city and sky. At about 0.3 m/px, an 18 m radius is about 120 px across.
**250-500 m:** the bursts are the altitude spectacle. Burst radius scales with the blast strength (30-80 m), and star size is set at spawn to `max(1.2 m, 2.2·mpp(dist))`. From 500 m a blooming firework marks every painted L3 neighbourhood: the city answers you from below.

**Technique (`Particles.ts`, S5 pool):**
- `firework(pos, apexH, hue, kind, delay)` writes a whole firework once, at launch:
  - 1 rising head: a `K_DROP` with `gMul 0.25`, `F_GLINT`, and an explicit life equal to the rise time (a small override of `writeDrop`'s life);
  - N stars as `K_SPARK` slots with `t0` = launch + rise time (in the future). The vertex shader already culls `age < 0`, so no per-frame CPU is spent on any firework.
- The star motion uses the spark formula (`p0 + v0·(1−e^{−k·age})/k + rise·age`) with a negative rise for the droop.
- New flags: `F_COOL` (step = `7 − 4x`, quantized) and `F_ROUND` (blob shape instead of the 4-point star; willows keep smear).
- Glow 0.9, so the glow pass and `haloTint` give pixel-art bloom in the star's own hue.
- `fogMul 0.3`, so bursts punch through the marine layer with `?fog`.
- Resident launches come from a 2 Hz scan of L3 roofs near the view (the director keeps a list fed by `bloom()` and by `city.onTile` saved paint).

**Perf and caps:**
- 0 new draws.
- Per shell: about 120 slots (about 11.5 KB upload) and about 40 µs CPU at launch.
- Caps: 6 shells airborne (about 900 particles); resident at most 1 per 0.6 s; finale 30 shells over 6 s.
- The director skips shells when the pool is more than 80 % live.

**Effort:** 1.5 days (with audio one-shots in `sfx.ts`).

### 5. Window cascade + marquee bulbs (facades in motion)
**Trigger:** L1 cascade at the bloom; L2 marquee bulbs; L3 winks and rainbow chase; finale light show.

**What the player sees:**
- **L1 bloom:** as the colour flood pours down past a row of windows, the windows **switch on one by one** in a fast shuffle. Each cell lights 0-0.12 s after the flood front (`h21(cell)`), flashes `GLOW_WHITE` step 7 (glow 1) for 2 frames, then settles to its stained-glass hue (today's glow 0.38). A facade sparkles into life like a pinball table.
- **L2:** **marquee bulbs** on every belt course and window frame: dots every 1.2 m. Every fourth one is lit (`GLOW_WHITE` step 7, glow 0.8) and the pattern **steps one bulb per eighth of a beat** along the facade (R2). Coney Island meets the Painted Ladies.
- **L3:** bulbs chase in rainbow order, and on every beat a random 12 % of windows **wink** to their hue's step 7.
- **Finale:** all windows in the district flash in a sweep from the district heart on each downbeat for 8 bars.

**Afterlife:** this is the resident street-level life of the painted blocks.

**Street level:** strong. Bulbs are 6 px apart and 2 px wide at the chase camera, and the motion in the facades makes the whole frame feel alive.
**250-500 m:** honestly nothing. Windows already melt beyond about 2 px (`melt`), and bulbs fade by R1 (`mpp·1.5 > 0.35 m`). Altitude is served by #4, #6, #9 and #10.

**Technique (`buildingMaterial.ts` fragment only):**
- `windows()` already returns `cell`, and `trimMask` already marks frames and belt courses.
- Bulb: `float bi = floor(f.x / 1.2); bool lit = mod(bi - floor(uBeat.y * 8.0 + uBeat.x * 8.0), 4.0) < 0.5 && fract(f.x / 1.2) < 0.3;`, applied on `trimMask` rows.
- Cascade: `if (tb < floodArrival + h21(cell) * 0.12) glass = grey`.
- Wink: `h21(cell + floor(uBeat.y)) < 0.12`.

**Perf:** about 20 ALU on painted wall fragments; 0 draws.

**Effort:** 1 day.

### 6. Rainbow tsunami: the paint wave as a towering wall of surf
**Trigger:** every blast. Its height scales with the blast radius (L3 escalations add aftershocks). The firehose gets a tsunami train.

**What the player sees** (with the ring curve `r = R(1 − e^{−age·v/R})`, `R = 1.65·r_blast = 99 m`, v = 300 m/s):
- **Impact frame + 4 hit-stop frames:** a frozen crown of surf, a 2-3 m lip of `GLOW_WHITE` foam all around the impact.
- **0-0.14 s:** a **wall of paint 27 m tall** (0.45 × the blast radius: twice a Victorian; 54 m from a 300 m drop) shoots outward with the shockwave.
  - It is banded: the body is the **pinwheel sector hue it is about to paint**, steps 3/4/5 rising up the face, then a hue + 1 stripe, then a 2-px white crest line.
  - Each sector of the wall is the colour the ground behind it becomes. The wave visibly *deposits* the rainbow: grey ahead of it, painted behind it.
- **0.14-0.76 s:** it decelerates like a breaker.
  - Houses jump (#3) exactly as the crest passes them, because the same `arrival()` drives both, so the wave lifts them like buoys.
  - The crest **curls forward**: the top rows lean outward by 0.35 H and pitch down.
  - Grey dust puffs (`FOG` ramp) kick out just ahead of the face: the grey city being dusted off.
- **0.76-1.16 s:** it **breaks**. The lip tips over, the height collapses, the wall dissolves into pixels from the top down (anchored dither) and the crest throws about 150 spray drops outward in sector hues. The ground paint is left behind.
- **L3 escalations in the blast:** two aftershock rings follow at 0.25 s intervals, a third of the height.
- **Firehose:** waves spawn every 0.35 s along the moving impact track, so a train of surf rolls across the neighbourhood (3 live at most).

**Framing rule:** the half of the ring facing the camera is 45 % of the height. You see the tall far wall in full, the near wall never buries the bus, and the wave "rolls away from you".

**Afterlife:** none. The paint it left is the afterlife.

**Street level:** the single most explosive image in the game. At the blast's camera distance (about 0.28 m/px) the far wall is about 95 px tall: 11 % of the frame height, surf sweeping through rooftops. The near wall rushes past under the bus.
**250-500 m:** a stone dropped in a pond made of rainbow. The ring from a 300 m drop is 400 m across with a 54 m wall: about 260 px wide and 20-45 px tall at 1.2-2.5 m/px, with a white crest line (thickness `max(1.5 m, 2.5·mpp)`). It reads clearly from the ceiling.

**Technique (new `src/fx/PaintWave.ts`, fx owner):**
- **Geometry:** an `InstancedBufferGeometry` ring strip, 160 segments × 5 rows (base, three bands, lip) = 1.6k triangles per wave. At most 3 instances, so **1 draw** and at most 4.8k triangles.
- **Per-instance attributes:** `aWave0 = (cx, cz, t0, R)`, `aWave1 = (hue, twist, H, ground-LUT row)`.
- **Ground:** SF's hills mean a 200 m ring is not flat. At `barf()` time (the spec is known during the projectile's flight, like the ground job) the CPU samples `city.groundAt` on 160 angles × 16 radii and writes one row of a small 160×48 R32F `DataTexture`. That is 2,560 samples, spread over the flight frames (512 per frame). Three rows serve the 3 live waves, with **one upload per blast** (nearest-filtered float: fine on iOS). The vertex shader does two `texelFetch` calls and a lerp across radius.
- **Vertex shader:**
  ```glsl
  float age = uTime - aWave0.z;
  float k = 1.0 - exp(-age * uBlastRing2.z / aWave0.w);       // the curve sbRing and arrival() use
  float ang = position.x * 6.2832; vec2 dir = vec2(cos(ang), sin(ang));
  float face = dot(dir, normalize(cameraPosition.xz - aWave0.xy));
  float H = aWave1.z * smoothstep(0.0, 0.25, k) * (1.0 - smoothstep(0.82, 0.97, k)) * mix(1.0, 0.45, smoothstep(0.2, 0.7, face));
  float curl = smoothstep(0.55, 0.9, k) * smoothstep(0.6, 1.0, position.y);
  vec3 p = vec3(aWave0.x, groundLut(ang, k), aWave0.y)
         + vec3(dir.x, 0.0, dir.y) * (aWave0.w * k + curl * 0.35 * H * position.y)
         + vec3(0.0, H * position.y * (1.0 - 0.5 * curl), 0.0);
  ```
- **Fragment:**
  - The sector hue comes from the same pinwheel as `GroundPaint.rows()` (`floor(u·6 + 0.5)` with the spec's twist), so it matches the ground underneath.
  - Band by `position.y`. Light is an exact ramp step (`sbStep`, sun-facing +1). The flat steps never dither (the resolve's `flatLight` test).
  - Back faces (the inside of the far wall) are one step darker.
  - `sbWrite(ramp, step, sbFog·0.5, glow: body 0.25 / crest 0.9, n, 0.33, 1.0)`. Outlines are on, so the wall gets an ink silhouette against the city: cel surf.
  - Deaths use `discard` on `sbDissolve` (S4) from the top down.
  - `DoubleSide`, depth write on, `renderOrder` after the opaque city, not in `SHADOW_LAYER`.
- **Spray and dust:** `particles.crestSpray(spec, k)`, one batch of drops from 48 crest points at k ≈ 0.85, plus 24 `puff()`s at the face at t = 0.05 s.

**Perf and caps:**
- Alive 1.2 s per blast. 1 draw, at most 4.8k triangles.
- Fragments: the wall covers at most about 30 % of a 390×845 frame (about 100k fragments) at about 40 ALU, with no shadow and no texture lookups in the fragment shader: well under 0.3 ms on an A15.
- CPU: about 0.15 ms for the LUT, spread over the flight frames.
- Caps: 3 live waves, H ≤ 70 m.

**Effort:** 2 days (most of it look-dev on the curl and the sector match).

### 7. Translation-only camera choreography
**Trigger:** lean-in on every tap; crane reveal on big and huge hits; pull-out on the firehose; a long crane for the finale.

**What the player sees:**
- **Lean-in (every tap):** during the 0.09 s inhale the camera dollies 3 % closer along its view axis, then eases back over 0.5 s. It is subtle anticipation, felt more than seen.
- **Crane reveal (big/huge):**
  - At the end of hit-stop the rig **latches its orientation** and translates up its own up axis by 0.18 × distance and back by 0.12 × distance over 0.6 s (ease-out).
  - The whole blast circle and the tsunami come into frame below the bus. It holds 0.4 s (in slow motion for huge hits: a bullet-time crane).
  - It blends back to the chase solution over 1.2 s (the orientation slerps back while the motion is slow).
- **Firehose:**
  - Charge: a slow push-in of 8 % over the hold (tension).
  - Release: kick back 25 % plus a low rumble (7 and 11 Hz sines, 0.4 m) for the torrent.
  - Rotation is latched at half the rig's yaw rate, so the stream sweeps across a crisp frame.
- **Finale:** a 5 s rise of 120 m above the district heart with the orientation latched, then home.
- **Kick:** scaled by tier (1×, 1.4×, 2× today's 2.2 m).

**Street level:** big hits finally get a camera that reacts. You *see* the size of what you did.
**250-500 m:** the crane is smaller in angle (the rig is 270 m back: +50 m up) but still reveals the full ring. FOV is never touched.

**Technique (`CameraRig.ts`):**
- A `choreo` state `{mode, t, latch: Quaternion, offset (camera axes)}`, applied after `update()` like `applyKick`: `cam.position += right·ox + up·oy + fwd·oz`; `cam.quaternion.slerp(latch, w)`.
- While a move runs, `main.ts` sets `pipeline.steadySnap = true`, so the grid's scale holds in 1/16-octave steps. A dolly is then a pure grid translation: crisp, with no per-frame rescale (R3).
- Aim, glint and flight are untouched (the aim works from the flight, not the camera).
- Gate: no crane while the player is carving hard (|bank| > 0.4) or under a bridge deck.

**Perf:** 0.

**Risk:** the bus leaves "above the thumb zone" briefly. The crane is capped at 1.3 s, and the latch releases early if the thumb drags more than 30 % of the screen.

**Effort:** 1.5 days with feel tuning (`tools/feel.mjs` strips).

### 8. Beat dance: the painted city dances to the music
**Trigger:** resident on every painted building, tree and garden. Amplitude by level × `uBeat.w` (the music's paint energy, #11), so the city dances harder where the music is fuller.

**What the player sees** (per beat at 84-96 BPM):
- **The pump:** on the beat, painted buildings snap down (squash, widening slightly) over 2 frames, spring back with a small overshoot by 35 % of the beat, and settle by 60 %. It looks like speaker cones pumping.
  - L1 pumps only on downbeats (every 4th beat), 2 %.
  - L2 pumps every beat, 3.5 %.
  - L3 pumps every beat at 5 %, with a **shimmy**: the top shears left/right on alternate beats by 2 % of the height.
- **Call and response:** painted tree crowns pump on the off-beat. Bunting flicks on the beat.
- **Stadium wave (lit districts):** each bar, the pump's phase is offset by the distance from the district heart, so a ring of bouncing houses rolls outward across the neighbourhood once per bar.
- **Firehose charge lean:** while the hold charges, painted buildings within 150 m lean *toward the bus* (up to 3 % shear), like the city being inhaled. At full charge everything holds still for 2 frames. On release it all springs outward.

**Afterlife:** this *is* the afterlife: the painted city is a dance floor, forever.

**Street level:** 2-3 px pumps on every painted block, all in time. Gardens and domes ride along (S6).
**250-500 m:** R1 fades houses out (their pump is under 1.5 px), so the altitude view stays calm. Towers and big blocks still dance: a 100 m L3 tower pumping 5 % moves 5 m, 2-4 px. Concept-energy's heartbeat light pulse carries the rhythm up there.

**Technique:**
- `buildingMaterial.ts` vertex, after the jelly:
  ```glsl
  // c = building center (aBld.yw); uDanceC[i].xy = district heart, .z = stadium-wave length (m, 0 = off)
  float lag = 0.0;
  for (int i = 0; i < 4; i++) if (uDanceC[i].z > 0.0) lag = max(lag, 1.0 - distance(c, uDanceC[i].xy) / uDanceC[i].z);
  float ph = fract(uBeat.x - lag * 0.75);                        // phase in the beat, delayed outward from the heart
  float pump = exp(-9.0 * ph) - 0.3 * exp(-5.0 * ph) * sin(8.0 * ph);
  ```
  with `sy *= 1 − A·pump·uDance.x` and the overshoot capped at +0.6 m absolute (flight clearance).
- `A = uDance[level]·uBeat.w·fadePx`; `fadePx` is R1's gate.
- Sprouts via S6; trees in the `trees.ts` vertex chunk (they have `level` in `instanceColor.y`).
- `uDanceC[4]` holds the lit district hearts (shared with concept-energy F3, else 4 nearest painted-centroid clusters at 2 Hz).
- The charge lean uses `uLean = (bus x, z, strength, radius)`.

**Pixel art:** synchronized 2+ px moves, one clock (R1, R4). L1 pumps only every 4th beat, so big L1 areas don't churn every beat. Under reduced motion the gain is 0.

**Perf:** about 15 ALU per painted vertex, every frame. About 300k painted vertices in view is a few M ALU: trivial on an A15. 0 draws.

**Effort:** 1.25 days + 0.5 days for the beat clock (S2, shared).

### 9. Rainbow twister + charge inhale
**Trigger:**
- **Firehose:** the inhale during the charge, then a twister for the torrent.
- **Huge blast:** a 1.2 s twister.
- **L3 domes:** small resident "dust devils" of motes circling the spire.
- **Finale:** a giant column.

**What the player sees:**
- **Charge (the 10 s hold): the bus inhales the rainbow.** Paint motes lift off painted roofs and trees within 150 m and spiral into the bus's face along tightening helices. They thicken as the charge builds, so the charge is visible in the world: a whirlpool of colour converging on the mouth. At 100 % the motes orbit the bus in a tight humming ring.
- **Release:** the torrent slams down. At the impact a **rainbow tornado** forms:
  - six ribbon bands, one hue each, spiralling up from a 15 m base to a 40 m flared crown 80-120 m tall, rotating at 1.2 rev/s;
  - cel-lit: the sun side one step up, the lee one step down;
  - it travels with the impact as the player sweeps the stream, flinging drops off its crown onto the roofs (they land as `K_DROP` spatters) and sucking confetti (#2) up its sides.
- **Torrent end:** the base pinches, the column lifts off the ground and bursts into a firework (#4) and a confetti shower.
- **Huge blasts:** the same twister, short-lived (1.2 s) at the impact.
- **L3 dust devils:** a ring of 8 sparkle motes circling each dome at 4 m (subtle, resident, capped).

**Street level:** a towering rainbow twister in front of the bus is the firehose's signature image. The charge vortex makes the 10 s hold a show instead of a wait.
**250-500 m:** a 100 m column with a 40 m crown is 40-80 px tall, rising out of the city plane (R7). `fogMul 0.3` lets it pierce the marine layer.

**Technique:**
- **New `src/fx/Vortex.ts`:** one `InstancedMesh` of a helix-ribbon template (6 bands × 48 rows × 2 vertices: about 3.6k triangles), at most 2 instances, so **1 draw** and at most 8k triangles.
- **Vertex shader:** `θ = θ0 + ω·t + twist·y`, `r(y) = mix(r0, r1, (y/H)^1.6) + wobble`. The column's base center is a per-instance attribute updated each frame while it travels (one small upload).
- **Fragment:** band ramp, exact steps (`sbStep`), sun-facing ±1 step, `sbWrite(..., flags 1.0)` (ink edges), glow 0.3. Birth and death through `sbDissolve`.
- **Motes:** new `K_ORBIT` particle kind in the S5 pool: `p = c + (r(t)·cos(θ0 + ωt), y0 + vy·t, r(t)·sin(...))`.
  - The **inhale** variant spirals inward to `c`, the bus's mouth. Particles are relative to the snap-compensated celebration pool origin. The mouth moves, so the CPU re-aims 30 new motes per 0.1 s at the current mouth; old ones end on the old mouth, which reads as a trailing swirl.

**Perf and caps:** 1 draw while a twister lives, at most 8k triangles, column overdraw under 10 % of the frame. Motes: 300/s during the charge, 200 alive. Dust devils: 8 motes per dome, only the 6 nearest L3 domes.

**Effort:** 2 days. Coordinate with feat/supersplat: it needs charge 0..1, release, stream impact point and end events.

### 10. Balloon flotilla
**Trigger:**
- A building reaching L3 releases 1-3 balloons.
- A district lit releases a parade of 12.
- The finale releases 24.
- Resident: a trickle of one per L3 block in view every 20-30 s (48 alive at most).

**What the player sees:**
- **Release:** a burst of confetti from the roof, then Hundertwasser hot-air balloons (onion envelopes with six gores in hue / hue + 1 / white, and a tiny basket, 6-12 m tall) spring out of the garden with a jelly squash.
- **Rise:** 3-5 m/s with a lazy bob and sway, drifting downwind.
- **At 300-600 m (the band where the bus flies high):** they pop into a confetti puff and a bright chord tone.
- **Optional, producer's call:** the bus can ram a balloon. That pops it with a little splash and plays the next chord tone.

**Street level:** balloons lift off painted rooftops and rise past the camera. They are a slow, gentle counter-motion to the fast blasts.
**250-500 m:** they are the only thing that fills the sky between the city and the bus. Near the bus at altitude they are large on screen and drift past with parallax, giving the vista depth and life. Far below they are colourful lollipop dots rising from painted districts. From the ceiling, the painted city is breathing balloons up at you.

**Technique:**
- New `src/world/props/balloons.ts` (props owner): one `InstancedMesh` of at most 64 instances.
- Template about 240 triangles: the lathe envelope, reusing `sprouts.ts`'s `lathe()`, plus a basket box. At most 15k triangles.
- Per-instance data: spawn position, t0, rise speed, drift seed, hue, pop time.
- The vertex shader animates the whole flight: `p(t) = spawn + (drift(t), rise·t, drift2(t))` plus a bob. Pop: hidden after `popT`, with a dissolve.
- Carved silhouettes like the sprouts' blob carving (`PartKit.blob`), so balloons are crisply round. Gores are flat steps, outlines on.
- No shadow twin: long low-sun shadows from 400 m up would land a kilometer away.
- S5 compensation per vertex, so a balloon at the bus's depth doesn't jitter up high.
- The CPU evaluates the same flight function for at most 64 balloons (ram test, apex pops). A pop is a 1-instance upload plus a confetti burst.

**Perf:** 1 draw (resident while balloons exist), at most 15k triangles, small fragment cost, CPU about 10 µs.

**Effort:** 2 days.

### 11. Music that builds with paint
**Trigger:** paint energy E near the bus (0..1) = painted share within 250 m, weighted by mean level and recent blasts; the L3 share; the firehose; the finale.

**What the player hears:** a beat-locked, fully synthesized arrangement at 84-96 BPM over the existing progression. Pachelbel's canon in D stays: each splat advances the chord immediately and the bloom arpeggio stays instant, so feel is untouched. Layers enter on bar lines and crossfade over a bar:

| E | Layer added |
|---|---|
| 0 grey | wind, foghorns (today) |
| > 0 | hum (today) + soft sub "heartbeat" on beats 1 and 3 |
| ≥ 0.25 | marimba / pizzicato ostinato arpeggiating the chord in 8ths |
| ≥ 0.5 or any L2 | four-on-the-floor kick, shaker 16ths, bass on the chord roots |
| L3 ≥ 20 % or district lit | glockenspiel counter-melody (pentatonic over the chord), claps on 2 and 4; a choir pad replaces the hum |
| firehose charge | riser (noise sweep) + a snare roll accelerating 8ths → 16ths → 32nds with the charge |
| firehose release | "the drop": every layer at once for the torrent |
| finale | key change up a whole step, timpani roll, full choir, chord stabs for 8 bars, then settle |

**Coupling:** `uBeat` comes from this scheduler's clock (S2) and `uBeat.w = E`. The dance (#8), the resident fireworks rate (#4) and the marquee (#5) scale with it, so the city visibly dances harder where the music is fuller. Slow-mo (#1) ducks the drums and re-enters with a fill on the exit downbeat. With sound off the clock still runs.

**Street vs altitude:** E is local, so the music swells as you fly over your own painted districts and thins over the grey. Up high, E is measured over the view footprint instead of a 250 m radius, so from the ceiling the whole painted city is the band.

**Technique:**
- New `src/audio/groove.ts`: a lookahead scheduler that, in `update()`, schedules every note whose time falls within `ctx.currentTime + 0.12 s`.
- Voices from the existing kit: `Bells` for the glockenspiel and marimba, noise and envelope for the drums, `Hum` for the pad.
- `AudioFrame` gains `paintEnergy`, `l3Share`, `district`. `AudioEngine.beat()` returns `{phase, index, bar, energy}` for `main.ts`.
- Voice cap 24. Offline check with `tools/audio-check.mjs` (peak under 0.85, no clipping).

**Perf:** audio thread; main-thread scheduling about 0.05 ms.

**Effort:** 3 days (music look-dev). It is the slowest ratio, but it is the clock that makes #5 and #8 musical.

### 12. District carnival (the finale)
**Trigger:** a district completes (concept-energy F3's threshold if built: 60 painted and 8 at L3 in a 384 m cell; otherwise the director's own cell tracker). Once per district, saved.

**Timeline:**
- **t = 0 (the finishing blast):** flash for 2 frames, 8 hit-stop frames.
- **0.13-1.6 s, slow-mo at 0.2x (#1), crane rising 0.3 × distance (#7):**
  - the blast's tsunami is double height (#6);
  - **every painted building in the district** jelly-jumps in a stadium wave rolling outward from the heart, using `uCarnival = (x, z, t0, speed)`, an extra pop arrival the building vertex shader computes from distance (no paint-texel writes, no upload).
- **1.6 s:** time snaps to 1x on a downbeat with a drum fill, and the key change hits (#11).
- **1.6-7 s:**
  - a firework barrage: every L3 dome fires in a spiral order, one per quarter beat, plus 4 big shells from the heart;
  - a confetti blizzard with ticker tape off the tallest buildings (white and yellow streamers);
  - a parade of 24 balloons;
  - the giant twister rises at the heart (60 m base, 300 m tall) and holds;
  - all windows sweep-flash on downbeats (#5);
  - the dance gain doubles for 8 bars.
- **7-10 s:** the column bursts into the biggest firework in the game (300 m up, 150 m radius, readable from anywhere in SF). The confetti settles and the music settles into the full groove.

**Afterlife:**
- the district dances at 1.5x and fires resident fireworks twice as often, with a balloon trickle;
- the street sign shows the neighbourhood name in `GLOW_WHITE`;
- with concept-energy, its beacon and aurora stand over it.

**Street level:** confetti, jumping houses, marquees, shells overhead.
**250-500 m:** it is designed to be watched from the ceiling: the stadium wave on the towers, the barrage, the column, balloons rising toward you.

**Technique:** `Spectacle.finale(district)` sequences #1-#11. One new uniform (`uCarnival`) in `buildingMaterial`.

**Perf and caps:** one finale at a time. Peak: +3 draws (wave, twister, celebration pool) + balloons, at most 30k triangles, celebration pool at most 8000 alive, spawn CPU at most 0.3 ms per frame (spread over quarter beats). When `workMs > 6`: half barrage, no ticker tape.

**Effort:** +1.5 days of orchestration.

---

## 5. Escalation ladder (what each trigger gets)

| Trigger | Motion |
|---|---|
| **L1 bloom** | jelly stretch (#3), window cascade (#5); afterwards a downbeat pump (#8) |
| **L2** | + hop and garden landing (#3), confetti cannon (#2), marquee bulbs (#5); pumps every beat |
| **L3** | + twist (#3), a shell from the roof (#4), balloons (#10), shimmy and winks; resident dome fireworks and dust devils |
| **Every blast** | rainbow tsunami (#6), lean-in (#7) |
| **Big blast** | + crane reveal, 1 shell, confetti cloud, kick 1.4x |
| **Huge blast** | + slow motion (#1), bullet-time crane, 3 shells, 1.2 s twister, kick 2x |
| **Firehose charge** | charge inhale vortex (#9), city leans in (#8), camera push-in, riser and snare roll (#11) |
| **Firehose torrent** | slow-mo at release, twister following the stream, tsunami train, confetti geyser, shells every 0.4 s, rumble, "the drop" |
| **District finale** | the carnival (#12) |

## 6. Performance roll-up (A15, 30+ fps)

| Item | Resident | Peak (finale / firehose) |
|---|---|---|
| Draws (today 120-200) | +1 balloons, +1 celebration pool while alive | +3 (wave, twister, celebration) + balloons |
| Triangles (today 1.0-1.5M) | ≤15k (balloons) | ≤30k |
| Particle vertices | celebration pool 8000 (point vertices, early-out when dead) | same pool, capped by the director at 80 % live |
| Vertex ALU | +15 per painted building vertex (dance), +25 while popping | same |
| Fragment | painted walls +20 ALU (marquee) | wave/twister overdraw ≤30 % of frame, cheap shaders, no shadow taps |
| CPU per frame | ≤0.05 ms (director 2 Hz scans, resident shells, groove scheduler, balloon ram test) | spawn bursts ≤0.4 ms, spread over arrival times / quarter beats |
| Uploads | particle dirty ranges (existing pattern); balloon/twister instance attributes (one small range) | + one 160-texel wave-LUT row per blast |

**Adaptive.** The director tiers down above 6 ms `workMs` (EMA) and restores below 4 ms: no ticker tape, half confetti, a third of the shells, no aftershocks. Draw calls never scale with the building count: all the per-building motion is vertex shader math on the existing per-tile meshes (no per-building draws).

**Measure with:** `tools/blast.mjs perf` A/B (grey hover, blast, settled, escalation, heavy), the same as the blast's cost table. Add `perf firehose` and `perf finale` scenarios.

## 7. Build order

1. **M1, "it explodes" (4 days):** S1, S3, S4, S5, S6 + slow motion (#1) + jelly jump (#3) + confetti (#2). Zero new resident draws; the blast stops being conservative within the first week.
2. **M2, "it's an event" (5 days):** tsunami (#6) + fireworks (#4) + camera choreography (#7).
3. **M3, "it's alive" (4.25 days):** S2 beat clock + dance (#8) + marquee (#5) + groove v1 (heartbeat, ostinato, kick and bass layers).
4. **M4, "it's a party" (7 days):** twister and charge inhale (#9, with feat/supersplat) + balloons (#10) + groove v2 (glock, choir, riser, drop, key change) + carnival finale (#12).

About 20 days in all.

QA per milestone:
- shot strips with `__qa.holdAt` at impact + 0.05/0.15/0.3/0.6/1.0 s, from the chase camera and from 250 m and 500 m;
- `?fixeddt=1/30` for slow-mo determinism;
- `tools/feel-sim` clearance runs with the jelly and dance displacement added to the rendered-surface raster;
- regression shots (`shots/v*/regress`): the grey city must be pixel-identical ("nothing moves in grey").

## 8. Risks and guard rails

- **Chaos:** too much motion turns into noise. Guard: one clock (R4), tiers and cooldowns (S1), peak then rest (R5), L1 pumps only on downbeats. The grey city never moves.
- **Shimmer:** sub-pixel residue is gated by R1, patterns are stepped (R2), the camera translates only (R3), and the celebration pool is not bus-compensated (S5). Review every effect at 250 m and 500 m on 1/30 s frame sequences, as the altitude work did.
- **Flight clearance:** stretch, hop, overshoot and whip are capped in meters. Feel-sim must stay at 0 frames inside geometry.
- **Particle-ring overwrite:** the separate celebration pool, plus the director's live budget.
- **Motion comfort:** camera moves are short, eased and translation-only, and reduced motion disables dance and camera moves.
- **First-use shader compile hitches** (already known for the sign and the gardens): pre-warm `PaintWave`, `Vortex`, balloons and the new particle kinds at boot with `renderer.compile` on hidden instances.
- **Supersplat timing:** the 10 s charge and 60 s cooldown should run on real time, not `simTime`, so slow motion and hit-stop never stretch them.

## 9. Shared-file notes for the owners

- **Core renderer** (`src/render/*`): `globals.uBeat`, `uDance`, `uDitherOrigin`, `uViewPx`, `uSnapComp`; GLSL helpers `sbMpp`, `sbDissolve`, `sbStep`. These are the same as concept-energy F1/F2: land them once.
- **World** (`buildingMaterial.ts`): `GLSL_JELLY` (shared with sprouts), `uJump`, `uCarnival`, `uLean`, `uDanceC[4]`, `uBlastRing` in the vertex stage, plus the marquee and cascade in the fragment stage.
- **Props:** `RoofSprouts.set(..., baseY)` and the `aBld` instance attribute; a tree hop and off-beat pump; new `balloons.ts`.
- **Particles:** kinds `K_CONFETTI` and `K_ORBIT`, shape 3, flags `F_COOL`/`F_ROUND`, an explicit life for fireworks heads, `firework()`, `confetti()`, `crestSpray()`, a second instance as the celebration pool.
- **Game glue** (`main.ts`, `CameraRig.ts`): the `Spectacle` director, `timeScale`, `choreo`, `steadySnap` during moves, routing of `SplatFx` and supersplat events.
- **Audio:** `groove.ts`, `AudioEngine.beat()`, `slowmo()`, firework one-shots, new `AudioFrame` fields.

## 10. Open questions for the producer

1. **Slow motion frequency:** on huge hits only (as proposed), or also on the first blast in each new neighbourhood?
2. **Balloon ramming:** pure delight (pop, a note, a splash), or a small belly bonus? The first keeps the game pure; the second makes the altitude band a playground.
3. **Tempo:** 84 BPM (dreamy, matches concept-energy) or 96 BPM (party)? It sets how fast the whole city dances.
4. **Street-level fireworks size:** bursts can fill a third of the frame near the bus. Is that "explosive" or "in the way"? The proposal caps near bursts at an 18 m radius.
