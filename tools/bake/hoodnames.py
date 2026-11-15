#!/usr/bin/env python3
"""The neighbourhood names' pass (M1 task 11): a baked hoods.bin's names made fit for a street sign and a postcard's page.

  python3 tools/bake/hoodnames.py <slug> [--dry] [--dir=DIR]    read public/city/<slug>/hoods.bin, clean it, write it back
  python3 tools/bake/hoodnames.py --test                        the rules on small hand-made tables

hoods.py runs it as its last step (clean_city), so every bake's names go through it; it can also be run on a file already
baked, which is how San Francisco's was cleaned on 2026-11-15 with no bake. It needs nothing but Python: no numpy, no
map extract. It changes names, and joins neighbourhoods; it never moves a square from one neighbourhood to another's
middle, never touches a tagged square, and every square that had a neighbourhood still has one.

The rules, in order:
  1. Strips are one place again where the map says so. hoods.py cuts a neighbourhood over 3 km2 into strips named
     "<name> North", "<name> South" (the gods' sizes). Strips of one name that touch are joined back under that name
     where the tiles have a label of that name (city.json's "neighborhoods": the Mission, Golden Gate Park, the Presidio),
     or where the whole is hoodnames.json's "whole" squares or fewer. Its heart is the old heart nearest its middle.
  2. One name each. "Tenderloin / Little Saigon" is Tenderloin: the first name, which is the neighbourhood's own.
  3. No road's name and no plaque's (hoodnames.json's "road" and "plaque"). Such a neighbourhood takes the name of a
     label of the tiles that lies in it and names no other; else it joins the neighbour it shares the most border with;
     a scrap of land with no neighbour (a pier's end) joins the nearest neighbourhood within three squares. One with
     none that near (an island) keeps its name, and the pass says so.
Names stay sorted and no two the same, as hoods.py's write() leaves them.
"""
import gzip
import json
import os
import re
import struct
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
RULES = json.load(open(os.path.join(HERE, 'hoodnames.json'), encoding='utf-8'))
ROAD = re.compile(RULES['road'], re.I)
PLAQUE = re.compile(RULES['plaque'], re.I)
STRIP = re.compile(RULES['strip'], re.I)
WHOLE = int(RULES['whole'])
SQ = 128.0
NEAR = 3    # squares: a scrap of land with a name it may not have joins a neighbourhood this near, across the gap
DROP = ('the', 'district', 'island', 'neighborhood', 'neighbourhood')


def key(name):
    """A name as one place: lower case, no accents, without "the", "district", "island" and "neighbo(u)rhood"
    (tools/world/hoodnames-check.mjs's key)."""
    s = unicodedata.normalize('NFD', name)
    s = ''.join(c for c in s if not unicodedata.combining(c)).lower()
    return ' '.join(w for w in re.sub(r'[^a-z0-9]+', ' ', s).split() if w not in DROP)


def denied(name):
    return bool(ROAD.search(name.strip()) or PLAQUE.search(name))


def unpack(body):
    """hoods.bin's bytes (gzipped or not) as a dict; the layout is src/world/hoods.ts's."""
    if body[:2] == b'\x1f\x8b':
        body = gzip.decompress(body)
    if len(body) < 24 or body[:4] != b'SBN1':
        raise ValueError('not SBN1')
    major, minor, ix0, iz0, w, h, n = struct.unpack_from('<HHiiHHI', body, 4)
    nb = (w * h + 7) // 8
    grid_at = (24 + 5 * n + 3) & ~3
    names_at = (grid_at + 2 * w * h + nb + 3) & ~3
    if names_at + n > len(body):
        raise ValueError('counts past the bytes')
    t = dict(major=major, minor=minor, ix0=ix0, iz0=iz0, w=w, h=h, hearts=list(struct.unpack_from(f'<{n}I', body, 24)),
             flags=list(body[24 + 4 * n:24 + 5 * n]), grid=list(struct.unpack_from(f'<{w * h}H', body, grid_at)),
             tagged=bytes(body[grid_at + 2 * w * h:grid_at + 2 * w * h + nb]), names=[])
    o = names_at
    for _ in range(n):
        if o >= len(body) or o + 1 + body[o] > len(body):
            raise ValueError('cut short in the names')
        t['names'].append(body[o + 1:o + 1 + body[o]].decode('utf-8'))
        o += 1 + body[o]
    if max(t['grid'], default=0) > n:
        raise ValueError('a square past the neighbourhoods')
    return t


def pack(t):
    """unpack's dict as hoods.bin's bytes before gzip, byte for byte what hoods.py's pack_hoods writes."""
    n = len(t['names'])
    body = bytearray(b'SBN1' + struct.pack('<HHiiHHI', t['major'], t['minor'], t['ix0'], t['iz0'], t['w'], t['h'], n))
    body += struct.pack(f'<{n}I', *t['hearts'])
    body += bytes(t['flags'])
    body += b'\0' * ((-len(body)) % 4)
    body += struct.pack(f'<{t["w"] * t["h"]}H', *t['grid'])
    body += t['tagged']
    body += b'\0' * ((-len(body)) % 4)
    for nm in t['names']:
        b = nm.encode('utf-8')
        if len(b) > 255:
            raise SystemExit(f'a name over 255 bytes: {nm}')
        body += bytes([len(b)]) + b
    return bytes(body)


class Table:
    """The neighbourhoods as sets of cells, to join and rename; back to a dict with names sorted."""

    def __init__(self, t):
        self.t = t
        self.w, self.h = t['w'], t['h']
        self.hoods = {}   # id -> dict(name, heart (a cell), flags, cells)
        for i, nm in enumerate(t['names']):
            self.hoods[i] = dict(name=nm, heart=self.cell_of(t['hearts'][i]), flags=t['flags'][i], cells=set())
        for c, g in enumerate(t['grid']):
            if g:
                self.hoods[g - 1]['cells'].add(c)
        self.notes = []

    def cell_of(self, k):
        ix, iz = (k >> 16) & 0xffff, k & 0xffff
        ix, iz = ix - 0x10000 if ix >= 0x8000 else ix, iz - 0x10000 if iz >= 0x8000 else iz
        return (iz - self.t['iz0']) * self.w + (ix - self.t['ix0'])

    def key_of(self, c):
        ix, iz = self.t['ix0'] + c % self.w, self.t['iz0'] + c // self.w
        return ((ix & 0xffff) << 16 | (iz & 0xffff)) & 0xffffffff

    def at(self, x, z):
        """The neighbourhood at a point in metres, or None."""
        ix, iz = int(x // SQ) - self.t['ix0'], int(z // SQ) - self.t['iz0']
        if ix < 0 or iz < 0 or ix >= self.w or iz >= self.h:
            return None
        c = iz * self.w + ix
        return next((i for i, hd in self.hoods.items() if c in hd['cells']), None)

    def around(self, c):
        x, z = c % self.w, c // self.w
        if x > 0:
            yield c - 1
        if x < self.w - 1:
            yield c + 1
        if z > 0:
            yield c - self.w
        if z < self.h - 1:
            yield c + self.w

    def owner(self):
        own = {}
        for i, hd in self.hoods.items():
            for c in hd['cells']:
                own[c] = i
        return own

    def borders(self, i, own):
        """{neighbour: edges shared} for neighbourhood i."""
        out = {}
        for c in self.hoods[i]['cells']:
            for d in self.around(c):
                j = own.get(d)
                if j is not None and j != i:
                    out[j] = out.get(j, 0) + 1
        return out

    def touching(self, ids):
        """Do these neighbourhoods make one connected piece?"""
        ids = list(ids)
        own = self.owner()
        seen, todo = {ids[0]}, [ids[0]]
        while todo:
            for j in self.borders(todo.pop(), own):
                if j in ids and j not in seen:
                    seen.add(j)
                    todo.append(j)
        return len(seen) == len(ids)

    def join(self, small, big):
        """small's squares become big's; big keeps its heart, its flags and its name."""
        self.hoods[big]['cells'] |= self.hoods[small]['cells']
        del self.hoods[small]

    def out(self):
        ids = sorted(self.hoods, key=lambda i: (self.hoods[i]['name'].casefold(), i))
        keys = [key(self.hoods[i]['name']) or self.hoods[i]['name'].casefold() for i in ids]
        twice = sorted({k for k in keys if keys.count(k) > 1})
        if twice:
            raise SystemExit(f'the names\' pass left two neighbourhoods one name: {", ".join(twice)}')
        grid = [0] * (self.w * self.h)
        for n, i in enumerate(ids):
            hd = self.hoods[i]
            if hd['heart'] not in hd['cells']:
                raise SystemExit(f'the names\' pass left {hd["name"]} a heart off its own squares')
            for c in hd['cells']:
                grid[c] = n + 1
        if sum(1 for g in grid if g) != sum(1 for g in self.t['grid'] if g) or any(bool(a) != bool(b) for a, b in zip(grid, self.t['grid'])):
            raise SystemExit('the names\' pass lost or made a square')
        return dict(self.t, grid=grid, names=[self.hoods[i]['name'] for i in ids], hearts=[self.key_of(self.hoods[i]['heart']) for i in ids],
                    flags=[self.hoods[i]['flags'] for i in ids])


def clean(t, labels=()):
    """A table (unpack's dict) through the three rules, until a pass changes nothing (a road's neighbourhood joined to a
    strip can make two strips touch). `labels` is the tiles' own: [{'name', 'x', 'z'}] (city.json's "neighborhoods").
    Returns the new table and what was done, in words."""
    said = []
    for _ in range(8):
        out, more = clean_once(t, labels)
        said += [s for s in more if s not in said]
        if pack(out) == pack(t):
            break
        t = out
    return out, said


def clean_once(t, labels):
    T = Table(t)
    by_label = {key(lb['name']): lb for lb in labels}
    said = []

    # 1. strips that the map labels as one place, or that are small enough together, are one again
    groups = {}
    for i, hd in T.hoods.items():
        m = STRIP.match(hd['name'])
        if m and m.group(1).strip():
            groups.setdefault(m.group(1).strip(), []).append(i)
    for base, ids in sorted(groups.items()):
        if len(ids) < 2 or any(key(hd['name']) == key(base) for hd in T.hoods.values()):
            continue
        whole = sum(len(T.hoods[i]['cells']) for i in ids)
        if not (key(base) in by_label or whole <= WHOLE) or not T.touching(ids):
            said.append(f'{base}: {len(ids)} strips of {whole} squares left as they are')
            continue
        cells = set().union(*(T.hoods[i]['cells'] for i in ids))
        mx, mz = sum(c % T.w for c in cells) / len(cells), sum(c // T.w for c in cells) / len(cells)
        keep = min(ids, key=lambda i: ((T.hoods[i]['heart'] % T.w - mx) ** 2 + (T.hoods[i]['heart'] // T.w - mz) ** 2, i))
        names = sorted(T.hoods[i]['name'] for i in ids)
        for i in ids:
            if i != keep:
                T.join(i, keep)
        T.hoods[keep]['name'] = by_label[key(base)]['name'] if key(base) in by_label else base
        said.append(f'{", ".join(names)}: one place again, {T.hoods[keep]["name"]} ({whole} squares)')

    # 2. one name each
    for i, hd in sorted(T.hoods.items()):
        if ' / ' in hd['name']:
            parts = [p.strip() for p in hd['name'].split(' / ') if p.strip()]
            pick = next((p for p in parts if not denied(p)), parts[0])
            taken = {key(o['name']) for j, o in T.hoods.items() if j != i}
            if key(pick) in taken:
                pick = next((p for p in parts if key(p) not in taken and not denied(p)), None)
            if pick:
                said.append(f'{hd["name"]}: now {pick}')
                hd['name'] = pick
            else:
                said.append(f'{hd["name"]}: both names are taken, left as it is')

    # 3. no road's name, no plaque's
    for _ in range(len(T.hoods)):
        bad = sorted((i for i, hd in T.hoods.items() if denied(hd['name'])), key=lambda i: (len(T.hoods[i]['cells']), T.hoods[i]['name']))
        if not bad:
            break
        done = False
        for i in bad:
            hd = T.hoods[i]
            taken = {key(o['name']) for o in T.hoods.values()}
            hx, hz = hd['heart'] % T.w, hd['heart'] // T.w
            inside = sorted(((lb['x'] / SQ - t['ix0'] - hx) ** 2 + (lb['z'] / SQ - t['iz0'] - hz) ** 2, lb['name']) for lb in labels
                            if T.at(lb['x'], lb['z']) == i and key(lb['name']) not in taken and not denied(lb['name']))
            if inside:
                said.append(f'{hd["name"]}: now {inside[0][1]}, a label of the tiles that lies in it')
                hd['name'] = inside[0][1]
                done = True
                break
            own = T.owner()
            b = T.borders(i, own)
            good = {j: n for j, n in b.items() if not denied(T.hoods[j]['name'])} or b
            if not good:
                # a scrap of land of its own (a pier, a mole): the nearest neighbourhood, if one is within NEAR squares
                near = {}
                for c in hd['cells']:
                    for dz in range(-NEAR, NEAR + 1):
                        for dx in range(-NEAR, NEAR + 1):
                            x, z = c % T.w + dx, c // T.w + dz
                            j = own.get(z * T.w + x) if 0 <= x < T.w and 0 <= z < T.h else None
                            if j is not None and j != i and not denied(T.hoods[j]['name']):
                                near[j] = min(near.get(j, 99), max(abs(dx), abs(dz)))
                good = {j: -d for j, d in near.items()}
            if not good:
                continue
            to = max(sorted(good, key=lambda j: T.hoods[j]['name']), key=lambda j: good[j])
            said.append(f'{hd["name"]} ({len(hd["cells"])} squares): joined to {T.hoods[to]["name"]}')
            T.join(i, to)
            done = True
            break
        if not done:
            for i in bad:
                said.append(f'{T.hoods[i]["name"]}: a name it should not have, and no neighbour to join: left as it is')
            break
    return T.out(), said


def clean_city(folder, log=print, dry=False):
    """hoods.bin in a city's folder through the pass, written back with city.json's count. What hoods.py calls last."""
    path = os.path.join(folder, 'hoods.bin')
    man_path = os.path.join(folder, 'city.json')
    man = json.load(open(man_path, encoding='utf-8'))
    before = unpack(open(path, 'rb').read())
    after, said = clean(before, man.get('neighborhoods') or [])
    for s in said:
        log('names: ' + s)
    log(f'names: {len(before["names"])} neighbourhoods, now {len(after["names"])}')
    if dry or pack(after) == pack(before):
        return after, said
    gz = gzip.compress(pack(after), compresslevel=9, mtime=0)
    with open(path, 'wb') as f:
        f.write(gz)
    if isinstance(man.get('hoods'), dict):
        man['hoods'].update(bytes=len(gz), count=len(after['names']), godless=sum(1 for fl in after['flags'] if fl))
        with open(man_path, 'w', encoding='utf-8') as f:
            json.dump(man, f)
    return after, said


def test():
    def table(rows, names, hearts, flags=None):
        w, h = len(rows[0]), len(rows)
        ix0, iz0 = -3, 5
        t = dict(major=1, minor=0, ix0=ix0, iz0=iz0, w=w, h=h, grid=[int(c) for r in rows for c in r], names=names, flags=flags or [0] * len(names),
                 tagged=bytes((w * h + 7) // 8), hearts=[])
        for hx, hz in hearts:
            t['hearts'].append((((ix0 + hx) & 0xffff) << 16 | ((iz0 + hz) & 0xffff)) & 0xffffffff)
        return t
    lab = lambda name, cx, cz: dict(name=name, x=(-3 + cx + 0.5) * SQ, z=(5 + cz + 0.5) * SQ)
    fails = []

    def expect(what, got, want):
        if got != want:
            fails.append(f'{what}: {got!r}, not {want!r}')

    # the file's own bytes come back
    t = table(['1122', '1122', '3300'], ['Alpha', 'Beta', 'Gamma'], [(0, 0), (2, 0), (0, 2)], [0, 1, 2])
    expect('pack and unpack', unpack(gzip.compress(pack(t)))['names'], t['names'])
    expect('pack twice', pack(unpack(pack(t))), pack(t))
    # 1. strips the map labels as one are one, whatever their size; unlabelled ones only when small; a real "<x> East" beside no "<x> West" stays
    t = table(['112233', '112233', '445566'], ['Mission North', 'Mission South', 'Noe', 'Presidio East', 'Presidio West', 'Richardson East'], [(0, 0), (2, 0), (4, 0), (0, 2), (2, 2), (4, 2)])
    out, said = clean(t, [lab('Mission', 1, 0)])
    expect('strips: names', out['names'], ['Mission', 'Noe', 'Presidio', 'Richardson East'])
    expect('strips: the grid', ''.join(map(str, out['grid'])), '111122' '111122' '333344')
    # (too big together and unlabelled: left)
    global WHOLE
    keep, WHOLE = WHOLE, 3
    out, said = clean(t, [lab('Mission', 1, 0)])
    expect('strips: a big unlabelled one is left', out['names'], ['Mission', 'Noe', 'Presidio East', 'Presidio West', 'Richardson East'])
    WHOLE = keep
    # (strips that do not touch are not one place)
    t = table(['1133', '1133', '2222'.replace('2', '0'), '2222'], ['Bay North', 'Bay South', 'Mid'], [(0, 0), (0, 3), (2, 0)])
    expect('strips: apart', clean(t)[0]['names'], ['Bay North', 'Bay South', 'Mid'])
    # 2. one name each
    t = table(['1122'], ['Tenderloin / Little Saigon', 'Treasure Island / Yerba Buena Island'], [(0, 0), (2, 0)])
    expect('joined names', clean(t)[0]['names'], ['Tenderloin', 'Treasure Island'])
    t = table(['1122'], ['Bunker Rd / Fort Barry', 'Fort Barry / Hill'], [(0, 0), (2, 0)])
    expect('joined names: the road is not the pick, nor a taken name', clean(t)[0]['names'], ['Fort Barry', 'Hill'])
    # 3. a road's name: the tiles' label inside it; else the neighbour with the longest border; an island keeps it
    t = table(['1112', '1132', '0000', '4400'], ['Bunker Rd', 'Marin Headlands', 'Hawk Hill', 'Donner Ave'], [(0, 0), (3, 0), (2, 1), (0, 3)])
    out, said = clean(t)
    expect('a road joins its longest border, a scrap across the gap its nearest', out['names'], ['Hawk Hill', 'Marin Headlands'])
    expect('a road joins: the grid', ''.join(map(str, out['grid'])), '1112' '1112' '0000' '1100')
    out, said = clean(t, [lab('Rodeo Valley', 1, 0), lab('Hawk Hill', 0, 1)])
    expect('a road takes the label inside it', out['names'], ['Hawk Hill', 'Marin Headlands', 'Rodeo Valley'])
    t = table(['1100000022'], ['Donner Ave', 'Mole'], [(0, 0), (8, 0)])
    out, said = clean(t)
    expect('an island keeps its name, and says so', (out['names'], any('no neighbour' in s for s in said)), (['Donner Ave', 'Mole'], True))
    t = table(['1122'], ['Phillip Burton Memorial Beach', 'Fort Funston'], [(0, 0), (2, 0)])
    expect('a plaque', clean(t)[0]['names'], ['Fort Funston'])
    t = table(['1122'], ['Conzelman Rd', 'Bunker Rd'], [(0, 0), (2, 0)])
    out, said = clean(t)
    expect('two roads alone: one is left, and said', (len(out['names']), any('no neighbour' in s for s in said)), (1, True))
    for nm, want in [('Bunker Rd', True), ('Donner Ave', True), ('Lombard Street', True), ('Broderick-Terry Duel Landmark Park', True), ('Mission', False), ('Lands End', False),
                     ('Stonestown', False), ('Road Town', False), ('West Portal', False), ('Outer Sunset', False), ('St. Francis Wood', False), ('Dr Hill', False)]:
        expect(f'denied({nm})', denied(nm), want)
    # every square keeps a neighbourhood, hearts stay on their own squares (out() refuses otherwise), names sorted
    import random
    rnd = random.Random(7)
    for n in range(300):
        w, h = rnd.randint(2, 9), rnd.randint(2, 9)
        k = rnd.randint(1, 6)
        cells = [rnd.randint(0, k) for _ in range(w * h)]
        used = sorted(set(c for c in cells if c))
        if not used:
            continue
        remap = {c: i + 1 for i, c in enumerate(used)}
        cells = [remap.get(c, 0) for c in cells]
        pool = ['Mission North', 'Mission South', 'Bunker Rd', 'Noe / Castro', 'Duel Landmark Park', 'Sunset 1', 'Sunset 2', 'Alpha', 'Beta East', 'Gamma']
        rnd.shuffle(pool)
        names = sorted(pool[:len(used)], key=str.casefold)
        hearts = [divmod(cells.index(i + 1), w)[::-1] for i in range(len(used))]
        t = table([''.join(map(str, cells[r * w:(r + 1) * w])) for r in range(h)], names, hearts)
        out, _ = clean(t, [lab('Mission', 0, 0)])
        if out['names'] != sorted(out['names'], key=str.casefold) or [bool(g) for g in out['grid']] != [bool(g) for g in t['grid']]:
            fails.append(f'random table {n}: the names\' order or the squares')
        if unpack(pack(out))['hearts'] != out['hearts'] or len(set(out['names'])) != len(out['names']):
            fails.append(f'random table {n}: its bytes')
        again, _ = clean(out, [lab('Mission', 0, 0)])
        if pack(again) != pack(out):
            fails.append(f'random table {n}: a second pass changed it')
    for f in fails:
        print('FAIL ' + f)
    print(f'hoodnames: {"FAILED " + str(len(fails)) if fails else "all passed"}')
    return 1 if fails else 0


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = dict((a[2:].split('=', 1) + [''])[:2] for a in sys.argv[1:] if a.startswith('--'))
    if 'test' in flags:
        raise SystemExit(test())
    if len(args) < 1 and 'dir' not in flags:
        raise SystemExit(__doc__)
    clean_city(flags.get('dir') or os.path.join(ROOT, 'public', 'city', args[0]), dry='dry' in flags)


if __name__ == '__main__':
    main()
