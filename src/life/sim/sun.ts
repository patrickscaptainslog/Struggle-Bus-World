// The Sun's evening at a place, for life's day (the first account's life review, m7: picnics and sailboats stayed out after dark). Worker-safe and pure: the
// declination and the equation of time by the day of the year, near enough for when people pack up (minutes, not seconds), the same for every player.

/** Local time of sunset (s from local midnight) at (lat, lon) degrees on local day `day` (days since 1970), the place `tzMin` minutes from UTC. */
export function sunsetSec(lat: number, lon: number, day: number, tzMin: number): number {
  // (the day of the year: 1970-01-01 is day 0, and a mean year is near enough for this)
  const r = Math.PI / 180, n = day + 0.5 - 365.2422 * Math.floor((day + 0.5) / 365.2422);
  const decl = -23.44 * r * Math.cos(((2 * Math.PI) / 365) * (n + 10));
  const b = ((2 * Math.PI) / 364) * (n - 81), eot = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
  const cosH = (Math.sin(-0.833 * r) - Math.sin(lat * r) * Math.sin(decl)) / (Math.cos(lat * r) * Math.cos(decl));
  // (no sunset, the polar summer or winter: midnight or noon, the day's end as the rest of life holds it)
  const H = cosH <= -1 ? Math.PI : cosH >= 1 ? 0 : Math.acos(cosH);
  const utcHours = 12 - lon / 15 + (H / r) / 15 - eot / 60;
  return ((((utcHours * 3600 + tzMin * 60) % 86400) + 86400) % 86400);
}
