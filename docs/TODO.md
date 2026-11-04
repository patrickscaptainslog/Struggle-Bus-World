# The list

Tick what you finish, in the commit that finishes it. Add to it when the producer asks for something. Written 2026-11-02.

## Second account: the whole Moon

Branch `feat/moonfree`, cut from `spike/moonrun`. The plan is [specs/moon/FREEFLIGHT.md](specs/moon/FREEFLIGHT.md). Each stage ends with the producer flying it on their phone, and the next stage waits for that.

- [x] Stage 0: set up and prove the tools run here
- [ ] Stage 1: flicks on the Moon (merge `feat/thumbs` in). Built and pushed 2026-11-03, waiting on the producer's flight
- [ ] Stage 2: the map slides, a long straight low flight with no turn-back. Built and pushed 2026-11-03 with Stage 3, waiting on the producer's flight
- [ ] Stage 3: the whole Moon, poles, far side, night, gears. Built and pushed 2026-11-03, waiting on the producer's flight
- [ ] Stage 4: tidy the specs and hand in

## Second account: the Moon trip as the producer wants it now

Same branch. The producer flew Stages 1 to 3 and ruled on the trip (`CLAUDE.md`, "The Moon trip"); the plan is [specs/moon/VOYAGE.md](specs/moon/VOYAGE.md). It comes before Stage 4.

- [ ] V1: no paint from orbit; the pan in space stays where it's left and one swipe looks behind; a trail that's alive; a bigger Sun and a Moon that grows on the way. Built and pushed 2026-11-03, waiting on the producer's flight
- [ ] V2: one MOON BOOST, under 6 minutes; TO THE MOON? extremely high over Earth and TO PLANET EARTH? very high over the Moon; at the Moon the street's flying and painting from orbit down, with WELCOME TO THE MOON. The boost, the buttons and the welcome built and pushed 2026-11-03; the street's gears and a tap's crater from orbit down 2026-11-04 (but a tap between 120 and 14 km, still nothing). Waiting on the producer's flight
- [ ] The launch from the street: from San Francisco the bus climbs off the city's map into the flight's loop until TO THE MOON? comes up (VOYAGE.md). Taken from the first account's list, 2026-11-04. Built and pushed the same day with a fade to black and a page change at the street's ceiling; the producer flew it: "it's great", but no cut, and the whole Earth flown freely (next item), which replaces it
- [x] E3 of the whole Earth, the page change in the long dark, on `feat/earthfree-e3` by a second session of this account, merged into `feat/earthfree` by the first session when it passes (the producer, 2026-11-04: "Ok let's do it", two sessions at once). E2 stays with the first session. Built and pushed 2026-11-04 (`DECISIONS.md`, "E3"), and merged the same night, its whole-trip test passing on the merged branch
- [ ] The whole Earth, flown freely (the producer, 2026-11-04; `CLAUDE.md`, "The Moon trip"): one page from the street up with no cut, free flight anywhere over a plain temporary Earth at any height, TO THE MOON? very high up, and back down to the street over San Francisco. The plan is [specs/earth/EARTHFLIGHT.md](specs/earth/EARTHFLIGHT.md), stages E1 to E4, on `feat/earth` (first `feat/earthfree`, whose preview link was too long to exist) cut from this branch. Earth and the Moon swap pages in the dark between them, a second of still stars: the producer's "Ok". The first picks are the producer's ("It's a go", 2026-11-04), and E1 started that night. E1, E2 and E3 built and pushed that night, waiting on the producer's flight; E4, in and out of the city low down, waits for that flight (EARTHFLIGHT.md)
- [ ] V3: pinch to zoom
- [ ] The first account's review, [reviews/moonfree-earth-2026-11-04.md](reviews/moonfree-earth-2026-11-04.md): the two blockers and nine majors fixed before anything goes to `main`, then reviewed again; the minors after. Fixed 2026-11-04 (4badd9b) and reviewed again the same day, [reviews/earth-fixes-2026-11-04.md](reviews/earth-fixes-2026-11-04.md): nine of the eleven hold, and two of the fixes brought four new problems to fix before `main`: P1, a cell of the Moon's open ground keeps 32 blasts, so much-painted ground loses paint on the next visit; P2, after a reload the paint comes back blast by blast over seconds; P3, `geoAt` misses cells at a tile's east or west end; P4, the street's wind plays on in space. Then the minors
- [ ] Home from the Moon comes down wherever the player aims, not over the city the trip left (the producer, 2026-11-04: "I want someone to return to earth and land wherever on earth they aim at and fly into"; `CLAUDE.md`, "The Moon trip"). Over a city with a street the street takes the bus; anywhere else it's the plain Earth until the living Earth fills it in (LIVING.md, stage 1)
- [ ] Sign `docs/specs/earth/CONTRACT.md` once the first account has drafted it, or change it with the first account until both can; then life, LIVING.md's stage 1, on `feat/life`

## First account: from 2026-11-05 13:00 UTC (5 am Pacific), when its weekly limit resets (the producer, 2026-11-04)

Start with [BRIEF.md](BRIEF.md): what the second account built meanwhile, what isn't live, and what to agree on.

- [x] Review `feat/moonfree`, then `feat/earth` on it (BRIEF.md says where to look hardest). Done 2026-11-04, with the real-GPU checks: [reviews/moonfree-earth-2026-11-04.md](reviews/moonfree-earth-2026-11-04.md)
- [x] Review again: the second account's fixes for that review's two blockers and nine majors, on `feat/earth` from 4badd9b to 8992444 (`DECISIONS.md`, "The first account's review, its blockers and majors fixed", says what changed and what was checked). The minors are still to do, after. Done 2026-11-04, with the real-GPU checks: [reviews/earth-fixes-2026-11-04.md](reviews/earth-fixes-2026-11-04.md). Its long frames, taken while the sky build ran on the same laptop, get run again quiet
- [x] Plan a living Earth, real terrain and buildings and things that move, live planes and ships among them (the producer, 2026-11-04; BRIEF.md has their words and the questions). Drafted 2026-11-04 as [specs/earth/LIVING.md](specs/earth/LIVING.md) and approved the same day: "Ok. I love this living earth plan", with their additions in it (cargo ships simulated on the real lanes and painted, ferries simulated everywhere, weather noted for way later)
- [ ] `docs/specs/earth/CONTRACT.md`: what a tile gives life, what life gives the renderer, how a mover takes paint, and the weather as an input held at clear. Drafted by this account, signed by the second, before either builds (LIVING.md, "Who does what")
- [ ] Stage 0's downloads: the Bay Area's inputs listed one by one for the producer's OK, with file, source and size, then archived before Overture deletes the release (LIVING.md, "Stage 0")
- [ ] The real sky, live (the producer, 2026-11-04: "put in blue hour live and make the time of day change with realtime time of day, while also putting in the stars"). Being built on `feat/clock`, cut from `main`, with its brief in `docs/specs/sky/LIVE.md` there: the Sun on the real clock, night in the blue hour's look, stars, planets and the Moon. It changes `skyResolve.ts`, `PixelPipeline.ts`, `main.ts` and `config.ts`, and ports `SkyModel.ts` and the sky's data from this branch byte for byte. So once it's on `main`, `feat/earth` merges `main`

- [ ] Review each stage above as it's handed in, and fly the long real-time checks on a real GPU. Stages 2 and 3 leave these (FREEFLIGHT.md): 500 km low at Jet, a lap at Stratos with memory read, the worker keeping up at Stratos, the flight's low band slide by hand, and night as it looks
- [ ] ~~Start the Moon flight from the ground on Earth~~: the second account has it now, on `feat/moonfree` (the producer, 2026-11-04: "I'm hoping we may be able to get to launch from SF on this account tonight"). Review it instead. It was: start the Moon flight from the ground on Earth, so it can be felt from start to finish. That's the trip's first leg, not the streets job on hold. It touches `src/main.ts` too: expect to merge with the stages above. The producer, 2026-11-03: "I want to fly up high from San Francisco surface and eventually get so so high, extremely high, that an "Easter egg" button appears "to the moon?"". It hands over to VOYAGE's V2 (`docs/specs/moon/VOYAGE.md`)
- [ ] `feat/thumbs` to main, once the producer says the controls can go live. It waits for the bus's lane now (the producer, 2026-11-04: near the bus flies, anywhere else looks, on the street too), which is on `feat/moonfree`: `Input.busZone`, the low game's and the flight's loop's lines that set it, the hint, THUMBS.md's rule, and the gesture sim's lane rows
- [ ] The controls' small things: the opening still says TURBO AFTER THE BRIDGE, six flicks under the gate reach Turbo 3 at the bridge, a rare lost tap, the left look reaches about 37 degrees from mid-zone, the home leg's slow roll, a value saved in the phone's tuner beats a new default

## Waiting on the producer

- [x] Fly Stages 1 to 3 on `feat/moonfree`'s preview. Flown 2026-11-03: what they said is `CLAUDE.md`'s "The Moon trip"
- [x] Pinch to zoom on the trip only, or everywhere. Everywhere, the street included (2026-11-03)
- [x] The bus's lane on the street too, in place of the left 42 % look zone? Yes (2026-11-04): "Yes San Francisco should work the same, replacing the left side look". So `feat/thumbs` waits for it before it goes live: it's built on `feat/moonfree` and reaches `feat/thumbs` from there
- [ ] OK for the two-thumb controls to go live
- [x] Approve the living Earth plan: "Ok. I love this living earth plan" (2026-11-04)
- [ ] A used iPhone 13, bought, for the game's floor (LIVING.md's pick: now, about $210-290). The engineers can't buy anything

## Later, in this order

1. The rest of the sky: moving Sun, long shadows, Moon and stars, looking up (`docs/specs/sky/SKY.md`, S2, S4-S6, S10)
2. Far field days 3-5 (`docs/specs/far-field/SPIKE.md`). Its Overture 2026-10-21.0 downloads have to happen before about 2026-12-20, and the producer OKs each one
3. Bridges steps 3-6 (`docs/specs/bridges/`)
4. The stage engine (`docs/specs/STAGES.md`) and world travel (`docs/specs/WORLD-TRAVEL.md`)
5. A test on an A15 phone, an iPhone 13 or 14

## On hold

Don't start these: streets and highways (but for freeway surfaces, which the cars need: LIVING.md's approved pick), weather and clouds (planned, way later), satellites. Moving things are the living Earth now, approved, and start after `CONTRACT.md`.
