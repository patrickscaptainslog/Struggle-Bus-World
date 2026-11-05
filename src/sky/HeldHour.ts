import { config } from '../config';
import { globals, heldGlobals } from '../render/materials';
import { Ramp } from '../render/palette';
import type { PixelPipeline } from '../render/PixelPipeline';
import { byHour } from './flag';
import { Lamps } from './Lamps';
import { applyTable, fogLuma } from './SkyTable';

// The whole game under one blue hour (SKY.md slice S1, ?hour=blue). There is no clock and nothing here moves: it is the light, the sky's rows and the table of one
// hour, read from config.sky each frame so the tuner's switches are live. SKY.md's key table: the afterglow at the sun's azimuth, held at +8 degrees, with no sun
// pass and no shadows. uLight stays mid-range and the table carries the dark (4.4): a painted wall lands on its strongest steps.
//
// Under the live sky (LiveSky.ts) this is its night: the light and the table are the live sky's, the azimuth the real Sun's, and each part comes up as the
// live sky says: the bands as the day's sky hands over to them, the windows by the city's clock, the lamps in their wave, the rest as far as the hour is up (hourK).

const DEG = Math.PI / 180;

export class HeldHour {
  private tableKey = -1;
  /** The street lamps, the spans' lights and the pools (SKY.md 4.4). */
  readonly lamps = new Lamps();
  /** The live sky's, before each update (the held hour's are all 1): the share of the sky the bands draw, of config.sky.litShare lit, of the lamps' wave come. */
  bands = 1;
  lit = 1;
  wave = 1;

  /** live: the live sky's night, which owns the key and the sun pass. */
  constructor(private readonly pipeline: PixelPipeline, private readonly live = false) {}

  /** No sun pass this frame. */
  get shadowsOff(): boolean {
    return !this.live && config.sky.key;
  }

  /** The beam's reach and width at its tip (m). Up high (vista 0..1) it lights nothing, the street is a long way down: it goes back to the day's small eye. */
  beamLength(vista: number): number {
    const C = config.camera;
    return byHour(C.headBeamLength, config.sky.beamLength + (C.headBeamLength - config.sky.beamLength) * vista, config.sky.beam);
  }

  beamWidth(vista: number): number {
    const C = config.camera;
    return byHour(C.headBeamWidth, config.sky.beamWidth + (C.headBeamWidth - config.sky.beamWidth) * vista, config.sky.beam);
  }

  /** The palette someone else wrote (?earth's flight): the hour's is written again on the next update. */
  repaint(): void {
    this.tableKey = -1;
  }

  /** After the day's light is set, every frame: what this hour replaces. Writes in place, and the palette only when a switch moved (the live sky writes its own). `azimuth`: the live sky's (deg). */
  update(azimuth = config.sky.azimuth): void {
    const S = config.sky;
    const az = azimuth * DEG, sx = Math.sin(az), sz = -Math.cos(az);
    if (!this.live) {
      if (S.key) {
        const el = S.keyHeight * DEG, ce = Math.cos(el);
        globals.uSunDir.value.set(sx * ce, Math.sin(el), sz * ce);
        globals.uLight.value.set(S.keyStrength, S.ambient, S.bounce);
      }
      // (the sky's own sun is the key's here: there is no other)
      heldGlobals.uSkySunDir.value.copy(globals.uSunDir.value);
    }
    const table = S.table, u = this.pipeline.heldUniforms;
    const key = (table ? 1 : 0) + (S.paint ? 2 : 0);
    if (!this.live && key !== this.tableKey) {
      this.tableKey = key;
      applyTable(this.pipeline.paletteTexture, table, S.paint);
      fogLuma(table, u.uFogLuma.value);
    }
    const rows = table && S.rows && this.bands > 0;
    u.uSkyRows.value.set(rows ? Ramp.SKY_LOW : -1, Ramp.NIGHT_SKY, Ramp.SKY_WARM, Ramp.TWILIGHT);
    u.uSkySun.value.set(sx, sz, S.sunFall, this.bands);
    heldGlobals.uSkyHaze.value.set(S.hazeLight, rows ? this.bands : 0);
    heldGlobals.uLit.value = S.windows ? S.litShare * this.lit : 0;
    heldGlobals.uLitGlow.value = S.litGlow;
    heldGlobals.uFarLit.value.set(S.farLights ? S.farCellLit * this.lit : 0, S.farCellGlow);
    heldGlobals.uFarFace.value = S.farLights ? 0.5 * S.litShare * this.lit : 0;
    this.lamps.update(this.wave);
    u.uBeamGain.value = byHour(2.6, S.beamGain, S.beam);
    // (paint never bleaches, at any hour: SKY.md's rule 5)
    u.uPaintCap.value = table && S.paint ? Math.floor(S.paintCap) : 7;
  }
}
