# GEARS: School Zone, and the street camera preview

The first account's School Zone and Curb's street camera preview, on `feat/gears`. `SHOTS.md` is the plan the producer approved on 2026-11-06 ("The slow gear and the street"), `CLAUDE.md`'s Shots block the rulings it changes: School Zone and Curb join the ladder below Cruise, one flick each, and School Zone climbs at about 15 m/s, there only.

## What's built

### School Zone

**Getting there.** A flick down from Cruise enters it, and a flick up is Cruise again. It's a rung under the gears, not a gear (`TurboDrive.below`), so every gear keeps its number and the readout says SCHOOL ZONE with no G number. Two flicks up from School Zone are Express.

**Below it.** Curb isn't built, so a flick down in School Zone does nothing: no rung, no sound, no readout. The flick is still read. Curb's step puts its landing there.

**The gate.** Under the opening's gate a flick down at Cruise is nothing, as it always was: the low shot keeps its glide under the Golden Gate. A flick up out of School Zone never waits for the gate, because Cruise lifts nothing.

**Thumb off.** The speed eases to nothing in about 1.5 s: 9.7, 3.6, 1.3 and 0.5 m/s at each half second after the flick over Alamo Square (`s_turbo.ts`). The height holds with a blimp's bob, 0.9 m at 0.2 Hz, and a slow roll and pitch of 3 and 2 degrees out of step with it.

**The stick works as in every gear:**
- Sideways turns on the spot: 353 degrees in 5 s at the full stick, 0 m moved. No tower pushes the yaw, since the bus isn't going anywhere. A tap's breath halves the turn while it breathes, as in every gear: 72 degrees a second, 35.6 breathing.
- Up noses the bus down 14 degrees at the full push and drifts it forward at up to 8 m/s. It sinks too, up to 5 m/s at the full push and much less at a partial one, which is how the bus comes down to the roofs without leaving School Zone. Curb will need that: you dive to street height to land. Over Alamo Square, 16 s of full push went 124 m and never came nearer the roofs than 6.2 m.
- **A wall stops the drift.** A roof ahead that would lift the bus more than 12 m (`config.zone.wall`) is a wall, not a step: the drift eases to a stop 10 m short of it (`wallGap`, the bus's middle to the wall, over about `wallEase` 1.2 s), nose to it, and the floor's look-ahead leaves it out, so a turn on the spot beside a tower doesn't throw the bus up its face either. A pull climbs the wall; from over its top a drift goes on over it. Before, drifting into Salesforce Tower threw the bus 150 m up its face in half a second; now it stops 10 m from the wall and a pull climbs it at 15 m/s (`s_turbo.ts`). Steps under 12 m the floor lifts it over, as at Cruise.
- Down climbs at up to 15 m/s, straight up, nose up 9 degrees. Let go, it coasts to a hold as every climb does: about 9 m from 15 m/s.
- The rooftop floor, the ceiling and a deck overhead hold as everywhere.

**A lone flick down** hovers where the bus was before the stroke's own pull lifted it, so skimming the roofs it hovers at the roofs' height. In School Zone, where a flick down is nothing yet, the stroke's pull goes back the same way: the hover holds where it was. A flick up out of School Zone at the roofs goes back to skimming them at Cruise; from a height it holds that height at Cruise.

**The camera** comes in 30 %, eased at 1.6/s: 159.5 to 108.6 m over Alamo Square. The look-ahead comes in with it, so the bus stands where it always does in the frame.

**Paint balloons.** While the bus hovers under 2.5 m/s, a balloon in the faction's paint rows (`Particles.palette`, the breath's) pops out of the roof hatch with a squeak, one every 1.1 s, up to six. They bunch over the roof on their strings and lag the bus when it turns or drifts. Flicked out of School Zone, each bursts with a pop, 45 ms apart, into spatter of its own colour and the paint hues either side of it (`Particles.burst` spreads six neighbouring hues), so the six together are a rainbow cloud. They're one instanced draw, about 610 triangles for six, made at boot and warmed with the rest (`registerWarm`), and nothing allocates per frame. The squeak and the pop are synthesized (`src/audio/balloonSfx.ts`).

**Tapping** paints as at Cruise: the breath, its aim and its range are untouched, and its range shrinks with speed as it always has. **The stop arm** stays the shield.

### The street camera preview

`?streetcam&lat=&lon=&heading=&skipintro` sets the bus down where those put it, 4 m over the ground, still and standing on the slope, with the lens at street height behind it. The chase lens is 34 m back, 7.5 m up, 34 degrees wide. `?streetcam=wide` is 16 m back, 3.2 m up, 58 degrees. Up a hill the lens never stands under the ground behind it. A drag off the bus still looks round it. Nothing rolls and nothing lands: it's a preview, not Curb.

`tools/streetcam/pick.ts` picks four streets from the cars' own road graph, so any city gets its four the same way. In San Francisco:

| Street | What the data picked | Where (lat, lon, heading) |
|---|---|---|
| A busy arterial | the longest straight flat primary: 534 m, one-way | 37.736181, -122.426973, 227 |
| A residential street | the densest grid of residential streets: 187 m, flat | 37.732412, -122.388112, 305.6 |
| A hill | the steepest sustained grade a car drives: 28 % over 85 m | 37.754863, -122.428367, 85.4 |
| A waterfront road | open water within 70 m all along: 539 m, flat | 37.852117, -122.478968, 180 |

The waterfront the data found is in Sausalito, inside the map: the Embarcadero is cut into short edges at every crossing, and the pick wants 150 m of straight road. The lanes are mostly unmapped in the graph, so the bus stands a lane's width right of the centre line.

## How to try it

On the preview link for `feat/gears`, flying normally: flick down from Cruise for School Zone, wait for the balloons, turn with your thumb sideways, push up to drift and pull down to climb, then flick up and watch them burst.

The street: add `?streetcam&lat=37.754863&lon=-122.428367&heading=85.4&skipintro` to the link (the hill), or any row's place above. `&streetcam=wide` is the other lens, `&t=2026-11-07T00:20:00Z&rate=0` golden hour.

## The checks

- `npx tsc -p tsconfig.main.json --noEmit`: clean at each commit up to e4d0757, and on the fixes' head.
- `tools/controls-sim/s_gesture.ts`: 772 checks pass (770 before the review's fixes; the new row is a flick down in School Zone giving its pull back). New: a flick down at Cruise is School Zone, a flick down in it is nothing, a flick up out is Cruise, two are Express, the gate both ways, one right thumb into it and out, and the hover flown (the settle, the bob, the turn, the drift, the climb, out at the roofs and out at a height). Changed: "a flick down at G0, nothing to drop" is now School Zone, and the keyboard's Q steps on into SCHOOL ZONE.
- `tools/controls-sim/s_turbo.ts`: 37 checks pass, School Zone over the real city among them, and since the review School Zone at Salesforce Tower: the drift stops 10 m from the wall with vy at most 0.1 m/s, a pull climbs it at 15 m/s, a drift from over its top goes 156 m on over it; and the breath's turn, 72 to 35.6 degrees a second. Every result from before the fixes is the same, byte for byte.
- `tools/controls.mjs <url> <out> zone`, on the laptop's GPU, the built page: all 11 verdicts pass. A real flick down is School Zone, 1.08 m/s at 1.5 s and 0.01 at 3 s, the lens 158.9 to 108.6 m, six balloons out, a held right thumb sideways 73 degrees a second at 0 m/s, the drift 7.99 m/s nose down 16 degrees, the climb 14.98 m/s, a flick down in it nothing, a flick up Cruise with the six burst, 26.4 m/s again and the lens back out. 0 WebGL programs were made after the page was ready, balloons and burst included. Since the review the verdict holds the balloons hidden for a few frames and compares: 131 draws hidden, 132 shown, one draw.
- `tools/streetcam/shots.mjs` and `sheet.py`: 16 stills, the four streets at noon and golden hour through both lenses. The bus is 4.0 m over the road in every one, at 68 to 143 draws and 0.34 to 1.11 M triangles.
- `npx vite build` and `node tools/iosfloor.mjs` on the final build: iOS 15.0 parses every chunk.

## What the stills show

From 4 m up the streets are bare: flat grey asphalt from the bus to the next block, no kerbs, lines or crossings, the pavements the same grey as the road, and the houses' fronts the only detail at street height. It's the producer's call whether that's fine, or whether street surfaces come off hold for Curb. A few things the stills show besides:
- The chase lens puts the horizon in the middle of the frame and the bus small in the lower third. The wide lens fills the lower half with the bus's back. Curb's own camera is still to design: these are two places to start from.
- On the hill (28 %, facing up it) the wide lens's foreground is the road's own slope right under the lens.
- At golden hour the sky table reads mostly blue, with the warm band low on the horizon.
- The drop shadow under the bus shows as a dark ellipse on the road behind it.
- The grey disc at the bus's lower left rear, in every street still and over the roofs in the hover, is the exhaust's sputter puff (`main.ts`, `particles.puff` at `bus.exhaustLocal`): flying, the bus leaves each one behind at once; standing still it's born on the bumper and drifts back at 4 m/s. It's the exhaust as it always was, not a fault, but from 16 m behind a still bus it reads as a flat grey disc. Whether a standing bus should puff differently is a look for Curb's camera.

## After the review

The review of e0f1dde..e4d0757 found no blocker and no major. What each finding came to:

1. **The bus jumped up a tower's wall** (minor): it held. The hover had turned tower avoidance off, and the floor's look-ahead found the tower and threw the bus up its face. Fixed: a wall stops the drift (above, "A wall stops the drift").
2. **A held drift always sinks to the roofs** (minor): as designed, and the producer's call (`config.zone.sink`, "What's left"). Not changed.
3. **The first School Zone commit throws on page load alone** (minor): it holds, and history isn't rewritten here: the first account squashes 1fa8ccf with e4d0757 before pushing, or keeps it.
4. **A merge conflict in `src/ui/Hud.ts` with feat/shots** (minor): it doesn't hold today. `git merge-tree` of feat/gears with feat/shots at 4519a4b, and with feat/gardens at ae95923, merges clean.
5. **A flick down in School Zone kept the stroke's pull** (nit): it held, 1.8 m in the sim. Fixed: it gives it back, as at Cruise.
6. **A tap didn't slow the turn on the spot** (nit): it held. Fixed: the breath halves it as in every gear.
7. **The bus banks about 14 degrees spinning on the spot** (nit): taste, not changed. A bus leaning into its spin reads lively at 108 m; the producer may want it flatter (`bankPerYaw` under the hover).
8. **Each balloon doesn't burst in its own colour alone** (nit): the doc was wrong, now it says what `Particles.burst` does.
9. **The `controls.mjs` one-draw verdict compared two frames with balloons up** (nit): it held. Fixed: it hides them and compares.

On the fixes' build, on the laptop's GPU: `controls.mjs … zone` 11 of 11 (the balloons 131 draws hidden, 132 shown); the eight `--det` views with the sky off and at golden hour identical to e0f1dde's, as they should be, since none enters School Zone; the flight over Alamo Square on the real clock with real flicks as before the fixes (the hover 129 draws, 0.853 M triangles, the turn 64.8 degrees a second, the drift 7.99 m/s, the climb 14.98, Jet and back, 0 programs made in flight); and a flight into the downtown towers west of Salesforce Tower: 16 s of the stick up stopped at a wall with the speed 0.23 m/s and vy never over 0.03 m/s (it had leapt at 360 m/s), and 10 s of the stick down climbed its face at 14.98 m/s. `warmcheck.mjs`: 0 programs after the warm-up in three runs. Two of them had frames of 117 to 1,134 ms while blasting, the third none; e0f1dde's build, run between them, had none once and a 167 ms one once, so the laptop is the likelier cause, but it wasn't proven.

The GPU run's grey disc behind the bus is the exhaust's puff ("What the stills show"). Its 2.7 s frame on the flick up, in one of three runs, wasn't seen again after the fixes; its cause is still unknown.

## What's left

- **Curb**: its flight, camera and landing, on the second account's road side (`SHOTS.md`, "Curb"). The street camera preview comes first, so the producer can decide on street surfaces.
- **Whether the gentle climb feels right**, and whether 8 m/s of drift is enough to linger with: only the phone can say. Both are in `config.zone`.
- **The drift sinks.** That reading of "up noses down" is the studio's, so the bus can come down to the street. If the producer wants a level drift, `config.zone.sink` goes to 0, and then the only way down is to flick out.
- **What lingering gives the ladder.** `SHOTS.md` promises a check that a square's four stages can be had in one pass at School Zone's speed. It hasn't been run.
- **Recess.** School Zone is the riskiest gear there, as the plan says. A forced gear from being hit leaves it through `TurboDrive.shift`, which clears it.
- **The balloons in Recess** use the player's own palette, as every breath does. A rival's view of them isn't built.
