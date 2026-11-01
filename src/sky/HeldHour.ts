import { config } from '../config';
import { globals, heldGlobals } from '../render/materials';
import { Ramp } from '../render/palette';
import type { PixelPipeline } from '../render/PixelPipeline';
import { applyTable, fogLuma } from './SkyTable';

// The whole game under one blue hour (SKY.md slice S1, ?hour=blue). There is no clock and nothing here moves: it is the light, the sky's rows and the table of one
// hour, read from config.sky each frame so the tuner's switches are live. SKY.md's key table: the afterglow at the sun's azimuth, held at +8 degrees, with no sun
// pass and no shadows. uLight stays mid-range and the table carries the dark (4.4): a painted wall lands on its strongest steps.

const DEG = Math.PI / 180;

export class HeldHour {
  private tableKey = -1;

  constructor(private readonly pipeline: PixelPipeline) {}

  /** No sun pass this frame. */
  get shadowsOff(): boolean {
    return config.sky.key;
  }

  /** The beam's reach and width at its tip (m). Up high (vista 0..1) it lights nothing, the street is a long way down: it goes back to the day's small eye. */
  beamLength(vista: number): number {
    const C = config.camera;
    return config.sky.beam ? config.sky.beamLength + (C.headBeamLength - config.sky.beamLength) * vista : C.headBeamLength;
  }

  beamWidth(vista: number): number {
    const C = config.camera;
    return config.sky.beam ? config.sky.beamWidth + (C.headBeamWidth - config.sky.beamWidth) * vista : C.headBeamWidth;
  }

  /** After the day's light is set, every frame: what this hour replaces. Writes in place, and the palette only when a switch moved. */
  update(): void {
    const S = config.sky;
    const az = S.azimuth * DEG, sx = Math.sin(az), sz = -Math.cos(az);
    if (S.key) {
      const el = S.keyHeight * DEG, ce = Math.cos(el);
      globals.uSunDir.value.set(sx * ce, Math.sin(el), sz * ce);
      globals.uLight.value.set(S.keyStrength, S.ambient, S.bounce);
    }
    const key = (S.table ? 1 : 0) + (S.paint ? 2 : 0);
    const u = this.pipeline.heldUniforms;
    if (key !== this.tableKey) {
      this.tableKey = key;
      applyTable(this.pipeline.paletteTexture, S.table, S.paint);
      fogLuma(S.table, u.uFogLuma.value);
    }
    const rows = S.table && S.rows;
    u.uSkyRows.value.set(rows ? Ramp.SKY_LOW : -1, Ramp.NIGHT_SKY, Ramp.SKY_WARM, Ramp.TWILIGHT);
    u.uSkySun.value.set(sx, sz, S.sunFall);
    heldGlobals.uSkyHaze.value = rows ? S.hazeLight : 0;
    heldGlobals.uLit.value = S.windows ? S.litShare : 0;
    heldGlobals.uLitGlow.value = S.litGlow;
    u.uBeamGain.value = S.beam ? S.beamGain : 2.6;
    u.uPaintCap.value = S.table && S.paint ? Math.floor(S.paintCap) : 7;
  }
}
