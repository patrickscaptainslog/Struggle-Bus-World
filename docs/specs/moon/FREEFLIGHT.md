# FREEFLIGHT: fly the whole Moon

The producer, 2026-11-02, after flying `?moonland`: "Works pretty great. I was hoping to be able to free fly around the whole moon".

**State.** Nothing's built. 5-7 agent-days in all, broad rather than deep. The survey below was made on `spike/moonrun` at 14215d8 and 42 of the 43 references checked hold, but line numbers drift, so search for the names.

## What stops it

Low over the Moon the world is one 256 km square. `world.place()` remakes it, but only from high up with the ground off screen: `src/main.ts:1500-1504` drops everything (`city.reloadAll`, `ground.resetAll`), then `src/moon/moonBoot.ts:334-344` remakes the frame and asks the worker. Three things turn the bus back: `src/main.ts:1168-1179` in the low game, `src/game/Turbo.ts:224-235` for the gears, `src/moon/Landing.ts:228` (`HOME_IN`) in the flight's own loop.

Already there: the orbit steers (`steering` in `src/sky/MoonTrip.ts`) and a lap takes about 7 minutes, a fall lands anywhere, the generator is a function of latitude and longitude, craters keep their ids on any map, and crater paint is kept by id and latitude.

## Stages

Each stage ends with a push, a pull request into `spike/moonrun` and a message to the producer with the link and what to try. The next stage waits for their word. A stage that turns out much bigger than its estimate stops and says so.

### Stage 0: set up (under an hour)

Run everything under "Running it" in `CLAUDE.md`, plus `node tools/moon/fly.mjs shots/tmp/fly --flights=cruise`, and look at one frame yourself. With no GPU that flight takes about 3.5 minutes, so run it in the background. Report what ran, what didn't and how slow it was. If the brief is wrong, fix the brief.

Done 2026-11-03, on a cloud machine with 4 cores and no GPU. Everything ran: `npm ci` 11 s, types 6 s, the build 2 s, `iosfloor` 1 s with every chunk parsing, `smoke` 23 s for its three pages (first ready frame 2.6 to 4.7 s, no errors), and the cruise flight 204 s for its 12 s, page and all, with no errors and 30 programs at the end, as many as `?moon` has at its first ready frame. Its last frame is the bus 9 m over a cratered floor, a mountain ahead and Earth up in the black. The brief was wrong in three places, fixed here and in `CLAUDE.md`: the clone held only `main`, and shallow; this session's `gh` was for search only, so no commit status; and the flight is shorter than it said.

### Stage 1: flicks on the Moon (under a day)

`spike/moonrun` still has the old TURBO button. Fetch the branch (`CLAUDE.md`, "A cloud clone"), then `git merge origin/feat/thumbs`. That changes this branch only: the controls stay off the live site until the producer says so. 72 commits meet 44, and five files conflict, in six hunks of code plus `DECISIONS.md`. Express, Nonstop, `WARP`, `h.level` and `this.shifter` are `feat/thumbs`' names, so they aren't here until you merge.

- `src/fx/Turbo.ts`: keep this branch's `* this.fade` and take `feat/thumbs`' boost: `clamp(Math.max(drive.speedK, drive.boosting ? 0.5 : 0), 0, 1) * this.fade`.
- `src/game/CameraRig.ts`: the imports of both sides that are still used.
- `src/game/Controls.ts`: keep `leftGround()`, drop `sheetUp` with tilt and whatever calls it. Keep `h.level`, `h.armed = this.shifter.armed` and the Moon's `h.mph` line.
- `src/game/Turbo.ts`: `this.top || (config.turbo.worldTravel ? WARP : JET)`, and `feat/thumbs`' simpler `if (this.gear >= this.maxGear) return false;`. Gears are numbered differently on the two sides, so `controls.turbo.top = 3` in `src/main.ts` becomes `WARP`, and every other Moon line that reads a gear's number needs checking against the new ladder.
- `DECISIONS.md`: keep both sides.

Then what git can't see. `src/sky/moonrun.ts` makes a `Hud` with tilt callbacks and hides buttons that have gone. Its `input.onTurbo` still fires on a flick, so a flick up does what TURBO's tap did, but the words have to change: "TAP TURBO: MOON" and its kin become flicks, in the hint's own short style. `tools/moon/stranger.mjs` and `edges.mjs` press `[data-hud="turbo"]`, and they have to flick.

**The ladder on the Moon**, decided here, and the producer can overrule it on the phone: Cruise, Express, Nonstop, Jet, then Stratos and Rainbow Warp, with the last gear leaving for orbit as it does today. Turbo 1-3 sit above the top unlocked gear, so on the Moon they don't appear. `worldTravel` stays off.

Done when: `?moonland` flies the whole trip on flicks with no TURBO button, the left of the screen looks, `tools/controls.mjs` and `tools/controls-sim` pass as they do on `feat/thumbs`, the plain game behaves as `feat/thumbs` does, and the producer has flown it.

**Built 2026-11-03, waiting on the producer's flight.** `DECISIONS.md`, "Flicks on the Moon", has the calls and their numbers. The five files went as above, and `main.ts` merged by itself onto `feat/thumbs`' `controls.frozen || covered`, so `sheetUp` had no caller left. The compiler found the rest of what git couldn't see: `config.turbo.alt3`, the flight's `Hud` callbacks and frame, and `state.turboHeld`. Nothing found these:

- Every gear the Moon names by number: `arrive`, `top`, the way out, the stiff rig, the trail's fade, the arrival, and the push held at Jet's floor, which now goes on down through Nonstop's.
- Seven tools pressing TURBO, two reading TAP TURBO off the label, and two meaning Jet by one shift.
- Two things a flick's stroke does out in space that a tap didn't: a slow flick could start a landing from orbit, and on the legs the thumb doesn't steer it tipped the view.

Checked on the final build, on a cloud machine with no GPU, at a fixed step. Nothing has run on a phone.

- Types, `npm run build` (what Vercel runs), `iosfloor` and `smoke` pass, with no page errors.
- The controls sims (`s_gesture` 625 checks, `s_layout` 295, `s_turbo` 27) and the look and nose sims pass, and write the same files byte for byte as `feat/thumbs`.
- `tools/moon/flicks.mjs --trip`: 13 rows, all pass, no page errors, 25 programs at the push and 25 at home. A slow right flick in orbit felt 0.167 s of push and went home, and a held push left after 7 frames. A flick in the long dark moved the view 0 degrees and a drag held 1 s swung it 40. A left drag of 100 px turned the view 46.4 degrees on screen for the rig's 44.3, and it was home 2 s after the lift. One held push took the bus from orbit to the ground in 1,530 frames, the gears coming down Jet, Nonstop, Express; four flicks took Express to Rainbow Warp, 500 frames took it back to orbit, and a flick there went home.
- `tools/controls.mjs` on both builds side by side, at 1x, since at 3x a row takes minutes on software GL. The gesture table: 47 of 49 on both, and the same two fail on both (Nonstop still lifting taken back, and MEGA's tap with a thumb steering), so it's this machine and not the merge. The numbers that differ are the look's angle, which runs on the wall clock, and two heights after a wall-clock wait. 42 look rows are the same on both in every number but the draws. At 3x its `touch` mode stops on both: the settings panel never opens.

Left for a laptop and the phone: the rest of `controls.mjs`, which takes over two hours here; `stranger.mjs`, `edges.mjs` and `warmcheck.mjs`, which time their legs by the wall clock; anything in real time; and every number a thumb decides.

**The producer's first look**, 2026-11-03: "Flick up for the moon sounds great. For the moon run, I want to be able to pan the camera like it was before." So out in space, where the thumb doesn't steer, a drag on either side pans again at the stick's own rate from its first pixel, and the view stays where it's left; what a flick panned goes back. In orbit the left of the screen still looks. `flicks.mjs` has two more rows for it, and on the same build: a left drag held 1 s pans 48.5 degrees to the right's 49.4, the view is within 0.01 degrees of where it was left 1 s after the lift, and a flick on either side leaves it. The controls sims still write `feat/thumbs`' files byte for byte.

### Stage 2: the map slides (about 2 days)

The core of the job. From Theophilus, Jet in a straight line for 500 km, low, about seven joins, with no turn-back.

1. A frame that can carry its axes (design notes 1 and 2).
2. `world.slide()`: at about 64 km from the middle, hand every holder of a world position the same shift in one moment. The table below is the list.
3. The worker takes the new frame for new requests and keeps what it has.
4. One datum for the session, so Y never steps.

Done when: on a fixed-step flight the frames either side of each join differ by less than the same flight's frames with no join; `tools/moon/pops.py` finds nothing; crater paint and ground paint near the bus survive every join; no program compiles; memory is flat over the flight; and the producer has flown it.

On a cloud machine a second of flight at `fly.mjs`' fixed step costs about 25 seconds, so 500 km of frames is out of reach there. Add a test hook that puts the bus just short of a join, fly through it, and do that for a few joins. Leave the whole 500 km to the first account's laptop and the producer's phone, and say so in the hand-in.

### Stage 3: the whole Moon (2-3 days)

- All three turn-backs off on the Moon, at any height.
- Both poles, the far side, and the line where longitude wraps.
- Stratos low across the Moon, with the far field keeping up. If the worker falls behind, the ground goes a level coarser, a blur and no hole. Stop short of holes.
- Light across the Moon (design note 6).
- A crater painted on one side is still painted after a full lap, and out from anywhere to orbit and back down elsewhere still works, twice on one page.

Done when: fixed-step flights round a great circle and over both poles show no holes and no NaNs, paint is kept, memory is flat, and the producer has flown it. Name the long real-time flights that are left for a real GPU.

### Stage 4: hand in (half a day)

Bring `GROUND.md` and `LAND.md` up to date, say what's rough, and turn this file into a record of what was built.

## What assumes the map stays put

Haiku's survey. R2's shift is the spine of Stage 2.

| | Where | Assumes | Change | Size |
|---|---|---|---|---|
| R1 | `moon/moonBoot.ts:336`, `main.ts:1495` | one MapFrame, changed in place | hand-over at one moment in the frame | M |
| R2 | `moon/moonBoot.ts:31,201` | map centred on the origin, bus x, z in map coordinates | one shift for R3-R14 | L |
| R3 | `moon/gen.ts:231-240` | datum from the map's lowest relief | keep one datum for a session | M, S if kept |
| R4 | `moon/moonWorker.ts:84-85,109-112` | one generator and FarStore | new frame for new requests | L |
| R5 | `moon/Landing.ts:47,203` | re-centred only from orbit | low-game trigger | M |
| R6 | `world/City.ts:918-925` | reloadAll drops every region | shift regions, tag replies by place | L |
| R7 | `world/City.ts:605-607,808,914`, `moon/MoonFar.ts:87` | mask, rect and horizon grid fixed from bounds | new uniforms for each place | M |
| R8 | `moon/moonBoot.ts:139-149`, `moon/gen.ts:245` | Sun and light in the map's frame | near tiles bake by `localSun`, the bus's light eases | M |
| R9 | `moon/CraterPaint.ts:225-241`, `moon/PaintClip.ts:289-295` | rebase clears spots, grids and windows | shift, don't clear | M |
| R10 | `world/GroundPaint.ts:315-316`, `main.ts:1503` | paint keyed by world tile | shift by whole 256 m tiles | L |
| R11 | `fx/Turbo.ts:196,633` | contrail samples in world x, y, z | shift the samples | S |
| R12 | `game/Flight.ts:61-63,413-415`, `game/CameraRig.ts:154-155` | x, z, groundBroad, rig position across frames | shift them | S |
| R13 | `world/props/sprouts.ts`, `moon/moonBoot.ts:209-216` | gardens and street names in world coordinates | rebuild from CraterPaint's records and `near` | M |
| R14 | `game/Aim.ts:30-31`, `game/Splat.ts:101-102`, `fx/StreetSign.ts:451` | stored targets, use across frames unsure | shift stored targets | S |

The map's size is fixed at `moon/moonBoot.ts:31`, `moon/Landing.ts:59`, `moon/gen.ts:234`, `main.ts:389`, `game/Turbo.ts:88` and `world/City.ts:808,914`. What grows with the map: the horizon grid, the water plane, the paint-density map (`main.ts:390-391`). The far textures don't: 16 MiB at 8 levels, 20 at 10.

Not surveyed: `PaintState.ts`, `City.onRegion`, the obstacle grid, `GroundPaint.resetAll`'s body, `AT` in `MoonFar`.

## Design notes

1. **A pure slide, not a rebuild.** A frame made from `axesOf(old, x, z)`, with u from its row 1, e from row 0 and n from minus row 2, keeps the map's axes as they stand at the bus, so heading, camera and the Sun's bearing don't turn at the join. `dirOf`, `mapOf` and `axesOf` read only u, e and n, so a frame with any axes already works. `makeFrame` has no way to say so, and "+X east" has to be checked wherever something assumes it. The worker's `place` message has to carry axes, not latitude and longitude.
2. **Whole tiles.** Put the new origin on a whole multiple of a region (1,024 m), so everything keyed by tile moves by whole tiles and keys stay integers.
3. **How well it fits.** The old map's sideways scale at distance c is sin(c)/c: 0.23 m per km at 64 km from the middle, 0.9 m per km at 128 km. So near ground lands within a metre at 1 km and about 3 m at 5 km, under a pixel at that range. That's calculated and nobody has seen it. Hence a slide about every 64 km: 2.4 minutes at Jet, 14 s at Stratos.
4. **Nothing reloads.** Loaded regions, paint tiles and paint windows shift. Only new requests use the new frame. Old and new tiles meet where the old ones end, at least 2-4 km out.
5. **Far field.** A level's window moves by blocks of 512 m x 2^k, and level 9's block is 262 km, longer than the step. So each level needs its own origin offset, not a shift by blocks.
6. **Light.** Near tiles bake by `localSun` as far blocks already do, so nothing steps at a join. Half the Moon is always in the dark and a lap crosses it, so night matters now (`LAND.md`, What's rough). Decided: the true Sun stays, and night gets a faint fill so the ground reads, with paint still the brightest thing. The producer can overrule this on the phone.
7. **Distance.** A lap is 10,916 km: 6.7 hours at Jet, 3.4 at Turbo 3, 40 minutes at Stratos, 7 from orbit. That's why the Moon keeps gears above Jet. Speed still never grows with height.

## Risks

The join showing. Memory on a phone: a job this wide must not hold two worlds at once. The worker keeping up at Stratos. Nothing on the Moon has run on an A15.
