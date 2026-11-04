# LIVING: a living Earth

The producer, 2026-11-04: "I want to start populating the earth map with real terrain/buildings ... How do we go about this strategically as world class game designers to ensure our players have the most beautiful, interesting, thoughtful experience playing this game. I don't want to cut corners. For instance I want to add: people, cars ferries planes (real live real time planes) and like cruise ships and sailboats in popular bays and harbor. I want to bring life into this game. Should we build all of this together or split it up some way?"

**State.** Approved by the producer on 2026-11-04: "Ok. I love this living earth plan." Their additions that day are in it: cargo ships across the oceans, ferries simulated everywhere rather than live, weather noted for later, and how every call here is made: "you are a world class game design studio - and at building this game and making decisions through that lens - strive to build an extraordinary, beautiful, engaging game at all times." Nothing is built yet; stage 0 is next. The picks are the ones they approved, and any can still change. Facts are marked: MEASURED (run here), SOURCE (a page, checked 2026-11-04), ESTIMATE (arithmetic, assumption given).

## In one minute

- **Life follows paint.** The grey world has life, but grey life is quiet: grey cars in lines, people with their heads down, a grey ferry on its timetable. Paint wakes it. A painted ferry leaves a rainbow wake on its real route, a painted airliner draws a rainbow contrail across the sky, a painted crowd looks up and dances. Life is the reward for painting, and paint stays the only saturated thing.
- **Real where the world is real.** Planes are live, from ADS-B. Everything else is simulated on the real map by the real local time, well enough that a local believes it: ferries on their real routes, the world's cargo ships on the real shipping lanes between real ports, cruise ships on real port calls, and cars, people and sailboats on the real roads, plazas and bays.
- **The ground first, life on top.** The world under the bus needs real terrain and every building, from orbit to the street. Most of that is already designed (`docs/specs/far-field/VERDICT.md`); what's new is that the round Earth now exists, so the planet layer feeds the flight's ground as well as the cities.
- **One place first, then everywhere.** The San Francisco Bay Area, alive, end to end, flown on two phones. Then every city.
- **Split by layer.** The first account (this laptop: the GPU, the bake tools, the downloads) owns the world's data. The second (the cloud) owns life. One place, two branches, a contract between them agreed in the first days.
- **Money.** About $250 for a used iPhone 13 (the game's floor has never been measured), $100-200 for the first whole-planet bake on a rented machine, a few dollars a month for tiles and the planes' relay. A small live feed means one change to "no server".

## The idea: life follows paint

The creative brief already says it: "Nothing moves in grey." So life doesn't arrive as decoration. It arrives as the world's answer to paint.

| Thing | Where it comes from | Grey | Painted | The mark it leaves |
|---|---|---|---|---|
| Airliners | Live, ADS-B, every flight in the sky | A grey shape on its real path, with a white contrail at cruise | Rainbow livery, a chord on its engines, the label names the flight ("UA 837, SFO to Tokyo") | A rainbow contrail across the sky that drifts and fades over minutes, seen from the street |
| Ferries | Simulated on every real ferry route, with a timetable made from the route, the city and the hour | Grey, on time | Rainbow decks, a horn in the progression | A rainbow wake that stays on the water along the route, so each crossing repaints the lane |
| Cargo ships | Simulated: the world's fleet on the real lanes between real ports, at real speeds, in its real mix of container ships, bulk carriers and tankers | A grey hull under grey stacks of containers; from orbit, specks along the lanes | Rainbow containers, stack by stack where the paint lands; level 2 gardens on the stacks, level 3 domes on the bridge | It carries the paint across the ocean: still painted when it docks in Busan eleven days later, and the game can say where it is now |
| Cruise ships | Simulated on real port calls | A grey floating block in its terminal, leaving on schedule | A building that sails: level 1 bloom, 2 gardens on deck, 3 Hundertwasser | It sails off carrying the paint out of the bay |
| Sailboats | Simulated in bays with marinas, more at weekends | Grey sails, tacking | Rainbow sails, and a painted bay starts a regatta | The bay becomes the canvas: the sails are the painting |
| Cars | Simulated on the real roads, by road class and local hour | Grey lines in traffic, headlights at night | Bright and bouncy, honking in the chord | Rainbow tyre tracks on the streets they drive |
| People | Simulated on sidewalks, plazas and parks near the bus | Grey, heads down, walking | They light up, stop, look up, wave, dance, follow the bus | A painted place draws a crowd that stays |

**The rules.**
1. Real where data is real, believable everywhere else, never random noise. A local should recognise their ferry, their rush hour, their flight path into SFO.
2. Grey life is quiet; painted life sings. Paint changes how a thing behaves, not only its colour.
3. Everything that moves is a target. It answers a hit as a building does, the first impact about 0.4 s after the tap, and leaves a mark that outlasts it.
4. Near the bus life is dense and detailed; far away it turns to pixels, then to a shimmer along roads and lanes, then to nothing. Never a draw call for something under two pixels.
5. Same rules in every city, from San Francisco to Lagos (`CLAUDE.md`, "It has to scale to the whole world").
6. Time is real. The real Sun sets the hour: rush hour, quiet nights with headlights, sailboats at the weekend.
7. Respect. Only airline flights get named; private aircraft are anonymous small planes. A simulated ship never takes a real ship's name. Nothing tracks or labels a person.
8. Paint travels. What's painted on a thing that moves stays on it for its journey: the ship to its next port, the plane to where it lands. A player can come back to find it, and that's a reason to come back.

**The moments we're building for.** Each stage is judged on whether these land on the phone, not on whether the code is in:
- At dusk on the street, a painted airliner's rainbow contrail crosses the whole sky overhead and drifts for minutes.
- A painted ferry's wake stays on the bay, and the next crossing repaints the lane.
- A painted bay starts a regatta, and the sails are the painting.
- From orbit, the painted ships are specks of colour crossing a grey Pacific: the player's mark on the whole world.
- The container ship painted off Oakland is still in the player's colours days later, nearing Busan, and they can fly out to find it.

**Planes are where the street meets the sky.** The ceiling went up to 15 km "mainly so that we can fly with, and paint airplanes" (the producer, 2026-11-01). On 2026-11-01 adsb.lol had 71 aircraft within 74 km of San Francisco, 29 airborne (MEASURED). Every one of them is now in reach.

**How it looks on the phone's budget** (`CLAUDE.md`, Numbers: an A15 at 30 fps, 120-200 draws, 1.0-1.5 M triangles).

| Size on screen | Drawn as |
|---|---|
| 6 px or more | A small 3D model in the palette, animated (wheels, sails, legs as 2-3 frames) |
| 2-6 px | A low model or a billboard of a few pixels |
| Under 2 px | Points: one pixel that moves |
| Far away | No objects: a moving shimmer in the road and water shaders, from the same density numbers |

Every mover shares three instanced draws, small (people), middle (cars, boats) and large (ships, planes), as `StreetSign` shares its pool. Targets for the whole of life (ESTIMATE, to be measured on the A15 in stage 1): 3 draws, 80 K triangles, 1.5 ms a frame of CPU for the simulation and its upload, 4 MB of GPU memory.

**The simulation.** One worker. Deterministic by place and time: the same block at the same minute has the same cars, for every player, so nothing is saved, everything streams, and multiplayer later sees the same ferry. Full detail within about 2 km of the bus at street level, by pixel size higher up. Painted movers are the only state: a live plane by its ICAO address for its flight, a ferry or a cruise ship by its vessel, a simulated car or person only while it's near.

## The world under it

What exists: San Francisco's map and far field, the bridges, the plain temporary Earth (`public/sky/earth.bin`, 2048 x 1024, about 20 km a texel) under the flight, and the Moon.

What life needs from the world, and what the producer asked for anyway: real terrain and every building, from orbit to the street, and the graphs things move on. And the world can't stop at one city: home from the Moon comes down wherever the player aims (the producer, 2026-11-04: "I want someone to return to earth and land wherever on earth they aim at and fly into"), so the planet layer and any city are what's under them when they do.

1. **The far field's fixes and spike** (`VERDICT.md` steps 0 and 1, `SPIKE.md`): every block from the ceiling, with no pop. Already planned, never run.
2. **In and out of a city low down** (`EARTHFLIGHT.md`, E4): a city is found and left from above today.
3. **The planet layer** (`VERDICT.md` step 5): relief, surface and built, three layers on a cube-sphere tile tree, streamed parent first. It replaces `earth.bin` under the flight and meets each city's map at 14-15 km. Built for the Bay Area first, then baked for the planet.
4. **Any city** (`VERDICT.md` step 4): the city tiles built from Overture for any place, with heights from a ladder of sources, so a city looks right on arrival with no hand tuning.
5. **Graphs for life**, in the same tiles: roads with class and direction, footways, plazas and parks, water lanes and ferry routes, marinas, cruise terminals, airports and runways. And for the oceans, one baked graph of shipping lanes between ports, from the World Bank's density raster (below).

| Data | For | Licence | Size |
|---|---|---|---|
| Overture 2026-10-21.0 or later: buildings, transportation, places | Footprints, roads, ferry routes, terminals | ODbL (plus CDLA for some footprints), credits on screen | Buildings 277 GB, transportation 73 GB, worldwide (SOURCE, `research-earth.md`) |
| Copernicus DEM GLO-30 | Terrain everywhere | Copernicus licence: credit and its liability sentence | About 0.7 TB (ESTIMATE) |
| GEBCO_2026 | The sea floor and the bays | Public domain or CC BY (its pages disagree): credit either way | 7.2 GB |
| ESA WorldCover 2021 | Land class and tone | CC BY 4.0 | 124 GB for the classes |
| Google Open Buildings 2.5D, Microsoft footprints, GHS | Heights where Overture has none (it has them on 8.1 % of buildings) | CC BY 4.0, CDLA, CC BY | Per region |

Never FABDEM (CC BY-NC-SA) or any non-commercial source. Every download is the producer's to OK first, with file, source and size. Overture deletes a release about 60 days after it's out, and 2026-12-16.0 is a breaking release, so the Bay Area's inputs get archived in stage 0 (SOURCE: Overture's release calendar).

## Life's data

| Thing | Source | Key | Browser can call it | Terms for a free game | Fallback |
|---|---|---|---|---|---|
| Planes | adsb.lol | None today, one planned | No CORS header (MEASURED 2026-11-01) | ODbL data, BSD code; ask them before launch, credit in the game | Scripted flights on real routes into real airports |
| Planes, alternatives | OpenSky (4,000 credits a day registered), airplanes.live and ADS-B Exchange (non-commercial only), FlightAware ($100 a month minimum) | | | Not clearly fit for a public game | |
| Ferries | OSM and Overture ferry routes worldwide, timed from the route's length, the city and the local hour (the producer: ferries "don't need to be live accurate - just very educated guess simulated across the world") | None | Baked into the tiles | ODbL, as the tiles | |
| Cargo ships | Simulated. Where ships go: the World Bank's Global Shipping Traffic Density, about 500 m cells from IMF's analysis of hourly AIS positions, January 2015 to February 2021, with a commercial layer (SOURCE: World Bank data catalogue). The fleet's size: 112,500 ships on 1 January 2025 (SOURCE: UNCTAD, Review of Maritime Transport 2025, as reported); its mix by type from UNCTAD's fleet statistics. Ports from the tiles | None | Baked | CC BY 4.0, credit in the game (one catalogue copy says "Copyright": check before shipping) | |
| Ships live | aisstream.io hears ships only near coasts, where receivers on land are (SOURCE, second-hand: check its own pages); the open ocean takes satellite AIS, which is sold (Spire through Kpler, ORBCOMM, LSEG) | Yes | No: needs an always-on relay | Unknown | Not planned: the producer asked for live ships only "if easy to get accurate live data", and it isn't |
| Cars, people, sailboats | Simulated from the tiles' graphs | | | Ours | |

**How the cargo fleet is simulated.** Every ship is a deterministic voyage: a type (container, bulk, tanker, car carrier), a speed for its type (container ships about 16-20 knots, bulk carriers and tankers about 12-14: ESTIMATE, to check against UNCTAD), a route from port to port along the baked lanes, and its days in port. Its position is a function of the clock, so every player sees the same ship in the same place, and nothing streams from a server. Ships are made per lane until the lane's traffic matches the raster's, and the whole fleet's count matches UNCTAD's share at sea (ESTIMATE: about half, at any moment). A painted ship is the only state: its id, its hue and level, kept for its voyage.

## "No server" becomes one small relay

Planes and ships come from services a browser can't call, and the keys can't live in a public repo. So:

- **Planes:** one Vercel function the game asks for the planes in a box around the bus, cached for 10-15 s at the edge, so a thousand players over San Francisco make one request upstream. Keys, if any, in Vercel's environment variables. Free on the current plan as far as SOURCE says (Vercel Functions run up to 300 s on Hobby).
- **No live ships.** AIS is a stream that never closes, a Vercel function stops at 300 s, and the open ocean isn't in the free feeds anyway. The simulated fleet is the fleet. If a coastal feed ever shows something a player would see and the simulation can't give, that's the producer's call then.
- **If the relay is down,** the game doesn't change: the fallbacks above take over and nothing says so.

## Machines and money

| What | Why | Cost | When |
|---|---|---|---|
| A used iPhone 13 (A15) | The game's floor is an A15 at 30 fps, and nothing has ever been measured on one. Life costs frame time, and the 17 Pro can't say how much | About $210-290 (SOURCE: Swappa, Back Market, mid-2026) | Now |
| A machine to bake, rented by the hour: AWS in us-west-2, next to Overture's data, where reading it costs nothing | This laptop has 8 GB and measured 28-92 KB/s from S3. A planet does not bake here | $100-200 for the first whole-planet bake, transfer included (ESTIMATE, `research-earth.md` §11; an i4i.8xlarge with 32 cores and 7.5 TB of disk is about $2.75 an hour) | Stage 2, maybe stage 1 for the Bay Area's downloads |
| A monthly box (Hetzner, about €50-160) | Only once bakes are routine, monthly with Overture | | Later |
| Somewhere to serve the tiles: Cloudflare R2 (no egress fees, $0.015 a GB-month) or Backblaze B2 | Vercel's Hobby plan is for non-commercial use and 100 GB a month; Pro charges $0.15 a GB past 1 TB | About $10-15 a month for the whole planet (ESTIMATE) | Stage 2 |
| The planes' relay | Above | Free on Vercel | Stage 1 |
| A GPU rental | Not needed: this laptop's GPU checks real time, and a desktop GPU tells you less about a phone than the phone does | | |

I can't sign up for or pay for any of these: the producer does, and gives the engineers access (keys stay out of the repo).

## Who does what

**Split by layer, on one place first.**

| | The first account (this laptop) | The second account (the cloud) |
|---|---|---|
| Owns | The world: the far field, the planet layer, any-city tiles, E4's city edges, the graphs in the tiles and the ocean's lanes, the bake and the rented machine, the downloads | Life: the mover system, its simulation worker, how movers are drawn, how they meet paint, the planes' relay, ferries, the cargo fleet; and the trip home coming down where the player aims |
| Also | Reviews every stage of the second account's; runs the real-time checks on a real GPU for both | Reviews every stage of the first account's |
| Branch | `feat/world`, from `feat/earth` once the review's fixes are in | `feat/life`, the same |
| Why | It needs this laptop: the Python bake tools, the venv, SSH to the rented machine, the GPU | It's new code that tests well at a fixed step, and it builds on the flight the second account wrote |

**The contract, agreed in the first days, before either builds:** what a tile gives life (the graphs, ground height, water level, the frame from a city's map to Earth-fixed), what life gives the renderer (three instanced pools, the budget above), how a mover takes paint (its id, its hue and level, what's saved), and the weather as an input to life, held at clear until weather comes. It goes in `docs/specs/earth/CONTRACT.md`, drafted by the first account, signed off by the second.

**Hot spots.** `src/main.ts` gets one hook for life and nothing else from that branch; the world's changes stay in `City`, the tiles and the flight's ground. Whoever touches `main.ts` says so in `docs/TODO.md` first (`docs/BRIEF.md`). Two branches rather than one shared `feat/earth`, so the two accounts never push to the same branch at once; each stage merges into `feat/earth` after its review.

**Why not one place end to end, both accounts on it?** Both would edit `City`, the tiles and `main.ts` together, and the conflicts would cost more than the split saves. The place is still shared: both layers build the Bay Area first.

## Stages

Each ends on the producer's phones, both of them from stage 1, with a preview link and what to try. The next waits for their word. Estimates are agent-days as the docs here have used them; the second account has been doing several of those a day, and the real limit is one producer's flights a week (`VERDICT.md` §9).

### Stage 0: ground rules. 2-3 days, both accounts

- The review's findings on `feat/moonfree` and `feat/earth` fixed and reviewed again (`docs/reviews/`).
- `CONTRACT.md`, signed by both.
- The iPhone 13 bought, and the first floor numbers taken on today's builds: the street, `?earth` and `?moonland` with `?fps`.
- The Bay Area's inputs archived: Overture's buildings, transportation and places for the Bay Area, GLO-30, WorldCover and GEBCO tiles, each OK'd first with file, source and size.

### Stage 1: the Bay Area, alive. About 4 weeks

The world (first account):
- The far field's fixes and the spike: every block from the ceiling over San Francisco, Oakland, Berkeley and Marin, with no pop (`SPIKE.md`).
- The planet layer for the Bay Area: real relief, land and every building as blocks under the flight's loop, meeting the street's map at 14-15 km. The plain Earth stays everywhere else.
- E4, in and out of a city low down.
- The graphs for life in the Bay Area's tiles.

Life (second account):
- The mover system: three pools, the levels of detail, the simulation worker, paint on a mover.
- Planes, live, through the relay, with the scripted fallback.
- Ferries on the Bay's real routes, simulated, with the wake.
- Cargo ships in and out of the Port of Oakland under the Golden Gate, and out along the Pacific lanes, painted ones keeping their paint.
- Sailboats in the bay, with the sails.
- Cars on the roads the street draws, by the hour.
- People round the bus in plazas and parks.
- One cruise ship at Pier 27 on its real port calls.
- Home from the Moon coming down where the player aims: over San Francisco into the street, anywhere else onto the plain Earth until stage 2 fills it.

Done when: the producer flies the Bay Area on both phones and says it's alive; the iPhone 13 holds 30 fps in the busiest view (downtown at rush hour with the ferries out and a plane overhead); nothing compiles in flight; the plain page with no flag is unchanged.

### Stage 2: everywhere. About 8-10 weeks

- The world: the planet bake at 30 m on the rented machine, tiles on R2 or B2, any-city tiles with heights for the world, the 3-5 hero cities the producer picks (`VERDICT.md` decision 5).
- Life: ferries on every real route worldwide, the world's cargo fleet on every ocean, cruise ports and marinas from the tiles, planes everywhere, cars and people in every city.

### Later

Sound of life (traffic hum, gulls, the ferry's horn, all in the progression once painted), trains, birds, and ideas the producer may like: a live departures board ("UA 837 to Tokyo leaves in six minutes"), painting the 8:15 ferry as a daily goal, a list of where the player's painted ships and planes are now, stages that make a painted district's crowd dance (`STAGES.md`).

**Weather, way later** (the producer, 2026-11-04: "just note in the design schema that we will eventually plan to add weather. But way later"). It stays on hold until they say (`CLAUDE.md`). Life is built for it from the start: the simulation takes the weather as an input, held at clear until then, so rain can thin the plazas and slow the cars, fog can hold the sailboats in and slow the ferries, and wind can fill the sails, all without a rewrite.

## The producer's picks

Approved with the plan on 2026-11-04.

| Question | Pick |
|---|---|
| Life follows paint: grey life quiet, painted life alive | Yes |
| Split by layer, the world to the first account and life to the second, the Bay Area first for both | Yes |
| "No server" becomes one small relay for live planes, keys in Vercel | Yes |
| Live ships | No: the open ocean's data is sold, so the world's cargo fleet is simulated on the real lanes, and painted (the producer: "if not do your best to accurately simulate the worlds cargo ship ecosystem and allow for players to paint") |
| Ferries | Simulated on every real route, no timetables fetched (the producer, 2026-11-04) |
| A used iPhone 13 for the floor | Buy it now |
| A rented bake machine | By the hour on AWS, from stage 2, or stage 1 if the Bay Area's downloads crawl here |
| Tiles served from Cloudflare R2, which means lifting the Cloudflare hold for this alone, or Backblaze B2 | R2 |
| Cars need roads to drive on, and about two thirds of San Francisco's freeway surface isn't drawn: lift the streets hold for freeway surfaces only (`docs/specs/bridges/`, steps 4 and 5), lane lines and the rest still held | Yes |
| Planes from adsb.lol, with their OK before launch and a credit in the game | Yes |
| Only airline flights named, private planes anonymous, ships named only if they carry passengers | Yes |

## Risks

- **The A15.** Life is frame time, and nothing here has been measured on the floor phone. Stage 0's phone and stage 1's gate are there for it.
- **Paint saturation.** Wakes, contrails and tracks are new paint that spreads by itself. If a city fills with colour without the player, the grey stops meaning anything. Marks fade unless a player renews them, and the player's own hits stay the loudest thing.
- **Licences.** adsb.lol's production terms, the World Bank raster's CC BY credit, ODbL on the tiles (`research-earth.md` §9) and Copernicus's credit lines. Each gets a line in `DATA_LICENSE.md` before anything ships.
- **A fleet that looks made up.** Ships bunched at a port, a lane with nobody on it, ships through land. The raster is the check: the simulated traffic is measured against it lane by lane, and the shore against the tiles.
- **The relay** is the game's first running server. If it fails, the fallbacks must be indistinguishable, and it must cost nothing when nobody plays.
- **Overture's clock**, as above.
- **Two branches meeting** in `feat/earth`, and both in the flight's ground. The contract and the review are the guard.
- **One producer's eyes.** One visible win a week is the honest unit.

## Not confirmed

adsb.lol's terms for a public game; the World Bank raster's size and how its commercial layer turns into lanes; the fleet's mix by type, from UNCTAD's own tables; the ships' speeds; the Bay Area's download sizes, which are measured in stage 0; every price above, which is a mid-2026 snapshot to recheck before buying; the budget targets, which stage 1 measures on the A15.
