# Factions: what's built, steps 3, 4 and 7

*The second account, the night of 2026-11-05 and the day after, on `feat/recess` cut from `main` 058217c. All of it is logic in Node: nothing draws, nothing plays, and nothing in the game calls it yet. The plan is [FACTIONS.md](FACTIONS.md), with 27 and 28 approved on 2026-11-06 (§1, "The studio's view", and §3, "Neighbourhoods"); the square rules underneath are [STAGES.md](../STAGES.md) section 1, where FACTIONS.md and its decisions change them.*

## Step 3, the beat: `src/factions/beat.ts`

- `Beat`: 84 a minute (decision 14), four to a bar, on the game's clock, so a pause stops it. `next(t)`, `next(t, 4)` for a bar's downbeat, `crossed(t0, t1)` for the beats a tick passes, `setBpm` that keeps the count, and `sync`/`toAudio` for the music's AudioContext. Two bars are 5.71 s: Possessed's "about six seconds".
- `Slots`: STAGES.md's city-wide cap. At most two changes start in any second, each on a beat, the rest on the next beats with room, never more than a bar late. At 84 a beat is 0.71 s, so any second holds two beats, and the cap comes to one change a beat. Past a bar, a full house still starts on that last beat.

## Step 4, the areas: `src/factions/areas.ts`

- **Squares:** 128 m, world-aligned, the key two 16-bit halves (`squareKey`). Stages 1 to 4: skin, roofs, streets, the Lift (decision 27). A square the map tags worship, cemetery, memorial, school or hospital stops at 3.
- **Owner's hits:** an owner's ready hit is up; one while cooling, or at the top, is an encore.
- **Rival's hits:** a rival's ready hit is down, and at stage 1 it's the flip. One while cooling is a parry.
- **The wait:** five seconds between changes, whoever makes them.
- **Stage 4 takes two rival hits** (`hitsToDrop`). The first cracks it, and **an owner's hit heals the crack** (decision 16).
  - *My reading of "a hit on stage 4 or 5 restarts the five-second wait":* a crack and a heal each start the five seconds again, so a cracked area can't be knocked off at once, and a healed one can't be cracked again at once.
  - An owner's encores don't restart it. Otherwise an owner tapping away would keep a stage 4 safe forever.
- **Spills and Possessed's hiccups** claim grey at stage 1, ready at once, and never touch owned ground.
- **A super counts once an area.**
- **Every change lands on its beat**, through `Slots`.
- **Solo, nothing decays** (STAGES.md 1.3).
- **The save:** `strugglebus.areas.v1:<slug>`, 16 bytes an area, as STAGES.md 1.5 has it. The crack is the stage byte's top bit. A save it can't read changes nothing.
- **Not yet:**
  - the host: the tiles, the buildings' levels, `tArea`, the claim line and the debounced writes;
  - old saves seeded from painted buildings, which waits on step 1's owner on the paint.

## The neighbourhood layer (decision 28): `areas.ts`'s `Realm`, `neighbourhoods.ts`

- **A `Realm`** says which neighbourhood a square is in, each one's heart, squares and land, whether a god may stand there, and which squares are tagged. `Neighbourhoods` takes a table: the world's files will give it once the first account bakes them (a contract clause to come).
- **Two stand-ins until then:**
  - `nearest`: every square to its nearest named point, as the bake starts before its fixes;
  - `camps`: Recess's fallback, three thirds of the circle of 37 or 38 squares each, each heart nearest its third's middle.
- **Raising a god:** the owner's ready hit on the heart raises it to stage 5, on its beat, when three things hold:
  - its faction holds half the neighbourhood's squares at stage 3 or more;
  - the heart's ring of 8 (those inside the neighbourhood) is at the Lift;
  - the heart itself is at 4.
- **Before that,** `standing()` gives the holder, the ring and the sky mark for the host. An owner hit on a heart at 4 without them is an encore.
- **No god:**
  - off the heart;
  - in a neighbourhood under 0.25 km²;
  - on a tagged heart.
  - A hiccup only claims grey at 1, so it can never call one.
- **Toppling:** 5 rival hits at 0.5 km² or less, 9 at 3 km² or more, rounded between. The Crown takes 2 off for the leading faction's gods (decision 17, `godTune.crown`, 0 for off).
  - Each hit is a crack, at most one every five seconds, and an owner's hit heals one.
  - The last hit gives the heart to the attacker at stage 1.
  - Losing the half doesn't topple it.
- **A god's height:** 250 to 450 m by the land (`godHeight`).
- **The first god:** the sky mark points a newcomer at the nearest neighbourhood under 1 km² (`firstGod`).
- **Recess's score:** a point a stage a square, and 36 a god.
- **The save** keeps a god and its cracks in the stage byte: the stage in the low 4 bits, the cracks in the high 4.

**For the studio: a god in a contested Recess.**
- Alone, a captain raises its camp's god in 221 to 257 s.
- With three captains in three minutes it never happens: 0 of 750 matches. The rivals keep knocking the heart's ring of 8 off the Lift.
- In matches of three captains alone (150 each), these didn't change that either:
  - five minutes, or seven;
  - half held at stage 2 instead of 3;
  - camps of 17 squares. Only that one, at five minutes, raised a god, once in 150.
- So under these rules, Recess's 36 points for a god won't come into play against bots. That's for the first account and the producer to weigh: the ring's eight, Recess's length, or captains that defend before they raid. The crowd simulation, my next item, measures the same rule in a shared city.
- **The studio's answer** (the first account, 2026-11-06, in `docs/TODO.md`), built: in Recess each camp starts with its god standing at its heart (`Areas.setGod`; FACTIONS.md section 4, "Each side holds a Heart at stage 5"), and a toppled heart rises again only by the full rule. Captains go home when their god is cracked or a rival is within 350 m of their heart, Learners 40 % of the time, Rivals 70 %, Veterans 95 %. There they hunt the raider or heal the cracks. A share of their painting is a raid on a rival's heart: Learners 15 %, Rivals 30 %, Veterans 35 %. The ring of 8 stays the rule outside Recess (`new Recess(..., { gods: false })`).
- **What it gives, in 750 three-minute matches of three captains** (`duels.mjs`): 2,990 cracks, 1,945 heals and 10 gods toppled, in 10 matches. 2,240 of the 2,250 gods still stand at the bell, and none rose again. A player who raids will topple more than the captains do; how often is for the phone.

## Step 7, Recess's brain: `src/recess/recess.ts`, `captain.ts`

**The arena.** A 1.5 km circle at a fixed step. There are three gears in the arena: Cruise, Express and Nonstop. The yaw is `config.flight.maxYawRate` at 30 m/s, falling as the square root of the speed, so it is never nothing.

**The lock.** A rival within 600 m and within 0.18 rad of the nose glints. The lock holds a little wider once it's on. A captain's breath goes at a bus only a full second after its glint. The sim enforces that whatever the brain says: earlier, the breath goes to the ground.

**The breath.**
- It leads the locked bus as it curves after it.
- In its last third of a second it goes white-hot and stops curving.
- A flick then hops the bus 30 m sideways. A flick there is a hop, not a gear, so no new gesture.
- A breath that hits no bus paints where it lands.

**What a hit does,** by the link's switch (`mode`):

- **Possessed** (decision 2; decision 3, Nonstop in the arena):
  - The bus jumps to Nonstop, and a flick down wheezes NO BRAKES.
  - The driver keeps the steering.
  - It hiccups the hitter's paint on each of the next eight beats.
  - Ridden out, the hitter glints for it from 1.2 km for 8 s, and its super is back.
- **Piñata:** six drops of the victim's paint, a tenth of a MEGA each for the hitter who flies through them. The ride is the burst, and the stop arm follows at once.
- **Bubbled:** three seconds still, popping as the hitter's paint. It's the one mode where the driver loses the steering: the plan's "it stops flight". It is the fallback, so the steering check leaves its three seconds out.

**The rules round a ride.**
- **The stop arm:** every ride ends with four seconds of it. Nobody can lock it, and its mouth is shut.
- **No ganging up:** only the ridden bus's own crew can lock it, and their breath washes the ride off.
- **A pair a third time:** the same pair a third time in two minutes bounces off.
- **WANTED:** three rides given without being ridden back, and a bus glints for every rival from 1.2 km.
- **The new player** (decision 18): rival breaths burst as sparkles until `firstWonder()`. Once, a captain gives them a one-bar ride, as the lesson.

**At the arena's edge** the bus is turned home *on top of* its own steering, never instead of it.

**The captains** have the player's hands and see what a player's screen shows: Learner, Rival and Veteran, by reaction, dodging, aim, hunting and wobble. They hunt or paint, rerolled every few seconds, and go after their avenger's mark first.

**Not here:**
- the open city's rules (Jet, the raider flung 2 km);
- the bells and the scoreboard's camera, and the real three neighbourhoods where they meet (the camps stand in);
- a teammate in Recess, which is one bus a side (the wash is built and tested on its own);
- all the drawing.

## Recess on screen: `?recess` (`src/recess/recessBoot.ts`)

The producer's goal for 2026-11-06's night: "draw the bots match behind a flag (?recess): the player against two AI captains in a 1.5 km arena, three minutes between bells, Possessed when hit, and the painted map from 1,500 m at the bell as the scoreboard."

- **The page.**
  - `?recess` starts the bus on the arena's edge facing in, with no Golden Gate opening.
  - In San Francisco the arena is where Alamo Square, the Lower Haight and Hayes Valley meet. Elsewhere it's the city's start, or `?lat&lon`.
  - Its middle sits on the squares' grid, so the brain's squares are the city's.
  - A flag of its own, a chunk of its own: off, the page is today's.
- **The links:**
  - `&recess=pinata` or `&recess=bubbled` is the link's switch;
  - `&bots=learner|rival|veteran` sets both captains (by default Atlantis is a Rival, Inferno a Learner);
  - `&recesslen=<s>` shortens the match, for checks;
  - `&newcomer` turns the new player's shield on. It's off by default, because Recess is where Possessed is learned.
- **The match.** The brain steps at its own 30 Hz, the player's bus placed from the real flight each step. The captains are the real bus model with its yellow swapped for their colour, Atlantis blue and Inferno red. They fly 45 m over the ground and 22 m over whatever is under them and ahead.
- **Breaths.** Breaths in flight are toon blobs in the shooter's colour, white in the last third of a second. A captain's breath on the ground paints the real city where and when the brain's lands.
- **Paint: plain until the stages' looks land.** Rainbow's is the game's own dealt hues. Atlantis's and Inferno's are one hue each (`Splat.ts`'s `solo`), and since factions' step 1 (merged, 7065fbe) saved as theirs (`faction`, a blast's own where it isn't the splatter's). The match's score is the brain's squares, not the saved paint. The six rainbow hues are all there are until step 5's colours, so a captain's blue and red are hues Rainbow uses too: its ground reads as one solid colour against Rainbow's quilt.
- **The aim.** The aim's mover hand asks the match first: the captain bus 0's lock is on glints (the bus swells), and a tap's breath goes at it. The match flies that breath and decides it, and the city's paint isn't touched. Ground breaths count as Rainbow's hit on their square when they land.
- **Possessed.** The real gear goes to Nonstop and stays there while the ride lasts. A flick down shows NO BRAKES and changes nothing. The steering is the player's throughout. The hiccups blast the hitter's paint where the bus is, on the beat.
- **A flick in the white-hot** hops the bus 30 m sideways instead of shifting: Controls' `flickGate`. FLICK! shows as the breath goes white-hot.
- **Bubbled** holds the bus still for its three seconds.
- **Words** use the HUD's toast: RECESS!, the bell, GOTCHA, NO BRAKES, FLICK!, WANTED, STOP ARM OUT, BACK TO RECESS. A more important word isn't covered by a lesser one.
- **The clock and the score** sit top middle.
- **The gods.** At the first bell each camp's heart takes a big blast of its god's colour, so the field shows whose camp is whose. A crack, a heal, a fall and a god rising again are said in words (YOUR GOD IS CRACKED 2 OF 5, ATLANTIS'S GOD FALLS). A fall or a rise is also a big blast of the new owner's paint on the heart. The score shows a + after a faction while a god of its stands.
- **At the bell** the brain stops, the gears go back to Cruise, and the camera climbs over 4 s to 1,500 m over the arena. The bus is held over the arena's middle, because the city streams its detail, and its paint, round the bus. The score shows in order.
- **The game's narrow lens** (24 degrees across) sees about 640 m of the 1.5 km arena from there, tilted to see more of it far. Widening it at the bell is for the phone to judge.
- **Not yet:**
  - the ornate buses and the stages' looks;
  - the Hearts;
  - a ring or posts at the arena's edge;
  - the real MEGA meter for Piñata's drops;
  - a way to play again but a reload;
  - the real three neighbourhoods (the camps stand in);
  - the GPU and the phone, the producer's and the first account's.

## The checks

- `node --no-warnings tools/factions/check.mjs`: the beat, the slots, the squares, the neighbourhoods, the stand-ins and the save, 16 rows.
- `node --no-warnings tools/recess/duels.mjs [3000]`:
  - every rule above one at a time, on scripted buses;
  - then 3,000 duels, in about 20 s here: a player's stand-in against one captain, or Recess's two, every mode, new players among them.
- **The duels fail when:**
  - anyone's turn isn't what their hands asked for;
  - a breath goes at a bus that wasn't glinting, or a captain's goes before its second;
  - a bus is ganged up on, given a third ride by one pair, ridden in its stop arm, or piled on;
  - a new player is ridden but for the one lesson;
  - a ride slows below Nonstop;
  - a hiccup changes owned ground;
  - a match doesn't replay from its seed.
- **They also check** that a Veteran rides the player more often than a Rival, and a Rival than a Learner.
- `node tools/recess/screen.mjs <out>` (BASE the page): `?recess` at a fixed step in software graphics, a 30 s match with Learner captains, all 8 rows passing on the last build. Its rows:
  - **up:** two captains over the arena;
  - **gotcha:** a real tap at a glinting captain rides it;
  - **possessed:** Nonstop, the flick down taken, full right still turning, eight hiccups painting Inferno's red;
  - **paint:** the captains' one hue each where their blasts land (84 % of the buildings within 25 m of them wear it), and the score;
  - **gods:** each camp's god standing and its heart painted, and one toppled by hits at the heart, said, the heart the attacker's;
  - **bell:** the camera at 1,500 m and the score up;
  - **programs:** nothing compiled through the match;
  - **flag off,** and no page errors.
  - Its frames, `match.png`, `possessed.png` and `scoreboard.png`, are software graphics.

## 2026-11-06, the day's Recess work (the shots' plan, SHOTS.md, "PvP Recess")

- **B21, a match keeps its paint to itself.** Under `?recess` the paint stores open under a slug of their own (`sf~recess`) that no id scheme is registered for, so they keep paint for the session only and never read or write storage. The landmarks' store, keyed by slug alone, starts empty under it. `screen.mjs`: a stand-in saved city is the same after a match, and the next match starts with nothing painted.
- **M22, the freezes.**
  - Captains' blasts, hiccups and hearts carry the tag `QUIET`. `main.ts`'s impact plays no flash, kick, sound or sign for them (`recess.quiet(b.tag)`, a small named hook in the first account's lines). Their hit-stop is 0.
  - Only hits on or by the player freeze the screen: 5 frames each, at most 2 s a match.
  - The match runs on the frame's real time through a freeze (`frame(..., clock)`), so its clock never stops.
- **M23, the paint agrees with the brain.**
  - A captain's breath paints the city where it lands only when the brain leaves that square the captain's.
  - Hiccups paint only where the brain claimed grey.
  - A missed breath at a bus paints where it lands, as the brain counts it.
  - The player's breath lands as a flash in the air and paints nothing where the brain will parry, crack or knock down the square, or from inside the stop arm or a bubble. It still counts in the brain.
  - The player's taps outside the circle count nothing, as the captains' don't.
  - `screen.mjs`: every building in a captain's colour stands in or beside one of its squares, 507 of 507.
- **The captains' colours.** Since factions' step 5 every paint draws in its owner's look, so a captain's blast only carries its faction. Its bus wears its body colour, Atlantis's teal and Inferno's crimson; `feat/factions` e0f1dde is merged in.
- **Recess you can find** (SHOTS.md, "Seeing them").
  - **The lens.** It's about 42° in the match, through the rig's hook (`CameraRig.matchFov`, `matchPull`), pulled back 45 m while a rival is within 900 m, and the street's again at the bell.
  - **The start.** The captains start 500 m ahead, 9.7° either side of the nose, in their own camps. While the first bell rings the camera is high behind the bus with both captains in frame, then it swoops to the chase in 2 s.
  - **The captains.** They fly the player's ladder (Cruise 30 m/s), drawn 1.4 times bigger with a 4 s ribbon in their colour. They hunt for the first 10 s.
  - **Tags.** On screen a captain carries its name and distance in its colour; off screen it's a chevron at the screen's edge. A breath at the player from off screen is a white one.
  - **The fence.** It's chalk bubbles at 750 m. The bus bounces off it with a BOING, its heading mirrored once; the steering stays the player's.
- **Being hit, made loud** (SHOTS.md, "Being hit").
  - A 5-frame freeze, and the hitter's colours flooding the bus front to back in 0.3 s.
  - One barrel roll with a wobble over 0.8 s, thrown 35 m up and 60 m along the shot's line, with a camera kick.
  - The forced gear, Nonstop or Jet by `&hit=nonstop` or `&hit=jet`, with a roll on each beat of the ride. DING DING and the colours draining off the back in 0.6 s at the end.
  - Not built: the GULP and the horn (sound is the first account's), the speed lines, and the Bomb III armed after a ride (the Bomb is the first account's).
- **The heal, seal two** (decision 16, approved): above, under "The neighbourhood layer"; `areas.ts` and the captains.
- **Not yet, for the next run:**
  - the duel: hold to lock and charge, the white window, the dodge and the incoming marker. It waits on the first account's hold to aim (`feat/shots`), and the sideways hop stays until then;
  - the Crown on Recess's own score (M26), the words' queue (M25), and the lead (M28).

## 2026-11-08, the night's Recess work (the day review, `docs/reviews/recess-life-day-2026-11-06.md`, and the shots' hooks)

- **M43, a captain's paint keeps to its square.** `paint()` takes the square its point is in, as the brain does: a blast `recessScreen.paintR` (40 m) round, `size` times for a heart's (as much as fits), its middle moved in from the edges so it stays `paintEdge` (6 m) inside them, and no building picked to land on (`target: null`: the game's own pick could be the next square's, and the pick is always painted). `screen.mjs`'s row now asks "in", not "beside", as each blast lands: 236 of 241 buildings a captain's blast painted stood in its own square (97.9 %). At the bell 225 of 259 captain-painted buildings stand in a square of that faction's (86.9 %): the rest are paint left in squares that later changed hands, which a new owner's 40 m blast doesn't reach. A square repainted whole when it changes hands is the next pick.
- **M44.** The match's paint passes `stream: true`, so no jet leaves the player's bus for it. A captain's splash, burst and flung blobs take its faction's spray (`lookOf(faction).spray`, swapped round those calls in `main.ts`'s impact, quiet blasts only), and a building a captain painted sparkles in its faction's (the bloom reads the building's owner, under `?recess`).
- **M45, defending.** A captain rolls to defend when a danger starts, and again each time its 4 to 7 s run ends while the danger lasts (`Captain.rollDefend`); a danger over sends it back to its own. `duels.mjs`'s new row, 60 matches: 74 % of a cracked god's time its owner is defending (Learner 30 %, Rival 69 %, Veteran 96 %, against their 40, 70 and 95), and 52 of 62 cracked gods healed. The review's reading was 1.4 % and 31 of 107. A Veteran now hunts less: in 3,000 duels it rides the player 1.56 times a minute against a Rival's 1.55, which passes, narrowly.
- **M46, the edge chevrons.** The angle is `atan2(y, x)` (up positive), only the arrow turns, the name stays level beside it (under it, over it when it points down), and an off-screen tag sits inside a frame: `tagTop` (150 px) under the safe area's top, clear of the clock, no lower than `tagBottom` (0.74) of the height, clear of the thumb, `tagSide` (30 px) in from the sides. `screen.mjs`: a captain behind points down from the frame's bottom (π rad), the name not turned.
- **M47, the gods' rings.** Each heart has a ring of 40 bubbles (`makeRing`, one InstancedMesh a heart, the fence's program), `ringR` 56 m round it and `ringUp` 30 m over the ground, in the owner's colour: it closes over the five seconds after a hit (`InstancedMesh.count`) and, whole, breathes on the beat (84 BPM), when the next hit counts. Words: TOO SOON or PARRIED (wait for the ring) for a tap on a god before it, GUARDED for a whole god's, SEALED / TWO CRACKS (or A CRACK) for a seal, and ATLANTIS SEALS for a captain's. `screen.mjs`: three whole rings, one closing again from a hit, a tap too soon counted.
- **M61.** The clock's row is `clockTop` (112 px) under the safe area's top, below the words' slot (the toast at T + 54, 44 high).
- **m52.** The easiest captain hunts the player from the first bell (`Captain.kickoff(t, prey)`), and the other paints its first 10 s, so the first duel is the easy one.
- **m54.** The match's wider lens stays at the bell, so the scoreboard holds all three hearts.
- **n57.** A ride going at the bell ends there: `player()` no longer runs after it, and its flood drains.
- **The shots' hooks** (`docs/specs/shots/HOOKS.md`, with `feat/extras` b05c8a2 merged): `comet.clamp` returns false while the match is on (`RecessGame.playing`), so a tap in a forced gear is a tap at what glints, a captain too, and true at the bell. A Bomb's breath reaches the match through `breathe` (`recess.playerPaint(x, z, arrive, { jump, superId, r })`): the aimed square, its own or grey, jumps at once to 3 at most past the wait (`areas.hit`'s `jump` and `cap`), a rival's takes its one hit, and the grey squares its circle reaches spill Rainbow's at stage 1. A ring (Sonic Boom) or a Waterfall's pool takes no square, since the match hears only a breath's landing, so `&boom`'s guard under `?recess` is gone. `check.mjs`: a Bomb row (18 of 18); `screen.mjs`: a hooks row.
- **Not done:** the duel (the rival lock, the white window, the dodge, the incoming marker), the review's other minors (m48 turbo kept when hit, m49 the fence before the ground loads, m50 quiet blasts' signs, m53 the stop arm's taps scoring, m55 the player's own freezes) and nits, and the neighbourhoods from `hoods.bin` (C18 is Agreed).

## 2026-11-09, the duel (SHOTS.md, "Recess: the duel"; the producer's first note)

`src/recess/Duel.ts`, on the shots' hold and homing shot as they are on `feat/shots` fa91865 (merged). `docs/specs/shots/HOOKS.md`, "The duel, as built on these", says what it leans on in the shot code.

- **The rival lock.** A still hold on a captain's bus within 900 m (the nearest within 48 px of the finger, or its drawn half-size and 16 px) takes the hold: a ring of 14 bubbles closes on the bus, clacks shut at 0.55 s, and doubles at 1 s, a full charge. The lift fires a blob that homes in; a lift before the clack homes weakly. The next 4 s of taps go at the same captain. It breaks when the captain leaves the screen, goes behind a building, raises its stop arm or is ridden.
- **A captain's dodge.** At the white of the player's shot a captain rolls by its level (Learner 30 %, Rival 55 %, Veteran 75 %; 0.6 of that against a full charge), and after its reaction lunges out. One that doesn't is hit if the shot's line passes within 22 m. THEY DODGED says so, and the lock holds 2 s more for the answer.
- **A captain's shot at the player.** The brain's breath at the player's bus is only said (`Recess.duel`, `'aim'`), and the duel flies it: a line of beads from the captain to the bus for its second of glint, its tag flashing, the hook's whistle, then the blob, slowed so it always flies a level's time (1.5, 1.15, 0.95 s) with a level's white at its end (1, 0.8, 0.7 s), whatever the bus is closing at. Its marker is the shot's own tag: on screen over the blob, at the screen's edge with an arrow when it comes from behind.
- **The white window and the dodge test.** In the white (FLICK!) a flick up lunges the bus 40 m on, a flick down brake-hops it (24 m back, 6 m up), and no gear hears either; a hard turn (the thumb's stretch changed by 0.6 since the white) does the same at any gear. The shot sees the bus slide off its line over the lunge's quarter second, so a dodge too late is still a hit. Before the white a flick is a gear, as always, and the shot leads the bus round any turn it holds.
- **Only an aimed shot possesses.** A hit goes to the brain through `aimedHit` and lands by the rules a breath did (the stop arm, the pair, the newcomer's one lesson). A tap at a rival's bus is a splash: 85 m of the player's paint on its square, a flash on the bus, no ride. `gotcha` is gone from the screen.
- **The first duel.** The easiest captain alone may lock in the first 7.6 s (`firstLock` 3.6, `firstGap` 4), and its first shot flies 1.8 s, is white 1.2 s and asks half the turn. Dodged, the screen says DODGED! / HOLD ON A BUS TO LOCK IT, once.

**Checks, and what they printed.**
- `node tools/controls-sim/run.mjs ../recess/s_duel.ts` (Node, the real Holds and Flight; 240 duels a row): all 37 passed. Doing nothing, a captain's shot hits 98 %. A flick in the white dodges 88 % (Learner 98, Rival 94, Veteran 72); a hard turn 81 %. The first duel from the kickoff at Cruise: glint at 3.6 s, fired at 5.1, white at 5.7, dodged by 7.2 s; at Express dodged by 9.5 s; at Jet by 7.8 s. `--quick` after the screen's wiring: all 37 passed.
- `node tools/recess/duels.mjs` (3,000 duels of the brain alone, the duel off): every row passes, the levels 1.36, 1.55 and 1.56 rides a minute.
- `tools/recess/screen.mjs` on the build, software graphics at a fixed step: all 23 rows pass, exit 0, no page errors. The duel's rows: **duel** (the first shot at the player is told by 25 beads, the flashing tag and FLICK!; glint at 3.6 s, fired at 5.1, one flick in its white dodges it inside the first 10 s, and the screen says DODGED! / HOLD ON A BUS TO LOCK IT); **lock** (a touch held on a captain at (82, 335): the hold is `recess-lock`'s, the ring 14 dots at the clack and 28 at the full charge, the lift fires 1, it hits, the captain rides: `rode true, state "ride"`); **marker** (a captain's shot from behind: the white chevron at y 582 of 852, pointing back, 3 fired, none refused); **splash** (a tap by a captain: no glint, no shot, no ride, 1 splash); **hit, made loud** (flung 1, 282 crimson pixels on the bus, its yellow back to 1,320 after the ride); **possessed** (Nonstop, a flick down took and only wheezed, full right turned 2.08 rad, 16 hiccups, 95 % of what they painted Inferno's); **freezes** (6 of 6 the player's, the captains' 5 paints froze nothing); **hooks** (`comet.clamp` false in the match and true after the bell; a Bomb III on grey takes its square to 3). The older rows (kickoff, findable, edges, paint, fence, rings, gods, bell, programs, B21, flag off) print what they did. `node tools/iosfloor.mjs` on that build: "iOS 15.0 parses every chunk".

**Not right yet, or not checked.**
- The flick's lunge is Recess's own move of the bus, a stand-in for the flight's (the first account's, HOOKS.md "Not here yet"). It is checked for not ending inside a building only by the game's own collision afterwards.
- The first duel at Express ends at about 9.5 s: inside the producer's 10, but close. If the phone says it drags, lower `recessTune.firstLock`.
- A Veteran rides the player 1.56 times a minute to a Rival's 1.55: the levels still climb, by a hair.
- A rival dead ahead of the nose sits in the bus's lane, where a hold flies. The kickoff keeps both captains off it; the phone will say whether it bites in play.
- The clack and the captain's tone are borrowed sounds (`audio.bombTier`, `audio.homingWhistle`).
- Nothing here was flown on a phone: the ring's size, the beads and the marker are judged from stills at 1x.
- The first account's street signs draw over a captain and its lock ring (`duel-lock.png`: WEBSTER ST over Atlantis's captain at the clack). Signs are theirs: asked in HOOKS.md.
