# The extras and Stage 4 in the other factions (feat/extras fd6d413 to b05c8a2, feat/factions e6c90a1 to 9a183a1)

The second account, 2026-11-08, for the first account. A code review of two ranges you pushed: `feat/extras` fd6d413 to b05c8a2 (Sonic Boom behind `&boom`, the Waterfall behind `&falls`, and their wiring in `main.ts`, `Splat.ts`, `GroundPaint.ts`, `CraterPaint.ts` and `Turbo.ts`), and `feat/factions` e6c90a1 to 9a183a1 (Stage 4 of the floating houses in the other four factions). Read against BUILT.md's extras sections and HOOKS.md's "Sonic Boom and the Waterfall", and LIFT.md's "Stage 4 in the other factions". Each finding was opened at its file:line and tried against the code; two have a Node run behind them. Lines are at b05c8a2 for the extras and 9a183a1 for factions. Numbers start at B30, M70, m70 and n70.

**Verdict.** No blocker on either branch. `feat/extras` has two majors, both on paths its own checks don't reach:
- on the Moon a ring's kept paint is a full disc: the hole fills in when the place comes back (M70);
- a Bomb that pours draws its whole wide ground in the frame it lands, which undoes the deadline that spreads it out (M71).

The street's ring and the tower's pour hold as built. The flags gate every new line of GLSL, Recess's guard is in, the hoop's slide is fixed, and nothing new allocates in a frame but m71. Fix M70 and M71 before `main`, or put them to the producer. `feat/factions` has no major. It has one minor, for `&hood=` on hills (m73), and two nits. It's ready for the producer's eye.

## How it ran

- **Node only.** No browser, no GPU, no phone. `tsc`, `vite build` and `iosfloor` on each branch's head, and two small Node scripts that bundle the game's own modules with rolldown (under M70 and m73).
- **Worktrees** of each head, outside the repo, removed after. Nothing was committed, and neither branch was touched.

## What ran

| Run | What it printed |
|---|---|
| `npx tsc -p tsconfig.main.json --noEmit` on b05c8a2, and on 9a183a1 | exit 0, no output, each |
| `npx vite build` of each | exit 0, each (only the chunk-size and config-loader warnings) |
| `node tools/iosfloor.mjs` on each build | "iOS 15.0 parses every chunk", each |
| Node: `splatAt` (`groundMask.ts`) over a ring's hole, the ring built as `Splatter.barf` builds `&boom`'s (0.94 of the tap's circle from 150, 300 and 490 m, inner 0.75, 20 seeds each) | "hole texels (2 m) sampled 704340, splatAt paints 704340 (100.0 %), worst ring 100.0 %" (M70) |
| Node: SF's `hoods.bin` and terrain through `loadHoods` and `regionLoader`, every neighbourhood's ground under the Sky Sea's belly whale and under the Skyway | 4 neighbourhoods over for the whale and 7 for the Skyway; Alamo Square 39.0 m and 98.5 m clear (m73) |

## feat/extras

### Major

**M70. On the Moon a ring's kept paint is a full disc.**
- *What a player sees.* On `?moon&boom`, flick into Turbo 3 low over open ground and the band lands with its bare middle. Fly away and come back, reload, or take `?moonland`'s next map, and the middle has filled in with the pinwheel: a disc up to 426 m across. It stays that way in the store. The hole is 56 % of the circle.
- *Evidence.* On the Moon, ground paint is kept by place (`GroundPaint.useGeo`, `main.ts:202`). A landed blast goes to the pictures (`GroundPaint.ts:824-826`), which draw it texel by texel through `splatAt` (`GeoPaint.ts:498`). `splatAt` (`groundMask.ts:148-171`) knows only the outer edge. It has neither the hole's skip nor the inner soft edge that `rows()` was given (`GroundPaint.ts:1412`, `:1422`). A tile takes its paint back from the pictures when its place comes back (`GeoPaint.ts`'s header). `boomOn` doesn't leave out the Moon (`Boom.ts:82`), and BUILT.md's extras have the ring paint the Moon's ground.
- *The Node run.* `splatAt` paints all 704,340 of the 2 m texels sampled more than 3.5 m inside the hole, over 60 rings.
- *Fix.* In `splatAt`, the same two lines `rows()` has for `LAYOUT_RING`: nothing under `ring - 3.5`, and the inner edge's coverage. Then a Moon row in `s_boom` that reads the pictures back.

**M71. A Bomb that pours draws its whole wide ground in the frame it lands.**
- *What a player sees.* With `&bomb&falls`, a Bomb III on a downtown tower hitches on the frame it lands, which is the moment that has to be smooth.
- *Evidence.* A Bomb pours (`Falls.pours` lets `'bomb'` through, `Falls.ts:112`). Its pool begins its ground job straight away, inside the impact (`Falls.ts:141`, called from main.ts's impact hook at `:706`). The Splatter calls that hook in the same frame as the Bomb's ground lands (`Splat.ts:620`, then `:623`). And `GroundPaint.begin` first finishes every wide job still drawing, all of it (`GroundPaint.ts:692-701`, `stepWide(o, Infinity)` at `:696`).
- A Bomb III is wide from any drop over about 14 m: 1.8 times the tap's circle (`config.ts:881`), and wide over 160 m (`:904`). From Cruise, 60 m over a roof, it's 184 m. So every Bomb III that pours loses the deadline that spreads its ground over 0.84-1.64 s.
- BUILT.md measured that ground drawn whole: "a Bomb III from 300 m was a 24-37 ms frame in Node" (`BUILT.md:170`). It kept the finish-first rule because "only another's blast comes that soon". The pool isn't another's blast: it's the Bomb's own, in the same frame. BUILT.md's own "Not checked" (`:539`) lists the Bomb pouring on the page.
- This is from the code. The frame's cost wasn't measured here.
- *Fix.* Either let the pool's `begin` leave other jobs alone (a flag), or begin the pool's ground a few frames before its runs reach the street (`down`), after a Bomb's deadline. The second also answers m70.

### Minor

**m70. The pool loses its slow reveal when four more blasts begin before it's done.**
- *What a player sees.* Past the tap's own paint, the pool should spread out from the walls at 6 m/s once the runs reach the street. Keep tapping, or hold the Hose, and it shows all at once instead, or shows before the runs land.
- *Evidence.* A live blast's texels wait on one of four slots, each a serial and a time (`GroundPaint.ts:708-711`). A texel whose serial isn't in a slot gets the time -1000, so it shows (`sbgCov`, `:122-131`). The slots go round on every `begin`. The pool begins at the tap's impact with its time at `down`, 0.45-2.3 s later (`Falls.ts:141`), and its reveal runs up to about 2 s after that. So the fourth `begin` after it, 2-4 s on, takes its slot. A tap begins one, a Comet one, and each of the Hose's dozen impacts a second one.
- From then on, its texels drawn in flight show at the next upload of that part of the tile (another blast's), and at its landing they all show at once. On the tap's own paint the pool changes hue at once anyway (`BUILT.md:500`). So this is about the part past it, the part `s_falls` tests ("pools on fresh ground").
- *Fix.* Begin the pool's job a few frames before `down`, as for M71, so it holds a slot only for its own reveal.

**m71. `Falls.update` sets every free slot again every frame, on every page.**
- *What a player sees.* Nothing. It's four objects a frame for the collector, with no link on.
- *Evidence.* `main.ts:1936` calls `falls.update` on every page. A free slot's `dryAt` is `-Infinity`, so `now >= this.dryAt[i]` is always true (`Falls.ts:150-154`). So `setFall` runs for every free slot every frame, and each call builds a new object for `Object.assign` (`falls.ts:30`).
- *Fix.* Skip a slot that's already free, and set `fallsLast`'s three fields directly.

**m72. The ring raises the trees in its hole.**
- *What a player sees.* Trees in the ring's bare middle that stood on older paint go up a level as the ring lands.
- *Evidence.* `boomImpact` calls `paintTrees(b)` (`main.ts:794`). That goes over the whole circle and raises every tree standing on painted ground (`main.ts:612-635`). The ring paints nothing in its hole, but older paint there counts. Buildings in the hole are left out (`Splat.ts:398-399`), and HOOKS.md asks life to leave the movers there alone.
- *Fix.* Give `paintTrees` an inner radius and pass `b.super.inner`.

### Nit

- **n70. The ring's blobs leave from the centre's height.**
  - *What a player sees.* On a slope, some of the ring's blobs start underground or in the air. Downtown, they come out of the band's towers.
  - *Evidence.* `boomImpact` starts every blob at the band's inner edge but at `b.pos.y`, the ground at the ring's centre (`main.ts:790`).
  - *Fix.* Take the start's height from `landingY` at the start point.

### What holds

- **The flags.** `boomed()` and `fallsed()` gate every new line of GLSL. Without `&boom` the vapour ring and the hoop keep Rainbow's rows.
- **The ring on the street.** It leaves out the buildings wholly in its hole, caps by its band's area and draws its ground as a band. The hoop's `secs` and its linger leave the uniforms where Mach 1's hoop wants them, and its slide is fixed.
- **Off under `?recess`.** The guard is in (`main.ts:1363`).
- **The pour's clock.** It reads the struck tower's record after the Splatter has written it (`Splat.ts:607` before `:623`). The runs' shader runs on the same clock as `simTime` (`uTime`). A slot is given back once its slowest column is dry.
- **No new per-frame allocation** in `Boom.update`, `TurboFx.landHoop` or the drops, other than m71.

## feat/factions

No blocker or major.

### Minor

**m73. The Sky Sea's belly whale and the Skyway aren't held over the floating houses.**
- *What a player sees.* On a hilly neighbourhood picked with `&hood=`, the whale plunging out of the Sea's belly can pass through floating houses, and the Skyway runs among their roofs instead of over them.
- *Evidence.* Every piece sits at the heart's ground + 220 m (`liftSky.ts:38`, `:293`, `:747`). The belly whale's arc dips to 79 m under that: it starts 21 m under and drops 58 more (`:421`, `:423`). It swims 0.62 of the Sea's radius out from the heart (`:418`). The Skyway is flat at the same height, with sides 3 m deep. The falls, columns and islands are held over the layer on their own ground (`LAYER`, `:44`; `isles()`). But `clear` checks only those and the turns (LIFT.md `:218`), not the whale, the Sea or the Skyway.
- *The Node run.* It used SF's data and the boot sun the piece faces, and asked where the highest a floating roof may rest (105 m over its ground, plus 3 m of heave) would stand above these pieces:
  - above the whale's underside in 4 neighbourhoods: Bunker Rd by 30.8 m, Diamond Heights 30.0, Saint Francis Wood 3.8, Black Sands Beach 3.7;
  - above the Skyway's sides under its squares in 7: Sausalito 133.3, Sunnyside 75.7, Forest Knolls 57.3, Saint Francis Wood 49.5, Diamond Heights 24.3, Crocker-Amazon 10.3, Bunker Rd 9.3;
  - Alamo Square has 39.0 m to spare under the whale and 98.5 m under the Skyway.
- That's the cap on a roof, not each house's own height.
- *Fix.* Set each piece over the highest ground under it plus the layer, as the islands are, or raise it there. Then add the whale's arc and the Skyway's lanes to `clear`, and run it on one hilly neighbourhood.

### Nit

- **n71. Before the wave, the pieces hide on a `smoothstep` whose two edges are equal.**
  - *What a player sees.* On a GPU that returns NaN there, the falls and the columns would stand before the wave. The desktop stills show none.
  - *Evidence.* `uSkyT0` starts at 1e9 (`liftSky.ts:1108`). In 32-bit floats 1e9 + 4.6 is still 1e9, so `sbForm` (`:264`) asks for `smoothstep(1e9, 1e9, t)`, and GLSL leaves that undefined. With a NaN there, the comparisons that hide the falls (`:403`) and the columns (`:979`) come out false. The mesh is in the scene from its last part until the wave starts (`Lift.ts:585`), and while the loading fog is up that can be seconds.
  - *Fix.* A start value that keeps the edges apart, like 1e6, or hide on `uTime < uSkyT0` first.
- **n72. `&lifted=<faction>`'s paint is kept in the saved city.**
  - *What a player sees.* Taps on a `?lift&lifted=inferno` page are Inferno's in every store, through a reload. The normal page then shows them, outside the neighbourhood too.
  - *Evidence.* `main.ts:686` makes the link's faction `paintAs`, which works the same way as `&paintas`. LIFT.md's "The bus paints as the link's faction" doesn't say the paint is kept.
  - *Fix.* Say so in LIFT.md, or keep it to the session.

### What holds

- **Nothing touches a house.** A fall or a column stands clear of every liftable house, rises straight through the layer and bends only over it. The islands float over their own ground's highest plus the layer.
- **The turns reach everything that moves with a house.** Every user of `sbLiftMove` turns: the houses, the undersides, the shadows' depth and the sprouts. A turn is skipped where its sweep would meet a neighbour at its height, floating or grounded.
- **The drips.** The other four factions' drips stop at 35 % of the gap. Rainbow's are as they were.
- **The build.** The piece is built a part a frame, and the wave waits for it. The program is warmed at boot for the link's faction.
- **The link only.** `lifted()` keeps the lakes, the undersides' looks and the turns off every page without `?lift`.

## Not checked

- **Nothing seen.** No browser, GPU, phone, A15, or Safari's own engine.
  - No frame was rendered. The ring and the pour weren't flown, on the street or on the Moon.
  - The sounds weren't heard.
  - No still of a sky piece was looked at.
- **None of the branches' own checks were rerun:** `s_boom`, `s_falls`, `controls.mjs`, `warmcheck`, `lift-check`, `clear`, `lift-stills`.
- **M71's cost** isn't measured. The 24-37 ms is BUILT.md's number for a Bomb III's ground drawn whole from 300 m, not this path.
- **m70** is from the code.
- **m73's numbers** compare the cap on a roof with each piece's height. They don't use the houses' own placed heights or footprints.
- **The wave's first frame on Hyperglow.** `Lift.turns` calls the City's `buildingsWithin` for every wave house that passes its neighbour check, in that frame. That cost wasn't measured. An earlier review measured 56-73 ms for 400 such searches.
- **A ring on ground not loaded yet.** After a turn at Turbo 2, a ring can land 2.2 km ahead, past what's loaded. Its buildings would stay grey and its 10 s would be spent. Not tried.
- **The merges.** Recess's white gate will need `Controls.onRung` too, and it's a single slot. Not tried.
