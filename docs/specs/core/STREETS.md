# The street index (M1 task 8)

The second account, 2026-11-14. For FLY TO A STREET (task 9, the first account's): every named street of the city by its name, in one small file, read before any tile is in. `docs/M1.md` has the task; `docs/STUDIO.md` part 7, system 6.

## What is here

- **`public/city/sf/streets.bin`**: 2,426 streets in 3,335 runs, 71,626 bytes (69.9 KB; 48.1 KB gzipped). The target was under 100 KB.
- **`src/world/streetIndex.ts`**: the file's format, its reader and the search. Pure: no DOM, no three.js, nothing fetched. Its head comment has the byte layout and the score's bands.
- **`tools/streets/build.mjs`**: makes the file from the city's own tiles (`node tools/streets/build.mjs [city folder]`). No download and no bake: the tiles already carry their streets' names and centrelines, so any city baked from OpenStreetMap gets one. The same tiles always give the same bytes.
- **`tools/streets/check.mjs`**: the check (`node tools/streets/check.mjs [city folder]`), below.

## Using it (task 9)

```ts
import { findStreet, parseStreets } from './world/streetIndex';
const ix = parseStreets(await (await fetch(`${cityUrl}/streets.bin`)).arrayBuffer()); // null: no index, no search
const hits = ix ? findStreet(ix, typed, { x: flight.x, z: flight.z }) : [];
// hits[0]: { street: { name: 'Guerrero St', ... }, cross: null | Street, x, z, score }
```

- `findStreet(ix, text, near?, most = 5)` answers with the streets the text could mean, the likeliest first, each with a point in the map's metres and a score. Nothing found is an empty list. It never throws, and the longest text takes about 3 ms.
- **What a thumb may type:** `guerrero`, `Guerrero Street`, `south van ness`, `mlk drive`, `20` (20th St and 20th Ave both come back), `24th ave`, `goodlett` (a later word of a long name), `van` (a beginning), `valenica` (a slip), `guerrero st, san francisco` or `1200 guerrero st` (words it has no use for), and a corner: `guerrero & 20th`, with any of `&`, `/`, `@`, `+`, a comma, `x`, `and`, `at`, `near`, or just the two names (`16th mission`).
- **The point:** the corner when two streets were named and they meet (`cross` is the second street); else the point of the street nearest `near` when it is given (the bus), else its middle. With `near`, of two streets of one name the nearer comes first: over the Mission `24th` is the street, over the Sunset the avenue.
- **The score says how sure**, and the sheet can use it: show the first answer's name before the bus flies whenever it is not 0.

| Score | What it is |
|---|---|
| 0 | the name as typed (the kind left off counts: `guerrero` is Guerrero St) |
| 0.75 to 1.5 | a looser reading of the whole text: another kind (`van ness st`), a later word or a beginning of a longer name, letters a name begins (`gue`) |
| 2 to 2.5 | the text with words taken off its end or its start (a town, a house number, a slip in the kind) |
| 3, 4 | one slip of the thumb, two |
| a corner | the looser of its two names; plus 1 where the two streets only come near each other (within 130 m: the map leaves Powell's last block out, so `powell and market` is the point between them); plus 2 where they do not meet, answered with one street alone, `cross` null |

- A place that is no street (`Union Square`) answers a guess (Union St, score 2): the index holds streets. A figure is never a slip: `pier 93` finds nothing, not Pier 96.
- `middleOf(street)`, `nearestOn(street, x, z)` and `crossing(a, b)` are there for the swoop's own use. A street's `pieces` are its runs, x and z pairs; the first `main` of them are the street itself, the longest first, and the rest are a namesake's far off on the same map (Sausalito's Pine St), which the search leaves alone unless the bus is within a kilometre of it.

## What the builder does to the tiles' lines

The tiles hold a street cut at every tile's edge, and a wide avenue twice (its two sides). The builder joins the cuts (an end within 6 m of an end, or lying on another cut's line, which is how they meet where the city's grid crosses the tiles' at 9 degrees), keeps each connected part's longest way through and then its other arms, cuts a way that goes out one side of an avenue and back the other at its far end, leaves out a side that runs within 25 m of a kept one (and keeps what of it runs on farther off: Geary's last blocks to Van Ness), drops scraps under 40 m that lie beside a kept run, and simplifies each run to within 5 m. Coordinates are kept to 4 m. Runs of one name more than 700 m from the rest are another place's: the street is the place with the most length, the map's middle favoured.

Left out on purpose: paths, plazas, and the sidewalks the map names (`Mission Street, W. Sidewalk`).

## The check, and what it printed (feat/streets, a cloud machine, Node only)

"streets: all passed", twelve rows:

| Row | Printed |
|---|---|
| size | `{"bytes":71626,"KB":69.9,"under100KB":true,"streets":2426,"runs":3335,"aFreshBuildIsTheFile":true,"twoBuildsAgree":true,"theBuilderReadsItsFolder":true}` |
| names | every street name in the tiles is in the index: `{"inTheTiles":2426,"inTheIndex":2426,"missing":[]}` |
| thirty | thirty names typed as a thumb types them (Guerrero, valencia st, Hayes Street, lombard, Geary, irving and 24 more), each first answer that street, score 0, within 8 m of its own line in the tiles: `{"names":30,"found":30,"farthestFromItsStreetM":4.9}` |
| itself | `{"streets":2426,"foundFirstByTheirOwnName":2426}` |
| on | `{"farthestIndexPointFromItsStreetM":6.1,"of":"Elizabeth St","tilesLengthWithin60mOfTheIndex":"100.00 %","leastOfAStreetOver300m":"89 % Esmeralda Ave","middlesOffTheirStreet":0}` |
| typed | 29 other forms (a direction spelt out, initials, a later word, a beginning, a bare number, words after the name, a slip in the kind): `{"forms":29,"found":29}` |
| corners | 24: twenty joined every way, one the map leaves a block out of, three that never meet: `{"corners":24,"found":24}` |
| real | every corner in the tiles, two names whose lines touch, asked both ways: `{"cornersInTheTiles":8261,"askedBothWays":16522,"thatPairWithin30m":16498,"share":"99.85 %"}` |
| near | from five places, every street: `{"asked":12130,"streetsWithANamesake":123,"wrong":[]}` |
| slips | `{"slips":15,"found":15}` |
| nothing | nonsense, empty text, 50,000 spaces, not a string: `{"found":[],"threw":"","slowestMs":2.6}` |
| damage | cut short at 739 places, 400 random files, any one byte wrong, grown, not bytes at all: `{"tried":2520,"readAsAnIndex":0,"threw":""}` |

With no `streets.bin` it exits 2 and says to build it.

**Two readers were set to break the first build** (one typing as a San Franciscan would, one on the file and the builder), and found 25 faults, seven of them major: `South Van Ness`, `West Portal` and `Martin Luther King Jr Dr` found nothing; `powell & market` flew to mid-Powell at score 0; one slip in `st` or a town after the name emptied the answer; Geary Blvd stopped at Gough; a corner on an avenue's far side was lost; `pine` from the Golden Gate landed in Sausalito; and the check passed with half the streets missing. All 25 are answered above and each has a row: the first build passes only four of today's twelve.

## Not done

- The sheet, the fetch and the swoop: task 9.
- A phone. How the search feels as a thumb types.
- Other cities: the builder takes any city's folder, and only San Francisco's was built and checked.
- A street's number range ("1200 Guerrero" lands on Guerrero, not at 1200): the tiles have no house numbers.
- 24 of the 16,522 real corners (0.15 %) are answered more than 30 m off: where two streets touch in the tiles at a stub the builder leaves out.
