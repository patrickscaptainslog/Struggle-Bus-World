# The truth of the sky: Sun, Moon, Earth and stars, from a San Francisco street to the surface of the Moon

Research for the live sky. Date 2026-10-31. The repo was read only (branch merge/osm), no tracked file changed, no browser and no GPU were used.

**Labels.**
- **[M] MEASURED:** I ran it. Numbers come from scripts on this machine, usually against real JPL Horizons output.
- **[S] FROM A SOURCE:** an external fact, with its link.
- **[E] ESTIMATE:** my arithmetic or judgement, with the assumption stated.

**Limits on this report.** Timings are Node 24.14 on this laptop's i7-8550U while a browser code review was also running, not an A15. Sizes come from esbuild 0.28.2, not the repo's Vite 8 build. The two PNG sheets are CPU mocks from real geometry, not game frames. Section 11 lists what I could not confirm.

**Reach.** 95 Horizons queries, about 6 MB. The largest single download was HYG at 13.6 MB. Nothing over 50 MB was fetched; I skipped NASA's 33-35 MB 4K EXR Milky Way files because a 71 KB preview was enough for a 256 x 128 map. Packages were installed with `--ignore-scripts`, each in its own directory.

**Files.** Scripts: `C:/Users/Utku/AppData/Local/Temp/claude/C--Users-Utku/2b4f6d6c-a71c-4f2a-a777-802be224f995/scratchpad/sky-scripts/` (the tested model is `sky-proto.mjs`). Data: the sibling `sky/` directory. Sheets: `shots/local/sky/astro-moon-sheet.png`, `shots/local/sky/astro-earth-sheet.png`.

---

## 0. Bottom line

1. **Ship a trimmed copy of astronomy-engine, not the package and not suncalc.** Series, IAU Moon axis, JPL planets and the sky model together are 24.3 KB minified, **10.7 KB gzip, 9.1 KB brotli** [M]. That is 3.0 % of the 352 KB main script, or 0.36 s at 30 KB/s [E]. I built that file, imported the built output and scored it against Horizons: Sun 0.0006°, Moon 0.0011° from Earth sites, Sun and Earth 0.0031° from the Moon, phase within 0.003 of a percentage point [M]. Those errors are under 0.06 game px on either lens.
2. **`RotationAxis` works for the Moon.** It has a `Body.Moon` case with the full IAU series, and it lands within 254 m of Horizons' sub-Earth point and 115 m of its sub-solar point over four years [M].
3. **One model holds from street to Moon.** Tested against Horizons at street level, 400 km, 39,000 km above Earth, 100 km and 39,000 km above the Moon, and on the Moon's surface: worst error 0.0031° [M]. Series run once a minute, off the frame path. The frame itself costs about 1 µs and allocates nothing of note [M].
4. **Phase, crescent tilt, libration and eclipses need no special code.** Light a sphere with a real sun vector and rotate its map by the body's real axes. The bright-limb tilt then matches Horizons within 0.01° at SF, Tokyo and McMurdo [M]. The textbook geocentric phase is more than 300 times further off than the sphere (0.74 against 0.002 points) [M].
5. **Eclipses come true.** All 20 solar and lunar eclipses in NASA's tables from now through 2030 were found, with matching kinds, within 3 s (solar) and 6 s (lunar) [M]. The sky model's own vectors give NASA's umbral magnitudes within 0.006 [M].
6. **Use the Yale catalogue. Do not use Gaia for bright stars.** A G < 7 query of Gaia DR3 has no match for 145 of the 904 stars brighter than V 4.5, including Sirius, Canopus, Betelgeuse, Aldebaran and Polaris [M]. Its licence page also says non-commercial [S].
7. **The normal camera sees very few stars.** Median at street level: 8 stars at V 5.5, 25 at V 6.5. With real extinction near the horizon the median is 1 [M]. Star positions can be exact; star counts must be a style decision (`research-render.md` §4.4 reaches the same place). Constellations belong to a look-up view.
8. **Most of the data is very small.** Moon map 1.4-5 KB, Milky Way 1.8 KB, line figures 1.9 KB, Earth for the Moon trip 1.9 KB [M]. Only the full star table is large, at 31 KB, and it can load at dusk (§9).

---

## 1. Ephemeris

**Candidates.** astronomy-engine 2.1.19 (MIT) [M]. suncalc 2.1.1 (BSD-style licence file) [M]; this version moved to Meeus ch. 25 and ch. 47 and is not the old low-precision suncalc. A hand port I wrote: Meeus Sun, Meeus Moon truncated to the strongest terms, sidereal time, precession and the IAU Moon axis. Also a trimmed astronomy-engine: a script removes every VSOP table except Earth's and exports the internals, and the entry point calls only what the sky needs.

### Size [M]

esbuild 0.28.2, `--bundle --minify --format=esm --tree-shaking`, target es2022. gzip -9, brotli 11. Bytes.

| Bundle | Min | Gzip | Brotli | Share of 352 KB |
|---|---:|---:|---:|---:|
| astronomy-engine, whole | 105,515 | 43,050 | 36,216 | 12.2 % |
| Only `GeoMoon, GeoVector, RotationAxis, SiderealTime, MakeTime` | 50,577 | 22,028 | 18,593 | 6.3 % |
| + `Observer, ObserverVector, Rotation_EQJ_HOR, Rotation_EQJ_EQD, Horizon, Equator` | 54,937 | 23,580 | 19,879 | 6.7 % |
| + `Illumination, Libration, MoonPhase` | 59,529 | 25,368 | 21,464 | 7.2 % |
| + `SearchRiseSet, SearchAltitude` | 63,351 | 26,925 | 22,805 | 7.6 % |
| + all eclipse searches | 69,025 | 28,997 | 24,636 | 8.2 % |
| **Trimmed:** Moon series, Earth VSOP, time, sidereal, IAU Moon axis | 16,814 | 7,749 | 6,772 | 2.2 % |
| Trimmed + Mercury to Saturn VSOP | 29,773 | 12,930 | 11,079 | 3.7 % |
| **Shipping candidate:** trimmed + JPL planets + sky model + precession rotation | **24,337** | **10,665** | **9,122** | **3.0 %** |
| suncalc: position, Moon, illumination | 5,400 | 2,607 | 2,354 | 0.7 % |
| suncalc: all | 7,786 | 3,771 | 3,378 | 1.1 % |
| Hand port, Moon 14 + 7 terms | 4,106 | 2,155 | 1,900 | 0.6 % |
| Hand port, Moon 30 + 15 terms | 4,545 | 2,347 | 2,081 | 0.7 % |
| Hand port, Moon 60 + 60 terms | 5,698 | 2,775 | 2,465 | 0.8 % |
| JPL planets add-on alone | 1,326 | 814 | 738 | 0.2 % |
| Sky model frame code alone | 4,530 | 1,712 | 1,463 | 0.5 % |

Tree-shaking stops at 22 KB because `GeoVector` reaches every planet's VSOP table through one object, plus the Pluto integrator [M: read `esm/astronomy.js`]. That is why a trimmed copy saves 14 KB. The 352 KB is the brief's figure; there is no `dist/` in `sbw-main` to re-measure it.

### Speed and allocation [M]

Median of 7 rounds, warmed up, this laptop. AE is astronomy-engine. Allocation is heap growth per call with GC idle, so tiny values are noise.

| Call | µs | Bytes per call |
|---|---:|---:|
| AE `MakeTime` | 0.25 | 357 |
| AE `GeoMoon` | 25.4 | 1,302 |
| AE `GeoVector(Sun, aberration)` | 25.0 | 660 |
| AE `GeoVector(Jupiter, aberration)` | 70.0 | 93 |
| AE `RotationAxis(Moon)` | 2.8 | 689 |
| AE `SiderealTime` | 1.9 | 1,111 |
| AE `Equator` + `Horizon`, Sun, topocentric | 61.6 | 1,527 |
| AE `Equator` + `Horizon`, Moon, topocentric | 37.2 | 1,272 |
| AE `Illumination(Moon)` | 32.3 | 4,098 |
| AE `Libration` | 34.9 | 1,086 |
| AE `SearchRiseSet(Sun)` / `(Moon)` | 405 / 629 | 35 K / 56 K |
| AE `SearchLunarEclipse` / `SearchGlobalSolarEclipse` | 5,506 / 3,955 | 410 K / 48 K |
| suncalc `getPosition` / `getMoonPosition` | 1.4 / 15.7 | 256 / 312 |
| suncalc `getMoonIllumination` | 16.4 | 408 |
| suncalc `getTimes` / `getMoonTimes` | 18.7 / 309 | 1.5 K / 6.6 K |
| Hand port, Sun + Moon az/el, 60 + 60 terms | 11.1 | 83 |
| Hand port, Sun + Moon az/el, 30 + 15 terms | 4.5 | 80 |
| **Sky model `frame()`, no series call** | **1.03** | **6** |
| Sky model window slide (full AE, both window ends) | 158, p99 1,495 | not measured |

Fresh trimmed module: 15 ms to import, 3.3 ms for the first `GeoMoon`, 0.4 ms for the first Earth VSOP [M]. A15 single-thread speed is likely at or above this 2017 laptop [E, not run].

### The call

| Option | Gzip | Moon max | Sun max | Eclipse timing | What it lacks |
|---|---:|---:|---:|---:|---|
| Package, tree-shaken | 22.0 KB | 0.0008° | 0.0006° | 1-4 s | 14 KB more for planets it can replace with 0.8 KB |
| **Trimmed copy** | **7.7 KB** | **0.0008°** | **0.0006°** | **1-4 s** | A vendored file to regenerate on upgrade |
| Hand port 60 + 60 | 2.8 KB | 0.0030° | 0.0036° | 25-57 s | Eclipse contact times are a minute off in a 4 minute event |
| suncalc | 2.6 KB | 0.0144° | 0.0085° | not tested | Azimuth and altitude only. No vectors, no observer off the ground, no Moon axes |

All [M], details in §2 and §8. Moon column: the four-year test, except suncalc, which is the four-date topocentric test because its coordinates are private. Sun column: the four-date test.

**Decision.** Vendor the trimmed copy, generated by a script from the npm package, with the MIT notice kept. Keep full `astronomy-engine` as a dev dependency for tests and for baking the eclipse table. The 4.9 KB difference over the hand port is 0.16 s at 30 KB/s [E], and it buys eclipses timed to seconds rather than a minute. If every byte counts, the hand port is a real fallback: its worst error on screen is 0.06 px. Do not call `SearchRiseSet` or the eclipse searches at runtime. A next-sunset sign can scan the model's elevation in steps. Eclipses are a baked table.

**Delta T.** astronomy-engine's stock model gives 75.56 s today; Horizons has 69.18 s (TDB-UT) [M]. Set `SetDeltaTFunction(() => 69.2)`. It moves the mean Moon error from 0.0007° to 0.0005° [M]. A constant is fine: Horizons holds 69.18 through 2030 because it has no later prediction [M].

---

## 2. Accuracy against JPL Horizons

**Method.** Horizons tables at 5-minute steps for one UT day on each of four dates: today, the December solstice, the June solstice and an equinox 3.4 years out. Sites: San Francisco, Tokyo, McMurdo, Tranquility Base (Apollo 11), Mare Smythii on the Moon's east limb, and a site 0.5° from the Moon's south pole for rise and set. 6,936 Earth-site rows. Airless apparent azimuth and elevation. Suncalc's refraction was inverted before comparing. Horizons used DE441, EOP-corrected UT1 and the MOON_ME frame [M: table headers].

Lens scale: 16.375 px per degree at 24°, 10.34 px per degree at 38° [E].

### Earth sites, all dates [M]

Error is the great-circle angle between predicted and Horizons directions.

| Engine | Sun deg mean / p95 / max | Moon deg mean / p95 / max | Sun max px @24 / @38 | Moon max px @24 / @38 | Moon fraction error, points, mean / max |
|---|---|---|---:|---:|---|
| astronomy-engine, stock Delta T | 0.0004 / 0.0006 / 0.0006 | 0.0007 / 0.0011 / 0.0012 | 0.01 / 0.01 | 0.02 / 0.01 | 0.19 / 0.74 |
| astronomy-engine, Delta T 69.18 s | 0.0004 / 0.0006 / 0.0006 | 0.0005 / 0.0010 / 0.0011 | 0.01 / 0.01 | 0.02 / 0.01 | 0.19 / 0.74 |
| suncalc 2.1.1 | 0.0053 / 0.0080 / 0.0085 | 0.0071 / 0.0118 / 0.0144 | 0.14 / 0.09 | 0.24 / 0.15 | 0.19 / 0.73 |
| Hand port, Moon 14 + 7 | 0.0021 / 0.0035 / 0.0036 | 0.0135 / 0.0205 / 0.0225 | 0.06 / 0.04 | 0.37 / 0.23 | 0.19 / 0.73 |
| Hand port, Moon 30 + 15 | same Sun | 0.0050 / 0.0059 / 0.0060 | 0.06 / 0.04 | 0.10 / 0.06 | 0.19 / 0.73 |
| Hand port, Moon 60 + 60 | same Sun | 0.0006 / 0.0011 / 0.0011 | 0.06 / 0.04 | 0.02 / 0.01 | 0.19 / 0.73 |
| **Sky model, 60 s step** | **0.0004 / 0.0006 / 0.0006** | **0.0005 / 0.0010 / 0.0011** | **0.01 / 0.01** | **0.02 / 0.01** | **0.002 / 0.002** |

The sky model row used the full package as its series. The built trimmed bundle gave the same maxima: 0.0006°, 0.0011°, 0.002 points [M].

By axis, worst case, azimuth scaled by cos(elevation): sky model Sun 0.0006° az, 0.0006° el, Moon 0.0011° az, 0.0008° el. suncalc Sun 0.0067°, 0.0081°, Moon 0.0066°, 0.0144°. Hand port Sun 0.0036°, 0.0028°, Moon 0.0011°, 0.0011° [M].

The fraction column matters. Every library's "illumination" is geocentric, so it is up to 0.74 points off what an observer sees. The sphere lit from true topocentric vectors is 0.002 points off [M].

### By site and date, sky model [M]

| Site | Date | Moon lit % | Sun max deg | Moon max deg | Moon px @24 | Moon px @38 |
|---|---|---:|---:|---:|---:|---:|
| San Francisco | 2026-10-31 | 65 | 0.0006 | 0.0005 | 0.009 | 0.006 |
| San Francisco | 2026-12-21 | 90 | 0.0006 | 0.0006 | 0.011 | 0.007 |
| San Francisco | 2027-06-21 | 95 | 0.0006 | 0.0011 | 0.017 | 0.011 |
| San Francisco | 2030-03-20 | 99 | 0.0006 | 0.0009 | 0.014 | 0.009 |
| Tokyo | 2026-10-31 | 65 | 0.0006 | 0.0006 | 0.009 | 0.006 |
| Tokyo | 2026-12-21 | 90 | 0.0006 | 0.0006 | 0.010 | 0.006 |
| Tokyo | 2027-06-21 | 94 | 0.0006 | 0.0010 | 0.017 | 0.010 |
| Tokyo | 2030-03-20 | 99 | 0.0006 | 0.0008 | 0.014 | 0.009 |
| McMurdo | 2026-10-31 | 65 | 0.0002 | 0.0002 | 0.003 | 0.002 |
| McMurdo | 2026-12-21 | 90 | 0.0002 | 0.0002 | 0.002 | 0.002 |
| McMurdo | 2027-06-21 | 94 | 0.0002 | 0.0006 | 0.009 | 0.006 |
| McMurdo | 2030-03-20 | 99 | 0.0003 | 0.0003 | 0.006 | 0.003 |

### The Moon's position over four years [M]

Geocentric, true-of-date, 1,107 samples at 33 h steps from 2026-11 to 2031-01, against Horizons. This is the broader test: four single days can flatter a series.

| Moon terms | Mean deg | p95 | Max | Max px @24 | Range error km, max |
|---|---:|---:|---:|---:|---:|
| Hand 6 + 3 | 0.1465 | 0.2970 | 0.4601 | 7.53 | 1,124 |
| Hand 10 + 5 | 0.0605 | 0.1107 | 0.2011 | 3.29 | 505 |
| Hand 14 + 7 | 0.0234 | 0.0463 | 0.0874 | 1.43 | 308 |
| Hand 20 + 10 | 0.0118 | 0.0244 | 0.0516 | 0.84 | 166 |
| Hand 30 + 15 | 0.0054 | 0.0119 | 0.0250 | 0.41 | 75 |
| Hand 40 + 20 | 0.0033 | 0.0072 | 0.0158 | 0.26 | 61 |
| Hand 60 + 30 | 0.0014 | 0.0030 | 0.0065 | 0.11 | 45 |
| Hand 60 + 60 | 0.0007 | 0.0015 | 0.0030 | 0.05 | 45 |
| **astronomy-engine `GeoMoon`** | **0.0002** | **0.0005** | **0.0008** | **0.01** | **15 (3D)** |

`GeoVector(Sun)` against Horizons: 0.0004° max, 1,221 km [M]. The project [claims ±1 arcminute](https://github.com/cosinekitty/astronomy) [S]; for these two bodies it is more than ten times better [M].

### The Moon's surface [M]

Model with `RotationAxis` axes against Horizons (MEAN_ME frame, sphere of 1,737.4 km), 5-minute tables.

| Site | Date | Earth lit % | Sun az / el / sep, deg | Earth az / el / sep, deg | Earth fraction error, points |
|---|---|---:|---|---|---:|
| Apollo 11 | 2026-10-31 | 35 | 0.0008 / 0.0028 / 0.0029 | 0.0014 / 0.0027 / 0.0030 | 0.002 |
| Apollo 11 | 2026-12-21 | 10 | 0.0014 / 0.0016 / 0.0016 | 0.0011 / 0.0004 / 0.0012 | 0.003 |
| Apollo 11 | 2027-06-21 | 5 | 0.0009 / 0.0017 / 0.0019 | 0.0011 / 0.0011 / 0.0016 | 0.002 |
| Apollo 11 | 2030-03-20 | 1 | 0.0004 / 0.0009 / 0.0010 | 0.0005 / 0.0016 / 0.0017 | 0.002 |
| Mare Smythii | 2026-10-31 | 35 | 0.0005 / 0.0029 / 0.0029 | 0.0007 / 0.0029 / 0.0029 | 0.002 |
| Mare Smythii | 2026-12-21 | 10 | 0.0014 / 0.0006 / 0.0016 | 0.0009 / 0.0007 / 0.0012 | 0.003 |
| Mare Smythii | 2027-06-21 | 5 | 0.0009 / 0.0017 / 0.0019 | 0.0011 / 0.0011 / 0.0016 | 0.002 |
| Mare Smythii | 2030-03-20 | 1 | 0.0004 / 0.0009 / 0.0010 | 0.0002 / 0.0016 / 0.0017 | 0.002 |

Worst case 0.0030°, or 0.05 px at 24° and 0.03 px at 38° [M]; the built bundle gave 0.0031° [M]. Most of this is probably the gap between the IAU Moon frame and the Mean Earth frame the data uses [E]. It needs no fix.

Range to Earth differs from Horizons by 25-45 km. That is Horizons' light-time convention (Earth moves about 38 km in its orbit during the 1.3 s of light travel) and not an error [E].

### Rise and set [M]

**Truth.** Horizons airless elevation, interpolated to the standard altitude: upper limb with 34′ of refraction, the same definition astronomy-engine uses. 35 events. McMurdo has no sunrise on three of the four dates: polar day or polar night.

| Seconds, mean / max | astronomy-engine | suncalc | Hand 60 + 60 | Sky model |
|---|---:|---:|---:|---:|
| Sun, 18 events | 0.2 / 0.4 | 1.4 / 3.9 | 1.1 / 2.9 | 0.2 / 0.4 |
| Moon, 17 events | 0.2 / 0.5 | 2.3 / 4.2 | 5.6 / 18.9 | 0.2 / 0.5 |

Horizons' own true-visual-horizon list disagrees with that truth by up to 141 s, mean 63 s, because it uses its own horizon model at a one-minute search step [M]. So convention, not ephemeris, is the error here. Real refraction varies by more than any row above [E].

**On the Moon**, hourly tables over 62 days, linear crossing, upper limb against a smooth sphere's horizon:
- Apollo 11, Sun: within 0.3 min on 4 events. Earth never sets: 58-74° up [M].
- Mare Smythii, Sun: within 0.3 min. Earth rises and sets there, -5.6° to 9.7°: within 1.8 min on 4 events [M].
- 0.5° from the south pole: Sun stays at 0.8-2.0° in this window with no events. Earth rises and sets, -6.3° to 6.9°: within 1.5 min on 5 events [M].
- Those minutes are small angles: Earth barely moves in the lunar sky.

### Off the surface [M]

Horizons refuses sites 40,000 km or more from a body, so the farthest real tests are at 39,000 km.

| Observer | Target | Mean deg | Max deg |
|---|---|---:|---:|
| 400 km above SF | Sun / Moon | 0.0006 / 0.0004 | 0.0007 / 0.0005 |
| 39,000 km above SF | Sun / Moon | 0.0007 / 0.0005 | 0.0011 / 0.0010 |
| 100 km above Apollo 11 | Sun / Earth | 0.0019 / 0.0017 | 0.0020 / 0.0018 |
| 39,000 km above Apollo 11 | Sun / Earth | 0.0019 / 0.0020 | 0.0020 / 0.0021 |

Midway between Earth and Moon is not directly tested. The model only subtracts two vectors there, so I expect the same size of error [E].

**What these errors mean.** Every candidate with 20 or more Moon terms stays under a pixel, so accuracy on screen does not pick the winner. Eclipse timing, vectors for any observer, and one code path from street to Moon do.

---

## 3. The Moon's orientation

### `RotationAxis` works

`RotationAxis(Body.Moon, t)` implements the IAU series with 13 terms E1-E13 and returns pole right ascension, declination and spin W (`esm/astronomy.js:9036`) [M]. research-polar-lunar §5.3's open question is closed.

Against Horizons MOON_ME from the geocentre, 1,107 samples, 2026-2031 [M]:

| Quantity | Mean error | Max error | On the surface |
|---|---:|---:|---:|
| Sub-Earth point, great circle | 0.0041° | 0.0084° | 254 m |
| Sub-solar point, great circle | 0.0016° | 0.0038° | 115 m |
| Lunar pole position angle | 0.0010° | 0.0027° | |
| Sub-solar position angle | 0.0026° | 0.0126° | |
| `Libration()` latitude | 0.0230° | 0.0274° | a steady bias |
| `Libration()` longitude | 0.0037° | 0.0078° | |

Use `RotationAxis`, not `Libration()`. It takes 2.8 µs [M], and the Moon case copies out as one short function (`moonAxis` in `hand.mjs`) [M].

### How to get each thing

All from one matrix, Moon fixed ← J2000:

```
F = Rz(W) · Rx(90° − δ0) · Rz(α0 + 90°)        W, α0, δ0 from RotationAxis
subEarth = F · (−moonEqj)                      lat = asin(z/|v|), lon = atan2(y, x)
subSolar = F · (sunEqj − moonEqj)
libration = subEarth itself                    2026-2031: lon ±8.04°, lat ±6.84°, geocentric [M]
```

Topocentric libration comes from using the observer's position in place of Earth's centre.

### Bright limb and terminator at any latitude

The textbook route: bright-limb position angle χ from Meeus 48.5, parallactic angle q, tilt = χ − q. **The game should not do this.** Light a sphere instead:

```
d = unit(moon − observer), s = unit(sun − moon), both in the render frame
disc pixel (x, y), z = sqrt(1 − x² − y²)
n = x·right + y·up − z·d        lit where dot(n, s) > 0
map lookup = transpose(moonRot) · n
```

Nothing there knows about latitude or hemisphere. Tilt was compared with Horizons' `SN.ang` minus the parallactic angle, 1,156 rows at each of three sites with the Moon below 80° [M]:

| Site | Mean error | Max error |
|---|---:|---:|
| San Francisco | 0.003° | 0.008° |
| Tokyo | 0.003° | 0.009° |
| McMurdo | 0.002° | 0.010° |

The same three-day crescent, same night, 2026-11-11/12, from real vectors [M]. Angle is where the lit limb points, clockwise from the local zenith, as the viewer sees it:

| Site | UT | Moon alt, az | Sun alt | Lit | Lit limb at | Reads as |
|---|---|---|---:|---:|---:|---|
| San Francisco | 11-12 01:30 | 7.5°, 225° | -6.3° | 7.1 % | 117° | Lower right |
| Tokyo | 11-12 08:05 | 10.4°, 223° | -6.4° | 8.5 % | 119° | Lower right |
| Quito | 11-11 23:20 | 21.5°, 240° | -5.4° | 6.5 % | 155° | Nearly a smile |
| Cape Town | 11-11 17:50 | 20.3°, 250° | -6.0° | 5.5 % | 194° | Bottom, just left |
| Sydney | 11-12 09:00 | 26.4°, 253° | -6.1° | 8.5 % | 198° | Bottom left |
| McMurdo | 11-11 12:35 | 15.3°, 204° | +5.3° | 4.7 % | 249° | Left, by day |

`astro-moon-sheet.png` draws these from the same vectors. Near the zenith "up" stops being defined. The camera's own up vector replaces it, and the sphere is unaffected.

A geocentric Moon would also sit visibly wrong: its parallax is up to about 1°, 16 px at 24° [E]. Subtracting the observer's position handles that with no extra code.

---

## 4. One sky model

### Frames

| Frame | Use | Held as |
|---|---|---|
| **EQJ** | J2000 mean equator, km, origin Earth's centre. Bodies and stars live here | Float64 |
| **Fixed** | Rotates with the body: ITRF-like for Earth, IAU for the Moon. Observer truth lives here | Float64 |
| **Render** | +X east, +Y up, +Z south today. A rotation only, supplied by WorldFrame | Float64, uploaded as float32 |

Stars need no special frame: `render ← EQJ` turns them from any body, and already includes precession (0.37° since J2000, 6.1 px at 24° [E]).

### Sketch

This is the tested prototype with one change: axes come in from WorldFrame instead of being built from lat/lon, so poles, city frames and free flight need no code here. The prototype's lat/lon version is what the numbers above measured.

```ts
// src/game/sky/SkyModel.ts: pure TS, no three.js, doubles, nothing allocates after construction.
export const enum BodyId { Earth, Moon }

export interface Series {                        // the only code that touches an ephemeris
  moonEqj(ms: number, o: Float64Array): void;    // km, geocentric
  sunEqj(ms: number, o: Float64Array): void;     // km, apparent: -Earth(t - light time)
  earthFix(ms: number, o: Float64Array): void;   // mat3 fixed <- EQJ: Rz(GAST) * nutation * precession
  moonAxis(ms: number, o: Float64Array): void;   // IAU alpha0, delta0, W, degrees
}

export interface Observer {
  body: BodyId;                // whose frame pos and axes are in
  free: boolean;               // false: fixed frame. true: EQJ, from that body's centre (open-space flight)
  pos: Float64Array;           // km, float64 truth from WorldFrame
  axes: Float64Array;          // mat3 by rows: render X, Y, Z in that frame, from WorldFrame or flight attitude
}

export class SkyState {        // overwritten in place, read by the uniform uploader
  sun = v3(); moon = v3(); earth = v3();   // unit vectors, render frame
  sunKm = 0; moonKm = 0; earthKm = 0;
  sunR = 0; moonR = 0; earthR = 0;         // angular radius, radians
  starRot = m3();                          // render <- EQJ
  moonRot = m3(); earthRot = m3();         // render <- body fixed, for map lookups
  moonLit = 0; earthLit = 0;               // illuminated fraction seen from here
  sunSeen = 1;                             // 0..1 after Moon and Earth cover it
  shadow = new Float64Array(3);            // at the Moon: axis offset, umbra radius, penumbra radius, km
}

export class SkyModel {
  constructor(private series: Series, stepS = 60) { /* preallocate two windows of Float64Array */ }

  frame(ms: number, ob: Observer, s: SkyState): void {
    if (!(ms >= this.t0 && ms < this.t1)) this.advance(ms);     // series run here, once per step
    const u = (ms - this.t0) / this.stepMs;
    lerp3(this.m0, this.m1, u, this.moon);                      // km, EQJ
    lerp3(this.s0, this.s1, u, this.sun);
    spinLerp(this.e0, this.e1, u, this.earthFix);               // interpolate the spin angle, never matrix elements
    moonFixFrom(this.a0, this.a1, u, this.moonFix);             // Rz(W) Rx(90 - d0) Rz(a0 + 90)

    const fix = ob.body === BodyId.Earth ? this.earthFix : this.moonFix;
    if (ob.free) { copy3(ob.pos, this.obs); copy9(ob.axes, s.starRot); }
    else { tmul3(fix, ob.pos, this.obs); mul33(ob.axes, fix, s.starRot); }
    if (ob.body === BodyId.Moon) add3(this.obs, this.moon);

    s.sunKm   = toward(this.sun,  this.obs, s.starRot, s.sun);  // subtract in EQJ, normalise, rotate
    s.moonKm  = toward(this.moon, this.obs, s.starRot, s.moon);
    s.earthKm = toward(ZERO,      this.obs, s.starRot, s.earth);
    s.sunR = asin(R_SUN / s.sunKm); s.moonR = safeAsin(R_MOON / s.moonKm); s.earthR = safeAsin(R_EARTH / s.earthKm);

    s.moonLit  = lit(this.moon, this.obs, this.sun);            // (1 + cos angle at the body) / 2
    s.earthLit = lit(ZERO,      this.obs, this.sun);
    s.sunSeen  = 1 - max(cover(s.sun, s.sunR, s.moon, s.moonR), cover(s.sun, s.sunR, s.earth, s.earthR));
    mulT33(s.starRot, this.moonFix, s.moonRot);
    mulT33(s.starRot, this.earthFix, s.earthRot);
    shadowAtMoon(this.sun, this.moon, s.shadow);                // R_shadow = 6459 km, see below
  }
}

// Handover from Earth to Moon: same point in space, new home. Nothing on screen changes.
export function rebaseBody(ob: Observer, to: BodyId, m: SkyModel): void { /* EQJ -> new origin -> new fixed */ }
```

Series for the trimmed copy is 10 lines: `GeoMoon`; `-CalcVsop(vsop.Earth, t - tau)` for the Sun; `Rotation_EQJ_EQD` spun by `SiderealTime`; and the Moon axis. Those are exactly what the built bundle ran [M: `final-bundle.mjs`]. `-Earth(t - tau)` matched `GeoVector(Sun, aberration)` to 0.0000000° over 2,000 instants and trimmed `GeoMoon` matched the full one to 0.000000 m [M].

### Update rate and interpolation [M]

Model with step S against fresh evaluation at each instant, 400 instants over two months, linear interpolation:

| Step | Sun from SF, max deg | Moon from SF, max deg | Earth from Apollo 11, max deg | Moon position km |
|---:|---:|---:|---:|---:|
| 1 s | 5e-10 | 5e-10 | 8e-11 | 0.000 |
| **60 s** | **1e-8** | **1e-8** | **2e-9** | **0.001** |
| 10 min | 1e-7 | 5e-7 | 2e-7 | 0.14 |
| 1 h | 8e-7 | 2e-5 | 7e-6 | 5.0 |
| 6 h | 4e-6 | 7e-4 | 4e-4 | 181 |

400 km up gives the same numbers as the street, and 100 km above the Moon the same as its surface [M].

**Use 60 s of sim time.** The window slide is 158 µs on full astronomy-engine once a minute, or once a second if a test scrubs at 60 times speed. `frame()` runs every render frame because it costs 1 µs and the observer moves: at G3 the sky turns 0.27° per second, 4.4 px per second at 24° [E], so it cannot be ticked.

Shadows are a separate choice. `research-render.md` §2.4 ticks `uSunDir` for the shadow pass on its own cadence; the model always holds the exact value.

`research-render.md` estimates "≤ 2 Hz" outside the frame path for astronomy-engine. Once a minute is enough [M]. Frame cost on an A15 is not measured, but 1 µs is far from the frame budget on any plausible phone [E].

### Plugging into WORLD-TRAVEL's render frame

- **Floating origin.** The sky never sees it. Stars and bodies are directions, and the Sun and Moon need the observer only as true float64 position. The origin rebases of §1.2 don't touch the model.
- **Grid convergence.** WorldFrame hands over `axes` with convergence already in them. The sign, for a city's local tmerc: east of the central meridian in the north, true north lies west of grid north by γ = Δλ sin φ [E, from geometry, not run through PROJ]. At 20 km east of SF's origin that is 0.14°, 2.3 px at 24°; at 60°N it is 0.31°, 5 px [E]. So it has to be applied, and it is one matrix.
- **VERDICT's frame change.** Tmerc per city plus a cube-sphere grid needs no change here: the model only wants `axes`. Polar sites work the same way, because `axes` needs no lat/lon (research-polar-lunar §2.6). Tested on Earth only with lat/lon at McMurdo, and on the Moon at 0.5° from the pole.
- **Curve chunk.** Sunset is decided by the sky pixel against scene depth, so `R_eff` exaggeration needs no correction in the model [E].
- **Refraction.** The model returns airless directions. On Earth below about 20 km, lift Sun, Moon and stars by a horizon formula, scaled by air density. It is 34′ at the horizon, 9 px at 24° [E], and it also flattens a setting Sun into an oval, which is real and free. `research-render.md` §4.4 covers the Sun; apply the same to the Moon.
- **Clock.** Use `Date.now()` plus a server offset, because a shared world needs one sky and phone clocks drift. Keep a `?t=` override for test shots. UT1 minus UTC is ignored: under 0.9 s, 0.06 px [E].
- **Precision.** Directions and matrices go to the GPU as float32. A unit vector's ulp is about 5e-6° [E]. Pass angular radius too. `research-render.md` §4.3 has the shader side.

### Flight

- **Frames in flight.** Near a body, keep `free = false` in that body's fixed frame. In open space set `free = true` and integrate in EQJ, so Earth's spin doesn't whirl the path. Hand over between bodies with `rebaseBody`. The Moon's Hill sphere, about 60,000 km, is a natural point [E].
- **Targeting.** The real Moon moves 307 km during a 300 s flight, about 0.05° [E]. Aim at its predicted position.
- **Up.** Off the surface, up comes from flight attitude, so `axes` comes from the flight code.
- **Budget.** Sizes along the way are in §7.

### Atmosphere per body [E]

| Body or state | Second light | Stars | Twinkle |
|---|---|---|---|
| Earth, below about 30 km | Moonlight, follows `moonLit` | Fade by Sun depression and air | Yes |
| Earth orbit | Moonlight and limb only | All, day and night, unless Earth or Sun fills the view | None |
| Moon | Earthshine, follows Earth's phase, zero on the far side | All, always | None |

### Acceptance fixtures

From Horizons, airless, for a test the sky build can assert [M]:

| UTC | Observer | Target | Azimuth | Elevation | Lit % |
|---|---|---|---:|---:|---:|
| 2026-10-31 12:00:00 | SF 37.7749, -122.4194, 16 m | Moon | 130.7033 | 71.4653 | 65.099 |
| 2027-06-21 12:00:00 | Tokyo 35.6762, 139.6503, 40 m | Moon | 119.2072 | 1.1213 | 94.274 |
| 2026-12-21 12:00:00 | McMurdo -77.8463, 166.6682, 10 m | Sun | 192.0197 | 11.5635 | |
| 2026-10-31 12:00:00 | Apollo 11 0.67416, 23.47314 | Earth | 256.9817 | 69.3854 | 34.741 |
| 2026-10-31 12:00:00 | Apollo 11 | Sun | 268.5730 | -2.2763 | |

Pass at 0.005° or 0.05 points [E].

---

## 5. Stars

### Catalogues

Packed as: declination delta varint, RA u16 (0.0055°, 0.09 px at 24°), one byte for magnitude (5 bits, 0.26 mag) and colour class (3 bits), sorted by declination, 4 bytes a star before compression [M].

| Catalogue | V 4.5 | V 5 | V 5.5 | V 6 | V 6.5 | Licence |
|---|---:|---:|---:|---:|---:|---|
| **Yale BSC5** stars | 904 | 1,630 | 2,887 | 5,080 | 8,404 | None stated, see below |
| gzip / brotli bytes | 3,718 / 3,527 | 6,501 / 6,015 | 11,302 / 10,286 | 18,925 / 17,499 | 30,645 / 28,153 | |
| **HYG v4.1** stars | 925 | 1,637 | 2,865 | 5,070 | 8,920 | CC BY-SA 4.0 [M: repo LICENSE] |
| gzip / brotli bytes | 3,797 / 3,586 | 6,528 / 6,042 | 11,228 / 10,226 | 18,903 / 17,468 | 32,395 / 29,737 | |
| **Gaia DR3**, V from G and BP-RP | 754 | 1,406 | 2,481 | 4,437 | 7,838 | [CC BY-NC 3.0 IGO](https://www.cosmos.esa.int/web/gaia-users/license) on its current page |
| gzip / brotli bytes | 3,135 / 2,962 | 5,625 / 5,180 | 9,734 / 8,843 | 16,943 / 15,278 | 28,542 / 26,143 | |

For comparison, d3-celestial's `stars.6.json` is 656,721 B raw and 88,919 B gzip, 4.7 times the packed V 6 table [M].

**Gaia fails on the bright end.** A 60″ cross-match against a TAP query of every source with G < 7 finds no match for 145 of 904 Yale stars at V ≤ 4.5, 311 of 2,887 at V ≤ 5.5, and 777 of 8,404 at V ≤ 6.5 [M]. The unmatched include Sirius, Canopus, Capella, Betelgeuse, Aldebaran, Achernar, Polaris, Alnilam and Alnitak [M]. A sky missing Sirius is not acceptable, so Gaia is out.

**Licences.**
- **HYG:** share-alike, so a derived star file would carry CC BY-SA 4.0 [M: LICENSE]. It's workable but a burden with no gain: its 516 extra stars at V 6.5 are mostly doubles and faint fill [E].
- **Yale:** the SAO readme and page state no terms [M]. NASA's record for BSC5P lists [U.S. Government Work and "other-license-specified"](https://data.nasa.gov/dataset/bright-star-catalog) [S]. A [1979 file](https://discmaster.textfiles.com/view/10596/science%20library%28b%29.zip/science%20library%28b%29/ASTRONOM/H256.ZIP/YALESTAR.ZIP/STAR.DOC) calls the older catalogue public domain [S]. CDS's own copy was unreachable from here [M]. WORLD-TRAVEL §2.2's "public domain" is likely but not proven.
- **Gaia:** ESA's licence page says CC BY-NC 3.0 IGO, while its [older documentation](https://gea.esac.esa.int/archive/documentation/FPR/Miscellaneous/sec_credit_and_citation_instructions/) says free with credit [S]. [ESA's archive terms](https://cosmos.esa.int/web/esdc/terms-and-conditions) ask for authorisation before commercial use [S].

**Decision.** Yale BSC5 to V 6.5, baked to epoch 2030. Proper motion barely matters: the fastest star moves 0.96 px at 24° over 30 years and 52 of 8,404 exceed 1″ a year [M].

### How many reach the camera [M]

Real Yale stars through the real pinhole camera (393 x 852, 24° or 38° wide, pitch from `config.ts`), 576 poses: 24 headings, 24 sidereal hours, flat horizon at 0°. The brief's +6° and +14.7° tops of frame check out: 18.75° of pitch at 24° gives +6.0°, horizon at 13 % of the frame [E]. Slow flight has only 2.2° of sky (`research-render.md` §4.1).

San Francisco. Tokyo is within 1 % everywhere. McMurdo is about 15 % lower in the two normal cameras and 4-12 % higher looking up.

| Camera | Sky in frame | V 4.5 | V 5 | V 5.5 | V 6 | V 6.5 | V 6.5 after extinction |
|---|---:|---:|---:|---:|---:|---:|---:|
| Street, mean | 134 sq deg, 0.32 % | 3.0 | 5.5 | 9.5 | 16.8 | 27.6 | 1.3 |
| Street, median | | 3 | 5 | 8 | 15 | 25 | 1 |
| Street, p5 to p95 | | 0-7 | 1-13 | 4-20 | 8-32 | 14-50 | |
| Ceiling, mean | 486 sq deg, 1.18 % | 10.9 | 19.6 | 34.1 | 60.4 | 100.7 | 18.7 |
| Ceiling, median | | 10 | 17 | 30 | 54 | 91 | 17 |
| Ceiling, p5 to p95 | | 5-22 | 10-36 | 18-62 | 36-103 | 60-163 | |
| Look-up, 38° lens, centre 20° up, mean | 2,023 sq deg, 4.9 % | 40 | 76 | 135 | 239 | 398 | 213 |
| Look-up, 38° lens, centre 45° up, mean | 2,574 sq deg, 6.2 % | 51 | 97 | 172 | 305 | 511 | 353 |

Extinction: k = 0.2 mag per airmass at sea level [E, a clear night], Kasten and Young airmass. These agree with `research-render.md`'s uniform-sky counts, and add the spread and the extinction.

For HYG multiply by 0.99-1.06, for Gaia by 0.83-0.93 [M: ratio of the counts above].

**What follows.**
- WORLD-TRAVEL's "600 brightest" means V 4.14 [M]. That is about 2 stars in the street band.
- Honest extinction leaves about one star at street level. The art rule must soften it. A separate low `k` for art is the simplest control [E].
- V 6.5 costs 31 KB and earns its bytes only in a look-up view. V 5.5 is the right normal default, at 11 KB [E].

### Colour to palette

The eye reads colour only in bright stars, so 3 bits is more than enough [E]. Yale V ≤ 6.5 by B-V [M], with temperature from the [Ballesteros formula](https://arxiv.org/abs/1201.1809) (formula from memory, the link not fetched):

| B-V | T | Stars | Share | Ramp, top steps only |
|---|---:|---:|---:|---|
| < -0.1 | > 11,600 K | 661 | 8 % | `BLUE` 6-7 `#a6e0ff` `#ddf6ff`, or LIMB when it exists |
| -0.1 to 0.3 | 7,500-11,600 K | 2,657 | 32 % | `GLOW_WHITE` 7 `#ffffff`, `WHITE` 7 |
| 0.3 to 0.8 | 5,300-7,500 K | 1,640 | 20 % | `GLOW_WHITE` 5-6 `#f2eed8` `#fffbe8` |
| 0.8 to 1.1 | 4,500-5,300 K | 1,397 | 17 % | `YELLOW` 6-7 `#ffe880` `#fff8cc` |
| 1.1 to 1.5 | 3,800-4,500 K | 1,272 | 15 % | `ORANGE` 6-7 `#ffcb7a` `#ffeac2` |
| > 1.5 | < 3,800 K | 777 | 9 % | `RED` 6-7 `#ff9f9c` `#ffd6cf` |

244 stars have no B-V and are counted in the 0.3-0.8 row. All are pale top steps, so no brown and no competition with paint. Brightness is the step within the row; the exact mapping belongs to the render owner.

### Honest twinkle

Scintillation grows with air path: the relative flicker scales about as sec(Z)^1.75 and falls with height as exp(-h/8 km), per the [Dravins form](https://arxiv.org/pdf/astro-ph/0302460) [S, from a search excerpt]. That formula is for telescopes, and [Young's approximation underestimates real observatories](https://arxiv.org/abs/1506.06921) [S], so I use only its shape.

| Altitude | Airmass [M] | Extinction at k = 0.2 [M] | Scintillation against zenith [M] |
|---:|---:|---:|---:|
| 90° | 1.0 | 0.2 mag | 1 |
| 45° | 1.4 | 0.3 | 1.8 |
| 30° | 2.0 | 0.4 | 3.3 |
| 15° | 3.8 | 0.8 | 10 |
| 10° | 5.6 | 1.1 | 20 |
| 6° | 8.8 | 1.8 | 45 |
| 3° | 15.1 | 3.0 | 116 |

**Rule** [E]: chance of a ±1 step on a tick = `min(1, 0.05 · X^1.75 · exp(-h / 8 km))`.
- Tick at 12 fps, the MAGIC-SPEC step for patterns. Each star keeps its own hash. It is one pixel, so the full-surface 2 Hz rule isn't touched.
- The street band is all below 6°, so every star there twinkles at full strength. That is true of real low stars.
- At 10 km up it falls to 0.29 of that, at 30 km to 0.02. Off above that.
- In orbit and on the Moon, zero.
- **Planets barely twinkle**, because [their discs average it out](https://earthsky.org/space/why-dont-planets-twinkle-as-stars-do/) [S]. Use 0.1 of the rate. A steady Venus among shimmering stars is a true cue.
- Bright stars near the horizon also flash colours from atmospheric dispersion. I know that from general knowledge and found no source [E]. If used: V < 1.5, below 10°, one tick of a neighbouring colour row.

### Milky Way

Equirectangular maps quantised to 8 levels. A map in galactic coordinates compresses better because the band lies flat [M].

| Option | Licence | 256 x 128 gzip | 512 x 256 gzip | Notes |
|---|---|---:|---:|---|
| NASA [Deep Star Maps 2020](https://svs.gsfc.nasa.gov/4851), `milkyway_2020` preview, reprojected to galactic | NASA credit, plus ESA/Gaia/DPAC for Gaia DR2 inside it [S] | 1,688 | 5,835 | Same in celestial axes 2,696 / 9,298. Band, rift, bulge and both Magellanic Clouds land where they should [M: I looked at the reprojection] |
| [ESO/S. Brunier panorama](https://www.eso.org/public/images/eso0932a/) | [CC BY 4.0 by default](https://www.eso.org/public/outreach/copyright/) with a visible credit [S] | 1,789 | 9,767 | Already galactic equirectangular [M]. Correlates 0.87 with NASA's [M]. Real photograph; 156 KB JPEG source is enough |
| ESA [Gaia sky in colour](https://sci.esa.int/web/gaia/-/60196-gaia-s-sky-in-colour-equirectangular-projection) | CC BY-SA 3.0 IGO [S] | not tested | | Share-alike image |
| Mellinger all-sky | [All rights reserved, by Mellinger](https://apod.nasa.gov/apod/ap091125.html) [S] | not tested | | Needs permission |
| d3-celestial `mw.json` | Repo BSD-3; Vieira's outlines of unknown terms [S] | 177,497 as GeoJSON | | Vector, heavy, terms unclear |
| Analytic band, `research-render.md` §4.4 | None needed | 0 | 0 | +10 ALU. No rift, no bulge, no Clouds |

**Decision.** A 256 x 128 map from ESO's panorama, for the clean licence, at 1.8 KB. It costs one fetch and `atan2` plus `asin` per dark-sky pixel; a 64² cube map avoids the trig [E, not tested]. It's a render-owner choice against the analytic band, but the real map is cheap in bytes and carries the dark rift and the Clouds, which are what a person recognises. Rotation is `render ← EQJ` times a constant galactic matrix. At 23 game px per texel on the street lens it must be quantised and dithered, not shown raw [E].

---

## 6. Constellations

**Who defines what.** The IAU defines 88 areas, not patterns: boundaries [adopted in 1928 and published in 1930 by Delporte](https://en.wikipedia.org/wiki/IAU_designated_constellations) [S]. Line figures are not an IAU standard: the official constellations are ["set areas of sky"](https://www.astronomy.com/observing/where-did-the-constellation-come-from/), and Stellarium's `western_SnT` description says the IAU defined "only" the boundaries, not how stars connect [S]. The IAU's own chart page returned 404 today, so I could not read its terms [M]. IAU star names [are free to use](https://exopla.net/star-names/modern-iau-star-names/) [S]. HYG carries 450 proper names [M].

**Data.**

| Source | Licence | Figures | Segments | Raw as served | Packed against the star table, gzip / brotli |
|---|---|---:|---:|---:|---:|
| Stellarium `western` | Text and data CC BY-SA [M: its description.md] | 88 | 680 | 107,520 B | **1,867 / 1,563** |
| Stellarium `western_SnT` (Sky & Telescope figures) | CC BY-SA 2.0 [M] | 88 | 802 | 19,195 B | 2,005 / 1,683 |
| d3-celestial `constellations.lines.json` | BSD-3 repo; based on the IAU page with the author's edits [S] | 89 | 743 [M: vertices less polylines] | 27,136 B, 7,869 gzip | 3,543 / 3,444 as raw coordinates |
| d3-celestial `constellations.json` (names in many languages) | Same | | | 50,581 B, 16,358 gzip | |
| d3-celestial `constellations.bounds.json` | Same | | | 40,714 B, 8,882 gzip | Not needed for drawing |

Pack: u16 index into the Yale V 6.5 table per vertex, 0xFFFF between strokes. Every `western` vertex is in the table; `western_SnT` needs one extra star [M]. Names: 807 B raw, 482 B gzip for 88 English names [M]. So figures plus names are about **2.3 KB gzip** [M].

**Size on screen.** Orion spans about 20° x 25° [E]: about 330 x 410 px on the 24° lens, 210 x 260 px on 38°. One constellation fills the frame, which is good, and none fits in a 6° strip. Figures belong to the look-up, as `research-render.md` §4.4 says.

**Other cultures: usable, per culture, with care.** Stellarium ships 39 sky cultures, 1.0 MB of `index.json`, each with its own licence stated in `description.md` [M]. [Its README](https://github.com/Stellarium/stellarium-skycultures) asks each culture to state its licence and prefers CC BY-SA or more permissive [S].

| Licence family | Count | Examples | For a commercial world game |
|---|---:|---|---|
| CC BY-SA, any version | 23 | western, chinese, japanese_moon_stations, hawaiian_starlines, maori, indian, tongan, mongolian, boorong, sami, norse | Usable with credit; the data file stays share-alike [E] |
| GNU GPL v2 | 10 | korean, egyptian, inuit, navajo, aztec, tupi, northern_andes, sardinian | Probably fine as a separate data file, but ask a lawyer [E] |
| CC BY-ND 4.0 | 4 | all arabic_* | No derivatives. Packing into our format may count. Avoid [E] |
| CC BY-NC, CC BY-NC-ND 4.0 | 2 | lokono, kamilaroi | Excluded |

Figure sizes against the same star table [M]: `hawaiian_starlines` 278 B gzip, `japanese_moon_stations` 369 B (2 extra stars), `maori` 92 B, `korean` 2,888 B (7 extra), `chinese` 3,221 B (56 extra). Names add about the same again [M]. So a culture is 0.2-6 KB, loadable by location.

**A caution that licences don't cover.** Indigenous star knowledge belongs to living communities. A permissive file doesn't settle how Māori, Hawaiian or Navajo skies should appear in a paint game. Someone from each community should see it before it ships [E, my judgement]. `japanese_moon_stations` (28 mansions, CC BY-SA) fits the Tokyo arrival in WORLD-TRAVEL §4, and `chinese` is a long written tradition with fewer of these concerns [E].

---

## 7. The Moon and Earth as objects

### Apparent size [M]

Horizons, 2026-2031: 0.490-0.558°. That is **8.0-9.1 px on the 24° lens** and 5.1-5.8 px on the 38° lens. A perigee Moon is one real pixel wider. Earth from the Moon: 1.99° in one sample, 32.6 px and 20.6 px.

### Albedo map

**Source.** NASA's [CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/) (2 K TIFF 3.3 MB [M]). Colour adapted from the LROC Hapke-normalised WAC mosaic, filled poleward of 70° from laser-altimeter albedo; unshaded, so it won't fight a moving sun [S]. That matches VERDICT's rule of no morphology mosaic. Credit NASA's Scientific Visualization Studio. [NASA content is generally not copyrighted, and commercial use must not imply endorsement](https://www.nasa.gov/nasa-brand-center/images-and-media/) [S]. The page warns it is "optimized for aesthetics, not science" [S], which suits this use.

**What reads.** Test: resample to width W, sample once per game pixel, snap to 8 ramp steps, and compare with an 8 x 8 supersampled reference at that disc size. Share of disc pixels on the same step, mean of three librations [M]:

| Disc px | 8 x 4 | 16 x 8 | 32 x 16 | 64 x 32 | 128 x 64 | 256 x 128 | 512 x 256 | 1024 x 512 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 5 | 54 % | **76 %** | 73 % | 57 % | 54 % | 46 % | 33 % | 32 % |
| 8 | 40 % | 67 % | **81 %** | 66 % | 58 % | 55 % | 49 % | 47 % |
| 16 | 34 % | 49 % | 71 % | **84 %** | 73 % | 63 % | 58 % | 54 % |
| 32 | 33 % | 41 % | 60 % | 78 % | **88 %** | 80 % | 69 % | 64 % |
| 64 | 30 % | 36 % | 52 % | 68 % | 82 % | **90 %** | 82 % | 75 % |

Two findings:
- **The best map is 4 times the disc width: 16 x 8 for 5 px, 64 x 32 for 16 px, 256 x 128 for 64 px.**
- **A larger map is worse without filtering.** One sample per pixel aliases, so agreement falls as the map grows. The Moon must sample a mip chosen by apparent size.

| Map, 8 levels | Raw | Gzip | Brotli | WebP lossless |
|---|---:|---:|---:|---:|
| 16 x 8 | 128 | 74 | 45 | 80 |
| 32 x 16 | 512 | 161 | 145 | 162 |
| 64 x 32 | 2,048 | 505 | 498 | 440 |
| 128 x 64 | 8,192 | 1,648 | 1,635 | 1,374 |
| 256 x 128 | 32,768 | 5,795 | 5,612 | 4,856 |
| 512 x 256 | 131,072 | 21,447 | 20,707 | 18,400 |
| 1024 x 512 | 524,288 | 81,841 | 78,593 | 71,494 |

[M]. Each map covers the whole sphere, far side included.

Mips built from the 8-level 256 x 128 map still score 81 %, 81 %, 83 %, 86 % and 84 % at 5, 8, 16, 32 and 64 px [M]. So one 4.9 KB file with mips covers everything to 64 px. Scores flatten at 80-90 % because a single sample can't equal an 8 x 8 average; the sheet shows maria reading well from about 16 px [M: viewed]. `research-render.md` §4.1 finds maria start at 11-14 px and suggests an 11 px floor, which fits. Its 128 x 64 map is 8 KB as raw R8; as 8 levels it is 1.4 KB.

### Earthshine

**Geometry.** Earth's phase is the opposite of the Moon's, so a thin crescent Moon has a nearly full Earth in its sky. The model gives this directly.

**Size.** Earthlight against sunlight on the Moon is `p (R/d)² Φ(α)`, with [geometric albedo p = 0.434](https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html) [S], Φ a phase function with Φ(0) = 1, and α Earth's phase angle. At full Earth that is **1.2e-4, about 1/8,000** [E]. It agrees with the earlier "full Earth is 43-50 times a full Moon" (research-polar-lunar §5.3): 46 × 2.5e-6 = 1.2e-4 [E]. Literal exposure puts it far below ramp step 1, so it has to be boosted.

**Rule** [E]: dark-side step = `base + round(k · Φ(α) · tone)`, 1-2 steps above the sky, using the albedo map so maria still show. The boost is art; its shape over the month is true. On the Moon's surface use the same term with `dot(n, earthDir)`, and it is exactly zero on the far side, where only paint and headlight remain.

### Eclipse colour

- **Shadow size from the model.** Earth's shadow radius 6,459 km (astronomy-engine's constant: 6,371 km plus 88 km of atmosphere) gives an umbra near 4,700 km at the Moon, and NASA's umbral magnitudes within 0.006 on all 10 eclipses from now to 2030 [M].
- **Zones.** Penumbra: dim with no hue, and only its deep end shows [E]. Umbra rim: brightest. Core: darkest. Sunlight [refracted through Earth's atmosphere](https://eclipse.gsfc.nasa.gov/OH/OHres/Danjon.html) sets the colour [S].
- **Danjon scale.** L = 0 nearly invisible to L = 4 bright copper-orange with a bluish rim [S]. L depends on the atmosphere that night and can't be predicted from geometry. Use L = 2-3 by default, and a hand-set value after the fact if a shared event deserves it [E].
- **Palette.** Sources say "copper" and "rust", and the game says no brown. Rose at the rim to violet at the core on TWILIGHT and NIGHT_SKY reads right in `astro-moon-sheet.png` [M: viewed], with albedo still visible through it.
- **Turquoise thread.** A faint blue band at the shadow edge is attributed to [ozone](https://www.pbs.org/newshour/science/ozone-challenge-can-see-turquoise-lunar-eclipse) [S]; one [simulation essay](https://yage.ai/turquoise-band-en.html) finds the simple story incomplete [S]. One pixel of pale cyan at the umbra rim is defensible. Treat it as art.
- **Scale floors.** If the Sun and Moon are drawn larger than true, also scale their separation about the Sun during a solar eclipse. Otherwise a partial eclipse looks wrong [E]. Lunar eclipses are unaffected because the shadow is computed on the Moon's own disc.

### Earth seen from the Moon

| Layer | Source | Size that reads at 20-32 px | Gzip |
|---|---|---|---:|
| Ocean, green, dry, ice | [Blue Marble](https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57752/land_shallow_topo_2048.jpg) class map, later the planet layer | 128 x 64: 94-95 % agree with the 2048 reference | 774 B |
| Clouds | A mip of WORLD-TRAVEL §2.4's live weather texture | Same, 2.8° a texel is about one Earth pixel | 0 new |
| Night lights | [Black Marble 2016](https://eoimages.gsfc.nasa.gov/images/imagerecords/144000/144898/BlackMarble_2016_01deg.jpg), 16 levels | 128 x 64 | 1,114 B |
| Sunlight | `dot(n, sun)` through `earthRot` | | 0 |
| Air rim and sun glint | Formula | | 0 |

[M] for agreement and bytes. A larger class map adds nothing at these sizes: 256 x 128 is 2,215 B and scores 93-95 %. A static cloud map at 128 x 64 and 8 levels would be 2,240 B, needed only if live clouds aren't available.

Because Earth stays near one point in the sky, you can watch it turn: at 32 px its centre moves about 4 px an hour [E]. Phases run the other way from the Moon's: from Apollo 11, 1, 5, 9, 13, 17, 21 and 25 days after the new Moon of 2026-11-09, Earth is 99, 79, 42, 8, 4, 39 and 80 % lit [M]. City lights show in the dark part and clouds in the lit part, at real positions. `astro-earth-sheet.png` is a mock of this.

### From that sphere to VERDICT step 7's tiles

Sizes along a 5-minute flight, at a constant 1,281 km/s for simplicity [E]:

| t s | km from Moon centre | Moon px @24 / @38 | Earth px @24 | Map that reads |
|---:|---:|---:|---:|---|
| 0 | 384,400 | 8 / 5 | | 32 x 16 mip |
| 66 | 300,000 | 11 / 7 | 142 | 64 x 32 mip |
| 144 | 200,000 | 16 / 10 | 65 | 64 x 32 mip |
| 222 | 100,000 | 33 / 21 | 42 | 128 x 64 |
| 261 | 50,000 | 65 / 41 | 36 | 256 x 128 |
| 284 | 20,000 | 163 / 103 | 33 | 512 x 256 or 1024 x 512 |
| 292 | 10,000 | 328 / 207 | 32 | 1024 x 512 at its limit |
| 293 | 8,356 | fills 24° lens | 32 | Tile tree |
| 296 | 5,336 | fills 38° lens | 32 | Tile tree |

- **Floor.** Keep size at the floor until true size passes it: an 11 px floor at 69 s on the 24° lens and 154 s on the 38° lens; a 16 px floor at 141 s and 200 s.
- **By rule W = 4D**, 1024 x 512 reads to 256 px, reached about 12,800 km out at 24° and 8,100 km at 38° [E].
- **The last 7-10 s** of a constant-speed flight cover the whole surface hand-over. The flight needs a braking curve, so VERDICT's "the gears brake you" applies here too [E].
- **Same source, no pop.** Bake the sphere map and tile tree tone from the same WAC Hapke source, as the top of one tree. S2 level 0 is 6 faces of 256², 393,216 texels at 9.9 km, the same reach as 1024 x 512 and 25 % fewer texels, about 61 KB at 8 levels [E].
- **Hand-over heights** by the rule "one texel is at most 2 px" at the 38° lens [E, using research-polar-lunar §2.5 texels]:

| S2 level | Moon texel | Good from height |
|---:|---:|---:|
| 0 | 9.9 km | 2,900 km |
| 3 | 1.2 km | 365 km |
| 6 | 154 m | 46 km |
| 8 | 38 m | 11 km |
| 10 | 9.6 m | 2.8 km |

That scale agrees with research-polar-lunar §0: Kaguya's 17-33 m data is good from about 5-10 km.

- **Relief.** Somewhere past 64 px the terminator needs relief, or it reads as a clean arc [E]. The kit's `ldem_3_8bit.jpg` is a 1024 x 512 height map [S], not tested here.
- **Rotation.** The sphere uses `moonRot`, and tiles use the same axes. Tile data is in Mean Earth and the IAU axes differ by at most 254 m at the surface [M]. Nobody can see that.

---

## 8. What follows for free

### Real eclipses through 2030 [M]

Engine: astronomy-engine searches. NASA: [solar](https://eclipse.gsfc.nasa.gov/SEdecade/SEdecade2021.html) and [lunar](https://eclipse.gsfc.nasa.gov/LEdecade/LEdecade2021.html) decade tables, in dynamical time [S]. All 20 found, no extras, all kinds match.

| Greatest eclipse, TD | Kind, magnitude, central duration (NASA) | Engine - NASA | Path or location |
|---|---|---:|---|
| 2027 Feb 06 16:00:47 | Annular 0.928, 7m51s | +2 s | Chile, Argentina, Atlantic |
| 2027 Aug 02 10:07:49 | **Total 1.079, 6m23s** | +2 s | Spain, N. Africa, Egypt, Saudi Arabia |
| 2028 Jan 26 15:08:58 | Annular 0.921, 10m27s | +1 s | Ecuador, Brazil, Spain, Portugal |
| 2028 Jul 22 02:56:39 | **Total 1.056, 5m10s** | +2 s | Australia, New Zealand |
| 2029 Jan 14 17:13:47 | Partial 0.871 | -1 s | N. America |
| 2029 Jun 12 04:06:13 | Partial 0.458 | -1 s | Arctic |
| 2029 Jul 11 15:37:18 | Partial 0.230 | +3 s | S. Chile, Argentina |
| 2029 Dec 05 15:03:57 | Partial 0.891 | 0 s | S. Argentina, Antarctica |
| 2030 Jun 01 06:29:13 | Annular 0.944, 5m21s | +3 s | Algeria to Japan |
| 2030 Nov 25 06:51:37 | **Total 1.047, 3m44s** | +1 s | Botswana, S. Africa, Australia |

| Lunar, TD | Kind, umbral magnitude (NASA) | Engine - NASA | Model magnitude |
|---|---|---:|---:|
| 2027 Feb 20 23:14:06 | Penumbral -0.057 | -6 s | -0.052 |
| 2027 Jul 18 16:04:09 | Penumbral -1.068 | +2 s | -1.062 |
| 2027 Aug 17 07:14:59 | Penumbral -0.525 | +2 s | -0.521 |
| 2028 Jan 12 04:14:13 | Partial 0.066 | +4 s | 0.072 |
| 2028 Jul 06 18:20:57 | Partial 0.389 | -2 s | 0.395 |
| 2028 Dec 31 16:53:15 | **Total 1.246** | -4 s | 1.252 |
| 2029 Jun 26 03:23:22 | **Total 1.844** | +2 s | 1.849 |
| 2029 Dec 20 22:43:12 | **Total 1.117** | 0 s | 1.123 |
| 2030 Jun 15 18:34:34 | Partial 0.502 | -1 s | 0.507 |
| 2030 Dec 09 22:28:51 | Penumbral -0.163 | 0 s | -0.158 |

**Model checks.** At the 10 local solar eclipses below, circle overlap from the model's angular radii matches the engine's obscuration within 0.1 point [M].

| City | Peak UT | Kind | Covered |
|---|---|---|---:|
| Luxor | 2027-08-02 10:05 | **Total** | 100 % |
| Sydney | 2028-07-22 04:01 | **Total** | 100 % |
| Seville | 2027-08-02 08:47 | Partial | 98 % |
| Seville | 2028-01-26 16:55 | Annular | 83 % |
| Sydney | 2030-11-25 08:18 | Partial | 79 % |
| Tokyo | 2030-06-01 08:07 | Partial | 72 % |
| San Francisco | 2029-01-14 16:22 | Partial | 56 % |
| Luxor | 2030-06-01 04:41 | Partial | 50 % |
| New York | 2029-01-14 17:50 | Partial | 41 % |
| New York | 2028-01-26 15:02 | Partial | 3 % |

Timing against Horizons, 1-minute tables, closest approach of disc centres: Luxor 2027: engine 3.9 s, hand port 25 s. Sydney 2028: engine 1.0 s, hand port 57 s [M]. Luxor totality by the engine runs 10:02:06-10:08:31 UT; Sydney 03:59:38-04:03:30 UT [M].

Moon altitude at peak of the umbral lunar eclipses, degrees, negative means unseen [M]:

| Peak UT | Kind | SF | Tokyo | Sydney | London | New York | Quito |
|---|---|---:|---:|---:|---:|---:|---:|
| 2028-01-12 04:13 | Partial | 35 | -29 | -60 | 35 | 69 | 61 |
| 2028-07-06 18:19 | Partial | -62 | 12 | 32 | -16 | -66 | -63 |
| 2028-12-31 16:52 | Total | -13 | **59** | 19 | 7 | -26 | -66 |
| 2029-06-26 03:22 | Total | -2 | -75 | -30 | 3 | 21 | 53 |
| 2029-12-20 22:42 | Total | -19 | -9 | -47 | **58** | 12 | -7 |
| 2030-06-15 18:33 | Partial | -65 | 9 | 28 | -13 | -63 | -60 |

Keep a baked JSON list of events to 2035, built by a tool, so the client can announce them [E]. The model does the rest.

### Other cheap magic

- **Planets.** JPL's [Keplerian table](https://ssd.jpl.nasa.gov/planets/approx_pos.html) [S] and a Kepler solver are 814 B gzip [M]. Worst errors 2026-2031 against Horizons: Mercury 0.009°, Venus 0.017°, Mars 0.023°, Jupiter 0.053°, Saturn 0.081°, 1.3 px at 24° [M]. They are the brightest dots in the band and Venus is often the first thing visible at dusk. The table stops being valid in 2050 [S].
- **Supermoon is one real pixel:** 8 px at apogee, 9 at perigee [M].
- **The Moon's shadow.** During a solar eclipse the same overlap sum can darken a spot on Earth's sphere, seen from orbit or from the Moon [E].
- **From the Moon during a lunar eclipse** Earth covers the Sun, with every sunset on Earth as a ring around it. `sunSeen` and one rim colour [E].
- **Sun down your street.** Real sun on real street bearings means any city's streets align on real dates, with no city data beyond OSM. At Manhattan's 299° the model gives sunsets on 26 May and 19 July 2027 [M]. I did not compare those with published Manhattanhenge dates.
- **Earthrise is a destination.** At Mare Smythii in this window: Earth sets 2026-11-15 08:13 and rises 11-24 02:58, sets 12-13 00:36, rises 12-22 15:49 [M].
- **Belt of Venus** (pink band opposite a set Sun) comes from `dot(dir, antiSun)` and Sun depression [E].
- **Meteor showers** are a dozen fixed radiants and dates [E, not researched].
- **Moonlit bay.** The glitter path is `reflect` of `moonDir`, on the existing glitter chunk [E].

---

## 9. What ships, and when

All gzip, measured above.

| Asset | When | Bytes |
|---|---|---:|
| Series + planets + sky model | Main script | 10,665 |
| Moon 128 x 64, 8 levels, WebP lossless | Main script or first fetch | 1,374 |
| Stars V ≤ 4.5 | Main script or first fetch | 3,718 |
| **In or beside the main script** | | **15.8 KB, 4.5 % of 352 KB** |
| Milky Way 256 x 128 | Lazy, at dusk | 1,789 |
| Stars to V 5.5 | Lazy, at dusk | 11,302 |
| Stars to V 6.5 | Lazy, for the look-up | 30,645 |
| Moon 256 x 128 | Lazy | 4,856 |
| Line figures and names | Lazy, with the look-up | 2,349 |
| Eclipse list | With the star fetch | under 1 KB [E] |
| Earth class + lights | When the Moon flight starts | 1,888 |
| Moon 1024 x 512 | When the Moon flight starts | 71,494 |

Credits to add to `DATA_LICENSE.md`: astronomy-engine (MIT), Yale BSC5, Stellarium `western` (CC BY-SA), NASA SVS CGI Moon Kit, NASA Blue and Black Marble, ESO/S. Brunier if used.

---

## 10. Corrections to the brief and earlier reports

| Claim | Where | Finding |
|---|---|---|
| Could not confirm `RotationAxis` works for the Moon | research-polar-lunar §5.3, brief | It works, 254 m worst at the surface [M] |
| Moon is about 5 game px from the ground | Brief | 8.0-9.1 px on the street lens, 5.1-5.8 px on the ceiling lens [M]. `research-render.md` §4.1 agrees |
| Moon about 76 % lit today | research-polar-lunar §5.3, by mean synodic arithmetic | 65.1 % at 12:00 UT from Horizons; Earth 34.7 % from Apollo 11 [M] |
| Earth about 66° up at Apollo 11 | research-polar-lunar §5.3 | 58-74° over 62 days [M] |
| Yale catalogue is public domain | WORLD-TRAVEL §2.2 | Likely, not proven [S] |
| Roughly 600 brightest stars | WORLD-TRAVEL §2.2 | V 4.14: about 2 stars at street level [M]. Too few |
| NOAA solar formula | WORLD-TRAVEL §2.3 | Earth only, as the brief says. Its Meeus base is good to 0.0036° [M: hand port's Sun] |
| Accurate to ±1 arcminute | astronomy-engine's own claim [S] | Much better for these two bodies: 4 arcsec on the Moon, 2 arcsec on the Sun [M] |
| astronomy-engine's default Delta T | Package | 6.4 s high today [M]. Override it |
| Illuminated fraction from a library | Common practice | Geocentric, up to 0.74 points off what an observer sees [M] |

---

## 11. What I could not confirm

- **Nothing ran on a phone or in a browser.** No A15 timing, no real frame. The sheets are CPU mocks with placeholder ramps.
- **Bundle sizes** are esbuild's, not Vite 8's. The 352 KB is not re-measured; there is no build here.
- **Yale licence.** No authoritative rights statement. CDS, the usual home, did not connect from this machine, so the data came from SAO's mirror and matched CDS's byte layout. HEASARC's terms were not read.
- **Gaia licence.** ESA's own pages disagree (§5). Gaia is rejected on data anyway, but NASA's Deep Star Maps contain Gaia DR2, which is why ESO's panorama is my pick.
- **ESO's terms for eso0932a.** The image page gives credit but no explicit licence; the CC BY 4.0 reading comes from ESO's general policy. Its note that the full-resolution original is withheld "for copyright reasons" applies to that file, I believe, not the public versions [E]. A one-line email would settle it.
- **Cultural data.** Licences were read from each `description.md`, not reviewed legally. GPL for data in a closed game is an open question.
- **IAU figures.** The IAU constellations page returned 404. The statement that line figures are unofficial rests on secondary sources.
- **Scintillation numbers** are telescope formulae used for their shape. No source gave naked-eye values or the colour flashing. The 0.05 constant is style.
- **Earthshine.** 1/8,000 is my estimate from Earth's geometric albedo. I found no direct photometric figure.
- **Eclipse brightness.** The Danjon value can't be forecast. I have no measured palette mapping, only a mock.
- **Midway between Earth and Moon.** Horizons stops at 40,000 km from a body.
- **Grid convergence sign** is derived by geometry, not run through PROJ. The sky model's `axes` form was not itself run; the tested prototype built axes from lat/lon.
- **The truth for eclipse timing** is Horizons at 1-minute steps with a parabola fit, so the 1-4 s engine figures are themselves good to a few seconds.
- **The `reads at` metric** is mine: step agreement with a supersampled reference. It supports the 4x rule. A person's eye on a real frame is the real test.
- **Star colours, twinkle and the Milky Way** have not been judged by eye in the game.
