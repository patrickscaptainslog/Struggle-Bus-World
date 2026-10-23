import { config } from '../config';
import { HUE_RAMPS, rampColor } from '../render/palette';
import { onTunablesChanged, tunableGroups, type TunableGroup } from './tunables';
import { Perf } from './Perf';

// Hidden tuning panel (three-finger tap, or ?tune).
//
// A bottom sheet that auto-generates a row for EVERY numeric field in
// `config` (one section per config block) plus every group registered with
// registerTunables(). One-thumb use on an iPhone:
//   - drag a row sideways to scrub its value (vertical drags scroll the list),
//   - hold - / + for fine steps (auto-repeat),
//   - double-tap a row to reset it to its default,
//   - tap a section header to fold it; the chips jump to a section.
// Changed values persist in localStorage and are re-applied on load by
// applySavedTuning() (call it first thing, before anything reads config).
// "Copy JSON" copies only the changed values: { config: { flight: {...} }, Bus: {...} }.
//
// Ranges: explicit ranges from registerTunables() win; otherwise 0..3x the
// default (symmetric for negative defaults, -1..1 for zero), widened to fit
// the current value. Steps land on 1/2/5-free powers of ten, ~50-500 per range;
// integer-looking fields (sizes, frames, px, counts, steps) step by whole numbers.
// Note: changing config.render.pixelWidth / maxPixelScale fires a window
// 'resize' so the pixel pipeline reallocates at the new resolution.

type Val = number | boolean;

interface Store {
  /** config path ('flight.stretchPx') -> value */
  config: Record<string, Val>;
  /** tunable group name -> key -> value */
  groups: Record<string, Record<string, Val>>;
}

const STORE_KEY = 'sb.tuning.v1';
const UI_KEY = 'sb.tuner.ui.v1';

let store: Store = { config: {}, groups: {} };
let inited = false;
const configDefaults = new Map<string, Val>();
const groupDefaults = new WeakMap<object, Map<string, Val>>();

function isVal(v: unknown): v is Val {
  return (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean';
}

function readJSON<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

function writeJSON(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode / quota: tuning just won't persist */
  }
}

let saveTimer = 0;
function saveSoon() {
  if (saveTimer) return;
  saveTimer = window.setTimeout(() => {
    saveTimer = 0;
    writeJSON(STORE_KEY, store);
  }, 250);
}

/** Visit every numeric/boolean leaf of config: (owner object, key, dotted path, top-level section). */
function walkConfig(cb: (obj: Record<string, unknown>, key: string, path: string, section: string) => void) {
  const visit = (obj: Record<string, unknown>, prefix: string, section: string) => {
    for (const key of Object.keys(obj)) {
      const v = obj[key];
      const path = prefix ? `${prefix}.${key}` : key;
      if (isVal(v)) cb(obj, key, path, section || key);
      else if (v && typeof v === 'object' && !Array.isArray(v)) visit(v as Record<string, unknown>, path, section || key);
    }
  };
  visit(config as unknown as Record<string, unknown>, '', '');
}

function adoptGroup(g: TunableGroup) {
  if (groupDefaults.has(g.values)) return;
  const d = new Map<string, Val>();
  for (const k of Object.keys(g.values)) {
    const v = g.values[k];
    if (isVal(v)) d.set(k, v);
  }
  groupDefaults.set(g.values, d);
  const saved = store.groups[g.name];
  if (!saved) return;
  for (const k of Object.keys(saved)) {
    const sv = saved[k];
    if (d.has(k) && typeof sv === typeof d.get(k)) g.values[k] = sv;
  }
}

function adoptGroups() {
  for (const g of tunableGroups()) adoptGroup(g);
}

/**
 * Re-applies tuned values saved on this device. Call before anything reads
 * config (main.ts does it first thing). Groups registered later get their
 * saved values the moment they register. Idempotent.
 */
export function applySavedTuning(): void {
  if (inited) return;
  inited = true;
  const s = readJSON<Partial<Store>>(STORE_KEY);
  store = {
    config: s && s.config && typeof s.config === 'object' ? s.config : {},
    groups: s && s.groups && typeof s.groups === 'object' ? s.groups : {},
  };
  walkConfig((obj, key, path) => {
    const def = obj[key] as Val;
    configDefaults.set(path, def);
    const sv = store.config[path];
    if (sv !== undefined && typeof sv === typeof def && isVal(sv)) obj[key] = sv;
  });
  adoptGroups();
  onTunablesChanged(adoptGroups);
}

// ------------------------------------------------------------------ ranges

const INT_HINT = /(size|frames?|count|width|height|steps?|px|buildings|scale|samples|octaves|segments|max[A-Z]\w*)$|^(step|max)[A-Z]/i;

function niceStep(range: number): number {
  if (!(range > 0)) return 0.01;
  return Math.pow(10, Math.floor(Math.log10(range / 50)));
}

function decimalsOf(step: number): number {
  if (step >= 1) return 0;
  return Math.min(6, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)));
}

function inferRange(def: number, cur: number, key: string, explicit?: [number, number, number?]): [number, number, number] {
  let min: number;
  let max: number;
  let step: number;
  if (explicit) {
    min = explicit[0];
    max = explicit[1];
    step = explicit[2] ?? niceStep(max - min);
  } else {
    if (def > 0) {
      min = 0;
      max = def * 3;
    } else if (def < 0) {
      min = def * 3;
      max = -def * 3;
    } else {
      min = -1;
      max = 1;
    }
    step = niceStep(max - min);
    if (Number.isInteger(def) && Math.abs(def) >= 2 && INT_HINT.test(key)) step = Math.max(1, Math.round(step));
  }
  if (cur < min) min = cur;
  if (cur > max) max = cur;
  if (!(step > 0)) step = niceStep(max - min);
  return [min, max, step];
}

// ------------------------------------------------------------------ panel

interface Section {
  id: string;
  title: string;
  caption: string;
  hue: number;
  el: HTMLElement;
  head: HTMLElement;
  body: HTMLElement;
  countEl: HTMLElement;
  chip: HTMLElement;
  rows: Row[];
  open: boolean;
}

interface Row {
  el: HTMLElement;
  nameEl: HTMLElement;
  valEl: HTMLElement;
  fill: HTMLElement | null;
  sec: Section;
  obj: Record<string, unknown>;
  key: string;
  def: Val;
  kind: 'num' | 'bool';
  min: number;
  max: number;
  step: number;
  dec: number;
  /** Store location: config path, or group name + key. */
  cfgPath: string | null;
  group: string | null;
  shown: Val | undefined;
  search: string;
}

interface Scrub {
  row: Row;
  id: number;
  x0: number;
  y0: number;
  v0: number;
  t0: number;
  /** Horizontal scrub engaged; its x origin. */
  active: boolean;
  ax: number;
  vertical: boolean;
  width: number;
}

const HUES = HUE_RAMPS.map((r) => ({ base: rampColor(r, 4), light: rampColor(r, 6), deep: rampColor(r, 2) }));

export class Tuner {
  onResetPaint: (() => void) | null = null;
  /** Called with 'open', 'close', 'copy', 'resetPaint', 'resetAll', 'fps'. */
  onAction: ((name: string) => void) | null = null;
  /** Data credits listed at the top of the sheet (the city's ODbL attribution). */
  credits = '';

  private root: HTMLDivElement | null = null;
  private sheet!: HTMLElement;
  private scroller!: HTMLElement;
  private chips!: HTMLElement;
  private badge!: HTMLElement;
  private filter!: HTMLInputElement;
  private toastEl!: HTMLElement;
  private fpsBtn!: HTMLElement;
  private copyBox!: HTMLElement;
  private copyArea!: HTMLTextAreaElement;
  private sections: Section[] = [];
  private rows: Row[] = [];
  private rowByEl = new Map<HTMLElement, Row>();
  private shown = false;
  private dirty = true;
  private everBuilt = false;
  private tall = false;
  private openIds = new Set<string>();
  private scrub: Scrub | null = null;
  private lastTap: { row: Row; t: number } | null = null;
  private repeatT = 0;
  private repeatI = 0;
  private pollI = 0;
  private toastT = 0;
  private resizeT = 0;
  private armed: { el: HTMLElement; label: string; t: number } | null = null;

  constructor() {
    applySavedTuning();
    const ui = readJSON<{ open?: string[]; tall?: boolean }>(UI_KEY);
    if (ui?.open) for (const id of ui.open) this.openIds.add(id);
    else this.openIds.add('c:flight'); // first visit: the feel numbers are what you came for
    this.tall = !!ui?.tall;
    onTunablesChanged(() => {
      this.dirty = true;
      if (this.shown) this.rebuild();
    });
  }

  get visible(): boolean {
    return this.shown;
  }

  toggle(): void {
    this.shown = !this.shown;
    if (this.shown) {
      this.ensureDom();
      this.root!.classList.add('open'); // laid out before building, so scrolling works
      if (this.dirty) this.rebuild();
      else this.refreshAll();
      this.syncFps();
      this.pollI = window.setInterval(() => this.poll(), 300);
    } else {
      this.root?.classList.remove('open');
      window.clearInterval(this.pollI);
      this.stopRepeat();
      this.scrub = null;
      if (document.activeElement instanceof HTMLElement && this.root?.contains(document.activeElement)) document.activeElement.blur();
    }
    this.onAction?.(this.shown ? 'open' : 'close');
  }

  // ---------------------------------------------------------------- DOM

  private ensureDom() {
    if (this.root) return;
    installStyle();
    const root = document.createElement('div');
    root.className = 'sbt' + (this.tall ? ' tall' : '');
    root.setAttribute('data-sb-ui', '');
    root.innerHTML = `
<div class="sbt-sheet" role="dialog" aria-label="Tuner">
  <button class="sbt-grab" type="button" aria-label="Taller / shorter"><i></i></button>
  <div class="sbt-head">
    <div class="sbt-title">Tuner<span class="sbt-badge"></span></div>
    <input class="sbt-filter" type="search" placeholder="Filter" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" />
    <button class="sbt-mini" type="button" data-act="resetAll">Reset all</button>
  </div>
  <div class="sbt-chips"></div>
  <div class="sbt-scroll"></div>
  <div class="sbt-copy"><textarea readonly></textarea><div class="sbt-copy-row"><span>Long-press to copy</span><button type="button" class="sbt-btn" data-act="copyDone">Done</button></div></div>
  <div class="sbt-toast"></div>
  <div class="sbt-foot">
    <button type="button" class="sbt-btn" data-act="copy">Copy JSON</button>
    <button type="button" class="sbt-btn sbt-warnbtn" data-act="resetPaint">Reset paint</button>
    <button type="button" class="sbt-btn" data-act="fps">FPS</button>
    <button type="button" class="sbt-btn sbt-close" data-act="close">Close</button>
  </div>
</div>`;
    const q = <T extends HTMLElement>(c: string) => root.querySelector(c) as T;
    this.sheet = q('.sbt-sheet');
    this.scroller = q('.sbt-scroll');
    this.chips = q('.sbt-chips');
    this.badge = q('.sbt-badge');
    this.filter = q<HTMLInputElement>('.sbt-filter');
    this.toastEl = q('.sbt-toast');
    this.fpsBtn = q('[data-act="fps"]');
    this.copyBox = q('.sbt-copy');
    this.copyArea = q<HTMLTextAreaElement>('.sbt-copy textarea');
    this.root = root;
    document.body.appendChild(root);

    q('.sbt-grab').addEventListener('click', () => {
      this.tall = !this.tall;
      root.classList.toggle('tall', this.tall);
      this.saveUi();
    });
    this.filter.addEventListener('input', () => this.applyFilter());
    this.filter.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') this.filter.blur();
    });
    this.sheet.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (b) this.act(b.dataset.act!, b);
    });
    // The sheet never lets a touch fall through to the game or the page.
    const stop = (e: Event) => e.stopPropagation();
    for (const ev of ['pointerdown', 'pointerup', 'touchstart', 'touchend']) this.sheet.addEventListener(ev, stop);
    this.sheet.addEventListener('touchmove', (e) => {
      // allow native scrolling only inside the list, the chips and the copy box
      const t = e.target as HTMLElement;
      if (!t.closest('.sbt-scroll, .sbt-chips, .sbt-copy textarea') && e.cancelable) e.preventDefault();
    }, { passive: false });

    // rows: delegated scrub / double-tap / step buttons
    const sc = this.scroller;
    sc.addEventListener('pointerdown', (e) => this.rowDown(e));
    sc.addEventListener('pointermove', (e) => this.rowMove(e));
    sc.addEventListener('pointerup', (e) => this.rowUp(e, false));
    sc.addEventListener('pointercancel', (e) => this.rowUp(e, true));
    sc.addEventListener('click', (e) => {
      const head = (e.target as HTMLElement).closest('.sbt-sec-head') as HTMLElement | null;
      if (!head) return;
      const sec = this.sections.find((s) => s.head === head);
      if (sec) this.setOpen(sec, !sec.open);
    });
    sc.addEventListener('contextmenu', (e) => e.preventDefault());
    this.chips.addEventListener('click', (e) => {
      const chip = (e.target as HTMLElement).closest('.sbt-chip') as HTMLElement | null;
      const sec = chip && this.sections.find((s) => s.chip === chip);
      if (!sec) return;
      if (this.filter.value) {
        this.filter.value = '';
        this.applyFilter();
      }
      this.setOpen(sec, true);
      sc.scrollTo({ top: sec.el.offsetTop - 2, behavior: 'smooth' });
    });
  }

  private rebuild() {
    if (!this.root) return;
    this.dirty = false;
    const keepScroll = this.scroller.scrollTop;
    this.scroller.textContent = '';
    this.chips.textContent = '';
    this.sections = [];
    this.rows = [];
    this.rowByEl.clear();
    this.lastTap = null;
    this.scrub = null;

    const hint = document.createElement('div');
    hint.className = 'sbt-hint';
    hint.textContent = 'Drag a row sideways · hold − + to nudge · double-tap resets';
    this.scroller.appendChild(hint);
    if (this.credits) {
      const cr = document.createElement('div');
      cr.className = 'sbt-hint';
      cr.textContent = this.credits;
      this.scroller.appendChild(cr);
    }

    // config blocks
    const bySection = new Map<string, Array<{ obj: Record<string, unknown>; key: string; path: string }>>();
    walkConfig((obj, key, path, section) => {
      let list = bySection.get(section);
      if (!list) bySection.set(section, (list = []));
      list.push({ obj, key, path });
    });
    for (const [section, list] of bySection) {
      const sec = this.addSection(`c:${section}`, cap(section), 'config');
      for (const f of list) {
        const def = configDefaults.has(f.path) ? configDefaults.get(f.path)! : (f.obj[f.key] as Val);
        const label = f.path.slice(section.length + 1);
        this.addRow(sec, f.obj, f.key, label, def, undefined, f.path, null);
      }
    }
    // registered module groups
    for (const g of tunableGroups()) {
      adoptGroup(g);
      const defs = groupDefaults.get(g.values)!;
      if (!defs.size) continue;
      const sec = this.addSection(`g:${g.name}`, g.name, 'module');
      for (const [key, def] of defs) this.addRow(sec, g.values, key, key, def, g.ranges?.[key], null, g.name);
    }
    for (const s of this.sections) this.updateCount(s);
    this.updateBadge();
    this.applyFilter();
    if (this.everBuilt) this.scroller.scrollTop = keepScroll;
    else {
      // first open: land on the first unfolded section, not on a wall of headers
      this.everBuilt = true;
      const first = this.sections.find((s) => s.open);
      if (first) this.scroller.scrollTop = first.el.offsetTop;
    }
  }

  private addSection(id: string, title: string, caption: string): Section {
    const hue = this.sections.length % HUES.length;
    const H = HUES[hue];
    const el = document.createElement('section');
    el.className = 'sbt-sec';
    el.style.setProperty('--hue', H.base);
    el.style.setProperty('--hue-l', H.light);
    el.style.setProperty('--hue-d', H.deep);
    el.innerHTML = `<div class="sbt-sec-head"><i class="sbt-bar"></i><span class="sbt-sec-title"></span><span class="sbt-cap"></span><span class="sbt-count"></span><span class="sbt-chev"></span></div><div class="sbt-sec-body"></div>`;
    (el.querySelector('.sbt-sec-title') as HTMLElement).textContent = title;
    (el.querySelector('.sbt-cap') as HTMLElement).textContent = caption;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'sbt-chip';
    chip.style.setProperty('--hue', H.base);
    chip.style.setProperty('--hue-d', H.deep);
    const clash = this.sections.some((o) => o.title.toLowerCase() === title.toLowerCase());
    chip.textContent = clash ? `${title} · ${caption}` : title;
    this.chips.appendChild(chip);
    const sec: Section = {
      id,
      title,
      caption,
      hue,
      el,
      head: el.querySelector('.sbt-sec-head') as HTMLElement,
      body: el.querySelector('.sbt-sec-body') as HTMLElement,
      countEl: el.querySelector('.sbt-count') as HTMLElement,
      chip,
      rows: [],
      open: this.openIds.has(id),
    };
    el.classList.toggle('open', sec.open);
    this.scroller.appendChild(el);
    this.sections.push(sec);
    return sec;
  }

  private addRow(sec: Section, obj: Record<string, unknown>, key: string, label: string, def: Val, explicit: [number, number, number?] | undefined, cfgPath: string | null, group: string | null) {
    const cur = obj[key];
    const kind = typeof def === 'boolean' ? 'bool' : 'num';
    let min = 0, max = 1, step = 1, dec = 0;
    if (kind === 'num') {
      [min, max, step] = inferRange(def as number, typeof cur === 'number' ? cur : (def as number), key, explicit);
      dec = decimalsOf(step);
    }
    const el = document.createElement('div');
    el.className = 'sbt-row' + (kind === 'bool' ? ' sbt-bool' : '');
    el.innerHTML =
      kind === 'num'
        ? `<div class="sbt-scrub"><div class="sbt-line"><span class="sbt-name"></span><span class="sbt-val"></span></div><div class="sbt-track"><i class="sbt-fill"></i><b class="sbt-tick"></b></div></div><button type="button" class="sbt-step" data-d="-1" aria-label="less">−</button><button type="button" class="sbt-step" data-d="1" aria-label="more">+</button>`
        : `<div class="sbt-scrub"><div class="sbt-line"><span class="sbt-name"></span><span class="sbt-val"></span></div></div><span class="sbt-switch"><i></i></span>`;
    const nameEl = el.querySelector('.sbt-name') as HTMLElement;
    nameEl.textContent = label;
    const row: Row = {
      el,
      nameEl,
      valEl: el.querySelector('.sbt-val') as HTMLElement,
      fill: el.querySelector('.sbt-fill') as HTMLElement | null,
      sec,
      obj,
      key,
      def,
      kind,
      min,
      max,
      step,
      dec,
      cfgPath,
      group,
      shown: undefined,
      search: `${sec.title} ${label}`.toLowerCase(),
    };
    if (kind === 'num') {
      const tick = el.querySelector('.sbt-tick') as HTMLElement;
      tick.style.left = `${(clamp01(((def as number) - min) / (max - min || 1)) * 100).toFixed(2)}%`;
    }
    sec.body.appendChild(el);
    sec.rows.push(row);
    this.rows.push(row);
    this.rowByEl.set(el, row);
    this.paintRow(row);
  }

  private paintRow(row: Row) {
    const v = row.obj[row.key] as Val;
    row.shown = v;
    const changed = !sameVal(v, row.def, row);
    row.el.classList.toggle('changed', changed);
    if (row.kind === 'bool') {
      row.valEl.textContent = v ? 'on' : 'off';
      row.el.classList.toggle('on', !!v);
      return;
    }
    const n = v as number;
    row.valEl.textContent = fmt(n, row.dec);
    if (row.fill) row.fill.style.transform = `scaleX(${clamp01((n - row.min) / (row.max - row.min || 1)).toFixed(4)})`;
  }

  private refreshAll() {
    for (const r of this.rows) if (!sameRaw(r.obj[r.key], r.shown)) this.paintRow(r);
    for (const s of this.sections) this.updateCount(s);
    this.updateBadge();
  }

  /** Modules may change their own tunables (e.g. audio volumes): keep the open rows honest. */
  private poll() {
    for (const s of this.sections) {
      if (!s.open && !this.filter.value) continue;
      let any = false;
      for (const r of s.rows) {
        if (!sameRaw(r.obj[r.key], r.shown)) {
          this.paintRow(r);
          any = true;
        }
      }
      if (any) this.updateCount(s);
    }
    if (this.armed && performance.now() - this.armed.t > 2600) this.disarm();
  }

  private updateCount(s: Section) {
    let n = 0;
    for (const r of s.rows) if (!sameVal(r.obj[r.key] as Val, r.def, r)) n++;
    s.countEl.textContent = n ? String(n) : '';
    s.chip.classList.toggle('changed', n > 0);
  }

  private updateBadge() {
    let n = Object.keys(store.config).length;
    for (const g of Object.keys(store.groups)) n += Object.keys(store.groups[g]).length;
    this.badge.textContent = n ? `${n} changed` : '';
  }

  private setOpen(sec: Section, open: boolean) {
    sec.open = open;
    sec.el.classList.toggle('open', open);
    if (open) {
      this.openIds.add(sec.id);
      for (const r of sec.rows) if (!sameRaw(r.obj[r.key], r.shown)) this.paintRow(r);
    } else this.openIds.delete(sec.id);
    this.saveUi();
  }

  private applyFilter() {
    const f = this.filter.value.trim().toLowerCase();
    this.root?.classList.toggle('filtering', !!f);
    for (const s of this.sections) {
      let hits = 0;
      for (const r of s.rows) {
        const hit = !f || r.search.includes(f);
        r.el.classList.toggle('miss', !hit);
        if (hit) hits++;
      }
      s.el.classList.toggle('miss', !!f && hits === 0);
    }
  }

  private saveUi() {
    writeJSON(UI_KEY, { open: [...this.openIds], tall: this.tall });
  }

  // ---------------------------------------------------------------- values

  private setValue(row: Row, v: Val) {
    if (row.kind === 'num') {
      let n = Math.min(row.max, Math.max(row.min, v as number));
      n = Math.round(n / row.step) * row.step;
      n = Number(n.toFixed(Math.min(10, row.dec + 2)));
      if (Math.abs(n - (row.def as number)) < row.step * 0.5) n = row.def as number;
      v = n;
    }
    if (sameRaw(row.obj[row.key], v)) return;
    row.obj[row.key] = v;
    const isDef = sameRaw(v, row.def);
    if (row.cfgPath) {
      if (isDef) delete store.config[row.cfgPath];
      else store.config[row.cfgPath] = v;
      if (row.cfgPath === 'render.pixelWidth' || row.cfgPath === 'render.maxPixelScale') this.resizeSoon();
    } else if (row.group) {
      const g = (store.groups[row.group] ??= {});
      if (isDef) delete g[row.key];
      else g[row.key] = v;
      if (!Object.keys(g).length) delete store.groups[row.group];
    }
    saveSoon();
    this.paintRow(row);
    this.updateCount(row.sec);
    this.updateBadge();
  }

  private nudge(row: Row, dir: number) {
    if (row.kind === 'bool') this.setValue(row, !row.obj[row.key]);
    else this.setValue(row, (row.obj[row.key] as number) + dir * row.step);
  }

  private resizeSoon() {
    window.clearTimeout(this.resizeT);
    this.resizeT = window.setTimeout(() => window.dispatchEvent(new Event('resize')), 160);
  }

  // ---------------------------------------------------------------- row gestures

  private rowDown(e: PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const t = e.target as HTMLElement;
    const rowEl = t.closest('.sbt-row') as HTMLElement | null;
    const row = rowEl && this.rowByEl.get(rowEl);
    if (!row) return;
    const stepBtn = t.closest('.sbt-step') as HTMLElement | null;
    if (stepBtn) {
      e.preventDefault();
      const dir = Number(stepBtn.dataset.d) || 1;
      this.nudge(row, dir);
      stepBtn.classList.add('down');
      this.stopRepeat();
      this.repeatT = window.setTimeout(() => {
        let n = 0;
        this.repeatI = window.setInterval(() => {
          // accelerate after a while so long holds cover the range
          this.nudge(row, dir * (++n > 25 ? 5 : 1));
        }, 55);
      }, 380);
      const up = () => {
        stepBtn.classList.remove('down');
        this.stopRepeat();
        stepBtn.removeEventListener('pointerup', up);
        stepBtn.removeEventListener('pointercancel', up);
        stepBtn.removeEventListener('pointerleave', up);
      };
      stepBtn.addEventListener('pointerup', up);
      stepBtn.addEventListener('pointercancel', up);
      stepBtn.addEventListener('pointerleave', up);
      return;
    }
    const track = (row.el.querySelector('.sbt-track') as HTMLElement | null) ?? row.el;
    this.scrub = {
      row,
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      v0: row.kind === 'num' ? (row.obj[row.key] as number) : 0,
      t0: performance.now(),
      active: false,
      ax: e.clientX,
      vertical: false,
      width: Math.max(60, track.getBoundingClientRect().width),
    };
    try {
      row.el.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  private rowMove(e: PointerEvent) {
    const s = this.scrub;
    if (!s || s.id !== e.pointerId || s.vertical) return;
    const dx = e.clientX - s.x0;
    const dy = e.clientY - s.y0;
    if (!s.active) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        s.vertical = true; // a scroll (mouse / pen); touch gets pointercancel instead
        return;
      }
      if (s.row.kind === 'num' && Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        s.active = true;
        s.ax = e.clientX;
        s.row.el.classList.add('scrubbing');
      }
      return;
    }
    const r = s.row;
    this.setValue(r, s.v0 + ((e.clientX - s.ax) / s.width) * (r.max - r.min));
  }

  private rowUp(e: PointerEvent, cancelled: boolean) {
    const s = this.scrub;
    if (!s || s.id !== e.pointerId) return;
    this.scrub = null;
    const r = s.row;
    r.el.classList.remove('scrubbing');
    if (cancelled) {
      if (s.active) this.setValue(r, s.v0); // the browser took the touch for a scroll
      return;
    }
    if (s.active || s.vertical) return;
    const now = performance.now();
    const still = Math.hypot(e.clientX - s.x0, e.clientY - s.y0) < 12;
    if (!still || now - s.t0 > 400) return;
    if (r.kind === 'bool') {
      this.nudge(r, 1);
      return;
    }
    // double-tap = reset to default
    if (this.lastTap && this.lastTap.row === r && now - this.lastTap.t < 340) {
      this.lastTap = null;
      this.setValue(r, r.def);
      r.el.classList.remove('flash');
      void r.el.offsetWidth;
      r.el.classList.add('flash');
    } else this.lastTap = { row: r, t: now };
  }

  private stopRepeat() {
    window.clearTimeout(this.repeatT);
    window.clearInterval(this.repeatI);
    this.repeatT = this.repeatI = 0;
  }

  // ---------------------------------------------------------------- buttons

  private act(name: string, btn: HTMLElement) {
    switch (name) {
      case 'close':
        this.toggle();
        return;
      case 'copy':
        this.copyJson();
        break;
      case 'copyDone':
        this.copyBox.classList.remove('open');
        this.copyArea.blur();
        return;
      case 'fps': {
        const p = Perf.active;
        if (p) p.setVisible(!p.visible);
        else this.toast('No perf meter on this page');
        this.syncFps();
        break;
      }
      case 'resetPaint':
        if (!this.arm(btn, 'Tap again')) return;
        this.toast('Paint reset');
        this.onResetPaint?.();
        break;
      case 'resetAll':
        if (!this.arm(btn, 'Sure?')) return;
        this.resetAll();
        break;
      default:
        return;
    }
    this.onAction?.(name);
  }

  /** Two-tap confirm for destructive buttons. Returns true on the confirming tap. */
  private arm(btn: HTMLElement, label: string): boolean {
    if (this.armed && this.armed.el === btn && performance.now() - this.armed.t < 2600) {
      this.disarm();
      return true;
    }
    this.disarm();
    this.armed = { el: btn, label: btn.textContent ?? '', t: performance.now() };
    btn.textContent = label;
    btn.classList.add('armed');
    return false;
  }

  private disarm() {
    const a = this.armed;
    if (!a) return;
    a.el.textContent = a.label;
    a.el.classList.remove('armed');
    this.armed = null;
  }

  private resetAll() {
    for (const r of this.rows) {
      if (!sameRaw(r.obj[r.key], r.def)) {
        r.obj[r.key] = r.def;
        if (r.cfgPath === 'render.pixelWidth' || r.cfgPath === 'render.maxPixelScale') this.resizeSoon();
      }
      this.paintRow(r);
    }
    store = { config: {}, groups: {} };
    writeJSON(STORE_KEY, store);
    for (const s of this.sections) this.updateCount(s);
    this.updateBadge();
    this.toast('All values back to defaults');
  }

  private syncFps() {
    this.fpsBtn.classList.toggle('on', !!Perf.active?.visible);
  }

  /** Changed values only, nested: { config: { flight: { stretchPx: 80 } }, Bus: { light: 0.1 } }. */
  private changesJson(): { json: string; count: number } {
    const out: Record<string, unknown> = {};
    let count = 0;
    const cfg: Record<string, unknown> = {};
    for (const path of Object.keys(store.config).sort()) {
      const parts = path.split('.');
      let o = cfg;
      for (let i = 0; i < parts.length - 1; i++) o = (o[parts[i]] ??= {}) as Record<string, unknown>;
      o[parts[parts.length - 1]] = store.config[path];
      count++;
    }
    if (count) out.config = cfg;
    for (const g of Object.keys(store.groups)) {
      const vals = store.groups[g];
      const keys = Object.keys(vals);
      if (!keys.length) continue;
      out[g] = vals;
      count += keys.length;
    }
    return { json: JSON.stringify(out, null, 2), count };
  }

  private copyJson() {
    const { json, count } = this.changesJson();
    console.info('[tuner] changed values:\n' + json);
    if (!count) {
      this.toast('Nothing changed yet');
      return;
    }
    const msg = `Copied ${count} value${count === 1 ? '' : 's'}`;
    const clip = navigator.clipboard;
    if (window.isSecureContext && clip && typeof clip.writeText === 'function') {
      clip.writeText(json).then(
        () => this.toast(msg),
        () => this.copyFallback(json, msg),
      );
    } else this.copyFallback(json, msg);
  }

  /** No async clipboard (plain-http LAN dev server on the phone): select + execCommand, and leave the text up to long-press. */
  private copyFallback(json: string, msg: string) {
    const ta = this.copyArea;
    ta.value = json;
    this.copyBox.classList.add('open');
    let ok = false;
    try {
      ta.readOnly = false;
      ta.focus({ preventScroll: true });
      ta.select();
      ta.setSelectionRange(0, json.length);
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.readOnly = true;
    if (ok) {
      this.toast(msg);
      this.copyBox.classList.remove('open');
      ta.blur();
    } else this.toast('Select the text to copy it');
  }

  private toast(text: string) {
    const t = this.toastEl;
    t.textContent = text;
    t.classList.add('show');
    window.clearTimeout(this.toastT);
    this.toastT = window.setTimeout(() => t.classList.remove('show'), 1800);
  }
}

// ------------------------------------------------------------------ utils

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function sameRaw(a: unknown, b: unknown): boolean {
  return a === b || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-12);
}

function sameVal(v: Val, def: Val, row: Row): boolean {
  if (row.kind === 'bool') return v === def;
  return Math.abs((v as number) - (def as number)) < Math.max(1e-12, row.step * 1e-3);
}

function fmt(v: number, dec: number): string {
  if (!Number.isFinite(v)) return String(v);
  const s = v.toFixed(dec);
  return s === '-0' || /^-0\.0*$/.test(s) ? s.slice(1) : s;
}

function installStyle() {
  if (document.getElementById('sbt-style')) return;
  const st = document.createElement('style');
  st.id = 'sbt-style';
  st.textContent = `
.sbt{position:fixed;inset:0;z-index:1000;display:none;pointer-events:none;color:#e2e4e5;
  font:15px/1.25 -apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",system-ui,sans-serif;
  -webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;text-size-adjust:100%}
.sbt.open{display:block}
.sbt *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
.sbt button{font:inherit;color:inherit;border:0;margin:0;background:none;cursor:pointer;touch-action:manipulation}
.sbt-sheet{position:absolute;left:0;right:0;bottom:0;margin:0 auto;max-width:560px;height:62%;
  max-height:calc(100% - env(safe-area-inset-top) - 6px);display:flex;flex-direction:column;pointer-events:auto;
  background:rgba(13,17,24,.86);border-radius:18px 18px 0 0;
  box-shadow:0 -1px 0 rgba(255,255,255,.09),0 -12px 40px rgba(0,0,0,.38);
  user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;touch-action:none;overflow:hidden}
.sbt.tall .sbt-sheet{height:92%}
.sbt-grab{flex:none;height:20px;display:flex;align-items:center;justify-content:center}
.sbt-grab i{display:block;width:40px;height:5px;border-radius:3px;background:rgba(255,255,255,.28)}
.sbt-head{flex:none;display:flex;align-items:center;gap:8px;padding:0 12px 8px}
.sbt-title{font-weight:700;font-size:17px;letter-spacing:.2px;color:#fffbe8;white-space:nowrap;display:flex;align-items:baseline;gap:7px}
.sbt-badge{font-size:12px;font-weight:600;color:#ffd23e}
.sbt-badge:empty{display:none}
.sbt-filter{flex:1;min-width:0;height:36px;border-radius:10px;border:0;outline:0;padding:0 11px;
  background:rgba(255,255,255,.08);color:#fffbe8;font:16px -apple-system,BlinkMacSystemFont,system-ui,sans-serif;
  -webkit-appearance:none;appearance:none;user-select:text;-webkit-user-select:text}
.sbt-filter::placeholder{color:#808a94}
.sbt-filter:focus{background:rgba(255,255,255,.13)}
.sbt-mini{flex:none;height:36px;padding:0 10px;border-radius:10px;font-size:13px!important;font-weight:600;color:#bbc1c6!important;background:rgba(255,255,255,.06)!important}
.sbt-mini.armed{color:#fff!important;background:#b02a55!important}
.sbt-chips{flex:none;display:flex;gap:6px;overflow-x:auto;overflow-y:hidden;padding:0 12px 9px;touch-action:pan-x;
  scrollbar-width:none;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
.sbt-chips::-webkit-scrollbar{display:none}
.sbt-chip{flex:none;height:32px;padding:0 12px;border-radius:16px;font-size:13px!important;font-weight:600;
  background:rgba(255,255,255,.07)!important;color:#d6d4cd!important;box-shadow:inset 3px 0 0 var(--hue)}
.sbt-chip.changed{background:var(--hue-d)!important;color:#fff!important}
.sbt-scroll{position:relative;flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;touch-action:pan-y;overscroll-behavior:contain;
  -webkit-overflow-scrolling:touch;border-top:1px solid rgba(255,255,255,.07);padding-bottom:10px}
.sbt-hint{padding:9px 14px 7px;font-size:12px;color:#808a94}
.sbt.filtering .sbt-hint{display:none}
.sbt-sec{border-bottom:1px solid rgba(255,255,255,.05)}
.sbt-sec.miss{display:none}
.sbt-sec-head{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:8px;height:48px;padding:0 14px 0 0;
  background:#161b23;cursor:pointer}
.sbt-bar{align-self:stretch;width:5px;background:var(--hue);margin-right:7px}
.sbt-sec-title{font-weight:650;font-size:16px;color:#fffbe8}
.sbt-cap{font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:#6e7984}
.sbt-count{margin-left:auto;min-width:22px;height:22px;padding:0 7px;border-radius:11px;background:var(--hue);color:#0b0e13;
  font-size:12px;font-weight:700;line-height:22px;text-align:center}
.sbt-count:empty{display:none}
.sbt-chev{width:22px;text-align:center;color:#808a94;font-size:13px}
.sbt-count:empty+.sbt-chev{margin-left:auto}
.sbt-chev::after{content:"▸";display:inline-block;transition:transform .15s}
.sbt-sec.open .sbt-chev::after{transform:rotate(90deg)}
.sbt-sec-body{display:none}
.sbt-sec.open .sbt-sec-body,.sbt.filtering .sbt-sec-body{display:block}
.sbt-row{display:flex;align-items:stretch;min-height:56px;border-top:1px solid rgba(255,255,255,.045);touch-action:pan-y}
.sbt-row.miss{display:none}
.sbt-scrub{flex:1;min-width:0;padding:9px 6px 9px 18px;display:flex;flex-direction:column;justify-content:center;gap:8px;cursor:ew-resize}
.sbt-line{display:flex;align-items:baseline;gap:8px}
.sbt-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;color:#cfd3d6}
.sbt-val{flex:none;font:600 14px ui-monospace,"SF Mono",Menlo,monospace;font-variant-numeric:tabular-nums;color:#fffbe8}
.sbt-row.changed .sbt-name{color:var(--hue-l);font-weight:600}
.sbt-row.changed .sbt-name::before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--hue);margin:0 6px 1px 0}
.sbt-track{position:relative;height:6px;border-radius:3px;background:rgba(255,255,255,.11)}
.sbt-fill{position:absolute;inset:0;border-radius:3px;background:var(--hue);transform-origin:0 50%;transform:scaleX(0)}
.sbt-tick{position:absolute;top:-3px;width:2px;height:12px;margin-left:-1px;border-radius:1px;background:rgba(255,251,232,.55)}
.sbt-row.scrubbing{background:rgba(255,255,255,.05)}
.sbt-row.scrubbing .sbt-track{height:8px;margin:-1px 0}
.sbt-row.flash{animation:sbtflash .5s ease-out}
@keyframes sbtflash{from{background:var(--hue-d)}to{background:transparent}}
.sbt-step{flex:none;width:46px;font-size:22px!important;font-weight:500;color:#bbc1c6!important}
.sbt-step:last-child{margin-right:4px}
.sbt-step.down{color:#0b0e13!important;background:var(--hue)!important;border-radius:12px}
.sbt-bool .sbt-scrub{cursor:pointer}
.sbt-switch{flex:none;align-self:center;width:50px;height:30px;margin:0 14px 0 6px;border-radius:15px;background:rgba(255,255,255,.14);position:relative}
.sbt-switch i{position:absolute;top:3px;left:3px;width:24px;height:24px;border-radius:12px;background:#d6d4cd;transition:transform .15s}
.sbt-bool.on .sbt-switch{background:var(--hue)}
.sbt-bool.on .sbt-switch i{transform:translateX(20px);background:#fff}
.sbt-foot{flex:none;display:flex;gap:8px;padding:9px 10px calc(9px + env(safe-area-inset-bottom));border-top:1px solid rgba(255,255,255,.08);background:rgba(10,13,18,.6)}
.sbt-btn{flex:1;min-width:0;height:50px;border-radius:13px;background:rgba(255,255,255,.09)!important;font-size:14px!important;font-weight:650;color:#fffbe8!important;white-space:nowrap}
.sbt-btn:active{background:rgba(255,255,255,.18)!important}
.sbt-btn.on{background:#1f45a8!important;box-shadow:inset 0 0 0 1px #6cc0ff}
.sbt-warnbtn{color:#ffd6cf!important}
.sbt-btn.armed{background:#b02a55!important;color:#fff!important}
.sbt-close{background:#fbbf24!important;color:#0b0e13!important;box-shadow:inset 0 -3px 0 #d8722a}
.sbt-close:active{background:#ffd94a!important}
.sbt-toast{position:absolute;left:50%;bottom:calc(84px + env(safe-area-inset-bottom));transform:translate(-50%,8px);opacity:0;pointer-events:none;
  padding:9px 15px;border-radius:12px;background:rgba(255,251,232,.95);color:#0b0e13;font-size:14px;font-weight:600;white-space:nowrap;
  transition:opacity .18s,transform .18s;box-shadow:0 6px 20px rgba(0,0,0,.3)}
.sbt-toast.show{opacity:1;transform:translate(-50%,0)}
.sbt-copy{display:none;position:absolute;left:10px;right:10px;bottom:calc(76px + env(safe-area-inset-bottom));z-index:3;padding:10px;border-radius:14px;
  background:#141921;box-shadow:0 0 0 1px rgba(255,255,255,.1),0 10px 30px rgba(0,0,0,.45)}
.sbt-copy.open{display:block}
.sbt-copy textarea{display:block;width:100%;height:180px;resize:none;border:0;outline:0;border-radius:9px;padding:9px;background:#0b0e13;color:#e6ffc4;
  font:12px/1.35 ui-monospace,"SF Mono",Menlo,monospace;user-select:text;-webkit-user-select:text;-webkit-touch-callout:default;touch-action:pan-y}
.sbt-copy-row{display:flex;align-items:center;gap:10px;margin-top:8px;font-size:13px;color:#a7aeb5}
.sbt-copy-row span{flex:1}
.sbt-copy-row .sbt-btn{flex:none;width:96px;height:42px}
@media (hover:hover){.sbt-step:hover,.sbt-sec-head:hover{background:rgba(255,255,255,.04)}}
`;
  document.head.appendChild(st);
}
