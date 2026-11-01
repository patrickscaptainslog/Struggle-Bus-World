# THUMBS: two thumbs, no new buttons

The producer, 2026-11-01: "dont add the gear strip. dont add right thumb flicks. yes, remove the turbo button, replace with two quick flicks - its intuitive enough... lets remove tilt steering completely - i dont like it." And: "yes, the boost stays on until you flick down, and if we're getting funky - lets say that turbo can be 'boosted' more until youre in max top gear." And earlier: "I don't want to add a button/joystick o anything, I just want it to be intuitive to pick up and fly."

**State.** On `feat/thumbs`, off `feat/nose` 08dd842. Built: the two thumbs, flicks, turbo's latch and levels, the undo; TURBO, its tab and tilt gone. The look reports its offsets to a stub in `CameraRig`: the orbit, the aim that follows it and the first run's hint are the next build. Nothing here has run on a phone. Every thumb number below is a model or a guess until the producer's thumb says otherwise.

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

## Keyboard and mouse

E or PageUp is a flick up, so E twice within the window is turbo. Q or PageDown is a flick down. Shift holds level 1 while held, whatever the latch says, and ends nothing. A right mouse drag looks, from its first pixel. The left mouse is the bungee and never a flick.

## What's tunable

On the tuner (`?tune`), group Input, read live: `secondTapMs` (230), `lookDelayMs` (100), `lookLostMs` (8000: a look that has heard nothing from its thumb lets go until it moves, because an edge swipe can lose a touch with no touchend), `memoryMs` (30000), `flickPx`, `flickMs`, `flickSpeed`, `flickDeg`, `loneFlickPx`, `loneFlickMs`, `loneFlickSpeed`, `loneFlickDeg`, `flickBottomPx` (40), `flickSidePx` (20), `doubleMs` (320). In `config.turbo`: `levels` ([1.3, 1.6, 2]) and `levelsG0` ([1, 1.3, 1.7]), not on the tuner: it shows numbers, and these are lists.

## The ladder, not built

Six rungs, the top one being gear six: the last gear with all of turbo on, so that "max turbo boost is essentially gear six". Then one extra boost, unlocked rather than flicked, that makes the Moon about 5 minutes: 384,400 km in 300 s is about 1,280 km/s. G2 and G3 stay locked behind `config.turbo.worldTravel`, and nothing of the unlock is built. A level past the last says LOCKED today, which is the right word for when it exists.

## Left on purpose

- **Nothing is on screen for a gear** but the readout's moment: no strip, no pips added, no button. A hidden gesture is the producer's call, and the hint on the first run is all the teaching there is. The study's worry stands: a new player may never find gears. Only a stranger's two minutes can say.
- **A one-handed player** gets no look, and flies right-handed with no flicks unless they use SWAP.
- **A resting left thumb that lands first is the flying thumb**, and the right thumb then looks. That is the order rule.
- **A latched turbo strains as a held one did**: the rattle and the backfire puffs stay on until a flick down. If it wears on the phone it wants its own lower strain.
- **A level at G0 over the rooftops** is 190 m/s at the floor. Never flown by a thumb.
