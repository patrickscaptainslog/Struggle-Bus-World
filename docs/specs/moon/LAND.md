# From orbit to the ground: `?moonland`

The one link. Earth orbit to Moon orbit as `?moonrun` flies it, then a push of the thumb, and the bus goes down from 300 km to skimming the ground at the clearance it has over San Francisco, on one page, with no reload and no fade. It's all behind `?moonland` (`moonLand` in `src/sky/flag.ts`). To everything that asks, it is `?moon` (its programs, its files). `src/moon/Landing.ts` is what joins the two loops; read its header first.

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
- The thumb's sign is the yoke's: thumb up is nose down. The brief said "push down". One word in `pushOf`/`YOKE` if the producer means the thumb going down the screen, and it's the producer's call with the new controls.
- Going down, the bus is a speck, nose away. It reads, barely.
- The low game's Jet contrail comes in from 8 km and is big against the bus at that height.

## For the next agent: items 6 and 7

**Back up.** There is no way out of the low game yet: `Landing.hand` has no inverse. What it wants:
- A height over the ground in `main.ts`'s frame, say 15.5 km, climbing. `config.flight.ceiling` is `s.y + 3000` at the hand-over: move that to wherever the hand-back is.
- `trip`: `ob.pos`, `heading`, `dir`, `nose`, `v` back from `flight`, the inverse of `Landing.pose` and `hand`; `leg = 'fall'`; `landing.ground = false`, `near` stays true. `mapOf`'s inverse is `dirOf`.
- `view` needs its pose from the rig: `TripView.takeBack` is the spring that holds a view where it is. A `fromSky` the other way would do it.
- Scene and thumb: far mesh and sky to `space`, `Object.assign(input, flightHands)`, the HUDs back. Those two objects are in `boot()`'s closure: put them on the `LandWorld`.
- Above `H_SHOW + 15` the dissolve already runs backward and `leave()` hides the mesh. A pull in the flight's loop is flown and tested. TURBO in `fall` above 150 km already goes home (`leaveMoon`). Speed never grows with height on the way up: going up is gears, the ruling, and `lawFall` is only a limit.
- `Landing.arriving` is false by the time it could matter. `trip.gov`, `trip.ground`, `trip.home` are reset by `leave()`.
- The label and the flight's HUD are hidden at the hand-over, at the end of moonrun's frame: show them again.
- A second map after being down: `city.reloadAll` is wired in `place`, but `RimBloom`'s gardens and the rocks' paint aren't cleared by `rebase()`. It has only been run with nothing on the ground.

**Paint.** `moonClip` already reads the windows in the far field, but `PaintClip` only follows the bus in the low game. To read the orbit's map all the way down: `spacePaint` is in `GLSL_SPACE`, needing `uv`, `t`, `art`. Move it into `GLSL_MOON_SHADE`, and the mesh has all of it from `spaceMoonLight`. `normalize(vRound) * uMoonRot` is the place, Moon fixed, at any height, in both loops (`Landing.over` keeps `uMoonRot` right): lose the `uFarHigh > 0` test on that branch of `FAR_FS` for it. Crewed sites stay grey: `moonSite` is there, in map metres.

## Tools

`tools/moon/land.mjs <dir>` is the flight, with `--every --burst --push --steer --late --pull --lift --again --same --t --dt`: its header says what each does. It prints a line every few seconds, then what compiled and what was slow. `same.py` compares the two pictures of `--same`. `sheet.py` makes a contact sheet of a folder. `farcost.ts` is what the far field costs a worker. `smoke.mjs` stands up `?moonrun`, `?moon` and `?moonland`. `wire.mjs <dir> moonland` is the bytes. The frames of the last flight are in `shots/local/moonland/down/`, with `burst/` for the two hand-overs.
