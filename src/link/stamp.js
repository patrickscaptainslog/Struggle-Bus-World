// The loading page's own reader of a postcard's head (docs/specs/core/LINK.md, "The loading page"): index.html's stamp is drawn before the game's code
// has loaded, so it can't call link.ts. One function, ES5, nothing outside it: sbwStamp(location.href) gives { map, ix, iz, crew, at, caption, place, gen }
// for an address whose card's head reads whole, and null for any other. `place` and `gen` are the path's and may be '' and 0. It checks what link.ts's
// `decode` checks of a head, and tools/link/fuzz.mjs holds the two to the same answer on every card it makes and breaks. To change one, change both.
function sbwStamp(href) {
  var A = '0123456789abcdefghjkmnpqrstvwxyz';
  var CAP = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 &'-\0\0\0\0\0\0ÉÈÁÀÍÓÚÜÖÄÑÇÅØÆÏÊÔ";
  var val = function (ch) {
    var c = ch.toLowerCase();
    if (c === 'o') return 0;
    if (c === 'i' || c === 'l') return 1;
    return A.indexOf(c);
  };
  var undo = function (s) {
    try {
      return decodeURIComponent(s);
    } catch (e) {
      return s;
    }
  };
  var clean = function (raw) {
    var s = raw.length > 16384 ? raw.slice(0, 16384) : raw, out = '', i, v;
    s = s.replace(/%(?:20|09|0a|0d)|[\s­​-‍⁠﻿]/gi, '').replace(/^#+/, '');
    for (i = 0; i < s.length && out.length < 4096; i++) {
      v = s.charCodeAt(i) < 128 ? val(s.charAt(i)) : -1;
      if (v < 0) break;
      out += A.charAt(v);
    }
    return out;
  };
  // ---- the address: its path, its query, its card ----
  var text = String(href == null ? '' : href), path = text, query = '', frag = '', cut, pass, q;
  cut = path.indexOf('#');
  if (cut >= 0) {
    frag = path.slice(cut);
    path = path.slice(0, cut);
  }
  cut = path.indexOf('?');
  if (cut >= 0) {
    query = path.slice(cut);
    path = path.slice(0, cut);
  }
  path = path.replace(/^[a-z][a-z0-9+.-]*:\/\/[^\/]*/i, '');
  for (pass = 0; pass < 3; pass++) {
    cut = path.indexOf('#');
    if (cut >= 0) {
      if (clean(frag) === '') frag = path.slice(cut);
      path = path.slice(0, cut);
      break;
    }
    if (pass < 2) path = undo(path);
  }
  if (clean(frag) === '') {
    q = query;
    for (pass = 0; pass < 3; pass++) {
      cut = q.indexOf('#');
      if (cut >= 0) {
        frag = q.slice(cut);
        break;
      }
      if (pass < 2) q = undo(q);
    }
  }
  var seg = [], parts = path.toLowerCase().split('/'), k;
  for (k = 0; k < parts.length && seg.length < 4; k++) if (parts[k]) seg.push(parts[k].replace(/[^a-z0-9-]+$/, ''));
  var place = '', gen = 0, g;
  if (seg[0] === 'p' && seg[1] && seg[1].length <= 48 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(seg[1])) {
    place = seg[1];
    g = /^[0-9]{1,6}/.exec(seg[2] || '');
    gen = g ? Math.min(99, Number(g[0])) : 0;
  }
  // ---- the head: '1', its length (2 characters), its bits, its check (3 characters: CRC-15, generator 0x4599, all ones to start) ----
  var s = clean(frag);
  if (s.charAt(0) !== '1' || s.length < 6) return null;
  var end = 3 + val(s.charAt(1)) * 32 + val(s.charAt(2));
  if (end + 3 > s.length) return null;
  var r = 32767, i, b, v, fb;
  for (i = 0; i < end; i++) {
    v = val(s.charAt(i));
    for (b = 4; b >= 0; b--) {
      fb = ((v >> b) & 1) ^ (r >= 16384 ? 1 : 0);
      r = (r * 2) & 32767;
      if (fb) r ^= 0x4599;
    }
  }
  if (A.charAt(r >> 10) + A.charAt((r >> 5) & 31) + A.charAt(r & 31) !== s.slice(end, end + 3)) return null;
  var p = 15, n = end * 5, bad = false;
  var u = function (bits) {
    var x = 0, j;
    if (p + bits > n) {
      bad = true;
      p = n;
      return 0;
    }
    for (j = 0; j < bits; j++, p++) x = x * 2 + ((val(s.charAt(Math.floor(p / 5))) >> (4 - (p % 5))) & 1);
    return x;
  };
  var uv = function (most) {
    var x = 0, j, more, d;
    for (j = 0; j < most; j++) {
      more = u(1);
      d = u(4);
      if (j === 0 && more && d === 0) bad = true;
      x = x * 16 + d;
      if (!more) return x;
    }
    bad = true;
    return 0;
  };
  var zz = function (most) {
    var x = uv(most);
    return x % 2 ? -(x + 1) / 2 : x / 2;
  };
  u(2);
  u(2);
  var crew = u(4), map = uv(3), ix = zz(4), iz = zz(4), at = u(25), len = u(6), caption = '', ch;
  if (bad || len > 40 || crew < 1 || ix < -32768 || ix > 32767 || iz < -32768 || iz > 32767) return null;
  for (i = 0; i < len; i++) {
    ch = CAP.charAt(u(6));
    if (ch === '\0') return null;
    caption += ch;
  }
  if (bad || caption.charAt(0) === ' ' || caption.charAt(len - 1) === ' ' || caption.indexOf('  ') >= 0) return null;
  // (the blocks a later build may add: tags rising, each with its size; one from 16 up is not for this reader)
  var last = 0, from, tag, size;
  while (n - p >= 5) {
    from = p;
    tag = u(5);
    if (tag === 0) {
      p = from;
      break;
    }
    if (tag <= last || tag >= 16) return null;
    last = tag;
    size = uv(3);
    if (bad || size > n - p) return null;
    p += size;
  }
  if (n - p >= 5) return null;
  while (p < n) if (u(1)) return null;
  return { map: map, ix: ix, iz: iz, crew: crew, at: at, caption: caption, place: place, gen: gen };
}
