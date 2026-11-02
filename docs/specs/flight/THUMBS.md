# THUMBS: two thumbs, no new buttons

The producer, 2026-11-01: "dont add the gear strip. dont add right thumb flicks. yes, remove the turbo button, replace with two quick flicks - its intuitive enough... lets remove tilt steering completely - i dont like it." And: "yes, the boost stays on until you flick down, and if we're getting funky - lets say that turbo can be 'boosted' more until youre in max top gear." And earlier: "I don't want to add a button/joystick o anything, I just want it to be intuitive to pick up and fly."

**State.** On `feat/thumbs`, off `feat/nose` 08dd842. Built: the two thumbs, flicks, turbo's latch and levels, the undo, the look, the aim that follows it, the flick's pop, the first run's hint; TURBO, its tab and tilt gone. Nothing here has run on a phone. Every thumb number below is a model or a guess until the producer's thumb says otherwise.

## The rule

The first thumb flies. Any other thumb looks, shifts and taps, and never touches the flight. A thumb that stays down steers or looks; a thumb that lifts fast is a command. Which thumb is which goes by order, never by a line, so one thumb never meets any of this.

| Touch | First thumb: flies | Second thumb |
|---|---|---|
| Who it is | First finger down, anywhere, either side, exactly as ever | Any finger landing while the first is down |
| Tap | Splat on its lift, up to 450 ms | Splat on its lift, up to 230 ms |
| Two fingers tapped together | One splat | Same |
| Drag that stays down | Steers: the same bungee, pull and push | Looks, after 100 ms and 12 px, from where it landed |
| Resting still | Past 450 ms, dead straight | Nothing |
| Lift after a drag | The bus flies on | The view goes home |
| Quick flick up | Never | Gear up. Two within the window: turbo |
| Quick flick down | Never | Takes back a waiting gear, else ends turbo, else gear down |
| Three fingers | Tuner | Tuner |

Two lone touches, because the bus flies on by itself with no thumb down:

- **The memory.** For 30 s after two thumbs were last together, a lone touch on the far side from the flying thumb is the second thumb, so lifting the flying thumb doesn't turn the look thumb into a steering thumb. Far means the side of the midline the other thumb was on, by which way round the two landed, so a left-hander's works too.
- **The lone stroke.** A fresh stroke landing on the left half that lifts fast is a flick, on a firmer rule, with no other thumb needed. It steers from its first pixel until the lift decides: steering never waits for a verdict. A stroke on the right half is never a flick. BUTTONS: SWAP mirrors the side.

A thumb that lands during a lone stroke which turns out to be a flick flies from there: the flick was a command, not a flying thumb. MEGA is what it was: tap, hold charges, slide steers. It catches its own touches, so a stroke that starts on it is MEGA's.

## Reading a flick

The landing and the lift, nothing between: distance over contact time, not peak speed, so it holds at 30 fps. One touch is one reading, so the return stroke never counts.

| Rule | At least | At most | Average, at least | Within of vertical |
|---|---|---|---|---|
| Second thumb | 30 px | 230 ms | 0.25 px/ms | 50 degrees |
| Lone stroke | 36 px | 200 ms | 0.4 px/ms | 40 degrees |

A stroke landing within 40 px of the bottom is never a command, because iOS owns that edge; nor within 20 px of a side. It still steers, looks or taps. A mouse never flicks.

Both rules are model numbers, from the study's invented strokes: second thumb 98 % of practised flicks, 74 % of new ones, 0.7 false gears per 10 minutes; lone stroke 90 and 47 %, 3.1 false [model, no real thumb].

## Turbo

Turbo is the boost, latched: on until a flick down, with no thumb held, at any gear and height. Gears lift you, turbo doesn't. On the path (`NOSE.md`) a pull with turbo on sends the bus up the nose.

- **It stacks.** Two more quick flicks add a level, up to `config.turbo.levels` entries. Past the last: LOCKED, and the level stands.
- **A first flick up** answers at once, seen at the bus and heard: a small ring of the boom's vapor and a clunk, because a silenced iPhone hears nothing. Its gear waits 320 ms for a second flick. The window runs from the first's lift to the second's landing, and a stroke landing inside it holds the gear until its own lift.
- **A second flick** drops the waiting gear and turns turbo on, or adds a level. A flick up with turbo on and no second one is a gear, and turbo stays.
- **A flick down never waits.** It takes back a waiting gear, leaving turbo as it was. Else one flick ends all of turbo; the next drops a gear. A gear still lifting hasn't bitten: that flick takes it back too, and the bus settles to where it was by its own sink or hold, 5 s from a flick 0.4 s late, 20 s from one 1.5 s late, with nothing to fly. Once a gear has bitten it holds the height, as ever.
- **LOCKED** can only come out of a gear that really goes, so it never shows before the window has closed.
- **The opening.** A flick under the gate answers TURBO AFTER THE BRIDGE and fires after the gate; a flick down takes it back, inside the window or after it. A double under the gate is turbo: G0's surge lifts nothing.
- **The map's edge.** The fade reads what is being driven at, gear and level, at G0 too.

| Level | G0 (m/s) | G1 (m/s) |
|---|---|---|
| Off | 30 cruise | 450 |
| 1 | 112, the full surge | 585 |
| 2 | 146 | 720 |
| 3 | 190 | 900 |

Measured in the game at a fixed step, full belly: 112, 145.6, 190.4 and 584, 719, 898. Full pull with turbo on: 111.6 up at level 1, 189.7 at level 3, both at 85 degrees. Run east at the map's edge in G1: 736 m past it at most at every level, the same as no turbo, 225 m/s at the edge at level 3 (with the reach reading the gear's speed alone: 843 m, 531 m/s).

## The look

A second thumb that stays down turns the view round the bus. On the lift the view goes home: there is no stay-where-you-left-it. Nothing is drawn for it. `CameraRig.setLook` keeps one yaw offset and one pitch offset on the wall clock, so a hit-stop doesn't stall them, and `applyLook` lays them over the finished pose. The rig's own state never hears of it.

- **Geared like a second bungee.** The thumb's offset from where it landed sets the angle, 1 degree per px, and thumb up looks up. Sideways is the full circle with no stop: 270 px is a quarter turn the other way, and home goes the short way round. Up stops at 45 degrees and down at 50, and past a limit the landing is dragged along behind the thumb, so turning back answers at once.
- **A flick doesn't swing it.** The thumb waits 100 ms and 12 px, but a flick can last longer than that, and only its lift says it was one. So a look eases in over `lookEaseIn`, 0.2 s, and goes home from a stand. A 74 px flick of 120 ms moves the view under 1 degree at 60 and 30 fps, of 150 ms 3 to 4, of 180 ms 5 to 10 [model strokes through the real rig]; with neither, those were 42, 53 and 51 [model]. A drag reaches 90 % of a fast 90 px in about 0.33 s, against 0.25 [model].
- **The bus stands where it stood.** Sideways and down, the whole pose turns about the bus. The follow's lag goes round with it, so the lead the study wanted at speed has nothing left to do: a look can't push the bus off its spot, at G1 or at 900 m/s, in a turn or not. Zoom and distance don't change.
- **Up, the lens tilts where it is.** Lowering it would stand it among the roofs. The bus leaves by the bottom of the frame past about 19 degrees [model, research-render 6.2], and the floor flies it meanwhile: a glance, not a place to live.
- **Down goes over the bus**, the move a dive makes. The two add, and the view's pitch stops at `lookViewMax`, 86 degrees: past straight down it would turn over.
- **Home is exact.** A critically damped spring, stepped exactly, so the path is the same at any frame rate. It arrives at exactly 0, and at 0 `applyLook` doesn't run: settled, the rig is what it was.
- **A look is not a thumb.** It never sets `state.thumb`, never teaches DRAG, and flight doesn't know it happened.
- **Off under the opening's low shot:** the angle is scaled by `1 - openingLow`.
- **The stream stays on the heading**, so a glance behind doesn't drop what the bus is flying into. A look held 2 s takes it along at 2 per s, and it comes home with the view. The shadow's window follows the view from the first frame.

Measured with the real rig. Twin flights, one looking, the other not (`tools/feel-sim/s_look.ts`): cruise, turning, climbing, G1 and a dive, 480 frames each; from the frame the look is home every camera number is identical, and the flight's are identical on every frame. The bus against its twin at 90, -90, 120, 180 sideways and 50 down, at cruise, surge, G1, G1 level 3 and turning at G1: under 0.5 px of the 240 x 520 frame, same distance. Home, from the lift:

| From | Within a game pixel (s) | Exactly home (s) |
|---|---|---|
| 30 sideways | 0.97 | 1.27 |
| 90 sideways | 1.12 | 1.40 |
| 180 sideways | 1.20 | 1.48 |
| 45 up | 1.02 | 1.32 |
| 50 down | 1.03 | 1.33 |

In the real page, real CDP thumbs (`tools/controls.mjs look`): the bus 0.5 across and 0.588 to 0.596 down the frame through every street look but up, 0.513 to 0.528 in G1. With the game clock standing and the look running on the wall clock, three looks at the street and three at 1,200 m: the camera's matrix is the same to the digit and the frame the same pixel for pixel, and it stays still.

## The aim

A tap goes where the view looks, sideways only, out to `lookAimMax`, 100 degrees each side, and down the nose past that: no tail gun. `CameraRig.aimYaw` turns `Aimer`'s heading and nothing else, so the ray, the pick, the hold, the wall in the way and the hose all follow, and because the view and the aim turn about the same point the glint stays in its usual spot on the screen while the world turns under it. The jet still leaves the mouth. Looking up or down changes nothing about where a tap goes.

You can't hold a look and tap with the same thumb. The flying thumb lifts and taps, the look thumb holding the view: the bus flies on by itself for that moment. A real page's tap at 70 degrees hit the building that glinted. Over the real city, four places, nine looks each: all 36 hit what glinted, and every shot off the nose landed within 14 degrees of where the view looked. A shot down the nose scatters 22 there: the shot lands on the building, not on the line.

## The pop

A first flick answers at once, seen at the bus: the boom's vapor ring, small, and a hiccup in the bus's own body on the breath's squash spring. The ring rides along with the bus, so at 450 m/s it stands round it for about a quarter of a second before it slides back, and it is as big on screen at any height. Turbo's ring is the same, bigger. A silenced iPhone hears nothing, so this is the only answer it gets.

## The hint

On the first run's intro, once ever, a beat after the fog has lifted, four lines in the toast's slot for 6.5 s, and touches pass through it:

```
SECOND THUMB
FLICK UP FOR GEARS
TWO FLICKS TURBO
HOLD TO LOOK
```

It asks for nothing and nothing ends it but its own time, or a line that matters more: a flick under the gate answers over it. The gate's own CLIMB line waits for it. `taught` bit 32; an old save gets it once, which is right, because that player's TURBO has just gone. Off wherever the first run is off, and a desktop gets its keys in the keys toast instead. Nothing else on the screen teaches any of this: the gestures are hidden, the producer's call.

## Keyboard and mouse

E or PageUp is a flick up, so E twice within the window is turbo. Q or PageDown is a flick down. Shift holds level 1 while held, whatever the latch says, and ends nothing. A right mouse drag looks, from its first pixel. The left mouse is the bungee and never a flick.

## What's tunable

On the tuner (`?tune`), group Input, read live: `secondTapMs` (230), `lookDelayMs` (100), `lookLostMs` (8000: a look that has heard nothing from its thumb lets go until it moves, because an edge swipe can lose a touch with no touchend), `memoryMs` (30000), `flickPx`, `flickMs`, `flickSpeed`, `flickDeg`, `loneFlickPx`, `loneFlickMs`, `loneFlickSpeed`, `loneFlickDeg`, `flickBottomPx` (40), `flickSidePx` (20), `doubleMs` (320). In `config.turbo`: `levels` ([1.3, 1.6, 2]) and `levelsG0` ([1, 1.3, 1.7]), not on the tuner: it shows numbers, and these are lists.

On the tuner, group camera: `lookDegPerPx` (1), `lookInvertY` (off: thumb up looks up, the opposite of the yoke, where thumb down climbs), `lookUp` (45), `lookDown` (50), `lookFollowHz` (4.5), `lookHomeHz` (1.4: home in about 1 s), `lookEaseIn` (0.2), `lookViewMax` (86), `lookAimMax` (100), `lookStreamAfter` (2), `lookStreamRate` (2).

## The ladder, not built

Six rungs, the top one being gear six: the last gear with all of turbo on, so that "max turbo boost is essentially gear six". Then one extra boost, unlocked rather than flicked, that makes the Moon about 5 minutes: 384,400 km in 300 s is about 1,280 km/s. G2 and G3 stay locked behind `config.turbo.worldTravel`, and nothing of the unlock is built. A level past the last says LOCKED today, which is the right word for when it exists.

## Left on purpose

- **Nothing is on screen for a gear** but the readout's moment: no strip, no pips added, no button. A hidden gesture is the producer's call, and the hint on the first run is all the teaching there is. The study's worry stands: a new player may never find gears. Only a stranger's two minutes can say.
- **A one-handed player** gets no look, and flies right-handed with no flicks unless they use SWAP.
- **A resting left thumb that lands first is the flying thumb**, and the right thumb then looks. That is the order rule.
- **A latched turbo strains as a held one did**: the rattle and the backfire puffs stay on until a flick down. If it wears on the phone it wants its own lower strain.
- **A level at G0 over the rooftops** is 190 m/s at the floor. Never flown by a thumb.
- **Full up at the street is empty sky.** At 45 degrees the horizon has just left the frame, and the sky has nothing in it until SKY's S5. Looking up at the sun shows the sky function's glow bigger than it has ever been seen, with its dithered edge. By day the look's first pay-off is the paint behind you.
- **The lens has no collision.** Downtown it can lose the bus behind a tower, 13 to 21 % of side and rear looks in FiDi, or stand inside one, 3 to 4 % [model, 8 m cells]. Buildings draw front faces, so from inside one it sees out. Over a steep hill a look back stands the lens uphill of the bus. Nothing guards that yet, and nothing has shown it.
- **A rotation can't be snapped.** Up high, a thumb creeping under about 11 degrees a second makes the frame crawl [model]. At the street the frame is moving anyway. If it swims on the phone, step the look's target in small detents up high.
- **What glints after a look** is a fresh pick: the view comes back to the pixel, the sticky target needn't.
