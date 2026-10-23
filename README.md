# Struggle Bus

A wheezing yellow school bus flies over real San Francisco and barfs rainbows.
Wherever it splats, grey Victorians bloom into Painted Ladies.

Phase 1: single player, no server. iPhone Safari first (portrait, one thumb).

## Play
- **Drag anywhere**: the bus follows a springy bungee from where you touched.
  Sideways carves and banks, up surges (about 250 mph), down slows to a hover.
- **Let go**: it cruises.
- **Tap** (a second finger works while steering): dragon breath. The bus
  rears back and blasts a rainbow jet forward; it explodes on the building
  ahead (when the belly is full, that building glints): a flash, a rainbow
  shockwave, and every building within ~60 m blooms, the street and the trees
  around them splattered too. The belly glows fuller as the next blast recharges.
- Blast an already-painted block to escalate it: rooftop gardens, then full
  Hundertwasser.
- Paint is saved on your phone.
- Three-finger tap (or `?tune`) opens the hidden tuning panel; `?fps` shows the
  frame-rate meter.

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
