# Struggle Bus

A wheezing yellow school bus flies over real San Francisco and barfs rainbows.
Wherever it splats, grey Victorians bloom into Painted Ladies.

Phase 1: single player, no server. iPhone Safari first (portrait, one thumb).

## Play
- **Phones fly by tilt.** The first touch says "TILT TO FLY": hold the phone
  however is comfortable (that pose is level) and tap (on iPhone, allow
  motion access). Tilt left / right to carve and bank. Tilt the top edge
  **toward you** to pull back and climb (harder = faster, the bus slows as it
  trades speed for height) up toward a soft ceiling high above the city
  (~520 m), where it wheezes and struggles; tilt it **away** to nose down:
  dive back to the rooftops, gaining speed; at the rooftops it surges (about
  250 mph). Hold it level and the bus holds its altitude with a wheezy bob;
  at the rooftops it skims them automatically. The recenter button (top
  right) takes your current pose as level; small posture drifts recenter on
  their own when you hold still.
- **Tilt mode: the whole screen is the splat button.** Tap = dragon breath.
  Press and hold = charge the super splat. Swipe up = shift up a turbo gear
  (keep the finger down after the swipe to boost), swipe down = shift down.
- **Touch to fly** (settings, top right; also automatic without motion
  sensors): drag anywhere, the bus follows a springy bungee from where you
  touched; drag down to climb, up to dive / surge, let go to hold. Tap
  anywhere (or a second finger while steering) to breathe; the rainbow
  SPLAT button (bottom right) taps and holds; the TURBO lever above it
  shifts (tap the top / bottom, or swipe it) and boosts while held.
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
- Keyboard (desktop): arrows / WASD fly the same yoke (Down/S climbs, Up/W
  dives or surges), mouse drag is the bungee, Space breathes (hold to
  charge), E / Q shift turbo gears, Shift boosts.
- Blast an already-painted block to escalate it: rooftop gardens, then full
  Hundertwasser.
- Paint and your control settings are saved on your phone.
- Three-finger tap (or `?tune`) opens the hidden tuning panel; `?fps` shows the
  frame-rate meter; `?controls=tilt|touch|keyboard` forces a control scheme,
  `?nohud` hides the HUD.

## Develop
```
npm install
npm run dev          # http://localhost:5173
npm run build        # dist/
```
Dev pages: `dev/city.html` (real city viewer), `dev/flight.html` (autopilot
flight test), and one page per module (`dev/bus.html`, `dev/fx.html`, ...).
Screenshots: `node tools/shot.mjs <url> out.png`, `node tools/shots.mjs`,
`node tools/blast.mjs <url> <outDir> [perf] [seq] [top] [reload] [escalate] [tap] [drop] [layouts]`
(blast QA at the Painted Ladies: frame sequence, top-down view, persistence, perf).
Feel QA: `node tools/feel-sim/run.mjs s_aim.ts` (and the other scenarios in
its header) runs the real flight / aim / splat code offline on the baked city;
`node tools/feel.mjs <baseUrl> shots/feel [strip] [glint] [taps]` shoots the
tap -> jet -> impact -> hit-stop strip and checks real taps in the browser.
Controls QA: `node tools/controls-sim/run.mjs s_tilt.ts` (and s_tune, s_perm,
s_gesture, s_turbo; see its header) runs tilt, gestures and turbo offline
against the real modules; `node tools/controls.mjs <baseUrl> shots/controls
[touch] [turbo] [tilt] [perf=<otherBaseUrl>]` checks them in the browser.
Altitude QA (climb shots, flight log, taps, perf at cruise vs ceiling):
`node tools/altitude.mjs <baseUrl> shots/altitude downtown|west|gate|opening [--seq]`;
`--seq` also captures frames exactly 1/30 s apart, and
`python3 -I tools/seqstat.py shots/altitude/<phase>-seq-ceiling 5` counts what
changes between them (shimmer).

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
