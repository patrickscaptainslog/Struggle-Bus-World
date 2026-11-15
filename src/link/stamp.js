// The loading page's own readers (docs/specs/core/LINK.md, "The loading page"): index.html's stamp is drawn before the game's code has loaded, so it
// can't call link.ts or save.ts. Two functions, ES5, nothing outside them, to be put in the page as they are:
//   sbwStamp(location.href)  { map, ix, iz, crew, at, caption, place, gen } for an address whose card's head reads whole, null for any other.
//                            `place` and `gen` are the path's and may be '' and 0.
//   sbwLastCard(text)        the newest card this phone sent, from the save's text (localStorage's strugglebus.city.v2:<slug>):
//                            { text, at, place, gen }, or null. sbwStamp('#' + text) is then its stamp.
// sbwStamp checks what link.ts's `decode` checks of a head and finds the card where `parseLocation` finds it; tools/link/fuzz.mjs holds the two to the
// same answer on every address it makes and breaks, and sbwLastCard to save.ts's `lastSent`. To change one reader, change both.
function sbwStamp(href) {
  var A = '0123456789abcdefghjkmnpqrstvwxyz';
  var CAP = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 &'-\0\0\0\0\0\0\u00c9\u00c8\u00c1\u00c0\u00cd\u00d3\u00da\u00dc\u00d6\u00c4\u00d1\u00c7\u00c5\u00d8\u00c6\u00cf\u00ca\u00d4";
  var val = function (ch) {
    var c = ch.toLowerCase();
    if (c === 'o') return 0;
    if (c === 'i' || c === 'l') return 1;
    return A.indexOf(c);
  };
  var clean = function (raw) {
    var s = raw.length > 16384 ? raw.slice(0, 16384) : raw, out = '', i, v;
    // (any space or soft break, as it stands or as a browser escapes it: %20, %C2%A0, %E2%80%8B)
    s = s.replace(/%(?:[0-7][0-9a-f]|[cd][0-9a-f]%[89ab][0-9a-f]|e[0-9a-f](?:%[89ab][0-9a-f]){2}|f[0-4](?:%[89ab][0-9a-f]){3})/gi, function (m) {
      try {
        return /^[\s\u00ad\u200b-\u200d\u2060\ufeff]$/.test(decodeURIComponent(m)) ? '' : m;
      } catch (e) {
        return m;
      }
    });
    s = s.replace(/[\s\u00ad\u200b-\u200d\u2060\ufeff]/g, '').replace(/^#+/, '');
    for (i = 0; i < s.length && out.length < 4096; i++) {
      v = s.charCodeAt(i) < 128 ? val(s.charAt(i)) : -1;
      if (v < 0) break;
      out += A.charAt(v);
    }
    return out;
  };
  // ---- a card's head: '1', its length (2 characters), its bits, its check (3 characters: CRC-15, generator 0x4599, all ones to start) ----
  var head = function (raw) {
    var s = clean(raw);
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
    return { map: map, ix: ix, iz: iz, crew: crew, at: at, caption: caption, place: '', gen: 0 };
  };
  // ---- the address: its path, its query, its card. The card is after the #; failing that, after a # an app escaped into the path, then the query ----
  var text = String(href == null ? '' : href), path = text, query = '', frag = '', cut;
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
  path = path.replace(/^[a-z][a-z0-9+.-]*:\/\/[^\/]*/i, '').slice(0, 8192);
  query = query.slice(0, 8192);
  var MARK = /#|%23|%2523/i, inPath = MARK.exec(path), inQuery = MARK.exec(query);
  var card = head(frag);
  if (!card && inPath) card = head(path.slice(inPath.index + inPath[0].length));
  if (!card && inQuery) card = head(query.slice(inQuery.index + inQuery[0].length));
  if (!card) return null;
  if (inPath) path = path.slice(0, inPath.index);
  try {
    path = decodeURIComponent(path);
  } catch (e) {
    // (a bad escape in the path: read as it stands)
  }
  var seg = [], parts = path.toLowerCase().split('/'), k, x, c;
  for (k = 0; k < parts.length && seg.length < 4; k++) {
    if (!parts[k]) continue;
    x = parts[k];
    while (x.length) {
      c = x.charCodeAt(x.length - 1);
      if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45) break;
      x = x.slice(0, x.length - 1);
    }
    seg.push(x);
  }
  var g;
  if (seg[0] === 'p' && seg[1] && seg[1].length <= 48 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(seg[1])) {
    card.place = seg[1];
    g = /^[0-9]{1,6}/.exec(seg[2] || '');
    card.gen = g ? Math.min(99, Number(g[0])) : 0;
  }
  return card;
}

function sbwLastCard(text) {
  var line, notes, i, n, best = null;
  if (typeof text !== 'string') return null;
  line = text.split('\n');
  if (line[0] !== 'SBW2') return null;
  try {
    notes = JSON.parse(line[3]);
  } catch (e) {
    return null;
  }
  if (Object.prototype.toString.call(notes) !== '[object Array]') return null;
  for (i = 0; i < notes.length; i++) {
    n = notes[i];
    // (a note as save.ts writes one: id, id30, sent or opened, the card's text, when, generation, page name, ...)
    if (Object.prototype.toString.call(n) !== '[object Array]' || n.length !== 11 || n[2] !== 1) continue;
    if (typeof n[0] !== 'string' || typeof n[3] !== 'string' || typeof n[4] !== 'number' || typeof n[5] !== 'number' || typeof n[6] !== 'string') continue;
    if (!best || n[4] > best[4] || (n[4] === best[4] && n[0] > best[0])) best = n;
  }
  return best ? { text: best[3], at: best[4], place: best[6], gen: best[5] } : null;
}
