# Save point, 2026-11-14

The producer, before the studio's run: "Let's save where we are now so we can revert back if necessary."

Every branch of the repo as it stood on 2026-11-14 at about 14:15 PST has a tag, `save-2026-11-14/<the branch, with / as ->`. Two more hold the first account's work that was on the laptop and not on any pushed branch. 44 tags in all.

| What | Branch | Commit | Tag |
|---|---|---|---|
| The live site | `main` | 058217c | `save-2026-11-14/main` |
| The core (what goes live first) | `feat/core` | 220cce2 | `save-2026-11-14/feat-core` |
| The one link (everything, behind `?show`) | `feat/handling` | f9accb0 | `save-2026-11-14/feat-handling` |
| The frame from high up, parts 1c and 1a | `feat/above` | dac73f6 | `save-2026-11-14/feat-above` |
| The far shots | `feat/shots` | 98fca30 | `save-2026-11-14/feat-shots` |
| The floating block | `feat/factions` | b540848 | `save-2026-11-14/feat-factions` |
| The docs and the rulebook | `feat/earth` | c3d91ba | `save-2026-11-14/feat-earth` |
| Not pushed: the core and three small fixes, one of them at fault | on the laptop | 58f2dda | `save-2026-11-14/wip-core` |
| Not pushed: the one link with the far Comet's view and those three merged in | on the laptop | b761f28 | `save-2026-11-14/wip-handling` |

The second account's branches are saved the same way as they stood (`feat/life`, `feat/recess`, `feat/swerve`, `feat/world`, `feat/moonfree`, `rc/1` and the rest), and so is every older branch.

## Going back

- The live site has not moved: it is `main` at 058217c, as since 2026-11-05.
- To look at a saved state: `git checkout save-2026-11-14/feat-handling`. To fly one: Vercel builds branches, not tags, so make a branch from the tag (`git branch back/handling save-2026-11-14/feat-handling`), push it, and its preview link is the usual one for that branch's name.
- To put a branch back where it was: `git branch -f feat/handling save-2026-11-14/feat-handling` and a forced push. A forced push needs the producer's word, like the live site does.

## Not in the tags

- Paint saved on a phone: it lives in that phone's browser.
- The check suites on the laptop (their rows, notes and kept builds): they stay where they are.
