# Struggle Bus

A wheezing yellow school bus flies over real San Francisco and barfs rainbows.
Wherever it splats, grey Victorians bloom into Painted Ladies.

Phase 1: single player, no server. iPhone Safari first (portrait, one thumb).

## Play
- **Drag anywhere**: the bus follows a springy bungee from where you touched.
  It's also a yoke. Sideways carves and banks. **Pull down** to climb
  (harder = faster, the bus slows as it trades speed for height) up toward
  a soft ceiling high above the city (~520 m), where it wheezes and
  struggles. **Push up** to nose down: dive back to the rooftops, gaining
  speed; at the rooftops it surges (about 250 mph).
- **Let go**: it cruises and holds its altitude with a wheezy bob; at the
  rooftops it skims them automatically, as ever.
- Up high the camera pulls back into a vista (it holds perfectly still while
  you hold your altitude): climb out of the marine layer and the west side
  and the bay lie under a fog sea, with Sutro Tower, Twin Peaks, the
  downtown towers and the bridge towers poking through, the hills on the
  horizon. Over the Golden Gate the bus can't climb until it has passed
  under the deck.
- **Tap** (a second finger works while steering): dragon breath. The bus
  rears back and blasts a rainbow jet forward; it explodes on the building
  ahead (when the belly is full, that building glints, and the glinting one is
  the one you hit; lifting your thumb to tap keeps it): a flash, a rainbow
  shockwave, and every building within ~60 m blooms, the street and the trees
  around them splattered too. From altitude it lands where you're looking,
  mid-screen, after a longer flight, and the blast is bigger the higher you
  fire from. The belly glows fuller as the next blast recharges.
- Keyboard: arrows / WASD fly the same yoke (Down/S climbs, Up/W dives or
  surges), Space breathes.
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
Feel QA: `node tools/feel-sim/run.mjs s_aim.ts` (and the other scenarios in
its header) runs the real flight / aim / splat code offline on the baked city;
`node tools/feel.mjs <baseUrl> shots/feel [strip] [glint] [taps]` shoots the
tap -> jet -> impact -> hit-stop strip and checks real taps in the browser.
Altitude QA (climb shots, flight log, taps, perf at cruise vs ceiling):
`node tools/altitude.mjs <baseUrl> shots/altitude downtown|west|gate|opening [--seq]`;
`--seq` also captures frames exactly 1/30 s apart, and
`python3 -I tools/seqstat.py shots/altitude/<phase>-seq-ceiling 5` counts what
changes between them (shimmer).

## City data (city-agnostic pipeline)
`tools/bake/` turns a city config (`tools/bake/cities/<slug>.json`) into compact
gzip'd binary region bundles in `public/city/<slug>/`, from **OpenStreetMap**
(read through Overture Maps' GeoParquet release on S3):
```
python3 -m pip install geopandas pyogrio pyarrow rasterio pyproj scipy shapely laspy matplotlib
python3 -I tools/bake/overture.py sf   # OSM via Overture: buildings, parts, streets, land, water, trees, names
python3 -I tools/bake/bake.py sf       # footprints + heights + roofs + ground + names -> tiles
python3 -I tools/bake/pack.py sf       # tiles -> 1 km gzip regions
python3 -I tools/bake/horizon.py sf    # hills around the city
python3 -I tools/bake/plot.py out.png --at=37.7763,-122.4328 old=public/city/sf  # top-down QA plot
```
Any city Overture covers bakes the same way: `tools/bake/cities/amsterdam.json`
(the Jordaan, no LiDAR, no DEM) is played with `?city=amsterdam`.
Sources: OpenStreetMap via Overture Maps (ODbL 1.0); USGS 3DEP 1 m and 1/3
arc-second DEMs and the 3DEP lidar point cloud; FEMA/ORNL USA Structures where
OSM has no footprint (public domain). The baked tiles are a derivative database
under the ODbL: see `public/city/DATA_LICENSE.md`; the game credits
"© OpenStreetMap contributors, Overture Maps Foundation" during the opening and
in the tuner. See `DECISIONS.md` for every call we made.

Paint state is a separate per-building array (faction, color, level, bloom
time) keyed by a stable building id, so a server can own it in Phase 2.

## Deploy
Vercel: import the repo; `vercel.json` is set up (build `npm run build`,
output `dist`). Add to Home Screen on iPhone for full-screen play.
