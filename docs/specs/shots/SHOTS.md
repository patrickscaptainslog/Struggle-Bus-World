# Shots, lock-on and the ride

The plan for the producer's seven notes of 2026-11-06, written by the studio's design team (four designers, a synthesis and an adversarial reading) and **approved by the producer on 2026-11-06**: "Everything in the doc is excellent", and of the four extras: "I love all 3 of your suggestions - bellyflop waterfall and especially sonic boom - go for it! Parade feature is also brilliant." Every decision in "Your decisions" below is approved as picked. Where an older doc or ruling disagrees, this wins; `CLAUDE.md`'s "Shots" block lists the rulings it changes.

The producer's notes, word for word, are in `CLAUDE.md`'s "Shots" block. This file is a copy of the doc the producer approved, with "Who builds what" added for the two accounts.

## Who builds what

The order table in "What it changes, what it costs, the order" holds, with one change: the bigger splat's own part (its size, in `Splat.ts`) moves to the first account, so only one account edits the shot code. The second account keeps the movers inside it.

**One account edits each file.** A change the other side needs goes in as a small named hook, said in `docs/TODO.md`; anything bigger is asked there first.

| Account | Branch | Owns | Builds, in this order |
|---|---|---|---|
| First (the laptop with the GPU) | `feat/shots`, cut from `feat/factions` | `src/game/` (Splat, Aim, Flight, Input, Controls), the camera, `src/fx/`, `src/world/`, `src/ui/`, and `main.ts`'s shot and flight lines | MEGA off and the faction button; the rooftop gardens' budget; the bigger splat (85 m, calling `life.blast` with its whole circle); hold to aim and the Hose; the probe and the Comet; the Bomb (behind its link until the producer's grip test); Streak and the tap's feel; Lob, Cloudburst and School Zone; Sonic Boom, Belly Flop and Waterfall; Curb's street camera preview, then its flight, camera and landing |
| Second (the cloud) | `feat/life` and `feat/recess` | `src/life/`, `src/recess/`, `src/factions/` | Life: the parks from 9 am; every mover inside a splat's circle painted; lock-on targets for boats and planes, the Torpedo's boat side and the plane ribbon; Curb's road side (a lane the bus rolls on, pacing the car beside it, as an API the first account's Curb calls); Parade. Recess: B21 (a match keeps its paint to itself); the freezes and the paint agreeing (M22, M23); Recess you can find; being hit, made loud (the forced gear both ways behind a link); then, on hold to aim, the rival lock, the white window, the dodge and the incoming marker |

**The hand-offs.**
- **Hold to aim** is the first account's. When it's pushed on `feat/shots`, `docs/TODO.md` says so with its hook (what's under the finger, how long it's held, the release). The second account merges `feat/shots` and builds lock-on and the duel on it.
- **The bigger splat** calls `life.blast` with its whole circle. The second account's movers-inside answers it, and either side can land first.
- **Curb**: the second account's road side gives the lane and the pace as an API; the first account's flight, camera and landing call it.
- **Merges**: each account merges `feat/factions`, `feat/shots`, `feat/life` and `feat/recess` into its own branches as it needs them. `main` stays the producer's.

**Reviews.** Each step is read adversarially inside its own run and checked on what it can be checked on (the first account's on the GPU). The other account's review comes before anything goes to `main`, as `CLAUDE.md` says.

**What the producer flies next.** Each account's evening report in `docs/TODO.md` gives the preview links and what to try.

## In one minute

We agree with all seven notes, and we'd build every one of them. What your thumb does and what the bus is doing will choose the shot, with no menu and no new button. Tap to splat, hold to aim, hold the bus to charge.

- **Recess.** You saw no one because the screen shows only 12° either side of your nose and the captains started 30° off it, 780 m away. The fix is a wider view in Recess, captains starting ahead of you, a kickoff that shows them, and markers at the screen's edge.
- **The duel.** You hold on their bus to lock and charge, and lift to fire a blob that homes in. In its last 0.7 s it turns white-hot, and a hard turn or a flick beats it.
- **Being hit.** Their colours flood your bus, it does a barrel roll and gets flung, and it's forced into a fast gear. The steering stays yours.
- **The shot.** In turbo it flies ahead and lands about 1.5 s in front of you, where you can see it. Every shot paints the block, and the cars, people and boats inside it.
- **Modes.** The Hose, the charged Bomb that jumps houses two or three stages, the Lob into the distance and the Torpedo all come from how you hold and where you point.
- **Lock-on.** Hold your finger on a ferry, a plane or a bus and the lock sticks to it, however it moves.
- **The slow gear.** School Zone, one flick below Cruise, hovers like a blimp and turns on the spot.
- **The street.** Fly low over a road and the wheels touch down beside the cars, with no steering. A flick up takes off again.
- **MEGA comes off now, and testers get a faction button** on links ending in ?crew.

**What we'd build first.** Day one is MEGA off and the faction button. Then come the rooftop gardens' triangle budget, which Recess already breaks, and the bigger splat. After those come a Recess where you can find the captains, and turbo shots you can see.

**What we'd push back on:**
- no real loss of control when you're hit, even for half a second;
- no paint trail everywhere, only on the street;
- a Bomb never lifts a square past stage 3, the streets;
- splats get bigger, but each tap still climbs one level;
- no lane changes on the street.

It costs about 44 agent-days with reviews, or about 23 days with both accounts working at once. Two questions come before the Bomb: is "the bomb you like" today's tap splat, and what about MEGA shouldn't come back?

## The shot, reworked

Every shot now lands where you can see it and paints the whole block it hits. In turbo it flies ahead of the bus and lands about 1.5 s in front of you. At Turbo 3 today it lands 120 m ahead and you pass it in 0.13 s.

The splat's radius grows from 60 m to 85 m at roof height (170 m across; corrected 2026-11-06, it said "across", but the 60 m was always a radius). It paints every car, person, picnic and boat inside it. A shot that hits a car or a ferry paints the block around it too, so you never aim at one car again.

You never pick a mode from a menu. A tap splats, shaped by what the bus is doing: fast, nose up, nose straight up, over water or on the street. A still hold aims instead: on your bus it charges a Bomb, on a boat, plane or bus it locks, and on the city it's a hose.

**Your thumb and what the bus is doing choose the shot: no menu, no new button.**

| What you're doing | The shot | What it does |
|---|---|---|
| Tap at Cruise or Express | Splat | Paints the block, and the cars and people in it |
| Tap at Nonstop or faster | Comet | Flies ahead, lands 1.5 s in front of you |
| Tap with the nose 25° up | Lob | Arcs up to 1.6 km into the distance |
| Tap with the nose past 70° | Cloudburst | Rains on a 220 m circle for 3 s |
| Tap that lands on water | Torpedo | Runs at the nearest boat |
| Hold your thumb on the bus, lift | Bomb | Houses jump two or three stages |
| Hold on a boat, plane or bus | Lock-on | Lift to fire a shot that homes in |
| Hold on the city | Hose | Pours under your finger; drag to sweep |

## The modes

Each mode comes from a gesture you already make, or from where the bus is pointing. There are no switches and no new buttons.

| Shot | How you fire it | What it does | Why it's fun |
|---|---|---|---|
| **Splat** | Tap at Cruise or Express | Paints an 85 m circle and every car, person and boat in it | One tap takes the block, not one car |
| **Comet** | Tap at Nonstop or faster | Streaks ahead and lands about 1.5 s in front of you, up to 1.9 km out. A 200 m pillar of paint light rises there, and you fly through the spray | You see your hit while still in turbo, and the boom arrives late |
| **Hose** | Hold your finger still on the city | Pours 40 m blasts under your finger; drag to sweep. A 3 s tank, then a 3 s refill | It's the firehose, aimed with your finger |
| **Bomb** | Hold your thumb still on the bus, then lift | At 0.6 s, +2 stages and 1.4 times wider. At 1.2 s, +3 stages and 1.8 times wider | Houses pogo once for each stage they jump |
| **Lob** | Tap with the nose more than 25° up | Arcs into the distance, 1.6 km at 45°, and a dotted ring shows where it will land | A star climbs, then a pillar rises over the skyline |
| **Cloudburst** | Tap with the nose past 70° up | Bursts 150 m above you into a cloud that rains on a 220 m circle for 3 s | You make your own weather |
| **Torpedo** | Tap so the shot lands on water | Runs along the surface at the nearest boat within 300 m. With no boat, it skips twice and splashes | Water stops being a miss |
| **Paint trail** | Roll on the street | Your lane paints itself behind you | Lazy painting, the easy way |
| **Drive-by** | Tap on the street | Paints the car beside you and the house fronts on the side you're looking at | Painting the traffic up close |
| **Streak** | Fresh blocks within 2.5 s of each other | Each hit plays a note up the scale and grows the splat 8 %, up to 1.4 times at five hits | Rhythm between targets |

**Three more from the team, after the rest:**
- **Belly Flop.** Dive more than 50° down above 60 m/s and tap as you pull out: a shockwave paints the ground under you.
- **Waterfall.** A hit on a tower above 40 m runs down the wall as drips and pools in the street.
- **Sonic Boom.** The flick into Turbo 3 drops a 120 m ring of paint, at most once every 10 s.

A fourth, **Parade**, has cars you paint from the street honk and fall in behind you, up to six.

**How they fit together:**
- **One belly.** The tap, the Bomb and the Hose share it. It refills 1.6 s after a tap, 3 s after a Bomb II and 4.5 s after a Bomb III.
- **When two shapes apply.** If you're fast and nose up at once, the longer of the Comet and the Lob wins.
- **The Hose covers, the Bomb climbs.** A pour raises each building at most one level.
- **Writing your name.** That needs about a 6 s tank, so your phone decides between 3 and 6 s.

The tap gets a feel pass at Cruise and Express too, since it's the shot you fire most. The wind-up, recoil, freeze and sound will grow with how much each shot took.

**What we'd push back on:**
- **The full show is kept for rare moments.** The pillar, the lens spray and the late boom play in full on your first Comet in a while and on streaks; the rest get a lighter version.
- **A Bomb never lifts a square past stage 3, the streets.** The Lift and the gods stay earned by aimed hits.
- **No trail in the air.** It would out-paint every aimed shot. In turbo you get a contrail in your colour that only looks.
- **Each tap still climbs one level, however big the splat.**

"Torpedo mode" may have meant a fast straight shot. If so, that's the Comet, and the water shot keeps its own name.

## Lock-on

Hold your finger still on a ferry, a sailboat, a cargo ship, a plane or a rival bus, and you lock onto it. It's the same hold as the Hose, and what's under your finger decides which you get.

- **Picking.** The nearest mover within 48 px of your finger is picked, or within its drawn size plus 16 px. A plane that's only a dot still catches.
- **The lock sticks to the target, not your finger.** It holds while your finger stays down, until the target leaves the screen or a building hides it.
- **The lock.** It clacks at about 0.55 s and the target glints in your colour.
- **Lift to fire.** A blob homes in. Boats and planes can't dodge it; buses can.
- **Lift early** and you get a plain shot that homes weakly. Nothing is wasted.
- **The lock holds 4 s,** so your next taps go to the same target.

| Target | Range | What a hit gives |
|---|---|---|
| Ferries, sailboats, cargo ships | 1.5 km | The whole hull, the deck, and the wake in your colour for 30 s |
| Planes | Anywhere on screen, out to 12 km | A ribbon of your colour across the sky for 60 s, seen from the whole city |
| Rival buses | 900 m | Possessed (PvP Recess, below) |

A shot at a plane flies fast enough to arrive in under 4 s. At the normal shot's speed, 12 km would take 28 s.

Cars and people need no lock, because the bigger splat takes them.

**Two limits.**
- **Low in your lane.** A target there can't be held, because a touch there flies the bus. The tap already hits whatever is under you.
- **The bus flies straight while you hold.** With one thumb on the target, nobody steers: up to 1 s for a lock, or up to 945 m at Jet. A second thumb in the lane still flies.

The first time a boat is in reach, a one-time hint says HOLD TO LOCK.

We couldn't check how high the live planes fly, so we don't know yet whether 12 km covers them all.

## PvP Recess

You saw no other bus because the screen shows only 12° either side of your nose. The captains started 30° off it, 780 m away, flying twice your speed. We fix the view first, then build your charged shot, the dodge and a hit you can't miss seeing.

### Seeing them

- **A wider view in Recess.** It goes to about 40-45°, from today's 24°. The city keeps its view.
- **The camera pulls back** when a rival is within 900 m, so you both fit.
- **A closer start.** Both captains start ahead of you, inside 10° of your nose, about 500 m away.
- **The kickoff.** At the bell the camera starts high behind you with both captains in frame, under banners in their colours. It swoops down to the chase view in 2 s.
- **Captains fly your ladder.** Today they fly Cruise at 60 m/s, twice your 30, and the match's brain flies you at 60 too. Their flight and yours will follow the real flight.
- **Easier to see.** Captains are drawn 1.4 times bigger, with a 4 s ribbon of their paint behind them.
- **Edge markers.** An off-screen captain shows as a chevron in its colour at the screen's edge, with the distance. A shot coming at you from off screen shows as a white chevron.
- **The fence.** The 750 m edge shows as chalk bubbles and bounces you back in with a boing. Today rides wander out to 1.13 km.
- **First contact within 10 s.** The easiest captain locks you at about 4 s and fires at about 5 s, with the longest dodge window. Your first duel is a dodge you win.

We'd shrink the arena only if it still feels empty on your phone.

### Charging your shot (your idea)

1. Hold your finger on their bus. A ring snaps on and closes, and locks with a clack at about 0.55 s.
2. Keep holding to 1.0 s for a full charge: a bigger, faster blob that's harder to dodge.
3. Lift to fire.

The range is 900 m, on screen, and buildings block it. They see it coming: a rising tone, your chevron flashing, a thin line in your colour from you to them, and your bus glinting.

### Dodging (your idea)

The blob homes in with a limited turn. For its last 0.7 s it goes white-hot and stops steering.

- **What beats it.** In the white, a hard turn or a flick either way. A flick also lunges you 40 m forward, or brake-hops you if it's down; a gear change alone would move you only about 10 m in time.
- **In the white, a flick dodges and never shifts gear.** So a flick from Cruise can't drop you into a hover or onto the street.
- **Too early fails.** Break before the white and it locks back on.
- **A full charge** shortens the white to 0.45 s. A turn isn't enough then, but a flick still is.
- **The shooter's answer.** After a dodged full charge, the lock stays on for 2 s, so the shooter's next tap homes in. Dodging twice in a row is the skill.
- **A whistle** rises over the last second.
- **Targets.** About 95 % of shots hit if you do nothing, and about 15 % if you dodge in time. The captains dodge 30 %, 55 % or 75 % of the time, by level.

The sideways hop goes. Measured, it only worked for a fifth of a second.

### Being hit

1. **Freeze.** Your screen and theirs freeze for 5 frames with a GULP. You read NO BRAKES; they read GOTCHA.
2. **Flood.** Their colours wash over your bus from the point of impact, front to back, in 0.3 s.
3. **Fling.** The bus does one barrel roll with a wobble over 0.8 s. It's thrown 35 m up and 60 m along the shot's line, with a camera shake, speed lines and the horn honking by itself.
4. **Ride.** The gear is forced. Your body rolls on each beat of their music, which plays over yours.
5. **End.** The colours drain off the back in 0.6 s and the bell goes ding-ding. The stop arm swings out for 4 s of shield, and your next hold on the bus arms a Bomb III at once.

**The forced gear, both ways on your phone.** Ours is Nonstop, because Jet crosses the arena in 3.3 s. You asked for turbo, and to you that's Jet, so we'll build that too. There, the fling climbs to the 150 m Jet needs, and the fence's boing may be exactly the "forcibly propelled" you described.

**The steering never leaves your thumb.** The roll is the bus's body; its path stays yours. A real loss of control, even for half a second, would break the first rule of a hit and make people sick at these speeds.

**Only aimed shots possess.** A rival caught inside a block's splat gets a splash of paint for show, with no Possessed and no lost time. Otherwise one big circle would skip the lock and the dodge. The city's buses get painted like any car.

### Fixes first

- **The freezes.** Captains hitting each other freeze the game today, 10-14 s of a match. Only hits involving you will freeze your screen, at most 2 s a match in all, and the match clock never stops.
- **The paint.** The paint on screen will follow what the match counts.

**Cost:** about 9.5 days, second account.

## The slow gear and the street

A new gear below Cruise lets you hang over one block. One more step down puts the wheels on the street beside the cars.

### School Zone: lingering

- **Getting there.** Flick down from Cruise. A school bus slows to 15 mph in a school zone; the stop arm stays the shield.
- **Thumb off.** It eases to a hover in about 1.5 s and bobs like a blimp.
- **The stick works as in every gear.** Sideways turns, now on the spot, a full turn in about 5 s, so you can face any block. Up noses down and drifts forward at up to 8 m/s; down climbs.
- **The climb.** At the ruled 40 m/s, climbing from a hover feels like a rocket. Our pick is a gentler climb, about 15 m/s, in School Zone only; that bends a ruling, so it's yours to call.
- **The camera** comes in 30 %.
- **Paint balloons** in your colours pop out of the roof hatch with a squeak. They burst into spatter when you flick out.
- **What lingering gives.** A square takes about 16 s to cross, time for several hits 5 s apart. We'll check that against the ladder before promising a square's four stages in one pass.
- **In Recess** it's the riskiest gear. A turn moves you too little, so you have to flick to dodge.

**Cost:** 1.5 days, first account.

### Curb: cruising beside the cars

**Getting on is flying.** Dive to street height over a road at School Zone, Cruise or Express and hold it there half a second: the wheels touch down. You can also flick down from School Zone over a road. Faster gears never land, so skimming the rooftops at speed stays safe.

- **Landing.** The bus arcs onto the nearest right-hand lane within about 80 m, never in a tunnel, and the tyres chirp.
- **No road nearby.** The bus bounces and says FIND A STREET.
- **Getting off.** Flick up or pull back and the wheels go up.
- **The hint.** The first time you fly low over a road, a one-time hint says LAND ON THE STREET.

**Rolling, with no steering.**
- It rolls at the traffic's speed and pulls up beside the nearest car.
- Push up to roll on to the next car; let go and it paces the one beside you.
- At a junction it goes straight, or the way you're looking.

**Painting.**
- Your lane paints itself behind you.
- A tap is a drive-by on the car beside you and the house fronts on the side you're looking at.
- Riding beside a car for 1.5 s paints it.
- The Hose pours out of the window.
- Bridge decks count as street.

**PvP on the street.** Walls block locks, so a hunter has to come down to your street. A flick up hops you off it, which beats the white. Being possessed throws you off the street.

**What we'd push back on.** No lane-change swipe: it's too close to "no left or right swipes", so the bus picks the lane beside a car itself.

**Bare streets.** Curb uses the road map the cars already drive and adds no street art, but streets are on hold. From 4 m up they'll likely look bare. We'll spend half a day on a camera at street height first, so you can see it before deciding on street surfaces.

We couldn't check that San Francisco's road maps load in the Recess build, which Curb needs.

**Cost:** 6.5 days: 3 for the road side (second account), 3.5 for the flight, camera and landing (first account).

## MEGA off, and the faction button

MEGA comes off on day one, as you've ruled, and nothing of the factions' art is lost. Its code stays asleep, back with one link if you ever want it. Its pouring code becomes the Hose.

| Faction | MEGA's look becomes its Bomb III | Its firehose becomes its Hose |
|---|---|---|
| Team Super Rainbow | Big Bang | Wellspring |
| Atlantis | Great Wave | Waterspout |
| The Elderwood | Wildgrowth | Beanstalk |
| Hyperglow | Strike | Tesla coil |
| Inferno | Meteor | Fire tornado |

Each faction also gets its own Comet and Torpedo, in its palette and shapes.

**Two questions before the Bomb is built:**
- Is "the bomb you like" today's tap splat, or MEGA's blast? We read it as the tap.
- What about MEGA shouldn't come back in the Bomb: the button, the 10 s charge, the 60 s wait, or the hose going off by itself? Our Bomb charges in 1.2 s, waits 4.5 s and never fires by itself.

**The faction button:**
- **What it is.** Your faction's crest at the top left, at least 44 pt, inside the top safe area and outside the bus's lane.
- **Using it.** A tap opens five swatches, and a tap on one switches at once.
- **Paint.** New paint is the new faction's; old paint keeps its owner.
- **Who sees it.** Only links ending in ?crew, remembered on that phone. Testers skip "start as Rainbow; join another after your first Wonder".
- **In Recess,** it works only between matches.

**Two limits:**
- The Lift only lifts Rainbow on Rainbow today, so the other four won't float houses until that's widened.
- If the factions' colours are fixed when the shaders compile, all five get warmed up at load, so nothing compiles in flight.

We haven't checked either that limit or whether the top left of the screen is free.

**Cost:** 1 day, first account.

## What it changes, what it costs, the order

The plan touches 16 of your rulings and approved picks, quoted below, and keeps the rest; your approval rules each change. It costs about 44 agent-days with reviews, or about 23 days with both accounts at once.

### The rulings it changes

| Today's ruling | The change |
|---|---|
| "Only a touch landing near the bus flies it, and one landing anywhere else looks" | A finger off the lane that moves still looks. Held still for 0.35 s, it aims, and a still hold on the bus itself charges a Bomb while still steering |
| "Gestures stay hidden, with one brief hint on the first run." | The first-run hint adds HOLD TO AIM. Three one-time hints come in context: the first boat in reach, before the first Bomb, the first low pass over a road |
| "No new button, joystick or gear strip." | Only the testers' faction crest, already your exception. The chevrons and rings are marks, never touched |
| "Paint is the only saturated thing in the world, and there's no brown." | The marks use paint's colours, and the ribbons and balloons are paint |
| "One ladder: Cruise, Express, Nonstop, Jet, Turbo 1, 2 and 3." | School Zone and Curb go below Cruise, still one flick per rung |
| "The way up is a plain climb of 40 m/s or a gear" | A gentler climb in School Zone only, if you agree |
| On hold: "streets and highways (but for freeway surfaces, which the cars need...)" | Curb rides the cars' road map with no street art; street surfaces stay your call |
| "A rival bus within 600 m and nearly dead ahead glints" and "A flick then hops them sideways." | Hold to lock out to 900 m, the white window, and no hop |
| "Each glints you for a full second before it breathes at you" | A captain's charge is the warning: the tone, the line and the glint |
| "Possessed as what a splat on a bus does" | Only a shot aimed at that bus possesses; a block's splat only splashes it |
| "2 Roofs ... an aimed hit, at least 5 s later" | A Bomb jumps two or three stages at once, never past stage 3 |
| "One full MEGA from 300 m up claims about 19 squares at once" | Recomputed for Bomb III |
| "Your super-splat comes back ready." | Your next hold on the bus arms a Bomb III at once, one time |
| "the Great Wave as its MEGA" and "The beanstalk as the Elderwood's firehose." | They become Bomb III and the Hose, for all five factions |
| "each drop the hitter catches is a tenth of a MEGA" | A tenth of a Bomb's charge |
| "start as Rainbow; join another after your first Wonder" | Testers on ?crew links skip it |

**Kept as they are:** "Speed and climb never grow with height", "No double flicks, no left or right swipes, no tilt", the steering never lost, the forced gear when hit, and "Nothing compiles in flight".

**The budget has to hold.** Recess already reaches 4 M triangles at the bell against a 1.5 M ceiling, and 221-234 draws against 200. In play, frames went from 17 to about 50 ms. Bigger splats and Bombs make more rooftop gardens. So the GPU check must hold 1.5 M triangles and 200 draws at every frame of a full match, paint at its densest. Every new effect is warmed up at load, about 10 more draws in all.

### The order

Each step is flown on a preview link and reviewed by the other account, about a quarter day each.

| Days | Step | Who | Agent-days | You fly |
|---|---|---|---|---|
| 0-1 | MEGA off, faction button | First | 1 | Day 1: no MEGA, any faction |
| 0-2.75 | Captains stop freezing the game, then the bigger splat | Second | 2.75 | Day 3: bigger splats, cars and people included |
| 1-3.5 | Rooftop gardens' budget, checked on the GPU over a full match | First | 2.5 | Nothing new to see; smoother Recess |
| 2.75-7 | Recess you can find: wider view, start, kickoff, chevrons, fence, captains on your ladder | Second | 4.25 | Day 7: Recess with rivals in view |
| 3.5-7 | A probe that checks every gear, then the Comet | First | 3.5 | Day 7: turbo shots in view |
| 7-9 | Being hit, made loud | Second | 2 | Day 9: the flood and the fling |
| 7-10 | Hold to aim and the Hose | First | 3 | Day 10: the Hose |
| 9-12 | Lock-on for boats and planes, Torpedo, plane ribbon | Second | 3 | Day 12: ferries and planes |
| 10-12 | Bomb, after a test with your grip | First | 2 | Day 12: the Bomb |
| 12-14 | Streak and the tap's feel pass | First | 2 | Day 14: a better tap |
| 12-15.25 | Rival lock, the white window, the dodge test, the incoming marker | Second | 3.25 | Day 15: the duel |
| 14-18 | Lob, Cloudburst, School Zone | First | 4 | Day 18: nose-up shots and the hover |
| 15.25-18.25 | Curb, the road side | Second | 3 | (with the next step) |
| 18-21.5 | Curb: street camera preview, then flight, camera and landing | First | 3.5 | Day 21.5: the street |
| After | Belly Flop, Waterfall, Sonic Boom | First | 3.5 | |
| After | Parade | Second | 2 | |

**Totals:**
- The core build is 21.5 days for the first account and 18.25 for the second.
- Reviews add about 4, out of the other account's days, so about 23 days with both at once.
- The three ideas after, plus Parade, add 5.5, for about 49 in all.

## Your decisions

1. **Shots chosen by your thumb and the bus, not by a menu.** Pick: yes. It adds a mode without adding a button.
2. **Is "the bomb you like" today's tap splat?** Our reading: yes, the tap. The Bomb is built on that answer.
3. **What about MEGA shouldn't come back:** the button, the 10 s charge, the 60 s wait, or the hose firing by itself? Pick: none of them come back. The Bomb charges in 1.2 s and never fires by itself.
4. **Hold to aim.** A tap is up to 0.3 s and a still hold from 0.35 s aims; in between counts as a tap. Pick: yes. Taps get a little quicker than today's 0.45 s, and your phone tunes both.
5. **The Bomb: hold your thumb on the bus itself.** It gives +2 stages at 0.6 s and +3 at 1.2 s, never past the streets. Pick: yes, after a test with your grip. That keeps a resting thumb from bombing.
6. **Bigger splats.** 85 m, with every car, person and boat inside painted, and each tap still one level. Pick: yes. You get area without skipping the ladder.
7. **Recess you can find.** A wider view, captains ahead of you, the kickoff and edge markers. Pick: yes. It's why you saw no one.
8. **The duel.** Hold to lock and charge, the white window, and no hop. Pick: yes. It's your idea, with a dodge you can feel.
9. **Being hit.** The colour flood and one barrel roll, with the steering always yours. Pick: yes. It's loud without making anyone sick.
10. **The forced gear when hit.** Pick: try both on your phone, Nonstop and Jet. You said turbo; we worry Jet crosses the arena too fast.
11. **Only aimed shots possess a rival.** Pick: yes. Otherwise one big splat skips the duel.
12. **"Torpedo mode".** Did you mean a fast straight shot? Pick: that's the Comet, and the water shot that runs at boats keeps the Torpedo name.
13. **Curb, landed by flying low over a road.** No steering; your look picks the turn and there's no lane change. Pick: yes. Landing comes from flying, like the shots.
14. **Street surfaces.** Curb rides the cars' road map, but streets will likely look bare from 4 m up. Pick: see the street camera preview, then decide.
15. **School Zone, a hover below Cruise, with a gentler climb.** Pick: yes, about 15 m/s there only. At 40 m/s, climbing from a hover feels like a rocket.
16. **The paint trail on the street only, with a contrail in turbo.** Pick: yes. A trail everywhere would out-paint every aimed shot.
17. **Painted cars keep their colour 60 s.** Pick: yes, so a painted jam drives away; the block keeps its paint. It sits close to "a hit costs time, never paint", so it's yours.
18. **MEGA's looks become Bomb III and the Hose for all five factions.** Pick: yes. Nothing of the faction art is lost.
19. **The faction button on ?crew links.** Pick: yes, on day one. You and your friends can test all five now.
20. **The gardens' budget first, 2.5 days you won't see.** Pick: yes. Recess already breaks the triangle ceiling, and everything that paints more makes it worse.
21. **Three one-time hints in context,** beyond HOLD TO AIM on the first run. Pick: yes. The modes stay hidden until the moment they're useful.
