# PvP, rethought

The second account, 2026-11-10, for the producer. Nothing here is ruled until the producer says so. It answers this, after the producer flew the duel on `feat/recess` and `rc/1`:

> "The pvp is so so bad. Like really bad. We need to do a deep dive analysis on how to make this playable and fun. I don't even know what's wrong. 1) I think holding onto the other car is the wrong idea. 2) I need to be able to maneuver easier, especially turning left and right harder. Any creative ideas hear would be much appreciated"

Both notes are right, and they point at the same thing. The short of it:

- **What's wrong:** the fight happens where you can't see it, your thumb is asked to be in two places, and the bus can be fast or nimble but never both.
- **What to build:** you aim with the bus, not with a finger; a match has its own handling, with a hard turn that is a move and an attack; nothing can hit you from off your screen; a hit is loud and costs seconds, not your bus; and a chase is for something, the wet paint the other bus is carrying.
- **How:** a playground first. You and one rival, no rules, the new handling, on your phone, before anything is built round it.

Two independent reads were asked for, with the facts and without this proposal. Section 8 has what they changed.

## 1. What's wrong

From the game's own numbers, and from whole matches of Recess's brain flown in Node (`node --no-warnings tools/recess/feel.mjs` on `feat/recess`: 120 three-minute matches a pilot, the player's bus flown by the game's own pilot at its best and at its worst). Simulated: no thumbs, no phone, no picture. "On screen" is geometry, the match's 41.7 degree lens and the lock's 900 m.

**1. You fight buses you can't see.**
- A rival is on your screen 36 to 42 % of a match. Both at once, 6 %.
- They aren't far. The nearest is within 300 m half to two thirds of the time. But when it's that near it's on your screen only 27 to 34 % of the time: off to one side 27 %, behind you 39 to 45 %.
- Each time one comes onto the screen it stays 1.2 to 1.4 s. A quarter of the time, under 0.6 s.
- So the game tells you about the fight with arrows and words at the screen's edge, where it should be showing you the fight.
- Part of this is the hold itself. Nothing asks you to point the bus at a rival, and the camera looks where the bus points.

**2. The hold asks your thumb to be in two places** (your first note).
- The thumb that steers is under the bus. The rival is up the screen. Lift to hold on it and the bus stops turning and flies straight at 30 m/s while you aim.
- The hold needs 0.55 s on a bus that is on screen about a second, and gone in under 0.55 s one time in four.
- Your finger covers the bus you're aiming at.
- A rival dead ahead and within about 100 m sits in the part of the screen where a touch steers. So the better you fly, the less you can lock.

**3. Fast or nimble, never both** (your second note). At full stick, from the flight's own numbers:

| Speed | A U-turn takes | And is this wide | Of the arena |
|---|---|---|---|
| Cruise, 30 m/s | 2.3 s | 44 m | 3 % |
| Express, or the thumb pushed up, 112 m/s | 4.2 s | 302 m | 20 % |
| Nonstop, and every time you're hit, 225 m/s | 6.2 s | 890 m | 59 % |

- At Cruise the bus turns on a dime, but the arena takes 50 s to cross and nothing can be caught or run from.
- One flick up to go after somebody and the bus can't come round. The turn falls off with speed because the flight was made for sightseeing, where that is right.
- The steering sits on a soft spring, so it takes about a quarter of a second to bite. The camera's own turn lags the bus by about 15 degrees in a hard turn, so what you're turning toward is at the screen's edge or off it.

**4. Shooting punishes flying.** Every tap halves the bus's speed for the breath and its steering for about half a second. In a city that's a dragon planting its feet. In a fight it's a penalty for pulling the trigger.

**5. Dice and prompts where flying should be.**
- Your locked shot: the rival dodges it on a roll, 30 % of the time for a Learner, 55 % for a Rival, 75 % for a Veteran. Nothing you see or do changes it.
- Their shot: the screen says FLICK! and you flick. The first time it teaches. The tenth time it's Simon Says.

**6. A hit takes your bus away.**
- A ride is two bars at 225 m/s with no brakes, 5.7 s, then 4 s where you can't shoot.
- At that speed a U-turn is most of the arena, so "you keep the steering" is true and means nothing: you bounce off the fence until it's over.
- You're hit 1.1 to 1.8 times a minute. That's 17 to 28 % of a match with no brakes or no shot.

**7. Too many rules for three minutes.** Squares, gods, rings that close, cracks, seals, heals, rides, hiccups, stop arms, lessons. No one can say in a line how to win, so no one knows what to do next.

One more, about how we got here. The first time you flew Recess you "didn't see a single other bus", and holding on a bus was the answer to that. We then made the buses findable and built the hold, but never put the simplest version in front of your thumb first: two buses, nothing else, is chasing one fun? Section 5 fixes that.

## 2. What a fight needs

Six rules. Everything in section 3 comes from them.

1. **Your thumb never leaves the stick to fight.** Aiming is steering.
2. **Fast and tight at once.** A hard turn is a move you make, with a sound and a spray of paint, not a number that's a little bigger.
3. **Nothing hits you from off your screen.** What can hurt you is as close as what you can see. And your own bus is the one thing that's always on it, so what's coming at you shows on your bus: its colour, a shadow over it.
4. **Hits are earned and dodges are flown.** No dice. No prompts.
5. **A hit is a moment.** Loud, funny, over in three seconds, and the bus stays yours.
6. **One line to win.** Everything else waits until the fight is fun.

## 3. What I'd build

First numbers throughout. The phone changes them.

### Aim with the bus: the paint stream

- Point your bus at a rival. When it's in front of you and close (inside about 20 degrees of your nose, within about 180 m), a stream of your paint reaches out to it by itself.
- While the stream is on it, its bus fills with your colour, from the tail forward. That's its health, and yours: your own bus is your health bar, with no meter on the screen.
- Keep it in front of you for about a second in all and it's full: SPLAT.
- Nearer fills faster. Off the stream, the colour drains back slowly, so a second pass finishes what the first began.
- Getting away is flying: turn harder than the one behind you, slam the brakes so it flies past, or put a tower between you. The real city is the cover.
- No finger on the rival, no hold, no lock to learn. A tap is still a splat, for painting the ground.

It suits the phone. The screen is tall and narrow, so the game can show what's ahead and what's just behind, not what's beside. A chase is the one fight that lives on that line: the bus you're hunting is up the screen, and the one hunting you is at your tail, where its stream is already on your bus.

**The other way to finish, to try in the same playground:** the ring closes by itself as above, and a tap, or just letting go of the stick, throws a blob that really flies and really has to be out-turned. More of a shot, less of a chase. I'd try the stream first.

### A match's own handling

In a match, and only there:

- **Two gears, the ones you know.** Cruise and Express, a flick each way, as always. But a gear changes in half a second, not three, so a flick up is a dash and a flick down is the brakes. Nothing over Express in a match: no speed that can't turn. How fast each is, the phone says.
- **A sharp turn at full stick, at either gear.** A U-turn in about 2 s, where Express takes 4.2 today. The spring stiffer, so it bites at once.
- **The skid.** Pull the thumb to the end of its reach and the tail lets go. The nose swings round in about a second while the bus slides on the way it was going, broadside, tyres squealing in mid-air, a crescent of paint landing under the slide. So your nose, and your stream, are on a rival before your bus has turned. It sheds speed while it slides, grips, and pulls back up to its gear. From Express that's round in a second and a half and 100 m wide, where today it's 4.2 s and 300 m. This is "turning harder" as a thing you do, and no new gesture: you pull harder and it turns harder.
- **The puddle.** With a full belly the skid throws a wave of your paint off the outside of the slide, like a car through a puddle, over whoever is close beside you or on your tail. It spends the belly. Rivals are beside or behind you two times in three, and this hits them where they are: turning hard is itself an attack, and the answer to a bus on your tail.
- **Shooting costs nothing.** No stall and no steering cut in a match.
- **With the camera, not before it.** A bus that turns harder under today's camera only sweeps a rival across the screen sooner. The two change together.

### The camera

- **It follows the way the bus is going, not its nose,** a beat behind. So a skid shows: you see your own bus broadside, sliding.
- **It looks into your turn.** It leads a little where today it trails by 15 degrees, so what you're turning toward is on the screen.
- **It leans to the fight.** With a rival within a few hundred metres the view swings round the bus toward it: the one you're on first, else the one on you, else the nearest. 15 to 35 degrees to try, never fast, and never against your own pan.
- **A little wider and a little nearer,** so more is in the picture and the bus is as big as it was.
- **Behind you:** the bottom edge of the screen glows in the hunter's colour, and its horn comes from its side.
- The aim: the nearest rival on your screen 70 % of a match, for three seconds a time, where it's 34 % and one second today.

### Being hit

- Full of their colour: the picture holds for a frame or two, a burst, one barrel roll, and your bus is flung, on the screen, with the steering still yours.
- **A splatted bus is a paint bomb.** Where it's splatted a big splash of the hitter's colour lands on the city under it, and a fat stripe of it along the fling. That's the prize, both of you see it, and it's how a dogfight makes turf. (With wet paint, below, the prize is bigger: everything it was carrying.)
- Then the bus shakes it off like a wet dog, and it's yellow and yours again. One and a half to three seconds in all, for the phone to say. No forced gear, no "no brakes".
- Then a second or two when nobody can start on you again.

### The rivals

- **They say so first.** A rival honks and its stream shows on your bus before it counts. One hunter on you at a time.
- **They get away by flying.** A rival dodges by skidding, as you do. After a skid it puffs exhaust for a couple of seconds and can't skid again. You can see it, and that's your moment. No dice.

### The goal

One line: **most of the neighbourhood in your colour at the bell.** Paint it with your taps; take a chunk by splatting a rival over it. The gods' rings and cracks, the heal and the seal wait until the fight is fun, and come back as the finale if you want them. The statues stay where they are, as each crew's home.

### What a chase is for: wet paint

For step 2, and the idea I'd most like to try there. It came from the second independent read (section 8).

- **Your paint is wet until you fly it home.** Fresh paint glistens and doesn't score. Fly over your own statue and everything you've painted since goes solid: it's yours.
- **Catch a bus and its wet paint is yours.** Every wet square it was carrying flips to your colour at once, a whole swath of the city, for both of you to see. It's wet still: now you have to get it home.
- So the longer you stay out, the more you carry, and the more you're worth chasing. A bus fresh from home isn't worth the trouble. A bus with a dozen wet squares is the game.
- The gears get a job: paint out slow, run home fast. The statue, 300 m tall, is the one thing you can see from anywhere.
- One line: **paint it, and get it home before somebody catches you.**

The read's own version takes the paint by flying across it on the ground, not by catching the bus, as Paper.io takes a trail. That makes the target a wide stripe that stays still ahead of you, which this camera shows best, and it would forgive a slow connection between two phones. But your own wet paint is behind you, where this camera can't look, so you'd lose it to something you never saw. Catching the bus keeps the fight between buses, and keeps it on the screen. Both are worth a link.

### What a fight is like

Atlantis is ahead, cutting left over the rooftops. You pull hard, the tail kicks out, the tyres squeal. Your nose comes round onto it and your red reaches out. Its yellow goes red from the tail. It slams its brakes. You fly past, and now its blue is on your tail and your own bus is turning blue. You flick up, dash for the tower on the corner, and skid round behind it. The stream breaks. You come out the other side on its tail.

And with wet paint: you've six squares glistening along Fillmore and Atlantis on your tail, its blue creeping up your bus. You skid, the wave soaks it, it drops back. You flick up and run for the red statue on the hill. Over it: the six go solid. Now Inferno is crossing the park with nine.

## 4. More ideas

In the order I'd try them. None is needed for the playground.

- **Recess is a rotation of playground games.** Recess has more than one game. On the same handling, each a minute or so, each one line of rules:
  - **Tag.** One bus is IT and drips gold. Touch a bus with your stream and it's IT. Don't be IT at the bell.
  - **Keep-away.** One golden paint can. Whoever carries it paints three times as wide. Splat the carrier to take it. Everyone always knows where the game is: at the gold bus.
  - **King of the hill.** The god's heart is the hill: your squares count double while you're the only bus over it.
  - **Dodgeball.** The blob version of the fight, in a small ring.
  - **Musical chairs.** When a bell rings, be over your own colour or lose squares. Nobody touches a bus: you paint over the ground a rival is counting on, just before the bell.
- **Home turf.** Over your own colour the skid costs no speed. So painting ground is also making the ground you fight best over.
- **Paint tails.** In a match the bus trails a ribbon of its colour for a few seconds, a curtain of paint hanging to the roofs. Fly through a rival's and you're splatted. Then a tight turn is an attack: you cut across their nose. All steering, no aiming, and the ribbon paints the ground under it as it drips.
- **Leapfrog.** Drop onto another bus's roof and squash it into a splat of your colour: put your shadow on theirs and dive. The one underneath sees a shadow grow over its own bus, which is always on its screen, and swerves. It's the Belly Flop, on a bus.
- **Bumper buses.** A dash into a rival's side or tail splats it. Nose to nose, both stop arms clang and both bounce.
- **The stop arm bats it back.** Tap as a blob reaches you and the STOP arm swings out and sends it home. Two good players get a rally, faster each time.
- **Water balloons.** Balloons of paint hang over a few rooftops. Fly through one and your next tap is something big.
- **The draft.** Sit close behind a rival and you're pulled along faster, so getting on a tail gets easier the closer you dare.

## 5. The plan

**Step 1: the playground.** A link, `?recess&toy`. You and one easy rival in a small ring over the city. No clock, no squares, no gods, no score. In it: the match's two quick gears, the sharp turn, the skid, the camera, the paint stream, the short hit. And links to compare on the phone, as `&hit=nonstop|jet` was:

- `&aim=stream` or `&aim=blob`;
- `&turn=now`, `sharp` or `skid`;
- `&cam=now` or `fight`;
- `&wave=0` for the skid with no puddle.

It starts with a rival that only runs, and nothing coming back at you. **How you'll know in five minutes:**

- you catch it ten times in two minutes with nothing explained;
- your thumb never reaches up the screen for it;
- you flick up to go fast, by yourself, and still get round;
- you skid a doughnut for no reason.

Two of those missing and the handling is wrong, and that's put right before anything is built on it. Then the rival fights back. Nothing else is built until chasing one bus is fun for a minute.

**Step 2: the match.** The winner goes into three buses over a neighbourhood, 90 seconds in a circle about 1 km across to start: turf and the bell, with wet paint on one link and plain turf with the paint bomb on another. Captains that paint out and run home, chase tails, skid and brake, and never roll a die.

**Step 3:** the gods as the finale, or the first of the playground games from section 4. Your call then.

**Who builds it.** The match is the second account's (`src/recess`). The flight, the stick and the camera are the first account's. The playground can be built without touching them: a match already sets the lens through the camera's own hooks, already takes the flicks (`controls.flickGate`), and can set the flight's numbers for as long as it lasts and put them back at the bell. What's liked then goes into the flight and the camera properly, by the first account, as hooks.

## 6. What it changes in the rulings

If approved. Until then they stand.

| Today | With this |
|---|---|
| Lock-on: a still hold on a boat, a plane **or a bus** locks (CLAUDE.md, "Shots"; SHOTS.md, "Lock-on") | Boats and planes as they are. A bus is aimed at with the bus |
| The duel: hold to lock and charge, a white window when a hard turn or a flick dodges it (SHOTS.md) | The stream, or the blob that has to be out-turned. No window, no FLICK! |
| "A quick flick up or down is one gear, anywhere" (CLAUDE.md, "Controls") | Still true. In a match the ladder stops at Express, and a gear changes in half a second |
| Being hit: the flood, a roll, a fling, the forced gear, Nonstop or Jet (SHOTS.md); Possessed for two bars (FACTIONS.md section 6, decision 3) | The flood, the roll and a fling, then the bus shakes it off: 1.5 to 3 s, at your own speed. No forced gear |
| "Captains fly your ladder" (SHOTS.md) | They do: Cruise and Express |
| Three minutes in a 1.5 km circle, the gods and their rings in every match (FACTIONS.md) | 90 seconds in a circle about 1 km across to start, for the playground and the phone to change. The statues stay, as homes; the gods' rules wait |

No new button, joystick or menu. One thumb is enough for all of it.

## 7. The numbers behind section 1

`node --no-warnings tools/recess/feel.mjs 120` on `feat/recess` prints them again. It asserts nothing; it measures.

- **Turns:** `config.flight.maxYawRate` 1.35 rad/s at 30 m/s, times the square root of 30 over the speed (held between 0.55 and 1.35), times a gear's share over 112 m/s (`config.turbo.turnExp` 0.55). Jet, a ride with `&hit=jet`: a U-turn 2,605 m wide in a 1,500 m arena.
- **Matches:** a Rival and a Learner, the default, against the player's stand-in flown by a Veteran's sense, then a Learner's.

| | The best pilot | The worst |
|---|---|---|
| A rival on screen | 42 % | 36 % |
| The nearest rival, when within 300 m: on screen | 34 % | 27 % |
| off to one side | 27 % | 28 % |
| behind | 39 % | 45 % |
| Each time one is on screen | 1.2 s | 1.4 s |
| Gone before the lock's 0.55 s | 26 % | 20 % |
| Gone before the full charge's 1 s | 46 % | 42 % |
| Ridden, a minute | 1.1 | 1.8 |
| The bus ridden, or its mouth shut after | 17 % | 28 % |

- **The lock:** `duelTune` in `src/recess/Duel.ts`: the pick within 48 px of the finger, the clack at 0.55 s, full at 1 s, the captains' dodge 0.3, 0.55 and 0.75 by level (a full charge 0.6 of that).
- **A ride:** `recessTune.rideBars` 2 at 84 beats a minute, `rideGear` Nonstop, `shield` 4 s.
- **A tap:** `config.splat.stallSpeed` 0.5, `breathSteer` 0.5 until the impact at 0.42 s.
- **The camera's lag:** its yaw follows the bus on a critically damped spring at `config.camera.yawHz` 1.6: behind a steady turn by the turn's rate times 0.2 s, 15 degrees at Cruise's 77 degrees a second, in a lens 21 degrees either side.
- **The lane:** from the camera's geometry, a bus dead ahead at 100 m is about 100 px over the player's, inside the lane's 106.
- **Not measured:** anything on a phone. Which speed a person flies a match at. The brain's pilots fly at Cruise 91 % of the time; a person chasing somebody flicks up.

## 8. The two independent reads

Two designers' reads were asked for on 2026-11-10 with the facts of sections 1 and 7 and the producer's words, and without this proposal: one on handling and feel, one on what the fight should be. What each came to by itself, and what it changed here.

**Where all three agree.** The finger on the rival is the first thing wrong: one thumb with two jobs, each switching the other off. The bus and the camera were made for sightseeing. A hit takes the bus away for far too long. Dice and prompts have to go. Nonstop has no place inside the fence. A toy on the phone comes before any rules.

**From the read on handling.**
- More turn alone would make it worse: under today's camera a rival is swept off the screen sooner. Handling and camera change together.
- The flicks stay gears. In a match the ladder stops at Express and a gear changes fast, so nothing is relearned. This replaced my "one pace, and the flicks become a dash and a brake".
- The skid as a slide: the nose comes round while the bus goes on the way it was going, and the camera follows the bus's way, so the slide is seen.
- A rival says so before it starts on you (a honk), one hunter at a time, and dodges by a skid you can see, with a puff when it can't.
- The playground's first rival only runs, and the four signs to look for in five minutes.
- Over your own colour the skid costs no speed (section 4, "Home turf").
- It would finish with a ring and a blob thrown by a tap or by letting go of the stick; this tries the stream first. Both are in the playground's links.

**From the read on the fight.**
- Wet paint (section 3): paint is wet until it's flown home, and wet paint can be taken. Its pick, in the version where the paint is taken by flying across it.
- The puddle (section 3): the skid's wave, which hits rivals where they already are, beside and behind. It asked for a sideways flick to do it; here the skid is the stick pulled to its end, so there's no new gesture.
- Leapfrog and Musical chairs (section 4), and Keep-away, which it came to as well.
- The threat shown on your own bus, the one thing always on your screen (section 2, rule 3).
- 90 seconds and a circle about 1 km across. The statues kept as homes, every other god rule cut for now.
- A caution worth keeping: the hard turn alone fixes little. At Cruise the bus already comes round in 2.3 s. What's wrong is what you can see and what your thumb is asked to do.

