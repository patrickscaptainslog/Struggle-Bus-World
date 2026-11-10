# Swerve: a longer stick, the skid, the swoop and the long swipe

The second account, 2026-11-10, for the producer and the first account. A plan, not built. The gears and the first part of the stick are ruled; the rest is the studio's answer to these, and is the producer's to approve after flying it:

> "Regarding gears: I don't think they should change at all for a match. But I think side turning, left to right needs recalibration- I'd like to be able to turn more aggressively in all gears while also still being able to turn smoothly if I like."
>
> "But when I'm turning even in low gear, I feel the turning and swerving mechanics can be improved. Like… i want to be able to swerve up, then dive down, and then essentially almost do a 180 all in one or two thumb movements."
>
> "Skies can be a thing. But please explain mechanics more. I need to know they're solid. Also while we're at it, maybe we can have a swipe function that brings the bus to gear 1, just above school zone, very quickly. Like a large swipe from top to bottom of screen."

("Skies" read as skids: `docs/specs/factions/PVP.md`, "The skid".)

All of it is how the bus flies everywhere, in every gear. Nothing here is for a match: there are none (`docs/specs/factions/RAMPAGE.md`).

## 1. What stays

- **The gears.** The whole ladder, as it is, everywhere.
- **Today's stick.** The first 78 px of the thumb's travel does exactly what it does today, in every gear. Smooth stays smooth, and nothing has to be relearned.
- **One thumb.** No button. One new gesture, the producer's own: the long swipe (section 5).

## 2. A longer stick

Today the stick ends at 78 px: pull further and nothing more happens. That spare travel is where "more aggressively" goes. Sideways, from where the thumb landed:

| The thumb's travel | What the bus does |
|---|---|
| 0 to 78 px, about 14 mm | **Smooth.** Today's turn, unchanged |
| 78 to about 120 px, a thumb's width more | **Hard.** The turn grows to about twice today's most. The spring stiffens, 2.4 Hz to about 5, so it bites at once |
| Past about 120 px, held a moment | **The skid** (section 3) |

Half a turn at full pull, by gear. Today's are the flight's own numbers. The others are first numbers: the simulator prints the real ones before anyone flies it (section 7).

| Gear | Today | Hard | The skid |
|---|---|---|---|
| Cruise, 30 m/s | 2.3 s, 44 m wide | 1.6 s, 30 m | about 1.2 s, 25 m |
| Express, 112 | 4.2 s, 302 m | 2.0 s, 140 m | about 2 s, 100 m |
| Nonstop, 225 | 6.2 s, 890 m | 2.6 s, 375 m | about 2.6 s, 300 m |
| Jet, 450 | 9.1 s, 2.6 km | 3.7 s, 1.1 km | about 3.6 s, 800 m |
| Turbo 3, 900 | 13 s, 7.6 km | 5.2 s, 3 km | about 5 s, 2 km |

In the skid the nose is round sooner than the bus is: about a second at Cruise and Express, two at Jet. That's the point of it (section 3).

If the thumb lands near the screen's edge and runs out of room, the stick's middle follows it, as on a leash, so the reach is always there.

## 3. The skid, exactly

**How it starts.** The thumb past the hard turn's end, about 120 px, for 0.08 s. A twitch doesn't do it. Not under 20 m/s: School Zone and the hover have their own turn.

**What happens.** The flight keeps two directions where today it keeps one: the way the bus is going, and the way it's pointing.

- The nose swings toward the turn fast: about 180 degrees a second up to Express, 125 at Nonstop, 90 at Jet.
- The bus goes on sliding the way it was going, and its way comes round behind the nose, at the hard turn's rate and a little more as it slows.
- The angle between the two is the slip. It never passes about 70 degrees, so the bus never spins like a top.
- So the bus points somewhere new before it's going there. Whatever is aimed with the nose is aimed already.

**What it costs.** Speed. A big slip scrubs about 40 % of it a second, never under 20 m/s. The gear doesn't change, and pulls the speed back as the bus straightens, as it does after any slowing.

**How it ends.**
- Ease the thumb back inside 120 px and the bus grips: its way snaps to its nose over about 0.3 s.
- Or it grips by itself after about 1.5 s of sliding, so it can't be held for ever.
- At Cruise it can: a doughnut on the spot, round and round, is allowed.
- Let go of the screen and it ends at once. The steering is the player's all the way through.

**What it can't do.**
- Put the bus in a building. The slide looks along its own way, as the hover looks for a wall ahead. A slide into a wall ends there with a clang, a bounce and a smear of the bus's paint on the wall.
- Change the height. It's flat: the thumb's up and down still climb and dive, so a skid in a climb is a corkscrew.
- Differ by frame rate. The flight already steps 120 times a second inside a frame.

**What you see and hear.**
- The bus broadside to the way it's going, leaning out.
- Tyres squealing in mid-air, then the air brake's hiss as it grips.
- A fan of paint off the outside of the slide.
- The camera follows the way the bus is going, not its nose, so the slide is in the picture and the view doesn't whip.

**The wave.** With a full belly that fan is a wave: it lands in a crescent behind and outside the slide, within about 60 m, paints the ground as a splat does, and soaks any bus in it. It spends the belly. With the belly empty the skid still turns; it only throws spray.

## 4. The swoop: up, over and down

Today a steep climb doesn't bring the bus round any faster: the turn goes by speed alone. So going over the top to turn round, as the producer wants to, is slower than turning flat.

**The rule.** The steeper the bus points, up or down, the faster it comes round: the turn divided by the cosine of the nose's angle, three times at the most (past about 70 degrees).

It's what a bus would do. One pointing almost straight up is hardly moving over the ground, so it takes almost nothing to point it another way.

**The move.** One arc of the thumb: pull down and across, then push.

1. The nose comes up and the bus climbs.
2. Near the top it pivots. With the stick in its smooth part that takes about half a second at Cruise, where today it takes 1.7, and a second and a half at Express, where it takes 4.2. Pulled hard, half a second in either.
3. The nose goes down and it dives out the way it came, faster than it went in.

About two seconds in all at Cruise. In a gear it's a tall one: at Jet the arc is a couple of kilometres high.

The other way down works too: a steep dive comes round as fast. That's the swerve up, the dive and the turn in one or two movements.

**If the phone says the arc is too much to ask,** the fallback is one stroke that flies the same move by itself. I'd rather not: the steering stops being the player's for a second.

## 5. The long swipe: straight to Cruise

The producer's gesture: "a large swipe from top to bottom of screen".

- **What it is.** One stroke down of more than about 45 % of the screen's height, starting above the bus, off its lane. A flick is still a flick: 30 px in under a quarter of a second, one gear.
- **What it does.** Brakes to Cruise from any gear in about 0.7 s, where a gear down takes 3 s today. The stop arm swings out, the air brakes hiss, the bus noses up a little, and a puff of its paint goes on ahead of it.
- **Not below Cruise.** From Cruise it does nothing. School Zone and Curb are still a flick each.
- **What it's for.** Stopping where you've seen something to paint. Arriving. Turning round: at Cruise the bus turns on the spot. And making whoever is on your tail fly past.
- **What it can't be mistaken for.** The stick's pull to climb starts on the bus's lane; this starts above it. A look that happens to go down is slower. The pan a long stroke begins is put back when the stroke turns out to be the swipe.

## 6. The camera

The turn and the camera change together: a bus that turns twice as hard under today's camera only swings off the screen.

- It follows the way the bus is going, not its nose.
- Its turn keeps up in the hard part of the stick: today it trails a full turn by about 15 degrees.
- It looks a little into the turn.

## 7. Solid before it's flown

In Node, on the real flight code (`tools/controls-sim`, `tools/feel-sim`), each a row that fails when its rule is broken:

- **The table of section 2,** measured: half a turn's time and width in every gear, smooth, hard and skidding, at 30 and at 60 frames a second, the two within 3 % of each other.
- **Smooth is today's.** The same thumb, inside 78 px, flies the same line as today in every gear.
- **The skid:** the slip never over its cap; grip within 0.4 s of easing off; never under 20 m/s; the gear never changed; a thousand skids at random over the city, none ending in a building.
- **The swoop:** the reversal's time at Cruise, Express and Jet; the turn never over three times its flat rate.
- **The swipe:** to Cruise from every gear in under 0.8 s; nothing from Cruise; and the gesture table's rows all still pass, so a flick is still a flick, a look still a look and a pull still a climb.

Then the phone, which beats all of it.

## 8. Who builds it

The flight, the stick and the camera are the first account's (`src/game/Flight.ts`, `Input.ts`, `CameraRig.ts`), and this is theirs to build properly.

So the producer can feel it sooner, the second account can build a stand-in behind a link, `?swerve`, without editing those files: the extra turn and the slip laid over the flight after its own step, from the thumb's raw travel (`Input.state.anchor` and `finger`), the speed scrubbed and given back, and one call in `main.ts` to run it. What the phone likes then goes into the flight itself.

## 9. What it changes in the rulings

If approved.

| Today | With this |
|---|---|
| "A quick flick up or down is one gear, anywhere. No double flicks, no left or right swipes, no tilt" (CLAUDE.md, "Controls") | All still true. One gesture more, the producer's: the long swipe down to Cruise |
| "Speed and climb never grow with height. Going faster is the gears' job" (CLAUDE.md, "Flight") | Still true. A skid costs speed and the gear gives it back |
| The stick ends at 78 px (`config.flight.stretchPx`) | It goes on: hard to about 120 px, the skid past it |
