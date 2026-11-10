# Swerve: a longer stick, the skid, the swoop and the long swipe

The second account, 2026-11-10, for the producer and the first account. Approved to build the same day ("Let's build everything but the gods for now"), and built as a stand-in on `feat/swerve`, behind `?swerve`: section 8 says what that is. The numbers here are the simulator's, from the built thing (section 7). It answers these:

> "Regarding gears: I don't think they should change at all for a match. But I think side turning, left to right needs recalibration- I'd like to be able to turn more aggressively in all gears while also still being able to turn smoothly if I like."
>
> "But when I'm turning even in low gear, I feel the turning and swerving mechanics can be improved. Like… i want to be able to swerve up, then dive down, and then essentially almost do a 180 all in one or two thumb movements."
>
> "Skies can be a thing. But please explain mechanics more. I need to know they're solid. Also while we're at it, maybe we can have a swipe function that brings the bus to gear 1, just above school zone, very quickly. Like a large swipe from top to bottom of screen."

("Skies" read as skids: `docs/specs/factions/PVP.md`, "The skid".)

All of it is how the bus flies everywhere, in every gear. Nothing here is for a match: there are none (`docs/specs/factions/RAMPAGE.md`).

## 1. What stays

- **The gears.** The whole ladder, as it is, everywhere.
- **Today's stick.** Flying level, the first 78 px of the thumb's sideways travel does exactly what it does today, in every gear, to the last bit. Smooth stays smooth, and nothing has to be relearned.
- **One thumb.** No button. One new gesture, the producer's own: the long swipe (section 5).

## 2. A longer stick

Today the stick is as good as spent at about 100 px: it grows evenly to 61 px, eases out to 91 % of its most at 78 and 98 % at 100, and from there to its leash at 172 px (where the stick's middle starts following the thumb) nothing more happens. That spare travel is where "more aggressively" goes. Sideways, from where the thumb landed:

| The thumb's travel | What the bus does |
|---|---|
| 0 to 78 px, about 14 mm | **Smooth.** Today's turn, unchanged |
| 78 to 120 px, a thumb's width more | **Hard.** The turn grows to about one and a half times today's most at Cruise and two and a half times in the top gears. The spring stiffens, 2.4 Hz to 5, so it bites at once |
| Past 138 px, held 0.08 s | **The skid** (section 3) |

Half a turn with the thumb held at each, by gear: how long it takes, and how wide it is. Measured on the real flight (section 7); the same at 30 and at 60 frames a second.

| Gear | Today, the stick at its limit | Hard | The skid, held till the nose is round, then let go |
|---|---|---|---|
| Cruise, 26 m/s with a full belly | 2.3 s, 37 m wide | 1.5 s, 25 m | 1.35 s, 21 m |
| Express, 112 | 4.3 s, 302 m | 2.0 s, 141 m | 1.6 s, 100 m |
| Nonstop, 225 | 6.3 s, 890 m | 2.7 s, 379 m | 1.9 s, 238 m |
| Jet, 450 | 9.2 s, 2.6 km | 3.8 s, 1.1 km | 2.3 s, 480 m |
| Turbo 1, 585 | 10.6 s, 3.9 km | 4.3 s, 1.6 km | 2.8 s, 740 m |
| Turbo 2, 720 | 11.9 s, 5.4 km | 4.7 s, 2.1 km | 3.3 s, 1.1 km |
| Turbo 3, 900 | 13.4 s, 7.6 km | 5.3 s, 3.0 km | 3.9 s, 1.7 km |

In the skid the nose is round sooner than the bus is: at 1.05 s at Cruise, 1.3 s at Express, 1.6 s at Nonstop. That's the point of it (section 3).

The leash stays where it is: the stick's middle follows a thumb that goes past 172 px, so the reach is always there.

**A thumb near a side of the screen.** A thumb that lands 100 px from the screen's right edge can't travel 138 px right. So the hard part and the skid squeeze into the room there is on that side: with 130 px of room the hard part runs from 64 to 106 px and the skid is at 120; with 95 px, 52 to 71 and 85. The smooth part is never squeezed under 52 px. A thumb pushed against the edge of the glass is always asking for all there is. (Within about 85 px of an edge there's no skid that way.) With room to spare, 148 px or more, nothing is squeezed.

## 3. The skid, exactly

**How it starts.** The thumb past 138 px sideways for 0.08 s. A twitch doesn't do it. Not in School Zone or on the street: the hover and Curb have their own turn. After a skid the thumb has to come back inside 138 px before the next can start.

**What happens.** The bus has two directions where today it has one: the way it's going, and the way it's pointing.

- The nose swings toward the turn fast: 180 degrees a second up to Express, 125 at Nonstop, 90 at Jet, 60 at Turbo 3.
- The bus goes on sliding the way it was going, and its way comes round behind the nose, at the hard turn's rate and a little more as it slows.
- The angle between the two is the slip. It never passes 70 degrees, so the bus never spins like a top.
- So the bus points somewhere new before it's going there. A tap in a skid goes where the nose points.

**What it costs.** Speed. A full slip scrubs 40 % of it a second: a skid held its whole second and a half leaves about 70 % of the gear's speed at Express and 85 % at Turbo 3. Never under 20 m/s. The gear doesn't change, and pulls the speed back in 0.7 s at Cruise and Express and about a second and a half above, as it does after any slowing. (Back through the speed of sound, the bus booms again.)

**How it ends.**
- Ease the thumb back inside 126 px, or let go, and the bus grips: over 0.3 s its way comes round to its nose. That last snap is most of the turn in the high gears.
- With a gear in, it grips by itself after 1.5 s of sliding, so it can't be held for ever.
- At Cruise it can: a doughnut on the spot, round and round, is allowed.
- The steering is the player's all the way through.

**What it can't do.**
- Put the bus in a building. The flight still flies the bus along the way it is really going, so everything that keeps a turning bus out of a building today, the floor rising ahead of it and the push round a tower, keeps a sliding one out too. Eighty skids at random over eight neighbourhoods, the Financial District's towers among them, in Cruise, Express, Nonstop and Jet: on no frame is the bus through a roof, a wall or a tree, and it clips no more often than the same thumb does today (section 7).
- Change the height. It's flat: the thumb's up and down still climb and dive, so a skid in a climb is a corkscrew.
- Differ by frame rate. The flight already steps 120 times a second inside a frame, and the skid's own sums are exact at any step: the table of section 2 comes out the same at 30 and at 60 frames a second.

**What you see and hear.**
- The bus broadside to the way it's going, leaning out.
- Tyres squealing in mid-air, then the air brake's hiss as it grips.
- A fan of the crew's paint off the outside of the slide.
- The camera follows the way the bus is going, not its nose, so the slide is in the picture and the view doesn't whip. When it grips the view comes round behind the bus again.

**The wave.** A real slide (a quarter of a second, 30 degrees of slip) that grips with a full belly throws the belly off the outside as a wave: it lands beside the bus's way within about 110 m, paints what stands there as a tap does (something over half a tap's circle), and spends the belly. It soaks any bus in it (RAMPAGE.md). A tap during the slide is a shot down the nose instead, and then there's no belly left to throw. With the belly empty the skid still turns; it only throws spray.

## 4. The swoop: up, over and down

Today a steep climb doesn't bring the bus round any faster: the turn goes by speed alone. So going over the top to turn round, as the producer wants to, is slower than turning flat.

**The rule.** The steeper the stick has the bus pointing, up or down, the faster it comes round: the turn divided by the cosine of the nose's angle, three times at the most (past about 70 degrees).

It's what a bus would do. One pointing almost straight up is hardly moving over the ground, so it takes almost nothing to point it another way.

Two things keep it from surprising anyone:
- It only counts a nose the stick put there. Skimming the roofs, the bus rises and sinks by itself, and its turn doesn't breathe with them.
- It only comes in for a stick held well sideways, more than a third of the way. A climb with a wandering thumb still climbs straight.

It lingers for a moment as the nose comes down, so pulling up and then sweeping across is one arc of the thumb, and the turn is still quick at its top.

**The move.** One arc of the thumb: pull down, sweep across, then push.

| Gear | Round today | Round with it | How high it goes |
|---|---|---|---|
| Cruise | 3.4 s | 1.6 s | 46 m |
| Express | 6.9 s | 2.3 s | 210 m |
| Jet | 13.4 s | 3.8 s | 1.3 km |

The other way down works too: a steep dive comes round as fast.

**If the phone says the arc is too much to ask,** the fallback is one stroke that flies the same move by itself. I'd rather not: the steering stops being the player's for a second.

## 5. The long swipe: straight to Cruise

The producer's gesture: "a large swipe from top to bottom of screen".

- **What it is.** One stroke down of 40 % of the screen's height or more, starting above the bus, off its lane, nearly straight (within 28 degrees), in 0.6 s or less. It answers as the stroke passes that length, under the thumb, not at its lift.
- **What it does.** Every rung above Cruise goes at once, and the speed is Cruise's about half a second later, from any gear (0.52 s from Express, 0.6 s from Turbo 3), where a gear down takes 3 s today. The stop arm swings out, the air brakes hiss, the bus noses up a little, and a puff of its paint goes on ahead of it. The bus keeps the height it had.
- **Not below Cruise.** From Cruise and from School Zone it does nothing, whatever its pace. School Zone and Curb are still a flick each.
- **What it's for.** Stopping where you've seen something to paint. Arriving. Turning round: at Cruise the bus turns on the spot. And making whoever is on your tail fly past.
- **What it can't be mistaken for.** A flick is still a flick: a short one, or a long one that stops short of 40 %, is one gear, as today. A stroke down the stick starts in the bus's lane and is still a pull. A look that goes down is slower, or slanted. And the look a long stroke begins is let go when the stroke turns out to be the swipe.

## 6. The camera

- It follows the way the bus is going, not its nose. It always did: in a skid that's what keeps the slide in the picture.
- Its turn keeps up in the hard part of the stick: its own spring stiffens there, so it trails a hard turn by about what it trails a full turn today.
- The bus stays in the middle of the frame through all of it: within 6 % of the frame's width in every gear, in a hard turn, a skid and its grip (section 7). The fear that a harder turn would swing the bus off the screen was wrong: the rig keeps it centred.
- Not built: looking a little into the turn. It needs the camera's own code, and the phone should say first whether it's missed.

## 7. Solid before it's flown

In Node, on the real flight code, each a row that fails when its rule is broken. On `feat/swerve`:

- `node tools/feel-sim/run.mjs ../swerve/s_turns.ts`, on a flat world, 46 rows:
  - **The table of section 2,** measured in every gear, smooth, hard and skidding, at 30 and at 60 frames a second, the two within 3 % of each other (or a frame).
  - **Smooth is today's.** The same thumb inside 78 px, level, flies the same line with it on as with it off, in every gear: not a bit apart.
  - **A thumb near a side:** the parts squeeze into the room, in order, the skid within reach of the edge.
  - **The skid:** the slip never over its cap; grip 0.3 s after easing off; never under 20 m/s; the gear never changed; with a gear in, over by itself at 1.5 s; held as long as the thumb is at Cruise; a twitch starts none.
  - **The swoop:** the table of section 4; the turn never over three times its flat rate.
  - **The swipe's brake:** at Cruise's speed from every gear in under 0.8 s.
  - **The camera:** the bus in the frame through a hard turn, a skid and its grip, in every gear.
- `node tools/feel-sim/run.mjs ../swerve/s_city.ts 80`, over the real city, 10 rows: the skids of section 3, and the wave (it lands off the outside of the slide, paints what stands there, spends the belly; none with the belly empty).
- `node tools/controls-sim/run.mjs ../swerve/s_swipe.ts`, through the real touch code, 23 rows: the swipe from every rung at a flick's pace and unhurried; nothing from Cruise or School Zone; a flick down still one rung; a slow stroke still a look; a stroke down the stick still a pull; a slanted one and one going up as they were; the swipe beside a steering thumb.
- `node tools/swerve/smoke.mjs`, in a browser at 1x: it stands up, the hard turn bites, a skid slips and sprays, its grip throws the wave, the swipe takes Jet to Cruise, a page without `?swerve` has none of it, and nothing compiles on the way.

Then the phone, which beats all of it.

## 8. Who builds it, and what's built

The flight, the stick and the camera are the first account's (`src/game/Flight.ts`, `Input.ts`, `CameraRig.ts`), and this is theirs to build into them properly.

What's on `feat/swerve` is a stand-in by the second account, so the producer can feel it now: `src/swerve/` (`swerve.ts` the handling, with no page under it; `swerveBoot.ts` its hands and looks; `swerveSfx.ts` its stand-in sounds). It changes nothing in `Flight.ts` or `CameraRig.ts`. It reaches the flight through what the flight already offers:

- the gears' steering authority (`Flight.turbo.yaw`), multiplied after the gears write it: the hard turn and the swoop;
- the gears' speed and rate (`Flight.turbo.speed`, `.rate`) and `speedScale`: the skid's scrub and the swipe's brake;
- `Flight.heading`, written as a skid grips;
- two springs in `config` (`flight.bungeeHz`, `camera.yawHz`), raised in the hard part of the stick and put back.

And it asks five small things of `main.ts` and one of `Input.ts`, each marked `?swerve` where it stands (`docs/specs/shots/HOOKS.md`, "Swerve", lists them): its two calls round the flight's steps, the slip, roll and pitch in the bus's pose, the slip in the aim, the stop arm in the pose, the look let go on a swipe, and `Input.inLookZone` made public.

What the first account would do differently, taking it in: the slip as a field of the flight itself, so the Comet, the Lob and the Hose aim down the nose too (today only a tap does); the long swipe read by `Input` with the other gestures; the stop arm as a pose of its own; real sounds.

## 9. What it changes in the rulings

| Before | With this |
|---|---|
| "A quick flick up or down is one gear, anywhere. No double flicks, no left or right swipes, no tilt" (CLAUDE.md, "Controls") | All still true. One gesture more, the producer's: the long swipe down to Cruise |
| "Speed and climb never grow with height. Going faster is the gears' job" (CLAUDE.md, "Flight") | Still true. A skid costs speed and the gear gives it back |
| The stick is spent at about 100 px (`inputTune.knee`, `config.flight.stretchPx`) | It goes on: hard from 78 to 120 px, the skid past 138 |
