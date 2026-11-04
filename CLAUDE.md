# Struggle Bus World

A yellow school bus flies over the real world and paints it. three.js, WebGL2, Vite and TypeScript, 3D pixel art, iPhone Safari first, no server. Live at https://struggle-bus-world.vercel.app/.

**Start at [docs/TODO.md](docs/TODO.md).** It says what's next and who has it.

Two Claude accounts work here as engineers. Neither can see the other's chats or notes, so whatever the other needs goes in this repo, in a commit. One person, the producer, decides what the game is. They fly every change on an iPhone 17 Pro, usually reply from that phone, and go by they/them.

This repo is public. No secrets, private notes or personal details in code, docs or commit messages.

## The producer's rulings

These beat every older doc. `README.md`, `HANDOFF.md` and `DECISIONS.md` are history where they disagree: the README still has tilt and the TURBO button. When the producer rules on something new, put it here in the same commit.

**The game**
- Painting is the whole point, on the Moon too: "i need to be able to paint the moon. thats the whole point of the game." Never treat a place as something only to look at.
- Paint is the only saturated thing in the world, and there's no brown. Palette ramps only, in an indexed-colour G-buffer (`docs/specs/COMMON.md`).
- It has to scale to the whole world. Data-driven looks any city gets from OpenStreetMap or Overture, no new hand-made San Francisco one-offs. Each city is its own flat map: the round Earth is unbuilt.
- The Moon is real in its big shapes and named places, and invented below that. Crewed landing sites stay grey circles that can't be painted.

**Flight**
- Speed and climb never grow with height. Going faster is the gears' job. The one exception is the brake on arrival at the Moon.
- The way up is a plain climb of 40 m/s or a gear, with speed following the nose up to 85 degrees either way (`docs/specs/flight/NOSE.md`, `ASCENT.md`).
- The whole Moon is flown freely, low or high, with no edge and nothing that turns the bus back: "I want to be able to fly around the moon freely, the whole way" (`docs/specs/moon/FREEFLIGHT.md`).

**Controls** (on `feat/thumbs`, `docs/specs/flight/THUMBS.md`, not live yet)
- No new button, joystick or gear strip. It must be intuitive to pick up and fly, and playable with one thumb. Gestures stay hidden, with one brief hint on the first run. The one exception is the trip's easter egg (below).
- Only a touch landing near the bus flies it, in a lane round the bus down to the bottom of the screen, and one landing anywhere else looks, on the street as on the way to the Moon (`Input.busZone`): "Yes San Francisco should work the same, replacing the left side look" (2026-11-04). It replaced the left 42 %. A quick flick up or down is one gear, anywhere. No double flicks, no left or right swipes, no tilt. The TURBO button is gone. MEGA stays.
- One ladder: Cruise, Express, Nonstop, Jet, Turbo 1, 2 and 3. To the producer, "turbo" is what Jet feels like. On the Moon it goes on from Jet to Stratos and Rainbow Warp (`docs/specs/moon/FREEFLIGHT.md`).
- A branch has all this only once `feat/thumbs` is merged into it. Merging it there doesn't put it live: that's main, and the producer's word.

**Camera**
- Pinch to zoom, everywhere, the street included, where it was rejected before: "ive thought about it an i want the pinch to zoom function - i think because this game is mostly played on one hand, it can work", and asked where: "Pinch to zoom everywhere" (2026-11-03). The normal chase camera and the full-size bus are where a zoom starts from.
- On the way to the Moon and back the view goes where it's panned and stays there, and one swipe looks behind: "just forget auto re-alignment. where the user pans - it goes. also on my iphone the panning is just not good, it takes too many swipes to get to look behind me."
- The bus's lane came from the producer, for the way to the Moon first: "what if we reserve the control the struggle bus movement space on the screen to the area directly near the struggle bus itself, and then touching anywhere but that area pans the camera?" (Controls, above, has where it holds.)

**The Moon trip** (2026-11-03, after flying Stages 1 to 3; `docs/specs/moon/VOYAGE.md` is the plan)
- No FLICK UP FOR THE MOON: "i dont like flick up for the moon function". Extremely high over Earth an easter-egg button comes up, TO THE MOON?, and goes if the bus comes back down: "once a player reaches a certain height away from the surface of the earth, a preferably very very tall height, extremely so". Leaving the Moon is the same: very high up, TO PLANET EARTH?.
- The trip starts from the street: "I want to fly up high from San Francisco surface and eventually get so so high, extremely high, that an "Easter egg" button appears "to the moon?"". And with no cut on the way: "I don't want the screen to "skip jump" into outer space, I just want to free fly straight and then when I'm high enough I want the "to the moon" button to appear" (2026-11-04, after flying the launch's fade to black).
- No flick up to climb over Earth: TO THE MOON? is flown up to. "I do not like the flick up to climb function. I just want to be able to freely fly, and then once I get to a certain very high orbital altitude the "to the moon?" Button appears" (2026-11-04, after flying `?earth`). It comes up at 2,000 km, a minute's full pull from orbit, where it was 13,000 and seven: "I think we can do 2000km".
- The whole Earth is flown freely, low, high or in orbit, on a rudimentary temporary Earth that gets its detail later: "Put in very rudimentary temporary rendering of earth for now, to fill in later with more detail. The thing is: I really really want to be able to fly around freely earth, low, or high or satellite high in orbit, and if I go high enough the "to the moon?" Button will appear" (2026-11-04). This is the start of the round Earth that "The game" says is unbuilt.
- One moon boost, there or back in a bit under 6 minutes: "i want there to be one default moon boost turbo mode that brings you to and from the moon in a bit less than 6 min."
- No paint from high orbit: "i want to completely remove the paint splat from high orbit option when you first get to the moon. i just splatted .04 percent of the moon in one shot. this is terrible."
- At the Moon the bus is the player's again much higher up than now, with a WELCOME TO THE MOON that says so, and from orbit down it flies and paints exactly as over San Francisco, the gears and their flicks included: "once in orbit, i want exact functionality of our san francisco movement and paint splat mechanics".
- The Sun and the Moon are drawn bigger, and the Moon grows as the bus comes to it: "why is the moon/sun so smally depicted in this game?" Earth stays as it is: "the earth does however look great - and the earth does slowly shrink in size, well done."
- The trail on the way is alive and a little random, never still: "it is too static, like its frozen and im afraid players will think their game stalled."
- On the way the bus carves and turns about its set path as it does over the street, with the right thumb, and the left pans: "On the journey to the moon, even though the path is set and straight, I want to have the players be able to carve and turn and… move through the sky. Similar to how they normally do, this might be relaxing and give more of a sense of control - like they're actually flying".

**On hold.** Start none of these until the producer says so: streets and highways, moving things (cars, ships, trains, planes, live plane data), weather and clouds, satellites.

**Numbers**
- 393 x 852 game pixels at 3x. The floor is an A15 at 30 fps, and Safari 15 has to parse the build. 120-200 draws, 1.0-1.5 M triangles. Nothing compiles in flight.
- Nothing has been measured on an A15. On the producer's iPhone 17 Pro a failure is loud and a pass proves little.

## How we work

- **Branches.** Work only on the branch `docs/TODO.md` names. Never push or merge to `main`: main is the live site.
- **A cloud clone** may hold only `main`, and be shallow: `git fetch --unshallow origin` brings the whole history and every branch. One that isn't shallow takes `git fetch origin feat/moonfree feat/thumbs spike/moonrun`.
- **Hand-in.** A stage ends with a push and a pull request. Vercel builds a preview of every pushed branch, and that link is how the producer flies it: `https://struggle-bus-world-git-<branch with / as ->-patricks-projects-9ff6e721.vercel.app/?moonland&fps`. The part before `.vercel.app` can be at most 63 characters, or the link doesn't exist (`feat/earthfree` came to 64): name a branch short enough, or Vercel shortens it its own way. It needs a Vercel sign-in, which the producer's phone has and you don't: `gh api repos/patrickscaptainslog/Struggle-Bus-World/commits/<sha>/status` says whether it built. A session allowed `gh` for search alone can't ask that, and can't see a commit's status without a pull request: run `npm run build`, which is what Vercel runs, and say the status wasn't read. Give them the whole link, and say what to try. On a cloud machine `gh pr` won't work: use the session's Create PR, or `gh api` on the repo's `pulls`.
- **Review.** Every branch gets a code review from the other account before it merges. Code written after a review gets its own review. Rerun the checks on the final build.
- **Honest tests.** Report only checks you ran, with what they printed, and say what you couldn't check. Fixed poses miss whole structures, so fly along a long thing end to end before calling it fine. A fix stays on what it was asked to fix.
- **The producer's phone beats any judge.** Run an outside look at the frames only where a player would see the change, and only once.
- **Downloads.** Ask the producer first, naming the file, its source and its size.
- **Licences.** `public/sky/lines.bin` and `tools/sky/line-stars.json` are CC BY-SA and mustn't reach main unreviewed.
- **Talking to the producer.** Plain words, short, one question at a time, with what you'd pick. They read on a phone and shouldn't need to know the code.
- **Writing code.** Match what's around it: its comment density, its naming, its idiom.

## Spending

Tokens are a budget, and the producer never wants to go past a weekly limit into paid extra usage. If you get near one, stop and say so.

- The model is chosen by analysis, job by job. The producer lifted the old "No Haiku" (2026-11-04: "Can you please do a proper analysis and disregard what I said about haiku 5.5 earlier"). For the whole-Earth job the pick is Opus 5.5 at high, xhigh for its hardest stage (`docs/specs/earth/EARTHFLIGHT.md`, "Which model"). Time is what's short.
- Opus never waits on a run: start it in the background and go on. No command with a lot of context behind it should wait past about 4 minutes: the prompt cache lapses after 5, and reloading a whole context cost us about 14 % of all spend.
- On a cloud machine, frame-stepped tools at 1x (`__qa.holdFrames`, `tools/moon/flicks.mjs`). At 3x a row of `controls.mjs` takes minutes, and tools that time their legs by the wall clock (`stranger`, `edges`, `warmcheck`) can't finish there: they're for a laptop. A background job, a server too, dies at 2 hours.
- No big fan-outs of agents.

## Running it

```bash
npm ci
npx tsc -p tsconfig.main.json --noEmit             # types, main.ts included
npx vite build --outDir ../sb-build
node tools/sky/serve-dist.mjs ../sb-build 4179     # leave it running: the Moon tools read http://localhost:4179/ (BASE overrides it)
node tools/iosfloor.mjs ../sb-build                # Safari 15 parses it
node tools/moon/smoke.mjs shots/tmp/smoke          # ?moon and ?moonrun stand up
```

Keep frames and logs in `shots/tmp/`, which git ignores.

Pages: `?moonland&fps` is the whole trip, Earth orbit to the Moon, land, skim, paint, home. `?moon&site=TYCHO&fps` starts low anywhere, `?moon&lat=&lon=` too. `&t=2026-11-25T04:00:00Z` sets the date, and so the Sun: that one is full Moon. `window.__game` and `window.__qa` are the low game, `window.__space` the flight.

| Tool | What it does |
|---|---|
| `tools/moon/fly.mjs <out>` | The real bus at a fixed step, frames taken with the loop frozen. The cloud's best friend |
| `tools/moon/land.mjs <out>` | The way down with a real thumb |
| `tools/moon/hand.mjs <out>` | One browser held open, flown a step at a time |
| `tools/moon/stranger.mjs <out>` | A whole flight, as a stranger flies it |
| `tools/moon/edges.mjs <out>` | The corners of `?moonland` |
| `tools/moon/flicks.mjs <out>` | Flicks in space, a frame at a time: launch, G5, the long dark, the look, a slow flick in orbit. `tools/flick.mjs` gives any tool a real flick |
| `tools/moon/slide.mjs <out>` | The map's slide at a fixed step: joins forced both ways, paint, gardens and a breath in the air kept, then a join the game makes by itself. `slide-diff.py <out>` says how much each join changed the picture, `pops.py <out>/nat` what popped |
| `tools/moon/run.mjs <file>.ts` | The generator under Node: `look.ts`, `farcost.ts`, `nans.ts` (`nans.ts 85 30 4` slides the map over the pole) |
| `tools/sky/route-check.mjs`, `trip-fuzz.mjs` | The flight's maths under Node, no browser |
| `tools/warmcheck.mjs` | Nothing compiles in flight |
| `tools/controls.mjs`, `tools/controls-sim/` | The controls. What tests the two thumbs comes with `feat/thumbs` |

**On a cloud machine** there's no GPU. Software graphics run about 1.5 frames a second, so the game runs about 14 times slower than real time and frame times mean nothing. Tools wait on the game clock, so they still work, and `tools/browser.mjs` finds the machine's Chrome by itself. Short runs at a fixed step are fine. Say in the hand-in which long real-time flights you left for a laptop or the phone.

## Where things are

`docs/ARCHITECTURE.md` is how it works, `docs/specs/COMMON.md` the creative brief, `DECISIONS.md` every call with numbers (long: search it). The Moon is `src/moon/`, the voyage `src/sky/`, and the specs are `docs/specs/moon/GROUND.md`, `PAINT.md` and `LAND.md`.
