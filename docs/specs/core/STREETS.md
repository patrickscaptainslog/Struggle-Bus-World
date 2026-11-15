# The street index (M1 task 8)

The second account, 2026-11-14. For FLY TO A STREET (task 9, the first account's): every named street of the city by its name, in one small file, read before any tile is in. `docs/M1.md` has the task; `docs/STUDIO.md` part 7, system 6.

## What is here

- **`public/city/sf/streets.bin`**: 2,424 streets in 3,232 runs, 68,183 bytes (66.6 KB; 46.8 KB gzipped). The target was under 100 KB.
- **`src/world/streetIndex.ts`**: the file's format, its reader and the search. Pure: no DOM, no three.js, nothing fetched. Its head comment has the byte layout.
- **`tools/streets/build.mjs`**: makes the file from the city's own tiles (`node tools/streets/build.mjs [city folder]`). No download and no bake: the tiles already carry their streets' names and centrelines, so any city baked from OpenStreetMap gets one. The same tiles always give the same bytes.
- **`tools/streets/check.mjs`**: the check (`node tools/streets/check.mjs [city folder]`), below.

## Using it (task 9)

```ts
import { findStreet, parseStreets } from './world/streetIndex';
const ix = parseStreets(await (await fetch(`${cityUrl}/streets.bin`)).arrayBuffer()); // null: no index, no search
const hits = ix ? findStreet(ix, typed, { x: flight.x, z: flight.z }) : [];
// hits[0]: { street: { name: 'Guerrero St', ... }, cross: null | Street, x, z, score }
```

- `findStreet(ix, text, near?, most = 5)` answers with the streets the text could mean, the likeliest first, each with a point in the map's metres. Nothing found is an empty list. It never throws.
- What a thumb may type: `guerrero`, `Guerrero Street`, `20` or `20th` (20th St and 20th Ave both come back, the one whose kind was typed first, else the longer), `the embarcadero`, a slip (`valenica`, `divisidero`), a name's beginning (`van`), and a corner: two names joined by `&`, `/`, `@`, `+`, `and` or `at` (`guerrero & 20th`, `16th and mission`).
- The point: the corner when two streets were named and they meet (`cross` is the second street); else the point of the street nearest `near` when it is given (the bus), else the middle of its longest run. Without `near`, "Mission" lands mid-Mission; with it, on the Mission St nearest the bus. Which of the two the sheet wants is yours.
- `score` is 0 for the name as typed, 0.5 when only the kind differs, 1 to 1.5 for a longer name it begins, 2 and up for a slip. The sheet could show the first answer's name before it flies, since a slip may not be what was meant.
- `middleOf(street)`, `nearestOn(street, x, z)` and `crossing(a, b)` are there for the swoop's own use. A street's `pieces` are its runs, x and z pairs, the longest first.

## What the builder does to the tiles' lines

The tiles hold a street cut at every tile's edge, and a wide avenue twice (its two sides). The builder joins the cuts (an end within 6 m of an end, or lying on another cut's line, which is how they meet where the city's grid crosses the tiles' at 9 degrees), keeps each connected part's longest way through and then its other arms, cuts a way that goes out one side of an avenue and back the other at its far end, leaves out a part that runs beside a longer one within 45 m (568 of them) and scraps under 40 m (1,649), and simplifies each run to within 5 m. Coordinates are kept to 4 m.

Left out on purpose: paths, plazas, and the sidewalks the map names (`Mission Street, W. Sidewalk`). Two names have no line of two points and are not in it (Townsend Cir, Bigelow Ct).

## The check, and what it printed (feat/streets, a cloud machine, Node only)

| Row | Printed |
|---|---|
| size | `{"bytes":68183,"KB":66.6,"under100KB":true,"streets":2424,"runs":3232,"aFreshBuildIsTheFile":true,"twoBuildsAgree":true}` |
| thirty | thirty names typed as a thumb types them (Guerrero, valencia st, Hayes Street, lombard, Geary, irving and 24 more), each first answer that street at a point within 12 m of its own line in the tiles: `{"names":30,"found":30,"farthestFromItsStreetM":4.9,"wrong":[]}` |
| itself | `{"streets":2424,"foundFirstByTheirOwnName":2424,"wrong":[]}` |
| on | `{"farthestIndexPointFromItsStreetM":6.1,"of":"Elizabeth St","tilesLengthWithin60mOfTheIndex":"99.9 %","leastOfAStreetOver300m":"89 % Esmeralda Ave","middlesOffTheirStreet":0}` |
| corners | ten corners, each within 25 m of both streets' lines in the tiles: `{"corners":10,"found":10,"wrong":[]}` |
| slips | `{"slips":9,"found":9,"wrong":[]}` |
| nothing | nonsense and empty text: `{"found":[],"threw":""}` |
| damage | the file cut short at 703 places, 400 random files, a byte flipped every 211th: `{"cutShort":703,"readAsAnIndex":0,"random":400,"threw":"","notANumber":0}` |

"streets: all passed". With no `streets.bin` it exits 2 and says to build it. The row `itself` failed on the first build (3 of 2,424: a street signed with no kind lost to its longer namesake) and led to the rule that the name as typed comes first.

## Not done

- The sheet, the fetch and the swoop: task 9.
- A phone. How the search feels as a thumb types.
- Other cities: the builder takes any city's folder, and only San Francisco's was built and checked.
- A street's number range ("1200 Guerrero"): the tiles have no house numbers.
