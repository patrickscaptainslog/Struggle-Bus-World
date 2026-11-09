# The fixes to steps 3 and 4 (feat/decks 492a953 to 042b62e)

The second account, 2026-11-09, for the first account. A re-review of what you changed after [decks-steps34-2026-11-06.md](decks-steps34-2026-11-06.md): the two majors (M1, a city's `"qa"` loosening a check with `NaN`; M2, `deckFreeEnd` excusing any end with a kept way by it), the join of a deck run backwards, the ranges' tolerance, the gate on a check that failed to read, and the report's wording. `tools/bake/qa.py`, `bridges.py`, `osm.py`, `qacheck.py`, `segcheck.py`, read against BRIDGES.md's note on what the review changed.

**Verdict.** No blocker, no major. Both majors hold. One question (m1) and two nits. Ready to merge on my side; the four `qacheck.py` rows I couldn't run here are yours to show on the laptop.

## How it ran

- A worktree of 042b62e, removed after; nothing committed there. No bake: this machine has no extract and no rasterio.
- `python3 tools/bake/qacheck.py` in a scratch environment with shapely 2.2.0 and scipy added: **3 of 7 pass**, the other four stop at `No module named 'rasterio'`. The three: "a city config's "qa" tightens a check, never loosens it", "a tower stands over its deck by its top over the sea" and "two decks joined end to end cover the ground each covered, either one run backwards". `segcheck.py` wasn't run (pyarrow).
- M1 probed directly, `qa.thresholds` on a config read by `json.loads`: `NaN`, `Infinity`, `-Infinity` and `true` are each refused and the default stands (15.0, 3.0, 3, 4.5); a tighter 0.5 and 0.95 are taken.
- `qa.gate_fails` probed: a check that failed to read fails under `fail` and not under `report`; one with nothing to read doesn't; one over its limit does.
- M2 and the rest read at their lines.

## My earlier findings

| Finding | Holds? | Where |
|---|---|---|
| M1, `NaN` loosens any check | Holds: a finite real number only, and never a bool | `qa.py`, `thresholds`; the probe above |
| M2, `deckFreeEnd` excuses an end with a kept way within 12 m | Holds, from the code: only an end another deck or a building takes over, or one off the frame, goes unmeasured; a kept way by it is said in the row ("it should land"), not a pass. Its row in `qacheck.py` needs rasterio | `qa.py`, `bridge_checks`, the `res.append` and the `done` after it |
| A deck joined backwards keeps its edges' sides | Holds: swapped and negated, and its row passes here | `bridges.py`, `_joined` |
| A range end a rounding past 1 | Holds: `RANGE_TOL` 1e-6 | `osm.py`, `off_ground` |
| The ranges read with one rule column missing | Holds: all three or none | `osm.py`, `segments` |
| A check that failed to read passes a failing gate | Holds | `qa.py`, `gate_fails`, used by `run`, `bridge_line` and `bridge_section` |

## A question

**m1. An end far under the ground is never over the limit.** `deckFreeEnd`'s value is the end's top less the ground, and a check is over when that passes 3 m. So an end 29 m under the ground, as the report now says of the Bay Bridge's at Rincon Hill, reads as fine, whether or not a kept way meets it there. That one is right: the real approach comes out of the hill. But where a kept way is within 12 m the row says the end "should land", and landing is both ways. If a buried end is `deckBuried`'s to catch, a line by the check saying so would close it; if not, the measure for an end a way meets could be how far it is from the ground either way.

## Nits

- **n1.** `thresholds` raises `OverflowError` on an integer too large for a float (`math.isfinite(10**400)`), which `json.load` reads from a config as an int. The bake stops, which is safe, but it isn't refused and logged as the others are.
- **n2.** `gate_fails` knows a check failed to read from the first words of its `why` (`startswith('failed to read')`), written in three places (`qa.py:297`, `:333`, `:636`). A reworded message would quietly stop failing the gate; a flag on the record would hold.
