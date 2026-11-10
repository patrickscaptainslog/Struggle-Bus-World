# The Rampage: gods in the cities, and buses against buses anywhere

The second account, 2026-11-10, for the producer. The producer's reply the same day: "Let's build everything but the gods for now. Let's just put the gods on the back burner". So sections 2 and 3, buses against buses, are built, on `feat/swerve` behind `?swerve`: section 11 says what's there. The god's week, section 4 on, is on hold, a vision still being formed. It all answers this, sent after reading `docs/specs/factions/PVP.md`:

> "Now that I think of it… I want to throw away the idea of having these localized matches entirely. Instead I want us to brainstorm something like this: maybe once a a day, (or once a week to start with?) big cities will have (if the initial player paint volume threshold has been reached to prevent low activity cities from forming gods etc) with the idea that we could have… idk.., three different cities around the world you can fight in on any given week, and then at the end, when a winner for each city is won, the god explodes and sprays the paint of the faction that dealt the most damage to it.
>
> Also i want the gods rampage around its city to be extraordinarily fantastical, spraying paint fantastically of the winner faction, spraying paint that damages opposing busses in its path. But at the same time still being able to take damage.
>
> I could use a lot of help here figuring out how to form this vision. What do you think? Is this decent? What should we change? How can we make this better?"

And on the buses: "Aim with the bus is a superb idea. Kinda like green or red shells in Mario cart. Whoever is in front gets what's coming to them", and "Love love love the idea of bumper buses. I want a bus ramming into another bus to have an enormous impact ... the impact would have to grow in comparison with the speed at which one bus was hit. What if two busses at a high turbo mode hit each other head on?"

How the bus turns is its own plan: `docs/specs/flight/SWERVE.md`.

## 1. What I think

It's better than matches, and I'd build toward it. Three reasons.

- **It's this game.** A god the size of a hill, loose in a real city, being painted. A match in a circle could be any game.
- **It works with ten players or ten thousand.** A match with nobody in it is dead. A god over San Francisco is an event even if you're the only one there, and every bus that turns up adds to it.
- **It gives the crews and the week a point.** Something to paint toward, a day to turn up for, a city that's yours when you win.

It needs six changes to hold together. They're section 5; sections 2 to 4 are the vision with them in.

## 2. Buses against buses, anywhere

No match, no circle. This is how every bus flies, everywhere.

**Who's out there.** Today, nobody: the game has no live server, so no other person is ever in your sky. Until it has one, the rival crews' buses are flown by the computer, and they belong in every city, as the cars and the ferries do. They paint their own colour and get on with it. Start on one and it fights back. Real people in your sky is section 6.

**What a bus can do to a bus.**

- **In front of you: the shell.** Tap with a rival's bus in front of you and the blob goes for it, a red shell. Nobody in front: it's the splat you know. No hold, no lock, nothing to learn: whoever is in front gets what's coming to them.
  - "In front" is generous: about 25 degrees either side of the nose, out to about 400 m.
  - The blob really flies. A hard turn or a skid in its last half second gets out of its way, or a tower between you. No dice, no FLICK!.
- **Behind and beside you: the wave.** The skid's wave, the banana: SWERVE.md, section 3.
- **Touching: the ram.** Section 3.

**Being hit** is as PVP.md has it: a flood of their colour, a roll, a fling, the bus shaking it off like a wet dog. A second and a half to three. The bus stays yours, with its gear and its brakes.

**The computer's buses are fair.** One honks before it starts on you, one at a time, and it gets away by a skid you can see.

## 3. Bumper buses

**What a ram is.** Two buses touch: within about 20 m, more at speed. How hard it is depends on one thing, how fast the two are coming together.

**Who takes it.** A bus struck in its side or tail takes all of it, and the rammer flies on with a jolt. Nose to nose, both take it.

| Coming together at | What happens |
|---|---|
| Under 60 m/s: two buses at Cruise | **A bump.** A clang, both stop arms swing out, both wobble, a puff of paint |
| 60 to 200: Express into anything | **A smash.** The bus that's hit is punted across the neighbourhood, spinning, in the rammer's colours. A splash of the rammer's paint lands on the city under it. The picture holds for a beat |
| 200 to 500: Nonstop and Jet | **A wreck.** It's launched like a pinball with a comet of paint behind it, and lands in a splash the size of a Bomb. A ring races out from the hit |
| Over 500: only two buses head-on in the top gears | **Head-on.** Below |

Everything grows with the speed:
- how far the bus flies: about a second and a half of the speed they met at, 1.5 km at the most;
- how big the splash is: 40 m across at a bump, 250 m at a wreck;
- how long the picture holds, and how hard the camera kicks.

The bus that's hit is flying again in two or three seconds. The paint on the city is the prize.

**Two buses head-on at turbo.** The biggest thing two buses can do.

1. In the last half second time slows and the camera pulls wide. Both drivers see it coming. Swerve now and you're the chicken, and the screen says so.
2. Neither swerves: the picture goes white for a beat.
3. A ring of paint races out at the speed of sound, a kilometre and more, half one crew's colour and half the other's, and paints everything it crosses.
4. Where they met, a crater in both colours.
5. Both buses are blown back the way they came, tumbling, each trailing the other's colour, for a couple of kilometres. Every car in the neighbourhood honks and the picnics cheer.
6. Three seconds later both are flying. Nobody loses, and both want to do it again.

**What makes it possible at those speeds.** At 1,800 m/s a single frame is 60 m of travel, so the hit is looked for along the whole of a frame's way, not at its ends. And two buses nose to nose within a few degrees are drawn gently onto one line, or nobody would ever manage it.

**The god can be rammed too.** A ram at speed is the biggest patch a bus can paint on it, and the bus bounces off like a fly off a windscreen.

## 4. The god's week

**One line:** the city's painting wakes a god, the crews fight to tame it, it rampages for whoever has it, and on Sunday it bursts and the city is theirs for a week.

**Waking it.** All week, everything painted in the city counts. The threshold is one you can see: each neighbourhood painted all the way up raises its god, as FACTIONS.md has it. Here those stand still, as statues, and when enough of them stand the city's god comes. Before that, a grey shape gathers in the fog over the highest hill. A city nobody paints gets no god.

**It wakes grey.** Friday evening. Four hundred metres tall and the colour of everything unpainted. It goes a set way round the city, past its landmarks, so it can always be found: it's the biggest thing in the sky.

**You tame it by painting it.** This is the change that makes the rest work.
- Its body is in patches, as a city is in buildings. Every shot paints the patches it lands on your crew's colour: the shell, the Bomb, a Lob from a kilometre off, the Comet at turbo, and a ram.
- Rivals paint over yours. That's "still being able to take damage": it can always be painted.
- **Whoever has painted the most of it has it.** It takes that crew's colours, and rampages for them. Out-paint them and it shudders, sheds its coat and changes sides.
- So the scoreboard is the god. You can read who's winning from across the bay.

**The rampage.** For the crew that has it, it paints the city as it goes. For everyone else it's the danger. Three things it does, each seen coming for a second and got out of by flying:
- **The sweep.** A jet of paint swung across the sky. A line on the ground shows where it will pass. Behind a tower you're safe.
- **The rain.** Blobs lobbed over a few blocks. Their shadows are on the ground first.
- **The stomp.** A ring racing out along the roofs. Climb over it.

A bus it catches is soaked: flung, painted, two seconds, still the driver's.

**The crews.**
- When your crew has it, it doesn't hurt you. You fly beside your own god, and your job is to keep it: ram and shell the buses that are painting it.
- When another crew has it, your job is to paint it, through everything it throws.
- Paint on a tamed god counts double for the crews that don't have it, so the lead can always be taken.

**The burst.** Sunday evening it stops over the middle of the city, swells and bursts. The winning crew's paint rains on the whole city, every square a stage up in their colour. Their statue stands where it burst, all week, to be seen from everywhere. Every bus that fought keeps something to show for it. On Monday the painting starts again.

**Its looks.** Everything in this world is drawn from palette ramps, so a god changing to a crew's colours costs nothing. A form of its own for each crew (Atlantis's whale, Inferno's black sun) comes later, from the sky pieces that already stand over a lifted neighbourhood.

## 5. What I'd change in your sketch

1. **One city at a time to start, not three.** It keeps everyone in one place. And San Francisco is the only whole city there is: Amsterdam and London are small pieces so far. Three when there are the players and the cities for it.
2. **Damage is paint.** You fight over the god by painting it, and it wears and fights for the colours of whoever has painted it most. That answers three things in your sketch at once: who the "winner faction" is while it rampages, how it can still take damage, and how anyone can tell who's ahead.
3. **A week with a shape:** paint to wake it, Friday it wakes, Sunday it bursts, the statue stands till the next. Daily is too often for a thing this big; a day's smaller prize can come later.
4. **No live multiplayer needed.** Section 6.
5. **Everything it throws is seen coming and dodged by flying,** and being caught costs two seconds, never the bus. The same rules as bus against bus.
6. **On one phone first,** against the computer's crews, before anything in the cloud.

## 6. What it needs

- **Not live multiplayer.** The god is the same god for everyone, in the same place at the same moment, because it's worked out from the clock, as the ferries and the buses on their routes are. Nothing about it travels between phones.
- **One small scoreboard in the cloud.** Each crew's paint on the god, a few numbers a city, and the city's paint for the waking. Phones add to it and read it. The game has one small function in the cloud already, for the live planes; this one has to remember, which that one doesn't. It's a third exception to "no server", after the planes' relay and the two-phone server approved for later, and it's the producer's to approve.
- **Without it** the week still runs on one phone, against the computer's crews. That's how it's built first.
- **Crews of different sizes.** A crew's score is its paint for each bus that took part, or the biggest crew always wins.
- **Cheating.** The game's code is public and runs on the phone, so a scoreboard can be lied to. Among friends that's fine. Before strangers it needs a limit on what one phone can add.
- **Real people in your sky** is the big server job, and the god's week doesn't wait for it.

## 7. What it costs

- **The god is the biggest thing we'd have built.** Four hundred metres, moving, taking paint, attacking, at 30 frames a second on the slowest phone. The first one should be small in everything but size: grey, one way round the city, the sweep alone.
- **The match as built is shelved** (`?recess` on `feat/recess` and `rc/1`): its three minutes and its circle, the squares and the bell, the gods' rings and cracks, the hold and FLICK!. What carries over: the computer captains' flying, the tags and the arrows at the screen's edge, the flood and the roll of a hit, the statues.
- **Two accounts' work.** The creature and its look are the first account's (the world, the effects, the sky pieces). The crews, the week's clock and rules, and the scoreboard are the second's.

## 8. The order

1. **The handling,** SWERVE.md: a link on the game as it is, no rivals.
2. **One rival bus in the open world:** the shell, the wave, the ram. PVP.md's four signs say whether it's working.
3. **The god on one phone:** grey, one way round San Francisco, the sweep, its patches taking paint, the burst.
4. **The scoreboard.**
5. Its coats and forms, the rain and the stomp, the waking, more cities.
6. People in your sky.

## 9. What it changes in the rulings

If approved. Until then they stand.

| Today | With this |
|---|---|
| "Recess against bots on one phone before two phones" (FACTIONS.md section 6) | No Recess. Rival crews in the open world, and the god's week |
| A god belongs to a neighbourhood, at most one each, 79 in San Francisco (decisions 27 and 28) | The neighbourhoods keep their statues, and those wake the city's god: one a city, for a weekend |
| Lock-on by holding on a bus; the duel's white window (SHOTS.md) | The shell: a tap with a bus in front of you. Boats and planes as they are |
| Possessed for two bars in a forced gear (FACTIONS.md, SHOTS.md) | A second and a half to three, at your own speed |
| "No server", but the planes' relay, and a small server for two phones later | And a scoreboard |

## 10. Still open

For later, one at a time.

- The days and the hours, and whose clock: the city's, or one for the world.
- Whether the computer's buses ever start on you in the open world, or only fight back.
- What a winning crew's buses keep.
- Which crew's form the first god with a form takes.
- Wet paint (PVP.md): whether paint that has to be flown home has a place in the week.

## 11. Buses against buses, as built

On `feat/swerve`, behind `?swerve` with the handling (`docs/specs/flight/SWERVE.md`); `&norivals` leaves the buses out. `src/rivals/`: `rivals.ts` their brain and the rules, with no page under it; `rivalsBoot.ts` their looks and hands; `rivalsSfx.ts` stand-in sounds. What sections 2 and 3 became, with the numbers as they stand (all in the tuner, "Rivals"):

**Who's out there**

The first build kept three buses placed ahead of yours, at a share of your speed, coming level with you, and put them back in front when you turned. The producer, on flying it: "Why are these bot buses following me around? Can't they just act like normal players?" So now they do.

- Twenty of the other crews' buses in the whole city, each about its own business wherever it is, whether you're there or not.
- Its business: it works a patch of the city, round and round it at Cruise, lingering now and then, a tap every few seconds. After half a minute or so it makes a trip to another patch, in a gear of its own choosing, climbing to that gear's height and braking as it arrives. Now and then it plays first: a doughnut, a swoop, a dash.
- Where it goes next: somewhere new; or back to a patch of its own; or, three trips in ten, to where another crew has just been painting. That's how they come to meet each other, and how one comes to see about your paint.
- Each has its own temper, timid to bold.
- Nothing of that reads your bus. Twenty of them flown for ten minutes twice, once with the player parked and once with it doing laps of the city among them: every one flies the same line both times, to the last bit.
- So the city isn't a guard of three round you, it's a city of twenty. Staying in one place for ten minutes, one is within a kilometre about half the time, one comes within 400 m about every minute and a half, and one is in reach of the tags nearly always.
- The nearest four are drawn, each in its crew's colour. Those within about 2.4 km wear a name and a distance, a chevron at the screen's edge for one off it. One near enough to see paints for real.
- As the page opens three of them are within a kilometre and a half of you, so there's somebody in sight. After that they're wherever they've got to.

**The shell**
- With a full belly and a rival within 25 degrees of your nose and 400 m, a ring of white beads stands round it. Tap, and the shot goes for it. Nobody in front: the splat you know.
- It flies at 420 m/s over your own speed, steers hard, and for its last half second flies straight. On a bus that holds its line it lands every time: 72 shots of 72, from 120 to 380 m, in every gear.
- A rival tries to skid out of that half second 45 % of the time, and whether it gets clear is the shot's own geometry: when it tries, about half the time at Express, two times in three above, never at Cruise.
- A hit throws it 70 m, tumbling, in your colours, and where it comes down your paint lands.
- In a skid the nose is what aims.

**Fair, and like players**
- One you shoot at, soak or ram has a score to settle. A bold one honks, a second later it hunts you, and it fires only with you in front of it, as you must have it. It lets it go after 22 s, or one hit, and goes back to its patch. A timid one makes off instead.
- And as players do, one that has had another bus in front of it and in reach for a moment may take a shot at it: at one of its own kind, which you'll see across the city, or at you. At you it honks first, takes its one shot, and goes back to its business. Flying about among them without starting anything, that's rare: twice in half an hour.
- Never two at you at once.
- With that mischief turned off (one number) and left alone, they never fire: ten minutes of it, not one shot.
- Its shell is yours to beat. Hold your line and it lands, 96 of 96. Turn hard, or skid, as it goes white (its whistle, its last 0.6 s) and you're clear of it half the time at Cruise, five times in six at Express and Nonstop, three in four at Jet.

**Being hit**
- Their colours flood your bus from the nose, it's thrown along the hit's line and rolls, over whatever stands in the way, and then they drain off its tail. A second and a half for a shell.
- The stick is yours all the way through.

**The ram**
- Two buses touch when their ways come within 15 m, looked for along the whole of a frame's travel: every pairing from 40 to 1,800 m/s touches at 30 and at 60 frames a second, none passes through.
- How hard goes by how fast they came together, alone: under 60 m/s a bump, to 200 a smash, to 500 a wreck.
- A nose into a side or a tail: the one struck takes all of it. Nose to nose, both.
- Into the tail of one painting at Cruise: a bump from a little over Cruise yourself, a smash at Express and Nonstop, a wreck from Jet up.
- Height counts. A bus painting at Cruise is down at the roofs, and Nonstop and Jet fly well over it: to ram it, come down to Express, where everything it meets is a smash. The shell goes down to it from any height. One that's after you flies in your gear, at your height: turn on it.
- The one that takes it flies a second and a half of that speed, 1.5 km at the most: 170 m at Express, 340 at Nonstop, 675 at Jet. In your colours if you did it, and your paint lands where it comes down.
- The word for it on the screen, a held beat, a kick, a clang, and the rammer's paint on the city under it. A bump swings both stop arms out.

**The head-on**
- Nose to nose and closing fast, each on the other's line within 9 degrees: the rival is drawn onto your line and your height. That, and a hunt, are all that ever turn one toward you.
- In the last half second time runs at a quarter and the view stands back. Turn away then and the screen says CHICKEN!.
- Neither does: a white beat, a crater of both crews' paint, rings of it racing out at the speed of sound to a kilometre, a half each, both buses blown back the way they came, and every horn in the neighbourhood.

**Not built**
- The picnics' cheer, the comet of paint behind a wrecked bus, and the ring racing out from a wreck (the head-on has its rings).
- Rivals don't ram on purpose, and don't go faster than Jet. They shoot each other but don't ram each other.
- Their buses are yours in another colour: no crew has a bus of its own yet.
- The god (section 4), and people in your sky (section 6).

**Calls I made, yours to overrule**
- They take the odd shot at you unprovoked, as a player would, with a honk first. That was open in section 10. If you'd rather the world never starts on you, it's one number (`mischief`).
- Twenty in the city. More makes it busier and each one cheaper to find; fewer makes meeting one an event.
- They paint as often and as wide as a casual player: a tap every few seconds while they're on a patch.
- On this link the paint lasts the visit: the rivals paint too, so nothing is saved over your city. With `&norivals` your saved city is there as ever.

Its checks, all on `feat/swerve`:
- `node tools/feel-sim/run.mjs ../rivals/s_rivals.ts`: the rules, 11 rows (their own business held to the last bit, their lives, how often one is met, in front, the ram every way and at every speed, the fling, fair).
- `node tools/controls-sim/run.mjs ../rivals/s_shell.ts`: both shells flown by the shot code's own homing shot, 20 rows.
- `node tools/rivals/smoke.mjs`: a browser at 1x: the city's buses are out, each its own way, the shell, a smash, the player hit, the head-on, `&norivals`, nothing compiled.
