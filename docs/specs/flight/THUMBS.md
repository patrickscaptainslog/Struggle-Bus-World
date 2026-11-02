# THUMBS: two thumbs, no new buttons

The producer, 2026-11-02, after flying it on an iPhone 17 Pro: "Looking around should take two thumbs to be necessary, yes two thumbs sure, but also just any thumb movement in left thumb area of the screen by itself should do it as well". Earlier they had put it as "Right thumb/center control" flies, and the left thumb looks. That overrules the order rule and "one thumb gets no look": the left of the screen looks, on its own.

The producer, 2026-11-02, after flying it: "I want the swipe gear changes to also work with my right thumb. I want to be able to play this with one thumb." That overrules "dont add right thumb flicks" below, which stays here as what was said.

The producer, 2026-11-01: "dont add the gear strip. dont add right thumb flicks. yes, remove the turbo button, replace with two quick flicks - its intuitive enough... lets remove tilt steering completely - i dont like it." And: "yes, the boost stays on until you flick down, and if we're getting funky - lets say that turbo can be 'boosted' more until youre in max top gear." And earlier: "I don't want to add a button/joystick o anything, I just want it to be intuitive to pick up and fly."

**State.** On `feat/thumbs`, off `feat/nose` 08dd842, main merged in. Built and reviewed: the two thumbs, flicks, turbo's latch and levels, the undo, the look, the aim that follows it, the flick's pop, the first run's hint; TURBO, its tab and tilt gone. The producer flew that build on an iPhone 17 Pro, 2026-11-02: "New thumb controls work great! Very intuitive." Their first note is [Gears](#gears), and Express, its answer, hasn't been on a phone. Their second is [One thumb](#one-thumb), which hasn't either. Their third is the left zone, in the rule below, which hasn't either. Nothing was measured on that flight, so every thumb number below is still a model or a guess.

## The rule

The left of the screen looks and the rest flies. A touch landing in the left 42 % of the screen's width (`lookZone`, the right 42 % with BUTTONS: SWAP) never flies. There, alone or beside a flying thumb, it is a second thumb. Anywhere else the first thumb flies, and a thumb landing while it does is a second thumb too. A second thumb looks, shifts and taps, and never touches the flight: the bus flies on by itself. A thumb that stays down steers or looks; a thumb that lifts fast is a command. Two thumbs in any order: the one in the zone looks and the other flies.

| Touch | First thumb: flies | Second thumb |
|---|---|---|
| Who it is | First finger down out of the zone, exactly as ever | Any finger landing in the zone, alone or not, or anywhere while something flies |
| Tap | Splat on its lift, up to 450 ms | Splat on its lift, up to 230 ms; with nobody flying, up to 450 |
| Two fingers tapped together | One splat | Same |
| Drag that stays down | Steers: the same bungee, pull and push | Looks, after 100 ms and 12 px, from where it landed |
| Resting still | Past 450 ms, dead straight | Nothing |
| Lift after a drag | The bus flies on | The view goes home |
| Quick flick up | Only a fresh stroke with no other thumb down, on the firm rule: the same as the second thumb's | Gear up. Two within the window: turbo |
| Quick flick down | The same | Takes back a waiting gear, else ends turbo, else gear down |
| Three fingers | Tuner | Tuner |

Two lone touches, because the bus flies on by itself with no thumb down:

- **The zone.** A lone touch in it is a second thumb, so a first-time player's drag on the left swings the view and the view comes home on the lift. Only the landing counts: a look that wanders over the line is still a look, and a flying thumb that wanders into the zone still flies. 42 % leaves the centre with the flying thumb, which is what the producer said. It is a touch's rule: the left mouse flies anywhere. SWAP mirrors it with MEGA. It replaced the 30 s memory, which only ever let a left thumb keep looking after the flying thumb lifted, and the rule that thumbs go by order: in the zone it no longer matters which landed first. Out of the zone order is all there is: the first flies, the next is a second thumb.
- **The lone stroke.** A fresh stroke out of the zone that lifts fast is a flick, on a firmer rule, with no other thumb needed. It steers from its first pixel until the lift decides: steering never waits for a verdict. A thumb that stays down never shifts, and a stroke already under way never becomes a flick. A flick down with something to do leaves the bus as it was, its own pull included ([What a flick costs the flight](#what-a-flick-costs-the-flight)). A stroke in the zone steers nothing, so it has nothing to prove: it reads the second thumb's rule, alone or not.

A thumb that lands during a lone stroke which turns out to be a flick is a lone touch from there, because the flick was a command, not a flying thumb: it flies, from where it landed, unless it landed in the zone. A touch landing in a band during a flick is a grip, not a thumb: it takes no stick, and the next thumb to land flies. MEGA is what it was: tap, hold charges, slide steers. It catches its own touches, so a stroke that starts on it is MEGA's.

## Reading a flick

The landing and the lift, nothing between: distance over contact time, not peak speed, so it holds at 30 fps. One touch is one reading, so the return stroke never counts.

| Rule | At least | At most | Average, at least | Within of vertical |
|---|---|---|---|---|
| Second thumb, and the left zone alone | 30 px | 230 ms | 0.25 px/ms | 50 degrees |
| Lone stroke out of the zone | 36 px | 200 ms | 0.4 px/ms | 40 degrees |

A lone stroke landing within `loneAgainMs` (320 ms) of a flick's lift reads the second thumb's row: [The double](#the-double) says why.

A stroke landing within 40 px of the bottom is never a command, because iOS owns that edge; nor within 20 px of a side. It still steers, looks or taps. A mouse never flicks.

Both rules are model numbers, from the study's invented strokes: second thumb 98 % of practised flicks, 74 % of new ones, 0.7 false gears per 10 minutes; lone stroke 90 and 47 %, 3.1 false [model, no real thumb]. That 0.7 is a second thumb's strokes, from before a thumb could look alone: a glance up or down in the left zone that lifts fast is a gear, and nothing has counted those.

## Gears

The producer, on the phone: "swiping up goes straight to turbo - I thought a swipe up meant a gear twist and double swipe meant turbo?" The flick was doing what it said: it waited 320 ms and shifted one gear. But the only gear above Cruise was Jet, 15 times its speed and what the old TURBO button gave. So there is a gear between them.

| Gear | m/s | Needs | Unlocked |
|---|---|---|---|
| G0 Cruise | 30, 112 surging | nothing | always |
| G1 Express | 112, about 250 mph | nothing | always |
| G2 Jet | 450 | 150 m | always |
| G3 Stratos | 4,500 | 2 km | `config.turbo.worldTravel` |
| G4 Rainbow Warp | 30,000 | 10 km | `config.turbo.worldTravel` |

- **One flick from Cruise is Express.** A second flick after the window is Jet.
- **Express is the surge with no thumb on it** (`config.flight.surgeSpeed`). No height, no floor, no lift: it rides the rooftops as a held surge does, 0.3 m from one at worst over 8 s of Alamo Square's blocks. It comes up at the surge's rate, not a gear's spool, because a surge must never feel like a brake. It is in on the shift, so it has no `engage`: a clunk, a rush and a small kick, and the speed.
- **A flick down out of Express is the surge let go.** The bus slows at the classic rate and goes on doing what it was doing, skimming or holding. Out of Jet it brakes and holds the height, as a gear always has. So a flick down steps Jet to Express to Cruise.
- **A pull in Express goes up the nose,** as the boost does: 111.6 m/s up at 85 degrees. It is a gear, so it drives through what a thumb's surge doesn't: the full belly's 12 %, a charge's weight, the firehose's recoil.
- **The hop.** Jet's lift starts from Express's speed: a full surge while it climbs, then the spool. From the rooftops it bites 1.7 s after the shift at 112 m/s, and a second flick 0.1, 0.4 or 1 s after Express bit (49, 87, 108 m/s by then) gives nothing back on the way.
- **Express shows what a held surge shows:** the speed, the lens levelling toward the horizon, speed lines' first two of 90, no contrail, no strain, and the engine hears a surge. The turbo voice stays detached, and the city keeps its level of detail: only a gear with a height, or a speed past the surge, holds it.

## Turbo

Turbo is the boost, latched: on until a flick down, with no thumb held, at any gear and height. Jet and up lift you, turbo doesn't. On the path (`NOSE.md`) a pull with turbo on sends the bus up the nose.

- **Two quick flicks beat one** from Cruise: turbo's first level sits on the surge with the same multipliers as every gear, 146 against Express's 112. Cruise's turbo and Express's come out the same. At Express the sum is the other way: one flick is Jet, 450, and two quick flicks are 146.

- **It stacks.** Two more quick flicks add a level, up to `config.turbo.levels` entries. Past the last: LOCKED, and the level stands.
- **A first flick up** answers at once, seen at the bus and heard: a small ring of the boom's vapor and a clunk, because a silenced iPhone hears nothing. Its gear waits 320 ms for a second flick. The window runs from the first's lift to the second's landing, and a stroke landing inside it holds the gear until its own lift.
- **A second flick** drops the waiting gear and turns turbo on, or adds a level. A flick up with turbo on and no second one is a gear, and turbo stays.
- **A flick down never waits.** It takes back a waiting gear, leaving turbo as it was. Else one flick ends all of turbo; the next drops a gear. A gear still lifting hasn't bitten: that flick takes it back too, and the bus settles to where it was by its own sink or hold, at 9 m/s at most, from 24 m over it after a flick 0.4 s late or 113 m after one 1.5 s late, with nothing to fly. Once a gear has bitten it holds the height, as ever.
- **LOCKED** can only come out of a gear that really goes, so it never shows before the window has closed.
- **The opening.** A flick under the gate answers TURBO AFTER THE BRIDGE and fires after the gate; a flick down takes it back, inside the window or after it, saying TURBO OFF, or clearing the line if turbo is on. A double under the gate is turbo: Cruise's turbo lifts nothing. Express lifts nothing either, but it waits like any gear: the gate has one rule and one line.
- **The map's edge.** The fade reads what is being driven at, gear and level, at Cruise too. Express with no turbo is the surge, which has nothing to fade.

| Level | Cruise, Express (m/s) | Jet (m/s) |
|---|---|---|
| Off | 30 cruise, 112 Express | 450 |
| 1 | 146 | 585 |
| 2 | 179 | 720 |
| 3 | 224 | 900 |

Measured in the game at a fixed step, full belly: 145.6, 179.2, 224 at Cruise and at Express, and 584, 719, 898 at Jet. Full pull with turbo on at Cruise: 145 up at level 1, 223 at level 3, both at 85 degrees. Run east at the map's edge: 735 m past it at most at every level of every gear, the same as no turbo, Jet at 225 m/s at the edge at level 3 (with the reach reading the gear's speed alone: 843 m, 531 m/s). Express and Cruise's first level meet it at 112 and 130 m/s.

## One thumb

One thumb out of the left zone, in either hand, has everything but the look: a flick up for a gear, a flick down, two quick flicks for turbo, the stacking, the take-back, every tap. One thumb in the zone has everything but the steering: the look, every flick, every tap. There is no setting and nothing on screen changes: a second thumb landing is a second thumb, as ever.

### What a flick costs the flight

A flick out of the left zone steers until it lifts, because steering never waits, and the bus flies on from where the stroke left it. A flick in the zone costs nothing here: it never touches the stick, so a right thumb's flick is the only one this section is about. Model strokes through the real Flight at a fixed step, each against a twin with no stroke, the stick at the stroke's full distance by 85 ms and held to the lift:

| | Flick, 74 px, 85 ms | Quick dab, 46 px, 110 ms | The rule's limit, 80 px, 200 ms | A pull held 800 ms |
|---|---|---|---|---|
| Nose on the path (degrees) | 9 | 5 | 25 | 62 |
| Height at Cruise (m) | 3 | 2 | 9 | 34 |
| Height at Express (m) | 8 | 5 | 24 | 98 |
| Height at Jet (m) | 33 | 19 | 93 | 392 |
| Height at Jet, level 3 (m) | 64 | 37 | 186 | 784 |

A flick up is a push, so that height is lost. At the rooftops a push surges instead: up 10 m/s for a moment, no height.

A flick down is a pull, so the bus rises that much, and then it goes back. A pull's release chooses a hold, and that would have unhooked the bus from the rooftops until the next push, at the height of whatever roof it was on, the thing Express was built not to do. A Jet still lifting, taken back after 1 s, held 131 m over Alamo Square. So when a lone flick down has something to do, what its pull chose goes back as the bus lets go of it (`Flight.unpull`): out of Express, turbo off, a take-back, it goes on skimming or holding as it was, the same as a second thumb's. Three things stand: out of a gear that bit it holds the height, as ever; with nothing to do a flick down is the quick pull it looks like; and a stick that moves first has chosen for itself. On a path the stroke didn't start there is nothing to go back to, so a dive's arc doesn't rebound.

### A false flick

On the flying thumb a quick dab up or down can read as a flick. **The firm rule stays where it is.** The study's dabs were 15 % vertical, from before `NOSE.md`, so this reruns its invented strokes with more of them vertical [model, no real thumb]:

| Firm rule | Practised flicks caught | New | False shifts per 10 min, 15 % vertical | 30 % | 50 % |
|---|---|---|---|---|---|
| 36 px, 200 ms, 0.4 px/ms: today | 90 % | 48 % | 3.1 | 5.7 | 9.1 |
| 40 px | 88 % | 46 % | 2.8 | 5.1 | 8.1 |
| 46 px | 84 % | 41 % | 2.3 | 4.2 | 6.7 |
| 50 px, 190 ms, 0.45 px/ms | 77 % | 34 % | 1.8 | 3.3 | 5.2 |

- **The landing and the lift can't tell them apart.** A vertical quick dab passes 51 % of the time and a new player's real flick 48 %. Firming pays in real flicks at about the rate it saves false shifts. Distance is the cheapest number to pay with: 0.23 to 0.30 false shifts saved per point of practised flicks lost, against 0.14 to 0.20 for speed.
- **The strokes the rule can see aren't the path's work.** `noseRate`'s time constant is 385 ms, about twice the rule's 200, so a stroke that lifts fast enough to be a flick moves the nose 5 to 9 degrees against 62 for a held pull (the table above, real Flight). The pulls that fly the path stay down, and a thumb that stays down never shifts. The study's "6 or worse" and the 30 and 50 % here are guesses.
- **A false flick is cheaper than when the study named it.** Then one was Jet. From Cruise it is Express now, a surge with no height, and a flick down leaves the bus as it was. A false Jet takes a false flick from Express. Up high that one bites when the window closes and heads for 450 m/s, and a flick down catches it with the height held, within 3 m, in the real Flight:

| Flick down after it bit | Speed by then | Further than a twin that stayed in Express |
|---|---|---|
| 0.25 s | 152 m/s | 31 m |
| 1 s | 332 m/s | 346 m |
| 4 s | 447 m/s | 1.4 km |

The phone decides this, against the study's bar: under 1 false launch per 10 minutes, at least 80 % of real flicks caught. If it fails on false shifts, `loneFlickPx` moves first: 46 px saves a quarter of them for 7 points of practised flicks.

### The double

**The window stays at 320 ms, and the second stroke reads the second thumb's rule.** The window runs from the first's lift to the second's landing, so landing to landing it allows 403 ms after a practised flick and 424 after a new one: about 2.4 flicks a second at the slowest. The thumb has to go back through the air, and the second thumb has to as well, so what's different with one thumb is that it also holds the phone. Going back at its own flick's speed it lands 151 ms after the lift, 179 after a new flick; at 0.75 of that speed 184 and 222; at 0.6, 218 and 265 [model: 50 ms to turn round, then the flick's distance and 15 px].

So 320 ms is comfortable for a practised thumb, 98 % inside at 0.75 and 90 at 0.6, and tight for a new one at the slow end: 78 % at 0.6, or 68 % if the study's own guess at a free thumb's gap, medians 120 and 200 ms, is slowed by 0.75, against 88 % free. But the window isn't what fails. A one-thumb double is three steps, and two of them are the firm rule [model, strokes taken as independent, though a hurried second stroke is probably weaker]:

| Step | Practised | New |
|---|---|---|
| First stroke, firm | 90 % | 48 % |
| Back inside 320 ms, at 0.75 | 98 % | 68 % |
| Second stroke, firm | 90 % | 48 % |
| All three | 79 % | 15 % |
| With a 400 ms window | 81 % | 19 % |
| With the second stroke on the second thumb's rule | 86 % | 24 % |
| With both | 88 % | 30 % |
| Two thumbs today, for scale | 95 % | 49 % |

So a lone stroke landing within `loneAgainMs` of a flick's lift reads the second thumb's rule. That thumb has just said what it is doing, and a false flick lives in the first stroke, which stays firm. It also makes a take-back easier, and every flick of a run after the first: all three doubles at one go, six strokes, are at least 64 % practised against 50. It costs about 0.03 false flicks per 10 minutes [model]: a dab has to land inside a window to be read this way. 400 ms would have made every lone gear wait 80 ms longer and read more hurried two-gears as turbo, 63 % against 43, for 2 and 4 points. `doubleMs` is on the tuner if the phone says otherwise.

A double in the left zone is the two-thumbs row, alone or not: both strokes read the second thumb's rule.

### What only a phone can say

How far a right thumb's natural arc leans from vertical (the model has 14 degrees and the cone is 40: `loneFlickDeg`), and how often it lands in the bottom or side band, which are near where a right thumb rests. Whether a hurried thumb brushes the glass on its way back: inside the window that brush reads the second thumb's rule, and one going down takes the gear back. Whether a thumb pumping the surge in quick pushes gets turbo: one push that reads as a flick makes the next easier, and the model takes strokes as independent, which those aren't. Where the line belongs: 42 % is 169 px on an iPhone 17 Pro, so does a right thumb reaching across land left of it and look when it meant to fly, and does a left thumb reaching in land right of it and fly when it meant to look (`lookZone`)? How often a quick glance on the left is a gear, on the second thumb's easy rule. Whether a left thumb that means to rest creeps past 12 px and swings the view. And all of the above.

## The look

A thumb in the left zone, or any second thumb, that stays down turns the view round the bus. On the lift the view goes home: there is no stay-where-you-left-it. Nothing is drawn for it. `CameraRig.setLook` keeps one yaw offset and one pitch offset on the wall clock, so a hit-stop doesn't stall them, and `applyLook` lays them over the finished pose. The rig's own state never hears of it.

- **Geared like a second bungee.** The thumb's offset from where it landed sets the angle, 1 degree per px, and thumb up looks up. Sideways is the full circle with no stop: 270 px is a quarter turn the other way, and home goes the short way round. Up stops at 45 degrees and down at 50, and past a limit the landing is dragged along behind the thumb, so turning back answers at once.
- **A flick doesn't swing it.** The thumb waits 100 ms and 12 px, but a flick can last longer than that, and only its lift says it was one. So a look eases in over `lookEaseIn`, 0.2 s, and goes home from a stand. A 74 px flick of 120 ms moves the view under 1 degree at 60 and 30 fps, of 150 ms 3 to 4, of 180 ms 5 to 10 [model strokes through the real rig]; with neither, those were 42, 53 and 51 [model]. A drag reaches 90 % of a fast 90 px in about 0.33 s, against 0.25 [model].
- **The bus stands where it stood.** Sideways and down, the whole pose turns about the bus. The follow's lag goes round with it, so the lead the study wanted at speed has nothing left to do: a look can't push the bus off its spot, at Jet or at 900 m/s, in a turn or not. Zoom and distance don't change.
- **Up, the lens tilts where it is.** Lowering it would stand it among the roofs. The bus leaves by the bottom of the frame past about 19 degrees [model, research-render 6.2], and the floor flies it meanwhile: a glance, not a place to live.
- **Down goes over the bus**, the move a dive makes. The two add, and the view's pitch stops at `lookViewMax`, 86 degrees: past straight down it would turn over.
- **Home is exact.** A critically damped spring, stepped exactly, so the path is the same at any frame rate. It arrives at exactly 0, and at 0 `applyLook` doesn't run: settled, the rig is what it was.
- **A look is not a thumb.** It never sets `state.thumb`, never teaches DRAG, and flight doesn't know it happened.
- **Off under the opening's low shot:** the angle is scaled by `1 - openingLow`.
- **The stream stays on the heading**, so a glance behind doesn't drop what the bus is flying into. A look held 2 s takes it along at 2 per s, and it comes home with the view. The shadow's window follows the view from the first frame.

Measured with the real rig. Twin flights, one looking, the other not (`tools/feel-sim/s_look.ts`): cruise, turning, climbing, Jet and a dive, 480 frames each; from the frame the look is home every camera number is identical, and the flight's are identical on every frame. The bus against its twin at 90, -90, 120, 180 sideways and 50 down, at cruise, surge, Express, Jet, Jet level 3 and turning at Jet: under 0.5 px of the 240 x 520 frame, same distance. Home, from the lift:

| From | Within a game pixel (s) | Exactly home (s) |
|---|---|---|
| 30 sideways | 0.97 | 1.27 |
| 90 sideways | 1.12 | 1.40 |
| 180 sideways | 1.20 | 1.48 |
| 45 up | 1.02 | 1.32 |
| 50 down | 1.03 | 1.33 |

In the real page, real CDP thumbs (`tools/controls.mjs look`): the bus 0.5 across and 0.588 to 0.596 down the frame through every street look but up, 0.513 to 0.528 in Jet. With the game clock standing and the look running on the wall clock, three looks at the street and three at 1,200 m: the camera's matrix is the same to the digit and the frame the same pixel for pixel, and it stays still.

## The aim

A tap goes where the view looks, sideways only, out to `lookAimMax`, 100 degrees each side, and down the nose past that: no tail gun. `CameraRig.aimYaw` turns `Aimer`'s heading and nothing else, so the ray, the pick, the hold, the wall in the way and the hose all follow, and because the view and the aim turn about the same point the glint stays in its usual spot on the screen while the world turns under it. The jet still leaves the mouth. Looking up or down changes nothing about where a tap goes.

You can't hold a look and tap with the same thumb. The flying thumb lifts and taps, the look thumb holding the view: the bus flies on by itself for that moment. A real page's tap at 70 degrees hit the building that glinted. Over the real city, four places, nine looks each: all 36 hit what glinted, and every shot off the nose landed within 14 degrees of where the view looked. A shot down the nose scatters 22 there: the shot lands on the building, not on the line.

## The pop

A first flick answers at once, seen at the bus: the boom's vapor ring, small, and a hiccup in the bus's own body on the breath's squash spring. The ring rides along with the bus, so at 450 m/s it stands round it for about a quarter of a second before it slides back, and it is as big on screen at any height. Turbo's ring is the same, bigger. A silenced iPhone hears nothing, so this is the only answer it gets.

## The hint

On the first run's intro, once ever, a beat after the fog has lifted, four lines in the toast's slot for 6.5 s, and touches pass through it:

```
FLICK UP FOR GEARS
TWO FLICKS TURBO
LEFT SIDE
DRAG TO LOOK
```

Any thumb flicks, so the flicks come first and the last two lines are the zone's. It says DRAG because a resting thumb does nothing. With BUTTONS: SWAP on it says RIGHT SIDE: the hint comes once ever and an old save can get it.

It asks for nothing and nothing ends it but its own time, or a line that matters more: a flick under the gate answers over it. The gate's own CLIMB line waits for it. `taught` bit 32; an old save gets it once, which is right, because that player's TURBO has just gone. A save that has seen it already never sees these lines. Off wherever the first run is off, and a desktop gets its keys in the keys toast instead. Nothing else on the screen teaches any of this: the gestures are hidden, the producer's call.

## Keyboard and mouse

E or PageUp is a flick up, so E twice within the window is turbo. Q or PageDown is a flick down. Shift holds level 1 while held, whatever the latch says, and ends nothing. A right mouse drag looks, from its first pixel. The left mouse is the bungee, anywhere on the screen, and never a flick.

## What's tunable

On the tuner (`?tune`), group Input, read live: `lookZone` (0.42; 0: no zone), `secondTapMs` (230), `lookDelayMs` (100), `flickPx`, `flickMs`, `flickSpeed`, `flickDeg`, `loneFlickPx`, `loneFlickMs`, `loneFlickSpeed`, `loneFlickDeg`, `loneAgainMs` (320; 0: always the firm rule), `flickBottomPx` (40), `flickSidePx` (20), `doubleMs` (320). In `config.turbo`: `levels` ([1.3, 1.6, 2]), on every gear and at Cruise on the surge, not on the tuner: it shows numbers, and this is a list.

On the tuner, group camera: `lookDegPerPx` (1), `lookInvertY` (off: thumb up looks up, the opposite of the yoke, where thumb down climbs), `lookUp` (45), `lookDown` (50), `lookFollowHz` (4.5), `lookHomeHz` (1.4: home in about 1 s), `lookEaseIn` (0.2), `lookViewMax` (86), `lookAimMax` (100), `lookStreamAfter` (2), `lookStreamRate` (2).

## The ladder

Six rungs: Cruise, Express, Jet, Stratos, Rainbow Warp, and top turbo as gear six, the last gear with all of turbo on, so that "max turbo boost is essentially gear six". Then one extra boost, unlocked rather than flicked, that makes the Moon about 5 minutes: 384,400 km in 300 s is about 1,280 km/s. That boost isn't built, and Stratos and Rainbow Warp stay locked behind `config.turbo.worldTravel`: today a flick past Jet says LOCKED, and so does a level past the last, which is the right word for when they exist.

## Left on purpose

- **Nothing is on screen for a gear** but the readout's moment: no strip, no pips added, no button. A hidden gesture is the producer's call, and the hint on the first run is all the teaching there is. The study's worry stands: a new player may never find gears. Only a stranger's two minutes can say.
- **A left-handed one-thumb player can't steer until they turn on BUTTONS: SWAP.** If they only ever touch the left, they look, shift and tap, and the bus flies itself. The producer's choice. They aren't stranded: the view comes home on every lift, and SWAP is in settings.
- **The opening's low shot has no look, alone or not.** On a first visit a left thumb that landed with the hint up, 5 s in, moved the view 0 degrees until the bus cleared the bridge at about 17 s, then 52 by 18 s and 88 by 20 (a real page, a fixed step). So the hint says LEFT SIDE, DRAG TO LOOK for all of its 6.5 s while a drag can't answer, as it did for SECOND THUMB. The low shot is the opening's own, and it never lifts inside 320 m of the bridge, which is everything after about 6 s. If a stranger reads that as broken, the hint wants to wait for the bridge.
- **A right flick beside a resting left thumb is steering.** A stroke out of the zone is only lone with nothing else down. The left thumb has the flick.
- **A false flick down with turbo on ends all of it.** One quick pull at level 3 is six flicks to get back, with no take-back. That one flick ends all of turbo is the producer's ruling, and on the flying thumb it is the dearest false flick there is. If the phone shows it, this wants looking at before the firm rule does.
- **A stroke that lands on MEGA is MEGA's,** and MEGA sits in a right thumb's reach. It steers there, and doesn't shift.
- **A grip that lands first is still a touch.** A fingertip in the right band, out of the zone, flies, and the thumb that lands next looks until it lifts. In the zone it flies nothing, but one resting anywhere keeps a fresh stroke from being lone, so no flick. One hand's grip could do either. Nothing has shown it, and only a phone can say.
- **A first run's quick push on either side now says TURBO AFTER THE BRIDGE under the gate,** and fires Express after it. The study wanted the flying thumb's flicks off until taught; the producer's ruling has them on.
- **A left thumb that lifts past 230 ms with nobody flying by then can still tap.** With nobody flying a tap lasts 450 ms, so a left thumb down 430 ms beside a right tap makes two splats, as two thumbs tapping in a row can (below).
- **A look has no timeout.** A thumb held dead still sends nothing, so a clock can't tell it from a lost one, and a look that let go at 8 s under a still thumb was worse than what it guarded against. A lost touch is retired by the last touchend, a touchcancel, a repeated id or a primary landing.
- **Two thumbs tapping in a row can splat twice**: a still first thumb past 230 ms lifts as a tap, and the second lifts as its own, which the breath's cooldown answers with a denied sound. Main fired the second on its landing and left the first quiet. Narrow, and it needs a flag to tell the two apart.
- **A latched turbo strains as a held one did**: the rattle and the backfire puffs stay on until a flick down. If it wears on the phone it wants its own lower strain.
- **A turbo level at Cruise or Express over the rooftops** is 146 to 224 m/s at the floor, and it holds the city's level of detail, as any speed past the surge does (`Controls.tearing`). What arrives under a latched turbo is coarse: every region by about 17 game seconds at level 3, 12 of 15 by 22 at level 1. Level 1 used to be the plain surge and held nothing. It reads well enough at that speed from here; if it doesn't on the phone, the hold wants a higher line than the surge.
- **The engine hears a surge at Cruise's turbo and at Express**, so a double flick is never quieter than one. It gives way to the turbo voice from 224 m/s to Jet's speed, so a gear down from Jet doesn't swell the wind. Nobody has heard this but the numbers.
- **Full up at the street is empty sky.** At 45 degrees the horizon has just left the frame, and the sky has nothing in it until SKY's S5. Looking up at the sun shows the sky function's glow bigger than it has ever been seen, with its dithered edge. By day the look's first pay-off is the paint behind you.
- **The lens has no collision.** Downtown it can lose the bus behind a tower, 13 to 21 % of side and rear looks in FiDi, or stand inside one, 3 to 4 % [model, 8 m cells]. Buildings draw front faces, so from inside one it sees out. Over a steep hill a look back stands the lens uphill of the bus. Nothing guards that yet, and nothing has shown it.
- **A rotation can't be snapped.** Up high, a thumb creeping under about 11 degrees a second makes the frame crawl [model]. At the street the frame is moving anyway. If it swims on the phone, step the look's target in small detents up high.
- **What glints after a look** is a fresh pick: the view comes back to the pixel, the sticky target needn't.
