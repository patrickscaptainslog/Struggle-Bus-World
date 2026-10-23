// Tiny registry so any module can expose numbers to the hidden tuning panel
// without the panel knowing about the module. Register plain objects whose
// numeric fields are live-read by the module every frame.

export interface TunableGroup {
  name: string;
  values: Record<string, unknown>;
  /** Optional explicit ranges: key -> [min, max, step]. */
  ranges?: Record<string, [number, number, number?]>;
}

const groups: TunableGroup[] = [];
const listeners = new Set<() => void>();

export function registerTunables(name: string, values: Record<string, unknown>, ranges?: TunableGroup['ranges']) {
  const existing = groups.find((g) => g.name === name);
  if (existing) {
    existing.values = values;
    existing.ranges = ranges;
  } else groups.push({ name, values, ranges });
  listeners.forEach((l) => l());
}

export function tunableGroups(): readonly TunableGroup[] {
  return groups;
}

export function onTunablesChanged(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
