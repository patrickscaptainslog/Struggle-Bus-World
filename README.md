# Struggle Bus

A wheezing yellow school bus flies over real San Francisco and barfs rainbows.
Wherever it splats, grey Victorians bloom into Painted Ladies.

Phase 1: single player, no server. iPhone Safari first (portrait, one thumb).

## Play
- **Your thumb flies.** Drag anywhere: the bus follows a springy bungee from where
  you touched. Sideways to carve, drag down to climb (harder = faster, the bus
  trades speed for height) up toward a soft ceiling high above the city (~520 m),
  where it wheezes and struggles; drag up to nose down: dive back to the rooftops,
  gaining speed; at the rooftops it surges (about 250 mph). Let go and the bus holds
  its altitude with a wheezy bob, skimming the rooftops automatically.
- **Tap anywhere to splat.** A tap (or a second finger while steering) is dragon
  breath; a still press up to 0.45 s still splats, past that it is a thumb at rest.
- **Tilt, if you want it.** After the bridge a chip asks TILT TO STEER? (on
  iPhone, allow motion access), and the small phone icon in the top left corner
  turns it on and off any time. With tilt on the phone flies: left / right to carve,
  top edge toward you to climb, away to dive. **A thumb always wins:** drag and the
  phone stops steering; lift and it takes back over, keeping your carve if that was
  a nudge, or taking the new angle as level if you held the thumb a while or the
  phone moved. Rest a still thumb anywhere to fly dead straight. The recenter button
  (top right) takes your current pose as level.
- **TURBO** (upper left): tap = next gear, hold = boost. The ▼ tab under it shifts
  down. **MEGA** (right side): tap = splat, hold = charge; slide off it and the same
  finger steers (a charge keeps charging). **BUTTONS: SWAP** in settings mirrors them
  for the left hand.
- **Turbo gears.** G1 "Jet" (~1,000 mph): shifted up low, the bus claws its
  way up to ~150 m first, straining and rattling, then the gear bites and it
  breaks the sound barrier with a boom, a vapor cone and a rainbow contrail.
  Steering gets wider with speed. Shift down to brake back to cruising and
  hold your altitude. G2 "Stratos" and G3 "Rainbow Warp" (San Francisco to
  Tokyo in about five minutes) are locked until the world beyond the city
  exists ("LOCKED: WORLD TRAVEL COMING").
- Up high the camera pulls back into a vista (it holds perfectly still while
  you hold your altitude): the skyline, Twin Peaks, Sutro Tower and the
  bridges, the hills on the horizon. Over the Golden Gate the bus can't climb
  until it has passed under the deck.
- **The breath**: the bus rears back and blasts a rainbow jet forward; it
  explodes on the building ahead (when the belly is full, that building
  glints, and the glinting one is the one you hit): a flash, a rainbow
  shockwave, and every building within ~60 m blooms, the street and the trees
  around them splattered too. From altitude it lands where you're looking,
  mid-screen, and the blast is bigger the higher you fire from. The belly
  glows fuller as the next blast recharges.
- **Hold** (MEGA, Space on a keyboard): the super splat charges. The bus swells,
  shudders and glows white-hot, six rainbow ribs of energy twist down a funnel
  into its mouth, arcs crackle, a rainbow circle spins around its wheels, a
  heartbeat races, and a meter fills above MEGA (it only shows while charging or
  cooling down, when it docks on the button). Let go early for a MEGA blast (at least 1.6x a
  tap's radius, up to 2.6x the longer you held; under 30 % it is just a normal
  splat). Hold the full 10 seconds
  and the FIREHOSE lets go: a colossal rainbow torrent for 4 seconds that
  paints everything it touches; steer while it pours to sweep it across the
  city (from up high it pours down where you look; in a turbo gear it lays a
  stripe across the whole city). Slide off, or swipe, and it fizzles out at no
  cost. Then it needs a minute to recharge: the meter counts the seconds down
  and chimes when it's ready (a press still splats meanwhile).
- Keyboard (desktop): arrows / WASD fly the same yoke (Down/S climbs, Up/W
  dives or surges), mouse drag is the bungee, Space breathes (hold to
  charge), E / Q shift turbo gears, Shift boosts, Esc opens the settings.
- Blast an already-painted block to escalate it: rooftop gardens, then full
  Hundertwasser.
- Paint and your control settings are saved on your phone.
- Three-finger tap (or `?tune`) opens the hidden tuning panel; `?fps` shows the
  frame-rate meter; `?controls=tilt|touch|keyboard` (tilt shows the chip at once, touch turns tilt off), `?nocoach` drops the first-run cues,
  `?nohud` hides the HUD.

## Develop
```
npm install
npm run dev          # http://localhost:5173
npm run build        # dist/
```
Tilt needs HTTPS (the Vercel deploy) or localhost: over http on the LAN, phones
fall back to touch.

Dev pages: `dev/city.html` (real city viewer), `dev/flight.html` (autopilot
flight test), and one page per module (`dev/bus.html`, `dev/fx.html`, ...).
Screenshots: `node tools/shot.mjs <url> out.png`, `node tools/shots.mjs`,
`node tools/blast.mjs <url> <outDir> [perf] [seq] [top] [reload] [escalate] [tap] [drop] [layouts]`
(blast QA at the Painted Ladies: frame sequence, top-down view, persistence, perf).
Feel QA: `node tools/feel-sim/run.mjs s_aim.ts` (and the other scenarios in
its header) runs the real flight / aim / splat code offline on the baked city;
`node tools/feel.mjs <baseUrl> shots/feel [strip] [glint] [taps]` shoots the
tap -> jet -> impact -> hit-stop strip and checks real taps in the browser.
Controls QA: `node tools/controls-sim/run.mjs s_hybrid.ts` (and s_tilt, s_tune, s_perm,
s_gesture, s_layout, s_turbo; see its header) runs the arbitration, tilt, gestures, the
layout and turbo offline against the real modules; `node tools/controls.mjs <baseUrl>
shots/controls [touch] [turbo] [tilt] [gestures] [hybrid] [firstrun] [layout] [states]
[flows] [opening] [perf=<otherBaseUrl>]` checks them in the browser with real CDP touches
and a mocked iOS sensor flow (`hybrid`: thumb against tilt; `firstrun`: a first visit,
no `&nohud`; `layout`: real rects against `layoutHud`; `states`: every button, cropped,
`tools/hud-sheet.py` makes a sheet). Capture tools pass `&nohud`.
Altitude QA (climb shots, flight log, taps, perf at cruise vs ceiling):
`node tools/altitude.mjs <baseUrl> shots/altitude downtown|west|gate|opening [--seq]`;
`--seq` also captures frames exactly 1/30 s apart, and
`python3 -I tools/seqstat.py shots/altitude/<phase>-seq-ceiling 5` counts what
changes between them (shimmer).
Super splat QA: `node tools/feel-sim/run.mjs s_super.ts` (charge, mega,
firehose counts and cost offline; the hold gesture itself is
`node tools/controls-sim/run.mjs s_gesture.ts`),
`node tools/supersplat.mjs <baseUrl> shots/supersplat [charge sweep alt mega
cooldown jet first audio base] [--base=<url>]` (frames, counts, perf, the gear
through a firehose, the first charge's frames, the sounds offline),
`python3 -I tools/supersplat-strip.py <dir> <out.png> a.png=label ...` (strips).

## City data (city-agnostic pipeline)
`tools/bake/` turns a city config (`tools/bake/cities/sf.json`) into compact
gzip'd binary region bundles in `public/city/<slug>/`:
```
python3 -m pip install geopandas pyogrio pyarrow rasterio pyproj scipy shapely
python3 -I tools/bake/bake.py sf       # footprints + 1 m DEM -> tiles
python3 -I tools/bake/pack.py sf       # tiles -> 1 km gzip regions
python3 -I tools/bake/horizon.py sf    # hills around the city
```
Sources: USGS 3DEP 1 m and 1/3 arc-second DEMs; FEMA/ORNL USA Structures
footprints (public domain). See `DECISIONS.md` for every call we made.

Paint state is a separate per-building array (faction, color, level, bloom
time) keyed by a stable building id, so a server can own it in Phase 2.

## Deploy
Vercel: import the repo; `vercel.json` is set up (build `npm run build`,
output `dist`). Add to Home Screen on iPhone for full-screen play.
