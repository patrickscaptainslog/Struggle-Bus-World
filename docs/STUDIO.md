# GREETINGS FROM SAN FRANCISCO: the studio's direction

The game director, 2026-11-14. Final after the red team. Built from the studio's working papers (four studies, four pitches, four judges, two red teams; not in the repo) and the producer's rulings in `CLAUDE.md`.
Marks: **known** = measured, or read in the code, the docs or a study. **infer** = the studio's reading. **guess** = no source. Every engineer-day ("day") is an ESTIMATE. The producer was shown the direction (the spine, what waits until after the San Francisco launch, the milestones) and asked "Go with this direction?": "Looks good to me" (2026-11-14). The rest of part 12 is still asked as it says there: the studio builds on its own picks, on preview links only, and the producer judges them by playing.
Where we start from is saved: every branch as it stood, tags `save-2026-11-14/*` (`docs/SAVEPOINT-2026-11-14.md`).
The first milestone, as work: `docs/M1.md`.

## The decision in one line

**The spine is the Postcard, aimed at someone else's street.** Paint a place until it floats, send the postcard to the person who lives there, and the link lands them over their own street in your colours, asking TAKE IT BACK?

Where the pitches disagreed, what we picked, and what we gave up:
- **The spine: Postcard over Run.** Gave up the Run's 90 s clock. Kept its place of the day and a score worth texting, from a fixed paint budget.
- **The door: the Ride's start, without its rails.** Gave up the autopilot. Kept paint on the Golden Gate in the first seconds. The bridge itself is the first payoff, because the nearest houses that can float are kilometres away.
- **The share: a picture first, a clip tested early.** A 2-day clip test runs in M2, not after the launch.
- **The other player: a friend by link, not a shared map.** One shared San Francisco needs a server: season 2, if the numbers earn it.
- **Your street: you fly there by name.** No location prompt. FLY TO A STREET sits in the settings sheet from M1.
- **The rival buses and life: in the launch only if the phone holds them.** Decided at M3's end, before strangers play.

## 1. The promise, and the three pillars

**"It's a flying school bus that paints the real San Francisco. I painted your street. Tap to take it back."**

1. **Your San Francisco.** Real places you know, named as you paint. Every link lands someone over a place that is theirs.
2. **Paint you feel at once.** One thumb. First paint within about 8 s of the tap on a link. Every hit lands hard, with or without sound. The Lift (houses jump and float) is the payoff.
3. **Every picture asks something.** Each postcard carries a dare (TAKE IT BACK?, BEAT 14, YOUR STREET IS NEXT) and the way back (a short address printed on it).

## 2. Who it is for, and the moment they send it

- **First:** people who live in San Francisco, 16 to 40, on iPhones, in group chats with roommates, partners, family and coworkers. About 800,000 live in the city (guess, from memory of the census).
- **Second:** people who used to live there. "I painted your old street" pulls hard (guess).
- **Third:** visitors and anyone who knows the bridge. The landmarks read best today (known, seen in frames).
- **Kids will come** (it is a school bus). We market to adults. A lawyer answers on children's privacy, and on postcards that land near homes, before the public launch: the producer's (part 12).
- **The moment they send it:** they have just lifted a block on a friend's street, in their crew's colour. The houses jump and float over a lake of paint. The bell rings. The card holds: the friend's block, the famous thing behind, "GREETINGS FROM GUERRERO & 20TH", TAKE IT BACK?, the short address. One tap opens the share sheet. What they type: "painted your street lol".
- **The second moment:** their own block. "Made our block float." Same card, to the household chat.
- **The third:** today's place. "Alamo Square, 14 of 17 floating with 60 paint. Beat me."
- **The reply:** the friend lands over their own street in the sender's colours, takes it back, and the card says TAKEN.

## 3. The first sixty seconds

Times are targets on an iPhone 13 (the A15, the floor in the rulings). **Known:** today a newcomer's first painted building is Fort Point at 50 s, after taps that splash into the bay. The one measured link landing (laptop, emulated 9 Mbit/s line, uncompressed local server) showed its first frame at 2.5 s after 2.2 MB; with compression the first frame is about 1.3 to 1.6 MB (ESTIMATE). On a weak phone line (1.6 Mbit/s, 150 ms) that is about 7 s for the bytes alone (ESTIMATE). So M1 sets a byte budget and measures it on a real preview over a weak line.
**From the map:** the nearest houses that can float are not by the bridge. Marina & Baker is about 2.9 km east of the south tower (infer, arithmetic from map coordinates), and parks never lift (known). A Lift needs four counted hits at least 5 s apart. So the bare link's first payoff is the bridge, and the first Lift comes at the city's edge, about 90 s in (target, set by M1's map check).

**A. A bare link, first visit**

| When | On screen, and what the thumb does | Exists | To build |
|---|---|---|---|
| 0-1 s | The page in the real sky's colour; STRUGGLE BUS, the bobbing bus; PAINT SAN FRANCISCO | Loading page, sky colour | The line |
| about 3 s | The fog lifts. The bus is already moving under the Golden Gate's deck. The deck glints. TAP TO PAINT. The thumb flies from the first frame | Opening, fog, bridge paint | Opening cut to about 3 s; the glint; hint names the verb first (R2) |
| 5-8 s | First tap: paint hits the deck and runs down the cables. The chord and the music start. GOLDEN GATE BRIDGE | Bridge paint, chord, music on first touch | The bridge signs its own name |
| 8-30 s | The bridge climbs four stages like a square: deck, cables, towers, lights. One counted hit every 5 s; a thin ring shows the wait. DRAG is taught after the first paint | Squares' stages exist only in Recess and `?lift` | A landmark's four stages, for any bridge or tall tower in the data |
| about 25-30 s | The crown: the towers flare in your crew's colour, a flash, a camera punch, the bell. The first postcard: GREETINGS FROM THE GOLDEN GATE, PAINT YOUR STREET NEXT, the short address. It holds until your next touch | Nothing | Postcard, card, share sheet (R1) |
| 30-60 s | Off the bridge's south end, aimed at the nearest houses that can float (the start pose from the map check). A grey block glints; the street sign names it and its neighbourhood | Street signs, 85 m splat | The pose; the aim prefers grey; the neighbourhood on the sign |
| about 90 s | The first Lift at the city's edge, and its postcard (M2) | `?lift` stand-in | The Lift for any square |

**B. A friend's postcard, tapped in Messages**

| When | On screen | Exists | To build |
|---|---|---|---|
| In the chat | The picture: your own street in a friend's colours, TAKE IT BACK?, the short address. Under it the link card: that neighbourhood, "A school bus painted your street. Tap to fly over it. No app" | One preview picture for every link | A page and picture per neighbourhood |
| 0-1 s | The loading page with a stamp from the link: GUERRERO & 20TH, the sender's crest | Loading page | The stamp |
| about 4 s (good line), 10 s at most (weak line) | 150 m over your street, the city grey. The thumb flies at once. The friend's block lifts again beside you in 3 s, replayed from what the link carries | Start anywhere by `?lat=&lon=` | Its 9 tiles first; the replay (the Flyby) beside you, never before you |
| +1-3 s | TAP TO PAINT. You are dealt a crew, never the sender's, and the bus is seen to change | The bus wears its crew | The dealt crew (R3) |
| about 30-60 s | A hit cracks their block; the next brings its houses down; each hit strips a stage; then it floods in your colour and climbs back. TAKEN on your card | Takeover rules (stand-in on `?lift`) | The takeover in the open world, saved |
| The next day | The same link again skips the Flyby and starts over your own floating blocks, with theirs in view | Return visit (bare links only) | The phone remembers replayed postcards |

## 4. The loops

- **Thirty seconds: one block.** Glint, tap, bloom, chord, a stage. Four counted hits lift a square, at most one counted hit a square every 5 s (the approved rule), so you weave between neighbouring squares. Fresh grey lands hard; your own paint gives a soft pop. Chain fresh blocks and the notes climb and the splat grows (Streak, approved). The sign names the street and the neighbourhood as you paint, so the game teaches you the map. Every sound has a picture: a flash, a punch, a ring.
- **One sitting (5 to 15 minutes, guess).** A friend's street, your own block, today's place, a landmark crowned. When 60 % of a neighbourhood's squares float (tuned on the phone): a bloom wave, a 3 s climb over it, your crew's sky piece rises. "SAN FRANCISCO 3 OF 80". A beacon rises on the next grey one. You can always just fly: the 15 km climb, School Zone, the gears. Nothing counts at you while you linger.
- **The next day.** You open over your floating blocks in today's real light: at dusk the lamps are lit and the bus faces the Bay Bridge's lights; at 9 pm the night postcard. Today's place is new, the same for everyone, picked from the Pacific date with no server. Replies wait in your chats. Your postcards wait in the settings sheet.
- **Today's place.** A famous patch of 12 to 20 squares round a landmark: Postcard Row, Coit's hill, the ballpark, Dolores. **Its score is how much floats with a fixed paint budget** (for example 60 shots), no clock. A wasted tap inside a square's 5 s wait costs you; routes and aim are the skill. Bots run the rule in Node before it is built (a careful, an eager and a random player on five places) to prove scores spread. The card: "ALAMO SQUARE · 14 OF 17 FLOATING · 60 PAINT", BEAT 14, and a text line with a small grid of the squares that pastes anywhere. 30 places by the launch, picked by a rule over landmark data with a hand override.
- **The share.**
  - *The thing sent:* a 1080 x 1350 px picture: the block from the postcard camera, the famous thing behind, the bus big enough to see, a white border, the crew stamp with the short address, the postmark "SAN FRANCISCO 14 NOV 4:52 PM", the caption from the square's two top streets, and the question for its context.
  - *The one tap:* the card comes after a crown, a Lift, a finale or today's place. It holds until the next touch lands off it. The picture is drawn during the hit-stop, because Safari opens the share sheet only inside a tap. A file alone is the safe share; the link follows where the app allows. Every card also goes on a stack in the settings sheet, and the next visit's loading page offers the last one.
  - *The link:* `/p/<hood>/<generation>` with the rest after the `#`: a version, the square, the crew, the outcomes (each square's stage and the order of its hits, not raw taps), the caption, the block it answers, the score. 300 to 800 characters (ESTIMATE). The place snaps to its 128 m square. No name, ever. A score in a link can be edited; fine among friends.
  - *Counted:* the generation and a post's source tag (`/s/<tag>`) sit in the path, where a page counter sees them.

## 5. San Francisco: the set pieces, in order

A place reads when it is tall, on the water, or hand-made. Row houses, the Castro and Lombard read as boxes today (known, seen). We start on the water and the skyline, and earn the neighbourhoods with the roof rule. Every piece is a rule any city gets from map data.

1. **The Golden Gate crowned.** The door. Deck, cables, towers, lights; the camera lifts its eye so the towers keep their tops (2 days).
2. **The Transamerica Pyramid.** Faces rainbow, the spire gold over North Beach. Built; it needs a pull in the first minutes (0.5 day).
3. **Coit Tower over Alcatraz.** A Lob across the water lights Alcatraz, which signs its own name (a bug today: it says FISHERMAN'S WHARF).
4. **Salesforce Tower.** Rainbow bands up 326 m. At night the tallest tower in any city glows the colour of whoever painted its crown.
5. **The ballpark.** A Lob into water beside any stadium is a splash hit: McCovey Cove here (1 to 2 days).
6. **The Painted Ladies, Alamo Square.** Needs the roof rule (gables and bay fronts from footprint shape and height, where height data exists) inside a triangle budget per house that the bench sets: the Western Addition is already over the cap (known). If the budget fails, launch day's place is Coit's hill.
7. **The Bay Bridge's lights at dusk.** They take your paint after sunset (built); the dusk return faces them (0.5 day).
8. **Dolores Park's field day.** A painted picnic jumps up. Life returns here first, if its frame cost fits (part 8, M3).

Not in the eight, on purpose: Twin Peaks to the Moon, Ocean Beach at sunset, cable cars, Chinatown's lanterns.

## 6. What is cut or parked, by name

**In the game (M1 to M3):** the core (loading page, link picture, return visit over your paint); the Golden Gate opening cut to about 3 s; the two thumbs and the bigger lane; one flick per gear; the nose; the 40 m/s climb and the 15 km ceiling; the 85 m splat, bloom, chord and street signs; the near Comet and the Lob; School Zone; both bridges' paint; the real sky and the far field; the squares' four stages, the Lift and its takeover; your crew, its colour and the bus wearing it; the sky pieces as neighbourhood finales; the harder turn and the long swipe to Cruise, with a newcomer's loose drag no longer skidding.
**In the launch if the phone holds them (decided at M3's end):** the rival crews' buses about their own business, the head-on and the ram, at most two tags on screen; life at Dolores and on the ferries; the far shots once `feat/above` part 1b lands; the Waterfall and the Sonic Boom's ring if their draws fit.
**After the San Francisco launch, as updates (question 6):** the Moon, as "I painted the Moon", the big second wave; pinch to zoom; the Bomb; Curb; Parade; Belly Flop; Cloudburst; the Torpedo; the Hose and hold to aim, and lock-on with them (R4); cars and buses on the roads; live planes (they need a relay). The faction button stays on `?crew` links; the three-finger tuner goes behind `?tune`.
**Gone:** MEGA (ruled off); Recess and the duel (shelved by the producer); the Lift's pillars (ruled out); the coins and store plan (`COINS.md`, never built: postcards and looks take its place).
**Held by the producer, untouched:** the gods, weather and clouds, satellites, streets beyond freeway surfaces and Curb's, wild places and their download, the surround, the round planet, other cities until the world render run.

## 7. The systems to build, in order

Days are ESTIMATES. Building is fast here; getting to live is slow (nothing has gone live since 2026-11-05, known). So every milestone carries its merge, check and review rows, and the dates come from them, not from a padding factor.

| # | System | Days | Who | M |
|---|---|---|---|---|
| 1 | `?bench`: a scripted 60 s flight (door, a Lift, a 15 km look down, a postcard capture) printing frame times, draws and triangles | 1 | first | 1 |
| 2 | The base branch `feat/sf`: the one link with the held laptop work, the tree's major fixed, the M1 set on by default, rivals off | 2.5 | first | 1 |
| 3 | The map check: Cruise time from candidate start poses to the nearest square that can float | 1 | first (moved by the lead: the door waits on it) | 1 |
| 4 | The door: opening, pose, glint, hints at their moment, the thumb live at once, the bridge's four stages and crown | 3 | first | 1 |
| 5 | Neighbourhood names cleaned in the bake (about 80, Alcatraz signs itself) | 1.5 | second, first bakes | 1 |
| 6 | The street index (under 100 KB, ESTIMATE) and FLY TO A STREET in the settings sheet | 2.5 | second index, first sheet | 1 |
| 7 | Postcard v1: card, stack, share, short address, the link that lands | 3.5 | first | 1 |
| 8 | The link and save formats first: codec, outcomes not taps, a load-order fuzz | 2 | second | 1 |
| 9 | Door rows on a weak line and at 21:00, bytes counted compressed from a preview | 1 | first | 1 |
| 10 | Reviews and checks: the core (release candidate), then `feat/sf` | 4 | second, first fixes | 1 |
| 11 | The areas engine drives the open world's squares, saved (replaces `liftRules.ts`) | 6 | second 3, first 3 | 2 |
| 12 | The Lift for any square; far floating blocks drawn as the bench allows; the ring; the 3 s climb framed for screen recording | 4 | first | 2 |
| 13 | Safe save: the browser's database, changes only, `persist()` asked | 2 | second | 2 |
| 14 | The link carries outcomes: the Flyby beside you, tiles first, the swoop, the dealt crew, the friend's square kept, the takeover and TAKEN, replayed links start at home | 8 | second 3, first 5 | 2 |
| 15 | Postcard v2: the postcard camera, the lifted eye, the question by context | 2.5 | first | 2 |
| 16 | Streak, feedback that grows with fresh paint, the bell; every payoff seen on silent | 2 | first, second sims | 2 |
| 17 | A preview page and picture per neighbourhood | 1.5 | first | 2 |
| 18 | The harder turn without rivals; the loose-drag skid fixed | 1.5 | first | 2 |
| 19 | The clip test: can an iPhone record the canvas into a 6 s clip | 2 | first | 2 |
| 20 | Checks and reviews for M2 | 3 | both | 2 |
| 21 | Today's place: bot sims, then 30 places, the Pacific date, its beacon, the budget score, its card and text line, a page per place | 5 | second 3, first 2 | 3 |
| 22 | The neighbourhood finale, sky piece, next beacon, city count | 3 | first | 3 |
| 23 | The roof rule inside a per-house triangle budget | 4 | second 2, first 2 | 3 |
| 24 | Light: the postcard's print grade, the dusk return, the night look and night postcard | 2.5 | first | 3 |
| 25 | Set pieces 2 to 5 as rules | 3 | first | 3 |
| 26 | `feat/above` part 1b, then the far shots on | 6 | first | 3 |
| 27 | The living city, light: rivals capped, the head-on, saving with rivals on; life at Dolores and the ferries. On the bench, in or out | 6 | second rules, first feel and frames | 3 |
| 28 | Desktop: playable with a mouse, a QR code to the phone; change crew in settings | 1.5 | first | 3 |
| 29 | Counts in the path; returns counted as `/back` if the producer agrees | 1 | second | 3 |
| 30 | The launch build frozen: the second account's release review, fixes | 5 | both | 3 |
| 31 | Fixes from the strangers' sheets; one retest of ten new people (expected) | 10 | both | 4 |
| 32 | A host that allows earning; the press page; final checks | 4 | first | 5 |

**To the San Francisco launch: about 107 days (ESTIMATE)**, including about 20 days of reviews, checks and merges. Two accounts, each running up to two builders, the laptop's one GPU in turns: about 11 to 13 weeks. **Launch around mid-February 2027 (ESTIMATE)**, or late January if the strangers' test passes first time.
**Season 2, if the numbers earn it:** a small server for one shared San Francisco, joining a friend's crew, and paint that outlives Safari's 7-day wipe (5 to 7 days); the computer's crews painting overnight (3 to 4, after Q-later); the full clip if M2's test works (6 to 10, plus a library: a download); the Moon update (5 to 8); then the world render run.
**What needs a server before launch:** nothing.

## 8. The milestones

Every milestone ends on a preview link the producer flies. Nothing goes live without the producer's word. One flight per milestone, one recruiting round (M4).

**M1. The door, measured** (about 22 days across both accounts; playable around 2026-11-25, ESTIMATE). Details in `docs/M1.md`.
- *A player can:* open a bare link, paint the Golden Gate within seconds, crown it, send its postcard; fly to any street by name, paint it, and send a postcard that lands a friend there.
- *Pass:* the bench run on a non-Pro iPhone; first paint in 10 s or less on the producer's phone on cell data; the friend tapped the picture; the picture and link survive Messages, WhatsApp and an Instagram message.
- *Two drops (the lead):* M1a is the base branch, the map check, the door and the bench, flown by the producer as soon as it stands; M1b is the postcard, FLY TO A STREET and the real-line rows.
- *Expect:* "would you send it?" may be no. The postcard camera, roofs and light come in M2 and M3; a no here is not the hook failing.

**M2. My street floats** (about 33 days; around 2026-12-14, ESTIMATE)
- *A player can:* lift any block and keep it; send it to a friend's street; the friend lands, watches it lift beside them, takes it back, and the card says TAKEN.
- *Your five minutes:* lift a block on a friend's street and send it. Lift your own. Open the same link again the next day.
- *Tell us:* did the friend play on, and what did they say; did the third Lift still feel good; what annoyed you.
- *Pass:* the friend takes their street back unasked; hand the phone to two people near you, nobody explaining: both paint within 15 s.

**M3. Today's San Francisco, and the launch build frozen** (about 37 days; around 2027-01-12, ESTIMATE)
- *A player can:* play today's place and brag in a score; finish a neighbourhood and see its sky piece; see the Painted Ladies as Victorians; come back at dusk and at night. Rivals and life are in or out by the bench.
- *Your five minutes, on two days:* today's place each day; a climb to 15 km; once after 9 pm.
- *Pass:* you would post a postcard publicly; the non-Pro iPhone holds 30 fps through the door, a Lift and a finale with no reload; no wrong place name.

**M4. Twenty testers** (fixes, then a 7-day test; late January 2027, ESTIMATE)
- *Who:* 20 people; at least 10 who do not know the producer (friends of friends). Most live in San Francisco, a few used to, a few never did. At least 8 on an iPhone that is not a Pro. Half play on silent.
- *How:* each names a street they love (not necessarily home). The producer lifts a block there and texts the postcard with their normal words. Four are watched opening it, nobody explaining. No reminders. Day 3: three questions by text.
- *We count:* seconds to first paint; a Lift within 3 minutes; postcards sent to someone new, unasked; opens by generation; back on day 2 unasked; frame rate; any lost save.
- *The number that says ship:* at least 14 new players within 7 days (a spread of 0.7) and at least 8 of 20 back on day 2 unasked; floors: 16 of 20 paint within 10 s on cell data, 30 fps on the non-Pro iPhones, no lost save.
- *What we expect:* a spread of 0.4 to 0.6 (the growth judge's estimate), the fix-and-retest band. The dates include one retest of ten new people. Twenty people are a direction, not a measure: 14 could as easily come out 7 or 21 (infer, counting noise). We decide on the numbers, the watched opens and the testers' own words together. Under 0.4: change the hook (part 11).

**M5. The San Francisco launch** (about 4 days; mid-February 2027, ESTIMATE)
- *A player can:* the frozen build, on a host that can take the traffic. No new features after M4.
- *Your five minutes:* fly it as a stranger, then from a postcard. *Tell us:* go or no-go.
- *Then:* the word to go live is yours, and so is any post: r/sanfrancisco, a picture of Postcard Row to the local press, creators given the link a week early. The Golden Gate's 90th birthday, 27 May 2027, is a date to aim the world launch at (an inference from the calendar, not a plan).

## 9. Who builds what

**The first account** (the laptop with the GPU): the game's client; the bench; the base branch and its merges; the door, the cameras, the Lift and the stages on screen; the postcard and the share; feel work (the skid, life's frame cost); the light; the set pieces; `feat/above` part 1b; preview pictures; every page row by real touches through the GPU lock; independent checks of its own preview links; the studio's direction, the playtests and the questions.
**The second account** (in the cloud, no GPU): the core's review first, then release reviews; pure code with Node sims: the map check, the link and save formats with their fuzz, the areas engine in the open world, the safe save, the Flyby's event stream, today's place and its bot sims, the neighbourhood names, the street index and the roof rule's classifier in the bake, the rival buses' rules for the living city, the counts. The flight above 15 km waits with the Moon.
**The paste for the second account** is `PASTE-second-account.md`, sent by the producer.

## 10. How it earns, later

- **Never:** an ad before you have lifted a block, an account to play, a locked place, anything sold that paints, speeds or protects. Today's place stays free.
- **First, mail it for real:** a tap on your own postcard offers a printed card mailed anywhere (about $4.99, ESTIMATE) and a poster of your neighbourhood's floating blocks (about $30, ESTIMATE), printed to order. Each carries a code back to its block. It sells the exact thing that spreads.
- **Second, looks:** a whole style for each crew's bus, stamps, postcard frames (a later design, picked by the producer from stills).
- **Third, at scale:** one marked "presented by" place of the day a week, never in the first minute.
- **Scale, honestly (ESTIMATE):** one post brings 1,000 to 7,000 players in a day (anchored on a similar San Francisco game). At a spread of 0.5 that is about 2,000 to 14,000, once. At 10,000 players a day, 0.5 % buying a $4.99 card at about $2 margin is about $100 a day. Reaching 100,000 a day needs strangers seeing it over and over, which means video: so the clip test is in M2, and every Lift's climb is framed for the phone's own screen recording.
- **Costs (ESTIMATE):** Vercel's free plan forbids earning. Pro is $20 a month, about $65 at 10,000 players a day; Cloudflare Pages is said to have free bandwidth (to check). A short domain is about $10 to $15 a year.
- Every partner, payment, host and the lawyer's answer are the producer's. Nothing is sold before the launch numbers hold for four weeks.

## 11. The risks, and what would make us change course

1. **The phone.** Nothing has run on an A15 or in Safari (known). One lifted neighbourhood already sits at the laptop's triangle cap. *Change course:* the bench runs in week 1; M2's floating-block scope comes from it; a failing row cuts far blocks first.
2. **The cold load on a weak line.** Half of mobile visits leave past 3 s (the studio's study of link games, from published figures). *Change course:* first paint over 10 s on the weak-line row, or on the producer's phone on cell data, stops features for a loading sprint.
3. **Finding a street.** From the air the Mission is grey boxes. *Answer:* FLY TO A STREET in M1; the sender does the finding.
4. **The picture is not worth sending.** *Change course:* if under 4 of 10 strangers send unasked, the clip moves up and today's place's text line becomes the main share.
5. **The Lift feels the same by the third block.** *Change course:* first sittings under 3 minutes bring the finale earlier.
6. **Nothing pulls them back** (the judges scored return 3 and 4 of 10). Today's place, replies and the postcard stack are our answer, unproven. *Change course:* under 3 of 10 back on day 2, the overnight crews come forward (Q-later).
7. **Safari forgets.** Away 7 days can lose the city; a link opened inside Instagram or another app keeps a separate memory (Apple, infer for each app). Every postcard rebuilds its block; M1 tests in-app opens; season 2's server is the full answer.
8. **Homes and children.** A postcard lands near a street someone named. Places snap to the 128 m square, no names, no location prompt; the lawyer before launch.
9. **The road to done.** 554 commits on the one link wait for review (known). *Answer:* R5, and review rows in every milestone.
10. **Factions feel shelved.** The producer called them "the core element". Crews, colours, takeovers and sky pieces are in from M2; rivals are in if the phone holds them.
11. **Silent phones and night.** Every payoff reads with no sound; door rows run at 21:00.

## 12. Questions for the producer, and the rulings we ask to change

**How these are asked** (the lead, 2026-11-14). The producer asked not to be handed narrow calls any more. So the studio builds on its own picks, on preview links only, and the producer judges them by playing; any pick can be overruled at any time, and a ruling is changed for good only by the producer's word. What waits for that word before it happens at all: the live site (2), a download (3), anything that costs money or needs an account (1's purchase, 4, 5, 10, 11), and the launch order (9). The first account brings those one at a time, when each is needed.

**This week, each answerable in a word** (the studio's pick in brackets):
1. Will you borrow any iPhone that is not a Pro for ten minutes to run the bench link, and buy or borrow one (an iPhone 13 or older) for the tests? (**Yes.** Open since 2026-11-04. If none: a paid real-device service, an account and money, yours.)
2. May the core go live once the second account has reviewed it? MEGA goes off and the live site stops being three weeks behind. (**Yes.**)
3. May we download Playwright's WebKit browser, to catch Safari-only faults on the laptop? About 60 to 100 MB (guess; the ask will name the exact file and size). (**Yes.**)
4. Will you buy a short domain, printed on every postcard? About $10 to $15 a year. (**Yes.** The address today is long and close to another site's.)
5. Will you turn on Vercel's free page counter (page views only, no ids), with returns counted as a page called `/back`? (**Yes.**)

**Before M4:**
6. May the Moon, pinch to zoom, the Bomb, Curb, Parade, the Hose and lock-on, cars and buses on the roads, and live planes wait until after the San Francisco launch, each coming back as an update? (**Yes.** Each is one more thing to teach in the first minute and one more cost on the slowest phone; each update is also news to post.)
7. Rivals and life in the launch only if the bench holds 30 fps with them, decided at M3's end, so the strangers play exactly what ships? (**Yes.**)
8. Today's place scored as how much floats with a fixed paint budget, no clock, once bot sims show the scores spread? (**Yes.**)
9. May San Francisco launch on its own, before the world render run? (**Yes.** A loop proven live tells us what the world run must carry, and each city after is its own launch.)
10. Will you ask a lawyer about children's privacy and postcards near homes, with an answer by M4's start? (**Yes.**)
11. Before launch: Cloudflare Pages if it checks out, else Vercel Pro at $20 a month? (**Yes.**)

**The rulings we ask to change:**
- **R1. "No new button"** (Controls). May a postcard card show after a crown, a Lift, a finale or today's place, hold until your next touch, open the share sheet in one tap, and stack in the settings sheet? *Why:* Safari opens the share sheet only inside a tap, and sharing in one tap is what made Wordle spread.
- **R2. "One brief hint on the first run"** (Controls). May each gesture be taught once, at its moment (TAP TO PAINT first, DRAG after the first paint, FLICK UP later), and a link opened inside another app say once "open in Safari to keep your paint" if M1 shows paint is lost there? *Why:* today's hint never mentions painting.
- **R3. The faction button "just for my friends and myself"** (Controls). May every new player be dealt a crew, never the sender's, and change it in settings, with the crest button kept on `?crew`? *Why:* a reply reads as a reply only in a second colour.
- **R4. The Hose and hold to aim** (Shots, 2026-11-06). May they stay off by default until after launch, kept on `?hose`? Lock-on goes with them. *Why:* a resting thumb pours by accident, and a tap while pouring paints nothing.
- **R5. "Every branch gets a code review from the other account"** (How we work). May the second account review release candidates only (the core now, the launch build at M3's end, and fixes after), with the first account's own independent checks on preview links? Nothing reaches `main` without the second account's review. *Why:* 554 commits wait on one reviewer; the plan would wait weeks.
- **R6. "Nothing compiles in flight"** (Numbers). May programs for things that cannot happen in the first 30 s (a Lift, a finale, a sky piece) compile in the quiet frames of those 30 s, with a check that no frame passes 50 ms? *Why:* every flag turned on adds programs at boot (38 to 45 at the warm-up today) and pushes back the first frame.
- **R7. "Start where the game starts"** (Factions, 2026-11-12, about the `?lift` page). May a friend's postcard link start over the friend's place, after its loading page and a short swoop? *Why:* landing on the place is the Postcard. We read the note as about the demo; if it meant every link, the friend's link opens with the door and a beacon on the place.
- **Later (Q-later):** may other crews paint while you are away? Asked with frames when it is built, after the strangers' test.

## 13. What the red team changed

Two red teams read the draft: one on spreading and staying, one on building. They found 3 fatal and 19 serious faults, many the same fault seen twice. Every one was taken, one in part (named last).
- **The send flipped to "I painted your street"** (fatal). The street index and FLY TO A STREET moved from M3 to M1; testers name a street and get a postcard of it.
- **The phone is measured in week 1** (fatal). The bench link, a non-Pro iPhone before M1 passes, WebKit asked for.
- **The road to done** (fatal to dates). A named base branch, merge and review rows in every milestone, R5, the core live at M1 on the producer's word. Dates now about 107 days, not 80.
- **The first minute fits the map.** The bridge is the first payoff and the first postcard; the first Lift is about 90 s in; a map check sets the pose.
- **Real lines.** A 1 MB compressed byte budget, a weak-line leg, the thumb live during the Flyby. The draft's "8.8 s" was an unthrottled run and is gone.
- **Every card asks something** and carries a short address; cards hold until the next touch and stack in settings; the daily gets a text line.
- **The daily score.** Taps fewer-wins could not spread (the floor was four taps a square), so a fixed paint budget, proven by bots first.
- **Day 2 and in-app browsers.** A reopened link starts at home; M1 tests Instagram and WhatsApp opens.
- **Counting.** Generation and source in the path; 20 testers, 10 strangers; the expected result written down.
- **The launch build is frozen before strangers.** Rivals and life decided at M3's end; M5 adds nothing.
- **Formats first.** The link carries outcomes, not taps; save and link formats with a load-order fuzz in M1; the link row grew to 8 days.
- **The roof rule** has a triangle budget per house; heights "where data exists".
- **What the producer loves** is asked, by name (question 6), and R7 is asked, not assumed.
- **Producer gates** scheduled: the lawyer, the host, the phone's fallback, one recruiting round.
- **Video** moved up: the clip test in M2, the Lift's climb framed for screen recording (M2, not M1: the Lift arrives in M2).
- **Smaller ones taken:** silent play, a 21:00 leg, desktop, feel work to the GPU account, set pieces as rules, the Pacific date, the 1.5 times padding replaced by review rows, the send question asked of friends, not the producer.
- **Taken in part:** the card that vanished is fixed, but the bus is not eased into School Zone while a card shows. The gears stay the player's; the card holds until the next touch instead.
