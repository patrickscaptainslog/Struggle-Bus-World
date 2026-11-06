# Shots: what's built

(`feat/shots` has its own copy of this file. Merging the two, keep both: this section is `feat/gardens`'s.)

## The gardens' budget (feat/gardens)

The shots paint more and faster, so the rooftop gardens have a triangle budget first. Before it, 1,146 level-3 roofs in a Recess match drew 4.04 M triangles of gardens alone.

**What it is.** The gardens (`src/world/props/sprouts.ts`) draw at most 450,000 triangles, the view and the sun pass together. That's the floor's 1.5 M less the city's own 0.8-1.0 M. Near the bus they're as rich as before. Each garden is drawn only where the view sees it or its shadow. Past 250-350 m the small growth gives way to a lighter far form. Over the line, every reach is held in a little each frame, the farthest gardens going first. They're let out again as soon as there's room. The design and the numbers are in `docs/specs/gardens/BUDGET.md`.

**How to check it.** Build, serve the build, then:

```bash
node tools/gardens/budget.mjs http://localhost:4179/ shots/tmp/gardens            # exit 0 is a pass
node tools/gardens/budget.mjs http://localhost:4179/ shots/tmp/gardens-lift "--q=&lift"
node tools/gardens/budget.mjs http://localhost:4179/ shots/tmp/gardens-exact --budget=1e9 --flight=0   # exactly what's seen, no hold
```

It paints the 1,200 buildings nearest Alamo Square to level 3, reloads, and holds the bus at the street, at 250 m and at 1 km. It fails when:
- any view's gardens pass 450,000 triangles (`--line`);
- the hold is under 0.9 in a view (`--minhold`), so the line can't be met just by pulling the reaches in;
- a 480-frame flight finds an element missing, a far form too near, or a shadow left out, the shadows of gardens off the screen included;
- the hold doesn't let out again back at the street after that flight;
- one of six snaps of the lens at the street (90, 270, 180 degrees and back, one render each) leaves anything missing;
- the page throws an error.

It needs a real GPU for its milliseconds. Its triangle counts and audits hold anywhere.
