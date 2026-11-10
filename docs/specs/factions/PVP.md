# PvP, rethought

The second account, 2026-11-10, for the producer. Nothing here is ruled until the producer says so. It answers this, after the producer flew the duel on `feat/recess` and `rc/1`:

> "The pvp is so so bad. Like really bad. We need to do a deep dive analysis on how to make this playable and fun. I don't even know what's wrong. 1) I think holding onto the other car is the wrong idea. 2) I need to be able to maneuver easier, especially turning left and right harder. Any creative ideas hear would be much appreciated"

Both notes are right, and they point at the same thing. The short of it:

- **What's wrong:** the fight happens where you can't see it, your thumb is asked to be in two places, and the bus can be fast or nimble but never both.
- **What to build:** you aim with the bus, not with a finger; a match has its own handling, with a hard turn that is a move; nothing can hit you from off your screen; a hit is loud and costs seconds, not your bus.
- **How:** a playground first. You and one rival, no rules, the new handling, on your phone, before anything is built round it.

## 1. What's wrong

From the game's own numbers, and from whole matches of Recess's brain flown in Node (`node --no-warnings tools/recess/feel.mjs` on `feat/recess`: 120 three-minute matches a pilot, the player's bus flown by the game's own pilot at its best and at its worst). Simulated: no thumbs, no phone, no picture. "On screen" is geometry, the match's 41.7 degree lens and the lock's 900 m.

**1. You fight buses you can't see.**
- A rival is on your screen 36 to 42 % of a match. Both at once, 6 %.
- They aren't far. The nearest is within 300 m half to two thirds of the time. But when it's that near it's on your screen only 27 to 34 % of the time: off to one side 27 %, behind you 39 to 45 %.
- Each time one comes onto the screen it stays 1.2 to 1.4 s. A quarter of the time, under 0.6 s.
- So the game tells you about the fight with arrows and words at the screen's edge, where it should be showing you the fight.

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
3. **Nothing hits you from off your screen.** What can hurt you is as close as what you can see.
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

**The other way to finish, to try in the same playground:** the ring closes by itself as above, and a tap throws a blob that really flies and really has to be out-turned. More of a shot, less of a chase. I'd try the stream first.

### A match's own handling

In a match, and only there:

- **One pace.** About 60 m/s, twice Cruise: the arena in 25 s. No gears, so nobody picks a speed that can't turn.
- **A sharp turn at full stick.** A U-turn in about 2 s, 75 m wide, at that pace. The spring stiffer, so it bites at once.
- **The skid.** Pull the thumb further than full and the tail kicks out: tyres squeal, paint fans off the outside, and the bus comes round in about a second. It bleeds speed while you hold it and kicks forward as you let go. This is "turning harder" as a thing you do. No new gesture: you pull harder and it turns harder.
- **The flicks become moves.** They keep their meaning, up is faster and down is slower:
  - a flick up is a dash, a second of speed, then a few seconds to get it back;
  - a flick down slams the brakes for half a second, so whoever is on your tail flies past.
- **Shooting costs nothing.** No stall and no steering cut in a match.

### The camera

- **It looks into your turn.** It leads the nose a little where today it trails it, so what you're turning toward is on the screen.
- **It turns as fast as the bus,** the skid included.
- **It leans to the fight.** With a rival within about 250 m, the view eases toward the two of you, never by much, and never against your own pan.
- **It stands a little higher and nearer** in a match, so the bus behind you is in the picture above your thumb.

### Being hit

- Full of their colour: a burst, one barrel roll, your bus theirs for 3 s.
- You keep flying at the match's pace, with your steering and your brakes.
- For those 3 s your stream is off and the paint you drop is theirs.
- **A splatted bus is a paint bomb.** Where it's splatted, a big splash of the hitter's colour lands on the city under it. That's the prize, and it's how a dogfight makes turf.
- Then a second or two when nobody can start on you again.

### The goal

One line: **most of the neighbourhood in your colour at the bell.** Paint it with your taps; take a chunk by splatting a rival over it. The gods, their rings and cracks, the heal and the seal wait until the fight is fun, and come back as the finale if you want them.

### What a fight is like

Atlantis is ahead, cutting left over the rooftops. You pull hard, the tail kicks out, the tyres squeal. Your nose comes round onto it and your red reaches out. Its yellow goes red from the tail. It slams its brakes. You fly past, and now its blue is on your tail and your own bus is turning blue. You flick up, dash for the tower on the corner, and skid round behind it. The stream breaks. You come out the other side on its tail.

## 4. More ideas

In the order I'd try them. None is needed for the playground.

- **Recess is a rotation of playground games.** Recess has more than one game. On the same handling, each a minute or so, each one line of rules:
  - **Tag.** One bus is IT and drips gold. Touch a bus with your stream and it's IT. Don't be IT at the bell.
  - **Keep-away.** One golden paint can. Whoever carries it paints three times as wide. Splat the carrier to take it. Everyone always knows where the game is: at the gold bus.
  - **King of the hill.** The god's heart is the hill: your squares count double while you're the only bus over it.
  - **Dodgeball.** The blob version of the fight, in a small ring.
- **Paint tails.** In a match the bus trails a ribbon of its colour for a few seconds, a curtain of paint hanging to the roofs. Fly through a rival's and you're splatted. Then a tight turn is an attack: you cut across their nose. All steering, no aiming, and the ribbon paints the ground under it as it drips.
- **Bumper buses.** A dash into a rival's side or tail splats it. Nose to nose, both stop arms clang and both bounce.
- **The stop arm bats it back.** Tap as a blob reaches you and the STOP arm swings out and sends it home. Two good players get a rally, faster each time.
- **Water balloons.** Balloons of paint hang over a few rooftops. Fly through one and your next tap is something big.
- **The draft.** Sit close behind a rival and you're pulled along faster, so getting on a tail gets easier the closer you dare.

## 5. The plan

**Step 1: the playground.** A link, `?recess&toy`. You and one easy rival in a small ring over the city. No clock, no squares, no gods, no score. In it: the match's pace, the sharp turn, the skid, the two flick moves, the camera, the paint stream, the 3 s hit. And links to compare on the phone, as `&hit=nonstop|jet` was:

- `&aim=stream` or `&aim=blob`;
- `&turn=now`, `sharp` or `skid`;
- `&cam=now` or `fight`.

You fly it and say what's right. Nothing else is built until chasing one bus is fun for a minute.

**Step 2: the match.** The winner goes into three buses over a neighbourhood: turf, the paint bomb, the bell. Captains that chase tails, skid and brake, and never roll a die.

**Step 3:** the gods as the finale, or the first of the playground games from section 4. Your call then.

**Who builds it.** The match is the second account's (`src/recess`). The flight, the stick and the camera are the first account's. The playground can be built without touching them: a match already sets the lens through the camera's own hooks, already takes the flicks (`controls.flickGate`), and can set the flight's numbers for as long as it lasts and put them back at the bell. What's liked then goes into the flight and the camera properly, by the first account, as hooks.

## 6. What it changes in the rulings

If approved. Until then they stand.

| Today | With this |
|---|---|
| Lock-on: a still hold on a boat, a plane **or a bus** locks (CLAUDE.md, "Shots"; SHOTS.md, "Lock-on") | Boats and planes as they are. A bus is aimed at with the bus |
| The duel: hold to lock and charge, a white window when a hard turn or a flick dodges it (SHOTS.md) | The stream, or the blob that has to be out-turned. No window, no FLICK! |
| "A quick flick up or down is one gear, anywhere" (CLAUDE.md, "Controls") | Outside a match, as it is. In a match a flick up is a dash and a flick down the brakes |
| Being hit: the flood, a roll, a fling, the forced gear, Nonstop or Jet (SHOTS.md); Possessed for two bars (FACTIONS.md section 6, decision 3) | The flood and the roll, 3 s in their colours at your own speed. No forced gear |
| "Captains fly your ladder" (SHOTS.md) | Captains fly the match's one pace |
| Three minutes in a 1.5 km circle, the gods and their rings in every match (FACTIONS.md) | The playground decides the size and the length. The gods wait |

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
