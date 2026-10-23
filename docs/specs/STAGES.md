# STAGES: five stages of wonder, per area, per faction

The producer's direction (verbatim): *"there are essentially... stages of how fantastical a covered area can be. If I'm on
team super rainbow - one of the factions - and one specific area gets hit 4 or 5 separate times, I want that area to grow
in the amount of extravagant fantasticism each time which will eventually culminate into the top most absolutely over the
top extravagant display of amazingness - (and it's equivalent across all other factions - as in they all get these levels
as well)"*

This spec turns MAGIC-SPEC's approved set into **five stages**. That set is the 14 effects, the escalation ladder, the
three workstreams, the budgets and the pixel contract.

- **How the stages work.** An **area** climbs one stage each time the faction that owns it lands a separate hit on it. The
  fifth stage is one signature centerpiece per area.
- **How factions fit in.** The ladder itself is a **theme**, so every faction gets the same five stages in its own look.
- **Status.** This is a proposal only. No source file was edited and nothing was rendered.

**Sources.** I read `docs/specs/MAGIC-SPEC.md`, `docs/specs/magic/concept-{living,energy,spectacle}.md`,
`docs/specs/COMMON.md`, `docs/ARCHITECTURE.md`, `src/world/PaintState.ts`, `src/world/GroundPaint.ts`,
`src/game/Splat.ts` and `src/config.ts`. To fit the plans already in flight, I also checked:
- `src/render/palette.ts`: ramp rows 20-31 are free;
- `src/world/buildingMaterial.ts`: how the faction channel is decoded;
- `public/city/sf/city.json`: 140,961 buildings, 256 m tiles, 1 km regions, 51 neighbourhoods;
- `docs/specs/WORLD-TRAVEL.md` §2.5 and §8: its palette rows and the paint server.

**Designed for what is coming:**
- the hold-to-charge firehose (feat/supersplat);
- turbo travel between cities;
- a shared multiplayer world.

---

## Summary for the producer

**What an "area" is.** An area is a square of the city about one block across (128 m).
- From the street, it is about what fills the screen when you blast.
- From 500 m up, it is one patch of a quilt, three to eight across the screen.
- Its borders wander gently and follow whole buildings, so the grid never shows as straight lines.
- Every area belongs to one team at a time, or to nobody (grey).

**How it climbs.** Each separate blast you land in an area moves it up one stage.
- **Cooldown.** An area can climb at most once every 5 seconds. During that time a thread of light draws itself around
  the area's border, and it flashes when the area is ready again, so you can see when the next hit will count.
- **Early hits.** A hit before then still explodes in full and makes the area show off. It just doesn't climb.
- **The firehose** counts once for every area its stream lingers on. It spreads the magic, but it never maxes one area by
  itself.

**The five stages (Team Super Rainbow):**
1. **Splash.** The blast you know, made explosive: white-hot light, leaping houses, rainbow surf, a column of light and a
   flock of paint birds. The colour stays.
2. **Bloom.** The whole block fills in. Every roof grows a garden, giant flowers taller than the houses burst out, and
   the sun breaks through over it.
3. **Fantasia.** Full Hundertwasser: onion domes, crystal crowns, rainbow waterfalls pouring off the roofs into the
   street, and fireworks.
4. **Heartbeat.** A moment of slow motion, then an 800 m beacon of light rises from the block. The block starts to pulse
   and dance to music it now plays, and a flock circles it forever.
5. **Wonder of the World.** A 9-second finale, after which a permanent **Rainbow World Tree** stands 160 m tall. It has:
   - a braided rainbow trunk and a crown of giant flowers;
   - six rainbow waterfalls pouring off its boughs;
   - a gold beacon through its heart;
   - fireworks from its crown on the beat;
   - rainbow bridges to your other Wonders.

   You can see it from anywhere in the city.

**Rivals.**
- **Knocking down.** A rival team's hit knocks an area down one stage, and you watch its top layer wilt.
- **Taking over.** The hit that knocks an area below stage 1 takes it over: everything re-dyes in the rival's colours.
  Taking a stage-5 area away from you completely takes five rival hits.
- **Never mixed.** An area always belongs to exactly one team, so colours never mix into mud.

**Every team gets the same ladder.** It is one machine with four looks:
- **Team Super Rainbow:** every colour, flowers, everything bounces.
- **Team Hyperglow:** the city after dark. Deep indigo with hot neon lines and lightning. Its Wonder is the **Arc
  Spire**.
- **Team Cloud Nine:** porcelain white, pastel and gold, and everything floats. Its Wonder is the **Sky Carousel**, a
  floating island palace ringed by balloons.
- **The Tide:** aqua, foam and coral, and everything sways. Its Wonder is the **Great Wave**, a frozen breaking wave that
  a sky whale leaps through.

**Before multiplayer,** AI rival painters fly their own buses around their home turf: Hyperglow downtown, Cloud Nine on
Nob Hill and The Tide out by Ocean Beach. They contest your frontier using exactly the rules the server will enforce
later.

**Cost and order.**
- **First: Super Rainbow's five stages.** About 46 engineer-days: MAGIC-SPEC's 29.5, plus about 17 for areas, stages and
  the World Tree. That is about 16 working days with four streams.
- **Then: the other three teams.** Mostly data plus one Wonder each, including the AI rivals: about 24 engineer-days,
  about 2 weeks.

### Decisions I need from you

1. **Area size, and the feel change it brings.** 128 m, about a block (recommended)? Or 256 m, two by two blocks, which
   means fewer Wonders and easier to max? Either way, buildings now level up together with their area, instead of each
   building escalating when you re-splat it.
2. **Counting.**
   - One blast = one stage for the area you aimed at, with at least 5 s between climbs.
   - The firehose gives +1 to each area it lingers on, never +2 (recommended).

   Or should the closer count double?
3. **Contest.**
   - One rival hit = one stage down, and the hit below stage 1 flips the area (recommended: symmetrical and simple).
   - The alternative: a Wonder takes two rival hits to knock down.

   In the shared world, stages also fade slowly unless re-hit. That ties to WORLD-TRAVEL decision 4.
4. **The four teams and their Wonders.** Super Rainbow (the World Tree), Hyperglow (the Arc Spire), Cloud Nine (the Sky
   Carousel) and The Tide (the Great Wave): names and looks OK? For Rainbow, the alternative is the Wellspring, a
   permanent 220 m rainbow geyser fountain. It is cheaper, but less Hundertwasser.
5. **Rivals in single player.** AI rivals on by default once onboarding is done (recommended), or only a team switcher in
   the menu?

---

## 1. The area model

### 1.1 What an area is

An **area** is a world-aligned **128 m square** on the same grid as the 256 m terrain tiles: 2 × 2 areas per tile and
8 × 8 per 1 km region. SF's 2,404 terrain tiles hold about 9,600 areas on land.

| Option | Street level (the chase frame is about 110 m wide at the blast) | From 500 m (1.1-2.7 m per game px) | Counting hits | Keys and server | Verdict |
|---|---|---|---|---|---|
| Per building | A house is a tenth of the frame. 5 stages per building means thousands of centerpieces. | 4-10 px: unreadable | Every blast hits about 40 buildings, so "this area" means nothing | ids migrate with each OSM release | **No.** Buildings keep L1-L3 (§1.4). |
| Street block | Perfect: the streets are the borders | Good | Blocks range from 0.3 ha (FiDi) to 400 ha (Golden Gate Park), a 1000× spread in difficulty. Tokyo's blocks are 30-60 m. | Needs a new bake product, and its ids migrate | Not v1. We borrow its virtue instead: borders follow whole buildings. |
| 64 m cell | Half the frame | 24-58 px | A base blast spans 4-9 cells, so hits are ambiguous | Fine | Too fine |
| **128 m cell** | **About one frame: you see the whole area while you hit it** | **47-116 px, 3-8 across the frame: a quilt** | **A base blast (60 m radius, 120 m across) is about one area** | **Nests in tiles (2×2), regions (8×8), server cells (64×64) and MAGIC's districts (3×3). Positional keys never migrate.** | **Pick** |
| 256 m cell (a tile) | 2-3 frames: the stage-up happens off screen | 95-230 px | 4 blasts to cover it once, so "5 hits" stops meaning "the same place" | Fine | Too coarse |
| 384 m district | – | – | This is MAGIC's lit/complete layer | – | Stays, as a derived aggregate (§1.5) |

**Borders that don't look like a grid.**
- **Buildings** belong to the area containing their *warped* centroid. The warp is a smooth ±12 m, two-octave,
  integer-hash noise, identical in JS and GLSL. A building is never split, so a border runs along lot lines.
- **Ground texels** use the same warped lookup at their texel center.
- **Where two different owners meet,** the terrain draws an `INK` seam `max(1.5 m, 2·mpp)` wide, with each side's neon
  rim (#4) just inside it: two glowing territory lines back to back. The seam is wider than any CPU/GPU rounding
  disagreement, so the two never visibly differ.
- **Where an owner meets grey,** there is no seam: the paint's own splat edge is the border.

**The anchor.** Each area has one deterministic point, computed from bake data only, so every client agrees. The beacon
and the centerpiece stand there, and the pulse starts there. It is the first of these that exists:
1. the largest open paintable ground (`GRASS` or a plaza) at least 30 m across, nearest the cell center;
2. else the street intersection nearest the center (a class-grid `PAVED` node with three or more arms);
3. else the largest flat roof of at least 400 m².

**Nesting.**
```
building (L1-L3, follows its area) ⊂ area 128 m (stage 0-5, one owner)
area ⊂ tile 256 m (2×2) ⊂ region 1 km (8×8, the save blob) ⊂ server cell 8 km (64×64, one Durable Object)
area ⊂ district 384 m (3×3, derived: music energy, far beacons, neighbourhood names)
```

### 1.2 How hits count

| Event | Effect on areas |
|---|---|
| **A tap blast lands** | Its **aim area** takes the hit. The aim area is the area of the primary building, so a wall hit counts for the tower's area, or of the impact point if there is no primary. It climbs one stage if the hitter owns it or it is grey. If a rival hits it, it goes down one stage (§1.3). Either way, only when it is off cooldown. |
| **The same blast spills** over other areas | **Grey** area: claimed at stage 1 (paint only where the blast reached), *without* starting its cooldown, so an aimed hit can climb it at once. **Own** area: its grey buildings fill in at that area's level, with no stage change. **Rival** area: nothing happens. Ground paint and building blooms are clipped at its border. |
| **Super release (mega)** | Counts as a hit on its aim area. Its 2.6× radius spill claims grey neighbours at stage 1. |
| **Firehose pour** (4 s, 12 impacts/s) | **Counted by swath.** Every area that collects at least 6 impacts (0.5 s of dwell) takes one hit, credited on the impact that crosses the threshold. Areas the stream only grazes follow the spill rules. |
| **Closer** | Counts as a hit on its aim area, if this super hasn't already credited it |
| **Any one super** (release + pour + closer) | **At most one hit per area**, deduplicated by `Blast.super.id`. A full sweep typically lifts 3-8 areas by one stage each: lavish, but it never maxes an area. |
| A miss (open water) | Nothing |

**Cooldown.** An area's stage changes **at most once every 5 s** (`areaTune.cooldown`), whoever moves it, owner or
rival. That is one timestamp per area, which the server can enforce.
- **A diegetic timer.** After each change, the **claim line** draws itself. It is a 1-px `GLOW_WHITE` thread that runs
  both ways around the area's warped border, starting from the point nearest the impact. It closes exactly when the
  cooldown ends (512 m of perimeter in 5 s). Then it flashes once (2 frames, +1 step, glow 0.6) and fades into the rim
  and seam.
- **The aim glint agrees.** On a cooling area, the glint sweeps in the owner's rim colour. On a ready area, it sweeps
  `GLOW_WHITE` (a request to the aim module).
- **Rapid taps.** The belly recharges in 1.6 s, so three taps inside 5 s give one climb and two encores (§2.6).
- **How fast an area can climb.** At the earliest, an area reaches stage 5 about 20 s after its first hit. In play it
  takes 40-90 s of circling back.
- **City-wide cap.** At most **2 stage changes start per second** across the city. Extra ones queue onto the next beat,
  at most one bar late, so a firehose sweep reads as a parade of stage-ups behind the stream rather than a pile-up.
- **One finale at a time.** Only **one stage-5 arrival plays at once**. The others play compact (§2.5).

### 1.3 Contest, overwrite, decay

**One owner, always.** Everything inside an area renders in exactly one faction's theme: buildings, ground texels,
wonders, waterfalls, the beacon and the centerpiece. The ordered dither only ever steps within one ramp, so two
factions' colours can never blend in a pixel. That makes "never muddy" structural.

| Hit | Rule | What you see |
|---|---|---|
| Owner, ready, stage < 5 | **up**: stage +1 | The next stage arrives (§2) |
| Owner, cooling (or at stage 5) | **encore**: no change | A full blast, plus a small reprise of the area's top stage (§2.6) |
| Rival, ready, stage ≥ 2 | **down**: stage −1 | The rival's blast transients play in the *rival's* theme: flash, pillar, surf, birds. The owner's buildings flinch (an inverted jelly squash), and the top stage's layer wilts in the *owner's* theme (§2.6). No rival paint sticks. |
| Rival, ready, stage 1 | **flip**: the rival owns it, at stage 1 | **Takeover.** A white-hot front sweeps from the impact across the area at 120 m/s. Behind it, every building re-floods in the new theme (#1 at 0.6 heat) and keeps its slot, and the ground re-themes behind the ring. The old claim line snaps and the new one draws. |
| Rival, cooling | **parry**: no change | The rival's transients play, and the area's charging claim line shimmers like a shield |
| Anyone, on a grey area | **claim**: stage 1 | Stage 1 |

**Decay.**
- **Single player:** stages never decay over time. Your paint is yours, and only rivals take stages away.
- **Shared world:** stages **weather down one step at a time**, never straight to grey, unless the owner re-hits the
  area. This is WORLD-TRAVEL's weathering, re-keyed from building level to area stage:

  | Stage | Weathers one step after |
  |---|---|
  | 1 | 3 days |
  | 2 | 5 days |
  | 3 | 7 days |
  | 4 | 14 days |
  | 5 | 30 days |

  Any landed owner blast resets the clock, encores included.
- **The personal layer** (WORLD-TRAVEL §8) re-shows your own paint only where the shared area has weathered back to grey,
  never over another faction's area. Nothing is ever mixed.

### 1.4 Buildings inside an area

- **Level follows the area.** A painted building's level is `level = min(3, stage)` for every building of the owner in
  that area.
- **Stages 4 and 5 add area-level layers on top of L3:** the beacon, the heartbeat, the flock and the centerpiece.
- **The old rule retires.** The per-building rule "re-splatting a building escalates it" becomes "re-hitting the area
  escalates the area" (decision 1).
- **Spill buildings cheer.** In a same-faction area they hop and re-pop their windows at 0.6 heat, but don't change
  level.
- **Hues are unchanged.** Each building keeps the colour **slot** (0-5) it was dealt when first painted, by today's
  pinwheel deal and touching-neighbour rule. The stage-2 fill deals the remaining buildings by the same `freeHue` rule,
  around the anchor.
- **Going down a stage lowers the level.** The roof-garden elements above the new level wilt: the eruption rhythm plays
  in reverse, then `sbDissolve` over 0.6 s. Paint never goes back to grey except in a flip, and then it is re-dyed, not
  erased.
- **Saved buildings.** When their area record is known, buildings restored by `PaintState.register` are corrected to
  `min(3, stage)` and the owner's faction.

### 1.5 Data layout

**Runtime** (`src/game/Areas.ts`, a struct of arrays keyed by packed `(ix, iz)`):

| Field | Type | Saved | Meaning |
|---|---|---|---|
| `faction` | u8 | yes | 0 grey, 1-15 (Rainbow = 1, the same as `FACTION_RAINBOW`) |
| `stage` | u8 | yes | 0-5 |
| `hits` | u16 | yes | landed owner blasts since this owner claimed the area, encores included (variety, stats) |
| `tended` | u32 | yes | epoch seconds of the owner's last landed hit or stage change: the weathering clock |
| `anchor` | u8, u8, i16 | yes (a cache) | meters within the cell, plus ground height in decimeters, so far beacons and centerpieces show at boot before tiles stream in |
| `lastChange` | f32 | no | game clock of the last stage change (cooldown); −∞ after a spill claim |
| `superId` | u16 | no | the last super that credited this area (at most one hit per super) |
| derived | – | no | the building list (dense indices), wonder and fall slots, the dominant slot, the district |

**Building to area.** An `Int32Array` per dense building index, filled at tile load. For SF's 141k buildings that is
about 0.56 MB.

**GPU.** `tArea` is an RG8 `DataTexture` with one texel per area over the city bounds (nearest, `texelFetch`): r =
faction, g = stage. SF's 14.3 × 17.7 km bounds give 112 × 138 texels, 31 KB.
- **Terrain** reads it for the theme, the stage gates, the seam and the rim.
- **Buildings** don't need it: their faction is already stored per building in `PaintState`.
- **Uploads:** each change is one `uploadRect`.
- **Charging claim lines** are a uniform list, `uClaim[8]` = (ix, iz, t0, faction), for the nearest 8.

**Saved.** `strugglebus.areas.v1:<slug>` is one entry per city. It holds 16 bytes per touched area, base64: ix i16, iz
i16, faction u8, stage u8, hits u16, tended u32 and the 4-byte anchor.
- **Size:** 500 areas is about 11 KB.
- **Writes** are debounced like `PaintState`'s and flushed on `pagehide`.
- **Bridges are no longer saved.** They are derived: each centerpiece links to every same-faction centerpiece within
  2 km, at most 4, nearest first, which is deterministic. `strugglebus.magic.v1` keeps only beanstalks.
- **Old saves.** When a tile registers saved painted buildings whose area has no record, the area is created at
  `stage = max(level)` of those buildings (at most 3), with faction 1 and `hits = stage`.

**Turbo travel.** Areas exist only over baked land. Each city has its own key, and the ocean has none: WORLD-TRAVEL's
ocean paintables keep their own rules. On the approach to a city, WORLD-TRAVEL's far-city layer (L4) can draw the gold
beacons straight from the area records.

**Future server shape** (WORLD-TRAVEL §8):
- **Where records live.** Area records live in the **Cell Durable Object** (an 8 km UTM square), indexed by a 12-bit
  local key (64 × 64). The global key is `(zone, ix, iz)` on the zone's 128 m easting/northing grid.
- **Record format.** It is the same 16 bytes: the local key replaces ix and iz, and a server cooldown timestamp takes
  their place. A region's write-behind blob is 64 × 16 B = 1 KB. Hourly snapshots join `paint/{zone}/{cell8}@{hour}.bin`.
- **Per-building state shrinks to "painted + slot".** Level is derived from the area, and the owner is the area's owner.
  That halves per-building state on the server.
- **Protocol:** `blast {…}` gains three fields: `aim: areaKey`, `swath: areaKey[]` and `super: id`. The Durable Object
  applies §1.6 in sequence order and broadcasts `area {key, owner, stage, hits, seq, cause}`.
- **Prediction:** your own hit is predicted locally, so the stage moment starts at impact. If the server rejects it (a
  cooldown race), the client plays the knock-down back to the true stage, which is rare.
- **Rebake migration.** When WORLD-TRAVEL moves city frames to UTM, each saved area's center is mapped to its new cell.
  Collisions merge with the GERS merge rule: the higher stage wins.

### 1.6 The rules as one pure function

`Areas.applyHit` is plain TS with no rendering. The game, the AI rivals (§4.4), the offline `tools/area-sim` and later
the Durable Object all call this same module.

```ts
type HitKind = 'aim' | 'swath' | 'spill';
interface Hit { key: number; faction: number; kind: HitKind; superId?: number; t: number }
type AreaEvent = 'claim' | 'up' | 'encore' | 'down' | 'flip' | 'parry' | 'fill' | 'blocked';

function applyHit(a: AreaRecord, h: Hit, T = areaTune): AreaEvent {
  if (h.kind === 'spill') {
    if (a.stage === 0) return claim(a, h.faction, /*startCooldown*/ false);
    return a.faction === h.faction ? 'fill' : 'blocked';
  }
  if (h.superId !== undefined && a.superId === h.superId) return a.faction === h.faction ? 'encore' : 'parry';
  if (h.superId !== undefined) a.superId = h.superId;
  if (a.stage === 0) return claim(a, h.faction, true);
  const ready = h.t - a.lastChange >= T.cooldown;
  if (a.faction === h.faction) return ready && a.stage < 5 ? up(a, h.t) : encore(a);
  if (!ready) return 'parry';
  return a.stage > 1 ? down(a, h.t) : flip(a, h.faction, h.t);
}
```

**Tunables** (`registerTunables('Areas', areaTune)`):

| Tunable | Default |
|---|---|
| `cell` | 128 (read at boot only) |
| `cooldown` | 5 |
| `changesPerSecond` | 2 |
| `dwellImpacts` | 6 |
| `warp` | 12 |
| `fillSpeed` | 120 |
| `heroes` | 8 |
| `wonders` | 24 |
| `crowns` | 4 |
| `falls` | 6 |
| `centerpieceSpacing` | 200 |

---

## 2. The five stages (Team Super Rainbow)

Every stage keeps everything from the stages below it.
- **Timings** are from the impact.
- **f0** is the impact frame plus the hit-stop frames, during which `uTime` stands still, so every effect is already at
  its peak pose (MAGIC §1.3).
- **Scale** is MAGIC-SPEC's: 0.28 m per game px at the blast on the chase lens, and 1.1-2.7 m per game px on the city
  from the vista.

### 2.0 At a glance

| Stage | The jump | Permanence | From 500 m | MAGIC effects |
|---|---|---|---|---|
| **1 Splash** | colour arrives, explosively | the surface: paint, neon rims, tufts | a coloured splat with glowing contours | #1, #2 (L1), #3, #4, #5 (transient), #6, #7 (field), #11 (first layer) |
| **2 Bloom** | the whole block fills and grows above its roofs; the sun comes out | roof height: gardens, 8 giant flowers, a sun pool | a sunlit rectangle with long shadows | adds #2 (hop), #7 (sweep + pool), #8 (L2), #9 (towers), #11 (L2) |
| **3 Fantasia** | the skyline changes | 2-4× building height: domes, 24 wonders, crystal crowns, waterfalls, resident fireworks | a bouquet skyline with glowing falls and fireworks | adds #2 (L3), #3 (aftershock), #8 (L3), #9, #10, #11 (L3) |
| **4 Heartbeat** | it lives, plays music and is seen from everywhere | an 800 m beacon, the pulse, the dance, a resident flock | a column of light and sonar rings | adds #5 (beacon), #6 (resident), #7 (sky), #11 (full), #12 |
| **5 Wonder of the World** | a permanent wonder and the game's biggest moment | a 160 m World Tree, a 1500 m gold beacon, bridges | an 80 px tree under a gold needle, readable from anywhere in the city | adds #14 (sequence), #13 (stalk template), #8 (at scale), #9 (bough falls), #10 (barrage) |

MAGIC's blast tiers (§2) still scale the *transients* of any hit: shells on big and huge blasts, and slow motion on huge,
mega and the closer. Stages decide what is *permanent*.

### 2.1 Stage 1: Splash (the first hit claims the area)

**The jump.** Colour arrives, explosively.

**Arrives.**

| t | What the player sees |
|---|---|
| f0 (+4 frames) | The peak pose: the primary's roof is white-hot (#1), the pillar stands fully extended past the top of the frame (#5), a foam crown rings the impact (#3), and birds burst out of the flash (#6) |
| 0-0.3 s | The shockwave crosses the blast. Each building floods white-hot, pops its windows in a downward shuffle (#1) and jelly-jumps (#2, L1). The surf wall rolls out, depositing the pinwheel (#3). The ground reveals white-hot, then takes its hue, then settles to its resting step (#4). |
| 0.3-1.2 s | The surf curls and breaks, the birds lock into a vortex (#6), and the pillar splits into the barber-pole ribbon |
| 0.4 s | **The claim line** starts drawing around the area's border (§1.2) |
| 1.2-2.6 s | Meadow flowers pop across painted lawns (#4), and the pillar launches out of frame (#5) |
| 5.0 s | The claim line closes and flashes: ready to climb |

**Lives on.**
- Paint at L1: colour and stained-glass windows.
- Flower tufts (the existing L1 sprouts).
- Neon rims around every splat (#4).
- The paint field nudges the sun partly through (#7).
- Near the bus, the hum and a soft heartbeat (#11).
- Nothing tall.

**Street level.** Saturated colour with glowing rims, next to a block that is still grey.

**From 500 m.** A coloured splat with 1-px neon contours, in a faint warm pool.

**Perf and caps.**

| Cost | Amount |
|---|---|
| Transients | MAGIC's tap blast: +2 transient draws (tsunami, sprite pool) plus the resident Beams draw; ≤4.8k transient triangles |
| Resident | 0 new draws or triangles |
| Claim line | about 8 ALU on painted and border ground fragments, only while it charges |
| Caps | all of MAGIC's: 3 waves, 72 birds per blast, 2 transient pillars |

**Uses:** #1, #2 (L1), #3, #4, #5 (transient), #6, #7 (field), #11 (first layer). On big and huge tiers, also #10 and
#12.

### 2.2 Stage 2: Bloom (the area fills and grows)

**The jump.** The whole block is painted, things rise above the roofs, and the sun comes out.

**Arrives.**

| t | What the player sees |
|---|---|
| f0 (+4) | The blast's peak pose. Already-painted buildings re-pour at 0.6 heat. |
| 0-0.3 s | The blast's own wave, as in stage 1 |
| 0.3-1.1 s | **The fill.** A low ground ring keeps rolling past the blast edge at 120 m/s, out to the area's border: a 2 m `GLOW_WHITE` rim and one hue band, with no surf wall. Every grey building in the area floods and jumps as the ring passes it. Every L1 building **hops 1.5 m** (#2, L2), its shadow staying on the street, and lands wearing its rooftop garden (the L2 sprouts, on the eruption rhythm). |
| 0.4-1.0 s | **8 hero wonders** erupt on the area's 8 best roofs (largest, then tallest, then by hash), rippling outward with the fill: daisies, tulips, toadstools and lantern plants 9-14 m tall (#8). Towers of 40 m and up start 1-3 waterfalls (#9). |
| 0.5-2.1 s | **The sun breaks over the area** (#7). A circle of sunlight sweeps out from the impact at 80 m/s. Sunlit faces climb 1-2 steps, ambient drops 20%, and shadows sharpen. The grey neighbours inside it warm to Hopper sun. |
| next downbeat | Kick and bass enter near the bus (#11) |
| 5.0 s | The claim line closes |

**Lives on.**
- The whole area at L2, with a garden on every roof.
- 8 giant flowers swaying at 0.5-0.7 Hz. They face the bus within 80 m and bow away from it within 16 m.
- The tower waterfalls.
- A permanent pool of golden sun. The director bumps the paint field to at least 0.7 over the area, which is one
  `pdTex` upload.
- Meadow flowers on its lawns.
- A 3% pump on every beat.

**Street level.** A garden block in raking late sun next to an overcast grey one. That contrast is the stage.

**From 500 m.** A sunlit rectangle with long shadows, the strongest territory read after hue. Flower heads are 6-9 px
dots.

**Technique.** The fill is two existing paths:
- a `PaintState` write for every building in the area, with `bloomTime = t0 + 0.3 + d/120` and level 2: one rect upload,
  at most about 150 texels;
- one `GroundPaint` job: a synthetic `BlastSpec` at the anchor, with r = 72 m and ragged edges, clipped to this area by
  `canPaint`. It runs through the normal begin → work → land.

Wonders use MAGIC #8's kit with an **area budget** (8 at this stage) instead of "one per L2 building", because a
100-building area would otherwise blow the 1200-wonder city cap on its own.
- **Few roofs:** an area with fewer than 8 suitable roofs, such as a park, places the rest on its painted lawns. This is
  the kit's ground placement, concept-living #5 trimmed to the budget.
- **Shared falls budget:** waterfalls, from towers here and from L3 roofs at stage 3, share a budget of 6 per area.

**Perf and caps.**

| Cost | Amount |
|---|---|
| Triangles | about 1.7k, plus 1.7k in the sun pass, inside the shared wonder draw (1-2 per 1536 m cell at the floor) |
| CPU | wonder layouts queued, at most 4 per frame |
| Draws | 0 new |

**Uses:** #1 (re-pour), #2 (L2 hop), #4 (meadow), #7 (sweep and pool), #8 (L2 heroes), #9 (towers), #11 (L2 layer and
pump).

### 2.3 Stage 3: Fantasia (the skyline changes)

**The jump.** The block goes full Hundertwasser. Growth reaches 2-4 times the height of the houses, rainbows pour into
the street, and fireworks rise.

**Arrives.**

| t | What the player sees |
|---|---|
| f0 (+4) | The blast's peak pose. Every building in the area flashes white at its top. |
| 0-0.6 s | **The stage wave** (the same fill path) takes every building to **L3**: onion domes, wavy bands, every window its own hue, bunting. Each one jumps with the twist (#2, L3), and towers whip. One tsunami aftershock follows at +0.25 s if a slot is free (#3). |
| 0.3-0.7 s | **16 more wonders** (24 in all) erupt in a ring wave, and **up to 4 crystal crowns** stab up on flat roofs of 25 m and up. At f10 every facet catches the low sun at once, with a "tink" chord tone (#8). |
| 0.6-3.3 s | **Up to 6 rainbow waterfalls** bulge over the street-facing roof edges, break and unroll into the street behind fat white foam heads (#9) |
| 0.9-1.5 s | **3 shells** rise from the tallest L3 roofs and burst on the beat (#10) |
| next downbeat | Glockenspiel and claps enter (#11) |

**Lives on.**
- The Hundertwasser block.
- 24 swaying wonders.
- Up to 4 gem crowns that flash as the bus moves.
- Up to 6 waterfalls with 12 fps foam.
- **Resident fireworks:** one shell from an L3 roof every 2 bars (#10; the global cap stays at 1 per 2 s).
- The pump rises to 4%, plus a shimmy.

**Street level.** Domes, flowers twice the height of the houses, and rainbows pouring into the street you're flying down.

**From 500 m.** The skyline turns from boxes into a bouquet.
- Waterfalls are 4-8 px glowing ribbons.
- Crowns are 20-40 px gems.
- A firework blooms over the area every few seconds: the city answers you from below.

**Perf and caps.**

| Cost | Amount |
|---|---|
| Wonders | +16, about 3.5k triangles (24 in all ≈ 5.2k, plus 5.2k in shadow) |
| Falls | 6 × 96 triangles, in the shared Ribbons draw |
| Shells | in the sprite pool (at most 6 airborne) |
| City caps | 1200 wonders = **50 areas of Fantasia or higher at full wonder density**, the nearest kept; farther areas keep their L3 sprouts. 256 falls ≈ 42 areas. |

**Uses:** #2 (L3 twist and whip), #3 (aftershock), #8 (L3 wonders and crowns), #9, #10 (salvo and resident), #11 (L3
layer).

### 2.4 Stage 4: Heartbeat (it lives, it sings, it's seen from everywhere)

**The jump.** The area comes alive, plays music, and stands on the skyline.

**Arrives.**

| t | What the player sees |
|---|---|
| f0 (+6 hit-stop frames) | The blast's peak pose |
| 0-1.05 s | **Money-shot slow motion** (#12): 0.2× for 0.35 s, easing back over 0.7 s. The surf curls, every house squashes, launches, hangs and lands, and the birds hang like shrapnel. |
| 0.3 s | **The beacon** erupts at the anchor: a white-hot column that splits into the seven-band ribbon, 8 m wide (never under 3 px) and 800 m tall (#5) |
| exit downbeat (~1.1 s) | **The heartbeat starts.** The first pulse ring races out from the anchor, over painted ground and roofs only (#11). Every building pumps, a stadium wave rolls through the area once per bar, and the sky toward the area warms (#7, the sky LUT). |
| 1.1-3 s | 24 of the blast's birds settle into a **resident murmuration** circling the beacon 60-120 m up (#6) |

The music near the area becomes the full groove: choir pad, glockenspiel and kick on four. The area is a speaker.

**Lives on.**
- The beacon. It breathes by 1 px on the beat, a slug climbs it every bar, and flying through it gives a chime and
  sparkles.
- Pulse rings on every beat.
- A dancing block.
- The resident flock.
- Resident fireworks twice as often.

**Street level.** Beacons stand on the horizon toward your Heartbeat areas: navigation with no HUD.

**From 500 m.** A 3-8 px column rises out of the area into the sky band, with sonar rings radiating from its foot. Your
progress map is the skyline.

**Perf and caps.**

| Item | Cost or cap |
|---|---|
| Beacon | one Beams instance, 0 new draws. **Beams' cap goes from 16 to 32.** Beacons are per area within 1.5 km, and merged into one per 384 m district beyond that, showing the district's top stage in its top owner's theme. |
| Pulse and pump | as #11: the nearest 4 anchors pulse; about 30 ALU per painted fragment and 15 per painted vertex |
| Resident flocks | 24 sprites each; the nearest 8 flocks, 192 sprites in the pool |
| Slow motion | at most once per 10 s, never on two blasts in a row (#12) |

**Uses:** #5 (beacon), #6 (resident flock), #7 (sky warmth), #10 (double rate), #11 (pulse, pump, full groove), #12.

### 2.5 Stage 5: Wonder of the World (the Rainbow World Tree)

**The jump.** The over-the-top display: MAGIC #14's Sunburst, rescaled to the area, plus one permanent signature wonder.

**Arrives** (8-9 s; the player keeps control):

| t | What the player sees |
|---|---|
| f0 | The finishing blast flashes for 2 frames and holds 8 hit-stop frames |
| 0-0.5 s (0.2×) | **Every building in the area** re-flares its windows and jelly-jumps in a stadium wave from the anchor (`uCarnival`). The surf is double height. |
| 0.3 s | The ground at the anchor splits in a star of `GLOW_WHITE` cracks (a terrain disc uniform). The beacon flares white and **turns gold**: `YELLOW` steps 5-7, 16 m wide, 1500 m tall. |
| 0.4-1.0 s | **The trunk punches up.** Three rainbow-striped stalks braid upward to 60 m in 0.6 s on the stab beat: the #13 beanstalk template, three helices sharing an axis. Roots heave out across the streets as chains of carved blobs. |
| 1.0-2.5 s | The trunk climbs on to 140-160 m, and its boughs flick out on the snap beat |
| 1.2 s (1×, downbeat) | **Key change.** The sun breaks full over the area, and with `?fog` the fog burns off (#7). |
| 2.5-3.5 s | **The crown explodes open:** 24 giant flower lobes (the #8 kit at 3-4×) pop out in a wave with 25% overshoot, with a 2-frame flash, a sparkle storm and a triple murmuration bursting out of the crown (#6) |
| 3.5-6 s | **Six seven-band waterfalls** unroll off the boughs (#9), dropping 100-130 m and landing in the streets in 2-3 s, each with a splash. **Rainbow bridges** draw themselves to every other Super Rainbow centerpiece within 2 km, at most 4 (#14). |
| 1.6-7 s | **Barrage:** the area's L3 roofs fire in spiral order, one per quarter beat (cap 12), plus 4 big shells from the crown (#10) |
| 7-9 s | The biggest shell in the game bursts from the crown, 300 m up with a 150 m radius. The street sign names the neighbourhood in `GLOW_WHITE` for the first Wonder there (`signs.celebrate`). |

**Lives on.**
- **The tree:** it sways at 0.15 Hz, 1.5 m at the crown. Its flower lobes track the sun and **duck away from the bus**,
  so you can thread the canopy.
- The six bough waterfalls.
- The gold beacon rising through the crown.
- The resident flock wheeling around the crown.
- A crown firework on every second downbeat.
- The bridges, with a `GLOW_WHITE` sheen every bar.
- The area dances at 1.5×.
- Near it, the groove plays in the new key.
- The firehose beanstalk (#13) stays the super's own landmark, separate from the tree.

**Street level.** A tree 12-15 Victorians tall stands in the intersection with its roots across the streets, and
rainbows pour off it into the street. At the chase lens it fills about two thirds of the frame height.

**From 500 m.** At 2 m per px, the tree is 80 px tall with a 35 px crown, under a 1500 m gold needle: readable from
anywhere in the city. The bridges stitch your Wonders into a web, the best "look what I did" screenshot in the game.

**Technique.**
- **The centerpiece kit.** New `src/world/props/monuments.ts`. A recipe composes five shared parts:
  - **Stalk:** the #13 helix tube;
  - **Crown:** #8's carved blobs and facets, at scale;
  - **Ribbon:** #9 and #14;
  - **Column:** #5;
  - **Orbit:** pool sprites.
- **Hero parts.** Each faction adds at most one bespoke hero part (§3.5).
- **Placement:** at the anchor (§1.1).
- **Obstacle:** a post of r 10 m up to the crown base. The crown lobes duck through `uBus`, like the flowers do.
- **Saving:** no new save data. The tree is derived from the area record and its cached anchor.

**Perf and caps (distance LOD).**

| LOD | Where | What draws | Triangles |
|---|---|---|---|
| **LOD0** | ≤1.2 km, **the nearest 3** | full template, animated, 6 falls, the flock; casts | about 3k (+2.5k caster) |
| **LOD1** | ≤4 km, the next 12 | trunk and crown, 2 falls; no flock, no caster | about 0.8k |
| **LOD2** | ≤10 km, up to 64 | a lollipop impostor in flat steps, **one shared draw for every faction**, plus the gold beacon | about 60 |
| beyond | – | the gold beacon only (district-merged) | 0 |

- **Draws:** +1 per faction kit visible at LOD0-1, +1 caster, and +1 for the impostors. The arrival adds +2 transient
  draws (tsunami, pool), as in #14.
- **Triangles at the caps:** about 22k, plus 7.5k in shadow.
- **CPU:** arrival spawns take at most 0.3 ms per frame, spread over quarter beats. 0 resident CPU, since everything is
  vertex-animated.
- **Fill guard:** crown lobes over 40 px on screen switch to plain polygon depth (no carve, no discard), so a near canopy
  doesn't defeat Apple's hidden-surface removal.
- **Overlap:** a second stage-5 arrival while one is playing (a firehose sweep) erupts **compact**, a bar later: the tree
  grows and 6 shells fire, but with no slow motion and no key change.
- **Governor:** `magicTune.quality` also scales LOD0's distance (1.2 → 0.6 km) and count (3 → 1).

**Uses:** #14 (the sequence), #12, #1, #2 (carnival), #3 (double height), #5 (gold beacon), #6 (triple and resident),
#7 (full), #8 (the kit at scale), #9 (bough falls), #10 (barrage and crown), #11 (key change), #13 (stalk template),
plus the new centerpiece kit.

### 2.6 Encore and going down

| Stage | Encore (an owner hit during cooldown, or at stage 5) | Knock-down by a rival's ready hit (in the owner's theme) |
|---|---|---|
| 1 | the blast only | **flip** (§1.3) |
| 2 | the hero flowers flash their cores and puff pollen | 2 → 1: the gardens and the 8 heroes wilt into the roofs (the eruption rhythm in reverse, then dissolve), and the sun pool clouds over, shrinking inward at 80 m/s. Filled buildings stay painted. |
| 3 | 1 shell from the tallest L3 roof | 3 → 2: domes and crowns deflate, crystals shatter into sparkles, waterfalls dry top-down, and the wonders shrink back to the 8 heroes |
| 4 | the beacon flares with a burst of slugs; the flock swirls | 4 → 3: the beacon's base detaches and it launches out of frame (the pillar's exit), the flock peels off, and the pulse stops on the next beat |
| 5 | the tree performs: the crown flares, the falls surge, a 3-shell salvo | 5 → 4: the crown lobes deflate to buds and drop as petals (pool sprites), the bough falls dry, the trunk sinks back into the ground over 2 s, the gold beacon reverts to the stage-4 beacon, and the bridges dissolve from the middle out |

Every one of these is transient and at most 2 s long, and all of them count toward the 2-per-second stage-change cap.

### 2.7 Roll-up (iPhone A15, against MAGIC-SPEC §7)

| | MAGIC, peak | Heavy street view (Alamo Square, 6 areas at stages 3-5) | 500 m (40 painted areas, 8 centerpieces, 4 factions) |
|---|---|---|---|
| Draws | +12 to +14 | MAGIC's typical draws, plus monuments 1-2 and 1 caster | MAGIC's typical draws, plus monuments up to 4, 1 caster and 1 impostor draw |
| Triangles | +300k at the caps | wonders ≤ 6 × 5.2k, plus 1-3 trees at 3k | the 260k wonder cap, plus monuments ~22k and impostors ~4k |
| CPU per frame | +0.05-0.1 ms | plus the area rules (~0.02 ms per hit), the claim list, and a 2 Hz LOD sort | plus the AI rivals (~0.05 ms, §4.4) |
| Uploads | one per texture | plus `tArea`, one rect per change | same |
| Storage | magic.v1 < 8 KB | plus `areas.v1`, about 11 KB per 500 areas | same |

| Element | Full detail | Reduced | Gone |
|---|---|---|---|
| Paint, rims, sun pool | always (coarse regions share the materials) | – | never |
| Wonders and crowns | the nearest 1200, within 2400 m (1200 m at low quality) | the 2-px floor (`uPxK`) | beyond |
| Waterfalls | the nearest 256, within 2400 m (96 at low quality) | the 2-px band floor | beyond |
| Resident fireworks | areas within 2 km | the global cap of 1 per 2 s | beyond |
| Beacons | per area within 1.5 km (32 instances) | merged per district | the 30 km far plane |
| Resident flocks | the nearest 8, within 1.2 km | – | beyond |
| Pulse | the nearest 4 anchors | – | – |
| Centerpieces | LOD0: 3 | LOD1: 12; LOD2: 64 | beacon only |

---

## 3. Factions: one machine, four themes

### 3.1 The rule of equivalence

Everything in §1-§2 is **shared machinery**: the rules, timings, caps, budgets, LODs and the map from stages to effects.

A **theme** may change four things:
- the looks: ramps, value windows and band orders;
- the shape variants;
- the motion numbers;
- the sound.

Every faction's stage *n* uses the same effect slots at the same costs, and every centerpiece fits one **envelope**:

| Limit | Value |
|---|---|
| Height above its anchor | ≤160 m |
| Crown or footprint | ≤70 m |
| Triangles | LOD0 ≤3k (+3k caster), LOD1 ≤900, LOD2 ≤80 |
| Ribbons | ≤6 |
| Orbit sprites | ≤48 |
| Obstacle | one post (with `under` if it floats) |
| Resident performance | one per 2 bars |

That is what "equivalent" means in code.

### 3.2 Theme schema

```ts
// src/game/factions/types.ts: data only. Every magic module reads its look from here.
export interface FactionTheme {
  id: number;                        // PaintState faction: 1 rainbow, 2 hyperglow, 3 cloud9, 4 tide (0 = grey; room for 15)
  key: string;                       // 'rainbow'
  name: string;                      // 'Team Super Rainbow'
  motto: string;                     // the one-line identity

  palette: {
    slots: [Slot, Slot, Slot, Slot, Slot, Slot]; // dealt around an impact; touching neighbours never share one
    wheel: number[];                 // slot order for "+2 / complement" rules (petals = hue + 2, ribbon edges = complement)
    core: RampId;                    // white-hot arrival, crests, seeds (GLOW_WHITE for all four)
    accent: RampId;                  // the stage-5 metal: gold beacon, crown trim
    rim: { step: number; glow: number }; // neon rim and claim line, in each slot's line ramp
    ribbon: Array<[RampId, number]>; // 7 bands (ramp, step) + core; neighbours luminance-matched (validator)
    glassGlow: [number, number];     // resting window glow L1-2 / L3, at most 0.55
  };
  light: {
    pool: 'golden' | 'dusk' | 'highkey' | 'caustic'; // what the stage-2 sun pool does to ITS painted surfaces
    sky: RampId;                     // the sky-LUT ramp toward its areas
  };                                 // (grey neighbours always get the same light lift: grey only receives light)
  shapes: {
    wave: 'bands' | 'scan' | 'puff' | 'foam';         // #3 surf face
    beam: 'ribbon' | 'bolt' | 'soft' | 'spiral';      // #5 pillar and beacon
    fall: 'bands' | 'rain' | 'cloud' | 'water';       // #9
    sprite: 'bird' | 'spark' | 'balloon' | 'fish';    // #6 flock and resident flock
    shells: Array<'peony' | 'ring' | 'willow' | 'crackle' | 'chrysanthemum' | 'heart' | 'fountain'>; // #10
    meadow: 'flowers' | 'circuit' | 'sprinkles' | 'bubbles';   // #4
    wonders: { hero: WonderVariant[]; set: WonderVariant[]; crown: 'crystal' | 'antenna' | 'dome' | 'pearl' }; // #8
    superMark: 'beanstalk' | 'coil' | 'cloudTower' | 'waterspout';   // #13
  };
  motion: {
    erupt: { stab: number; swell: number; snap: number; settle: number }; // sbErupt shape (MAGIC §1.3 beats)
    jelly: { stretch: number; hop: number; hang: number; twist: number; whip: number; settle: number }; // #2
    sway: { hz: number; amp: number; travel: boolean };
    pump: [number, number, number];  // L1, L2, L3 (#11)
    feel: 'straight' | 'sixteenths' | 'triplets' | 'dub';  // subdivision on the ONE shared 84 BPM clock
  };
  sound: {
    key: string; progression: string[];          // each splat advances one chord, as today
    voices: { lead: VoiceId; pad: VoiceId; bass: VoiceId; perc: KitId };
    layers: [Layer, Layer, Layer, Layer, Layer]; // what joins the groove near the bus at stages 1..5
    stingers: [SfxId, SfxId, SfxId, SfxId, SfxId]; // stage-arrival one-shots
  };
  centerpiece: CenterpieceRecipe;
}
export interface Slot { body: RampId; line: RampId; lo: number; rest: number; hi: number } // value window, ramp steps 0-7
export interface CenterpieceRecipe {
  name: string;                      // 'The World Tree'
  parts: Array<{ kind: 'stalk' | 'crown' | 'ribbon' | 'column' | 'orbit' | 'hero'; params: Record<string, number | string> }>;
  arrival: Array<{ t: number; part: number; verb: 'crack' | 'stab' | 'climb' | 'open' | 'pour' | 'orbit' | 'rise' }>;
  perform: { everyBars: number; verb: string };   // the resident performance
}
```

**On the GPU.**
- **One generated chunk.** `GLSL_THEMES` is generated at boot from the registry. It holds `SB_THEME_RAMP(f, slot)`,
  `SB_THEME_LINE(f, slot)`, `SB_THEME_WINDOW(f, slot)` (lo, rest, hi) and the style enums.
- **It replaces the hue literals.** These are the `const SB_*_HUES[6]` arrays now baked into `GroundPaint.ts`,
  `props/common.ts` and `buildingMaterial.ts`.
- **Factions cost nothing at runtime.** They are compile-time data: 0 uniforms and 0 texture reads.
- **The value window.** `light` is remapped into `[lo, hi]`, with `rest` as the resting step, so the same six ramps give
  three different value structures:
  - Rainbow's mid values;
  - Hyperglow's dark bodies with bright lines;
  - Cloud Nine's high key.
- **On the CPU,** `Particles` takes a `palette` ramp list instead of `HUE_RAMPS` (a request, §4.5).

### 3.3 What each MAGIC effect reads from the theme

| # | Effect | The theme supplies | Rainbow | How the others differ |
|---|---|---|---|---|
| 1 | Flood + window pop | core, slots, value window, glassGlow | white → hue 7 → rest | Hyperglow pours its light into the *lines* and leaves the bodies dark. Cloud Nine pours `PEARL`. Tide pours foam white. |
| 2 | Jelly | motion.jelly | stretch 1.28, hop 1.5 m, twist ±12° | Hyperglow snaps: no squash, a 0.25 s settle. Cloud Nine floats: a 3 m hop with a 0.8 s hang. Tide rolls: the hop travels as a swell. |
| 3 | Tsunami | shapes.wave, ribbon | seven-band surf | Hyperglow: a dark wall with scanline crests. Cloud Nine: a rolling cloud bank. Tide: a bigger aqua breaker with a white foam lip. |
| 4 | Neon ground + meadow | rim, meadow | flowers | Hyperglow: circuit traces (a 1.6 m grid). Cloud Nine: pastel sprinkles. Tide: bubble rings. |
| 5 | Pillar / beacon | shapes.beam, accent | ribbon; gold at stage 5 | Hyperglow: a lightning column (a row-wise zigzag, still with integer-pixel edges). Cloud Nine: a soft sunbeam with a dithered top. Tide: a waterspout (spiral bands). |
| 6 | Flock | shapes.sprite | V-birds | Hyperglow: 4-point sparks. Cloud Nine: 4×5 px balloons. Tide: 5×2 px koi with flicking tails. |
| 7 | Sunbreak | light.pool, light.sky | golden; `SKY_WARM` | Hyperglow: dusk on its own surfaces (lines +0.1 glow), with a `NIGHT_SKY` wedge toward its turf (WORLD-TRAVEL's row). Cloud Nine: high key, with more ambient and soft shadows. Tide: a 12 fps caustic net (+1 step, 4 m cells). |
| 8 | Wonders | shapes.wonders | daisy, tulip, toadstool, lantern; crystal crowns | Hyperglow: neon-tube stems and orb lamps, antenna crowns. Cloud Nine: cumulus trees, tethered balloons, gold onion domes. Tide: fan corals, kelp spears, anemones, pearl crowns. All of them are slot tables on the same template. |
| 9 | Falls | shapes.fall | seven bands, 12 fps foam | Hyperglow: data rain (stepped vertical streaks). Cloud Nine: a cloud-fall of white puffs. Tide: real blue-white water. |
| 10 | Fireworks | shapes.shells, sound | peony, ring, willow | Hyperglow: crackle rings. Cloud Nine: chrysanthemum and heart. Tide: fountain spray. |
| 11 | Heartbeat | motion.pump, feel, sound | straight 8ths, canon in D | Hyperglow: 16ths in A minor. Cloud Nine: triplets in G. Tide: dub offbeats in E Mixolydian. |
| 12 | Slow motion | sound (the slow-mo stinger) | low-pass whoomp | per theme |
| 13 | Firehose landmark | shapes.superMark | beanstalk | Hyperglow: a Tesla coil. Cloud Nine: a cloud tower. Tide: a waterspout. All are built on the stalk template. |
| 14 | Stage-5 arrival | centerpiece, stingers | World Tree | §3.5 |

**The shape families stay three** (MAGIC §1.2):
- **The Ribbon:** a bolt is a Ribbon whose centerline zigzags, and a curl is a Ribbon strip.
- **The Carved Blob:** puffs, corals and orbs are slot tables.
- **The Pixel Sprite:** sparks, balloons and fish are sprite shapes.

### 3.4 Palette rules for factions

1. **One ramp per pixel.** Dithering only ever steps between neighbouring steps of one ramp, so factions never blend.
   Faction borders get the `INK` seam (§1.1).
2. **No brown.** Yellow, orange and every warm slot stay at step 3 or higher, and coral (`RED`) at step 4 or higher. The
   new ramps' dark steps shadow toward indigo or violet: never brown, and never grey-green, so paint can't read as the
   unpainted `GREEN_GREY` trees.
3. **Paint never reads as grey.** Every body step a theme can show must be at least ΔE 12 from every `GREY`/`GREY_LIGHT`
   step. The validator checks this (§3.6).
4. **Grey only receives light.** Every theme's sunbreak gives grey neighbours the same light lift, never a hue. A
   faction's light character lives on its own surfaces and in the sky.
5. **The same glow budget for all.** Resting glow stays at or below 0.55, and glow above 0.6 covers at most about 3% of
   painted pixels. Hyperglow's lines rest at 0.5.
6. **The same anti-strobe rules for all.** At most +1 step, at most 1.4 Hz, never a whole-surface flash. Hyperglow's
   bolts follow them too (§3.5).
7. **Four new ramps.** This is a render-owner change, rows 20-23. The values below are proposals, to be art-directed later
   and validator-checked. WORLD-TRAVEL's six rows move to 24-29, which leaves 2 rows spare.

| Ramp | Steps 0 → 7 | Note |
|---|---|---|
| `MAGENTA` (20) | `#2a0a3a #4a0f5e #7a1488 #b01aa8 #e02cc0 #ff5ad6 #ff9ae6 #ffd6f6` | – |
| `CYAN` (21) | `#0a1a4a #0a2e70 #0a4c94 #0878b4 #0aaed0 #30dce8 #86f4f4 #dcffff` | – |
| `PEARL` (22) | `#3a2c5c #54467a #706498 #9086b4 #b0a8cc #cec8e2 #e8e4f2 #ffffff` | white with lilac shadows, so shadowed porcelain never reads as battleship grey |
| `AQUA` (23) | `#101a4c #0e3270 #0c5486 #0a7c90 #12a49c #38c8ac #86e6c8 #d6fff0` | – |

### 3.5 The four launch factions

| | **Team Super Rainbow** | **Team Hyperglow** | **Team Cloud Nine** | **The Tide** |
|---|---|---|---|---|
| **Identity** | "Every colour, all at once": a saturated six-hue quilt that bounces | "The city after dark": deep indigo bodies with hot magenta and cyan neon line light | "Porcelain heaven": pearl white, pastel and gold leaf; everything floats | "The ocean comes to town": aqua and foam with coral; everything sways |
| **Value read at 500 m** | mid value, every hue, neighbours always differ | dark patches with bright contours | the brightest patches in the city, with gold glints | mid-value cool patches with white foam lines |
| **Slots** (body / line, window) | RED, ORANGE, YELLOW, GREEN, BLUE and VIOLET, with `WHITE`/`GLOW_WHITE` trim; window 2-7 (3-7 for warm hues) | VIOLET/MAGENTA, BLUE/CYAN, VIOLET/CYAN, BLUE/MAGENTA, MAGENTA/CYAN, CYAN/MAGENTA; bodies 0-3, lines 5-7 | PEARL with pink (RED), mint (GREEN), sky (BLUE) or lilac (VIOLET) trim; plus pink and sky bodies with PEARL or gold trim; window 4-7 (pastels 5-7) | AQUA/WHITE, BLUE/WHITE, light AQUA/BLUE, deep BLUE/AQUA, coral (RED 4-6)/AQUA, WHITE/AQUA |
| **Accent** (stage-5 metal) | gold (`YELLOW` 5-7) | `MAGENTA` 7 with `GLOW_WHITE` | gold (`YELLOW` 5-7) | `WHITE` foam with `AQUA` 7 |
| **Shapes** | flowers, toadstools, lanterns, ribbons, V-birds | tubes, orbs, antennae, bolts, sparks | cumulus puffs, onion domes, balloons, doves | curls, fan corals, kelp, shells, koi |
| **Motion** | jelly bounce; sway 0.6 Hz | snap: rigid, no wobble, lines blink on in 16ths | float: 3 m hops, a long hang; sway 0.2 Hz | swell: a travelling rise and fall; kelp sway 0.35 Hz |
| **Music** (all synthesized, all at 84 BPM) | D major, Pachelbel's canon (today's): marimba, glockenspiel, choir | A minor, i-VI-III-VII: a 16th-note pulse arpeggio, gated pad, claps, sub bass | G major, I-vi-IV-V: a celesta music box, harp in triplets, an "ahh" choir, brushes | E Mixolydian, an I-bVII sway: steel-pan bells, a dub offbeat skank, gliding bass, a surf bed, a whale pad |
| **Light** | a golden sun pool | dusk on its surfaces, and a night-sky wedge | high key, soft shadows | a caustic net |
| **Firehose mark** | beanstalk | Tesla coil | cloud tower | waterspout |
| **Rival home turf in SF** | – (the player) | SoMa and FiDi | Nob Hill and Pacific Heights | the Outer Sunset and Ocean Beach |
| **Bus livery** (§4.4) | yellow (the hero) | black with magenta and cyan stripes | pearl with gold | teal with a white wave |
| **Stage 5** | **The World Tree** | **The Arc Spire** | **The Sky Carousel** | **The Great Wave** |

**Stage signatures** (the same slots, different looks):

| Stage | Super Rainbow | Hyperglow | Cloud Nine | The Tide |
|---|---|---|---|---|
| 1 Splash | rainbow surf, V-birds, meadow flowers | a dark scanline wall, a spark swarm, circuit traces | a cloud-bank surf, doves, pastel sprinkles | an aqua breaker, leaping koi, bubble rings |
| 2 Bloom | 8 giant flowers, a golden sun pool | 8 neon-tube lamps, a dusk pool where the lines blaze | 8 cumulus trees and tethered balloons, a high-key pool | 8 fan corals and kelp, a caustic pool |
| 3 Fantasia | Hundertwasser domes, crystal crowns, rainbow falls, peony shells | tube-outlined domes, antenna crowns, data-rain falls, crackle rings | gold onion domes, balloon releases, cloud-falls, heart shells | shell domes, pearl crowns, real waterfalls, fountain shells |
| 4 Heartbeat | a seven-band beacon, a bird murmuration | a lightning-column beacon, a spark murmuration, a scanline pulse | a soft sunbeam beacon, a balloon carousel, a swell pulse | a waterspout beacon, a koi school, a ripple pulse |
| 5 Wonder | the World Tree | the Arc Spire | the Sky Carousel | the Great Wave |

#### The Arc Spire (Hyperglow)

**Arrives.**
- The ground at the anchor opens in a square of circuit cracks.
- Four neon tube ribs stab up and spiral to 160 m in 0.8 s, and 12 rings snap on from bottom to top in 16ths.
- An 18 m plasma orb ignites at the top: a carved blob with a `GLOW_WHITE` core and a `MAGENTA` rim, glow 0.8 on the core
  only.
- On the key-change downbeat, the first bolt barrage hits every L3 roof in the area in a 1 s spiral.
- A halo ring forms at 110 m.

**Lives on.**
- The halo turns at 3°/s.
- On every 2nd beat, 1-3 bolts leap from the orb to L3 roofs. A bolt is a zigzag Ribbon that draws itself in over 2
  frames and lives 0.3 s.
- On every downbeat the rings blink on from bottom to top.

**From 500 m.** A needle of light with a bright orb, short-lived bolts and an elliptical halo.

**Kit.** Stalk (the ribs), Ribbon (rings, halo, bolts), Crown (the orb), Column (the beacon).

**Hero part.** The **bolt**, which its Tesla-coil firehose mark shares.

**Safety.**
- At most one bolt burst per 2 beats (0.7 Hz) per spire.
- A 2-frame flash at most once per bar.
- Only the nearest 3 spires perform; the others hold still.

#### The Sky Carousel (Cloud Nine)

**Arrives.**
- A cloud bank boils up out of the area's streets.
- A 60 m island tears free at the anchor. The crack disc leaves a glowing pool behind.
- The island rises to 130 m over 3 s with an ease-out.
- A palace of gold onion domes and white puff towers pops open on top, on the snap beat.
- 12 hot-air balloons spring off the L3 roofs and swing into orbit around it.

**Lives on.**
- It turns at 1°/s like a music box, and its long shadow sweeps the city.
- A cloud-fall pours off the rim and dissolves halfway down.
- Pastel streamers run from the spires to the balloons.
- Every 2 bars, a new balloon lifts off a roof and joins the ring, and the oldest drifts up and pops into a pastel
  chrysanthemum at 400 m.
- The bus can fly under it: the obstacle post has `under`, like the Golden Gate deck.

**From 500 m.** An island at the bus's own altitude: the altitude image.

**Kit.** Crown (domes, puffs), Ribbon (the cloud-fall, streamers), Orbit (balloons as pool sprites, 6-10 px).

**Hero part.** The **island rock cone**: the concept-living #9 template, in `PEARL`/`VIOLET` rock with `BLUE` crystal
points. It is never brown.

#### The Great Wave (The Tide)

**Arrives.**
- The area's streets flood with a 1 m caustic sheen.
- A wave rises out of them to 110 m in 1.2 s (stab, then swell), along a 120° arc facing the nearest shore.
- It curls over on the snap with 20% overshoot, and freezes on the key-change downbeat.
- At 3.5 s a 40 m sky whale (a carved-blob chain in `BLUE`/`WHITE`) breaches up through the tube.

**Lives on.**
- Foam fingers on the lip step at 12 fps, and spray sprites fly off the crest.
- The whale breaches every 4 bars, arcs over and dives back in with a fountain shell.
- A koi school circles it.
- The tube is open, so you can thread it under the curl. The obstacle posts stand at the foot and at the lip.

**From 500 m.** A giant aqua crescent with a white lip: Hokusai over the city, and a nod to Tokyo.

**Kit.** Ribbon (foam), Orbit (koi), Crown (the whale's blobs).

**Hero part.** The **frozen curl**: the PaintWave strip in a static mode (k = 0.85, curl 0.35·H), drawn in the resident
monument draw.

### 3.6 The theme validator

`tools/theme-check.mjs` runs on every theme. A faction ships only when every check passes:

| Check | Pass condition |
|---|---|
| Distinct from grey | ΔE ≥ 12 between any body step a slot's window allows and any `GREY`/`GREY_LIGHT` step |
| Distinct from other factions | ΔE ≥ 10 between factions' resting bodies, slot for slot |
| Ribbon | neighbouring bands luminance-matched, so 1-px value edges don't crawl |
| No brown | warm slots at step 3 or higher; no step falls in the brown hue/saturation band |
| Glow budget | the budget holds in a synthetic painted frame |
| Centerpiece | fits the envelope (§3.1) |

The riskiest read is **Cloud Nine against sunlit grey**. It is guarded in the data as well: at least 25% of each
building's facade pixels must be pastel trim.

---

## 4. Build plan

### 4.1 What changes in the workstreams

MAGIC-SPEC's three streams keep their file sets. I add one small fourth stream to own the new core: areas and rivals.
Without a fourth engineer, WS-3 absorbs it and Phase A takes about 4 days longer.

| Stream | Changes to MAGIC-SPEC's scope | New or edited files | Days (MAGIC → with stages) |
|---|---|---|---|
| **WS-1 Light & Beat** | the theme GLSL tables and value windows; `tArea` sampling and stage gates in terrain; the claim line and seam (`GLSL_CLAIM`, next to `GLSL_PULSE`); the ground clip (`canPaint`) and the stage-2 ground fill job; groove layers keyed by stage, with music sets as theme data; the theme registry and validator | new `src/game/factions/*` (registry, Rainbow data) and `tools/theme-check.mjs`; edits as in MAGIC, plus about 10 lines of `GroundPaint` CPU | 10.25 → **14.5** |
| **WS-2 Sky FX** | theme style switches in PaintWave, Beams, Ribbons and Celebration; the Beams cap of 32 with the district merge; resident flocks; **takes #13 from WS-3** as a new `src/fx/magic/Stalks.ts`, which also builds the World Tree's braided trunk and roots; bough falls; bridges between centerpieces; the knock-down variants (falls dry, the beacon snaps, the flock scatters); the LOD2 impostor draw | new files only | 9 → **14.5** |
| **WS-3 Growth & Director** | the director routes permanent effects by **stage** (tiers still scale the transients); the stage wave and fill; area budgets (wonders 8/24, crowns 4, falls 6); encore, knock-down and flip choreography; the sprouts wilt path; **`monuments.ts`**: the centerpiece kit and the World Tree's crown, recipe, anchor and LOD logic. `Districts.ts` shrinks to a derived aggregate. | new `src/world/props/monuments.ts`; edits as in MAGIC | 10.25 → **13.25** |
| **WS-4 Areas & Rivals** (new) | `src/game/Areas.ts`: the grid, warp, building-to-area map, records, the rules (§1.6), persistence, migration and `tArea`. The hooks in `Splat.ts` and `PaintState.ts` (§4.5). The team switcher and seeded rivals. Later, `src/game/Rivals.ts` and `tools/area-sim`. | new `Areas.ts`, `Rivals.ts` and `tools/area-sim/*`; small hooks after supersplat merges | – → **4 (Phase A) + 3.75 (Phase C)** |

Ownership stays disjoint:
- WS-2 is still new files only.
- WS-4's edits to `Splat.ts` and `PaintState.ts` are call-site hooks, about 20 lines in all. They land after
  feat/supersplat merges, since it also edits `Splat.ts`.
- Theme files are data that anyone may add to, reviewed by the stream whose styles they use.

### 4.2 Order: Super Rainbow's five stages first

| Sprint | Days | Ships | Work |
|---|---|---|---|
| **A1 "Claim it"** | 1-4 | **Stage 1** and the area model | F1, F3-lite, the Areas core (grid, hits, cooldown, save, `tArea`), the claim line, #12, #1, #2, #3, #6 and the transient #5. A `?areas` debug overlay draws the cells and their stages. |
| **A2 "It grows"** | 5-9 | **Stages 2 and 3** | the stage wave and fill, #4, #7, #8 with area budgets, #9, #10 |
| **A3 "It sings, it's contested"** | 9-12 | **Stage 4**, and contest | area beacons (#5: cap 32, district merge), #11 (pulse, pump and groove), the resident flock, knock-down, flip and encore, the sprouts wilt path. The **team switcher** and **seeded rivals**, using a debug-only "Mirror" theme (Rainbow's assets with BLUE and VIOLET slots, exempt from the validator) so contest and seams can be tested before a real rival exists. |
| **A4 "Wonder of the World"** | 12-16 | **Stage 5**: Super Rainbow complete | Stalks (#13, the beanstalk first), the monuments kit and the World Tree, #14 re-scoped to the area with bridges, the LODs and impostor, QA (§4.6) |
| **C1 "A rival"** | 17-22 | **Hyperglow end to end**, and the AI rivals | Hyperglow has the most different value structure, so it proves the theme system: if it is mostly data, the rest will be. Also the palette rows and the rivals AI. |
| **C2 "The full league"** | 22-27 | **Cloud Nine and The Tide**, in parallel | data, styles, music sets, the Sky Carousel and the Great Wave; rivals tuned against all three |

### 4.3 Other factions are mostly data

The cost of one more faction, once Super Rainbow and Hyperglow exist:

| Item | Stream | Days |
|---|---|---|
| The theme file: slots, windows, wheel, ribbon, motion numbers, stage looks | any | 0.5 |
| Surface light style and meadow variant (the first faction to use each style enum pays for its branch) | WS-1 | 0.5-1 |
| Music set: progression, voices, layers, stingers (data for `groove.ts`) | WS-1 | 1 |
| Wave, beam, fall, sprite and shell styles | WS-2 | 1 |
| Wonder variants (4 slot tables) | WS-3 | 0.75 |
| Centerpiece: recipe, one hero part, arrival | WS-2 + WS-3 | Spire 2.25, Carousel 2.75, Wave 2.5 |
| Look-dev and validator pass | any | 0.25-0.5 |

**Phase C totals:**

| Who | Days |
|---|---|
| WS-1 | 6 |
| WS-2 | 6 |
| WS-3 | 7.5 |
| WS-4 (rivals) | 3.75 |
| Render owner (palette rows) | 0.5 |
| Bus owner (liveries) | 0.5 |
| **Total** | **≈ 24 engineer-days, about 9-10 working days** |

**The whole program:** about 70 engineer-days, about 5-6 calendar weeks with four streams.

### 4.4 Seeing rivals before multiplayer

1. **Team switcher** (A3, 0.25 d). `?team=hyperglow` and a menu toggle let you play any team. It is also the look-dev
   and QA tool.
2. **Seeded rivals** (A3, 0.5 d). `?rivals=seed` paints deterministic rival territories at chosen stages, like
   `__game.seedGround`. Every faction's five stages, seams and borders can then be shot and judged with no AI.
3. **AI rival painters** (C1: 2.5 d, plus 1 d for `tools/area-sim`). This is the default single-player mode after
   onboarding (decision 5).

| Aspect | Design |
|---|---|
| **Who** | one painter per rival team. It flies its **livery** of the existing `BusModel` (a request to the bus owner) on looping routes over its home turf, 40-120 m up. |
| **Pace** | a blast every 8-12 s while within 2 km of you. Off screen, a rival advances CPU-only area records at one hit per 30 s, capped, so the city keeps painting while you're away. |
| **Targets** (weighted) | its own ready areas below stage 5 (60%), adjacent grey areas (30%), your frontier (10%, rising if you raid it) |
| **Rules** | it calls `Splatter.barf` with its faction, and `Areas.applyHit`: **exactly the server's rules**, so single player is a dry run of multiplayer |
| **Manners** | never during the opening or the first 3 minutes; never more than one rival in contact at a time; never knocks one of your centerpieces below stage 4 while you are more than 2 km away. Tunables: `rivals.rate`, `rivals.aggression`. |
| **Cost** | within 600 m, a rival is a full bus (at most one at a time, about +12 draws). Beyond that it is a faction comet in the sprite pool: a 3-4 px head with a trail, 0 draws. About 0.05 ms of CPU. |

### 4.5 Requests to owners outside magic

| Owner | Request |
|---|---|
| world (`PaintState.ts`) | **Change the faction encoding.** Today `a = faction + 2·keep`, `get()` reads `a % 2`, and the building shader tests `vPaint.a < 1.5`, so any faction id above 1 would read as "keep". Change it to `a = faction + 16·keep`, read with `% 16`. |
| feat/facade (`buildingMaterial.ts`) | `vPaint.a < 15.5`, and `SB_THEME_RAMP(faction, slot)` at the one ramp call site. Both go into WS-1's existing call-site patch. |
| game glue (`Splat.ts`, after supersplat) | `barf(x, z, {faction, levelFor})`: the faction (default: the player's) and a level hook returning `min(3, area stage after the hit)`. Rival-owned buildings are left out of painting, but still count as the primary of a strike. |
| ground (`GroundPaint.ts`; coordinate with feat/osm paint v2) | a `canPaint(x, z)` predicate in `put()`, and the `tArea` uniform in the terrain GLSL. The mask format is unchanged. |
| particles | an optional `palette` ramp list on `geyser`, `splash`, `puff`, `sparkles`, `burst` and `fling`, defaulting to `HUE_RAMPS` |
| render (`palette.ts`) | 4 ramp rows (§3.4) |
| polish/look | a faction ramp in the sky-warm LUT (`SKY_WARM`, `NIGHT_SKY` or pastel), and `signs.celebrate(name, faction)` |
| feat/supersplat | `Blast.super = {kind, charge, id}`, where `id` is the super serial (for the one-hit-per-super rule) |
| aim | the glint's colour by area readiness (§1.2) |
| bus | `BusModel.livery(theme)` for the rival buses |

### 4.6 QA additions (on top of MAGIC §10)

- **Stage strips:** each stage's arrival at impact + 0.05, 0.3, 1, 3 and 9 s, at the chase lens and at 250 and 500 m,
  at the Painted Ladies and in FiDi.
- **Contest strips:** every knock-down (5 → 4 down to 2 → 1), a flip, a parry and an encore.
- **Seam review:** 1/30 s frame sequences at 250 and 500 m over a four-faction border, checking for shimmer and gridding.
- **Perf:** new `tools/blast.mjs` scenarios: `perf stage5` (3, 15 and 64 centerpieces in view), `perf rivals` (4
  factions) and `perf sweep` (a firehose across 8 areas). Compare draws, triangles and `workMs` against main on a real
  A15.
- **Rules:** `tools/area-sim` plays 10k seeded hits (aim, swath, spill, rivals, cooldown races) and checks the
  invariants:
  - one owner per area;
  - at most one change per 5 s;
  - at most one hit per super;
  - every stage within 0-5;
  - saves round-trip.
- **Themes:** `tools/theme-check.mjs` (§3.6). The `grey` regression shot stays pixel-identical.

### 4.7 Risks

| Risk | Mitigation |
|---|---|
| **A forest of centerpieces** (adjacent stage-5 areas) | Scale varies 0.8-1.0 by hash, and only 3 draw at LOD0. `centerpieceSpacing`: a second same-faction centerpiece within 200 m grows as a 0.6× grove with no gold beacon of its own. Judge it in the stage-5 shot strip. |
| **The grid shows** | warped borders, whole buildings, seams only between factions; check with the 500 m frame sequences |
| **Cloud Nine reads as sunlit grey; Hyperglow reads as shadow from altitude** | the validator, mandatory pastel trim, and the altitude glow floor (#1) on Hyperglow's lines |
| **The feel change:** buildings no longer escalate on their own | decision 1. A stage-up is a bigger moment than a single escalation ever was. |
| **WS-3 is the critical path** | the WS-4 split |
| **Mush during the firehose** | the cap of 2 stage changes per second, compact centerpieces, one stage-5 arrival at a time |
| **Bolts and photosensitivity** | the caps in §3.5; `prefers-reduced-motion` turns bolts into a steady glow |
| **Rivals feel unfair** | onboarding gating, contact limits, protection for centerpieces while you are away, tunables |
| **Cooldown races in multiplayer** | the server's order wins and the client replays the true stage; one timestamp per area keeps it simple |
