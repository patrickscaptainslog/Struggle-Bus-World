# The door: a bare link's first thirty seconds

M1 task 5 (the studio's first milestone, `docs/M1.md`; the direction is `docs/STUDIO.md`, part 3, table A). Built on `feat/sf` by the first account, 2026-11-14, then fixed after its review and a newcomer's look at its frames (the same day). A preview branch: the studio's picks, for the producer to judge by playing.

## What a newcomer sees

| When | On screen | Code |
|---|---|---|
| 0 s | The loading page: STRUGGLE BUS, PAINT SAN FRANCISCO, the bobbing bus | `index.html` (the line hides for another city, the Moon or `?resume`) |
| first frame | The bus already gliding along the Golden Gate's main span, just past the north tower, heading south, 40 m to the city's side of the deck and 24 m over it, at 40 m/s. The thumb flies at once: no gate, no low shot, no TAP TO SKIP. The fog lifts in 2.4 s | `main.ts` (the door's pose, from the bridge's towers and deck), `config.door` |
| from the first glint | The cue says TAP TO PAINT, and stays until the first paint, touched or not | `Coach.ts`, `Hud.ts` |
| first tap | Paint runs out along the deck and down the cables (stage 1), the bloom, the chord, the bridge's street sign (once a visit). DRAG comes after it. Four pips in a row under the toast's slot, one lit, over a thin bar that fills while the next counted hit waits | `Crown.ts`, `Splat.ts`, `Hud.setCrown` |
| every 5 s at most | A counted hit moves the bridge one stage: 2 the cables (bunting strings out from the towers, pennants about 8 m wide), 3 the towers (wavy bands, gilt, gold crowns on the saddles). Every other tap still paints and blooms where it is | `Crown.level`, `Bridges.ts` |
| the fourth counted hit | The crown: big sparks thrown off both tower tops in the crew's colours (Rainbow's six with no crew), lights running along the deck and up the towers, a flash over the frame, a camera punch, the bell, and GOLDEN GATE BRIDGE / CROWNED in the toast's slot with all four pips lit, for 3.2 s (held while another toast is up, then shown) | `main.ts` `crown()` |
| then | FLICK UP TO GO FASTER, once ever | `Coach.flickDue` |
| 12 s after it | STEER BELOW THE BUS / DRAG HIGH UP TO LOOK (the old hint's other lines), once ever | `Coach.restDue` |
| after | The bus is the player's as ever, gliding on south off the bridge toward the Richmond's houses, 3 km on | |

A player who never crowns the bridge still gets FLICK UP: 35 s into the visit, or as soon as the bus is 700 m from the bridge. On a later visit with the bridge crowned already it comes once the fog has lifted.

A newcomer tapping every 2.6 s (the belly's own cycle) paints the deck under a second after the first frame and crowns the bridge at about 17 s; the Bay Bridge crowns the same way from beside its west span (laptop rows `m1-door` and `m1-crown-bay`, sb-checks/swerve/crewbus on the laptop). The door's busiest second was under 100 draws and about 0.57 M triangles there.

## The rules

- **The door** is the start of any visit that would have opened under the Golden Gate: a bare link with no return start. `?skipintro` keeps the old Golden Gate start (the tools' pose, gate and all), and so do `?lift` and `?earth`. `?swerve` and `?crew` open on the door too (they are bare links with a flag; other crews' paint can't climb the bridge, below). A return visit starts over its own paint as before. Painting only a bridge leaves no return record (a landmark keeps none), so the next visit is the door again.
- **The crown** belongs to every paintable bridge (`lm:ggb`, `lm:baybridge`): four stages from the parts the bridge kit already builds (deck, cables, towers) and the crown. The stage is the bridge's saved paint level (1 to 3). A crowned bridge is kept in `localStorage` (`strugglebus.crowns.v1:<city>`), saved when the crowning hit lands (not when it is fired), and stays crowned on a return visit (no ring, no second crown; its look is stage 3's) only while its paint is still at level 3: paint cleared under it, it climbs again. A slug that clears its landmarks' paint (`~swerve`, `~recess`, `~bench`) clears its crowns with it.
- **A counted hit** is one of the player's own blasts (a tap, a Comet, a Lob, a Bomb, the Hose or a super) that reaches the bridge at least `config.door.gap` (5 s) after the last counted one, or its first paint. A blast between them re-pops it at its stage. Another crew's paint (a rival bus's breath on `?swerve`) never counts: it re-pops a painted bridge at its stage and leaves a grey one grey.
- **During the door only**, three helps. The pull: while the door's bridge is uncrowned and the bus within 700 m of it, a shot of the player's that would land on nothing takes the bridge when its outline is within 85 m of the line from the bus to the aim point (the line's first 250 m) or of the aim point, so a first tap never splashes in the bay, after a steer either way or from over the cables. The held tap: a tap the belly can't take yet is held, one at most, and breathes the frame the belly is full, through the tap's own guards; never a wheeze. Each tap holds it 0.5 s from itself, the half second a shot may follow the touch that meant it (the core's flight5): taps that keep coming keep it, and after the last one it breathes within 0.5 s or is dropped, unheard. Held for a whole refill, one stale tap breathed 2.6 s late and made every tap after it late. The line: while the bridge is uncrowned and no thumb has steered, the bus turns back 160 m short of each tower, away from the deck, and comes back along its side line, so one who never touches keeps the bridge in reach; a thumb down flies as always, and the first real steer or the crown ends it.
- **The cues on the door**: TAP TO PAINT, then DRAG, then FLICK UP TO GO FASTER, then the lane and the look. The three-line hint never shows there (the door's own lines teach it).
- **Nothing compiles for it**: the stages are the landmark material's own levels (the cables' bunting is drawn from level 2 by its draw range), and the crown is particles, the frame's flash and the HUD.

## The producer's rulings it bends (STUDIO.md part 12)

- **R2**, "one brief hint on the first run": each gesture taught once at its moment, the old hint's lines included, in four toasts instead of one.
- The controls' note that under the Golden Gate's low shot every lone landing flies (`Input.lookOff`, the studio's call) no longer applies on a first visit: the door has no low shot, so a touch high over the bus looks from the first frame, as everywhere else.
- The door is the city's own opening (`start.opening` in its manifest), placed from its bridge's data; a city with no opening has no door. The crown is any bridge's.
- "Start where the game starts" is untouched: this is where a bare link always started; it is only nearer the bridge.
- The helps above are the door's alone, not the game's: whether a held tap, the pull or the line should hold everywhere is the producer's call.

## Not done

- The postcard at the crown (M1 task 7, R1), and with it the crown framed as the picture: the camera holding the whole bridge side on with the city behind for a beat. The crown's flash still whites the bridge for half a second and its sparks go off the top of the frame; the rainbow at stage 3 is the better picture today.
- A crowned bridge has no look of its own after the crown's burst; on a return visit it looks like stage 3.
- The deck's aim glint is too faint to see at a phone's size (laptop frames, no touch, m1a/fix/frames/still); TAP TO PAINT carries the first second alone.
- The tower tops are cut by the frame's top edge from about 14 s.
- The aim at the nearest houses that can float: the bus goes on along its line, which runs to the Richmond's houses about 3 km on (the map check's 2.98 km); the Marina's Palace block (2.6 km) would need a turn. No far glint on a grey block.
- The loading page doesn't answer a tap, and the first frame's time on a phone over a weak line is unmeasured (M1 task 10).
- Rows on the laptop only (sb-checks/swerve/crewbus/m1a on the laptop); no phone has flown it.
