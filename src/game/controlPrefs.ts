// The persisted controls settings (localStorage strugglebus.controls.v1), pure so they test offline.

export interface Prefs {
  /** cues already shown (src/ui/Coach.ts): bits 1 tap, 2 drag, 8 mega, 32 the hint (4 and 16 were TURBO's blink and the tilt chip's: they stay set in old saves and nothing reads them) */
  taught?: number;
  /** the buttons and the memory's half mirrored for the left hand */
  swap?: boolean;
  muted?: boolean;
  /** a desktop has seen the keys once */
  keysShown?: boolean;
}

/** What a build with tilt left in the save (the key is the same as ever). */
const GONE = ['mode', 'tilt', 'chipIgnored', 'sens'] as const;

/** Same key as ever: anything the tilt saved goes, and `changed` says so (the caller saves the result). */
export function migratePrefs(v: unknown): { prefs: Prefs; changed: boolean } {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { prefs: {}, changed: false };
  const p = v as Record<string, unknown>;
  let changed = false;
  for (const k of GONE)
    if (k in p) {
      delete p[k];
      changed = true;
    }
  return { prefs: p as Prefs, changed };
}
