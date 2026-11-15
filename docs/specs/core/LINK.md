# The postcard's link, and the save

M1's task 6 (`docs/M1.md`), 2026-11-15, the second account. Format 1.

A postcard is a picture and a link. This is the link: what is written after the `#`, how any phone reads it back, what it does to the saved city, and how that city is saved. The code is `src/link/link.ts` (the link), `src/link/save.ts` (the save, and a card's landing) and `src/link/stamp.js` (the loading page's own readers). `node tools/link/fuzz.mjs` holds all of it; section 10 has what it printed.

It was designed three ways and judged twice (a workflow of three designers and two judges; both judges picked the same base). Once built it was attacked from four sides, each finding checked by a second reader: section 11 says what they found and what was done. Section 9 lists the calls that are the studio's or the producer's, each with a pick.

## 1. What a link says

**Outcomes, never taps.** A card says which squares were lifted, how high each stands, and the order their stages were reached in. It can't say where a thumb went, how many shots missed or how long it took.

A card is one of three things:

| Card | Says | Used by |
|---|---|---|
| a place | a square, a crew, a minute, a caption | M1: FLY TO A STREET's postcard |
| a landmark | a place, and a landmark's key and stage | M1: the Golden Gate's crown |
| squares | a place, and 1 to 32 squares with a stage each and the order they climbed in | M2: the Lift, the Flyby, TAKE IT BACK? |

M1's cards and M2's are one format: a place is a squares card that stops early.

## 2. The address

```
https://<host>/p/<place>/<generation>#<card>
https://<host>/s/<tag>
```

- `<place>` is a page name: lower-case letters, digits and single hyphens, 48 characters at most (`slugOf`: "Fisherman's Wharf" is `fishermans-wharf`). It is a neighbourhood's name or a landmark's key. For a card it is the neighbourhood the card's own square is in (`frame.pageOf(key)`). San Francisco's are bare; a later city's start with the city and a hyphen (`amsterdam-jordaan`), so there is one grammar and no page name is used twice.
- `<generation>` is 0 to 99: how many cards down a chain this one is. A card sent from nothing is 0; a card sent in answer to a generation-3 card is 4.
- `<tag>` says where a post came from (`/s/tt1`): 16 characters at most, the same grammar.
- The path is what a page counter sees. The card is after the `#`, which a browser never sends to a host.
- The path is only ever a fallback. Where a card reads, the card says where the bus lands.

## 3. The card's text

### 3.1 Characters

32 characters, five bits each, value 0 to 31 in this order:

```
0123456789abcdefghjkmnpqrstvwxyz
```

Written in lower case. A reader takes either case, takes `O` as `0`, and `I` and `L` as `1`. There is no `i`, `l`, `o` or `u`. So a card is one unbroken run of letters and digits: nothing in it for an app to escape, cut at, or turn into a link of its own.

### 3.2 Shape

```
1  HEAD  [ CORE  [ TAIL ] ]
```

The first character is the format, `1`. Then up to three sections. Each section is

```
LEN (2 characters)   PAYLOAD (LEN characters)   CHECK (3 or 6 characters)
```

- `LEN` is the payload's length in characters, 0 to 1023, the high five bits first.
- `PAYLOAD` is a string of bits, the first bit the high bit of the first character, padded at the end with 0 to 4 zero bits.
- `CHECK` is a CRC over every character of the card before it, from the `1` on (so the core's check covers the head too). Bits go in five a character, high bit first. The register starts as all ones; nothing is turned over at the end. The head's and the tail's are 15 bits (generator 0x4599, CRC-15/CAN's), written as 3 characters; the core's is 30 bits (generator 0x2030B9C7, CRC-30/CDMA's), 6 characters. High bits first.

Test values: over the 32 characters of the alphabet in order, the 15-bit check is 29967 and the 30-bit one 406111430.

What the checks promise: damage that fits inside three neighbouring characters, and leaves a section's two length characters alone, never reads as another card at any level; inside six it never reads as other squares. Damage that is wider, or that falls on a length character (the check is then read from another place), is caught by the check's width in luck: one time in 32,768 it leaves a head reading as another place, and about one in a thousand million a core. All such a slip can do is land a bus somewhere else. Making it exact would take a check on the length itself, a change of format, and was not thought worth it.

### 3.3 Numbers

- `u(n)`: n bits, high bit first.
- `uv`: a whole number in groups of four bits, the biggest group first. Each group has one bit in front of it that says another group follows. So one character a group. It is written with as few groups as it needs; a reader refuses one written longer (a first group of zero with more to come).
- `zz`: a signed number as `uv` of 0, 1, 2, 3, 4 for 0, -1, 1, -2, 2.

### 3.4 The head

| Field | Bits | |
|---|---|---|
| form | u(2) | 0 squares or a place, 1 a landmark, 2 and 3 a later build's |
| parts | u(2) | sections after the head: 0 a place, 1 a landmark, 2 squares |
| crew | u(4) | 1 to 5 written. A reader refuses 0, takes 1 to 15, and holds 6 and up to the head |
| map | uv, 3 groups at most | the city: 0 San Francisco, 1 Amsterdam, 2 London (`MAPS`: a city keeps its number for good, a new one goes on the end) |
| ix | zz, 4 groups at most | the card's own square (`squareKey`'s ix and iz, -32768 to 32767) |
| iz | zz | |
| minute | u(25) | the postmark: minutes since 2026-01-01T00:00Z |
| n | u(6) | the caption's length, 0 to 40 |
| caption | n times u(6) | section 3.8 |
| blocks | | section 3.7. None are defined |

A place is the head alone, with form 0 and parts 0. A form and parts that do not go together (a landmark with parts 2) hold the card to its head.

### 3.5 The core

**Squares** (form 0, parts 2):

| Field | Bits | |
|---|---|---|
| w - 1, d - 1 | u(4), u(4) | the box the squares sit in, 16 by 16 at most |
| ox, oz | u(4), u(4) | where the card's own square is in the box |
| cells | w times d bits | a row at a time, the smallest iz first, the smallest ix first in a row; 1 is a square of the card |
| stages | N times u(2) | for each square in the cells' order: its stage less one (1 to 4) |
| blocks | | tag 1 "answers", tag 16 "score" |

The card's own square is one of its squares. The box is as small as its squares allow (its first and last row and column each hold one). N is 1 to 32. Every square lies within -32768 to 32767: a box that runs past the edge is refused. A reader refuses anything else too, so one card has one text.

**A landmark** (form 1, parts 1): `u(4)` the key's length less one, then that many `u(6)` characters from the caption's table (letters, digits and the hyphen only: `GGB`), then `u(2)` its stage less one, then blocks (tag 1). The key is `city.json`'s `kind` in capitals. Its head's square is the landmark's own (`frame.mark('ggb')`).

### 3.6 The tail

Squares only. For each climb in order, one square's index (its place in the cells' order), in the fewest bits that hold N - 1 (0 bits for one square, 5 for 17 to 32). There is no count: there are exactly as many entries as the stages add up to, and each square's index appears exactly as often as its stage. A square's k-th entry is "reached stage k". Entries that say anything else are refused. Blocks may follow the entries, by 3.7's rules; none are defined.

The width is worked out with whole numbers (`32 - Math.clz32(N - 1)`), never a logarithm.

### 3.7 Blocks

After a section's fixed fields come blocks, to the section's end: `u(5)` a tag (1 to 31, each higher than the one before), `uv` a size in bits (3 groups at most), then that many bits. A reader that doesn't know a tag under 16 passes over it and says so (`skipped`). One that doesn't know a tag from 16 up refuses the section. A known tag of another size is refused. So a later build can add what an old one may ignore, and what it must not.

| Section | Tag | Bits | |
|---|---|---|---|
| core | 1 | 30 | answers: the `id30` of the card this one answers |
| core (squares) | 16 | 16 | score: `u(8)` the paint a card of today's place had, `u(8)` what it used. Such a card is shown and never landed, which is why an old reader must not take it for squares |

### 3.8 Captions

Six bits a character:

```
 0-25  A-Z      26-35  0-9      36 space   37 &   38 '   39 -
40-45  kept back (never written, refused when read)
46-63  É È Á À Í Ó Ú Ü Ö Ä Ñ Ç Å Ø Æ Ï Ê Ô
```

40 characters at most, no space at either end, no two spaces together. There is no full stop, slash, colon, comma, question mark, hash or at-sign, so a forged card can't spell an address on the loading page. `captionFrom` turns any words into a caption that fits: capitals; a letter with a mark the table lacks as its plain letter (Ř is R); a letter it has no like of left out, the word kept whole; anything that is no letter a gap; and over 40 the street words go first (ST, AVE, DR), then whole words from the end. "Martin Luther King Jr Dr & John F Kennedy Dr" is `MARTIN LUTHER KING JR & JOHN F KENNEDY`.

### 3.9 What makes two cards the same card

A card's **id** is its text up to the end of the core's check (a place's is its whole text). Its **id30** is the same in 30 bits: the core's check as a number (a place's is the 30-bit check of its text). The order is not in it: the same squares with the order lost are the same card. The minute is in it: two friends who lift the same block the same day send two cards.

A card's **seed** is the 30-bit check of its head's text. It is what deals a newcomer's crew (section 6, rule 5), and it is the same for a link whole, torn after its squares, or torn to its head.

### 3.10 Sizes

Of the example cards (`node tools/link/examples.mjs`):

| Card | Whole address |
|---|---|
| a street, and no more | 93 characters |
| the Golden Gate, crowned | 100 |
| one square | 110 |
| nine squares | 133 |
| seventeen squares | 158 |

And from the fuzz's `length` row: its own usual 17-square card is 163; seventeen at their worst (all at the Lift, spread over 16 by 16, a 40-character caption, an answer, a 48-character page name) are 311; the longest address any card can make is 389. M1's line is 2,000.

### 3.11 Examples

`node tools/link/examples.mjs` prints these from the code, each with what it reads as. (Their page name is `mission`, which the city has once task 11's names are in; a card lands by its own square whatever the path says.)

```
https://struggle-bus-world.vercel.app/p/mission/0#115080p5g1qvesa6a125248kmh4kj9chry9hwh4kpr4
  a place: map 0, square -3,14, crew 2, 2026-11-14T18:30Z, "GUERRERO ST & 24TH ST"

https://struggle-bus-world.vercel.app/p/ggb/0#113a42m6gc1qves4672rc8dj1g164j0a4g3310tqv054630enp6pma
  a landmark: square -41,-34, crew 1, "GOLDEN GATE BRIDGE", GGB at stage 4

https://struggle-bus-world.vercel.app/p/mission/0#115480p5g1qvesa6a125248kmh4kj9chry9hwh4kw4w04000egrhy9q00mz9
  one square: -3,14 at stage 4; order 0 0 0 0; id30 562624823

https://struggle-bus-world.vercel.app/p/mission/0#115480p5g1qvesa6a125248kmh4kj9chry9hwh4kw4w09488zz791rcq2bzs0jgd8k89krgg8q4c82ewxda
  nine squares: -4,13:1 -3,13:4 -2,13:3 -4,14:3 -3,14:2 -2,14:1 -4,15:1 -3,15:4 -2,15:3
  order 8 3 5 1 3 4 2 6 7 8 8 4 1 1 7 2 3 1 0 2 7 7

https://struggle-bus-world.vercel.app/p/mission/1#10j4g0p5g1qvtmak02ggtyre0f248f7r65t327s6w6djw2s05etxd2yby
  an answer, one card down the chain: crew 4, "TAKEN", squares -4,14:1 -3,14:4 -4,15:4 -3,15:3, answers 562624823
```

The first one, bit by bit. `1`, then `15` (a payload of 37 characters), then the payload `080p5g1qvesa6a125248kmh4kj9chry9hwh4k`, then the check `pr4`. The payload's bits: form 00, parts 00, crew 0010, map `0 0000`, ix `0 0101` (zz 5 is -3), iz `1 0001`, `0 1100` (zz 28 is 14), then 25 bits of minute (457590), 6 of length (21), and 21 captions' characters.

## 4. Reading

`decode(text)` takes any text at all and never throws. `parseLocation(pathname, search, hash)` does the same for a whole address, as a page has it from `location`.

**Cleaning.** Every `#` in front is dropped. Spaces, line breaks, and the soft breaks an app may put in a long word (U+00A0, U+00AD, U+200B to U+200D, U+2060, U+FEFF) are taken out wherever they are, both as they stand and as a browser hands them to a page (`%20`, `%0A`, `%C2%AD`, `%E2%80%8B` and the rest). Then the card is the run of the alphabet's characters from the start: the first character that isn't one ends it. So `?fbclid=…`, a full stop or a bracket after a link do nothing.

Spaces can be taken out anywhere only because every section says how long it is. Words that follow a link ("…k09k check this out") can add characters after the card, never inside it, and whatever follows the last section is not read.

**Where the card is.** After the `#`. Where what follows the `#` reads as no card, and an app has written a `#` into the path as `%23` (or twice, `%2523`), what follows that is tried; then the same in the query. The first that reads as a card is the card. Nothing is unescaped to find it, so a bad escape elsewhere in the address costs nothing.

**The ladder.** A reading has a level:

| Level | What held | What lands |
|---|---|---|
| `full` | everything the head promised | the card |
| `core` | the head and the squares; the order was cut off or damaged | the same squares, the same card (the same id), with a stand-in order |
| `head` | the place alone; or a later build's crew or kind of card | the bus, over the card's square |
| `none` | nothing | the path's page name if the city has it; else the door |

The stand-in order (`defaultOrder`) is a wave out from the card's own square: every square to stage 1, nearest first, then to 2, and on up. Nearest is by the larger of the two differences (rings), ties in the cells' order.

A card cut anywhere reads as exactly what it still holds. `explain(href)` says all of this in words, for the console.

## 5. The save

### 5.1 A square: 24 bytes

| Bytes | Field | |
|---|---|---|
| 0-3 | key | `packSquare(ix, iz)`, little-endian like the rest |
| 4 | owner | the crew, 1 to 15 |
| 5 | stage, cracks | stage 1 to 5 in the low four bits, cracks in the high four |
| 6-7 | hits | |
| 8-11 | tended | epoch s |
| 12, 13, 14-15 | ax, az, ay | the anchor: m in the square (0 to 127), and the ground's height in dm. `ay` -32768 is "no tile has said yet" |
| 16-19 | rev | epoch s of the record's last change on some phone. 0 is old paint's |
| 20-23 | card | bit 31 `guest`, bit 30 "a card has been here", bits 0-29 that card's id30 |

The first 16 bytes are `areas.ts`'s save, byte for byte (the `engine` row checks it against `Areas.encode` and `Areas.decode`). The 8 new ones are what makes saving safe:

- **`rev`** says which of two records of one square is the later. A change made now gets `max(now, old rev + 1)`, so a clock put back still moves forward. A clock in milliseconds is read as one. A clock that is nonsense, or past 2100, is not believed: the change counts on from what was known.
- **`card`** is the last card that put this square here. That card never lands on this square again, even if the phone forgets it ever saw the card. It stays through the engine's changes.
- **`guest`** is set while the square is as a card left it and whose it was. It clears when the square changes hands. It is how the game knows a square is a friend's to take back, and how a take-back is told.

### 5.2 The rest

- **Landmarks**: by key in lower case (`ggb`), the same fields without a place: owner, stage, cracks, hits, tended, rev, card. `touchMark` writes one (the door's crown).
- **Cards the phone knows** (`Note`): id, id30, `out` (sent) or `in` (opened), the card's text (so a sent card can be sent again exactly), when, generation, page name, the card's own square, the sender's crew, when it was taken back (`taken`, 0 while it stands), and the card it answers. 192 sent and 64 opened are kept. `wornNow(save, note)` is the crew an opened card's squares wear now.
- **The crew**: the player's, with when it was set. 0 until one is picked, dealt, or the phone sends its first card. Until then it paints as Rainbow (`crewOf`).
- **The climbs**: the last 512 counted changes of a square's owner or stage (when in ms, where, owner and stage after). A climb's time is the clock's, or one past the climb before it where the clock hasn't moved on: so two climbs in one second, a clock put back, and a broken clock all keep the order things happened in. This is where a card's order comes from: `orderFrom(save, squares, crew)`. Once older climbs have been let go (`forgot`), the stages below a square's first kept climb count as long ago and go first. It is always an order a card can carry, and while nothing has been forgotten it is the true one.

### 5.3 The join

`joinSave(a, b)` makes one save of two. Square by square the later `rev` stands, and where two tie, a fixed order of their own fields decides, so every phone picks the same one. The anchor is joined apart (whichever has one). Notes join field by field (sent beats opened, the earlier time, the fuller text, taken once it has been). Climbs are a union.

It has no order in it: a joined with b is b joined with a; three saves joined either way round are the same; a save joined with itself is itself. That is the whole trick. Two tabs, a journal written on the way out and a database can each hold a save of the same city, and joining them in whatever order they turn up gives one answer.

`flush(mem, backend, now)` is the only way to write: it reads what is stored, joins it in, moves on any card's square that has come to wear the player's own crew (`rewear`: two tabs dealt two crews, section 6 rule 4), trims, writes, and hands back the joined save for the tab to go on with. `changedSquares(before, after)` is what the other tab changed. A tab that just writes what it has loses the other tab's work (the `tabs` row shows it: 1,377 squares' last changes lost in 300 runs; none with the join).

`trim` holds a save to its caps when it is written: the oldest climbs go; of the opened cards, those whose squares no longer carry them go first, then the oldest; of the sent cards, the oldest. Each kind has its own cap, so no number of sent cards can push out the card a friend's squares came by.

### 5.4 As text, and where

`saveText(save)` is the save as one text of six lines: `SBW2`; the squares (24 bytes each, by key, in base64: 32 characters a square, no padding); the landmarks; the notes; `[crew, when, forgot]`; the climbs (15 bytes, 20 characters each). The same save is always the same text. `parseSave` reads any text, never throws, and loses only what it can't read: one bad character costs the one square it is in.

- **M1**: one key a city in `localStorage`, `strugglebus.city.v2:<slug>` (`storageBackend`; `loadSave` reads it). A Storage that throws reads as empty and says the write failed. Something stored there that is no save is said (`lost` -1) and written over.
- **The save before this** (`strugglebus.areas.v1:<slug>`, 16 bytes a square, written only under `?lift` and `?recess`): `fromAreasText` brings it across with `rev` 0, so anything newer stands over it; a square it can't read is left out and counted.
- **A phone that has painted before** has no save of this kind at all: its paint is in the buildings' own save. It has always painted as Rainbow. The host knows it by that paint and says so when it opens a link (`openLink`'s `returning`), and the phone is Rainbow, not dealt a crew.
- **M2's task 13** (IndexedDB) keeps the same things as rows: a store `sq` (key to 24 bytes), `lm`, `cards`, and `meta` (crew, climbs), written a changed row at a time and joined row by row with `joinRec`; with the `localStorage` text as the journal written on `pagehide`, joined in at the next start. `SaveBackend` is the seam: the database is another backend for the same `flush`.

## 6. A card lands

`openLink(save, visit, frame, now, { returning, ground })` is called once, when the page starts, with `parseLocation` of the address the page started with. It changes `save` in place and says what the game does next.

| `kind` | When | What it did |
|---|---|---|
| `flyby` | a squares card new to this phone | wrote its squares, remembered it; `beats` is the Flyby; `landed` is each square it wrote, with its place on the card and what stood there |
| `score` | a card of today's place, new here | remembered it; wrote nothing; `beats` is the ghost |
| `mark` | a landmark's card, new here | remembered it; wrote nothing |
| `spot` | a place alone, a card torn to its head, or a card with nothing left to land | nothing: land there |
| `seen` | a card opened here before | nothing |
| `own` | a card this phone sent, a street card included | nothing |
| `place` | no card that reads, a page name the city has | nothing: land at its square |
| `door` | none of those | nothing |

**The rules.**

1. **A card lands once a phone.** It is remembered by its id. A card read with its order lost lands the same squares under the same id, so the whole card opened later is one the phone has seen.
2. **What it lands is the sender's.** Every square the card names becomes: the card's crew (rule 4), the card's stage (held to what that ground can reach), no cracks, hits equal to the stage, tended at the card's minute (never later than now), `guest`, and the card's id30. **Whatever stood there**, the player's own higher square included. Nothing in the rule asks whose a square was.
3. **Left alone** are only: a square nothing can be lifted on (water, off the map); a square where a god stands (stage 5); a square this very card has already been on.
4. **The crew it wears.** The sender's. Where that is the player's own crew, the next crew round the wheel (`wornBy`), so there is always something to take back. And it stays so: when the player picks another crew (`setCrew`), or two tabs were dealt two crews, any card's square that would wear the player's own moves on round the wheel (`rewear`).
5. **A newcomer is dealt a crew** by the card that brought them (`dealCrew` of the card's seed): one of the other four, the same one however the link arrives, whole or torn, and never the sender's. It is saved in the same step, before anything is drawn. A phone that has painted before is Rainbow and is dealt nothing (5.4).
6. **A score, a landmark's card, a place alone** write no square. In format 1 a landmark's card is replayed and remembered, and the receiver's own crown is not touched.
7. **A card of another city, or of somewhere off the map**, is not landed: the page name, or the door.
8. **An answer.** A card that answers one this phone sent (`answers`), and lands on that card's own square, marks the sent card's note taken. That is TAKEN on the sender's phone. A card that lands nothing marks nothing, and a card this phone only opened is never marked by someone else's answer. (So in format 1 a crown is never marked taken: rule 6.)
9. **Taking back.** When the player takes a card's own square (the engine's flip), `noteTaken` marks the opened card's note. That is the moment for TAKEN on the receiver's phone, and the `answers` of the reply.
10. **Once a page.** A page reads its address when it starts and never again (never on `hashchange`), and lands at most one card. A page that re-read its address could be steered card after card by whatever opened it.
11. **An address never changes what the phone knows of a card it sent.** Opening one's own card, or a look-alike of it, is `own` and changes nothing.

**Why the order of tiles can't matter.** A tile that loads (`landTile`) may do two things, each a matter of one square's record and the tile's own data: give a record its anchor if it has none; and, where the phone has old building paint on a square with no record and the ground can be lifted, make one (STAGES.md 1.5, "Old saves": stage as the paint's, 3 at most, `rev` 0). It never changes whose a square is or how high. A card's record does not depend on what stood there (rule 2), and a record made after its tile is in takes its anchor at once (`ground`). So card then tile, and tile then card, end the same. The `tiles` row plays all 362,880 orders of nine tiles at six places and gets one saved city each time; it also asks what the tiles did outright, and shows that two plausible wrong rules ("a card leaves the receiver's own squares alone", "a record made after its tile landed waits for the tile") each give more than one.

One thing the engine must keep to: it changes a square (`touch`) only while that square's tile is in. It does today, since a hit needs the tile's buildings. A change made before the tile would not know of old paint there.

`frame` is the city as a landing needs it (`frameFrom(city, hoods, slugOf, { top })`): the map's number and bounds, each square's top stage, a page name's square, a square's page name, a landmark's square. All of it comes from `city.json` and `hoods.bin`, which a page has before any tile. `top` should be the engine's own (`areas.topOf`), so that the frame and the engine never disagree about a square.

## 7. The loading page, and the host

**The stamp.** `index.html`'s scripts run before the game's code is in, so the stamp at 0 to 1 s can't call `link.ts`. `src/link/stamp.js` is two ES5 functions with nothing outside them, to be put in the page as they are:

- `sbwStamp(location.href)` gives `{ map, ix, iz, crew, at, caption, place, gen }` or null. The `stamp` row runs its source against `link.ts` on every address the other rows make (591,889 of them, each read as text and as a browser's URL parser hands it over) and they agree on every one.
- `sbwLastCard(text)` reads the newest card this phone sent out of the save's text: `{ text, at, place, gen }` or null. It is what "the next visit's loading page offers the last card" reads; `sbwStamp('#' + text)` is then its stamp. The `last` row holds it to `save.ts`'s `lastSent`.

To change one reader, change both.

- A crew of 6 or more draws a crest that takes no side.
- A page name is shown only if it is in a table the page has (never as raw words from the path).
- The caption can be shown at once: it can't spell an address (3.8). Once the street index is in, the game's own caption for that square replaces it.

**The host.** These are the first account's, and a postcard link does not work until they are in. Checked against the files on `feat/handling` f9accb0:

1. Under `/p/<place>/<gen>` every relative address breaks. `vite.config.ts` has `base: './'`, and the page builds addresses of its own from `./`: `index.html` lines 11, 12, 26 and 83 (`'./city/' + city`), `src/main.ts` 165, `moonrun.ts` 472, `moonBoot.ts` 98 (`new URL('.', location.href)`) and life's. All of them need to be absolute.
2. `vercel.json` has no rewrites: it needs them to the game's page for `/p/:place`, `/p/:place/:gen` and `/s/:tag`, a last part that holds an escaped card included. `tools/sky/serve-dist.mjs` (what the rows serve a build with) and the dev server need the same, or task 7's row can't open a postcard link.
3. `index.html` line 19 has an `og:url` of the bare site. On a place's page it must go, with any `rel=canonical`: Safari's share sheet sends a declared address in place of the real one, without the `#` (WebKit bug 250317).
4. There is no page counter today. The day one is added it must not see the card: Vercel's script posts `location.href`, `#` and all, so its `beforeSend` must cut the address to the origin and `/p/<place>/<gen>` or `/s/<tag>`, with no query, no `#` and no `%23` tail.
5. `Cross-Origin-Opener-Policy: same-origin` and `Content-Security-Policy: frame-ancestors 'none'` on the page (today `vercel.json` sets only cache headers), so another page can't hold it in a frame or steer its window (rule 10).
6. A short domain, when the producer picks one, is the site itself or a plain redirect. Never a frame.

## 8. How it is used

**M1, postcard v1 (task 7).** This type-checks against the files as they are.

```ts
import { encode, cardUrl, cardMinute, captionFrom, parseLocation } from './link/link';
import { loadSave, flush, openLink, noteSent, crewOf, lastSent, frameFrom, storageBackend, packSquare, squareIx, squareIz } from './link/save';

const backend = storageBackend(localStorage, city.slug);
let save = loadSave(backend).save;
const frame = frameFrom(city, hoods, slugOf, { top: (key) => areas.topOf(key) });

// open: once, at the start, before the first frame
const landing = openLink(save, parseLocation(location.pathname, location.search, location.hash), frame, Date.now(), { returning: hasOldPaint });
save = flush(save, backend, Date.now()).save;
// landing.key is the square to start over (-1: the door)

// send: a street (the square the bus is over), or the crown (from the landmark's own square)
const key = squareUnderBus;                     // for the crown: frame.mark('ggb')
const card = { v: 1 as const, map: frame.map, ix: squareIx(key), iz: squareIz(key), crew: crewOf(save), at: cardMinute(Date.now() / 1000),
  caption: captionFrom(streetName), body: null };   // for the crown: body: { form: 'mark', key: 'GGB', stage: 4, answers: null }
const written = encode(card);
if (written.ok) {
  const place = frame.pageOf(key) || 'ggb', url = cardUrl(location.origin, place, 0, written.text);
  noteSent(save, written, card, 0, place, Date.now());   // the settings sheet's stack is the notes with role 'out'; lastSent(save) is the newest
  save = flush(save, backend, Date.now()).save;
}
```

The postmark in Pacific time is `new Date(cardSeconds(card.at) * 1000)` through `Intl.DateTimeFormat` with the city's `tz`.

**M2.**

- The engine's `onChange` calls `touch(save, area, Date.now(), ground)`; a flip to the player's crew calls `noteTaken(save, key, was, Date.now())` with the record as it was.
- A tile that loads calls `landTile(save, squares, frame)`; `ground(key)` is a loaded tile's anchor for a square, or null.
- A card of squares: `squares` sorted by `iz` then `ix`, `order: orderFrom(save, squares, crewOf(save))`, and for a reply `answers: note.id30` of the card taken (`noteTaken`'s note).
- The Flyby plays `landing.beats` (`{ i, ix, iz, stage }`, in order). `landing.landed` is one entry a square written: `i` its index on the card (the beats' `i`), `rec` its record, `was` what stood there, for the fall. Hold a landed square not ready (the engine's `last = +Infinity`, as `liftRules`' seed does) until its beats have shown.
- The faction button calls `setCrew(save, crew, Date.now())` and redraws the squares it returns.
- After a flush, `changedSquares(before, after)` is what another tab changed.

## 9. Calls that are the studio's or the producer's

Each is built one way so the rows can run. Changing any of them changes one function and no link.

1. **A card takes the receiver's own lifted block** (rule 2). All three designs chose it: a reply only works if a card can land on squares the other side holds. It costs the receiver about 40 s a square to take back, with no undo. *The producer's to feel on the phone.* My pick: keep it; if it reads as harsh, cap how many of a player's own squares cards may take in an hour.
2. **The same-crew case** (rule 4): the next crew round the wheel. The other ways were a gift (nothing to take back) or teaching the engine a guest flag. *The studio's.* My pick: the wheel; both judges picked it too.
3. **A landmark's card** writes nothing in format 1 (rule 6), so a crown is never TAKEN. *The studio's.* My pick for M1; M2's takeover can land a crown with the same rules as squares.
4. **TAKEN's moment** on the receiver's phone is the card's own square changing hands (rule 9), not every square of the card. *The studio's.* My pick: the own square; it fits the 30 to 60 s the direction asks for.
5. **A forged caption** can stand on the loading page for a second or two over a real block. It can't be an address. *The producer's ("no name, ever" is a ruling).* My pick: show it.
6. **"After the `#`" is private from our host only.** A link wrapper (a mail filter, Meta's redirect) carries the whole address to its own server. A card is never finer than a 128 m square.
7. **A card proves nothing.** There is no server, so nothing signs a card. A friend can hand-make an answer and have their friend's phone say TAKEN without playing; a stranger's link can land 32 squares on whoever taps it. Rule 10 bounds it to one card a tap. *The studio's to weigh.* My pick: accept it among friends for format 1.

**Only a phone can say:**

- Does each app hand the page the `#` and what follows: Messages (through its preview card), WhatsApp, an Instagram message, Slack, Gmail. M1b's step 4 should open a 17-square link in each, on a page that prints the level read (`explain(location.href)`).
- Does the share sheet send the link beside the picture. If an app takes the picture and drops the link, the link goes as a second share.

## 10. What ran

`node tools/link/fuzz.mjs` on this commit, all 24 rows, no browser ("link: all passed", about 80 s):

| Row | What it holds |
|---|---|
| `round` | 10,000 random cards written, read back the same, written again to the same text, with the clock and the dice taken away |
| `saved` | 10,000 random saved cities (120,062 squares) as text and back, compared value by value, nothing lost; 200,000 random 24-byte records: refused, or written back as the same bytes |
| `tiles` | all 362,880 orders of nine tiles, at six places: one saved city each, and what the tiles did asked outright. 24,000 more plays with the card landing at any point and reloads in the middle. Two wrong rules caught |
| `length` | a 17-square place's address: 163 characters as usually sent, 311 at its worst; the longest any card makes is 389 |
| `golden` | 14 pinned texts, bit for bit, and `explain`'s words for four addresses |
| `mangle` | 2,000 cards bent 23 ways, each read as the text stands and as a browser's URL parser hands it to a page (capitals, O for 0, a broken line, `%20`, soft breaks, a no-break space, words after, trackers before and after, `##`, `%23`, `%2523`, a `#` that holds no card, a bad escape beside the card): each still the same whole card |
| `ladder` | 1,500 cards cut at every length (132,561 cuts): each reads as exactly what it still holds |
| `damage` | 158,685 damaged cards: none read as other squares or another whole card; one to three neighbouring characters off the length characters always caught; none of the wider or length-character damage left a head reading as another place in this run |
| `total` | 400,000 texts that are no honest card: none threw; every one that read whole is exactly the text its card is written as |
| `refuse` | 52 cards that say what no card may, each refused for the right reason; 10 at the edge of what one may say written and read back |
| `blocks`, `caption`, `path` | later builds' blocks, crews and kinds; 50,000 random captions; 30 addresses, `cardUrl`'s fallbacks, 20,000 page names, the deal and the wheel |
| `speed` | 10 readers on 14 hostile megabytes each: the slowest 147 ms |
| `stamp` | the loading page's reader agrees with `link.ts` on all 591,889 addresses the rows made, as text and as a page gets them |
| `text`, `laws`, `clock` | 21,000 damaged saves, one bad character costing one square; 4,000 triples joined every way round; 18 broken clocks, and climbs that keep their order under all of them |
| `records` | one record and one small save pinned to their bytes and text; the save's key and a card's minute 0 pinned; 12 kinds of nonsense record refused; the later record, landmark and note stands; the crown saved and read back |
| `land` | 40,063 checks of rules 1 to 11, and the frame's squares and page names pinned |
| `engine` | 400 games on the real `areas.ts`, hits four a second: the save's squares are what `Areas.encode` writes; the card's order is the true order in all 365 games that fit the kept climbs; the card lands on a friend's phone and the friend's own engine takes it back hit by hit, a same-crew friend included |
| `tabs` | 300 runs of two tabs on one store: one save at the end, no later change lost, each flush naming exactly what the other tab changed; a newcomer with two cards in two tabs ends with one crew no card's square wears; a flush holds what it writes to the caps |
| `last` | the page's reader of the last card sent agrees with `save.ts` on 5,000 saves |
| `names` | today's 115 neighbourhood names and 4 landmarks make 119 page names, no two the same |

M1's three: `round` and `saved`; `tiles`; `length`.

## 11. What tried to break it

Four attackers, each with its own way in, and a second reader on each who had to reproduce every finding before it counted: one wrote a reader and a writer from this spec alone and compared them with the code; one fuzzed the card's text and the two readers against a browser's URL parser; one went after the save; one changed the code 60 ways to see which changes the rows missed, and wrote the glue section 8 sketches against the real types.

They found 59 faults and their checkers ten more; every one was confirmed. None was a blocker: no honest card read as another, and M1's three rows held. All are answered in this commit but the limits listed below. The ones worth knowing:

- **Soft breaks reached the page escaped** (`%E2%80%8B`) and ended the card. The rows had only read addresses as text. Now both readers take the escaped forms, and the rows read every address as a browser hands it over.
- **Two climbs in one second** came out in the order of their squares' keys, not the order they happened. Climbs are now in ms and always rise.
- **One bad character in the save's squares cost the whole city** at the next flush. A square is now its own 32 characters.
- **A long junk path took seconds** to read (a regular expression that went quadratic). Gone, and held by the `speed` row.
- **A phone that had played before would have been dealt a crew.** It is Rainbow.
- **A torn link dealt every newcomer crew 1.** The deal is by the head, the same whole or torn.
- **A card's squares could end up the player's own crew** (a crew picked later, two tabs). They move on round the wheel.
- **An answer could mark a card TAKEN without taking anything.** It must land on the sent card's own square.
- **The rows could not see 24 kinds of wrong code**: a card written that no reader would take, a record of crew 0 let through, TAKEN forgotten by a join, the save's key or a card's date moved. Each has a row now.
- **Section 8 did not type-check**, and the host list missed that the page builds `./` addresses of its own. Both rewritten from the files.

**Known limits, left as they are:**

- **`rev` can run a few seconds ahead of the clock** under many changes in one second. Two tabs changing the same square inside those seconds: the tab with more changes stands. It needs two tabs of the game and a card landing in the same breath.
- **The checks' promise stops at the length characters** (3.2).
- **A card proves nothing** (section 9, call 7).

## 12. Not done, not checked

- **Nothing here is wired into the game.** `main.ts`, `index.html`, `vercel.json` and the settings sheet are the first account's; section 8 is what they call. Nothing ran in a browser or on a phone: "as a page gets it" is Node's URL parser, which follows the standard browsers follow.
- **IndexedDB** is M2's task 13. The record, the join and the seam are here; the store is not.
- **The areas engine does not yet write through `touch`**, and `Areas.make` still starts an anchor at 0, 0, 0 where this save says "none yet". Both are M2's task 11 (the second account's).
- **"Can float"** (has houses, is not park) is not a bit in `hoods.bin` yet. Without the engine's own `top`, `frame.top` holds a square to 3 where the map tags it and to 4 elsewhere, and calls a square in no neighbourhood unliftable: the two bridges' own squares among them. The bit has to be in `hoods.bin` (not in a tile, or tile order matters again) before M2's Lift.
- **Retired page names.** When the bake renames a neighbourhood, the old page name should keep landing. The bake should keep a list; nothing reads one yet.
- **Other cities.** `map` is in every card; a card of another city is not landed (rule 7). Loading the other city for it comes with the world. `captionFrom` and `slugOf` were tried on a few Dutch, German and Polish names only.
