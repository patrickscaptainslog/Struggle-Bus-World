# CURB: the bus on the street

The first account's Curb flight, camera and landing, on `feat/curb` (feat/gears 3a2b21f with feat/life b65af07 merged at 13f762f). `SHOTS.md` is the plan the producer approved on 2026-11-06 ("Curb: cruising beside the cars", decisions 13 and 14); the lane and the pace are the second account's road side (`docs/specs/earth/LIFE.md`, "Curb's road side"), which this calls. Curb exists only where life's cars do, behind `?life`: with no `?life` nothing here is made, and every frame and every sim row is feat/gears's.

## What's built

### Getting on

**The dive.** Fly low over a road at School Zone, Cruise or Express (no turbo) and push the stick up for half a second: the wheels touch down. Low means within 30 m of the road, with the road going on 15 m ahead, so a street crossed square doesn't count. While the push is held the floor comes down to the street (`Flight.street`, 5 m over it), so the half second is a dive toward the asphalt, not a hold at the roofs. At Cruise and Express that push is the surge, so a surge down a street lands; `config.curb.diveOnly` limits it to a dive from a held height and School Zone's sink, if the phone says it's too eager. Nonstop, Jet and turbo never land.

**The flick.** In School Zone a flick down asks at once, from anywhere within 150 m of the ground; life's worker finds the kerb lane within 80 m. From higher it does nothing, as before.

**No street.** If life finds no lane, or doesn't answer in 1.2 s, the bus hops (5 m/s up, a squash and a boing) and says FIND A STREET for 1.8 s. Nothing lands for 2 s after.

**The hint.** The first time the bus is low over a road for 0.3 s: LAND ON THE STREET, DIVE AND HOLD, for 3.2 s, once ever (`prefs.taught` bit 64). It isn't a first-run cue, so `?skipintro` shows it; `?nohud` and `?nocoach` don't. A flick landing counts as learning it.

### The arc

Once there's a lane the rung is CURB (`TurboDrive.curbIn`; Express is let go as a surge is) and the bus arcs onto it in 0.45 to 1.8 s, longer the further it has to come. Its offset from the lane eases to nothing from its own place and speed, so neither jumps, and the heading turns the short way. Life's `curb.land` takes no speed yet (H1, below), so its lane rolls at the road's pace from where it was asked. The arc first catches the lane up by as far as the bus runs on while it slows to that pace, so the bus slows down along the lane and never slides back up it: from Express, 45 m. The touchdown chirps (louder off a faster arc), squashes the bus, puffs dust at each wheel and jolts the lens.

### Rolling

`Flight.ride` has the bus instead of `step()`. Its middle is 2.55 m over the lane, which puts the tyres on the asphalt; StreetCam's 4 m floated them 1.5 m. The heading follows the lane's 4 m steps on a spring, and the bus leans into turns, rides the road's grade and rears onto its back wheels on a breath. Flight is left as if it skimmed there, so `step()` takes it back with nothing jumping.

- **No steering.** Sideways does nothing, and there's no lane change.
- **Push up** rolls on past the car beside you to the next one, with two toots as you pass (at most every 2 s). Let go and it paces the car beside you, as life does.
- **A look** held past 20 degrees for 0.25 s takes the next junction its way, with the indicator ticking once per look. A glance does nothing.
- **The readout** says CURB with the roll's mph. The turbo voice shifts down onto the street and up off it.
- **MEGA** is off on the street.
- **The exhaust** is a rising wisp at half size, left where it was breathed out. From the kerb chase, the flying puff was GEARS.md's grey disc.

### Getting off

- **A flick up** is School Zone again: the bus hovers at the street's floor, 7.5 m over the road.
- **A pull held** 0.25 s is School Zone, climbing out at its 15 m/s. A flick's stroke is shorter and doesn't count.
- **A gear forced on it** ('thrown') takes it off. Recess's hit will do this.
- **The lane's end** takes it off too.

Leaving lifts the bus 3 m/s, and nothing lands for 1 s after.

### The camera

The kerb chase, GEARS.md's chase lens: 34 m back, 7.5 m over the road, looking 90 m ahead at 3.5 m, 34 degrees wide. Coming down it's a dolly from wherever the chase was (159 m at Cruise, 108 m in School Zone), eased at 1.2/s, with no cut. It follows the rig's own lagging yaw, so a turn still sweeps, and it never goes under the road or a deck + 2.5 m. Going up it's a crane back to School Zone's lens. `&curblens=wide` is the ride-along: 16 m back, 3.2 m up, 58 degrees. A drag off the bus still looks round it. Pinch to zoom (VOYAGE V3) will start from the kerb chase.

**Why the kerb chase.** The telephoto keeps the pixels steady, and it shows what Curb is played with: the car ahead to push to, the junction to look at, both rows of fronts, and the trail. Under the ride-along's 58 degrees the near asphalt streams, and the bus hides the road ahead.

### The paint

- **The trail.** The lane behind the rear bumper paints itself: a 2.2 m dab every 3 m rolled, settled at once and on no live slot (`GroundPaint.dab`), so a breath on its way shows nothing early. It's laid in rainbow rings 14 m wide round where the wheels came down, in the splatter's faction, and kept like any blast.
- **Riding beside a car** for 1.5 s paints it (life's `curb.onBeside`, then `life.hit` with the splatter's hue and faction): a splash at the bus's side, and the bloom's sound.
- **A tap is a drive-by.** It paints the car beside you, and the house fronts on the side you're looking at (past 25 degrees), else the kerb's side. The front 12 m out glints (or 30 m out on a wide street). The breath is 24 m across and blooms only on that side of the lane (`BarfOpts.side`), and the hue moves on after each fresh hit (`Splatter.dealHue`).
- **Bridge decks** count as street for the landing and the roll (`City.roadwayAt`), but the trail isn't laid on a deck. The ground's paint there is the water's under it, and the deck's own trail (a Bridges.ts uniform) isn't built.

## How to try it

On the preview link for `feat/curb`, once it's pushed, with `?life` on the link:

> https://struggle-bus-world-git-feat-curb-patricks-projects-9ff6e721.vercel.app/?life&lat=37.736181&lon=-122.426973&heading=227&skipintro

That's GEARS.md's arterial.

1. Flick down for School Zone, then flick down again: the wheels go onto the street.
2. Ride beside a car until it takes your colour.
3. Push up to roll on to the next car.
4. Drag high over the bus to the left and hold, before a junction.
5. Tap for a drive-by.
6. Flick up to get off, then push down from School Zone and hold to land again.
7. Pull back and hold to climb off.

At Cruise, flying along a street, push up and hold. `&curblens=wide` is the other lens, and `&t=2026-11-07T00:20:00Z&rate=0` is golden hour.

## The checks

- `npx tsc -p tsconfig.main.json --noEmit`: clean at each commit.
- **No life, unchanged.** `tools/controls-sim/s_gesture.ts` printed 772 checks passing over 322 rows, and `s_turbo.ts` 37. Both were byte-identical, every line, to the same scenarios run on feat/gears 3a2b21f in a throwaway worktree. Their json outputs matched too.
- **Life's own check.** `node --no-warnings tools/life/curb.mjs` still passes all 8 rows: 761 landings from 800 tries, and the paced car painted.
- **`tools/controls-sim/s_curb.ts`: all 25 checks pass.** It runs the real city, Flight, TurboDrive, Shifter, CameraRig and CurbFlight. Life's own Curb runs on the cars' net round each place, with a stand-in worker that answers a frame late.
  - **The dive at Cruise** along the arterial asked at 0.52 s.
  - **The arcs** from Cruise (0.65 s, lane caught up 22 m), Express (0.93 s, 45 m), School Zone's sink (0.59 s) and School Zone's flick at 60 m (1.73 s) all landed. None stepped further in a frame than the frame before plus 0.5 m, none went back along the lane, and all ended 0.00 m off it.
  - **20 s rolled:** 0.00 m off the lane, paced at 10 m/s beside a car driving the lane, and painted once 1.50 s after it was beside (1.78 s, then 3.28 s). 76 dabs over 230 m. Middle 2.56 m over the ground.
  - **The push** went 21.3 m past the car, with one pair of toots.
  - **Getting off.** A flick's stroke (a 0.1 s pull) stayed on. A pull held got off at 0.27 s and climbed at 15.0 m/s. A flick up hovered 0.7 m over the street's floor at 0 m/s.
  - **Nothing landed** from 160 m, from Nonstop, Jet or turbo, from a push let go at 0.4 s, from a flight across the residential blocks, or from a surge under `diveOnly`. School Zone's sink still landed under it.
  - **FIND A STREET** over the bay: the hop's +5.0 m/s, the toast, still bouncing at 1.5 s and flying at 2.1 s.
  - **The look:** a look held left turned once, and a glance didn't.
  - **A forced gear** threw it off.
  - **The lens** went from 159.4 to 34.4 m, at most 2.93 m in a frame (at 1.4/s it was 3.3), and back up to 108.6 m.
- `npx vite build --outDir C:/Users/Utku/sb-build-curb --emptyOutDir` and `node tools/iosfloor.mjs` on the final build (84f76f8): iOS 15.0 parses every chunk.
- **`tools/controls.mjs … zone curb`** on the laptop's GPU, the built page, real CDP touches, the real clock's dusk. **zone: 11 of 11, 0 programs.** curb: 14 of 15:
  - **Landing.** Two real flicks down landed on the arterial: arc, then on, CURB. The bus's middle was 2.64 m over the road.
  - **A minute rolled:** on at every 5 s reading, at 9.4 to 18.8 m/s. Three cars ridden beside were painted. 302 dabs. The lens 158.6 to 34.4 m at 34 degrees.
  - **The push** rolled on, 17.0 to 31.7 m/s.
  - **A look held left:** the indicator once, and the drive-by's side left.
  - **A real flick up** was School Zone at 0.03 m/s. School Zone's drift down landed again, and a pull held got off, 45.9 m over the road after.
  - **Over the bay:** the hop and FIND A STREET, then flying.
  - **Nothing compiled:** 0 programs made after ready.
  - **The one fail is the drive-by's front: there is none.** The tap hit the car beside (life counted the hit) and took no front. The left side there has nothing to take: probed in Node at the second try's point, the ground is a yard, and the nearest building over 2.5 m stands 67 m off. So no drive-by front was seen bloom on the GPU, and its one-sided breath has no sim row.
- **`tools/warmcheck.mjs --curb`** on the final build, a cold load of the arterial with `?life`, real touches through each of Curb's phases: **0 programs after the warm-up**. 39 programs were warmed and none was made after. The one first draw after the warm-up is the upscale onto the canvas at load, frame 1, which isn't Curb's. Two frames went over 100 ms: 117 ms as it flicked into School Zone, and **383 ms in the landing's phase**. That one isn't explained; see "What's left".
- **The budget on the street** (that run, every reading on Curb): 57 to 81 draws and at most 0.61 M triangles. Frames on the wall clock while on the street were 16.7 ms median and 33.4 ms at the 95th percentile, over 1,752 frames; the longest was 333 ms, with screenshots taken in the same run. That's on the laptop's GPU, not an A15.

## What the stills show

`tools/streetcam/curb-shots.mjs`, on the final build on the laptop's GPU. It took 16 stills at 1179 x 2556: GEARS.md's four streets at noon and at golden hour, through both lenses. Each was landed with two real flicks and rolled 6 s. Every one is on the street (CURB) with the bus's middle 2.55 to 2.76 m over the road, at 81 to 121 draws and 0.40 to 0.92 M triangles. The contact sheet is `sb-checks/shots/curb/stills/sheet.png`.

- **The trail reads.** Behind the bus is a ragged rainbow lane, a ring's colour every 14 m from the landing: red, orange, yellow, then green and blue, and purple on the longer rolls. From the kerb chase it fills the foreground and leads the eye up the road to the bus. It's the only colour on the street, as it should be.
- **The kerb chase works on all four.** The bus is small in the middle third. The road runs ahead to the next junction, and the fronts line both sides on the residential street and the hill. On the hill the lens stays above the slope behind the bus. The waterfront shows the bay beside the road.
- **The ride-along** (`&curblens=wide`) fills the lower half with the bus's back and the trail under it. It's punchier and close, but it hides the road ahead, as GEARS.md's stills found.
- **The streets are still bare.** They're grey asphalt from kerb to kerb with no lines, and the pavements are the same grey. That's decision 14, for the producer.
- **No cars in these stills.** Life's cars were sparse at those four places at those hours, and none was beside the bus when the frames were taken. The minute-long run on the arterial had cars beside it and painted three.
- **The exhaust** is a small grey wisp at the lower left of the bus, half the old puff.
- **The readout** isn't in these stills. It shows only for a few seconds after a shift, and these were taken 6 s on. It's in the GPU run's arc still (CURB, 22 MPH).

## Where it departs from the plan

- **The band.** The plan's test was the look-ahead's floor within 1.5 m of the road, under 15 m. On San Francisco's streets the floor is held up by street trees and roofs. The obstacle grid's cells are 8 m, and the look-ahead samples 6 m to each side. At Cruise along GEARS.md's arterial the band held 44 % of the time, along the residential street and the hill never, and the bus skims 16 to 23 m over them. So the band is now the road under the bus and 15 m ahead (paved or a pavement, no roof), within 30 m. The push held there brings the floor down to the street, so landing is a dive, as SHOTS.md says ("Dive to street height").
- **The ride height** is 2.55 m, not StreetCam's 4 m, so the tyres are on the road.
- **The lens comes in at 1.2/s, not 1.4.** At 1.4 the dolly from Cruise's 159 m moved 3.3 m in its fastest frame, over the plan's 3 m.
- **The landing speed.** The plan asked life for H1. The arc catches life's lane up on the host instead, so Cruise and Express land with nothing sliding back today. H1 would make that catch-up a single call.
- **Bridge decks' trail** is cut, as the plan allowed. The producer is told here and in the report.

## What's left

- **The Hose from the window.** The Hose is on `feat/shots`, not this branch. On Curb it will pour from the window on the side the look is: the bus's flank at its middle, a metre over the road's side of it, with `CurbFlight.side` choosing which. The place is named in CurbFlight.ts's header.
- **PvP on the street** (Recess's). It will read `curbFlight.rolling` and `onLeave(why)`: 'flick' is the hop that beats the white, and 'thrown' is a gear forced by a hit. The captains will need to come down to streets. Curb lands in no match until then (`?recess` is off for it).
- **Street surfaces** stay on hold (decision 14). Curb adds no street art: from the kerb chase the streets are GEARS.md's bare grey, and the trail is the only paint on them.
- **The deck trail** (above).
- **Asked of the second account** (`src/life`, small hooks):
  - **H1:** `curb.land(x, z, heading, speed)`, rolling from the bus's speed and easing to the pace.
  - **H2:** `curb.turn(look)`. Today the look counts only when the next 600 m stretch is asked, about 380 m after landing, so most junctions miss it. The indicator ticks either way.
  - **H3:** the bus one lane right of the kerb lane on roads with one lane each way. Cars' defaults give secondary, tertiary and residential ways one lane each way, so the paced car shares the bus's lane.
  - **H4:** `curb.besideAt`, the car's place, for the splash.
  - Does the trail count toward a square's streets stage (`src/factions`)?
- **The landing's long frame.** warmcheck caught a 383 ms frame in the landing's phase, on the laptop. It's suspected and not proven. The candidates are the city's detail scale changing as the lens widens from 24 to 34 degrees, the first trail dab on a tile giving it ground of its own (a region's ground made again), and streaming as the view drops to the street. It has to be found before Curb goes live: on an A15 it would be a stutter at every landing.
- **Not checked.** With no `?life`, the eight `--det` views weren't compared against feat/gears's build; the sims' byte-identity and `zone` 11 of 11 on this build stand for it. A drive-by front blooming on one side was never seen on the GPU (there was none on that stretch), and the one-sided breath has no sim row. The deck landing was never flown. Nothing was run on an A15.
- **The phone.** Whether the dive is too eager at Cruise (`diveOnly`), and whether a minute on the street is fun, are the producer's to say.
