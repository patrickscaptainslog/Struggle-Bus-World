# Shots: what's built

`docs/specs/shots/SHOTS.md` (on `feat/earth`) is the plan the producer approved on 2026-11-06. This file says what of it stands on `feat/shots`, how to fly it, and what's left. The first account's list, step 1.

## Step 1: MEGA off, the faction button, the bigger splat

**MEGA off.** No MEGA button, no charge meter, no charge from any press: the HUD's, Space, or a still finger on the screen. A press held any length is a tap when it lifts, and the HOLD cue never comes. `&mega` on a link wakes all of it as it was, the gesture sim's rows included.
- `Input.megaOn` (`src/game/Input.ts`) gates the charge, and `Controls` sets it, with `Hud.megaOn` and the coach's lesson, from `&mega`.
- `src/game/SuperSplat.ts` stays whole, asleep. Its pouring code, the firehose section (`startFirehose`, `stepHose`, `hoseAim`, `impactNow`, `impact`), with `Splatter.barf`'s `hose` and `bands`, is where the Hose starts from. The mega blast's look is what each faction's Bomb III takes.

**The faction button, on links with `?crew`.** The player's faction crest sits at the top left, 44 px, under the notch. It's clear of the canvas's edge band, and far from the bus's lane. A tap opens all five crests in a row under it, the player's rimmed in bus yellow. A tap on one switches at once, and the faction's name shows for a moment. A tap anywhere else closes the row.
- New paint is the new faction's, and paint already down keeps its owner (a later hit by another faction takes it, as the stores have done since factions step 1).
- `src/game/crew.ts` is the player's faction's one source. `main.ts` sets the street's `Splatter.faction` from it, and with it `?moon`'s craters and open ground, and the breath's particles. The flight (`sky/moonrun.ts`) sets `MoonPaint.faction`. `&paintas` sets its own page's start; a tap on the crest after it is the newer choice, and wins.
- A page on a phone that has seen `?crew` keeps the button there for good, with the last choice (`localStorage` `strugglebus.crew.v1`). Without `?crew` ever seen, nothing changes.
- `crew.locked` is Recess's hook ("In Recess, it works only between matches"). Set, the crest dims, and a tap on it says AFTER THE MATCH.
- The crests are drawn in each faction's own palette rows (`src/ui/crest.ts`): Rainbow's arc, Atlantis's trident over waves, the Elderwood's pine, Hyperglow's bolt, Inferno's flame.

**The bigger splat.** `config.splat.blastRadius` goes from 60 to 85, so a tap from the rooftops paints every building inside 85 m, and from higher up the circle grows as before (twice as wide at 300 m). The building cap now grows with the blast's area: 140 at 85 m (it was 40 at 60 m), up to 240 from high up. Each tap still climbs one level.
- Every blast but a mover's own hit calls `life.blast` with its whole circle, centred on the ground under the impact, so a hit on a tower's roof takes the street at its foot.
- What a circle holds, round 60 random buildings each (median / 90th percentile / most): Alamo Square 57 / 82 / 90 at 85 m, the Sunset 63 / 71 / 75, downtown 30 / 68 / 80. At 60 m the 90th percentile was already 42-43 against a cap of 40. From 300 m up (170 m) the Sunset's 90th percentile is 273 against the 240 cap, so the very highest taps over dense housing still leave a few houses grey.

What it costs, on this laptop's GPU (an Intel UHD 620), in one build, today's numbers against step 1's. Eight blocks round Alamo Square, each tapped three times, the bus held at 160 m:

| | 60 m, 40 a tap | 85 m, step 1 |
|---|---|---|
| Buildings painted | 159 | 242 |
| Draws in the painted view | 108 | 109 |
| Triangles in the painted view | 1.10 M | 1.33 M |
| Of them, the rooftop gardens | 481 K, 24 draws | 712 K, 24 draws |
| The buildings' saved paint | 3.1 KB | 4.8 KB |
| The ground's saved tiles | 8, 43.9 KB | 9, 35.0 KB |

The draws hold. The triangles go up by the gardens alone, and that is where the 1.5 M ceiling is closest: eight blocks at level 3 came to 1.33 M. The gardens' budget (`feat/gardens`) is the answer to that, and this step doesn't touch `src/world/props/sprouts.ts`. On the Moon's paint store (`tools/moon/paint-check.mjs hours`, an hour at Jet) the pictures go from about 9,600 to 14,600, and 14.7 to 18.5 MB of the 64 MB budget.

## Step 2: hold to aim, the hook, the Hose

**Hold to aim** (`968017b`, `src/game/Input.ts`). A finger landing off the lane, where a drag looks, that stays within 12 px for 350 ms aims (`inputTune.aimHoldMs`). Lifted sooner with nobody flying, it's a tap: the ruling's 0.3 s, with 0.3 to 0.35 s counting as one. A finger that moves first still looks. The lane and the flicks are untouched.
- From then until it lifts it's the aim. `Input.state.aim` follows the finger, a drag never moves the view, and the lift is the release (`onAimStart`, `onAimEnd`), never a tap or a flick. A finger lifted past 350 ms before a frame saw it is an aim and its release at once.
- Only one finger aims at a time. Two fingers landing together stay a two-finger tap.
- Nobody steers while it aims, so the bus flies straight. A thumb landing in the lane beside it still flies.
- Off on the Moon and in the flight, which have no Hose (`Input.aimOn`, carried with their hands).
- The first run's hint gets a fourth line, HOLD HIGH UP TO AIM. A save that saw the hint before that line gets the line alone, once (`TAUGHT.aim`).

**The hook** (`6b5ad0e`, `src/game/Hold.ts`, written up in `HOOKS.md`).
- A hold gives the screen point, its ray and where that ray meets the city, how long it has lasted, the drag and the release.
- Handlers can take a hold at its start or partway through, and can take the next taps. A hold nobody takes goes to the Hose.
- `Holds.fire` is the homing shot. It leads a moving target with a turn limit and a speed, and goes white-hot and stops steering in its last `white` seconds. The player's shot spends the belly; a captain's needs none and can whistle.

**The Hose** (`4519a4b`, `src/game/Hose.ts`, built from SuperSplat's firehose, which stays asleep). A hold on the city that nobody takes pours 40 m blasts under the finger, and a drag sweeps them.
- A blast lands each time the stream has moved 0.45 of its radius, or every 0.3 s while it stays put, at most 10 a second.
- Every blast calls `life.blast` as a tap does, tagged kind `'hose'`. One pour raises each building at most one level (`BarfOpts.pour`).
- One belly with the tap: a full tank pours 3 s, draining only while the stream flows. Once the pour ends, it refills in 3 s from empty (`Flight.rechargeSeconds`).
- A hold with under 0.12 of a tank coughs and pours nothing. A pour that runs dry sputters and coughs steam, and that hold pours no more.
- The tank reads on the bus, with no new button. The belly band drains, the bus rises as it lightens, the hiss and drone climb in pitch as it empties, the stream thins over its last 0.35 s, and the refill ends on the belly's ready chime.
- The stream lobs from the mouth onto a point that eases after the finger. The bus slows to 0.72 at Cruise and Express (a gear drives through), rears and shudders.
- It pours in the faction's colours: the breath's palette and the hitter's paint.

**Fixes after looking on the GPU** (`6d685e0`).
- A hold is armed by the first frame that sees a still finger past 350 ms and starts on the next frame, as the MEGA press was. A lift queued behind one slow frame is still a tap. The page's first touch has a 220 ms long task, and there a CDP tap read as a 0.18 s pour.
- The homing shot's blob got bigger: a white core and a longer tail. At 500 m it had been a dotted thread.

**The checks** (on `6d685e0`).
- `tsc` clean at each commit. `vite build` exit 0, and `iosfloor` says "iOS 15.0 parses every chunk".
- Gesture sim 826 of 826 (332 rows), layout sim 300 of 300, hold sim (`tools/controls-sim/s_hold.ts`) 31 of 31.
- `owner-check`: its first run failed one row, the Moon's pictures by the journal, which this step doesn't touch. The rerun passed every row.

The flight on this laptop's GPU (Intel UHD 620): real CDP touches on the real page, Western Addition from the rooftops, Inferno and Rainbow, each a fresh page. Its frames and numbers are kept on the laptop, outside the repo.
- The hint showed its four lines.
- A still hold off the lane poured a lobbed stream in the faction's colours, onto the point under the finger. The tank ran dry at 3.03 s and 3.00 s, with 11 impacts each.
- The pour raised 28 (Inferno) and 35 (Rainbow) buildings, none of them more than one level.
- Programs stayed at 35 before and after. Draws peaked at 142 and triangles at 0.98 M, while it poured and after. Median frame was 26-32 ms, and median work 5-8 ms with the pour or without.
- A homing shot at a point 420 m ahead, crossing at 20 m/s, went white at 0.90 s and 0.92 s, and hit at 1.56 s and 1.57 s.
- A tap off the lane after all that splatted, with no pour.
- Two 404s turned up in the console on both pages. I didn't find which files they were.

## How to fly it

The branch's preview: `https://struggle-bus-world-git-feat-shots-patricks-projects-9ff6e721.vercel.app/`
- `?crew`: the faction button. Tap the crest, pick a faction, splat. Then drop `?crew` from the link: the button stays. `?crew=off` takes it away on that phone, and the bus paints as Rainbow again.
- `?crew&life`: the same with the living city. One tap on a park or a busy street paints the people and cars inside the circle. A tap on one car or a ferry paints the block round it too.
- `?mega`: MEGA as it was, to compare.
- Step 2, the Hose: hold a finger still on the city, high over the bus and away from it, for a third of a second. It pours where you hold, and a drag sweeps it. Watch the bus's belly band drain and listen to the hiss climb. A quick tap there still splats. With `?crew`, try it in each faction's colours.

## What's left of step 1

- `life.blast` (the second account's, in `src/life/`) tests a sphere in 3D, so we pass it the ground under the impact, or the deck when the shot landed on a bridge's: boats and cars in the circle are inside it, and planes overhead aren't. A flat circle on the map, from the ground to the roofs, would say what's meant better, and it needs a rule for a deck: a tap into the water under the Golden Gate shouldn't paint the cars on top.
- `feat/shots` goes to `main` after `feat/gardens` (decision 20, the gardens' budget first): see the review below.
- Movers take a hue and a level but no faction (CONTRACT.md: faction 1). Another faction's tap paints them in Rainbow's colours until life takes the hitter's faction.
- The Lift lifts only Rainbow on Rainbow, as FACTIONS.md's first slice built it.
- Nothing here was measured on an A15, or on the producer's phone.

## What's left of step 2

- **A resting thumb off the lane now pours.** That's the ruling ("held still for 0.35 s, it aims"), but a thumb resting high on the screen used to do nothing, and now it empties the tank. A phone will say whether that bites.
- **Taps in the lane stay at 450 ms.** The ruling's 0.3 s tap applies off the lane, where a hold aims. In the lane, a still thumb past 450 ms steers at neutral, as before (the lane is untouched). Beside a flying thumb, a second thumb's tap is still 230 ms.
- **No hold to aim on a desktop.** The mouse flies, and its right button looks.
- **A dry tank ends the hold.** A pour that runs dry stops for that hold, even if the tank refills while the finger stays down. Lift and hold again.
- **The Hose is new code, built from the firehose, not an extraction of it.** `SuperSplat.ts` stays whole and asleep, so the two share ideas, not a module.
- **The homing shot spends a breath.** The player's shot stalls the bus for the breath's second, as a tap does, but it has no jet: the blob is the jet.
- **Not built yet:** the flick's lunge in the white, the Bomb on a hold on the bus, and the HOLD TO LOCK hint. See `HOOKS.md`, "Not here yet".
- **The hook for the second account.** `docs/TODO.md` (on `feat/earth`) should say that the hook is on `feat/shots`, in `HOOKS.md`. This run didn't write it there.
- **Not measured** on an A15 or on the producer's phone. Not flown over Recess or `?life` on the GPU.

## The review of step 1, and what it came to

The other run's review of `e0f1dde..3fbffc6` found no blocker, four majors, four minors and four nits. Each was read against the code first.

| | Finding | Holds? | What was done |
|---|---|---|---|
| 1 | The Moon's "tiles" row breaks at 85 m | No, not from the radius | Nothing changed (below) |
| 2 | A big blast's sparkles overrun the particles' 8,000 | Yes | `3a809d1`: a blast's buildings share one budget |
| 3 | The bigger splat lands before the gardens' budget (decision 20) | Yes, as an order | `feat/shots` goes to `main` after `feat/gardens` (below) |
| 4 | A tap at a car paints only that car | Yes | `f29c01f`: it paints the block round it |
| 5 | Once seen, `?crew` can't be turned off | Yes | `45ce62f`: `?crew=off` |
| 6 | The top left is a regrip for a right thumb | Yes | Not changed: it's where the approved plan puts it, a testers' button tapped now and then; the producer's call |
| 7 | `life.blast`'s centre ignores bridge decks | Yes | `f29c01f`: centred on the deck when the shot landed on one |
| 8 | Under `&mega`, MEGA is 42 % wider | Yes | Not changed: only `&mega` sees it, and the Hose sets its own radius when it's built |
| 9 | The open swatches sit in the toast's slot on 568 x 320 and iPads | Yes | Not changed: the row is open a moment, and a pick closes it as its toast comes |
| 10 | On a 320-wide screen the readout overlaps settings' touch area | Yes | Not changed: the readout takes no touches |
| 11 | A crest tap overrides `&paintas` | Yes | Not changed: the tap is the newer choice; this file's words now say so |
| 12 | warmcheck's crew spots are 155 m apart | Yes | `75475dd`: about 400 m apart |

**1, the tiles row.** The row times `GeoPaint.work` while a reloaded region's 16 tiles copy their paint out, and the copy is cut into rows with the clock read each row. Its data barely moves with the radius: 72 pictures at 60 m, 73 at 85 m. Its slowest frames are one copy row each, and Node's collector ran in none of them (`perf_hooks` gc entries). Across this run's three A/B sets, frames past 4.5 ms came 3 times in 22 runs at 85 m and 5 in 22 at 60 m, the worst at 60 m (33 ms). So it's the machine (another run's browser beside it), not the splat. It stays a single worst frame, as written.

**2, the sparkles.** `main.ts`'s bloom handler gives each building `14 + 8 x level` up to a 48-building blast, and fewer each past it, at least 5. A tap's sparkles in all, on the real city in Node (`p_fix.ts`), old against new: the Sunset from 300 m, 232 buildings, 5,104 / 6,960 / 8,816 against 1,160 / 1,392 / 1,856 at levels 1 / 2 / 3; at roof height, 79 buildings, 1,738-3,002 against 1,027-1,817. Two taps back to back come to at most 3,304. Blasts of 48 buildings or fewer are as they were.

**4 and 7, a mover's tap.** A tap at a mover on a floor, within `config.splat.moverFloor` (40 m) of the ground, the water, a bridge's deck or a roof under it (`Splatter.moverOnFloor`), is a tap's whole blast centred on it: the buildings and ground round it bloom, and `life.blast` paints it with every mover in the circle at the blast's hue. On a boat in open water it's never a miss: its circle paints the boats in it, and no water and no sign (`Blast.afloat`). A plane, higher, is still life's own hit alone. `life.blast`'s centre is the deck when the shot landed on one (an impact at or over a deck's underside, `City.overheadAt`), so a tap on the Golden Gate takes the deck's cars end to end. In Node: a mover's tap on Market at Van Ness bloomed 10 buildings, a plain tap there 14; off the Marina, no miss and `afloat`, where a plain tap misses; a car on Market and on the Golden Gate's deck (77 m) are on a floor, a plane 300 m up isn't; a tap on the deck is centred at 77.0 m, one into the water under it at 0.0, one on downtown's tallest roof (334 m) on the ground.

**3, the gardens' budget.** Nothing in `src/world/props/sprouts.ts` changes here: `feat/gardens` (ae95923) is that budget, and it merges into this branch cleanly. The flight that found it (Cruise over the Western Addition, twenty real taps, the median frame after them), on this laptop's GPU:

| | Triangles after | Most in flight | Draws after | Frame after |
|---|---|---|---|---|
| This branch, the fixes in | 1.73 M | 1.77 M | 152 | 50.4 ms |
| The same with `feat/gardens` merged in | 0.97 M | 1.04 M | 140 | 35.3 ms |

So this branch alone is over the 1.5 M ceiling at Cruise over painted blocks, and with the gardens' budget it's well under. It goes to `main` after `feat/gardens`, or with it, never before.

**The checks after the fixes** (on `75475dd`): `tsc` clean, `vite build` exit 0, `iosfloor` "iOS 15.0 parses every chunk". The gesture sim 752 of 752, the layout sim 295 of 295, owner-check all passed. The `--det` views, both skies, against step 1's build (3fbffc6): all eight identical. `warmcheck` on `?crew`, and on `?crew --crew` through all five: 35 programs, none after the warm-up; each faction's spot owned by that faction alone, at level 3. The one long task is still the page's first touch (220 ms at the first crest tap). The stills (from the street and from 250 m) paint the same buildings as step 1's, 44 and 170. The Moon's `paint-check` runs only timing rows that fail with another run's browser beside it; none of its code changed here.
