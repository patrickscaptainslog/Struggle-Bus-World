// The postcard's link (docs/specs/core/LINK.md, M1's task 6): the text after the #, written and read. A card is a place, a crew, a minute and a caption
// (the head); then, where squares were lifted, which ones and how high (the core); then the order they climbed in (the tail). Each of the three carries its
// own length and its own check, so a link an app cut short or bent still lands as much as it still holds: the whole card, the squares with a made-up order,
// the place alone, and at the last the neighbourhood in its path. Outcomes only: nothing here is a tap. Reading is total: any text at all gives an answer and
// never throws. Pure and worker-safe: no DOM, no BigInt, nothing a Safari 15 can't parse. index.html's stamp has its own small reader of the head
// (stamp.js), held to this one by tools/link/fuzz.mjs.

/** The 32 characters a card is written in: digits and lower-case letters without i, l, o and u. A reader takes either case, and I, L and O as 1, 1 and 0. */
export const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const VAL = new Int8Array(128).fill(-1);
for (let i = 0; i < 32; i++) {
  VAL[ALPHABET.charCodeAt(i)] = i;
  VAL[ALPHABET.toUpperCase().charCodeAt(i)] = i;
}
for (const [c, v] of [['i', 1], ['l', 1], ['o', 0]] as const) {
  VAL[c.charCodeAt(0)] = v;
  VAL[c.toUpperCase().charCodeAt(0)] = v;
}

/** A caption's characters, six bits each. Codes 40 to 45 are kept back (they were . / , ! ? #): a card can't spell an address. */
export const CAPTION = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 &'-\0\0\0\0\0\0\u00c9\u00c8\u00c1\u00c0\u00cd\u00d3\u00da\u00dc\u00d6\u00c4\u00d1\u00c7\u00c5\u00d8\u00c6\u00cf\u00ca\u00d4";
const CAPV = new Map<string, number>();
for (let i = 0; i < 64; i++) if (CAPTION[i] !== '\0') CAPV.set(CAPTION[i], i);

export const linkTune = {
  /** the format this file writes: the card's first character */
  version: '1',
  /** the most squares a card names, and the side of the box they sit in */
  squares: 32,
  box: 16,
  /** a caption's most characters */
  caption: 40,
  /** a landmark's key at its longest */
  key: 16,
  /** the crews this build knows, and the most the head can name */
  crews: 5,
  crewMost: 15,
  /** a square's top stage on a card: the Lift. A god (5) is never on one */
  top: 4,
  /** the most text read: the rest is not looked at */
  input: 4096,
  /** the path: a page name's and a source tag's most characters, the last generation counted */
  place: 48,
  tag: 16,
  gen: 99,
  /** the card's minute counts from here (2026-01-01T00:00Z, epoch s), over 25 bits: to 2089 */
  epoch: 1767225600,
  atMost: 2 ** 25 - 1,
};
/** check characters: the head's and the tail's 3 (15 bits), the core's 6 (30) */
const CHECK = { head: 3, core: 6, tail: 3 } as const;
/** CRC-15/CAN's and CRC-30/CDMA's generators, the top bit left off */
const POLY: Record<number, number> = { 3: 0x4599, 6: 0x2030b9c7 };

/** One lifted square: where, and its stage (1 to 4). */
export interface CardSquare {
  ix: number;
  iz: number;
  stage: number;
}
export interface SquaresBody {
  form: 'squares';
  /** sorted by iz, then ix; the card's own square among them; all within a 16 x 16 box */
  squares: CardSquare[];
  /** the order they climbed in: indexes into `squares`, each square's exactly as often as its stage. Its k-th is "reached stage k" */
  order: number[];
  /** the card this one answers (its id30), or null */
  answers: number | null;
  /** a card of today's place: the paint it had and what it used. A ghost: shown, never landed */
  score: { budget: number; used: number } | null;
}
export interface MarkBody {
  form: 'mark';
  /** the landmark, as city.json's `kind` in capitals: GGB */
  key: string;
  stage: number;
  answers: number | null;
}
export interface Card {
  v: 1;
  /** the city's number: 0 is San Francisco */
  map: number;
  /** the card's own square: where the bus lands */
  ix: number;
  iz: number;
  /** the sender's crew: 1 to 5 written, and a head read up to 15 for a later build's */
  crew: number;
  /** the postmark: minutes since 2026-01-01T00:00Z */
  at: number;
  caption: string;
  body: SquaresBody | MarkBody | null;
}

/**
 * What a text read as. `level` is how much of the card held: 'full' all the head promised, 'core' the squares with the order lost (a made-up order stands
 * in), 'head' the place, crew, minute and caption alone, 'none' nothing. `why` says what was lost, '' at 'full'.
 */
export interface Read {
  level: 'none' | 'head' | 'core' | 'full';
  why: string;
  card: Card | null;
  /** what makes two cards the same card: the text through the core's check, or a card without a core's whole text. '' at 'none' and at a torn 'head' */
  id: string;
  /** the same in 30 bits, for a square's record and for `answers`; -1 where there's no id */
  id30: number;
  /** what a newcomer's crew is dealt by: the head's text in 30 bits, the same for a link whole or torn; -1 at 'none' */
  seed: number;
  /** the text as this build would write what it read */
  canon: string;
  /** the tags of blocks passed over: a newer build's, which this one may skip */
  skipped: number[];
}

// ---- the check ----

/** A CRC over the text's 5-bit characters, `n` bits wide, all ones to start. Any damage that fits in n neighbouring bits is always caught. */
export function crc(text: string, n: number, poly: number): number {
  const mask = 2 ** n - 1, top = 2 ** (n - 1);
  let r = mask;
  for (let i = 0; i < text.length; i++) {
    const v = VAL[text.charCodeAt(i)];
    for (let b = 4; b >= 0; b--) {
      const fb = ((v >> b) & 1) ^ (r >= top ? 1 : 0);
      r = (r * 2) & mask;
      if (fb) r ^= poly;
    }
  }
  return r;
}
function chars(v: number, n: number): string {
  let s = '';
  for (let i = n - 1; i >= 0; i--) s += ALPHABET[Math.floor(v / 2 ** (5 * i)) % 32];
  return s;
}
const checkOf = (text: string, k: number): string => chars(crc(text, 5 * k, POLY[k]), k);

// ---- bits ----

class Writer {
  bits: number[] = [];
  u(v: number, n: number): void {
    for (let i = n - 1; i >= 0; i--) this.bits.push(Math.floor(v / 2 ** i) % 2);
  }
  /** a whole number in groups of four bits, the biggest first, each behind a bit that says another follows: one character a group */
  uv(v: number): void {
    let g = 1;
    while (v >= 16 ** g) g++;
    for (let i = g - 1; i >= 0; i--) {
      this.u(i ? 1 : 0, 1);
      this.u(Math.floor(v / 16 ** i) % 16, 4);
    }
  }
  /** a signed one: 0, -1, 1, -2, ... */
  zz(v: number): void {
    this.uv(v >= 0 ? 2 * v : -2 * v - 1);
  }
  text(): string {
    const b = this.bits.slice();
    while (b.length % 5) b.push(0);
    let s = '';
    for (let i = 0; i < b.length; i += 5) s += ALPHABET[b[i] * 16 + b[i + 1] * 8 + b[i + 2] * 4 + b[i + 3] * 2 + b[i + 4]];
    return s;
  }
}
class Reader {
  text: string;
  p = 0;
  n: number;
  bad = false;
  constructor(text: string) {
    this.text = text;
    this.n = text.length * 5;
  }
  u(n: number): number {
    if (this.p + n > this.n) {
      this.bad = true;
      this.p = this.n;
      return 0;
    }
    let v = 0;
    for (let i = 0; i < n; i++, this.p++) v = v * 2 + ((VAL[this.text.charCodeAt((this.p / 5) | 0)] >> (4 - (this.p % 5))) & 1);
    return v;
  }
  uv(most: number): number {
    let v = 0;
    for (let g = 0; g < most; g++) {
      const more = this.u(1), d = this.u(4);
      if (g === 0 && more && d === 0) this.bad = true; // (written longer than it need be: not ours)
      v = v * 16 + d;
      if (!more) return v;
    }
    this.bad = true;
    return 0;
  }
  zz(most: number): number {
    const v = this.uv(most);
    return v % 2 ? -(v + 1) / 2 : v / 2;
  }
  left(): number {
    return this.n - this.p;
  }
  /** what's left is the padding: under five bits, all zero */
  end(): boolean {
    if (this.left() >= 5) return false;
    while (this.left() > 0) if (this.u(1)) return false;
    return !this.bad;
  }
}

/** The bits an index into n squares takes. Whole-number arithmetic only: a logarithm rounded the other way on some phone would turn every hit. */
export function indexBits(n: number): number {
  return n <= 1 ? 0 : 32 - Math.clz32(n - 1);
}

type Block = [tag: number, bits: number[]];
function section(before: string, w: Writer, k: number): string {
  const payload = w.text(), s = before + chars(payload.length, 2) + payload;
  return s + checkOf(s, k);
}
function writeBlocks(w: Writer, list: Block[]): void {
  for (const [tag, bits] of list) {
    w.u(tag, 5);
    w.uv(bits.length);
    for (const b of bits) w.u(b, 1);
  }
}
function bitsOf(f: (w: Writer) => void): number[] {
  const w = new Writer();
  f(w);
  return w.bits;
}
type Known = Record<number, (r: Reader, size: number) => boolean>;
/**
 * The blocks that close a section: a tag (5 bits, rising), a size in bits, the bits. A known one is read by `known[tag]`; an unknown one under 16 is
 * passed over, and an unknown one from 16 up refuses the section: that is how a later build adds what an old one may ignore, or must not.
 */
function readBlocks(r: Reader, known: Known, skipped: number[]): boolean {
  let last = 0;
  while (r.left() >= 5) {
    const from = r.p, tag = r.u(5);
    if (tag === 0) {
      r.p = from;
      break; // (the padding: end() says whether it is)
    }
    if (tag <= last) return false;
    last = tag;
    const size = r.uv(3);
    if (r.bad || size > r.left()) return false;
    const at = r.p, read = known[tag];
    if (read) {
      if (!read(r, size) || r.p !== at + size) return false;
    } else if (tag >= 16) return false;
    else {
      skipped.push(tag);
      r.p = at + size;
    }
  }
  return r.end();
}

// ---- what a card may say: the writer refuses what the reader would ----

const whole = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const KEY = /^[A-Z0-9-]{1,16}$/;

/** A caption a card can carry: 40 characters of the table at most, no space at either end, no two together. */
export function captionOk(c: unknown): c is string {
  if (typeof c !== 'string' || c.length > linkTune.caption) return false;
  for (let i = 0; i < c.length; i++) if (!CAPV.has(c[i])) return false;
  return !(c.startsWith(' ') || c.endsWith(' ') || c.includes('  '));
}

/** A square's index in every climb's order: each exactly as often as its stage. */
export function orderOk(order: unknown, squares: readonly CardSquare[]): order is number[] {
  if (!Array.isArray(order)) return false;
  const seen = squares.map(() => 0);
  for (const i of order) {
    if (!whole(i, 0, squares.length - 1)) return false;
    seen[i]++;
  }
  return squares.every((q, i) => seen[i] === q.stage);
}

/**
 * The order a card is shown in when its own was lost, and what a card with nothing better may be sent with: a wave out from the card's own square, every
 * square to stage 1 nearest first, then to 2, and on up.
 */
export function defaultOrder(squares: readonly CardSquare[], ix: number, iz: number): number[] {
  const by = squares.map((q, i) => ({ i, d: Math.max(Math.abs(q.ix - ix), Math.abs(q.iz - iz)) })).sort((a, b) => a.d - b.d || a.i - b.i);
  const out: number[] = [];
  for (let s = 1; s <= linkTune.top; s++) for (const { i } of by) if (squares[i].stage >= s) out.push(i);
  return out;
}

/** Why a card can't be written, '' for one that can. */
export function cardFault(card: Card): string {
  if (!card || card.v !== 1) return 'version';
  if (!whole(card.map, 0, 4095)) return 'map';
  if (!whole(card.ix, -32768, 32767) || !whole(card.iz, -32768, 32767)) return 'square';
  if (!whole(card.crew, 1, linkTune.crews)) return 'crew';
  if (!whole(card.at, 0, linkTune.atMost)) return 'minute';
  if (!captionOk(card.caption)) return 'caption';
  const b = card.body;
  if (b === null) return '';
  if (!b || typeof b !== 'object') return 'body';
  if (b.answers !== null && !whole(b.answers, 0, 2 ** 30 - 1)) return 'answers';
  if (b.form === 'mark') {
    if (typeof b.key !== 'string' || !KEY.test(b.key)) return 'key';
    return whole(b.stage, 1, linkTune.top) ? '' : 'stage';
  }
  if (b.form !== 'squares') return 'form';
  const q = b.squares;
  if (!Array.isArray(q) || q.length < 1 || q.length > linkTune.squares) return 'count';
  let here = false, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < q.length; i++) {
    const s = q[i];
    if (!s || !whole(s.ix, -32768, 32767) || !whole(s.iz, -32768, 32767) || !whole(s.stage, 1, linkTune.top)) return 'a square';
    if (i && !(q[i - 1].iz < s.iz || (q[i - 1].iz === s.iz && q[i - 1].ix < s.ix))) return 'sorted';
    if (s.ix === card.ix && s.iz === card.iz) here = true;
    x0 = Math.min(x0, s.ix), x1 = Math.max(x1, s.ix), z0 = Math.min(z0, s.iz), z1 = Math.max(z1, s.iz);
  }
  if (!here) return 'its own square';
  if (x1 - x0 >= linkTune.box || z1 - z0 >= linkTune.box) return 'box';
  if (!orderOk(b.order, q)) return 'order';
  if (b.score !== null && (!b.score || !whole(b.score.budget, 0, 255) || !whole(b.score.used, 0, 255))) return 'score';
  return '';
}

export type Written = { ok: true; text: string; id: string; id30: number } | { ok: false; why: string };

/** A card as its text. The same card is the same text, on any phone, at any time. */
export function encode(card: Card): Written {
  const why = cardFault(card);
  if (why) return { ok: false, why };
  const b = card.body, form = b && b.form === 'mark' ? 1 : 0, parts = !b ? 0 : form ? 1 : 2;
  const h = new Writer();
  h.u(form, 2), h.u(parts, 2), h.u(card.crew, 4), h.uv(card.map), h.zz(card.ix), h.zz(card.iz), h.u(card.at, 25);
  h.u(card.caption.length, 6);
  for (const c of card.caption) h.u(CAPV.get(c)!, 6);
  let s = section(linkTune.version, h, CHECK.head);
  if (!b) return { ok: true, text: s, id: s, id30: crc(s, 30, POLY[6]) };
  const c = new Writer(), blocks: Block[] = [];
  if (b.form === 'mark') {
    c.u(b.key.length - 1, 4);
    for (const ch of b.key) c.u(CAPV.get(ch)!, 6);
    c.u(b.stage - 1, 2);
  } else {
    const q = b.squares;
    const x0 = Math.min(...q.map((t) => t.ix)), z0 = Math.min(...q.map((t) => t.iz));
    const w = Math.max(...q.map((t) => t.ix)) - x0 + 1, d = Math.max(...q.map((t) => t.iz)) - z0 + 1;
    c.u(w - 1, 4), c.u(d - 1, 4), c.u(card.ix - x0, 4), c.u(card.iz - z0, 4);
    const set = new Set(q.map((t) => (t.iz - z0) * w + (t.ix - x0)));
    for (let i = 0; i < w * d; i++) c.u(set.has(i) ? 1 : 0, 1);
    for (const t of q) c.u(t.stage - 1, 2);
  }
  if (b.answers !== null) blocks.push([1, bitsOf((w) => w.u(b.answers!, 30))]);
  if (b.form === 'squares' && b.score) blocks.push([16, bitsOf((w) => (w.u(b.score!.budget, 8), w.u(b.score!.used, 8)))]);
  writeBlocks(c, blocks);
  s = section(s, c, CHECK.core);
  const id = s, id30 = crc(s.slice(0, s.length - CHECK.core), 30, POLY[6]);
  if (b.form === 'mark') return { ok: true, text: s, id, id30 };
  const t = new Writer(), bits = indexBits(b.squares.length);
  for (const i of b.order) t.u(i, bits);
  return { ok: true, text: section(s, t, CHECK.tail), id, id30 };
}

// ---- reading ----

/** every kind of space and soft break an app may put in a long word */
const GAPS = /[\s\u00ad\u200b-\u200d\u2060\ufeff]/g;
const GAP = /^[\s\u00ad\u200b-\u200d\u2060\ufeff]$/;
/** one character as a browser escapes it for a page: a byte, or the two, three or four of one UTF-8 character (%20, %C2%A0, %E2%80%8B) */
const ESCAPED = /%(?:[0-7][0-9a-f]|[cd][0-9a-f]%[89ab][0-9a-f]|e[0-9a-f](?:%[89ab][0-9a-f]){2}|f[0-4](?:%[89ab][0-9a-f]){3})/gi;
function unspaced(m: string): string {
  try {
    return GAP.test(decodeURIComponent(m)) ? '' : m;
  } catch {
    return m;
  }
}

/**
 * The text as it is read: every # in front dropped, a wrapped line mended, one case, look-alikes folded, and everything from the first character that
 * isn't the alphabet's left out. Spaces may be taken out anywhere only because each section says how long it is: words that follow a link can add
 * characters after the card, never inside it.
 */
export function clean(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let s = raw.length > linkTune.input * 4 ? raw.slice(0, linkTune.input * 4) : raw;
  s = s.replace(ESCAPED, unspaced).replace(GAPS, '').replace(/^#+/, '');
  let out = '';
  for (let i = 0; i < s.length && out.length < linkTune.input; i++) {
    const c = s.charCodeAt(i), v = c < 128 ? VAL[c] : -1;
    if (v < 0) break;
    out += ALPHABET[v];
  }
  return out;
}

type Taken = { state: 'cut' | 'bad' } | { state: 'ok'; payload: string; end: number };
function take(s: string, pos: number, k: number): Taken {
  if (pos + 2 > s.length) return { state: 'cut' };
  const end = pos + 2 + VAL[s.charCodeAt(pos)] * 32 + VAL[s.charCodeAt(pos + 1)];
  if (end + k > s.length) return { state: 'cut' };
  if (checkOf(s.slice(0, end), k) !== s.slice(end, end + k)) return { state: 'bad' };
  return { state: 'ok', payload: s.slice(pos + 2, end), end: end + k };
}
const lost = (t: Taken): string => (t.state === 'cut' ? 'cut short' : 'damaged');
const NONE = (why: string): Read => ({ level: 'none', why, card: null, id: '', id30: -1, seed: -1, canon: '', skipped: [] });

/** Any text at all as a card, as far as it holds. Never throws. */
export function decode(raw: unknown): Read {
  const s = clean(raw);
  if (!s.length) return NONE('empty');
  if (s[0] !== linkTune.version) return NONE(s[0] === '0' ? 'not a card' : 'a newer format');
  // ---- the head ----
  const hs = take(s, 1, CHECK.head);
  if (hs.state !== 'ok') return NONE(lost(hs));
  const skipped: number[] = [], r = new Reader(hs.payload);
  const form = r.u(2), parts = r.u(2), crew = r.u(4), map = r.uv(3), ix = r.zz(4), iz = r.zz(4), at = r.u(25), n = r.u(6);
  if (r.bad || n > linkTune.caption || crew < 1 || ix < -32768 || ix > 32767 || iz < -32768 || iz > 32767) return NONE('damaged');
  let caption = '';
  for (let i = 0; i < n; i++) caption += CAPTION[r.u(6)];
  if (r.bad || !captionOk(caption) || !readBlocks(r, {}, skipped)) return NONE('damaged');
  const card: Card = { v: 1, map, ix, iz, crew, at, caption, body: null }, headText = s.slice(0, hs.end), seed = crc(headText, 30, POLY[6]);
  const head = (why: string): Read => ({ level: 'head', why, card, id: '', id30: -1, seed, canon: headText, skipped });
  // (a later build's sixth crew: the place still lands, under a crest that takes no side)
  if (crew > linkTune.crews) return head('a crew this build does not know');
  if (parts === 0 && form === 0) return { level: 'full', why: '', card, id: headText, id30: seed, seed, canon: headText, skipped };
  if (form > 1) return head('a newer kind of card');
  if (parts !== (form ? 1 : 2)) return head('damaged');
  // ---- the core ----
  const cs = take(s, hs.end, CHECK.core);
  if (cs.state !== 'ok') return head(lost(cs));
  const c = new Reader(cs.payload), id = s.slice(0, cs.end), id30 = crc(s.slice(0, cs.end - CHECK.core), 30, POLY[6]);
  let answers: number | null = null, score: SquaresBody['score'] = null;
  const known: Known = { 1: (rr, size) => size === 30 && ((answers = rr.u(30)), true) };
  if (form === 1) {
    const len = c.u(4) + 1;
    let key = '';
    for (let i = 0; i < len; i++) key += CAPTION[c.u(6)];
    const stage = c.u(2) + 1;
    if (c.bad || !KEY.test(key) || !readBlocks(c, known, skipped)) return head('damaged');
    card.body = { form: 'mark', key, stage, answers };
    return { level: 'full', why: '', card, id, id30, seed, canon: id, skipped };
  }
  known[16] = (rr, size) => size === 16 && ((score = { budget: rr.u(8), used: rr.u(8) }), true);
  const w = c.u(4) + 1, d = c.u(4) + 1, ox = c.u(4), oz = c.u(4);
  if (c.bad || ox >= w || oz >= d) return head('damaged');
  const squares: CardSquare[] = [], col = new Uint8Array(w), row = new Uint8Array(d);
  let here = false;
  for (let j = 0; j < d; j++)
    for (let i = 0; i < w; i++)
      if (c.u(1)) {
        if (squares.length >= linkTune.squares) return head('damaged');
        squares.push({ ix: ix - ox + i, iz: iz - oz + j, stage: 0 });
        col[i] = row[j] = 1;
        if (i === ox && j === oz) here = true;
      }
  // (its own square among them, and the box no bigger than they need: one text a card)
  if (c.bad || !here || !col[0] || !col[w - 1] || !row[0] || !row[d - 1]) return head('damaged');
  for (const q of squares) {
    q.stage = c.u(2) + 1;
    if (q.ix < -32768 || q.ix > 32767 || q.iz < -32768 || q.iz > 32767) return head('damaged');
  }
  if (c.bad || !readBlocks(c, known, skipped)) return head('damaged');
  const body: SquaresBody = { form: 'squares', squares, order: defaultOrder(squares, ix, iz), answers, score };
  card.body = body;
  const core = (why: string): Read => ({ level: 'core', why, card, id, id30, seed, canon: id, skipped });
  // ---- the tail ----
  const ts = take(s, cs.end, CHECK.tail);
  if (ts.state !== 'ok') return core(lost(ts));
  const t = new Reader(ts.payload), bits = indexBits(squares.length), order: number[] = [];
  let sum = 0;
  for (const q of squares) sum += q.stage;
  for (let i = 0; i < sum; i++) order.push(t.u(bits));
  if (t.bad || !orderOk(order, squares) || !readBlocks(t, {}, skipped)) return core('damaged');
  body.order = order;
  return { level: 'full', why: '', card, id, id30, seed, canon: s.slice(0, ts.end), skipped };
}

// ---- what a card shows ----

/** One step of the Flyby: this square reaches this stage. */
export interface Beat {
  /** the square's index on the card */
  i: number;
  ix: number;
  iz: number;
  stage: number;
}
/** The card's climbs in their order, each square's k-th entry its stage k. `top(ix, iz)` holds a square to what its ground can reach (0: left out). */
export function beats(card: Card, top?: (ix: number, iz: number) => number): Beat[] {
  const b = card.body, out: Beat[] = [];
  if (!b || b.form !== 'squares') return out;
  const seen = b.squares.map(() => 0);
  for (const i of b.order) {
    const q = b.squares[i], stage = ++seen[i];
    if (stage <= (top ? Math.min(q.stage, top(q.ix, q.iz)) : q.stage)) out.push({ i, ix: q.ix, iz: q.iz, stage });
  }
  return out;
}

/** A newcomer's crew, dealt by the card that brought them (its `seed`): one of the others, the same one however often the link is opened, whole or torn. */
export function dealCrew(seed: number, sender: number, crews: number = linkTune.crews): number {
  const n = seed >= 0 ? seed : 0;
  if (sender < 1 || sender > crews) return 1 + (n % crews);
  const pick = 1 + (n % (crews - 1));
  return pick >= sender ? pick + 1 : pick;
}

/** The crew a card's squares wear on a phone: the sender's, and the next round the wheel where that is the player's own, so there is always something to take back. */
export function wornBy(crew: number, mine: number, crews: number = linkTune.crews): number {
  return crew !== mine ? crew : (crew % crews) + 1;
}

/** the words a street is called by, dropped first when a caption runs long */
const STREET_WORDS = new Set(['ST', 'AVE', 'AV', 'BLVD', 'DR', 'RD', 'WAY', 'LN', 'CT', 'PL', 'TER', 'HWY', 'STREET', 'AVENUE', 'BOULEVARD', 'DRIVE', 'ROAD', 'LANE', 'COURT', 'PLACE', 'TERRACE', 'HIGHWAY']);
const PLAIN: Record<string, string> = { 'ß': 'SS', 'Ł': 'L', 'Đ': 'D', 'Þ': 'TH', 'Œ': 'OE', '’': "'", '‘': "'", '–': '-', '—': '-', '+': ' & ' };

/**
 * Any words as a caption a card can carry: capitals; a letter with a mark the table lacks as its plain letter, a letter it has no like of left out (the
 * word stays whole), anything that is no letter a gap; and over 40 characters the street words go first, then whole words from the end.
 */
export function captionFrom(text: unknown): string {
  let src = '';
  try {
    src = String(text ?? '').slice(0, 512).normalize('NFC').toUpperCase();
  } catch {
    return ''; // (a thing that can't be made a string)
  }
  let s = '';
  for (const ch of src)
    for (const one of PLAIN[ch] ?? ch) {
      if (CAPV.has(one)) s += one;
      else {
        const base = one.normalize('NFD')[0];
        if (base !== one && CAPV.has(base)) s += base;
        else if (one.toLowerCase() === one.toUpperCase()) s += ' ';
      }
    }
  let words = s.split(' ').filter(Boolean);
  const long = (w: string[]): number => w.reduce((n, x) => n + x.length, 0) + Math.max(0, w.length - 1);
  if (long(words) > linkTune.caption) words = words.filter((w) => !STREET_WORDS.has(w));
  let n = long(words);
  while (words.length > 1 && n > linkTune.caption) n -= words.pop()!.length + 1;
  while (words.length && words[words.length - 1] === '&') words.pop();
  while (words.length && words[0] === '&') words.shift();
  return words.join(' ').slice(0, linkTune.caption).trim();
}

// ---- the address ----

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** letters a page name writes out, having no accent to drop */
const SPELT: Record<string, string> = { 'ø': 'o', 'æ': 'ae', 'ß': 'ss', 'đ': 'd', 'ð': 'd', 'ł': 'l', 'þ': 'th', 'œ': 'oe', 'ı': 'i' };

/** A neighbourhood's or a landmark's page name: "Fisherman's Wharf" is fishermans-wharf, "Tenderloin / Little Saigon" tenderloin-little-saigon. */
export function slugOf(name: string): string {
  return String(name).slice(0, 512).toLowerCase().replace(/[øæßđðłþœı]/g, (c) => SPELT[c]).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, linkTune.place).replace(/-+$/, '');
}

/** The cities a card can name, by their number: a city keeps its number for good, and a new one goes on the end. */
export const MAPS: readonly string[] = ['sf', 'amsterdam', 'london'];
/** A city's number on a card by its slug, -1 for one that has none yet. */
export const mapOf = (slug: string): number => MAPS.indexOf(slug);

/** What an address asks for. `kind`: 'card' (its link read to some level), 'place' (a neighbourhood's page), 'source' (a post's tag), 'door'. */
export interface Visit {
  kind: 'card' | 'place' | 'source' | 'door';
  /** the page name in the path, or '' */
  place: string;
  /** how many cards down a chain this one is: the sender's own first card is 0 */
  gen: number;
  /** a post's source, or '' */
  tag: string;
  link: Read;
}

/** where a card starts in a path or a query an app moved it into: a # as it is, escaped once, or twice */
const MARK = /#|%23|%2523/i;
/** a path's part without what a sentence leaves on its end (".../3." and ".../3)") */
function trimEnd(x: string): string {
  let n = x.length;
  for (; n > 0; n--) {
    const c = x.charCodeAt(n - 1);
    if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45) break;
  }
  return x.slice(0, n);
}

/**
 * location's three parts as a visit. The card is what follows the #. Where that reads as no card and an app has escaped a # into the path (%23, or twice,
 * %2523) or pushed one into the query, what follows that is tried, the path's first: the first that reads as a card is the card. Read once when the page
 * starts and never again: a page that could re-read its address could be steered card after card by another page.
 */
export function parseLocation(pathname: unknown, search: unknown, hash: unknown): Visit {
  const all = String(pathname ?? '').slice(0, linkTune.input * 2), query = String(search ?? '').slice(0, linkTune.input * 2);
  const inPath = MARK.exec(all), inQuery = MARK.exec(query);
  let link = decode(String(hash ?? ''));
  for (const [text, m] of [[all, inPath], [query, inQuery]] as const) {
    if (link.level !== 'none' || !m) continue;
    const other = decode(text.slice(m.index + m[0].length));
    if (other.level !== 'none') link = other;
  }
  let path = inPath ? all.slice(0, inPath.index) : all;
  try {
    path = decodeURIComponent(path);
  } catch {
    // (a bad escape in the path: read as it stands)
  }
  const seg = path.toLowerCase().split('/').filter(Boolean).slice(0, 4).map(trimEnd);
  const out: Visit = { kind: 'door', place: '', gen: 0, tag: '', link };
  if (seg[0] === 'p' && seg[1] && seg[1].length <= linkTune.place && SLUG.test(seg[1])) {
    out.place = seg[1];
    const g = /^[0-9]{1,6}/.exec(seg[2] ?? '');
    out.gen = g ? Math.min(linkTune.gen, Number(g[0])) : 0;
    out.kind = 'place';
  } else if (seg[0] === 's' && seg[1] && seg[1].length <= linkTune.tag && SLUG.test(seg[1])) {
    out.tag = seg[1];
    out.kind = 'source';
  }
  if (out.link.level !== 'none') out.kind = 'card';
  return out;
}

/** A card's whole address. `origin` has no slash at its end; a place that is no page name, or a generation out of range, is written as the plainest one. */
export function cardUrl(origin: string, place: string, gen: number, text: string): string {
  const p = typeof place === 'string' && SLUG.test(place) && place.length <= linkTune.place ? place : 'sf';
  const g = whole(gen, 0, linkTune.gen) ? gen : gen > linkTune.gen ? linkTune.gen : 0;
  return `${origin}/p/${p}/${g}#${text}`;
}

/** The card's minute as epoch seconds. */
export const cardSeconds = (at: number): number => linkTune.epoch + at * 60;
/** Epoch seconds as a card's minute, held to what a card can say. */
export function cardMinute(seconds: number): number {
  const m = Math.floor((seconds - linkTune.epoch) / 60);
  return Number.isFinite(m) ? Math.max(0, Math.min(linkTune.atMost, m)) : 0;
}

/** An address in words, for the console: what was read, how far, and why no further. */
export function explain(href: string): string {
  let pathname = href, search = '', hash = '';
  const h = pathname.indexOf('#');
  if (h >= 0) (hash = pathname.slice(h)), (pathname = pathname.slice(0, h));
  const q = pathname.indexOf('?');
  if (q >= 0) (search = pathname.slice(q)), (pathname = pathname.slice(0, q));
  pathname = pathname.replace(/^[a-z]+:\/\/[^/]*/i, '');
  const v = parseLocation(pathname, search, hash), r = v.link, c = r.card, lines: string[] = [];
  lines.push(`visit: ${v.kind}${v.place ? `, page ${v.place}, generation ${v.gen}` : ''}${v.tag ? `, source ${v.tag}` : ''}`);
  lines.push(`card: read to '${r.level}'${r.why ? ` (${r.why})` : ''}`);
  if (c) {
    lines.push(`head: map ${c.map}, square ${c.ix},${c.iz}, crew ${c.crew}, ${new Date(cardSeconds(c.at) * 1000).toISOString().slice(0, 16)}Z, caption "${c.caption}"`);
    const b = c.body;
    if (b && b.form === 'mark') lines.push(`landmark: ${b.key} at stage ${b.stage}`);
    if (b && b.form === 'squares') {
      lines.push(`squares: ${b.squares.map((s) => `${s.ix},${s.iz}:${s.stage}`).join(' ')}`);
      lines.push(`order${r.level === 'core' ? ' (made up: the card\'s own was lost)' : ''}: ${b.order.join(' ')}`);
      if (b.score) lines.push(`score: used ${b.score.used} of ${b.score.budget}`);
    }
    if (b && b.answers !== null) lines.push(`answers: card ${b.answers}`);
    if (r.id) lines.push(`id: ${r.id30} (${r.id.length} characters)`);
  }
  if (r.skipped.length) lines.push(`passed over: blocks ${r.skipped.join(', ')}`);
  return lines.join('\n');
}

/** (for tools/link/fuzz.mjs's hand-made texts) */
export const forTests = { Writer, section, writeBlocks, bitsOf, checkOf, CHECK, CAPV };
