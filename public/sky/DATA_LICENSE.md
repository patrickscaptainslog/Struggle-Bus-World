# Sky data

Ported byte for byte from `feat/earth`, built there by `tools/sky/bake-space.py` from files already on disk. Changed from the originals: cut down, reclassified, quantised.

| File | Source | Terms |
|---|---|---|
| `moon.bin` | NASA SVS CGI Moon Kit | NASA media terms |
| `stars.bin` | Yale Bright Star Catalogue, 5th revised edition, epoch 2030 | None stated; NASA's record calls it a US Government work |

The albedo in `moon.bin` comes from the LROC mosaics: credit LROC Team, Arizona State University; Wagner et al. 2015.

The street reads `moon.bin` box-filtered to a quarter of its size, and the planets come from JPL's Keplerian elements in `src/sky/series.gen.js` (no file of their own).
