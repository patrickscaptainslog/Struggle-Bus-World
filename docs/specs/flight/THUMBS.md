# THUMBS: two thumbs, no new buttons

The producer, 2026-11-02, after flying it on an iPhone 17 Pro: "The sensitivity is too high for the camera panning. Other than that good. Let's just get rid of the double swipe for now and just gear it up with single swipes into turbo, I do think there needs to be at least one more gear before entering turbo though". To them "turbo" is what Jet feels like: they had said a single flick "goes straight to turbo" when it went to Jet. That overrules "two quick flicks" below, which stays here as what was said: one flick is one rung now, [Gears](#gears) has the ladder and [The look](#the-look) the gentler thumb.

The producer, 2026-11-02, after flying it on an iPhone 17 Pro: "Looking around should take two thumbs to be necessary, yes two thumbs sure, but also just any thumb movement in left thumb area of the screen by itself should do it as well". Earlier they had put it as "Right thumb/center control" flies, and the left thumb looks. That overrules the order rule and "one thumb gets no look": the left of the screen looks, on its own.

The producer, 2026-11-02, after flying it: "I want the swipe gear changes to also work with my right thumb. I want to be able to play this with one thumb." That overrules "dont add right thumb flicks" below, which stays here as what was said.

The producer, 2026-11-01: "dont add the gear strip. dont add right thumb flicks. yes, remove the turbo button, replace with two quick flicks - its intuitive enough... lets remove tilt steering completely - i dont like it." And: "yes, the boost stays on until you flick down, and if we're getting funky - lets say that turbo can be 'boosted' more until youre in max top gear." And earlier: "I don't want to add a button/joystick o anything, I just want it to be intuitive to pick up and fly."

**State.** On `feat/thumbs`, off `feat/nose` 08dd842, main merged in. Built and reviewed: the two thumbs, flicks, turbo's latch and levels, the undo, the look, the aim that follows it, the flick's pop, the first run's hint; TURBO, its tab and tilt gone. The producer flew that build on an iPhone 17 Pro, 2026-11-02: "New thumb controls work great! Very intuitive." Their first note is [Gears](#gears), and Express, its answer, hasn't been on a phone. Their second is [One thumb](#one-thumb), which hasn't either. Their third is the left zone, in the rule below, which hasn't either. Their fourth is at the top of this file: one flick a rung, Nonstop, and the look's curve, which haven't either. Nothing was measured on those flights, so every thumb number below is still a model or a guess.

## The rule

**2026-11-04 evening, going live, the producer: "Ok I want to go live, but while playing, I want the area surrounding th bus for bus control to be a touch larger, especially the area below the bus - anywhere a player touches in the general vicinity below the bus belongs to control of bus - not pan- as that's where the thumb naturally lies."** So the lane is bigger and opens out under the bus. Over the bus's line it is a half disc 0.27 of the screen's width round the bus (`laneHalf`, 106 px on a 393 px screen). From the bus's line down it is a funnel: its sides run out from the half disc's to the screen's edges a quarter of the screen's height under the bus (`laneOpen`, 213 px on an 852 px screen), and it is the whole width from there to the bottom. A touch landing in it flies, so a thumb resting anywhere in the lower part of the screen flies. A look is a touch landing over the bus's line, out of the half disc, or out to a side beside the bus, where the funnel hasn't opened that far yet. The lane stays on the screen: the bus counts as no lower than the half width over the bottom edge and no higher than the top, and a bus that low opens out sooner, so the bottom 106 px are always the whole width (a look up past about 20 degrees puts the bus under the bottom edge). And the bus counts as no lower than its usual line, 0.6 of the height (`laneLow`): the strain at the 15 km ceiling tips the view up and sinks the bus to about y 830, and the lane following it there left a thumb landing again at (320, 690) looking, where the thumb rests, which doesn't move with the bus. The two names are new, in place of `busLane` (0.22), so a value a phone's tuner saved for the old lane can't hold it. That overrules the 0.22 column in the next paragraph, which stays as what was built first.

**2026-11-04, the producer: "Yes San Francisco should work the same, replacing the left side look".** The zone below is the bus's lane now, on the street as on `feat/moonfree`'s way to the Moon, where it began: a touch landing near the bus flies, in a lane from just over the bus down to the bottom of the screen, 0.22 of the screen's width either side of it (`Input.busZone`, set each frame from where the bus stands on the screen; `inputTune.busLane`), and a touch landing anywhere else is the second thumb, which looks. Read "out of the zone" below as "in the lane", and "in the zone" as "anywhere else"; everything else in this section holds as it was. The left 42 % is what's left when no bus has said where it is.

The left of the screen looks and the rest flies. A touch landing in the left 42 % of the screen's width (`lookZone`, the right 42 % with BUTTONS: SWAP) never flies. There, alone or beside a flying thumb, it is a second thumb. Anywhere else the first thumb flies, and a thumb landing while it does is a second thumb too. A second thumb looks, shifts and taps, and never touches the flight: the bus flies on by itself. A thumb that stays down steers or looks; a thumb that lifts fast is a command. Two thumbs in any order: the one in the zone looks and the other flies.

| Touch | First thumb: flies | Second thumb |
|---|---|---|
| Who it is | First finger down out of the zone, exactly as ever | Any finger landing in the zone, alone or not, or anywhere while something flies |
| Tap | Splat on its lift, up to 450 ms | Splat on its lift, up to 230 ms; with nobody flying, up to 450 |
| Two fingers tapped together | One splat | Same |
| Drag that stays down | Steers: the same bungee, pull and push | Looks, after 100 ms and 12 px, from where it landed |
| Resting still | Past 450 ms, dead straight | Nothing |
| Lift after a drag | The bus flies on | The view goes home |
| Quick flick up | Only a fresh stroke with no other thumb down, on the firm rule: the same as the second thumb's | One rung up, at once |
| Quick flick down | The same | One rung down, turbo first |
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

A stroke landing within 40 px of the bottom is never a command, because iOS owns that edge; nor within 20 px of a side. It still steers, looks or taps. A mouse never flicks.

Both rules are model numbers, from the study's invented strokes: second thumb 98 % of practised flicks, 74 % of new ones, 0.7 false gears per 10 minutes; lone stroke 90 and 47 %, 3.1 false [model, no real thumb]. That 0.7 is a second thumb's strokes, from before a thumb could look alone: a glance up or down in the left zone that lifts fast is a gear, and nothing has counted those.

## Gears

The producer, on the phone: "swiping up goes straight to turbo - I thought a swipe up meant a gear twist and double swipe meant turbo?" The flick was doing what it said: it waited 320 ms and shifted one gear. But the only gear above Cruise was Jet, 15 times its speed and what the old TURBO button gave. So Express went in between them. On the next phone it was "at least one more gear before entering turbo", so Nonstop went in over Express, and the double went.

One flick is one rung, up or down, at once. The readout names each one:

| Rung | m/s | Needs | Unlocked |
|---|---|---|---|
| G0 CRUISE | 30, 112 surging | nothing | always |
| G1 EXPRESS | 112, about 250 mph | nothing | always |
| G2 NONSTOP | 225, about 500 mph | 60 m | always |
| G3 JET | 450 | 150 m | always |
| STRATOS | 4,500 | 2 km | `config.turbo.worldTravel` |
| RAINBOW WARP | 30,000 | 10 km | `config.turbo.worldTravel` |
| TURBO, TURBO 2, TURBO 3 | the top gear x 1.3, 1.6, 2 | no more than the gear | over the top gear in reach: G4 to G6 today |

- **A gear starts on the flick.** There is no second flick to wait for, so there is no window: the gear goes the moment the stroke lifts, with its pop and its clunk.
- **Express is the surge with no thumb on it** (`config.flight.surgeSpeed`). No height, no floor, no lift: it rides the rooftops as a held surge does, 0.3 m from one at worst over 8 s of Alamo Square's blocks. It comes up at the surge's rate, not a gear's spool, because a surge must never feel like a brake. It is in on the shift, so it has no `engage`: a clunk, a rush and a small kick, and the speed.
- **A flick down out of Express is the surge let go.** The bus slows at the classic rate and goes on doing what it was doing, skimming or holding. Out of Nonstop or Jet it brakes and holds the height, as a gear always has. So a flick down steps Jet to Nonstop to Express to Cruise, and a bus that has only ever skimmed roofs goes on skimming them.
- **Nonstop is a low lift:** 60 m over the ground (`nonstopAlt`) against Jet's 150, climbing at 50 m/s (`nonstopClimb`). Over low roofs it bites about 1 s after the flick, 40 m up within 1.5 s, the bus pitched up 17 degrees at most, and then it spools to 225. At 30 m/s that was 1.4 s and 12 degrees, a drift; at 75 m/s, Jet's rate, 0.8 s and 20, more a hop than a lift. Downtown the roofs stand over 60 m and it rides those: 123 m over the ground, 32 over the roofs, six seconds east of Alamo Square. It holds the city's level of detail, as anything past the surge does.
- **A pull goes up the nose** in any gear: Express 111.6 m/s up, Nonstop 224, Jet 448, all at 85 degrees. A gear drives through what a thumb's surge doesn't: the full belly's 12 %, a charge's weight, the firehose's recoil.
- **The hop is a ramp.** A gear still lifting drives the rung under it: Nonstop lifts at the surge, Jet at Nonstop's 225, then each spools from there. So no flick gives speed back, at any spacing [real Flight, Alamo Square, from the rooftops at Cruise]:

| Flicks apart (s) | Speed at each flick (m/s) | Nonstop bites | Jet bites, at | At 8 s | Speed given back |
|---|---|---|---|---|---|
| 0.1 | 27, 49, 51 | passed by | 1.8 s, 199 m/s | 450 | 0 |
| 0.4 | 27, 87, 96 | 0.8 s | 2.2 s, 204 m/s | 450 | 0 |
| 1 | 27, 108, 166 | 1.5 s | 3.4 s, 215 m/s | 450 | 0 |
| 2 | 27, 112, 201 | 2.6 s | 5.3 s, 221 m/s | 442 | 0 |

- **The rest follows the speed.** The lens, the speed lines, the contrail and the voice all read `speedK`, the speed on a log scale from the surge to Jet, and Nonstop is its middle. The engine hears a surge in any gear, lifting too, so a lift doesn't drop the wind, and gives way to the turbo voice from 225 m/s to Jet's speed, so a gear down from Jet doesn't swell it. In the real page, at each rung:

| Rung | `speedK` | Contrail | Speed lines | Lens pulled back, wider | Engine's surge | Turbo voice |
|---|---|---|---|---|---|---|
| Express | 0 | none | their first two of 90 | none | 1 | detached |
| Nonstop lifting | 0 | none | their first two of 90 | none | 1 | strain |
| Nonstop | 0.5 | half | two thirds | 12.5 m, 2.5 degrees | 1 | half |
| Jet lifting | 0.5 | half | two thirds | the same | 1 | half, strain |
| Jet | 1 | all | all | 25 m, 5 degrees | 0 | all |

## Turbo

Turbo is the top of the ladder: TURBO, TURBO 2 and TURBO 3 are the rungs over the top gear in reach, its speed x `config.turbo.levels`. Today that is Jet. With `worldTravel` on the gears go on, and they sit over Rainbow Warp. Cruise, Express and Nonstop have none of their own. It stays on with no thumb held, as every rung does, and Jet and up lift you where turbo doesn't. On the path (`NOSE.md`) a pull with turbo on sends the bus up the nose.

- **A flick up answers at once,** seen at the bus and heard: a small ring of the boom's vapor and a clunk, because a silenced iPhone hears nothing. Its gear or its level goes with it. A flick into turbo also gets turbo's own bigger ring.
- **Past the last rung it says LOCKED,** on the flick, and the level stands. That is its own answer, so it has no pop: the pop says a rung went.
- **A flick down drops exactly one rung, turbo first.** It no longer ends all of turbo at once, so a false flick down at TURBO 3 costs one rung. Any rung with a height brakes all the way down to the next at the gear's rate, not the classic one: 14 m/s per 100 ms at worst between turbo's levels, 21 from Jet to Nonstop.
- **A gear still lifting hasn't bitten:** a flick down takes it back, and the bus settles to where it was by its own sink or hold, at 9 m/s at most, with nothing to fly: 21 m over the rooftops after 0.8 s of Nonstop's lift. Jet still lifting over Nonstop goes back to Nonstop's floor. Once a gear has bitten it holds the height, as ever.
- **The opening.** A flick under the gate answers GEARS AFTER THE BRIDGE, waits, and fires after the gate, and the line goes when the rung does. One rung waits, however many flicks: every flick is answered, but the gate says when, it isn't a queue, so six flicks under it are Express at the bridge, not TURBO 3 (they were, until 2026-11-04). A flick down takes the waiting one back and says GEAR OFF. Express lifts nothing, but it waits like any gear: the gate has one rule and one line. Both lines said TURBO, from when the button was TURBO.
- **The map's edge.** The fade reads what is being driven at, gear and level. Express is the surge, which has nothing to fade.

| Rung | Measured (m/s) | Speed at the map's edge (m/s) |
|---|---|---|
| Express | 112 | 112 |
| Nonstop | 225 | 175 |
| Jet | 450 | 208 |
| TURBO | 584 | 216 |
| TURBO 2 | 719 | 221 |
| TURBO 3 | 898 | 225 |

Measured in the game at a fixed step, full belly, 4 s at each level. Run east at the map's edge: 735 m past it at most at every rung, the same as Express, because turbo's reach reads the speed it is driving at (reading the gear's speed alone gave 843 m past it at 531 m/s, at the old ladder's level 3). Full pull at TURBO: 583 up, TURBO 3: 897, both at 85 degrees.

## One thumb

One thumb out of the left zone, in either hand, has everything but the look: the whole ladder, up and down, every tap. One thumb in the zone has everything but the steering: the look, every flick, every tap. There is no setting and nothing on screen changes: a second thumb landing is a second thumb, as ever.

### What a flick costs the flight

A flick out of the left zone steers until it lifts, because steering never waits, and the bus flies on from where the stroke left it. A flick in the zone costs nothing here: it never touches the stick, so a right thumb's flick is the only one this section is about. Model strokes through the real Flight at a fixed step, each against a twin with no stroke, the stick at the stroke's full distance by 85 ms and held to the lift:

| | Flick, 74 px, 85 ms | Quick dab, 46 px, 110 ms | The rule's limit, 80 px, 200 ms | A pull held 800 ms |
|---|---|---|---|---|
| Nose on the path (degrees) | 9 | 5 | 25 | 62 |
| Height at Cruise (m) | 3 | 2 | 9 | 34 |
| Height at Express (m) | 8 | 5 | 24 | 98 |
| Height at Nonstop (m) | 17 | 10 | 47 | 197 |
| Height at Jet (m) | 33 | 19 | 93 | 392 |
| Height at TURBO 3 (m) | 64 | 37 | 186 | 784 |

A flick up is a push, so that height is lost. At the rooftops a push surges instead: up 10 m/s for a moment, no height.

A flick down is a pull, so the bus rises that much, and then it goes back. A pull's release chooses a hold, and that would have unhooked the bus from the rooftops until the next push, at the height of whatever roof it was on, the thing Express was built not to do. A Jet still lifting, taken back after 1 s, held 131 m over Alamo Square. So when a lone flick down has something to do, what its pull chose goes back as the bus lets go of it (`Flight.unpull`): out of Express, a turbo level down, a gear still lifting, it goes on skimming or holding as it was, the same as a second thumb's. Three things stand: out of a gear that bit it holds the height, as ever, with the stroke's own rise in it; with nothing to do a flick down is the quick pull it looks like; and a stick that moves first has chosen for itself. On a path the stroke didn't start there is nothing to go back to, so a dive's arc doesn't rebound.

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
- **A false flick is one rung.** Then one was Jet. From Cruise it is Express now, a surge with no height, and a flick down leaves the bus as it was. It has no window to be caught in any more: it goes on the flick, so a flick down is what catches it, with the height held within 5 m, in the real Flight, holding 400 m:

| Flick down after it | Express to Nonstop: speed by then, further than a twin | Nonstop to Jet: speed by then, further than a twin |
|---|---|---|
| 0.25 s | 126 m/s, 6 m | 252 m/s, 33 m |
| 1 s | 186 m/s, 103 m | 372 m/s, 242 m |
| 4 s | 224 m/s, 456 m | 448 m/s, 944 m |

The phone decides this, against the study's bar: under 1 false launch per 10 minutes, at least 80 % of real flicks caught. If it fails on false shifts, `loneFlickPx` moves first: 46 px saves a quarter of them for 7 points of practised flicks.

A stroke is read on its own. The double's easier rule for a stroke right after a flick (`loneAgainMs`) went with the double, so every flick of a run on the flying side is on the firm rule: 90 % practised, 48 % new, each [model]. Six in a row is about 53 % practised if they're independent, which a hurried run probably isn't. In the left zone, alone or not, every stroke has the second thumb's rule.

### What only a phone can say

How far a right thumb's natural arc leans from vertical (the model has 14 degrees and the cone is 40: `loneFlickDeg`), and how often it lands in the bottom or side band, which are near where a right thumb rests. Whether a run of flicks up the ladder on one thumb drops some, now each is on the firm rule. Whether a thumb pumping the surge in quick pushes climbs gears: a push that reads as a flick is a rung, at once. Whether 225 m/s is the right middle, and whether Nonstop's lift reads as a lift. Whether a clunk and a whoosh together, and a pop with a gear's own kick on the same frame, read as one shift. Whether the lane's funnel is the right shape: a left thumb resting low on the left flies now, so a look is a reach up over the bus's line or out beside it, and how often a thumb meaning to look lands under the line (`laneHalf`, `laneOpen`). Where the line belongs (when no bus has said where it is): 42 % is 169 px on an iPhone 17 Pro, so does a right thumb reaching across land left of it and look when it meant to fly, and does a left thumb reaching in land right of it and fly when it meant to look (`lookZone`)? How often a quick glance on the left is a gear, on the second thumb's easy rule. Whether a left thumb that means to rest creeps past 12 px and swings the view. And all of the above.

## The look

A thumb in the left zone, or any second thumb, that stays down turns the view round the bus. On the lift the view goes home: there is no stay-where-you-left-it. Nothing is drawn for it. `CameraRig.setLook` keeps one yaw offset and one pitch offset on the wall clock, so a hit-stop doesn't stall them, and `applyLook` lays them over the finished pose. The rig's own state never hears of it.

- **Geared on a curve.** The thumb's offset from where it landed sets the angle, a x + b x^3: `lookDegPerPx`, 0.4 degrees per px at the start, reaching 180 degrees at `lookFullPx`, 260 px of thumb travel. A small nudge is a small look, and the full look behind is still there. It was a straight 1 degree per px, and that was "too high". Thumb up looks up. In the real rig:

| Thumb travel (px) | 25 | 50 | 100 | 165 | 260 |
|---|---|---|---|---|---|
| Degrees | 10.1 | 20.5 | 44.3 | 85.4 | 180 |
| It was | 25 | 50 | 100 | 165 | 260 |

- **Sideways is the full circle with no stop:** about 320 px is a quarter turn the other way, and home goes the short way round. **Up and down have the same gentle start,** and stop at 45 degrees, 101 px up, and 50, 110 px down. Past a limit the landing is dragged along behind the thumb on the thumb's own scale, so turning back answers at once, at the curve's rate: 10 px back from the top is 5.2 degrees.
- **Calm.** The view follows the thumb on a critically damped spring, `lookFollowHz`, down from 4.5 to 3. The curve did most of it. The slower spring halves how much a long look swims with a thumb's tremor, for 36 ms more behind the thumb, and it still reads as attached: at 2 Hz the view trails by 147 ms, at 3 Hz by 108. A thumb's ±1 px at 8 Hz moves the view 0.3 degrees at 260 px, against 0.59 [model strokes through the real rig, at 60 fps]:

| Stroke | Peak rate, then (degrees/s) | Peak rate, now | 90 % there after the thumb stops (s) | Overshoot |
|---|---|---|---|---|
| A nudge, 25 px in 150 ms | 183 | 58 | 0.18 | none |
| Fast, 90 px in 120 ms | 640 | 221 | 0.21 | none |
| 165 px in 250 ms | 828 | 387 | 0.15 | none |
| Behind, 260 px in 350 ms | 932 | 658 | 0.13 | none |

- **A flick doesn't swing it.** The thumb waits 100 ms and 12 px, but a flick can last longer than that, and only its lift says it was one. So a look eases in over `lookEaseIn`, 0.2 s, and goes home from a stand. A 74 px flick of 120 ms moves the view under 0.3 degrees at 60 and 30 fps, of 150 ms about 1, of 180 ms 2 to 3.5 [model strokes through the real rig].
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

A flick up answers at once, seen at the bus: the boom's vapor ring, small, and a hiccup in the bus's own body on the breath's squash spring. The ring rides along with the bus, so at 450 m/s it stands round it for about a quarter of a second before it slides back, and it is as big on screen at any height. Turbo's ring is the same, bigger. A silenced iPhone hears nothing, so this is the only answer it gets.

## The hint

On the first run's intro, once ever, a beat after the bridge, three lines in the toast's slot for 6.5 s, and touches pass through it:

```
FLICK UP FOR GEARS
STEER BELOW THE BUS
DRAG ABOVE IT TO LOOK
```

Any thumb flicks, so the flicks come first and the last two lines are the bus's lane (2026-11-04: it said LEFT SIDE, DRAG TO LOOK, and RIGHT SIDE with BUTTONS: SWAP, then STEER BY THE BUS, DRAG ELSEWHERE TO LOOK until the lane opened out below the bus). Beside the bus looks too, which the hint leaves to the thumb to find. It says DRAG because a resting thumb does nothing.

It asks for nothing and nothing ends it but its own time, or LOCKED, which takes the slot. It waits for the gate, so the gate's own lines have had their turn. `taught` bit 32; an old save gets it once, which is right, because that player's TURBO has just gone. A save that has seen it already never sees these lines. Off wherever the first run is off, and a desktop gets its keys in the keys toast instead. Nothing else on the screen teaches any of this: the gestures are hidden, the producer's call.

## Keyboard and mouse

E or PageUp is a flick up, Q or PageDown a flick down: they step the ladder. Shift held a boost, and it's gone: Cruise and Express have no turbo to hold, so it would have done nothing until the top gear. A right mouse drag looks, from its first pixel. The left mouse is the bungee, anywhere on the screen, and never a flick.

## What's tunable

On the tuner (`?tune`), group Input, read live: `laneHalf` (0.27 of the width round the bus: of the screen's narrow side, so 106 px in landscape too) and `laneOpen` (0.25 of the height under it, where the lane is the whole width; 0: from the bus's line), `laneLow` (0.6: the bus counts as no lower than this share of the height), `lookZone` (0.42; 0: no zone, and only when no bus has said where it is), `secondTapMs` (230), `lookDelayMs` (100), `flickPx`, `flickMs`, `flickSpeed`, `flickDeg`, `loneFlickPx`, `loneFlickMs`, `loneFlickSpeed`, `loneFlickDeg`, `flickBottomPx` (40), `flickSidePx` (20). In `config.turbo`: `levels` ([1.3, 1.6, 2]), over the top gear, not on the tuner: it shows numbers, and this is a list.

On the tuner, group camera: `lookDegPerPx` (0.4), `lookFullPx` (260), `lookInvertY` (off: thumb up looks up, the opposite of the yoke, where thumb down climbs), `lookUp` (45), `lookDown` (50), `lookFollowHz` (3), `lookHomeHz` (1.4: home in about 1 s), `lookEaseIn` (0.2), `lookViewMax` (86), `lookAimMax` (100), `lookStreamAfter` (2), `lookStreamRate` (2). In group turbo: `nonstopSpeed` (225), `nonstopAlt` (60), `nonstopClimb` (50).

## The ladder

What is true now: Cruise, Express, Nonstop and Jet, then Stratos and Rainbow Warp, with turbo on top of whichever of them is the top gear in reach. `config.turbo.worldTravel` is off, because the world past the map doesn't exist yet, so today TURBO sits on Jet and a flick past TURBO 3 says LOCKED, which is the right word for what's above it: G4 to G6 are turbo and the last two pips on the readout are dark. With it on, TURBO sits on Rainbow Warp, G6 to G8. Then one extra boost, unlocked rather than flicked, makes the Moon about 5 minutes: 384,400 km in 300 s is about 1,280 km/s. That boost isn't built.

## Left on purpose

- **Nothing is on screen for a gear** but the readout's moment: no strip, no pips added, no button. A hidden gesture is the producer's call, and the hint on the first run is all the teaching there is. The study's worry stands: a new player may never find gears. Only a stranger's two minutes can say.
- **A left thumb has little glass to its left.** The curve kept the reach to the right: from the middle of the zone, 85 px in on an iPhone 17 Pro, there are 317 px of thumb travel that way, 265 degrees. To the left there are 85 px, 37 degrees, where the old line had 85. The full circle is still there, the long way round, and a thumb landing at the line has 85 degrees. The brief's numbers, and the phone says whether anyone minds (`lookDegPerPx`, `lookFullPx`). SWAP mirrors it.
- **A left-handed one-thumb player can't steer until they turn on BUTTONS: SWAP.** If they only ever touch the left, they look, shift and tap, and the bus flies itself. The producer's choice. They aren't stranded: the view comes home on every lift, and SWAP is in settings. (Gone with the bus's lane, 2026-11-04: the lane is under the bus whichever hand flies it, and SWAP mirrors only the buttons.)
- **The opening's low shot has no look, alone or not.** On a first visit a left thumb that landed with the hint up, 5 s in, moved the view 0 degrees until the bus cleared the bridge at about 17 s, then 52 by 18 s and 88 by 20 (a real page, a fixed step). So the hint waits for the bridge, and never says LEFT SIDE, DRAG TO LOOK while a drag can't answer. The low shot is the opening's own, and it never lifts inside 320 m of the bridge, which is everything after about 6 s.
- **A right flick beside a resting left thumb is steering.** A stroke out of the zone is only lone with nothing else down. The left thumb has the flick.
- **LOCKED's second line says WORLD TRAVEL COMING.** True today. With `worldTravel` on, past TURBO 3 over Rainbow Warp, it wouldn't be: that wants its own line when the Moon's boost has a name.
- **The gate said TURBO AFTER THE BRIDGE and TURBO OFF** for what is now a gear, and there is no TURBO button any more. Going live it says GEARS AFTER THE BRIDGE and GEAR OFF, as short (2026-11-04). The producer's to reword.
- **A stroke that lands on MEGA is MEGA's,** and MEGA sits in a right thumb's reach. It steers there, and doesn't shift.
- **A grip that lands first is still a touch.** A fingertip in the right band, out of the zone, flies, and the thumb that lands next looks until it lifts. In the zone it flies nothing, but one resting anywhere keeps a fresh stroke from being lone, so no flick. One hand's grip could do either. Nothing has shown it, and only a phone can say.
- **A first run's quick push on either side says GEARS AFTER THE BRIDGE under the gate,** and fires Express after it. The study wanted the flying thumb's flicks off until taught; the producer's ruling has them on.
- **A left thumb that lifts past 230 ms with nobody flying by then can still tap.** With nobody flying a tap lasts 450 ms, so a left thumb down 430 ms beside a right tap makes two splats, as two thumbs tapping in a row can (below).
- **A look has no timeout.** A thumb held dead still sends nothing, so a clock can't tell it from a lost one, and a look that let go at 8 s under a still thumb was worse than what it guarded against. A lost touch is retired by the last touchend, a touchcancel, a repeated id or a primary landing.
- **Two thumbs tapping in a row can splat twice**: a still first thumb past 230 ms lifts as a tap, and the second lifts as its own, which the breath's cooldown answers with a denied sound. Main fired the second on its landing and left the first quiet. Narrow, and it needs a flag to tell the two apart.
- **A latched turbo strains as a held one did**: the rattle and the backfire puffs stay on until a flick down. If it wears on the phone it wants its own lower strain.
- **Nonstop over the rooftops** is 225 m/s low over the city, and it holds the city's level of detail, as any speed past the surge does (`Controls.tearing`). What arrives under it is coarse: every region by about 17 game seconds, measured at the same speed as the old top turbo over Express. It reads well enough at that speed from here; if it doesn't on the phone, the hold wants a higher line than the surge.
- **The engine hears a surge in every gear,** so a lift is never quieter than Express. Nobody has heard this but the numbers.
- **Full up at the street is empty sky.** At 45 degrees the horizon has just left the frame, and the sky has nothing in it until SKY's S5. Looking up at the sun shows the sky function's glow bigger than it has ever been seen, with its dithered edge. By day the look's first pay-off is the paint behind you.
- **The lens has no collision.** Downtown it can lose the bus behind a tower, 13 to 21 % of side and rear looks in FiDi, or stand inside one, 3 to 4 % [model, 8 m cells]. Buildings draw front faces, so from inside one it sees out. Over a steep hill a look back stands the lens uphill of the bus. Nothing guards that yet, and nothing has shown it.
- **A rotation can't be snapped.** Up high, a thumb creeping under about 11 degrees a second makes the frame crawl [model]. At the street the frame is moving anyway. If it swims on the phone, step the look's target in small detents up high.
- **What glints after a look** is a fresh pick: the view comes back to the pixel, the sticky target needn't.
