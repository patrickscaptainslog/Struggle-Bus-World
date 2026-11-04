import { config } from '../config';
import { globals, heldGlobals } from '../render/materials';
import { Ramp } from '../render/palette';
import type { PixelPipeline } from '../render/PixelPipeline';
import { hourUp } from './flag';
import { Lamps } from './Lamps';
import { applyTable, fogLuma } from './SkyTable';

// The whole game under one blue hour (SKY.md slice S1, ?hour=blue). There is no clock and nothing here moves: it is the light, the sky's rows and the table of one
// hour, read from config.sky each frame so the tuner's switches are live. SKY.md's key table: the afterglow at the sun's azimuth, held at +8 degrees, with no sun
// pass and no shadows. uLight stays mid-range and the table carries the dark (4.4): a painted wall lands on its strongest steps.
//
// Under the live sky (LiveSky.ts) this is its night: the light is the live sky's, the azimuth the real Sun's, and while the hour is down (hourUp) every part
// of it reads as switched off, which is the day's.

const DEG = Math.PI / 180;

export class HeldHour {
  private tableKey = -1;
  /** The street lamps, the spans' lights and the pools (SKY.md 4.4). */
  readonly lamps = new Lamps();

  /** live: the live sky's night, which owns the key and the sun pass. */
  constructor(private readonly pipeline: PixelPipeline, private readonly live = false) {}

  /** No sun pass this frame. */
  get shadowsOff(): boolean {
    return !this.live && config.sky.key;
  }

  /** The beam's reach and width at its tip (m). Up high (vista 0..1) it lights nothing, the street is a long way down: it goes back to the day's small eye. */
  beamLength(vista: number): number {
    const C = config.camera;
    return hourUp() && config.sky.beam ? config.sky.beamLength + (C.headBeamLength - config.sky.beamLength) * vista : C.headBeamLength;
  }

  beamWidth(vista: number): number {
    const C = config.camera;
    return hourUp() && config.sky.beam ? config.sky.beamWidth + (C.headBeamWidth - config.sky.beamWidth) * vista : C.headBeamWidth;
  }

  /** After the day's light is set, every frame: what this hour replaces. Writes in place, and the palette only when a switch moved. `azimuth`: the live sky's (deg). */
  update(azimuth = config.sky.azimuth): void {
    const S = config.sky, on = hourUp();
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
    const table = on && S.table;
    const key = (table ? 1 : 0) + (on && S.paint ? 2 : 0);
    const u = this.pipeline.heldUniforms;
    if (key !== this.tableKey) {
      this.tableKey = key;
      applyTable(this.pipeline.paletteTexture, table, on && S.paint);
      fogLuma(table, u.uFogLuma.value);
    }
    const rows = table && S.rows;
    u.uSkyRows.value.set(rows ? Ramp.SKY_LOW : -1, Ramp.NIGHT_SKY, Ramp.SKY_WARM, Ramp.TWILIGHT);
    u.uSkySun.value.set(sx, sz, S.sunFall);
    heldGlobals.uSkyHaze.value = rows ? S.hazeLight : 0;
    heldGlobals.uLit.value = on && S.windows ? S.litShare : 0;
    heldGlobals.uLitGlow.value = S.litGlow;
    heldGlobals.uFarLit.value.set(on && S.farLights ? S.farCellLit : 0, S.farCellGlow);
    heldGlobals.uFarFace.value = on && S.farLights ? 0.5 * S.litShare : 0;
    this.lamps.update(on);
    u.uBeamGain.value = on && S.beam ? S.beamGain : 2.6;
    u.uPaintCap.value = table && S.paint ? Math.floor(S.paintCap) : 7;
  }
}
