# Brief: from the second account to the first (2026-11-04)

The producer asked for this: what the second account built while the first was out of its weekly limit, what the first should do, what isn't live, what the two of us need to agree on, and the next big job, which is the first account's to plan. Read it with `docs/TODO.md` and `CLAUDE.md`'s rulings, which are up to date.

## What was built, and where

Nothing below is on `main`. Every branch stacks on the one before:

`main` ← `feat/thumbs` (the two-thumb controls, reviewed by you) ← `feat/moonfree` (cut from `spike/moonrun`, `feat/thumbs` merged in) ← `feat/earth`

- **`feat/moonfree`** (2026-11-02 to 04): the whole Moon flown freely. Stages 1 to 3 of `docs/specs/moon/FREEFLIGHT.md` (flicks on the Moon, the map that slides under the bus, the whole Moon with poles, far side and night); VOYAGE.md's V1 (no paint from high orbit, the pan that stays, a live trail, a bigger Sun and a Moon that grows), V2 (one moon boost under 6 minutes, the TO THE MOON? and TO PLANET EARTH? buttons, WELCOME TO THE MOON) and V2c (the street's gears at the Moon, a tap from orbit paints one crater); the bus's lane on the trip and on the street (`Input.busZone`); a launch from the street with a fade, since replaced. Each has its `DECISIONS.md` entry.
- **`feat/earth`**, 21 commits on `feat/moonfree`: the whole Earth flown freely, `docs/specs/earth/EARTHFLIGHT.md`. E1, free flight over a plain temporary Earth at any height; E2, one page from the street up, `?earth`, the street handing the bus to the flight at 15 km and taking it back at 14 km, with no cut; E3, Earth's page and the Moon's changing over in the long dark, by a second session of this account. Then, on the producer's flights of it today: no flick up to climb anywhere; TO THE MOON? flown up to, at 2,000 km over Earth; the street's ladder as it is past 15 km (Turbo 1 to 3 over Jet, then Stratos and Rainbow Warp) with the street's speed lines and trail; and leaving the Moon the same way (a pull out of the orbit, TO PLANET EARTH? at 2,000 km over the Moon, the street's ladder on the Moon's ground). Each has its `DECISIONS.md` entry, newest last before "Logistics".
- `feat/earthfree` and `feat/earthfree-e3` are older names for `feat/earth`'s first commits: `feat/earthfree`'s preview link was 64 characters before `.vercel.app`, one over the limit, so it never existed (`CLAUDE.md`, Hand-in). Nothing new goes on them. They can be deleted, with the producer's OK.

Previews (a Vercel sign-in, which the producer's phone has): `https://struggle-bus-world-git-feat-earth-patricks-projects-9ff6e721.vercel.app/?earth&fps` from the street; `?moonland&fps` from Earth orbit.

## What isn't live

All of the above: `main` is what it was. `feat/thumbs` still waits for the producer's OK to go live, and it's built on now by both branches above. None of `feat/moonfree` or `feat/earth` has had your review. Nothing has been measured on a phone or on a real GPU: every check was on a cloud machine with software graphics, at a fixed step (`DECISIONS.md` says which, entry by entry).

## What we suggest you do

1. **Review**, before anything merges (`CLAUDE.md`, Review). `feat/moonfree` first, then `git diff origin/feat/moonfree feat/earth`. Where to look hardest:
   - `src/main.ts`: everything the flight does on the street's page is under `earthFly` (`?earth`), and with no flag the plain page must not change. `tools/sky/flag-off.mjs` checks that, and passed. The join itself is `src/sky/EarthLanding.ts` and `src/sky/earthJoin.ts`.
   - What touches the street's own code: `src/game/Turbo.ts` (`arrive(gear, level)`, `quietTop`), `src/ui/Hud.ts` (an optional rung `name`), `src/render/PixelPipeline.ts` and `skyResolve.ts` (the space branch, compiled in only under the flag, and the sky cut).
   - `src/sky/MoonTrip.ts`'s ladder (`level`, `earthStep`, `shiftEarth`), shared now by Earth's free leg and the Moon's.
   - `src/sky/tripSave.ts`: the trip saved whole by its own keys for the change of page.
2. **On a real GPU** (a laptop): the long real-time checks the cloud can't do. FREEFLIGHT.md's list (500 km low at Jet, a lap at Stratos with memory read, the worker at Stratos, the low band's slide, night), and new ones: `?earth` with two loops on one page (`tools/warmcheck.mjs`: nothing may compile in flight, and the flight's programs compile behind a flying street), memory with both loaded, the frame time of the plain Earth's breakup low down (`spaceEarth`, the whole lower screen), and the hand-over at 15 km at real speed.
3. Then the controls' small things in `docs/TODO.md`, and the CC BY-SA files (`public/sky/lines.bin`, `tools/sky/line-stars.json`), which mustn't reach `main` unreviewed.

## What we need to agree on

- **One branch for new work: `feat/earth`.** Two accounts on one branch need a rule: whoever starts a stage says so in `docs/TODO.md` in its first commit, and pulls before pushing.
- **`main.ts` is the hot spot.** The street's boot, the flight's boot behind it, and the hand-overs all meet there. Whoever changes it next, say so in TODO.md first.
- **The ladder is one ladder now,** past 15 km over Earth and over the Moon, and on the Moon's ground (`CLAUDE.md`, Controls). A change to the street's gears is a change to all three.
- **Known gaps,** for whoever's next: no sound past 15 km over Earth; MEGA goes at the hand-over; the flight's lines and trail are near the street's, not the same; a dive from orbit comes down where the bus is pointing, with nothing to show where the city is; E4 (in and out of a city low down, across its map's edge) waits for the producer to fly E2; V3, pinch to zoom, not started.
- **On hold, lifted in part:** the producer wants moving things now (below). `CLAUDE.md`'s "On hold" says so; streets and highways, weather and clouds, and satellites are still on hold.

## The next big job: a living Earth, the first account's to plan

The producer, 2026-11-04: "I want to start populating the earth map with real terrain/buildings, how best to do this and how best to do this splitting between these two accounts to save time. Or do we need to rent a virtual machine? How do we go about this strategically as world class game designers to ensure our players have the most beautiful, interesting, thoughtful experience playing this game. I don't want to cut corners. For instance I want to add: people, cars ferries planes (real live real time planes) and like cruise ships and sailboats in popular bays and harbor. I want to bring life into this game. Should we build all of this together or split it up some way?"

They asked the second account not to spend long on it and to hand it to you. So: a plan from you, the producer's to approve, before anything's built. What's already in the repo to start from: `docs/specs/WORLD-TRAVEL.md`, `docs/specs/far-field/` (`VERDICT.md` first, and `research-earth.md`), `docs/specs/STAGES.md`, `docs/specs/COMMON.md` (the creative brief: palette ramps, no brown, paint the only saturated thing), and EARTHFLIGHT.md's "Left for later".

Questions the plan has to answer, as the second account sees them (a start, not an answer):

- **The design first.** Painting is the whole point (`CLAUDE.md`): what does life do with paint? A painted ferry, a bay of sailboats as a canvas, a plane's contrail? And how life looks in 3D pixel art in the palette, on an A15's budget (120-200 draws, 1.0-1.5 M triangles: instancing, impostors).
- **Data.** Terrain heights, land cover and coastlines, and buildings, for the whole Earth and in detail near cities. Each download is the producer's to OK, named with its source and size (`CLAUDE.md`, Downloads). Overture's 2026-10-21.0 has to be downloaded before about 2026-12-20 (TODO.md, Later).
- **"No server."** Live planes (ADS-B) and live ships (AIS) come from services that want a key, and the repo is public with no secrets in it, so a live feed means some small server or proxy (a serverless function, say). That's a change to "no server", and the producer's to rule on. Ferries can come from published timetables (GTFS), and cars, people and sailboats can be simulated.
- **A machine.** The cloud machines have no GPU, about 2 hours a job and a small disk. Baking terrain and buildings at scale wants a machine with a big disk and many cores, rented or the producer's own; frame times and the look want a real GPU. What it costs and what it buys is for the plan to say.
- **The split between the accounts.** One way it could go: one owns the world's data (terrain, buildings, the bake and the tiles they stream from, and E4's city edges), the other owns life (things that move, simulated and live, how they're drawn and how they meet paint), with the tile format and the life API as the line between them, agreed first. Or one place, the Bay Area, end to end first, both accounts on it, and then everywhere.

When the plan's done, put it in `docs/specs/` and the producer's picks in `CLAUDE.md`, as EARTHFLIGHT.md was done.
