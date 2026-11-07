# CURB: the bus on the street

The first account's Curb flight, camera and landing, on `feat/curb` (feat/gears 3a2b21f with feat/life b65af07 merged at 13f762f). `SHOTS.md` is the plan the producer approved on 2026-11-06 ("Curb: cruising beside the cars", decisions 13 and 14); the lane and the pace are the second account's road side (`docs/specs/earth/LIFE.md`, "Curb's road side"), which this calls. Curb exists only where life's cars do, behind `?life`: with no `?life` nothing here is made, and every frame and every sim row is feat/gears's.

It was reviewed three ways (a code review, a GPU check and an outside look) and fixed at 0d72f38 to f944300. "What's built" below is the fixed build; "After the review" at the end says what each finding came to.

## What's built

### Getting on

**The dive.** Fly low over a road at School Zone, Cruise or Express (no turbo) and push the stick up for half a second: the wheels touch down. Low means within 30 m of the road, with the road going on 15 m ahead, so a street crossed square doesn't count. While the push is held the floor comes down to the street (`Flight.street`, 5 m over it), so the half second is a dive toward the asphalt, not a hold at the roofs. At Cruise and Express that push is the surge, so a surge down a street lands; `config.curb.diveOnly` limits it to a dive from a held height and School Zone's sink, if the phone says it's too eager. Nonstop, Jet and turbo never land.

**The flick.** In School Zone a flick down asks at once, from anywhere within 60 m of the ground or of a deck under the bus; life's worker finds the kerb lane within 80 m. From higher it does nothing, as before.

**No street.** If life finds no lane, or doesn't answer in 1.2 s, the bus hops (5 m/s up, a squash and a boing) and says FIND A STREET for 1.8 s. Nothing lands for 2 s after. A lane on the far side of a deck from the bus (the Bay Bridge's upper deck seen from the water), or under a deck too low for the bus, is no street either: the Bay Bridge's lower deck, eastbound, runs 5.5 m under the upper one, and the bus doesn't fit.

**The hint.** The first time the bus is low over a road for 0.3 s: LAND ON THE STREET, DIVE AND HOLD, for 3.2 s, once ever (`prefs.taught` bit 128). It isn't a first-run cue, so `?skipintro` shows it; `?nohud` and `?nocoach` don't. A flick that lands counts as learning it; one that finds no street doesn't.

### The arc

Once there's a lane the rung is CURB (`TurboDrive.curbIn`; Express is let go as a surge is) and the bus arcs onto it in 0.45 to 1.8 s, longer the further it has to come, and never so short that its own ease comes faster than 60 m/s: from higher up it takes longer, it doesn't come down faster. Its offset from the lane eases to nothing from its own place and speed, so neither jumps, and the heading turns the short way. The readout eases from the bus's speed to the lane's over the arc. Life's `curb.land` takes no speed yet (H1, below), so its lane rolls at the road's pace from where it was asked. The arc first catches the lane up by as far as the bus runs on while it slows to that pace, in at most six of life's rolls, so the bus slows down along the lane and never slides back up it: from Express, 50 m. The touchdown chirps (louder off a faster arc), squashes the bus, puffs dust at each wheel and jolts the lens.

While life is answering, the dive's floor holds only while the road is still under the bus and going on, so past a street's end the bus rises over the block instead of flying on at street height into it.

### Rolling

`Flight.ride` has the bus instead of `step()`. Its middle is 2.55 m over the lane, which puts the tyres on the asphalt; StreetCam's 4 m floated them 1.5 m. The heading follows the lane's 4 m steps on a spring, and the bus leans into turns, rides the road's grade and rears onto its back wheels on a breath. Flight is left as if it skimmed there, so `step()` takes it back with nothing jumping.

- **No steering.** Sideways does nothing, and there's no lane change.
- **Push up** rolls on past the car beside you to the next one, with two toots as you pass (at most every 2 s). Let go and it paces the car beside you, as life does.
- **A look** held past 20 degrees for 0.25 s asks life for the next junction its way, with the indicator ticking once per look; a glance does nothing. It asks square, since life takes another way only past 60 degrees from straight on, and keeps asking a second after the thumb lets go. Life reads the look only when it asks for its next 600 m stretch, so the turn it takes is that stretch's first junction, 220 to 600 m on, not the one ahead (H2, below).
- **The view** turns at most 30 degrees either way on the street, enough for the drive-by's side (25) and the turn (20).
- **The readout** says CURB with the roll's mph, and 0 when the lane stands still. The turbo voice shifts down onto the street and up off it.
- **MEGA** is off on the street.
- **The exhaust** is a rising wisp at half size, left where it was breathed out. From the kerb chase, the flying puff was GEARS.md's grey disc.

### Getting off

- **A flick up** is School Zone again: the bus hovers at the street's floor, 7.5 m over the road.
- **A pull held** 0.25 s is School Zone, climbing out at its 15 m/s. A flick's stroke is shorter and doesn't count.
- **A gear forced on it** ('thrown') takes it off. Recess's hit will do this.
- **The lane's end** takes it off too: life's lane stood still for a second ('end'). At a dead end life holds the bus at the lane's last point, still saying a speed (H5), or slows it to the kerb; either way it's a second standing, then School Zone.
- **A deck too low ahead** (the lane running onto the Bay Bridge's lower deck) takes it off 20 m before it ('end').

Leaving lifts the bus 3 m/s, and nothing lands for 1 s after.

### The camera

The kerb chase: 34 m back, 11 m over the road, looking 40 m past the bus at 3.5 m, 38 degrees wide, and 1.25 m toward the traffic's side, so the bus doesn't stand on the road ahead. (It was GEARS.md's chase lens, 7.5 m up, looking 90 m on, 34 degrees: the outside look found its horizon mid-screen, half the phone sky, and the road ahead a sliver over the roof.) Coming down it's a dolly from wherever the chase was (159 m at Cruise, 108 m in School Zone), eased at 1.2/s, with no cut. It follows the rig's own lagging yaw, so a turn still sweeps. It never stands under the ground or the deck the bus is on + 2.5 m, never on a deck over the bus, and never within 1 m of a deck's underside over it. Anything solid between the bus and the lens, a front a look swings it into or the hill, brings it in short of that at once, along its line to the bus so the bus stays where it stands in the frame, and lets it out again eased (2/s). Going up it's a crane back to School Zone's lens. `&curblens=wide` is the ride-along: 16 m back, 3.2 m up, 58 degrees. A drag off the bus still looks round it, at most 30 degrees either way on the street. Pinch to zoom (VOYAGE V3) will start from the kerb chase.

**Why the kerb chase.** The telephoto keeps the pixels steady, and it shows what Curb is played with: the car ahead to push to, the junction to look at, both rows of fronts, and the trail. Under the ride-along's 58 degrees the near asphalt streams, and the bus hides the road ahead.

### The paint

- **The trail.** The lane paints itself under the rear axle, so the paint comes out from under the bus: a 2.2 m dab every 3 m rolled, settled at once and on no live slot (`GroundPaint.dab`), so a breath on its way shows nothing early. It's laid in rainbow rings 14 m wide round where the wheels came down, in the splatter's faction, and kept like any blast.
- **Riding beside a car** for 1.5 s paints it (life's `curb.onBeside`, then `life.hit` with the splatter's hue and faction): a splash a lane over on the traffic's side, and the bloom's sound.
- **A tap is a drive-by.** It paints the car beside you, and the house fronts on the side you're looking at (past 25 degrees, and for a second after the look lets go, since one thumb can't hold a look and tap), else the kerb's side. The front 12 m out and 16 m on glints (or 30 m out on a wide street), so it blooms in the kerb chase's view, not past its edge. The breath has a 24 m radius and blooms only on that side of the lane (`BarfOpts.side`), its flung blobs too, and the hue moves on after each fresh hit (`Splatter.dealHue`). A street sign it raises may be as small as 0.4 of its size from the air: from the kerb chase the air's blade was a billboard.
- **Bridge decks** count as street for the landing and the roll (`City.roadwayAt`), but the trail isn't laid on a deck. The ground's paint there is the water's under it, and the deck's own trail (a Bridges.ts uniform) isn't built.

## How to try it

On the preview link for `feat/curb`, once it's pushed, with `?life` on the link:

> https://struggle-bus-world-git-feat-curb-patricks-projects-9ff6e721.vercel.app/?life&lat=37.736181&lon=-122.426973&heading=227&skipintro

That's GEARS.md's arterial.

1. Flick down for School Zone, then flick down again: the wheels go onto the street.
2. Ride beside a car until it takes your colour.
3. Push up to roll on to the next car.
4. Drag high over the bus to the left and hold: the indicator ticks. The turn comes where life next asks for its lane (H2).
5. Tap for a drive-by, right after a look for that side.
6. Flick up to get off, then push down from School Zone and hold to land again.
7. Pull back and hold to climb off.
8. Roll on to the lane's end, a few hundred metres on: a second standing, then School Zone.

At Cruise, flying along a street, push up and hold. `&curblens=wide` is the other lens, and `&t=2026-11-07T00:20:00Z&rate=0` is golden hour.

## The checks

These were run on 84f76f8, before the review. The checks on the fixed build are under "After the review".

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

`tools/streetcam/curb-shots.mjs`, on 84f76f8 on the laptop's GPU, through the kerb chase as it was then. It took 16 stills at 1179 x 2556: GEARS.md's four streets at noon and at golden hour, through both lenses. Each was landed with two real flicks and rolled 6 s. Every one is on the street (CURB) with the bus's middle 2.55 to 2.76 m over the road, at 81 to 121 draws and 0.40 to 0.92 M triangles. The contact sheet is `sb-checks/shots/curb/stills/sheet.png`.

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
- **The Bay Bridge's lower deck** is no street. The cars' graph has the eastbound lanes 5.5 m under the westbound deck, which doesn't leave room for the bus: it rode with its roof in the upper deck, the lens between the decks, and the bus out of sight. Over the bridge heading east, a flick down says FIND A STREET; heading west it lands on the upper deck.
- **The look on the street** turns the view at most 30 degrees (the outside look asked near 40): the drive-by's side takes 25 and the turn 20, and the further the view swings on a narrow street, the nearer the lens has to come in.

## What's left

- **The Hose from the window.** The Hose is on `feat/shots`, not this branch. On Curb it will pour from the window on the side the look is: the bus's flank at its middle, a metre over the road's side of it, with `CurbFlight.side` choosing which. The place is named in CurbFlight.ts's header.
- **Merging feat/shots.** A dry run conflicts in Controls, Flight, Splat, main.ts, Coach and warmcheck (the code review). feat/shots's `pouring` and `rechargeSeconds` changes to the belly's clock must move into `Flight.breathClock()`, which `ride()` shares, or the belly refills on the street while the Hose pours from the window. Coach's bits are apart now (aim 64, curb 128).
- **PvP on the street** (Recess's). It will read `curbFlight.rolling` and `onLeave(why)`: 'flick' is the hop that beats the white, and 'thrown' is a gear forced by a hit. The captains will need to come down to streets. Curb lands in no match until then (`?recess` is off for it).
- **Street surfaces** stay on hold (decision 14). Curb adds no street art: from the kerb chase the streets are bare grey, and the trail is the only paint on them. Lane dashes and kerb edges from the cars' graph (the outside look's ask, so the noon arterial isn't a grey void) are part of that call.
- **The deck trail** (above).
- **The next car to push to.** The outside look asks that, once the car beside is painted, the next unpainted one glints, so the push has a target. That needs life to say which car is next (H8).
- **A drive-by's street sign** can still spring up between the lens and the bus: on the GPU it covered the bus's back on the hill's look-left drive-by. The sign's spot keeps off a landmark's box on screen (`overLm`); on the street it should keep off the bus's box the same way.
- **The exhaust** still reads as a small ball from the kerb chase (the outside look), and **MEGA's ring and popped hatch lid** still show on the street until feat/shots's MEGA off merges.
- **Asked of the second account** (`src/life`, small hooks):
  - **H1:** `curb.land(x, z, heading, speed)`, rolling from the bus's speed and easing to the pace. The catch-up on the host is now at most six rolls (one in the sim), not up to 120.
  - **H2:** pick each junction's way from the look as it comes into reach (the day review's M12). Today the look is read only when the next 600 m stretch is asked, so the turn comes 220 to 600 m on. The flight now asks square and holds the ask a second past the lift.
  - **H3 and H6:** never pace or close on a car in the bus's own lane (the day review's B2): on a road with one lane each way, ride half a lane to the kerb side of it, or pace only cars in another lane. The GPU check found the paced car in the bus's own lane on two-lane roads too (75 of 75 samples on the arterial), and a truck inside the bus 54 of 64 on the waterfront.
  - **H4:** `curb.besideAt`, the car's place, for the splash. Until then it's a lane over on the traffic's side, which on a one-lane road is the oncoming lane.
  - **H5:** an answer that adds no points past the end is the end (the day review's M13). The flight now takes the wheels up a second after the lane stands, but in that second life still asks its worker every frame (59 asks in the sim), and the bus stops dead instead of slowing to the kerb.
  - **H7:** `curb.kerb`, the kerb's side (+1 right, -1 left), for a city that drives on the left. The flight reads it if it's there, else the right.
  - **H8:** `curb.next`, the next unpainted car going the bus's way, for its glint.
  - **The painted set** in `Curb.ts` is never cleared, so a car can be painted by riding beside it only once a session.
  - **No street or not yet?** An empty answer means both "no street here" and "the roads aren't in yet" (the day review's m21); the flight says FIND A STREET for both. A word for which would let it wait instead.
  - Does the trail count toward a square's streets stage (`src/factions`)?
- **The landing's long frame.** The 383 ms frame (and the GPU check's 800 ms) had no script task over 100 ms and didn't come back on a second run; frames that long also hit plain flight on the shared laptop. What was Curb's was the dive's catch-up, 11 to 77 ms of life's rolls, now at most six. It still has to be watched on an A15.
- **The phone.** Whether the dive is too eager at Cruise (`diveOnly`), and whether a minute on the street is fun, are the producer's to say.

## After the review

Three checks of 84f76f8 and ab884a6: a code review, a GPU check and an outside look. Each finding was checked against the code first; this is what each came to. The second account's day review (`docs/reviews/recess-life-day-2026-11-06.md` on feat/earth) is taken where it touches the flight. The fixes are 0d72f38, 371304e, f944300 (the sim) and e939db9 (the lens on a narrow street, after the first GPU run).

### The code review

- **B1, a look hid the bus.** Held: once the look swung the 34 m lens round the bus, nothing kept it out of the fronts. Fixed: on the street the view turns at most 30 degrees; a narrow street takes back as much of the swing as would bring the lens nearer than 20 m; and anything still solid between the bus and the lens brings it in short of that at once, and lets it out eased. In `s_curb.ts`, a look held 25, 40 and 90 degrees either way round each of GEARS.md's four streets: the bus hidden in 0 of 420 frames and the lens in a house in 0, on each (the lens no nearer than 19.5 m on the residential street, 17.6 m on the hill, 20 m on the waterfront).
- **M1, a dead end froze the bus.** Held, and wider: life's roll never answers false at a lane's end, even where it ends properly, so the flight's 'end' never came. Fixed: life's lane standing still a second takes the wheels up, and the readout says 0 meanwhile. In `s_curb.ts`, off ('end') 1.00 s after the bus stood, the readout 0. Life still asked its worker 59 times in that second (H5).
- **M2, the lens jumped above the Bay Bridge.** Held. Fixed: the lens stands on the ground or a deck under the lane + 3 m, never on one over it, and 1 m under a deck over it. In `s_curb.ts`, 30 s on a street under the approach: the lens over a deck 0 frames, its worst step 0.94 m a frame, the bus never hidden.
- **M3, the hint's bit.** Held: feat/shots (34e4293) has `aim: 64`. Curb's is 128.
- **M4, the flick's arc grew with height.** Held. Fixed: the arc's own ease is never faster than 60 m/s (from higher up it takes longer), and a flick lands from 60 m over the ground or a deck, not 150. In `s_curb.ts`, the arc's fastest frame from 50 m was 51.9 m/s over 1.51 s, from 25 m 41.7 m/s.
- **m1, the street's floor held while life answered.** Held. Fixed: the dive's floor lets go when the road under the bus, or 15 m on, ends. In `s_curb.ts`, a dive at Express to the arterial's end with life 0.67 s late: the floor held 9 frames of the ask and let go, the bus was in a building 0 frames, its worst rise 0.09 m a frame; with no answer, the same.
- **m2, `diveOnly`.** The producer's call; still off. Both checks would turn it on.
- **m3, the look's turn.** Held. The flight now asks life for the turn square, since life turns only past 60 degrees, and keeps asking a second past the lift. This doc says what it does: the turn comes at the first junction of life's next stretch (H2).
- **m4, the splash's side.** Held. It's right once life paces only cars in another lane (H3, H6); until then, on a one-lane road it's the oncoming lane. It now follows life's kerb side if life says one (H7). H4 is still asked.
- **The nits.** MEGA on the street: left to feat/shots's MEGA off. A flick that bounces learning the hint: fixed (on the GPU, a new phone's first flick over the bay left the bit unset, and the hint came on its next pass over a road). Right-hand traffic: the drive-by's kerb side and the splash read life's `curb.kerb` if it says one (H7). A BlastSpec every 3 m: didn't hold as waste. GroundPaint keeps every dab's spec by place, as it keeps any blast's, so it's kept data, not churn.
- **Merging feat/shots, H5 and the painted set** are under "What's left".

### The GPU check

1. **The dead end:** M1. On the GPU, on the arterial's lane end the wheels went up 1.02 s after the bus stood (it had stood for good).
2. **The bus inside cars, on two-lane roads too:** life's (H3, H6); nothing in the flight changes it. The final run still found the paced car in the bus's own lane in 17 of 17 samples at Cruise on the residential street, 44 of 44 in School Zone's leg on the waterfront and 90 of 101 over the two-minute roll; on the arterial it was a lane over (0 of 18).
3. **Looking on the street:** B1.
4. **The look's threshold:** m3.
5. **The Bay Bridge eastbound:** its lower deck is no street now, and a lane over a deck the bus is under is no street either. Over the bridge heading east, and from under either bridge, a flick says FIND A STREET.
6. **The readout's jump at the arc:** it eases from the bus's speed to the lane's. In `s_curb.ts` the most it changed in a frame was 2.3 m/s from Cruise and 2.5 from Express; it was 52 in one frame.
- **And:** a FIND A STREET flick learning the hint (fixed), and the dive's catch-up of 11 to 44 rolls (now at most six: 1 to 4 on the GPU).

### The outside look

1. **Curb's camera:** the kerb chase raised to 11 m, looking 40 m on, 38 degrees wide, 1.25 m toward the traffic; the look capped at 30 degrees, not the 40 asked, since the side takes 25 and the turn 20.
2. **The drive-by:** its flung blobs keep to the side that blooms, its front is 16 m on and in the lens's view, a street sign it raises comes down to 0.4 of its size on the street, and the look's side is kept a second past the lift. Proven on streets with fronts (below).
3. **Never park the bus:** M1. Life's part (at a fork with nothing straight on, take the right-hand way or the look's) is with H2.
4. **The 383 ms landing frame:** not found in Curb's script. On the GPU check it had no script task over 100 ms and didn't come back on a second run, and frames that long hit plain flight on the shared laptop. What was Curb's was the dive's catch-up, now at most six rolls. The first landing of a page still costs Curb 4 to 39 ms of script on the laptop, life's rolls 1 to 16 ms of it (their code cold); the next landing on the same page costs 2 to 6.
5. **The car beside as a character:** life's (its models at kerb distance, H3, H4); the next car's glint needs H8.
- **Smaller:** the trail now starts at the rear axle; the exhaust's ball and MEGA's ring are left.
- **For the producer:** lane dashes and kerb edges (street surfaces), and `diveOnly`.

### The day review, where it touches the flight

B2 is H3 and H6; M12 is H2; M13 is H5, and the flight's second standing now takes the wheels up. Of m21, the heading's snaps at corners never reached the bus: the flight's spring (6/s) has always smoothed them. An empty answer meaning both "no street" and "not loaded yet" is asked of the second account.

### The checks on the final build (e939db9)

- `npx tsc -p tsconfig.main.json --noEmit`: clean.
- **No life, unchanged.** `s_gesture.ts`: 772 checks over 322 rows, the log byte-identical to feat/gears 3a2b21f's run. `s_turbo.ts`: 37 checks, its output byte-identical (11,211 bytes) to feat/gears's.
- **`s_curb.ts`: all 44 checks pass.** The 25 from before (the arc's flick rows now from 50 and 25 m, not 60, and 80 m for "nothing", not 160; the roll 12 s and the push 4, since the arterial's lane now ends where life holds the bus) and the review's: the look round four streets, a dead end, the decks, a dive past a street's end with life slow, the arc's top speed, the readout's steps, the catch-up's calls, the hint, the look's square ask and the side kept.
- **`tools/life/curb.mjs`:** 8 of 8 pass (761 landings from 800 tries).
- **`vite build`** into sb-build-curb and **`iosfloor`**: iOS 15.0 parses every chunk.
- **`tools/shots.mjs --det` with no `?life`** against feat/gears 3a2b21f's build: 8 of 8 views identical, sky off and at golden hour.
- **`warmcheck.mjs --curb`**, twice, a cold load of the arterial with `?life` and real touches through each of Curb's phases: 0 programs after the warm-up both times (39 warmed), and no script task over 100 ms after ready. Frames over 100 ms: one of 383 ms while rolling in the first run, one of 133 ms going into School Zone in the second; none in the landing.
- **The GPU flights:** the GPU check's `curbfly.mjs` (in `sb-checks/shots/curb/fix/bin`, with each frame's sight of the bus added), on the laptop's GPU, real CDP touches and flicks, the real clock from 16:25.
  - **Landings.** School Zone's flick landed on the arterial, the residential street, the hill and the waterfront, and Cruise's and Express's dives on the first three; Nonstop never. The arcs took 0.60 to 0.97 s, none slid back along the lane, all ended 0.00 m off it. Over the bay, from under either bridge, over the Bay Bridge heading east (its lower deck) and where life answered a single point: FIND A STREET. The hint came once and never again; a new phone's first flick over the bay left it unlearned, and it came on that phone's next pass over a road.
  - **The two-minute roll** on the waterfront: 126 s on the street, 345 dabs, two cars painted, each 1.50 s after the bus pulled up beside it, two looks said, and the flick up off. Frames 16.7 ms at the median and 18.4 at the 95th percentile; one frame of 1.46 s, with 16.6 ms the most script in that phase.
  - **The arterial's lane end:** the wheels went up 1.02 s after the bus stood (in the GPU check it stood there for good).
  - **14,133 frames on the street over every leg and the roll: the bus's middle out of the lens's sight in 0, the lens in a building in 0,** the look-left drive-bys included.
  - **Drive-bys:** on the residential street a kerb tap raised 8 fronts, all on the right, and a look-left tap 8, all on the left; the hill 2 and 5, the arterial 3 and 2, the waterfront 4 and 0, none on the wrong side.
  - **The budget:** on the street at most 159 draws and 1.13 M triangles; 0 programs made in any leg.
  - **The landing's frame:** the first landing of a page cost 8 to 60 ms of the frame's script, Curb's 4 to 39 of it, life's rolls 1 to 16 ms in 1 to 4 calls; a second landing on the same page cost Curb 2 to 6 ms.

### Not checked

- Anything on an A15, and the producer's phone.
- **A deck landing from above on the GPU.** The starts tried put the bus under the decks or over their cables, more than 60 m up. In `s_curb.ts` the Bay Bridge's upper deck, westbound, landed from 43 m over it, the lens 10 m over the deck and the bus in sight.
- **A turn at the junction ahead,** which is life's (H2), and **the car beside a lane over:** the paced car was in the bus's own lane in most samples (life's H3 and H6).
- **The new kerb chase at noon,** and `tools/streetcam/curb-shots.mjs` again: the GPU's stills are at 16:25. No outside look was run again (one round).
