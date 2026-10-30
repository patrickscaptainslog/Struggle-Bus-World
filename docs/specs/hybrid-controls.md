# Hybrid Controls: the final spec (Tilt + Thumb, TURBO, MEGA)

> Built on `feat/hybrid` (DECISIONS "Hybrid controls" has what moved in the build and the numbers). Line references are to
> the feat/supersplat this was written against. The HOLD SPLAT TO CHARGE line became the HOLD cue on MEGA's face.

Status: designed from the source in `C:/Users/Utku/sbw-design` (feat/controls + feat/supersplat merged). No browser and no phone were used. Numbers marked (sim) come from `sim-final.mjs`, `sim-feel.mjs` and `sim-fixes.mjs` (the review fixes; it reproduces `sim-final.mjs`'s rows unchanged) next to this file: repo constants (yaw spring 2.4 Hz / 0.75, max yaw 1.35, tilt curve, One-Euro) with assumed phone motions. Every feel number is a tunable and must be set on a real iPhone. Grip, reach and Safari viewport figures are estimates.

## 0. The rule

**The phone flies the bus until your thumb flies it. A tap splats. Buttons do what they say.**

There are no more control modes. There is one gesture model, the floating bungee, with the same layout and the same gestures whether tilt is on or off. The tilt switch decides one thing: may the phone steer when no thumb is steering?

| Requirement | Answer |
|---|---|
| R1 turbo button upper left | TURBO, 72 px, left 12, centre at 26 % of the screen. Tap = next level. Hold = boost. A ▼ tab under it shifts down. |
| R2 thumb while tilt is on | A thumb replaces tilt on both axes. Handover fades 160 ms in, and the lift hands back only what makes sense (section 1). |
| R3 discreet tilt toggle top left | 32 px phone icon at the corner. Persisted. Asks iOS inside its own `touchend`. Handles refused, blocked and no sensor. |
| R4 mega on the side, middle-to-top right | MEGA, 84 px, right 12, centre at 45 % of the screen. Tap = splat. Hold = charge. |

Kept unchanged: tap anywhere splats and glint == hit (press latch), second-finger tap while steering, 10 s charge, early-release mega, firehose at full charge, 60 s cooldown, recenter and settings top right, G2/G3 locked behind `config.turbo.worldTravel` reading LOCKED: WORLD TRAVEL COMING, gears held until the bridge gate clears with armed feedback, three fingers open the tuner, desktop keyboard, pixel HUD, palette colours only. Nothing is keyed to SF: "gate cleared" means `opening over && !gearsLocked`, which is true at the end of the fog in a city with no bridge.

## 1. Arbitration

### 1.1 Decisions
- **Thumb replaces tilt, both axes.** All three designs and all judges agree. Both sticks are absolute, so adding gives a standing bias (tilt +0.5 plus a thumb dragging to -0.6 turns 0.8 degrees where replacing turns 33 (sim)). Splitting by axis means a press that pitches the phone changes altitude.
- **A tap never disturbs tilt.** An uncommitted touch leaves tilt live. Only the calm window runs.
- **Sensitivity never changes.** Only the neutral moves.
- **The neutral has one owner.** `TiltCore.neutral` stays the only zero. There is no second per-axis zero and no home walk.
- **Every number below is a tuner entry** (group "Hybrid").

### 1.2 Timeline

| Moment | What the flight stick does |
|---|---|
| Finger lands, undecided | Tilt keeps flying. Calm window 180 ms. Pose noted (`gLand`, `rLand`). Glint latched by `onPress`. |
| Still press lifts before 450 ms | It was a tap. Tilt never stopped. Calm window again on the lift. |
| Finger passes 12 px, or stays still 450 ms | **Clutch in.** Tilt's value freezes and fades out by smoothstep over 160 ms under the thumb. Peak yaw accel 126 to 45 rad/s², jerk 15k to 3.3k (sim). |
| Held | Thumb only. Sensor and filters keep running. Auto-recenter is suspended. A still thumb reads 0: dead straight. That is the untaught "tilt, stop it" gesture. |
| Lift, phone within 5 degrees of where it was | Thumb part drops. Hand-back rule runs at once, tilt eases in with continuity (tau 120 ms). Thumb 0.8 to tilt 0.5: yaw no longer dips to 0.41, stays 0.67 (sim). |
| Lift, phone moved 5 degrees or more | **Settle.** Stick 0 (today's touch release, and the aim latch's job) for 0.35 s minimum, until `angRate` < 12 deg/s, 1.0 s maximum. Then the hand-back rule at the pose it settled in. |
| After a rebase that followed a moved pose | **Return grace** 1.5 s: motion back toward the old neutral is absorbed, not read as a counter-carve. |

### 1.3 The hand-back rule
At the end of the handover, with `held` = seconds since the thumb clutched (0 if only a button reach clutched), `moved` = degrees between `gLand` and gravity now:

```
f = max( ss(0.6, 2.0, held), ss(5, 12, moved) )          // 0 = this was a nudge, 1 = this is a new hold
per axis: cap = (r * rLand > 0) ? sign(r) * min(|r|, |rLand|) : 0    // tilt may hand back at most what it handed over, same sign
          d   = (1 - f) * cap                             // what tilt reads now
```

The neutral moves so tilt reads `d`. If it moves more than 0.5 degrees it also tracks the live pose for 0.15 s, which hides the phone's rebound once thumb force is gone.

What that produces (sim, heading added after the lift unless noted; 2 to 3 s windows):

| Case | Final | Plain re-zero | No re-zero |
|---|---|---|---|
| 0.4 s nudge inside a held 12 degree carve, phone still | 56 degrees: carve resumes | 3 degrees: carve lost | 56 |
| 0.3 s opposite nudge inside a 20 degree carve | 115: carve resumes | -3 | 120 |
| Thumb steers 1.2 s, phone rolls 15 degrees with it, relaxes right after lift | **+4** | **-35 wrong way** | +13 |
| Same, relaxes 0.6 s after lift | **+4** (grace) | -20 | +28 |
| Phone drifts 15 degrees in a 3 s session and stays | +4 (spring tail) | +4 | 90 |
| 3 s session, phone still at 20 degrees | +4 | +5 | 141 |
| Phone relaxes 2 s after lift (past the grace) | -38 | -38 | n/a |

Time only means "new hold" for a thumb. A boost is long because the player wants speed, not because the hand settled, and with the time term a two-handed 3 s boost in a 12 degree carve that then levels the phone counter-carves -69 degrees; without it, +9 (sim-fixes). A reach therefore goes by `moved` alone.

The last row is the known residual, and only RECENTER or the next thumb session clears it. The cost of the grace: a deliberate roll back past the old neutral inside it reads 0.09 where it would read 0.63 (sim). It is bounded at 1.5 s.

**New angle after a long thumb session:** covered by `moved` and `held`. Whatever the player settled into is level. **Hand shake of a press:** calm window, no filter lag added outside it. At a 20 degree hold a 5 degree 9 Hz jolt falls from 0.31 stick error to 0.069 (sim).

### 1.4 Reaches
A reach to the upper left rotates the phone before the finger lands, so TURBO, ▼ and the toggle are treated as clutches:
- `gLand` and `rLand` come from the pose about 0.45 s before the press (`TiltCore.pastG`, four samples taken every 0.15 s, no per-sample ring). A reach that lands while a thumb steers or during a settle keeps the existing `gLand`.
- Tilt fades out while the button is down, and the settle cap is 0.9 s.
- Same `moved` test on lift: a two-handed tap that never moved the phone resumes at once (59.0 of 59.7 degrees kept (sim)). A one-handed reach settles and recovers the carve (+36 degrees against 48 unguarded and 60 ideal, assumed 25 degree swing).
- **Honest limit:** the 0.35 s of reach before the finger lands cannot be guarded. The bus follows the phone until the press.
- **A boost stays clutched until the finger lifts.** Tilt fades out and the bus flies straight under the boost, which is what a one-handed player is doing anyway. The normal reach lift runs at `reachUp`, when the hand can actually return. A two-handed player who wants to carve during a boost has the canvas thumb. 3 s boost with a 25 degree swing, hand back over 0.4 s after the lift: 0 degrees added on level, 42 of about 59 recovered in a 12 degree carve; two hands, no swing: 58.8 kept (sim-fixes).
- MEGA never clutches. Calm only. The thumb parked on MEGA while the phone flies is the best combination in the game.
- Recenter and settings do not clutch. Settings sleeps tilt while open.

### 1.5 Pseudocode (`src/game/Hybrid.ts`, pure, no DOM)

```ts
export const mixTune = {
  calm: 0.18, fadeOut: 0.16, fadeIn: 0.12,
  settleMoved: 5, settleMin: 0.35, settleMax: 1.0, reachMax: 0.9, settleRate: 12,
  rebaseT0: 0.6, rebaseT1: 2.0, rebaseA0: 5, rebaseA1: 12,
  track: 0.15, trackMin: 0.5, grace: 1.5,   // grace 0 disables it
  gainIn: 0.5, gainOut: 0.2, pastAge: 0.45,
};
// registerTunables('Hybrid', mixTune, ...)

state: phase LIVE|THUMB|SETTLE = LIVE
       thumbHeld=false, reachHeld=false                       // one flag per owner, never a count
       thumbUsed=false                                        // a thumb clutched since the last hand-back
       fadeT, held{x,y}, a{x,y}=1, out{x,y}, gLand, rLand{r,p}, tClutch, tLift, settleT, settleCap
       g=0, gTarget=0, offPending=false                       // global gain: toggle, app switch, settings
live = src.active && !src.probing                             // tilt running, and not the load-time probe

blip():            core.calm(now + mixTune.calm)             // ANY touch-down or lift, screen or any button
land():            if !live || thumbHeld || reachHeld || phase==SETTLE: return   // primary touch-down, not clutched
                   gLand=core.g; rLand=core.anglesOf(gLand)
clutch():          if !live || thumbHeld: return             // Input.commitDrag
                   if !thumbUsed: tClutch=now; thumbUsed=true   // (a commit during SETTLE keeps the session's clock)
                   thumbHeld=true; enter()
reachDown():       if !live || reachHeld: return
                   if !thumbHeld && phase!=SETTLE: core.pastG(gLand); rLand=core.anglesOf(gLand)
                   reachHeld=true; enter()
enter():           if phase!=THUMB: phase=THUMB; fadeT=0; held=out; core.autoHold=true
                   // held = out, not the live tilt: out is 0 in SETTLE and continuous in LIVE, so no kick
release(owner):    if !live: return                          // owner 'thumb' or 'reach'; reachUp() = release('reach')
                   if owner's flag is clear: return; clear it
                   if thumbHeld || reachHeld: return
                   blip(); tLift=now; settleCap = owner=='reach' ? reachMax : settleMax
                   if angleDeg(gLand, core.g) >= settleMoved: phase=SETTLE; settleT=0; out=0
                   else handBack()

handBack():
  [r,p] = core.anglesOf(core.g)
  moved = angleDeg(gLand, core.g)
  held_ = thumbUsed ? tLift - tClutch : 0                      // time means "new hold" only for a thumb (1.3)
  f = max(ss(rebaseT0, rebaseT1, held_), ss(rebaseA0, rebaseA1, moved))
  for axis i: cap = (r[i]*rLand[i] > 0) ? sign(r[i]) * min(|r[i]|, |rLand[i]|) : 0
              d[i] = (1-f) * cap
  if max(|r-d|) > trackMin: core.rebase(d.r, d.p, track, moved >= settleMoved ? grace : 0)
  tNew = core.stickFor(d)                                      // the curve, no filter state
  for axis i: a[i] = (out[i]*tNew[i] > 0) ? clamp(out[i]/tNew[i], 0, 1) : 0
  phase=LIVE; thumbUsed=false; core.autoHold=false

// once per frame from Input.update, wall clock (a hit-stop must not stall a handover)
update(now, dt, bx, by):
  stick.update()                                               // filters always run
  g += clamp(gTarget-g, -dt/gainOut, dt/gainIn); gs = ss(g)
  switch phase:
    THUMB:  fadeT += dt; k = 1 - ss(fadeT/fadeOut)
            out = (bx + k*held.x, by + k*held.y); radial clamp <= 1   // held already carries gs
    SETTLE: settleT += dt; out = 0
            if (settleT >= settleMin && core.angRate < settleRate) || settleT >= settleCap: handBack()
    LIVE:   a[i] += (1-a[i]) * (1-exp(-dt/fadeIn)); out[i] = gs * a[i] * t[i]

sleep():     gTarget=0                  // settings open, app hidden. Never touches tilt.status.
turnOff():   gTarget=0; offPending=true // toggle off. Controls.frame stops the tilt once g==0.
cancelOff(): offPending=false; gTarget=1  // toggled back on inside the fade: no calibration

wake(thumbDown):                        // tilt going live; settings closed; app back (with an eased recenter)
  if !live || offPending: return
  phase=LIVE; fadeT=settleT=0; reachHeld=false; thumbHeld=thumbUsed=thumbDown
  if g==0 || thumbDown: out=(0,0)       // g is not written: a quick close or re-toggle eases from where it is
  gLand=core.g; rLand=(0,0); tClutch=now   // nothing was handed over, so the cap is 0 and any land() is stale
  core.autoHold=false
  if thumbDown: enter()
  gTarget=1
```

`Input.update` becomes the single arbitration site:

```ts
const b = this.b;                                  // thumb stretch, written by applyStretch
p && !gTriple && !pointerDragging && now-p.t0 >= stillTapMs && !(mixLive && p.edge) -> commitDrag()
st.thumb = pointerDragging
if (keys held, no thumb) { as today }              // keys win over tilt, thumb wins over keys
else if (mixLive) { mix.update(...); st.stretch = mix.out; st.dragging = st.thumb || out != 0 }
else { st.stretch = b; st.dragging = pointerDragging }   // tilt off: today's touch mode
```

`mixLive` = `mix !== null && mix.live`. Gain starts at 0, and only `Input.wakeMix()` (`mix.wake(pointerDragging)`) raises it: on `tiltResult('granted')`, the returning-player start, settings closed and app back. Going live with a thumb down is `wake(true)`, which clutches that thumb once. `clutch`, `land`, `reachDown` and `release` are no-ops while not live, and `wake` resets both owner flags, so a thumb or button that outlived a toggle cannot leave a stale owner. Tilt off or no sensor takes the last branch and never reaches the mixer.

**Edge rest:** a primary that lands within 14 px of the left or right edge and stays within `tapSlopPx` never clutches, so a gripping finger cannot silently kill tilt. It stays a Primary. Roles are not changed. This only works because every HUD hit rect stops 14 px short of the screen edge (section 3): a wrapper stops propagation on pointerdown, so a grip landing on one would never reach this rule.

**Aim:** `main.ts:847` becomes `aimer.update(flight, simTime, st.thumb && !input.pressHeld)`. Tilt never thaws the glint. Only a committed thumb does.

## 2. Gesture table

Tilt on and off differ only where stated. Decisions first:
- **Still press on the screen no longer charges.** MEGA is the button. A 60 s cooldown must not fire by accident.
- **Swipe for gears is retired.** A drag and a swipe up are the same motion, and steering wins.
- **Shift up: tap TURBO. Shift down: the ▼ tab, which exists only with something to shift down from.** No wrap, no walking direction, no flick.
- **Boost: hold TURBO.**
- **A still press up to 450 ms splats on lift, for everyone** (`stillTapMs`). Today tilt players get 300 ms of forgiveness and touch players 230 ms, and a press in between does nothing. With charge gone a still press has no other meaning. 450 stays inside `aimLatch` (0.5 s), so glint == hit holds.

| Input | Tilt on | Tilt off |
|---|---|---|
| Tap, screen (up to 450 ms still within 12 px, or up to 150 ms within 26 px) | Splat on lift, latched at press. Tilt keeps flying. | Splat on lift, latched at press |
| Drag, screen | Thumb replaces tilt, both axes | Bungee |
| Hold still past 450 ms, screen | Clutched, flies straight, no splat on lift | Steering at neutral, no splat on lift |
| Still press starting within 14 px of the side edge | Grip contact: no clutch, tilt flies. Past 12 px it is a drag. | As today |
| Second finger while the first steers | Splat on its down | Same |
| Second finger on a still first, past 230 ms | Splat on its down (`primarySteering` keeps `tapMs`) | Same |
| Two fingers tapped together | One splat | Same |
| Three fingers within 450 ms | Tuner | Same |
| Moving the phone with no thumb down | Steers | Nothing |
| Swipe | A drag | A drag |
| Tap TURBO (down under 450 ms, `stillTapMs`, lifted within 34 px) | Up one level on lift. Past `maxGear`: LOCKED. Under the gate: ARMED. No press is dead: a 300 to 450 ms press boosts briefly and still shifts. | Same |
| Hold TURBO 300 ms+ | Boost from 300 ms until lift. Past 450 ms the gear is unchanged. Tilt stays clutched, the bus flies straight, reach hand-back on lift. | Boost until lift |
| Drag begun on TURBO, ▼ or toggle | Stays the button's. Never steers, never shifts by itself. | Same |
| Slide 34 px off TURBO before 300 ms | Tap cancelled | Same |
| Slide off TURBO while boosting | Boost lasts until lift, no shift | Same |
| Tap ▼ (gear > 0 or armed) | Down one level, or cancels armed (TURBO OFF) | Same |
| Tap MEGA | Normal splat, latched at press. No press is dead. | Same |
| Hold MEGA | Charging from 0.3 s. Under `superMin` a splat, then mega, full = firehose. | Same |
| Hold MEGA in cooldown | "Not yet"; lift is a splat, as today | Same |
| Slide off MEGA before charging (14 px, `holdSlopPx`) | Press cancelled, the finger becomes the steering thumb. If it lifts inside the quick window (150 ms from the press, 26 px) it was a sloppy tap: one splat, as on the screen. | Same |
| Slide off MEGA while charging or pouring (28 px, `chargeSlopPx`) | Keeps charging and steers, unless another thumb already steers. Only lifting ends it. | Same: this is the one-thumb hose sweep |
| Steering thumb crosses a button | Captured by the canvas, keeps steering, button inert | Same |
| Tap tilt toggle | Off | On (asks in its own `touchend`) |
| Tap tilt toggle while Busy | Cancels, back to undecided (`prefs.tilt` absent) | Same |
| Recenter, settings | As today | Settings only |

**Keyboard:** unchanged. Space tap and hold, E / Q, PageUp / PageDown, Shift, arrows, Esc. HUD buttons stay hidden.

**Swallow vs pass through:** only hit wrappers catch: toggle, TURBO, ▼, MEGA, recenter, settings, chip. Readout, toast, LOCKED, meter, cue and credits pass everything through.

## 3. Layout

All rects are `left, top, width, height` in CSS px, computed by one pure function (section 8, `src/ui/hudLayout.ts`) on resize only. `safe(side, px) = max(px, inset + round(px / 2))`, the existing rule. `T = safe(top, 10)`. Compact = `min(w, h) < 360`, decided once at construction, so a small phone keeps one set of canvases when rotated.

**Formulas (portrait):** toggle left `safe(left,12)`, top T. TURBO top `Yt = max(T+76, 22 % H)`, ▼ at `Yt+76`. MEGA centre `45 % H`, right `safe(right,12)`. Readout left `L+40`, top T+2. Toast and LOCKED one slot, centred, top T+54. Chip top 78 %. Cue top 64 % (tunable: measure against the bus on the GPU pass). Nothing sits in the bottom 40 px.

| Control | 393 x 852 Home Screen (T 64) | Hit | 393 x 659 Safari (T 10) | Hit |
|---|---|---|---|---|
| Tilt toggle | 12,64,32,32 | 14,58,44,46 | 12,10,32,32 | 14,4,44,46 |
| Readout | 52,66,200,48 | none | 52,12,200,48 | none |
| Recenter (tilt on) | 295,64,40,40 | 287,60,48,48 | 295,10,40,40 | 287,6,48,48 |
| Settings | 343,64,40,40 | 335,60,44,48 | 343,10,40,40 | 335,6,44,48 |
| Toast + LOCKED slot | centred, y 118 to 162 | none | centred, y 64 to 108 | none |
| TURBO | 12,187,72,72 | 14,177,82,84 | 12,145,72,72 | 14,135,82,84 |
| ▼ (gear > 0 or armed) | 12,263,72,32 | 14,261,82,46 | 12,221,72,32 | 14,219,82,46 |
| MEGA | 297,341,84,84 | 285,329,94,108 | 297,255,84,84 | 285,243,94,108 |
| Meter, charging / pouring | 305,249,68,86 | none | 305,163,68,86 | none |
| Meter, cooldown | ring centred on MEGA | none | ring centred on MEGA | none |
| Tilt chip | 96,664,200,48 | 76,652,240,72 | 96,514,200,48 | 76,502,240,72 |
| Cue | 148,545,96,64 | none | 148,422,96,64 | none |

| Control | 320 x 568 (T 10, compact) | Hit | 852 x 393 landscape (L/R 65, T 10) | Hit |
|---|---|---|---|---|
| Tilt toggle | 8,10,32,32 | 14,4,44,46 | 65,10,32,32 | 53,4,52,46 |
| Readout | 52,52,200,48 (T+42) | none | 105,12,200,48 | none |
| Recenter | 222,10,40,40 | 214,6,48,48 | 700,10,40,40 | 696,6,48,48 |
| Settings | 270,10,40,40 | 262,6,44,48 | 748,10,40,40 | 744,6,54,48 |
| Toast + LOCKED | centred, y 104 to 148 (T+94) | none | centred, y 64 to 108 | none |
| TURBO | 8,125,60,60 | 14,117,66,72 | 65,86,72,72 (`Yt = max(T+42, 22 %)`) | 53,76,96,84 |
| ▼ | 8,189,60,28 | 14,189,66,44 | 65,162,72,32 | 53,160,96,46 |
| MEGA | 244,222,68,68 | 232,210,74,92 | 703,135,84,84 | 691,123,102,108 |
| Meter, charging | 244,130,68,86 | none | 629,134,68,86 (left of MEGA) | none |
| Tilt chip | 60,443,200,48 | 40,431,240,72 | 326,306,200,48 | 306,294,240,72 |

The Safari height of 659 and the insets 59 / 34 are from memory and iOS 26 Safari may differ. The layout is formula-driven, so only the table moves. `430 x 932` uses the same formulas.

**What touches what:**
- Toggle and TURBO are 91 px apart (home screen), so a stretching thumb cannot hit one for the other.
- Readout sits above TURBO, because a right thumb reaching for TURBO covers the area right of and below the button.
- The toast moves from 27 % to the top slot so it cannot cross TURBO. A LOCKED banner removes any toast.
- The meter leaves bottom-centre: `slot('super')` is repositioned on phase change. Above MEGA is the one side a thumb from below never covers.
- **No hit rect reaches x < 14 or x > w - 14, in any layout, including after SWAP.** That 14 px band belongs to the canvas, so a gripping finger or palm gets the edge-rest rule and cannot boost, shift or charge. A hit rect may therefore leave 2 px of a visual outside it (the visuals sit at 12): the visual is `pointer-events: none` and a touch there is a splat. Toward the play field hit areas add at most 14 px at the portrait sizes (18 for the compact toggle, to keep 44 px). The exception is MEGA, 12 px on its other three sides, because a tap on it splats anyway. That is why it can be 94 x 108 exactly where a thumb lands.
- Controls sit 12 px in from the edges. Safari's back swipe starts at the left edge, so every hit wrapper gets non-passive `touchstart` `preventDefault`, and the edge band already has it from the canvas (`Input.ts:217`). Whether that blocks the swipe on iOS 26 is unconfirmed: test it first.

**Reach** (estimates: 0.165 mm per CSS px, comfortable thumb about 60 mm, stretch about 80 mm, home-screen rects):

| Grip | MEGA | TURBO | Toggle |
|---|---|---|---|
| Right hand, low | 60 mm, comfortable | 103 mm, out of reach | out |
| Right hand, slid up 30 mm | easy | 80 mm, the limit | out, other hand |
| Left hand | 81 mm, stretch | 86 mm, regrip | regrip |
| Two thumbs | right thumb, easy | left thumb, regrip or slide | left thumb, stretch |
| Cradled, other hand's finger | easy | easy | easy |

The honest version of upper left: a right-hand one-thumb player cannot reach TURBO without moving the phone. It is acceptable because a level is latched and pressed a few times a flight, the reach is guarded (section 1.4), 22 % is 13 mm closer than a top row, and the hit area runs wide toward the thumb. MEGA at 45 % is the top of what a thumb can hold for 10 s.

**Left-handed:** settings row `BUTTONS: SWAP`, persisted, off by default. It mirrors TURBO, ▼, MEGA and the meter. The toggle stays top left as asked.

## 4. Buttons

Pixel canvases at 2 CSS px per UI px, palette colours only, redrawn on change only. No CSS alpha. **Rest:** after 8 s untouched TURBO and MEGA redraw once with a checker of cleared pixels (`PixelCanvas.punch(0.25)`), so the city shows through and they stay exactly where the thumb remembers. Any press, gear event, armed, LOCKED, mega ready or gate clearing wakes them. The toggle rests permanently at `punch(0.5)` and never hides, because it is the way out. Recenter and settings keep today's 6 s fade. Buttons arrive when the fog ends or at the first touch, whichever is first.

**TURBO (36 x 36 UI px, compact 30 x 30).** Panel, three stacked chevrons (G1 bottom, G3 top), small TURBO under them. The level reads on the button with no digits.

| State | Look |
|---|---|
| G0 idle | Chevrons dark. Locked ones carry the existing red tick. Edge grey. |
| Pressed | Whole face 2 CSS px down, faces `yellowLo`, on the pointerdown frame. The shift fires on lift. |
| Lifting (gear > 0, not engaged) | That gear's chevron blinks at the existing 220 ms step |
| Engaged | Chevron solid yellow, edge yellow. G3 cycles hues, gated by worldTravel. |
| Boosting | Edge `yellowHi`, inner rule lit, as the lever's hot state |
| Armed | Next chevron blinks dim. Readout G1 JET / ARMED, toast and clunk as today. ▼ appears. |
| LOCKED | Button shakes 2 CSS px for 0.3 s, next chevron's tick flashes red, banner and clunk as today |

**▼ (36 x 16 UI px):** panel, cream triangle, pressed state only. Slides out from under TURBO in two CSS steps.

**MEGA (42 x 42 UI px, compact 34 x 34).** `drawSplat`'s pinwheel, text MEGA. The face is the button, and SuperMeter stays the only charge display, with its drawing unchanged and its slot moved.

| State | Face | Meter |
|---|---|---|
| Ready | Rainbow ring, MEGA on panel | Hidden |
| Pressed under 0.3 s | Bright hues, yellow centre | Hidden |
| Charging | Yellow centre | Above: fill, tick, orb, MEGA / HOSE as today |
| Firehose | White-hot, two-frame swap at most 8 Hz | Above, spinning |
| Cooldown | Low hues | Docks on the face with refill ring and seconds |
| Not yet | Low hues | Shakes, red blink, as today |
| Ready again | Pop, chime, wakes from rest | The existing 0.7 s pop |

**Tilt toggle (16 x 16 UI px).** A tiny phone glyph.

| State | Look |
|---|---|
| Unasked | Grey outline, rocks two frames at 2 Hz |
| Off | Grey outline, red slash |
| Busy (requesting, waiting for stillness, calibrating) | Blinks yellow and grey. A tap cancels. |
| On | Yellow with two arcs |
| On, clutched | Yellow, arcs dark. This is the one piece of teaching for the clutch. |
| Refused | Red slash, red outline this session |
| No sensor | Not drawn, hit wrapper removed |
| Pressed | Inverted |

Toasts: TILT ON / DRAG ANY TIME 1.6 s, TILT OFF 1.1 s.

## 5. First run

**The TILT TO FLY card, USE TOUCH INSTEAD, the dim and the opening's hold are gone.** Frame one is the clean hero shot and the thumb works from the first touch. One cue at a time, each ended by doing it, and a `taught` bitmask in prefs means each shows once ever. All cues pass touches through.

| When | What | Text |
|---|---|---|
| 0 to fog end | Nothing on screen. Thumb live. | none |
| Fog end, or first touch | TURBO, MEGA and toggle arrive | none |
| A glint is showing, no splat yet | Fingertip ring pulses at the cue slot | TAP |
| First splat | Two chevrons sway at the cue slot, until the first thumb commit or 8 s | DRAG |
| Gate cleared | TURBO wakes and blinks three times. Replaces SWIPE UP FOR TURBO. Skipped if already armed. | none (its label says TURBO) |
| 2 s after the gate, no press held, and first splat done or 10 s since fog end | **The chip** | TILT TO STEER? |
| Chip tapped | Its `touchend` asks. Sim holds under the sheet. | |
| Chip ignored 8 s | Flies in six steps up to the corner and becomes the toggle. Stays unasked and off. `chipIgnored` + 1. | |
| Third splat, or a still press of 0.6 s | MEGA's face alternates MEGA and HOLD twice | HOLD |

**The chip:** rocking phone plus the question, no dim, game running. Its hit area arms 250 ms after it appears, so a tap already in flight still splats. Only tapping it or the toggle ever asks. Non-iOS gets the chip only if a quiet probe at load heard motion; otherwise the toggle is not drawn.

**Tilt's default.** iOS cannot start motion without a tap, and no sheet may land on a splat, so tilt is offered, not imposed. This changes the standing "on by default for phones": see the first producer call.

**Turning on (chip or toggle):**
1. `tilt.request()` is the first statement in the element's `touchend`, before the audio unlock.
2. On grant, wait until `gRate` < 40 deg/s has held **continuously for 0.3 s** (`settleHold`), capped at 1.5 s (`settleMax`). The toggle shows Busy meanwhile. The hold is the point: the corner is a reach, so the phone can be rotated and momentarily still when the finger lifts, and an instantaneous test passes there at once (rest reads 14.5, peak 19.5 with the repo's noise model (sim), well under 40). A 25 degree swing that pauses 0.1 s and returns now calibrates at the grip, 0.82 s in; the old test took the 25 degree pose at 0.02 s (sim-fixes). Chip and toggle share this path; on the chip it costs 0.3 s. `angRate` cannot be used: it does not run before calibration.
3. Take the existing 0.18 s mean, then `wakeMix()`: gain in over 0.5 s.
4. Toast TILT ON / DRAG ANY TIME. `prefs.tilt = true` on success only.

**Returning players (`prefs.tilt === true`):**
- Non-iOS: tilt starts on the first gesture.
- iOS: a quiet probe at load. Events flowing means the grant survived, so tilt starts on the first gesture.
- iOS, silent: the chip comes at fog end with no gate wait, and `prefs.tilt` stays true. It costs one tap and never surprises anyone. Nothing depends on WebKit keeping the grant.
- **Letting it go:** the chip ignored twice in a row (`prefs.chipIgnored`, reset to 0 whenever tilt turns on), or a tap on the Busy toggle, removes `prefs.tilt`: undecided, no chip (bit 16 of `taught` is already set), toggle drawn Unasked. A player who once chose tilt does not have to turn it on just to turn it off.

**`prefs.tilt === false`:** no chip, tilt never asked. A thumb-only player stays thumb-only.

## 6. Failure and edge cases

| Case | Behaviour |
|---|---|
| Tap during a tilt carve | Tilt flies on under the calm window, press latches, splat on lift, glint == hit |
| Tap during a thumb carve | Second-finger path: splat on its down |
| Lift to tap | Thumb-lift latch as today. The moved settle holds the stick at 0, which helps. |
| Drag begun on TURBO, ▼, toggle | Pointer captured, stays the button's |
| Finger slides off TURBO | Past 34 px the tap cancels. A boost lasts until lift. |
| Drag begun on MEGA | Becomes the steering thumb at 14 px. This is required: MEGA sits in the right thumb's rest zone. The adopted slot keeps the press's start point and time, so one lift ends in exactly one result. |
| Grip finger or palm at a screen edge beside a button | Lands in the 14 px canvas band, so edge rest applies. No boost, no charge. |
| MEGA while steering | Independent paths, as SPLAT today. `pressHeld` keeps the latch. |
| Charging while tilted | Tilt flies throughout. Charge ignores pose. |
| Charging, finger creeps | Under 28 px nothing. Past it, steers from where it is (anchor at the current point, so no stretch step). |
| Sweep with an adopted thumb | `pressHeld` stays true, so the thumb does not thaw the press latch. That latch expires at 0.5 s (`Aim.ts:257`), after which the live target glints, and `fire()` uses what glints. glint == hit holds. |
| Toggle off mid-flight | `mix.turnOff()`: gain out over 0.2 s, then `tilt.stop()`. Recenter hides. A live thumb is untouched. Saved at once. |
| Toggle back on inside that 0.2 s | `cancelOff()`: gain eases back, no calibration, `prefs.tilt` true again |
| Toggle on mid-flight | Section 5. A live thumb stays clutched and untouched, and hands back to tilt once on its lift. Saved on success. |
| RECENTER pressed | Armed, not snapshotted: it is a corner reach too. Applies once `gRate` < 40 has held 0.3 s, cap 1.5 s, then the eased recenter as today. |
| Toggle or chip during the opening | Allowed. The `main.ts` yoke clamp and queued gears are unaffected. |
| iOS sheet up | `controls.sheetUp` (status `requesting`): dt = 0 at any time, not only in the opening |
| Refused (`requestPermission` resolves `denied`) | `prefs.tilt = false`, toggle Refused, toast MOTION ACCESS OFF / DRAG TO STEER. Never asked again unless the toggle is pressed. A further `denied` toasts MOTION DENIED: REOPEN SAFARI. |
| Blocked (`requestPermission` throws or rejects) | Not a refusal. New status `blocked`. Toggle stays as it was, nothing persisted, next press retries. After two, toast MOTION DENIED: REOPEN SAFARI. |
| No sensor, or granted but silent | Session flag `strugglebus.notilt`, toggle not drawn, no error toast, `prefs.tilt` unchanged |
| Landscape flip | Reflow on resize. Tilt's existing 0.35 s recenter. Safari cannot lock rotation, so a hard bank can flip the page: `awayFrom` 58 helps but it remains a risk. |
| App switch | `Input.releaseAll` plus `Hud.releaseButtons` on hidden: thumb, boost, charge end, a charge fizzles with no cooldown, gear stays. Back: `wakeMix()` with the existing eased recenter. A pending toggle-off survives: `wake` returns on `offPending`. |
| Settings open | `releaseButtons`, `mix.sleep()`. Tilt keeps listening and `tiltState` reads on, however long it stays open. Closed: eased recenter, `wakeMix()`. |
| Tuner open | Taps ignored as today |
| iOS steals a touch | `pointercancel` ends the thumb with no tap, lift path runs |
| Lost pointer | `drop()` runs the lift path |
| Reach during a thumb hold | `thumbHeld` and `reachHeld` are separate. Tilt returns when both are clear, whichever lifts last. |
| New touch during SETTLE | A tap changes nothing (`land` ignores it). A commit returns to THUMB keeping `gLand` and reading the held 0, so no kick. |
| Palm on the edge plus a real thumb | The palm stays Primary, so the real thumb is a Secondary and only taps. Same as today's touch mode. Not fixed in v1 (no role rewrite); fix if a phone shows it. |

## 7. Precedents

None were looked up in this pass. Sureness is from the design authors' notes and memory.

| Source | Fact | Sureness | Taken |
|---|---|---|---|
| Steam Input gyro ratcheting and touch activation | A touch or button suspends gyro; the zero moves when it lifts | Medium-high | The clutch and the rebase |
| Bumpless transfer, MIDI soft takeover | Sync the idle controller before handing back | High | Hand-back cap and continuity |
| Splatoon 2/3 | Stick and gyro live together, on a relative camera rate | High on the idiom, believed additive | Why not to copy: ours are absolute sticks on the body being pressed |
| PUBG Mobile, CoD Mobile | Gyro layered on touch look, context gates | Medium | Gating tilt by context is normal |
| Mario Kart Tour | Gyro Handling is optional; touch is complete on its own | Medium; unsure whether touch overrides gyro | Tilt off-able, thumb complete by itself |
| Real Racing 3, Asphalt 8/9 | Schemes chosen in settings; one nitro button | Medium | Exclusive at any instant, chosen by the thumb, not a menu |
| Pokemon GO | Small on-screen AR toggle at the moment of use, clean fallback | Medium | Corner toggle |
| Sky: Children of the Light | Thumb-anywhere flight; any gyro unconfirmed | Low | Nothing about tilt |
| Hoober, UXmatters 2013 | 49 % one-handed, 36 % cradled, 15 % two-handed; 67 / 33 right / left | High (old, small phones) | MEGA in reach, swap row, two-handed TURBO is fine |

No game we can name does exactly "touch suspends absolute tilt, lift rebases with a cap". That is the main unknown.

## 8. Code changes

**New `src/game/Hybrid.ts`:** `TiltMix` and `mixTune` as section 1.5. No DOM.

**New `src/ui/hudLayout.ts`:** pure `layoutHud(w, h, insets, swap, compact)` returning the rect table. Insets are read from a hidden probe div using `env(safe-area-inset-*)`.

**New `src/ui/Coach.ts`:** the section 5 table. Inputs per frame: glinting, opening over, gears locked, splat count, thumb committed, any press held. Off with `?nohud`, `?skipintro`, `?nocoach`.

**`src/game/Input.ts`:**
- `InputMode` becomes `'touch' | 'keyboard'`.
- Delete `Src.Screen`, `updateTilt`, `tiltMove`, `gSwiped`, `swipeHold`, `swipePx/Ms/Ratio`, the tilt branches in `pointerDown`, `pointerMove`, `pointerUp`, `primarySteering`, and the tilt `pressEnd` lines in `drop`.
- `stick: StickSource` becomes `mix: TiltMix | null`; `StickSource` moves to Hybrid.ts.
- `inputTune.stillTapMs` 450. Used by `isQuick`, the still-commit in `update`, and the together test at `Input.ts:608` (`now - gT0 <= stillTapMs + 150`), so two fingers tapped together at 400 ms are one splat, not a dead press. `tapMs` stays 230 for `primarySteering`.
- `chargeSlopPx` 44 to 28. `holdSlopPx` stays 14.
- `applyStretch` writes `this.b`, not `state.stretch`. `update` is the single site in section 1.5.
- `Slot.edge`, set from `rectW` in `setSlot`. `Slot.ownsPress`, cleared in `setSlot`.
- `endSteering` also zeroes `this.b` (otherwise a TURBO reach with no thumb outputs the last drag's stretch as `bx`).
- `commitDrag` calls `mix.clutch()`. `endSteering` calls `mix.release('thumb')` if `pointerDragging` was true. `pointerDown` calls `mix.blip()` and, for a new primary, `mix.land()`. `pointerUp` calls `mix.blip()`.
- New `adoptThumb(e, keepPress, x0, y0, t0): boolean`: false if a primary exists. Otherwise allocates a Primary slot and initialises the gesture as `pointerDown`'s new-gesture branch does, re-captures the pointer on `el`, sets anchor and finger to the current point, commits. The slot's `x0/y0/t0` are the **MEGA press's** (original pointerdown point and `evMs`) and `maxDist` is the distance from there, not 0, so the lift is judged from the press. `ownsPress = keepPress`. On that slot's lift or drop, if `ownsPress`, runs `pressEnd(Src.Button, ...)`.
- The Primary tap test at `Input.ts:596` gains `&& !slot.ownsPress`, so a kept charge ends only in `pressEnd`. A cancelled press inside the quick window fires the one tap it is owed. (Not `!gSteered`: see section 11.)
- New `hudBlip()`, `reachDown()`, `reachUp()` forwarding to the mix, and `wakeMix()`.
- `onVisibility`: hidden runs `releaseAll` and `mix.sleep()`; back runs `wakeMix()`.

**`src/game/Tilt.ts`, `TiltCore`:**
- `calm(until)`: `feed` passes beta 0 and `update` predict 0 before `until`.
- `autoHold`: skips the auto-recenter block.
- `gRate`: |dg/dt| deg/s, tau 0.1 s, computed before the `!calibrated` return. `gStill`: seconds `gRate < config.tilt.settleRate` has held, reset to 0 by any sample at or over it.
- `calibrate()` waits for `gStill >= config.tilt.settleHold` (0.3 s) or `settleMax` (1.5 s) before summing.
- `recenterStill()`: arms a pending recenter that fires `recenter()` at the same test and cap. `TiltControl.recenter()` calls it, so RECENTER no longer snapshots `g` at the tap. Other `core.recenter()` callers (screen turn, app back) are unchanged. `calibrate()` clears it.
- `pastG(out)`: four vectors in a `Float32Array(12)`, one written every 0.15 s; returns the oldest at or beyond `pastAge`, on an empty history `g`.
- `anglesOf(g)`: `relative` without clobbering `rawRoll/rawPitch`.
- `stickFor(roll, pitch, out)`: the curve from `update`, no filter state.
- `rebase(dRoll, dPitch, track, grace)`: extract lines 244 to 249 as `rotateNeutral(droll, dpitch)` (the auto-recenter step with k = 1). Reset both filters to d. While `trackT > 0`, each sample rotates by (raw - d).
- Grace: store `zRoll/zPitch` = the rotation just applied. While `graceT > 0` and past the track, per axis if `raw * z < 0`: `s = sign(raw) * min(|raw|, |z|)`, rotate by s, `z += s`. Per-sample, allocation free, inert otherwise. `recenter()` and `calibrate()` clear it.

**`src/game/Tilt.ts`, `TiltControl`:**
- `request()`: the sync catch and the promise rejection set new status `blocked`, with no listening. A resolved non-`granted` sets `denied`. `set()` resolves waiters on `blocked` too.
- `sample()`: `calibrating` timeout = `settleMax + calibrate + eventTimeout`.
- New `probe(): Promise<boolean>`: sets `probing`, `listen()`, then `stop()`, status silently back to `off`, clears `probing`. `TiltMix.live` is false throughout, and `Controls.tiltResult` ignores status changes while `probing`, so a probe that reaches `active` cannot steer or wake anything.
- `engaged` removed.

**`src/game/Controls.ts`:**
- Delete `start`'s prompt branches, `promptTilt`, `chooseMode`, `onPromptTilt/Touch`, `holdOpening`, `turboHintDue` and SWIPE UP FOR TURBO.
- New `setTilt(on)`, called synchronously from Hud's toggle and chip `touchend`. `setTilt(false)` saves `prefs.tilt = false` at once and calls `mix.turnOff()`. `setTilt(true)` with `mix.offPending` calls `mix.cancelOff()` and stops there. A press while Busy cancels (section 5). New `tiltResult(status)` handling granted, denied, blocked, unavailable per section 6; `granted` ends in `input.wakeMix()`.
- New `sheetUp`, `opening` (set per frame beside `gearsLocked`), `glinting`, `splatted()`.
- `start()`: keyboard as today. `?controls=touch` forces tilt off with no chip. `?controls=tilt` shows the chip at once. Otherwise section 5.
- `frame()` runs Coach and fills new `HudFrame` fields: `tiltState`, `gearDown`. Runs `tilt.stop()` only when `mix.offPending && mix.g === 0`, then clears `offPending`. Gain alone never stops the tilt: `sleep()` also takes it to 0, and `wake` never calls `listen()`, so opening settings would otherwise turn tilt off behind a toggle still drawn On. `tiltState` reads on while asleep.
- `snapshot()`: `mode` stays; add `mix: { phase, g, thumbHeld, reachHeld }`, remove `hud.prompt`.
- Prefs per section 9.

**`src/ui/Hud.ts`:**
- Delete `touchPad`, `splatBtn`, `lever`, `leverLabel`, `wireLever`, `drawLever`, `showPrompt`, `hidePrompt`, `promptOpen`, `drawPrompt`, `bigText`, `setChromeHeld`, `superSlot`'s fixed position, and the TILT / TOUCH row with `onMode`.
- Keep `phone()` for the chip and rename `drawSplat` to `drawMega`.
- New `wireTurbo` (boost starts at 300 ms from `holdThreshold`; on lift, end any boost, then shift if it was down under `inputTune.stillTapMs`, unused, not cancelled and within 34 px; `reachDown` on press, `reachUp` on lift only), `wireDown`, `wireMega` (from `wireSplat`, with the slide rules and `input.adoptThumb`, passing the press's point and time), `hitTouch` (for the toggle and chip: non-passive `touchstart` `preventDefault`, `touchend` runs the callback synchronously with an inside +10 px test, pointerup only for mouse and pen), `chip`, `drawTurbo`, `drawToggle`, `layout()` on resize and orientationchange, `setMega(phase)`, `settings` row `BUTTONS: SWAP`.
- `hit()` gains non-passive `touchstart` `preventDefault`. Every wrapper calls `input.hudBlip()` on down and up.
- `releaseButtons` handles mega and turbo.
- `toast` uses the top slot. `update` does change-detected redraws only.
- New `PixelCanvas.punch(density)`.

**`src/ui/SuperMeter.ts`:** no drawing change. It still mounts in `hud.slot('super')`; only that slot moves, and its label row under the ring stays clear because the slot sits above MEGA. Update the header comment.

**`src/main.ts`:** line 745 becomes `if (controls.sheetUp) dt = 0`. Line 847 per section 1.5. Set `controls.opening` and `controls.glinting` per frame. `input.onTap` calls `controls.splatted()` when a breath leaves. Line 1017 adds `controls.hud.setMega(view.phase)`. Comments mentioning the SPLAT button, tilt screen and swipe updated.

**`src/config.ts`:** `config.tilt.settleRate` 40, `settleHold` 0.3, `settleMax` 1.5. `holdThreshold` comment updated.

**Docs:** `docs/ARCHITECTURE.md` contract, a new DECISIONS section (this overrides "NO HUD" and the tilt-default entry by the producer's words), HANDOFF, `SuperSplat.ts` header comment, `dev/input.ts` only if it breaks.

## 9. INPUT CONTRACT and persisted settings

**Contract changes:**
- `mode: 'touch' | 'keyboard'`. `'tilt'` is gone. Tilt running = `controls.tilt.active`.
- `state.thumb: boolean` new: a committed bungee thumb.
- `state.dragging`: thumb, keys, or a non-zero tilt stick.
- `state.stretch`: the arbitrated stick, same semantics. Flight, the opening clamp, homing and `__qa.sx/sy` do not change.
- `pressHeld`: MEGA or Space only.
- `input.mix` replaces `input.stick`.
- HUD hooks: `splatButton`, `turboShift`, `turboHold` unchanged (MEGA uses `splatButton`). New `adoptThumb`, `hudBlip`, `reachDown`, `reachUp`, `wakeMix`.
- `onTap`, `onChargeStart`, `onChargeEnd`, `onTurbo`, `onPress`, `state.chargeHeld`, `state.turboHeld` unchanged. A screen press never starts a charge.
- `controls.holdOpening` is replaced by `controls.sheetUp`.

**`localStorage strugglebus.controls.v1`** (same key, read and migrated in `loadPrefs`, then saved):

| Field | Meaning |
|---|---|
| `tilt?: boolean` | true = wants tilt, false = thumb only, absent = undecided |
| `taught?: number` | bits: 1 tap, 2 drag, 4 turbo, 8 mega, 16 chip |
| `swap?: boolean` | buttons mirrored |
| `chipIgnored?: number` | chips ignored in a row; 2 clears `tilt`; reset to 0 when tilt turns on |
| `sens`, `muted`, `keysShown` | unchanged |
| `mode` | deleted on load: `'tilt'` becomes `tilt: true`, `'touch'` becomes `tilt: false`, absent stays undecided |

`sessionStorage strugglebus.notilt` stays, session only, for no sensor and silent.

## 10. Tests

**Offline, `tools/controls-sim`:**
- **`s_hybrid.ts` (new, seeded by `sim-final.mjs`):** real Input + TiltCore + TiltMix + Flight, `phone.ts` sensor, fakedom clock.
  1. Tilt-off identity: a scripted stream gives bit-equal `state.stretch` to the mixer absent.
  2. Clutch-in: peak yaw accel at most 50 % of a hard switch.
  2b. Commit during SETTLE: max per-frame |delta out| at most 0.05 (0.02 with `held = out`, 0.40 with the old `held = stick` (sim-fixes)).
  3. Lift continuity: thumb 0.8 to tilt 0.5, min yaw at least 0.6.
  4. Nudge resumes: heading within 5 % of no-thumb.
  5. Body English, relax at 0.1 and 0.6 s: heading within +-8 degrees.
  6. New hold: stick 0 at the settled pose, heading within +-8.
  7. Cap: a carve never returns larger than handed over.
  8. Reach two-handed: at least 95 % of ideal heading.
  9. Reach one-handed: better than unguarded.
  9b. 3 s boost with a 25 degree reach swing, hand returns over 0.4 s after the lift: heading within +-8 degrees.
  9c. 3 s two-handed boost in a 12 degree carve, phone levelled after the lift: no counter-carve past -8.
  10. Press shake 5 degrees 9 Hz at a 20 degree hold: stick error at most 0.08.
  11. Toggle off and on, app switch: no step over 0.05 per frame.
  12. Edge rest: tilt stays live.
  13. Sensitivity unchanged after every case.
  14. `s_tilt` passes unchanged, so the neutral's existing behaviour is proven untouched.
  15. No allocation in `feed` and `update` under a heap-delta check.
  16. Owner flags: commit with tilt off, toggle on, lift; and TURBO hold to boost, lift. Both end with both flags clear and tilt handing back. A later thumb session still hands back.
  17. Thumb down across a toggle-on: exactly one owner, and the first hand-back uses the pose at going live, cap 0.
  18. Gain: starts 0; a probe that reaches `active` writes no stretch; returning start eases in.
  19. Sleep: gain 0 for 2 s leaves `tilt.active` true; `turnOff` stops once at gain 0; a hidden page during `turnOff` stays off on return.
- **`s_gesture.ts`:** `harness(mode)` takes `tilt: boolean`.
  - Tilt rows become "tilt on, screen is the bungee". Swipe rows are deleted.
  - Touch rows stay byte-identical with one named exception: "slow tap 260 ms, still" now splats. New row at 440 ms splats; 460 ms does not.
  - Adds: button rows through `splatButton`; `adoptThumb` before charge, while charging, and refused when a thumb steers; press end on the adopted lift; second finger during adoption; drop during adoption; `hudBlip`.
  - Adoption count: adopt at 14 px, lift inside the quick window: exactly one `onTap`. Adopt before charge, lift later: none. Adopted charge: exactly one `onChargeEnd`, no `onTap`.
  - Row 77 "quick flick 20 px in 90 ms (still a tap)" stays green.
  - Two fingers tapped together: both lift at 400 ms, one tap; at 470 ms, none.
  - No `chargeStart` from any canvas row.
- **`s_perm.ts`:** `throw` and `reject` end at `blocked`; `denied` stays `denied`; probe returns status to `off`; calibration waits for `gStill`; a scripted 25 degree swing that pauses 0.1 s then returns is not the neutral, for both toggle-on and RECENTER; the 1.5 s cap still calibrates a phone that never settles.
- **`s_layout.ts` (new):** `layoutHud` reproduces section 3's tables; no two hit rects overlap; hit at least 44; no hit rect reaches x < 14 or x > w - 14 in any of the four layouts, swapped or not; nothing in the bottom 40 px; every visual inside the safe area.
- **`s_prefs` (in `s_perm`):** migration of `mode` values, absent stays undecided; two ignored chips clear `tilt`, one then a turn-on resets the count; a Busy tap clears `tilt`.
- **Hud (`tools/controls.mjs` `gestures`, offline where fakedom allows):** TURBO lifted at 400 ms shifts once and boosted briefly; at 500 ms it does not shift.

**GPU, one browser, on the bake laptop's schedule:**
- **`tools/controls.mjs`:** selectors `splat` to `mega`, `lever` to `turbo`, add `gear-down`, `tilt-toggle`, `tilt-chip`; `prompt-touch` removed.
  - `touch`, `turbo`, `gestures`, `flows`, `opening` rewritten for one layout.
  - New `hybrid`: mocked sensor, real CDP touches: drag during a carve, lift, flight log; turbo press in a carve; mega hold while tilted.
  - New `firstrun`: no skipintro, no card, no hold, shots of TAP, DRAG, TURBO blink, chip; chip tap asks inside `touchend` with the mock recording `navigator.userActivation`; ignored chip reaches the corner.
  - New `layout`: real rects at 393 x 659, 320 x 568, 852 x 393 against `layoutHud`.
  - Refused, blocked, silent, Android probe.
  - `flows` adds: open settings 2 s, close, `controls.tilt.active` still true and the toggle still On.
- **`tools/feel.mjs`:** `g.controls.mode === "tilt"` becomes `g.controls.tilt.active`, enter via the chip. `carve.json` still shows glint at press == building hit at roll 0 / 12 / 20 / -20. Add a thumb-in-a-tilt-carve then tap row.
- **`tools/supersplat.mjs`:** `controls=touch` runs unchanged except for the charge press, which goes through the MEGA button. Meter dock shots above and on the face.
- **`tools/jet.mjs`:** frame pacing unchanged, no new per-frame DOM writes (a MutationObserver count of style writes while idle equals 0).

**Real iPhone, HTTPS preview, the first and only proof of feel:** press-shake amplitude, calm, fade, settle, grace and `stillTapMs`; reach swing size; whether `touchstart` blocks the back swipe; real Safari height and insets; whether a probe hears a surviving grant; cue position against the bus.

## 11. Disagreements settled

| Question | Decision | Why |
|---|---|---|
| Still press window: 230 (judge 3) or 500 (judges 1, 2) | 450, for everyone | A dead press is the failure a child hits. Removing screen-charge frees the meaning. 500 would touch the 0.5 s latch. Only one existing row moves, so judge 3's regression gate stands. |
| `tapMs` 300 | Rejected | `stillTapMs` is a new constant. `tapMs` still governs the together window and second-finger test. |
| Re-zero on lift | Ergonomic's `f` with Clutch's cap | Keeps nudges, cures long sessions, no carve grows |
| Ratchet: ship (2), flag (1), defer (3) | 1.5 s grace only, no home walk, no second zero | Body English is likely and its wrong-way turn is the producer's exact complaint. The bound answers the "dead for 3.5 s" objection and `grace: 0` disables it. |
| SETTLE after every lift (Ergonomic) | Only when the phone moved 5 degrees | A forced zero dips every carve; judge 2 proved it. Unmoved lifts use Clutch's continuity. |
| Freeze vs calm | Calm | No hitch in an S-curve |
| Pose before a reach: ring (1, 2) or none (3) | Four 0.15 s snapshots | The carve survives a reach; judge 3's cost objection is met at 12 floats. |
| Resting thumb: live tilt or straight | Straight, past 450 ms | Simplest escape. Edge rest keeps grips from killing tilt. |
| Palm role-steal, edge zone rewrite | Rejected; edge rule never changes roles | Keeps `s_gesture`'s role model |
| MEGA adoption (judge 3 against) | Built | MEGA sits in the thumb's rest zone, so a drag starting there must steer. Judge 3's glint hazard does not hold: the press latch expires at 0.5 s (`Aim.ts:257`). The pointer hand-off is tested offline. |
| Refusal: persist (1) or session (2, 3) | Real `denied` persists; `blocked` never does | The player answered a sheet. Asking only from toggle or chip means no nagging. |
| Asking on an arbitrary touchend | Rejected | Only an element that means yes |
| Quiet listen as a relied path | Optimisation only; the chip is the fallback | Unverified WebKit behaviour cannot be load-bearing |
| Chip (1, 2) vs default-on word (3) | Chip, flagged to the producer | iOS needs a tap and the old card is the judge's main complaint |
| Chip flight to the corner | Kept | It is the only teaching of where the choice lives |
| Rest alpha | Rejected; `punch` | Palette only |
| MEGA height: 36, 38, 45 % | 45 % | A 10 s hold |
| Meter is the button | Face plus meter | SuperMeter's 68 px ring cannot scale to 84 px on the pixel grid, and a charging thumb covers its own face |
| Boost and the reach clutch | Clutched for the whole boost, with no `reachBoost` | Fewer states than a deferred grace. It needed one more change: time no longer counts as a new hold for a reach, or a two-handed boost would rebase the carve and counter-carve -69 degrees (sim-fixes). |
| Review fix `&& !gSteered` at `Input.ts:596` | **Rejected, the bug is real but that line would cause a regression** | `pointerMove` commits at 12 px, so a quick flick sets `gSteered` and still has to tap: `s_gesture` row 77 pins "quick flick 20 px in 90 ms (still a tap)". Also, copying the press's `t0` does not make an adopted slot "never quick": a 14 px slide lifted within 150 ms passes `isQuick` (`quickTapMs` 150, `quickTapSlopPx` 26). So the gate is `!slot.ownsPress`: a kept charge ends only in `pressEnd`, a cancelled press inside the quick window fires its one tap, and a thumb past it fires none. |
| Toggle-off save (review said save when stopped) | Saved at once, stop deferred | The bug was the stop, not the save. Saving at once also survives closing the page inside 0.2 s. |
| Stillness hold for toggle only (review) | Chip and toggle both | One path, 0.3 s cost on the chip, and the hand has just come off the sheet's button anyway |

## 12. Known risks

- Nothing has been felt on a phone. All tunables are estimates.
- Fewer players will try tilt than with a card that took any tap as yes.
- A phone relaxed more than about 2 s after a moved lift gets a counter-carve (-38 degrees (sim)) until a thumb hold or RECENTER.
- A one-handed reach swings the bus until the finger lands.
- A hand that lingers 0.3 s or more in the reach pose after turning tilt on or pressing RECENTER still sets the neutral there (sim-fixes). Only RECENTER or a thumb hold clears it.
- A grip finger in the 14 px band becomes a Primary rather than pressing a button, so the real thumb is a Secondary until the grip lifts (section 6, palm row). The grip no longer fires anything by accident, but steering can be lost to it.
- Grace makes a deliberate roll back dead for up to 1.5 s.
- A hard bank can rotate the page in Safari.
- Left-edge drags could trigger back-swipe if `preventDefault` does not hold on iOS 26. That would lose the game.
- `adoptThumb` moves pointer capture between elements. Verify on iOS Safari, where a touch's target stays the element it started on.
- A large deletion touches Input, Hud, Controls and three test tools at once.
