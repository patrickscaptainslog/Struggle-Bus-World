// The weather (CONTRACT.md section 4): an input to life from the start, held at clear until weather has an owner (on hold, CLAUDE.md). Worker-safe. The world's
// lifeData.ts is to have weatherAt(lat, lon, utcMs); until it does, the worker is handed CLEAR and every simulation takes it, so a day of weather later is a change
// to what's passed in, not to life's code (L7: CLEAR and none give the same movers).

export interface Weather {
  rain: number;
  snow: number;
  /** at the water */
  fog: number;
  cloud: number;
  /** null: no data, and life uses its own fair-weather breeze, so a clear day still sails. toward: rad on the map's grid, 0 toward +X, pi/2 toward +Z */
  wind: { speed: number; toward: number } | null;
}

export const CLEAR: Weather = { rain: 0, snow: 0, fog: 0, cloud: 0, wind: null };
