# Sky data (spike/moonrun, not for main as it stands)

Built by `tools/sky/bake-space.py` from files already on disk. Changed from the originals: cut down, reclassified, quantised.

| File | Source | Terms |
|---|---|---|
| `earth.bin` | NASA Blue Marble (class and tone only, never its colours), NASA Black Marble 2016 | NASA credit, no endorsement implied |
| `moon.bin` | NASA SVS CGI Moon Kit | NASA media terms |
| `stars.bin` | Yale Bright Star Catalogue, 5th revised edition, epoch 2030 | None stated; NASA's record calls it a US Government work |
| `lines.bin` | Stellarium `western` sky culture | **CC BY-SA. Share-alike: review before this reaches main** (SKY.md decision 4) |

## The Moon's ground (`public/moon/`, `?moon`)

Built by `tools/moon/bake-moon.py` from files already on disk: cut down and quantised, nothing invented. Everything finer is generated (`src/moon/`).

| File | Source | Terms |
|---|---|---|
| `relief.bin` | NASA Scientific Visualization Studio, CGI Moon Kit, `ldem_4_uint.tif` (LOLA) | NASA media terms: public domain, credit NASA SVS |
| `theophilus.bin` | LRO LOLA gridded topography, 118 m global mosaic, a window over Theophilus; track streaks notched out of its spectrum, lightly smoothed and halved | Public domain. LOLA Science Team; Smith et al. 2010 |
| `places.json` | Gazetteer of Planetary Nomenclature, IAU Working Group for Planetary System Nomenclature / USGS; landing sites from NSSDC and LROC tables | Public domain. Credit IAU WGPSN / USGS |
| `names.json` | The same gazetteer: every other named crater, for its sign | Public domain. Credit IAU WGPSN / USGS |
| the albedo (`moon.bin`, above) | NASA SVS CGI Moon Kit, from the LROC mosaics | Credit LROC Team, Arizona State University; Wagner et al. 2015 |

`tools/sky/line-stars.json`, the crosswalk from the figures' Hipparcos numbers to Yale's, was read out of HYG v4.1 (CC BY-SA): review it with `lines.bin`.
