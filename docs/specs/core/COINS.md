**The studio's proposal, 2026-11-12, revised after two outside critiques. Nothing in it is ruled until the producer says so.**

# Coins, and what they buy

From four designers' work, a sheet of facts checked against the code, and two critics (a publisher; a reader for fairness and abuse). MEASURED = a read-only script over San Francisco's map data. Every other number is an ESTIMATE, to be tuned on the phone. An agent-day is one AI engineer's working day. A square is one of the 128 m cells the city is cut into; a hood is a neighbourhood.

## In one minute

We like it, with limits. Coins are the score the core plan found missing, and a shelf of things is a next thing just out of reach. A flag on a summit and a dragon dance behind the bus are what people screenshot.

What we would do: pay a little for new ground and well for climbing it, much more in a dense city than in empty land. Show coins as a burst flying into the bus, never as a number that stays up. Sell looks and places, never power, never for money. Everything bought arrives grey; your paint brings it to life.

The limits: alone, only you see what you own. Pooling needs a server and a lawyer. The live game's hidden tuner must leave the plain link first.

## The producer's words

> "What about this: painting gets you coins. Maybe flipping a previously claimed territory gets you more coins, maybe painting something that's never been painted before gets you coins. Maybe getting territory in a major city gains you way more coins that a desolate part of the world. Maybe hitting someone or shooting some other bus gets you coins.
>
> And you can use your coins to buy things. Are here's where I'm getting excited because this gives us much opportunity to build things for players to buy on the store. Small things like a flag a player can put at the top of the mountain or big things like a huge fortress that might take a few players to join forces and pool their tokens together to afford. But they could buy with the coins.., their own fortress/castle. Maybe you can buy a dragon that functions as your struggle bus, or maybe you can buy dragon in the traditional Chinese style but pixelated…. Or… idk I'm only just thinking of this idea now. What are your thoughts?" (2026-11-12)

## What works alone, and what does not

| | Works on one phone | Needs the computer's rival buses over your saved city (core stage 5) | Needs other people (server, lawyer, the producer pays) |
|---|---|---|---|
| Earning | paint pays; a city pays more; firsts by you | flips; hits on a bus | firsts by anyone; hits on a person |
| Buying | flag, liveries, roof pet, the Dragon Dance, your fortress (later) | a fortress under siege | a fortress pooled by friends; strangers seeing your flag |

"Never painted before", on one phone, means never by you. That is ordinary painting of new ground.

## What is strong

- It turns the paint the game already makes into something you want more of, with no new verb.
- A store is a pipe for new content that needs no new mechanics: art, which this studio does well.
- Placed things make the city yours. "My flag is on Twin Peaks" is a sentence a friend understands.

What it fixes from the core plan's list:
- **No score.** Coins are the score.
- **Nothing to come back for,** a little: there is always a next thing, and the finale says how far it is. The strong reasons stay the core's: the hood count you can see, and (if the producer rules on it) a city the rivals touched while you were away.
- **A tap that pays when you play well.** A fresh climb throws coins; finished paint throws none. You hear it.
- **The climb stops at level 3.** A fortress, with its own stages, is another top.
- It does **not** give the goal. The hood share and the beacon say where to go; coins say how well you did.

## What would go wrong, and how this design avoids it

- **The hidden tuner farms everything.** Three fingers on the live site open a panel that triples the blast, cuts the refill, sets 32 rivals that never dodge, and has a "Reset paint" button (checked in the code). *So:* before any coin ships, the panel opens only on a `?tune` link (the producer's call), no coins are paid while any setting is off its default, and a reset never pays twice (below).
- **Early inflation, then a wall.** Paying a claim its full worth lets a player high up claim a dozen squares a tap and take 40,000 in an hour, then stall. *So:* new ground pays 1 a square, at most 3 a tap; the worth is paid on climbs, which take one aimed square a tap. High flying and low flying earn about the same.
- **Painting for the number.** *So:* a high-water ledger: each square pays each stage once, ever, kept beside the wallet. Finished paint pays nothing. Reset paint, a wipe, a rival's paint or a Bomb's jump never pays a stage twice. (The 5 s rule is not what stops farming: the Bomb skips it. The ledger does.)
- **Losing pays better than holding.** If retaking paid more than holding, players would let rivals in. *So:* taking back your own lost square pays w once; healing a crack before the square falls also pays w. Holding is never worse a tap.
- **The Moon as the best mine.** At full rate the first draft's Moon out-earned downtown. *So:* a tap on fresh Moon ground pays 2, about half a mixed street.
- **A till on screen.** *So:* no number while flying. Totals show only at a finale, for 3 s on return, and in the Garage.
- **Power for sale.** *So:* one rule: nothing bought paints, earns, refills, shelters, hides a bus, or changes how many hits a square takes. Shells and rams pass through placed things.
- **Money and children.** *So:* coins are earned, never sold. No random draws, no timed sales, no login streaks.
- **A silent wipe.** The save fails without a word today, and Safari may clear an unvisited site after 7 days (not checked on today's iPhones). *So:* the core's safe save first; wallet, owned things, placements and the ledger in one small record written on every change; a save that says when it fails; the browser's keep-my-data request; a backup file; one hint to add the game to the Home Screen after the first purchase.
- **A flag beside a memorial.** *So:* summits near sacred or memorial ground are refused, from map data and a short reviewed list (below).
- **The frame budget.** Near a hood's heart at golden hour the game is already at 217-218 draws (a laptop; the ceiling is 200). *So:* coins ride the game's existing particle draw (one draw, 6,000 particles); rivals wear liveries and pets, never the Dance; nothing that adds a draw ships before an iPhone 13 run near a heart at golden hour.

## How coins are earned

**A square's worth, w,** comes from the volume of its buildings in the map data: w = 1 + round(2 × log2(1 + volume ÷ 20,000 m³)). Open land is 1, row houses about 4, downtown 9, the densest squares 15. MEASURED over San Francisco's 8,625 land squares: median 4, 2,326 squares at 1. Any city with buildings gets it.

**With the core (three rows):**

| Event | Coins | Why |
|---|---|---|
| A grey square takes your colour | 1, at most 3 a tap | new ground counts, but a high blast is no mine |
| Your square climbs a stage (roofs, streets) | w | aimed, one square a tap: where skill and the city's worth meet |
| A hood reaches its mark (the finale) | a quarter of the hood's worth | the big moment, once per hood |

**Later, each with the system it rides on:**

| Event | Coins | When |
|---|---|---|
| A square reaches the Lift | 3w | core stage 4, the saved Lift |
| A stage knocked off a rival's square, never yours; the take | w; 2w | core stage 5; once a day a square |
| Your own lost square taken back; a crack healed in time | w once; w | core stage 5 |
| A shell or wave lands on a rival bus | 20, as a ring of coins you fly through | core stage 5 |
| A ram: bump, smash, wreck, head-on | 5, 15, 30, 60 | core stage 5 |
| A Bomb's jump | each stage it jumps, by the ledger | when the Bomb ships |
| A tap on fresh Moon ground; the first landing | 2; 100 | when the Moon opens on the plain link |
| A tap on finished paint | 0 | always |

Caps: the same rival bus pays once in 10 minutes; flips and hits together at most 1,500 an hour; a hit never takes coins from the one hit. The Moon pays per tap, so a blast from 600 m pays no more than one at the roofs.

**Major city against empty land.** Per square, downtown pays most: the Financial District 21 a square to the streets, the Outer Sunset 8.5, Presidio Central 4.4 (MEASURED). Per hood it does not: Noe Valley is bigger and pays more than the Financial District. Downtown pays more for each tap, not for each hood. That keeps every hood worth finishing.

**What it comes to** (ESTIMATE: 12 taps a minute, 7 in 10 taps changing a square):
- **Ten minutes:** about 100 in parks, 450 in mixed streets, 850 downtown.
- **An hour:** about 3,000 (2,000-4,500). The ceiling, every tap of 23 a minute climbing at w 4: about 5,500.
- **The first hood's mark** (60 % of its squares at the streets, plus the finale): median 379, one in four hoods under 249 (MEASURED sums); about 10 minutes.
- **A hood to its streets, with the finale** (MEASURED sums): median 593; Financial District 1,188; Noe Valley 1,822; Presidio Central 558.
- **The city:** 80,241 to the streets everywhere (MEASURED sum), in about 30 hours (20-40); the saved Lift adds 90,513.
- **After the city:** the Moon at about 1,400 an hour, and flips and hits at most 1,500 an hour.
- **Two players:** ten minutes a day comes to about 500 a day; an hour a day, about 3,000.

## What coins buy

Looks and places, never power. **Everything bought arrives grey, and your paint brings it to life,** so nothing new breaks "paint is the only saturated thing". Things are placed by painting, never by a new gesture. **Nothing stands on a building,** on the 378 squares the map tags worship, cemetery, memorial, school or hospital (a fortress's shadow and waterfall included), at a hood's heart, on a landmark, or on the Moon's crewed sites. In the Garage you try a thing on in the world before buying, and swap freely between things you own.

**Earned, never bought:** a crest for each hood you finish and a count of summits crowned: a set to complete, which fills the days between purchases.

### The first shelf

1. **The Flag, 300: the first purchase, at about the first finale.** A 30 m pole and a 16 m pixel pennant that reads from a kilometre; one of 40 fixed crests in your faction's colours, grey until your splat lands on it. *Why:* "that's mine" on the highest ground in view. *Planting:* free summits glint; take a summit's square to the streets and the flag springs up like the street sign. Summits are terrain tops with 30 m of rise, from data any city has (Twin Peaks, Mount Sutro, the Headlands, Angel Island: 240-341 m, MEASURED). Rival paint droops it; take the square back and it springs up. Never destroyed or stolen. *Refused:* a summit within 300 m of a memorial, cross, place of worship or cemetery (points and areas in the map data), inside protected land of cultural or religious class or indigenous land, or on a short reviewed list. Mount Davidson is the test: it carries a large memorial cross (outside knowledge), and today's data tags nothing within 256 m of it (MEASURED), so the check must be built before any flag ships. *Looks.* *Build:* 3-5 agent-days with the summit check; one draw for every flag.
2. **Liveries, 1,500; moving ones (scales, shimmer), 5,000.** Patterns in your paint's colours on the bus's sides; the yellow, the face and the belly band stay. With them the cheap tier: horn tunes 300 (the cars honk back), bunting between your squares 500, trail styles 800 (the faction's contrail itself is already approved and stays free). *Why:* the bus is in every frame, and something is always affordable. *Looks.* *Build:* 3-4 agent-days for the first set, inside the bus's one draw.
3. **A roof pet, 3,000.** One per faction on the roof hatch: a unicorn, an axolotl, a moss sprite, a drone, a phoenix chick. It wakes in your colours, cheers each fresh block, ducks in a dive. *Why:* every screenshot. *Looks.* *Build:* 3-5 agent-days; about 400 triangles merged into the bus's draw.
4. **The Dragon Dance, 20,000 (about a week of evening hours, or six weeks of ten-minute days).** The bus wears the head of a pixel lunar new year dragon: horns, whiskers, a mane, its door the jaw, a pearl bobbing ahead. Twelve silk segments, about 42 m, follow the bus's path. A skid whips the body out and back; in a dive it dithers out where it would hide the bus. Pearl-grey until your paint fills it. *Why:* the thing people send each other. It sits on the shelf from the Garage's first day as the long goal. *Looks:* never hits, never hit; shells pass through. *Build:* 5-7 agent-days, one more draw, about 5,500 triangles. A living tradition: the studio's pick is that someone who knows it looks it over before it ships (the producer's to find: the studio cannot hire), which is call 6.
5. **Your own fortress: an outpost 8,000, a keep +12,000, a castle +20,000.** A pixel castle of grey stone floating 150-190 m over the high point of a hood you finished, never its heart, at most 70 m tall, so its top stays 40 m under the 300 m sky pieces. Your paint takes it up: banners, glowing turrets, a moat, a waterfall of paint. Ten banners light one for each 10 % of the hood you hold. The bus flies through its gate, which shelters nothing. Rival paint on it greys it; the squares under it follow the normal rules. Rivals meet it only by their own "paint to see about", never drawn to your things. *Why:* the thing you save for, seen across town. *Looks.* *Build:* 6-9 agent-days for one shape in five colours (Inferno's obsidian is grey until painted, like all). It waits for proof that players reach 8,000.

### The long shelf

Later, with no price until built: a paint geyser in a finished park and a lighthouse on a bare headland (both paint nothing), the Moon flag, a Moon base on your crater's rim (no refill), a sky island by your fortress once the Lift is saved, the Dragon Bus, and the great fortress pooled by friends. Lantern night is cut: a one-time show felt like a robbery. The whole built shelf (C2 to C4) costs about 72,000, inside what San Francisco pays to the streets.

### Your four examples, straight

- **The flag on the mountain top.** Yes, first, with the summit check. Mount Tamalpais, Diablo and Yosemite are outside the map today; they come with the wild places plan, which waits.
- **The fortress friends pool for.** Your own castle: yes, after the rivals fly over your saved city, weeks away. Pooled by friends: the two-phone room, after the lawyer. By strangers: a shared world.
- **A dragon that is your bus.** Later. It moves everything that hangs on the bus's shape (the jet, the trail, the shadow, the touch lane, the belly band, the Moon trip's copy, the rivals, the camera, the voice): 8-15 agent-days. It keeps the yellow, the eyes and the belly band, and comes after the Dance shows players want a body.
- **The Chinese dragon, pixelated.** Yes: the Dragon Dance, the top of the first shelf.

**Never sold:** coins for money; power (speed, gears, splat size, refill, shots, a shield, a hit box); painting itself (a place, the Moon, a faction, a shot); protection for a square; skipping the climb; random draws; anything on sacred or tagged ground.

## Other players

**On one phone (no server).** Coins, the Garage, your things in your world. Later the computer's rival buses pay bounties and flips and wear liveries and pets: a shop window in the sky. An edited save cheats only its owner, so we check only that it isn't corrupt.

**With a link (no server, nothing leaves the phone unless the player sends it).** A friend flies over your San Francisco, read only, under 1 KB (ESTIMATE). Hood shares and a fortress's place can show which hoods a player finished, likely near home. So until the lawyer answers question 4, the link carries only flags on summits. 2-3 agent-days on top of the core plan's paint link.

**With the small server (the approved two-phone room, about $5 a month on Cloudflare, opened and paid by the producer).** A crew of two to four friends: a coin pot, pledges, a great fortress at the same spot in each member's world. Only coins the room itself referees count toward a pot: a copied backup or three browsers can't fill it. The other way, trusting solo coins between friends, is the producer's call then. Hits on a friend pay only if the target was not hit in the last 60 s; a head-on between two room players pays neither; a player hit again and again gets a spell in which hits on them pay nothing. A pot kept between visits keeps an id on a server for the first time, beyond "one room per match", so the lawyer comes before this step. 16-20 agent-days, the two-phone work's 9 included.

**With a shared world (not approved).** Strangers see your flag. Factions pool for great fortresses with 7-day pledges, refunded if the price isn't met. A first by anyone pays the explorer. The server pays every coin; hourly caps per player; a cap on coins from any one other player's paint a day; new players pay a hitter nothing. Solo coins do not carry in (a founder badge instead), and the Garage says so from day one. Fixed flags, generated names, never free text. *Cost:* the plan's 8-12 engineer-weeks, plus 3-5 for a server wallet and 1-2 for a report path; about $250-300 a month at 1,000 players online at once (ESTIMATE from the plan's ratio).

**Questions for the producer's lawyer** (the studio gives no legal advice):
1. Is a cartoon school-bus game "directed to children" under the US children's privacy law (COPPA)? Is a random id kept on a server personal information?
2. Does a generated name and crest, shown to others, need a parent's consent?
3. What do the UK and California age-appropriate design codes and the EU's consent ages ask: defaults, deletion?
4. Can a placed flag, a finished hood or a fortress's place over a real map reveal where a child lives?
5. What terms, age gate and report path do a public placement and paid hits between players need?
6. If coins were ever sold: parental consent, refunds, EU rules on in-game currencies, gambling rules. Our pick is never.

## Where it shows on screen

- **A burst on each square that changed:** small pixel coins in your paint's colour pop up, hang a beat, stream into the bus's door, which gulps. Each coin is a note up the chord the splat played: downtown sounds richer than the dunes. At most 12 a burst, in the existing particle draw.
- **"+N" over the impact for 0.8 s,** on big events only: a finale, later a flip or a wreck.
- **The finale line, and 3 s on return:** "THE MISSION IS PAINTED · 640 TO THE ROOF PET": the distance to the next thing, not a bare total. Until the Garage exists, the total. No hood count in it until the core rules on 115 or 79 hoods.
- **The Garage,** a page inside settings. Big cards in one column, each thing turning in the game's renderer; "640 MORE" on what you can't afford. Hold a card 0.6 s to buy. A "keep a copy" action writes the whole save to a file through the phone's share sheet. The settings button glints once when something new becomes affordable: never a red dot or a number.

**Rulings this would touch:**
- **No new button:** the play screen gains nothing, but the Garage's buy and backup actions, the glint, and one Home Screen hint are new. The producer's call.
- **Paint is the only saturated thing:** coins fly in your paint's colour and bought things arrive grey. No change.
- **No hand-made one-offs:** the reviewed list of refused summits is hand-made, though it only takes away. The producer's call.
- **The tuner:** moving it behind `?tune` changes a tool the producer uses. The producer's call.
- **No server:** nothing before the two-phone room; a pot kept between visits widens that approval. The producer's call, after the lawyer.
- **The gods (on hold):** a fortress is yours, small, never at a heart, turning nothing, but it is a siege target showing a hood's share. The producer's call when its stage comes.
- **Rivals never tied to the player:** they never read where your things are. No change.
- **Decay:** rivals painting your city while you are away is the strongest reason to return, and coins would pay for winning it back. It waits for the producer's ruling, as the core plan says.

## The stages

Coins need the core's stages 1 and 2 first: squares counted in the open world, and a save that can't fail in silence.

**C1, with the core's stage 3, behind a flag (5-7 agent-days).** The tuner behind `?tune`; worth baked per square; the three earning rows; the ledger and wallet in the safe save; the burst, the gulp and the notes; "+N" at a finale; the total at a finale and on return; a test that flies 5 minutes and checks every coin. Round 2's strangers get two links, half with coins and half without, so the round judges the tap and the coins apart. *On the phone:* paint downtown, then the Sunset, then the Presidio, and hear the difference; hit a finished block and get nothing; finish a hood and see the total; reset paint and get nothing back; reload and find it kept.

**C2, the Garage, if round 2 says coins help or do no harm (10-15).** The Garage, hold-to-buy, try-on and the wardrobe; the backup file, keep-my-data and the Home Screen hint; the distance line; earned crests; the cheap tier and liveries; the Flag with the summit check. The Dance on the shelf as the goal. *On the phone:* buy the flag at your first finale, crown Twin Peaks, watch it spring up; buy a livery; keep a copy; open it the next day and find everything.

**C3, the bus's big things (10-15), after an iPhone 13 run near a heart at golden hour comes in under 200 draws.** Roof pets, the Dragon Dance (with the adviser), Moon coins. *On the phone:* fly the Dance through a skid and a dive; land on the Moon and hear it pay less than the city.

**C4, rivals and your fortress (9-13), after the core's stage 5, the rivals' review, and proof players reach 8,000.** The fortress; flips, bounties and coin rings with their caps; rivals in liveries and pets. Before prices after the city are set, the flip rate is read from the rivals' own simulation. *On the phone:* raise an outpost, watch a rival grey it, take it back; shell a rival and fly through its ring.

**C5, crews, after the lawyer and the producer's Cloudflare account (16-20).** The crew pot from room-refereed coins, pledges, a great fortress for three or more, the hit rules. *On two phones:* both pledge, the fortress rises in both worlds.

**C6, a shared world (not approved; weeks, as above).** *On the phone:* a stranger's flag on a summit you can take back.

The whole run to C4 is 34-50 agent-days, more than the core plan itself. That is why each step waits for proof from the one before.

## The producer's calls

1. **Do coins join the core as its score,** behind a flag and tried on half of round 2's strangers? *Pick: yes.*
2. **Should we rule now that coins are earned by play only,** never sold, and buy looks and places that never paint, earn, refill, shelter, hide or change a hit? *Pick: yes.*
3. **May the three-finger tuner open only on a `?tune` link,** so the plain link can't farm coins or wipe a city? *Pick: yes.*
4. **May the Garage, a page inside settings with hold-to-buy and a backup file, plus one glint and one Home Screen hint, be the new things?** *Pick: yes.*
5. **May flags be refused on summits by map data plus a short reviewed list?** *Pick: yes.*
6. **Does the bus wear a Dragon Dance first, with an adviser you find, before any dragon replaces the bus?** *Pick: yes.*

## What we do not know

- Whether coins make strangers paint more, or watch the number. Round 2's two links can say.
- How the core's stage 2 turns building levels into square stages in the open world; the square rules run only inside the shelved Recess today. Every rate hangs on it, and on whether the mark counts claims or squares at the streets (we would count the streets).
- Every earning rate: nobody has flown with coins.
- How often rivals would take your squares, and so the flip income after the city.
- Safari's storage rules on today's iPhones; how big a backup file gets with the Moon's paint.
- Which summits worldwide are sacred but untagged; how much the reviewed list must hold.
- Building heights outside San Francisco: map data often lacks them, and a default makes worth noisy.
- What the Dance, pets and fortress cost on an iPhone 13: nothing has been measured on one.
- Whether the $5 Cloudflare plan holds a crew pot, and what the law says about children.
- How fast players empty the shelf, and so how much art each quarter needs.

## What the critics said, and what was not taken

Most findings were right and are in the text above: the tuner, the inflated claims, the ledger, retakes, the Moon's rate, the memorial summit, crew pots on copied wallets, effects that could be power, the draw budget, hit grace, the link and a child's home, the order, a cheap tier, try-on, earned crests, the save, the build estimates, the Bomb, and plainer limits. Not taken:
- **Keep C1's wallet silent in round 2.** A silent wallet can't show whether coins help. Two links, half with coins, separate the tap from the coins at no build cost.
- **Double coins for fresh paint at the city's real sunset.** Golden hour is the one view already over the draw budget, and a daily timed bonus is a nudge we said no to.
- **The decay question as a call here.** It is the core plan's open ruling; coins don't change it. It is named under the rulings.
- **The Moon's rate as its own call.** Set below every city hood, it answers the producer's own words. If they want the Moon to pay more, they can say so.
- **Retaking pays only the knock-offs.** We pay w once for a retake and w for a healed crack instead: holding is never worse, and winning back your city still pays something.
- **The finale fired on the squares at the streets.** That is the core plan's choice; we recommend it. The coin curve no longer depends on it, since claims pay 1.
