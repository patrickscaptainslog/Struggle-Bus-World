// The persisted controls settings (localStorage strugglebus.controls.v1), pure so they test offline.

export interface Prefs {
  /** true = wants tilt, false = thumb only, absent = undecided */
  tilt?: boolean;
  /** cues already shown (src/ui/Coach.ts): bits 1 tap, 2 drag, 4 turbo, 8 mega, 16 chip */
  taught?: number;
  /** the buttons mirrored for the left hand */
  swap?: boolean;
  /** chips ignored in a row; 2 clears `tilt` */
  chipIgnored?: number;
  sens?: number;
  muted?: boolean;
  /** a desktop has seen the keys once */
  keysShown?: boolean;
}

/** Same key as ever: an old `mode` becomes `tilt` and is deleted. */
export function migratePrefs(v: unknown): Prefs {
  if (!v || typeof v !== 'object') return {};
  const p = v as Prefs & { mode?: string };
  if (p.mode === 'tilt') p.tilt = true;
  else if (p.mode === 'touch') p.tilt = false;
  delete p.mode;
  return p;
}

/** The chip went unanswered. A player who once chose tilt doesn't have to turn it on just to turn it off. */
export function chipIgnored(p: Prefs): void {
  p.chipIgnored = (p.chipIgnored ?? 0) + 1;
  if (p.chipIgnored >= 2) delete p.tilt;
}

export function tiltTurnedOn(p: Prefs): void {
  p.tilt = true;
  p.chipIgnored = 0;
}

/** A tap on the Busy toggle: back to undecided. */
export function tiltCancelled(p: Prefs): void {
  delete p.tilt;
}
