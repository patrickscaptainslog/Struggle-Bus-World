# From orbit to the ground: `?moonland`

The one link. Earth orbit to Moon orbit as `?moonrun` flies it, then a push of the thumb, and the bus goes down from 300 km to skimming the ground at the clearance it has over San Francisco, on one page, with no reload and no fade. TURBO takes it back up and home, as often as you like. It's all behind `?moonland` (`moonLand` in `src/sky/flag.ts`). To everything that asks, it is `?moon` (its programs, its files). `src/moon/Landing.ts` is what joins the two loops; read its header first.

## How it goes

**One page, one pump.** `bootLanding()` in `main.ts`: the flight's loop first (`bootMoonrun`, with `land`: one `Input` and one `AudioEngine` shared, a `THREE.Scene` of its own), so the first frame is as soon as `?moonrun`'s. Then `boot(land, shared)` runs behind it: `startMoon`, `City` with nothing in it, the worker, every program. Nothing of it waits for a place. `boot()` doesn't start its own rAF: `moonrun.ts`'s frame calls `world.frameAt(now)` once `landing.ground` is true. `window.__space` is the flight's QA object, `window.__game` the low game's.

**A world from a thumb.** A push held 0.15 s in orbit starts leg `fall` in `MoonTrip`. `Landing.update` reckons where this way of going comes down, and `world.place(lat, lon, ms)` makes the map there: `frame` is changed in place, the worker builds a new `MoonGen` and resets its `FarStore`, `CraterPaint.rebase()` puts everything named back on the map, `City.reloadAll()` and `ground.resetAll()` drop what was on the last one. A place is a number: anything from an older place is dropped both ends (`place` on far and region messages). It is made in the fall, not ahead: `tools/moon/run.mjs farcost.ts` has a level at 260 ms and all that shows at the top at 1.5 s, under Node on the laptop. The map moves if where it's going moves more than 70 km, while there's height to do it. If the far field isn't up by `H_SHOW` the fall is held back by `trip.gov`, down to a stop at that height.

**Down.** `v = 450 m/s + (h - 2 km) / tau`, the most it may be and never back up, so climbing leaves it where it was. Tau is what leaves 30 km/s at 300 km: 10.1 s. The yoke is Flight's, the same dead band, curve and rate (`YOKE`): the thumb sets the way the bus goes. So 85 degrees at full push and about 45 s to the ground; a shallow dive takes longer. Let go and it flies on level, on round the Moon. Pull and it climbs at the speed it has, and at 300 km it's the orbit again.

**The hand-over is two hand-overs, far apart.** The brief had the game's loop reach up to 100 km, with the ceiling raised. It's the other way about: the flight's loop reaches down, and the ceiling stays about 15 km. Every number in the low game, the rig, City, the map's edge, the yoke, is proven up to there and no further, while the flight's law and view hold at any height. And the two changes that could show then happen far apart, each with the other standing still.

1. **Ray to mesh, at `H_SHOW`, 120 km.** `landing.near`: the render frame stops being the view's and becomes the world's. The lens stands where it really is on the map, turned by the view's own axes (`Landing.pose`), so the far mesh draws with nothing changed in it, the sky is drawn in the world's axes, and bus, stars, Earth and Sun don't move. The mesh comes in over 3 s by a dither that writes "sky", no discard. Up here it takes the resolve's own light for the place (`spaceMoonLight`, `GLSL_MOON_SHADE` in `skyResolve.ts`, one function for both): the same maps, the same invented craters, the same ramp. So it dissolves in over itself. `moonLift` brings the ray test's sphere down onto the ground in the middle of the view first.
2. **Flight to low game, at `H_GROUND`, 14 km over the ground.** `Landing.hand` and `world.enter`: far mesh and sky move to the game's scene, the thumb's callbacks swap (`flightHands`, `groundHands`), the HUDs swap. `Flight.takeOver`, `CameraRig.place`. The rig then takes 2.4 s to come over from the view the flight left, off the bus (`fromSky` in `main.ts`), so its pose needn't match the view's. The law goes on in `Landing.drive`, and the gear is Jet, so that's what the bus has when the law lets go at 2 km. A thumb still pushing at 200 m shifts it down, and it goes on to the rooftops.

Between the two the mesh's light goes over from the ray-drawn Moon's to its own, `LIGHT_HIGH` 45 km to `LIGHT_LOW` 8 km (`far.high`): the invented craters of the orbit fade out and the generator's come in. That's the one slow change you can see.

**The Sun.** The true one, the one orbit shows. Two things follow. The far field runs out to the horizon, a fifth of a right angle of Sun away, so `FarStore` bakes each block by the true Sun over it (`sunFix`, `localSun`) and the terminator comes where it comes. And from overhead nothing has a shape, so the bake takes the Sun's bearing and 30 degrees at most (`SUN_CAP`), near ground too. The disc stays where it is. By night it's Earth, as `?moon&t=` has it.

**The far field.** Ten levels for this world, to 2,048 m a texel and 1,048 km out; `?moon` keeps 8. Only what shows at this height is made (`MoonFar.detail`), so up high no level of metres is being chased at 9 km/s. `busSize.ts` drives both loops: `CameraRig.sizeAt`.

## What was measured

Laptop, UHD 620, headless Edge, a real touch through CDP. **Nothing here has run on a phone or in Safari.** The frame times are this machine's: read them as "no hitch in the code", not as a phone's.

| | |
|---|---|
| A flight, thumb held from orbit | 298 km to the floor in about 48 s, no reload, no cut, on build `main-HzS1ovri.js` |
| Frames | 16.7 ms all the way but one: 33 ms at the change of loop. Nothing over 25 ms in `render`, `city.update`, `far.update`, `flight.step`, `paint.update`, `controls.frame` |
| Programs compiled in flight | 0 |
| Ray against mesh, same moment at 110 km | horizon within 1 px; ground 108.8 against 108.7 of 255; the picture 0 to 2 px off (`same.py`). So the roll onto the sphere holds to the horizon at 590 km |
| Draws, triangles, the worst of the flight | orbit 10, 4.7 k. Under the mesh 9, 0.29 M. Low game high up 36, 1.11 M. Skimming 52, 0.87 M |
| First frame | 2.8-3.9 s, as `?moonrun`'s 2.8-3.1 s here; the low game ready 3 s after that (warm-up 5.2-6.9 s from load), 25 programs |
| On the wire | 2.63 MB: Moon data 1.71, sky 0.43, code 0.48. `?moon` is 2.60, `?moonrun` 2.35: it fetches `relief.bin` too, so this adds 0.28 MB to the flight |
| GPU, worker | far field 22.5 MB (10 levels), paint windows 16 MB; the worker holds about 21 MB |
| Flag off against 5c90776 | 62 shader sources, 0 bytes differ, 31 programs, the same 22 files. `?moon` and `?moonrun` stand up. `iosfloor` passes |

Flown with a real thumb: a full push, a shallow dive (30 degrees, 90 s), a thumb lifted at 40 km and pushed again with steering, pulled out at 60 km and at 150 km back to the orbit, a second fall from there in the same page, the far field held back 20 s (the fall stops at 121 km and goes on), a low Sun, by night. A tap down there is a breath and a crater, in every run.

## What's rough

- From 45 km to 8 km the ground changes under you, as above. With a low Sun it also brightens: the ray-drawn Moon falls off toward the terminator and the ground's light doesn't. It's slow, and no seam, but the tone isn't one tone all the way.
- A faint straight edge between two far levels, when the tones of the two differ a little, about 20-30 km up, over a sea.
- The far side at full Moon is black: no Sun, no Earth, the bus's headlight and the stars. It flies and it paints. It's the dark side, so it's true, and it's the one place a stranger might not know what they're looking at. It's the producer's call whether night wants a light of its own.
- The thumb's sign is the yoke's: thumb up is nose down. The brief said "push down". One word in `pushOf`/`YOKE` if the producer means the thumb going down the screen, and it's the producer's call with the new controls.
- Going down, the bus is a speck, nose away. It reads, barely.
- The low game's Jet contrail comes in from 8 km and is big against the bus at that height.

## Back up

**The way out is gears, and the last gear leaves.** TURBO in the low game shifts as it always has, and on this flag it has two more: Stratos, 4.5 km/s over a floor of 2 km, and Rainbow Warp (`TurboDrive.top`; `worldTravel` stays off, so the map's edge still holds them back). G3's floor is at 17 km (`UP_FLOOR`), which it never reaches, and it holds the yoke back by itself: three taps and the bus goes up at G3's 3 km/s, with the rig's height going with it as a yoke's would. A push ends it and shifts down. The other way out is the patient one: Jet and a thumb held back, 450 m/s, 33 s to the join.

**The join is `Landing.back`, `hand` the other way.** At `H_UP`, 15 km over the ground and climbing, a kilometre over where the bus was handed down, so a thumb that can't make up its mind doesn't flip the loops. Where the bus is and which way it faces go back through the Moon's frame at that moment. Nose and speed are the true velocity's, not `Flight.speed`, which has no part of a gear's floor lifting the bus. The view stands where the rig had it, and `TripView.takeOver` leaves it to the spring it already has for a change of body. Lens and bus come over in 2.4 s (`REJOIN`). The low game's ceiling is 24 km over the ground under the bus, every frame, so nothing soft takes the climb off it first.

**Up from there it's the gear.** `MoonTrip.climbV` is the speed of the gear the bus came up in, spooled as any gear is, the same at any height: the ruling. `lifting` is G3's way out: with no thumb on it the nose stays up and it goes to the orbit. It comes onto the orbit's height, levelling off from `FLARE_S` of its own speed under it, so it doesn't stop dead. There `TURBO` goes home, as it says. In the flight's loop TURBO under 150 km is the same shift (a fall can be called off with it), and over 150 km it goes home from where the bus is. The law, a brake on arrival, comes back only when a push ends the climb, and then the speed eases down to it.

The dissolve runs backward above 135 km and `leave()` hides the mesh. Nothing is made on the way up.

**What the low game leaves behind.** The engine and the hum hold their last note when the graph's frame stops, so `AudioEngine.hushGround`. The hero's beam and circle are the pipeline's: off. The glint goes with the target, or it stays on the far mesh. `globals.uLight` is the flight's own each frame now.

**A second map after being down.** A rim's garden goes with the map (`RimBloom.clear`), the rocks go with their regions, and what's painted comes back by id and latitude.

## Paint, from orbit all the way down

`moonPainted` is the one read of `MoonPaint`'s map, in `GLSL_MOON_PAINTED`: the resolve's, the far field's and the tiles'. The place is `normalize(vRound) * uMoonRot`, Moon fixed, in both loops.

- **The far field** reads it at any height, after the crater windows and under a crewed site's grey. Up where the mesh is the ray-drawn Moon it's the resolve's own step (`moonPaintLevel`), so it dissolves in over itself, and it goes over to the ground's light (`moonPaintLight`) with everything else.
- **The tiles read it too**, under `landOnly`, or a flood from orbit has a grey hole round the bus exactly the size of what's loaded. `?moon`'s near program is unchanged, byte for byte. `uPaintOn` keeps a Moon with nothing on it from paying for the read.
- **What goes the other way.** A crater of 1 km radius or more goes on the orbit's map the moment it's hit (`CraterPaint.onBig`, `MoonBreath.lowStroke`), a slice a frame once the flight's loop has the frame, not on the next boot. It stands there at 6 km at least, which is what orbit can see and more than the place holds, so its texels carry `LOW_MARK` in the reveal byte: the resolve shows them, the far field shows them only while it's being the resolve, by the same dither, and the tiles never do. Down there the crater's own paint is on the windows.
- **The wide paint windows follow in the flight's loop** (`CraterPaint.fly`), so craters painted earlier are on the far field on the way down, not all at once at 14 km. The two fine ones stay off until the low game has the frame.
- Crewed sites stay grey: `moonSite` comes first on both.

## Tools

`tools/moon/stranger.mjs <dir>` is the whole of it with real touches: TURBO out, a thumb down, taps at what glints, TURBO out, TURBO home, with `--real --lap --splash --paint --out --again --steer --burst`. It prints every long frame, what compiled, and both sides of every join, frame by frame: where the bus stands on the screen, how far the lens moved and turned. `tools/moon/land.mjs <dir>` is the way down alone, with `--every --burst --push --steer --late --pull --lift --again --same --t --dt`: its header says what each does. It prints a line every few seconds, then what compiled and what was slow. `same.py` compares the two pictures of `--same`. `sheet.py` makes a contact sheet of a folder. `farcost.ts` is what the far field costs a worker. `smoke.mjs` stands up `?moonrun`, `?moon` and `?moonland`. `wire.mjs <dir> moonland` is the bytes. The frames of the last flight are in `shots/local/moonland/down/`, with `burst/` for the two hand-overs.
