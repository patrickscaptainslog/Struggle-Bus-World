# feat/facade merge QA (local GPU: Intel UHD 620, Edge, iPhone 15 viewport)

Side by side, left = main, right = feat/facade after its review fixes:
`alt-downtown250_main-vs-facade.png` (the vista after a climb to 250 m), `chase-fidi_main-vs-facade.png`,
`regress-grey_main-vs-facade.png` (tools/shots.mjs grey view: the houses are unchanged).

| | main | facade |
|---|---|---|
| mean draws, 18 facade-shots views | 116.7 | 120.3 |
| mean triangles | 0.832M | 0.846M (+1.7%) |
| shimmer at 250 m (tools/seqstat.py, 1/30 s frames, S=3) | 12.89% | 5.13% |
| shimmer, chase FiDi / SoMa / Rincon | 17.6 / 14.8 / 19.6% | 15.4 / 10.8 / 12.1% |
| off-palette pixels (135 PNGs) | – | 0.00% |
| regress grey: draws / triangles | 125 / 1.188M | 126 / 1.203M |

Review: two reviewers (GPU shots A/B, code), then a fixer; all 7 major findings fixed (stone ramp
read brown, Coit Tower doubled, Ferry Building hall without collision, 181 Fremont's spire left behind
by the pop, painted towers' domes/trees missing from the flight grid, the up-high anti-crawl guard off
since fog went off by default, ...). The SF-only tables (icons, hidden footprints, hero props) are
gated to the SF origin. Not fixed (minor): Salesforce's sunshade lines step a pixel at facet seams;
lilac halo dots along its LED crown (the resolve's bloom halo); meshing time +58% in FiDi.
