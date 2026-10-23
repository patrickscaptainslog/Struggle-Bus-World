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
- Up high the camera pulls back into a vista: climb out of the marine layer
  and the west side and the bay lie under a fog sea, with Sutro Tower, Twin
  Peaks, the downtown towers and the bridge towers poking through.
- **Tap** (a second finger works while steering): dragon breath. The bus
  rears back and blasts a rainbow jet forward; it bursts over the building
  ahead (when the belly is full, that building glints) and spills onto its
  unpainted neighbors. From altitude it lands where you're looking, mid-screen,
  after a longer flight. The belly glows fuller as the next blast recharges.
- Keyboard: arrows / WASD fly the same yoke (Down/S climbs, Up/W dives or
  surges), Space breathes.
- Splat an already-painted house to escalate it: rooftop garden, then full
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
Screenshots: `node tools/shot.mjs <url> out.png`, `node tools/shots.mjs`.
Altitude QA (climb shots, flight log, taps, perf at cruise vs ceiling):
`node tools/altitude.mjs <baseUrl> shots/altitude downtown|west|opening`.

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
