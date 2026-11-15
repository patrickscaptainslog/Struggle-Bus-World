# The door: a bare link's first thirty seconds

M1 task 5 (the studio's first milestone, `docs/M1.md`; the direction is `docs/STUDIO.md`, part 3, table A). Built on `feat/sf` by the first account, 2026-11-14. A preview branch: the studio's picks, for the producer to judge by playing.

## What a newcomer sees

| When | On screen | Code |
|---|---|---|
| 0 s | The loading page: STRUGGLE BUS, PAINT SAN FRANCISCO, the bobbing bus | `index.html` (the line hides for another city, the Moon or `?resume`) |
| first frame | The bus already gliding along the Golden Gate's main span, just past the north tower, heading south, 40 m to the city's side of the deck and 24 m over it, at 40 m/s. The thumb flies at once: no gate, no low shot, no TAP TO SKIP. The fog lifts in 2.4 s | `main.ts` (the door's pose, from the bridge's towers and deck), `config.door` |
| from the first glint | The deck glints. The cue says TAP TO PAINT | `Coach.ts`, `Hud.ts` |
| first tap | Paint runs out along the deck and down the cables (stage 1), the bloom, the chord, the sign. DRAG comes after it. A thin ring with four pips shows under the toast's slot | `Crown.ts`, `Splat.ts`, `Hud.setCrown` |
| every 5 s at most | A counted hit moves the bridge one stage: 2 the cables (bunting strings out from the towers), 3 the towers (wavy bands, gilt, gold crowns on the saddles). Every other tap still paints and blooms where it is | `Crown.level` |
| the fourth counted hit | The crown: big sparks thrown off both tower tops in the crew's colours (Rainbow's six with no crew), lights running along the deck and up the towers, a flash over the frame, a camera punch, the bell, GOLDEN GATE BRIDGE in the toast's slot and on its street sign | `main.ts` `crown()` |
| 3.2 s later | FLICK UP FOR GEARS, once ever | `Coach.flickDue` |
| after | The bus is the player's as ever, gliding on south off the bridge toward the Richmond's houses, 3 km on | |

A newcomer tapping every 2.6 s (the belly's own cycle) paints the deck under a second after the first frame and crowns the bridge at about 16 to 19 s; the Bay Bridge crowns the same way from beside its west span (laptop rows `m1-door` and `m1-crown-bay`, sb-checks/swerve/crewbus on the laptop). The door's busiest second was about 100 draws and 0.56 M triangles there.

## The rules

- **The door** is the start of any visit that would have opened under the Golden Gate: a bare link with no return start. `?skipintro` keeps the old Golden Gate start (the tools' pose, gate and all), and so do `?lift` and `?earth`. A return visit starts over its own paint as before. Painting only a bridge leaves no return record (a landmark keeps none), so the next visit is the door again.
- **The crown** belongs to every paintable bridge (`lm:ggb`, `lm:baybridge`): four stages from the parts the bridge kit already builds (deck, cables, towers) and the crown. The stage is the bridge's saved paint level (1 to 3); a crowned bridge is kept in `localStorage` (`strugglebus.crowns.v1:<city>`) and stays crowned on a return visit (no ring, no second crown; its look is stage 3's).
- **A counted hit** is a blast that reaches the bridge at least `config.door.gap` (5 s) after the last counted one, or its first paint. A blast between them re-pops it at its stage.
- **During the door only**, two helps: a tap that would land on nothing within 85 m of an uncrowned bridge's outline takes the bridge (so a first tap never splashes in the bay), and a tap that comes up to 0.6 s before the belly is full is held and goes when it fills (a newcomer tapping to the refill's beat lost every other tap to a frame's lag).
- **The cues on the door**: TAP TO PAINT, then DRAG, then FLICK UP FOR GEARS after the crown. The three-line hint never shows there (FLICK UP marks it taught).
- **Nothing compiles for it**: the stages are the landmark material's own levels (the cables' bunting is drawn from level 2 by its draw range), and the crown is particles, the frame's flash and the HUD.

## The producer's rulings it bends (STUDIO.md part 12)

- **R2**, "one brief hint on the first run": each gesture taught once at its moment.
- The controls' note that under the Golden Gate's low shot every lone landing flies (`Input.lookOff`, the studio's call) no longer applies on a first visit: the door has no low shot, so a touch high over the bus looks from the first frame, as everywhere else.
- The door is the city's own opening (`start.opening` in its manifest), placed from its bridge's data; a city with no opening has no door. The crown is any bridge's.
- "Start where the game starts" is untouched: this is where a bare link always started; it is only nearer the bridge.
- The two helps above are the door's alone, not the game's: whether a held tap or the pull should hold everywhere is the producer's call.

## Not done

- The postcard at the crown (M1 task 7, R1).
- A crowned bridge has no look of its own after the crown's burst; on a return visit it looks like stage 3.
- The aim at the nearest houses that can float: the bus goes on along its line, which runs to the Richmond's houses about 3 km on (the map check's 2.98 km); the Marina's Palace block (2.6 km) would need a turn. No far glint on a grey block.
- Rows on the laptop only (sb-checks/swerve/crewbus/m1a on the laptop); no phone has flown it.
