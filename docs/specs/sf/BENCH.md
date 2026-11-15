# The bench link: `?bench`

M1 task 1 (`docs/M1.md`). Built on `feat/sf` by the first account, 2026-11-14. Nothing had been measured on a phone slower than the producer's, and the floor in the rulings is an A15 at 30 fps. The producer borrows such a phone for ten minutes, opens one link, and sends one screenshot. So the page does everything by itself: no tools, no touch, nothing sent anywhere.

## What it flies

| Leg | What happens | Ends |
|---|---|---|
| door | The bare link's door, from the first frame. Scripted taps (pointer events of type touch, low in the middle of the screen, as a thumb's) from 0.3 s, every 2.6 s, until the Golden Gate is crowned | 3 s after the crown (its show counted), or 40 s with no crown (the leg is then marked not run) |
| capture | The canvas to a JPEG three times, inside the frame that drew it (`canvas.toBlob`): what a postcard will cost | 2.6 s |
| ceiling | The bus held at the 15 km ceiling over downtown (the financial district), the lens straight down on it (the page's own `__qa` pin and top-down view). 4 s to settle, not counted | 10 s |
| lift | Page 2, `?bench=lift&lift&lifted&hoodstart`, which page 1 opens itself with its numbers in the address's `#` (never sent). The Lift's stand-in as `?lift` shows it: the block lifts as the bus comes in from the neighbourhood's edge, and the bus glides on under and beside it. Its own page because `?lift` compiles GLSL no other page does | 14 s from the wave |

About 70 s from the tap to the screen on the laptop.

## The screen

For each leg: the median and 95th-percentile frame time (ms), the frames over 33.4 ms and over 50.1 ms, the worst frame, the draws and triangles (median / worst). Frame times are the intervals between rAF timestamps, which are vsync-aligned: at 60 Hz a frame is 16.7, 33.3 or 50 ms, so "over 33.4" is a frame slower than 30 fps. Draws and triangles are the whole frame, every pass (`Perf.frameCalls`, `frameTris`); the door's include the page's first frame, which has no interval to time.

Then: the tap on the link to the first frame and to the bridge's first paint (`performance.now()`, from navigation); whether the door was taken, when the crown came and how many taps; the capture's three frames, the call's own time, the time to the JPEG and its size, and a thumbnail of it; where the lift's bus came to; the screen, the view, the pixel ratio, the game's and the canvas's sizes, and "30 Hz cap?" when frames lock to 33 ms with light work (Low Power Mode); the GPU's name and the browser's user agent; the build (`__SB_BUILD__`, `vite.config.ts`). A leg that didn't run says DID NOT RUN, and the text turns red. A tap copies the same as text. `window.__bench` has it all for a tool.

## What it doesn't change

Without `?bench` nothing runs: `ui/Bench.ts` is loaded only under the flag, and the still views with no flag are identical to the build before it. Under the flag the page keeps its paint under a slug of its own (`<city>~bench`), cleared at each start, so every run meets a grey bridge, no crown and no return start, and the saved city is left as it was.

## What it can't see

- Sound: with no real touch the audio never starts, so its cost isn't in the numbers.
- The GPU's own time: WebGL on iOS has no timer, so a frame's time is what the screen got.
- The phone's heat: one minute is a cold phone. A long session will run slower.
- Auto-Lock: the page asks to keep the screen on (Safari 16.4 and later). On an older iOS a phone set to lock after 30 s would lock in the middle, and the leg it was on says HIDDEN.
