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
| 78 to 120 px, a thumb's width more | **Hard.** The turn grows to one and a half times today's most at Cruise and four and a half times at Turbo 3, on one law the whole ladder up (below). The spring stiffens, 2.4 Hz to 5, so it bites at once |
| Past 138 px, held 0.08 s | **The skid** (section 3) |

**The quick turn in turbo** (stage 2). The producer, flying without it: "when I'm in turbo mode I want a way to quickly turn - right now I'm forced to only take really long turns." Today's stick takes 2.2 times longer to turn round each time the speed doubles. The hard part now follows one law in every gear, "turn more aggressively in all gears": all in, half a turn takes 1.5 s x (speed / 26.4)^0.2, 15 % longer each time the speed doubles (`swerveTune.hardAt`, `hardGain`: 1.5, 2.15, 2.75, 3.51, 3.83, 4.12, 4.45 times today's most, Cruise to Turbo 3). The skid's nose swings faster in the high gears (section 3), so the skid is the snap turn in every gear. The smooth part, the gears and the climb are as they were.

Half a turn with the thumb held at each, by gear: how long it takes, and how wide it is. Measured on the real flight (section 7, `feat/handling`); the same at 30 and at 60 frames a second.

| Gear | Today, the stick at its limit | Hard | The skid, held till the nose is round, then let go |
|---|---|---|---|
| Cruise, 26 m/s with a full belly | 2.3 s, 37 m wide | 1.5 s, 25 m | 1.35 s, 21 m |
| Express, 112 | 4.3 s, 302 m | 2.0 s, 141 m | 1.6 s, 100 m |
| Nonstop, 225 | 6.3 s, 890 m | 2.3 s, 324 m | 1.7 s, 214 m |
| Jet, 450 | 9.2 s, 2.6 km | 2.65 s, 743 m | 1.9 s, 467 m |
| Turbo 1, 585 | 10.6 s, 3.9 km | 2.8 s, 1.0 km | 1.9 s, 599 m |
| Turbo 2, 720 | 11.9 s, 5.4 km | 2.9 s, 1.3 km | 1.9 s, 735 m |
| Turbo 3, 900 | 13.4 s, 7.6 km | 3.05 s, 1.7 km | 1.9 s, 916 m |

A quarter turn: hard 0.8 s at Cruise to 1.55 s at Turbo 3; in a skid 0.85 s at Cruise, 1.0 s at Jet, 1.1 s at Turbo 3. Stage 1 (before the quick turn) took 2.7 s hard and 3.9 s in a skid for Turbo 3's half turn.

Read it honestly: from Jet up the skid's 1.88 s is the slide's own time, not the turn's: 0.08 s to start, 1.5 s with a gear in, 0.3 s to grip. The nose is round at 1.6 s at Jet and 1.85 s at Turbo 3, inside the grip's catch. The quarter turns, and the half turns at Express and Nonstop, end by the thumb, before that.

What it costs: a skid's half turn scrubs Nonstop to 169 of 225 m/s, Jet to 333 of 450, Turbo 1 to 427 of 585, Turbo 2 to 531 of 720, Turbo 3 to 671 of 900, and the gear has 95 % of it back about a second after the grip's catch. A quarter turn scrubs 2 to 6 %. The gear itself never changes.

In the skid the nose is round sooner than the bus is: at 1.05 s at Cruise, 1.3 s at Express, 1.6 s at Nonstop and Jet. That's the point of it (section 3).

The leash stays where it is: the stick's middle follows a thumb that goes past 172 px, so the reach is always there.

**A thumb near a side of the screen.** A thumb that lands 100 px from the screen's right edge can't travel 138 px right. The room is from where the stick's middle is (the landing, until the leash drags it) to 14 px short of the glass's edge, and with 148 px or more nothing moves. With less, as built (`Input`'s `stickParts`, the first account's, `feat/handling`; `swerveTune.rule` 0):

- The skid is 10 px short of the edge.
- The hard part is what's left between 78 px and the skid, at least 16 px wide (with 130 px of room: 78 to 106, the skid at 120).
- The smooth part stays today's, the whole 78 px, while that fits: with 108 px of room or more. Under that it gives way, never under 52 px (with 99 px of room: 69 to 85, the skid at 89).
- Under 82 px of room, a thumb landing within 96 px of a side, those floors and the skid can't all fit, and there the three shrink together, so the hard turn and the skid are always in reach (with 59 px: hard from 36, the skid at 49). That last is the studio's call: the phone says.
- A hard part squeezed narrower than its 42 px gives that share of the hard turn's gain (`InputState.hardTop`, `swerveTune.squeezeCap` 1), so no px of thumb turns the bus more than a px of the whole stick does: with 100 px of room the hard part is 16 px wide and gives 0.38 of it (at Turbo 3 at most 2.3 times today's turn, against 4.45 with room to spare). The skid, 10 px short of the edge, is still in reach, so the quick turn is never lost. `squeezeCap` 0 is stage 1's: the whole gain over the squeezed part, steeper.

On a 393 px glass that keeps today's smooth turn, both ways, for every landing from x = 122 to 271, and the hard turn and the skid in reach from every landing (`tools/swerve/s_stick.ts`). A thumb pushed against the edge of the glass is always asking for all there is.

The stand-in's rule is kept beside it for the phone to compare (`swerveTune.rule` 1, tuner group "Swerve"): the smooth part squeezed first, down to 52 px, so the hard part and the skid fit (with 130 px of room the hard part runs from 64 to 106 px and the skid is at 120; with 95 px, 52 to 71 and 85). It turns a gentle thumb on the near side harder than today's: three landings in four on a phone (B101 of the review of 018c5d8).

## 3. The skid, exactly

**How it starts.** The thumb past 138 px sideways for 0.08 s. A twitch doesn't do it. Not in School Zone or on the street: the hover and Curb have their own turn. After a skid the thumb has to come back inside 138 px before the next can start.

**What happens.** The bus has two directions where today it has one: the way it's going, and the way it's pointing.

- The nose swings toward the turn fast: 180 degrees a second up to Express, 160 at Nonstop, 140 at Jet, 120 at Turbo 3 (stage 2; stage 1's were 125, 90 and 60, too slow to be quick in turbo).
- The bus goes on sliding the way it was going, and its way comes round behind the nose, at the hard turn's rate and a little more as it slows.
- The angle between the two is the slip. It never passes 70 degrees, so the bus never spins like a top. Over its last 12 degrees it eases in (`slipSoft`), so the nose comes off its swing smoothly, not from 120 degrees a second to the way's 60 in one frame.
- So the bus points somewhere new before it's going there. A tap in a skid goes where the nose points.

**What it costs.** Speed. A full slip scrubs 40 % of it a second: a skid held its whole second and a half leaves about 70 % of the gear's speed at Express and 85 % at Turbo 3. Never under 20 m/s. The gear doesn't change, and pulls the speed back in 0.7 s at Cruise and Express and about a second and a half above, as it does after any slowing. Over the speed of sound a skid never takes it under 95 % of it (`machKeep`), so it doesn't go back through and boom again on the way up: the boom is the gears' (a studio call).

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
- The camera goes with the nose (stage 2, section 6), so where a tap goes is in the picture: the view swings across the city at 120 to 180 degrees a second, easing off as the slip nears its cap, and the bus slides broadside in the middle of the frame. When it grips the view is already where the bus is now going.

**The wave.** A real slide (a quarter of a second, 30 degrees of slip) that grips with a full belly throws the belly off the outside as a wave: it lands beside the bus's way within about 110 m, paints what stands there as a tap does (something over half a tap's circle), and spends the belly. It soaks any bus in it (RAMPAGE.md). A tap during the slide is a shot down the nose instead, and then there's no belly left to throw. With the belly empty the skid still turns; it only throws spray.

**One thumb out of a skid** (stage 2, `feat/handling`). Only a grip the thumb chooses throws the wave: easing back in (inside 126 px) with the thumb down, or going over to the other side. Letting go, or holding on till the slide's own time is up, grips quietly: the air brake still hisses, the belly stays full, and the next tap goes where the nose points (the aim is the bus's way turned by the slip, and the nose is drawn the same way through the grip). So one thumb can skid round and then shoot down the nose, the producer's "swerve up, then dive down, and then essentially almost do a 180 all in one or two thumb movements" with a shot at the end of it. From Jet up a half turn ends on the slide's own time (section 2), so if that threw the wave a turbo half turn with a full belly would always empty it. `swerveTune.liftWave` 1 is stage 1's way, where any grip throws.

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
| Jet | 13.4 s | 2.8 s | 1.0 km |
| Turbo 1 | 15.2 s | 2.9 s | 1.4 km |
| Turbo 3 | 19.0 s | 3.15 s | 2.2 km |

With the quick turn's hard part under it (stage 2) it is the "swerve up, then dive down, and then essentially almost do a 180" the producer asked for: nearly a 180 in about 3 s in turbo (Jet's was 3.8 s, Turbo 3's 5.3, in stage 1). Its turn never beats the skid's nose by much (136 against 120 degrees a second at Turbo 3), and it climbs at the gear's speed along the nose, not height's.

The other way down works too: a steep dive comes round as fast.

**If the phone says the arc is too much to ask,** the fallback is one stroke that flies the same move by itself. I'd rather not: the steering stops being the player's for a second.

## 5. The long swipe: straight to Cruise

The producer's gesture: "a large swipe from top to bottom of screen".

- **What it is.** One stroke down of 40 % of the screen's height or more, starting in the top 30 % of the screen (`swerveTune.swipeTop`, stage 2), off the bus's lane, nearly straight (within 28 degrees), in 0.6 s or less. It answers as the stroke passes that length, under the thumb, not at its lift. `Input` reads it beside the look and the flicks (stage 2: `swipeOn`, which main.ts sets with the handling on, and `onSwipe`); with `?swerve` off it reads no stroke for it.
- **What it does.** Every rung above Cruise goes at once, and the speed is Cruise's about half a second later, from any gear (0.52 s from Express, 0.6 s from Turbo 3), where a gear down takes 3 s today. The stop arm swings out, the air brakes hiss, the bus noses up a little, and a puff of its paint goes on ahead of it. The bus keeps the height it had.
- **Not below Cruise.** From Cruise and from School Zone it does nothing, whatever its pace. School Zone and Curb are still a flick each.
- **What it's for.** Stopping where you've seen something to paint. Arriving. Turning round: at Cruise the bus turns on the spot. And making whoever is on your tail fly past.
- **What it can't be mistaken for.** A flick is still a flick: a short one, or a long one that stops short of 40 %, is one gear, as today. A stroke down the stick starts in the bus's lane and is still a pull. A look that goes down is slower, or slanted, and mostly starts lower: a quick look down from the middle of the screen stays a look (stage 2). And the look a long stroke begins is let go when the stroke turns out to be the swipe.
- **Where there is none.** Under the Golden Gate's low shot, before the opening's gate, there's no look (`Input.lookOff`), so a landing anywhere flies and a stroke from the top is a turn. A landing in the bus's lane is the stick. The top 30 % is also the hardest reach for a thumb on a phone held in one hand: the phone tries 0.3 and 0.45.

## 6. The camera

- Out of a skid it follows the way the bus is going, as it always did. Its turn keeps up in the hard part of the stick: its own spring stiffens there (`hardCam`), so it trails a hard turn by about what it trails a full turn today.
- **In a skid it goes with the nose** (stage 2, `CameraRig`, `feat/handling`): the view's yaw is the bus's way plus the slip (`swerveTune.noseCam` 1 of it; 0 is stage 1's view down the way), so the aim, "aim with the bus", is in the picture. Its yaw spring is stiffer again while the bus slides (`skidCam` 2.5, eased in and out with the skid at 12 a second: 7.2 Hz with the hard part's), and under Jet the look point keeps up the same way.
- A spring stiffer than the camera's own is stepped in pieces of under 0.4 of a radian, so it is stable at 20, 30 and 60 frames a second. Stage 1's hard turn at 20 frames a second, one step a frame, put the bus half the frame's width off its middle.
- While it slides, the turbo lens's lead (`src/fx/Turbo.ts`) takes out all of the follow springs' lag across the nose, so a bus sliding at 70 degrees stays in the frame.
- The marks it holds (`s_camera.ts`, section 7), in every gear, at 20, 30 and 60 frames a second, with the street's lens and the vista's: the bus within 0.3 of the frame's width of its middle (0.2 at most at Cruise and Express, 0.18 at Turbo 3 at 20 frames a second); where a tap goes within 30 degrees of the view's middle at the worst (27 at Cruise) and inside the frame from 0.2 s after the nose is round; the view never turning faster than the nose; through the slide no lurch (its yaw acceleration under 4 rad/s^2).
- `noseCam` is the knob for the strongest motion in the game: at Cruise and Express the view now swings 180 degrees a second. The phone says whether it is too much; 0.6 is the first try if it is. Where the bus is going is off the frame's side at the slide's worst.

## 7. Solid before it's flown

In Node, on the real flight code, each a row that fails when its rule is broken. On `feat/swerve`:

- `node tools/feel-sim/run.mjs ../swerve/s_turns.ts`, on a flat world, 46 rows:
  - **The table of section 2,** measured in every gear, smooth, hard and skidding, at 30 and at 60 frames a second, the two within 3 % of each other (or a frame).
  - **Smooth is today's.** The same thumb inside 78 px, level, flies the same line with it on as with it off, in every gear: not a bit apart.
  - **A thumb near a side:** the parts squeeze into the room, in order, the skid within reach of the edge.
  - **The skid:** the slip never over its cap; grip 0.3 s after easing off; never under 20 m/s; the gear never changed; with a gear in, over by itself at 1.5 s; held as long as the thumb is at Cruise; a twitch starts none; at Nonstop the gear's own speed kept (`feat/handling`); the street taking the bus mid-slide leaves nothing of it and grips it; a skid goes the thumb's way when the map's edge homes the bus the other way.
  - **The swoop:** the table of section 4; the turn never over three times its flat rate.
  - **The swipe's brake:** at Cruise's speed from every gear in under 0.8 s.
  - **The camera:** the bus in the frame through a hard turn, a skid and its grip, in every gear.
  - **One thumb out of a skid** (stage 2): let go after 0.6 s at Cruise, the hiss and no wave, the belly kept, and a tap a frame later down the nose; eased back to 110 px, the wave; held at Express past the slide's time, no wave (and with `liftWave` 1, the wave); at Jet and Turbo 3 held till the nose is round and let go, no wave and the tap down the nose.
  - **The quick turn** (stage 2, `feat/handling`; 66 rows in all with the one-thumb rows): a quarter and a half turn, hard and in a skid, in every gear at 30 and at 60 frames a second: from Jet up the skid's quarter turn in 1.15 s or less and its half in 2 s or less, Turbo 3's under 1 km wide; the hard half turn on its law (1.5 s x (speed / 26.4)^0.2, within 5 %) and at most 20 % longer per doubling of the speed; Cruise and Express within 0.05 s of stage 1's; the slip's soft end (no frame's change of the nose's rate over 0.15 rad/s, and the slip within a degree of its cap in a held Cruise skid); a skid over the speed of sound never under 0.95 of it and no second boom; the gear 95 % back within 1.2 s of the turn's end; the swoop in Turbo 1 and 3 round in 3.3 s.
- `node tools/feel-sim/run.mjs ../swerve/s_city.ts 80`, over the real city, 10 rows: the skids of section 3, and the wave (it lands off the outside of the slide, paints what stands there, spends the belly; none with the belly empty).
- `node tools/feel-sim/run.mjs ../swerve/s_stick.ts`, the stick on a 393 px glass (`feat/handling`): for every landing from x = 60 to 333 and both sides, a thumb held 70 px sideways turns as today in every gear wherever that side has 108 px of room or more, and the hard turn and the skid are in reach from every landing; the stand-in's squeeze (rule 1) printed as the review's probe printed it; and (stage 2) at Turbo 3 with 100 and 60 px of room no px of thumb turns the bus more than a px of the whole stick does (`squeeze, Turbo 3`).
- `node tools/feel-sim/run.mjs ../swerve/s_camera.ts`, the camera in the quick turn (stage 2): the real `CameraRig` and the turbo lens through a skid's half turn in every gear, its grip and 2 s on, a hard half turn at Jet and Turbo 3, at 20, 30 and 60 frames a second, with the street's lens and the vista's: the marks of section 6, stage 1's hard turn at 20 frames a second, and with `?swerve` off the camera the same to the bit.
- `node tools/feel-sim/run.mjs ../swerve/s_throw.ts`, a hit's throw over the real city (`feat/handling`): 48 throws each of a shell's, a smash's, a wreck's and a head-on's, Cruise to Jet, from the roofs of the Financial District, Nob Hill and SoMa, none through a drawn surface, none lifted over 12 m in a frame, none ending outside the map, and a head-on blows the bus back; a shell's is thrown at the tallest thing within its 70 m, so the row holds one. `fps=20` flies the same at main.ts's slowest frame. `base` and `hard` print the same poses with no throw, and the review's hard turns with a pull or a push, with whether the flight's own obstacle field had what the bus went into, and pass while those clips are no more than 018c5d8's (3 frames, and 23 with `hard 16`), each one the field had: the flight's own, not fixed here.
- `node tools/feel-sim/run.mjs ../swerve/s_shove.ts`, the same throw on a flat world (`feat/handling`): a shell's from behind or across leaves Jet and Turbo 3 driving, with no second sonic boom, and a head-on's takes all the drive and blows the bus back, on any heading; a shell's throw doesn't stop a dive at Cruise or Jet.
- `node tools/controls-sim/run.mjs ../swerve/s_swipe.ts`, through the real touch code, wired as main.ts wires it (stage 2: Input reads the stroke), 33 rows: the swipe from every rung at a flick's pace and unhurried; nothing from Cruise or School Zone; a flick down still one rung; a slow stroke still a look; a stroke down the stick still a pull; a slanted one and one going up as they were; the swipe beside a steering thumb; and (stage 2) from 0.2 of the height in 0.35 s it brakes in every gear and its look is over, a quick look down from 0.45 of the height stays a look, a slow one from the top too, the swipe's lift is no flick, and with `swipeOn` off none of it.
- `node tools/feel-sim/run.mjs ../swerve/s_show.ts`, the one link (stage 2, section 10), 6 rows: `crew=show` turns the button on for the page and saves nothing; `?crew` and `?crew=off` as before; the Moon's page change keeps `show`; index.html's own lines, run on a fake address, write the long set once, let a flag given beside it win, keep the query's text byte for byte and the hash, never write a page without `show`, and are ES5; over the Moon and back the link comes out whole.
- `node tools/swerve/smoke.mjs`, in a browser at 1x: it stands up, the hard turn bites, a skid slips and sprays, eased back in its grip throws the wave, the swipe takes Jet to Cruise, a page without `?swerve` has none of it, and nothing compiles on the way.

Then the phone, which beats all of it.

## 8. Who builds it, and what's built

The flight, the stick and the camera are the first account's (`src/game/Flight.ts`, `Input.ts`, `CameraRig.ts`), and this is theirs to build into them properly.

What's on `feat/swerve` is a stand-in by the second account, so the producer can feel it now: `src/swerve/` (`swerve.ts` the handling, with no page under it; `swerveBoot.ts` its hands and looks; `swerveSfx.ts` its stand-in sounds). It changes nothing in `Flight.ts` or `CameraRig.ts`. It reaches the flight through what the flight already offers:

- the gears' steering authority (`Flight.turbo.yaw`), multiplied after the gears write it: the hard turn and the swoop;
- the gears' speed and rate (`Flight.turbo.speed`, `.rate`) and `speedScale`: the skid's scrub and the swipe's brake;
- `Flight.heading`, written as a skid grips;
- two springs in `config` (`flight.bungeeHz`, `camera.yawHz`), raised in the hard part of the stick and put back.

And it asks five small things of `main.ts` and one of `Input.ts`, each marked `?swerve` where it stands (`docs/specs/shots/HOOKS.md`, "Swerve", lists them): its two calls round the flight's steps, the slip, roll and pitch in the bus's pose, the slip in the aim, the stop arm in the pose, the look let go on a swipe, and `Input.inLookZone` made public.

What the first account would do differently, taking it in: the slip as a field of the flight itself, so the Comet, the Lob and the Hose aim down the nose too (today only a tap does); the long swipe read by `Input` with the other gestures (done in stage 2: the boot's own reader is asleep, `offLane` false, and its listeners are an ask of the second account); the stop arm as a pose of its own; real sounds.

## 9. What it changes in the rulings

| Before | With this |
|---|---|
| "A quick flick up or down is one gear, anywhere. No double flicks, no left or right swipes, no tilt" (CLAUDE.md, "Controls") | All still true. One gesture more, the producer's: the long swipe down to Cruise |
| "Speed and climb never grow with height. Going faster is the gears' job" (CLAUDE.md, "Flight") | Still true. A skid costs speed and the gear gives it back |
| The stick is spent at about 100 px (`inputTune.knee`, `config.flight.stretchPx`) | It goes on: hard from 78 to 120 px, the skid past 138 |

## 10. The one link: ?show

The producer, asking for a link to show the game: "Def show the floating houses. Show the rival buses. Show the moon." `?show` is that link (stage 2).

- **What it carries.** `index.html`'s boot script, before anything reads the address, writes out once each of `swerve`, `crew=show`, `life`, `bomb`, `boom`, `falls`, `lift`, `lifted=inferno` and `earth` that the address doesn't already name: the handling and the rival buses, the crews' button, life, the Bomb, the boom, the falls, Inferno's floating houses, and the flight up to TO THE MOON?.
- **What it keeps.** A flag given beside it wins: `?show&lifted=atlantis` shows Atlantis, `?show&norivals` has no rivals, `?show&crew` turns the crews' button on for good as `?crew` does. The address's own text is kept as it is (`t=2026-11-25T04:00:00Z`, a bare `fps`), and so is its hash.
- **What it leaves behind.** Nothing on the phone: `crew=show` turns the crews' button on for that page only, and a crew picked there isn't saved, so the plain link after it is as it was.
- **To the Moon and back.** The page change on the way (`src/sky/moonrun.ts`, `SWAP_KEEP`) keeps `show`, and the next page writes the rest out again. From the street the Moon is a long climb; `?show&moonland` starts in Earth's orbit with everything on.
- Without `show` the boot script asks one question more and does nothing else.
- Held by `s_show.ts` (section 7) in Node, and in a browser by the gate rows `warm-show` (nothing compiles in flight on `?show&skipintro`) and `warm-all` (the same with the long link written out by hand).
