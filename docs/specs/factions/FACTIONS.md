# Five factions

*The plan, as the producer's doc "Five factions" put it to them on 5 November 2026 ("you" is the producer). The same night they approved all 26 picks in §6: "i vote all your recommendations for the rest of the plan". They approved 27 and 28, at the end of §6, on 6 November. Nothing is built yet. Where this disagrees with `STAGES.md` or `MAGIC-SPEC.md`, this wins.*

## In one minute

**The five,** from your five themes. Two names are new and yours to approve: Atlantis, in place of The Tide, and Inferno.

- **Team Super Rainbow.** Your team: every colour at once. Houses float on rainbow geysers, and a rainbow road climbs to the Moon.
- **Atlantis.** Poseidon's drowned empire comes ashore. Streets become canals, and the Sea King rises from a whirlpool.
- **The Elderwood.** The old forest takes the city back. Trees open their eyes, and tree giants walk the streets.
- **Hyperglow.** The city's machine god boots up: chrome by day, neon by night, and the neighbourhood hung upside down in the sky.
- **Inferno.** The fire at the end of the world. Lava runs down the streets, and a phoenix dies and is reborn.

**The story.** Four of the Rainbow's colours broke away to become gods of the sea, the forest, the machine and the fire. Rainbow wants them back.

**Way more fantastical.** The old plan dressed the same buildings five times. The new one changes something bigger at each stage: the walls, the roofs, then the streets, which become rivers of paint, sea, moss, light or lava. Then the painted houses leave the ground, and you fly under them. Last, a god up to 450 m tall, a third taller than the Salesforce Tower, turns to watch your bus.

**PvP.** Your breath curves after a rival bus. If it lands, their bus floods with your colours, jumps into Jet and can't slow down. For six seconds it hiccups your paint onto the city on every beat, while its driver steers where it lands. That's your idea, which we call Possessed, tuned so nobody ever loses the steering. A bots demo is about 30 agent-days away; two phones, about 40.

**Approved on 5 November:** all 26 picks in §6. **Approved on 6 November:** 27, five stages re-cut, and 28, neighbourhoods. **The producer's to do:** borrow or buy an iPhone 13 or SE to measure on (22).

## 1. The ladder, for all five

*You decided in October that there are five stages, and how hits count. The rest is proposed.*

Each stage changes something bigger and keeps everything below it.

- **1, the skin.** Walls, roofs, ground and trees take the faction's colours. Its mark burns into the ground and draws itself round in five seconds. When it closes, your next hit counts.
- **2, the roofs.** Giant flowers, mushrooms, coral, horns or billboards, 20-40 m tall, burst off the roofs.
- **3, the land.** The streets become the faction's element and run downhill with the real slope. This repaints ground the game already has; the street work you put on hold stays on hold.
- **4, the sky.** The painted houses leave the ground, and you fly under them. A sky mark floats at 200-250 m, as high as the Golden Gate's towers. Grey houses never move.
- **5, the god.** A living Wonder, 300-450 m tall, that notices your bus.

Each stage-up lands on the beat, with slow motion at 4 and 5. Cars, people, ships and planes wear the costume of the ground under them. It all comes from map data, so it works in any city. The five cost the same but move differently: Rainbow bounces, Atlantis sways, the Elderwood breathes, Hyperglow snaps, Inferno throbs.

### The studio's view: keep five, but the fifth belongs to the neighbourhood

*Approved by the producer on 6 November 2026 (decisions 27 and 28: "Regarding 27 and 28, yes I approve both"). Where the five-stage list above or the October rules below disagree with this, this wins.*

**Keep five stages, re-cut.** Every 128 m square climbs four, and the fifth, the god, belongs to a whole neighbourhood. That means at most 79 gods in San Francisco, not 7,200.

You wrote that five stages are "overkill", and then "maybe we should keep five". You're right both times. Five on every square is overkill, because the 9-second god arrival would play every minute or two and hundreds of gods would fill the sky.

Five as a ladder is right, though. It matches your October words, "one specific area gets hit 4 or 5 separate times". An ordinary square now takes 4 hits to reach its top, and a neighbourhood's heart takes 5.

| Stage | Where | What gets it there | What you see |
|---|---|---|---|
| 1 Skin | every square | the first hit, or a blast spilling onto grey | walls, roofs, ground and trees in the colours; nothing above the roofs |
| 2 Roofs | every square | an aimed hit, at least 5 s later | growths 20-40 m tall burst off the roofs |
| 3 Streets | every square | the next aimed hit | the streets become the element and run downhill; this is what counts toward a god |
| 4 The Lift | every square | the next aimed hit | painted houses and towers rise 15-50 m and stay up; you fly under them |
| 5 The god | one per neighbourhood, at its heart | your faction holds the neighbourhood, then hits its heart | a god 250-450 m tall, and the neighbourhood's painted towers take its form |

**Each square stage does one job:**
- **1 stays cheap.** One full MEGA from 300 m up claims about 19 squares at once, so anything tall at stage 1 would sprout everywhere.
- **2 rewards the first aimed hit,** seen from the street. From 1 km up it's the weakest read, dots of 6-16 px.
- **3 is the territory read from 1 km up:** the streets become bright lines 4-8 px wide.
- **4 is the place:** the floating city you fly under.
- **5 is the flag,** seen from anywhere.

**Rewards come at four speeds.** You get paint on every tap (every 1.6 s), a stage-up about every 3 s, and a Lift every 30-60 s on a square you're working. Alone on fresh ground, a god comes every 1-20 minutes. From claim to Lift takes 3 aimed hits: at least 15 s, and 30-60 s in real play (estimate).

**Three stages per square would save about 2.5 agent-days of art.** It would cost one beat per square and fall short of your "4 or 5". We don't recommend it.

#### Your Elderwood idea: towers into trees

You asked whether that is "too much". It isn't, as long as it happens when the god stands, not on every square. On every stage-3 square it would put hundreds of trees in view and bury the real city in forest.

As the god's skyline, it turns a god standing in a neighbourhood into a neighbourhood that belongs to a god. It reads from 1 km up.

- **Walls:** every building the god's faction has painted in that neighbourhood changes its walls. That's data in the drawing the game already does: 0 triangles, 0 draws, and nothing compiles in flight.
- **Crowns and roots:** these go on up to 30 towers within about 400 m of the heart, at about 500 triangles each. That's up to 15k triangles a god, and 45k for the nearest 3. We pick them near the heart because in Parkside (4.7 km²) the 30 tallest are low buildings scattered over the whole district.
- **The real skyline stays readable.** Every tower keeps its real footprint and height, and its crown adds at most 15 %. No crowned tower ever stands above its god. The Salesforce Tower (330 m), with a crown and a 50 m Lift, would reach about 430 m, so its crown shrinks.
- **The god only changes its own:** its faction's painted buildings, never grey ones or a rival's. The named landmarks (Transamerica, Coit, Sutro, the Ferry Building, the bridges) keep their shape and only take paint.

Each faction gets its own skyline at the same cost:
- **The Elderwood:** living trees, with bark walls, roots over the pavement and a crown of leaves and lantern fruit.
- **Team Super Rainbow:** the towers bloom, with a seven-colour spiral up the walls and a giant flower on top.
- **Atlantis:** coral and conch spires, with pearl and coral-pink walls, kelp from the upper floors and water running up the faces.
- **Inferno:** black glass horns, with obsidian walls veined with lava and a crown of fire.
- **Hyperglow:** its upside-down city over the Arc Spire, which you approved (decision 9). It's built from the 30 tallest buildings near the heart.

#### The floating houses stay on every square

You said the houses you fly under are "pretty cool", so every square keeps them at stage 4. Each faction lifts its houses its own way:
- **Rainbow:** geysers over a paint lake.
- **The Elderwood:** root stilts.
- **Hyperglow:** hydraulic legs, and whole towers turning.
- **Inferno:** rafts on a lake of fire.
- **Atlantis:** houses on chains, afloat in a sea standing 20-40 m deep in the square.

Atlantis's version is new and unapproved, and nobody has seen it. Flying low over its ground would always be underwater, and every stage edge would become a wall of water. It goes in the stills for you to judge.

The sky marks (Rainbow's halo, Atlantis's sky sea, the sky wood, the Skyway, the black sun) move from every square to the heart. That leaves one per neighbourhood, at 200-250 m, as the sign that a god is coming.

Parks have no houses to lift, so at stage 4 their lawns and trees rise as islands. Parks need their own stages 2 and 3 as well. Five whole territories are parks: 808 squares, 11 % of SF's land.

#### The gods: 250-450 m, by size

**A god stands 250-450 m tall, scaled by its neighbourhood's land.** It's 55 % of full height at 0.5 km² or less and 100 % at 3 km² or more, set by one adjustable number. At the first proposal's 80-100 %, SF would get 79 things taller than the Salesforce Tower, and downtown's six would all stand 360-385 m.

A spread of heights reads as a pantheon, and equal giants read as a pattern. A spread also answers your "not over populated" most directly.

**Hyperglow's holograms get a cap.** Its approved stage 3 prints hologram floors up to four times a tower's height. The Salesforce Tower's would reach 660-1,320 m. Our pick is to cap them at 100 m above the roof, so the high sky stays for sky marks and gods.

**What one screen holds:**
- Gods: the nearest 3 in full detail within 1.2 km, the next 12 simplified within 4 km, and a picture for each of the rest (about 1,000 triangles for up to 80).
- Upside-down cities: one at full detail, not three. Three would cost up to 180k triangles, 12 % of the 1.5 M ceiling.
- Moonroads: the nearest 3 plus the leading faction's, not all 79.

**On the slowest phone, nothing is measured yet.** The ladder adds 60-80k triangles (the technical lead's estimate), and the skylines add up to 45k more. When frames drop, cut in this order:
- Hyperglow's upside-down city;
- the skylines' crowns (the walls stay);
- the undersides of the floating houses beyond the nearest 30.

## 2. The factions

*All proposed.*

### Team Super Rainbow: the First Light

Your team, and the original: joy as an explosion.

**Colours.** Red to violet, a different one on each house, with white and gold trim. At night every window glows its own colour.

**1 · Splash.** A white flash, then seven-colour surf over the roofs. The paint runs downhill, and paint birds burst out.

**2 · Lollipop Orchard.** Trees pop like popcorn in a wave from where you hit. Houses hop into roof gardens. Daisies 30-40 m tall open over the roofs.

**3 · Rainbow Rivers.** The streets flood into seven-band rivers. Bunting snaps taut across them on one beat, then gold onion domes pop. You fly down a river between Hundertwasser towers.

**4 · Liftoff.** Slow motion. Every painted house jumps and doesn't come down. Each bobs on its own rainbow geyser over a lake of paint. A seven-colour halo snaps off like a smoke ring to 250 m.

**5 · The Wellspring and the Moonroad.** A 220 m rainbow geyser erupts from a crater lake, then bends toward the real Moon and climbs out of the sky as a rainbow road. Every Rainbow Wonder aims at the same Moon, so they all meet at one point in the sky. You said painting the Moon is the whole point; this is the road there. *(The Wellspring has waited on your OK since October.)*

**Bus.** The yellow bus you fly today. **MEGA, the Big Bang:** two white frames, then a seven-colour dome where every house jumps at once. The firehose ends in a little Wellspring.

**The world.** Bridges become harps, a colour per cable, strummed as you pass. Water becomes a lily lagoon with rainbow koi. Cars become wind-up toys, people dance, and planes trail seven bands.

### Atlantis: the Drowned Empire

Poseidon's lost empire rises, and the sea comes ashore with it. Everything sways under rippling light, like the floor of a pool.

**Colours.** Teal from deep indigo to foam white, pearl marble with lilac shadows, coral pink and gold. At night the ripples glow like plankton.

**1 · High Tide.** Your breath lands as a wave breaking over the roofs. Flying fish scatter, and a glowing tide fills the street ankle deep.

**2 · The Reef.** Coral crusts up the walls. Conch-shell towers and kelp 20-30 m tall rise over the roofs. Clams open on glowing pearls on the beat.

**3 · The Flood.** In one second the sea pours down every street: canals on the flat, rapids down the hills. Waterfalls run up the walls. At the border the sea stands up as a 25 m wall with fish in it.

**4 · The Sky Sea.** Slow motion. The canals pour upward into a lens of ocean floating 220 m up. The painted houses rise after it on anchor chains. A whale breaches. Fly inside, and the sound goes underwater.

**5 · The Sea King.** The sky sea spins into a whirlpool, and the Sea King rises from it, waist up, his crown 420 m over the street. He's living water, with a foam beard and pearl eyes. His head follows your bus. When his trident strikes, a wave runs round the canals, now three glowing rings, the way Plato described Atlantis.

**Bus.** Deep teal with a white wave, a pearl eye, and a tail fin that sculls in the turns. Its breath is a water cannon full of fish. **MEGA, the Great Wave:** it rises behind the target, hangs curled for a heartbeat, and breaks. *(It was The Tide's Wonder; your call.)* The firehose is a waterspout.

**The world.** Bridges become aqueducts. Water glows from below. Cars float like boats, people swim as merfolk, and a painted cargo ship becomes a giant sea turtle.

### The Elderwood: the forest that remembers

The forest that stood here before the city wakes and takes it back: old magic, sprites, and trees that know you.

**Colours.** Moss and emerald; bark and stone in silver-lilac, never brown; violet caps; firefly lime and lantern gold. A fifth of every area is violet and lime, so it never reads as a park.

**1 · Spore Burst.** Ferns unfurl in a spiral from where you hit. Moss pours down the walls, windows glow like lanterns, and a fairy ring of glowing toadstools pops up.

**2 · The Grove.** Every tree in the area opens two gold eyes at once and turns to look at your bus. Toadstools shoot 20-35 m through the roofs. People become leaf-haired sprites, dancing in rings.

**3 · The Waking.** Roots race along every street and turn it to moss. Trunks burst through the roofs. Two to four Wardens, tree folk 25-40 m tall, pull up their roots and walk. They stop to watch your bus, then point at the nearest grey or rival ground.

**4 · The Sky Wood.** Slow motion. Islands of earth rise to 220 m, carrying old trees and rune stones and trailing glowing roots. The painted houses rise on root stilts. *(The first draft tore up the real ground. Everything stands on it, so the islands are new.)*

**5 · The Elder Heartwood.** The street splits into roots, then a crown, then a face. The Elder climbs out, 400 m of silver bark and lantern fruit. It takes three steps over the roofs, petals bursting at each footfall. It plants itself as the Wardens kneel. Its eyes follow every bus.

**Bus.** Furred with moss, a sapling out of the roof hatch, antlers on the mirrors. Its breath is a spiral of spores and fireflies. **MEGA, Wildgrowth:** a ring of roots heaves up, and trees burst along it. The firehose grows a beanstalk in blossom.

**The world.** Bridges become root bridges hung with moss. Water becomes a lotus marsh with lily pads 30 m across. Cars creep like lantern beetles, ships sail as floating forests, and planes trail petals.

### Hyperglow: the Machine God

The city's machine god boots up: chrome, neon, holograms and drones, snapping on in quick ticks with glitches.

**Colours.** Lavender chrome ruled with magenta and cyan neon. By day it's silver lined in neon. At night the chrome goes dark and only the neon shows: magenta and cyan in a real night of blue-grey and amber.

**1 · Boot.** A scanline wall sweeps the blast, and every edge traces itself in neon, tick by tick. Windows become screens of glyphs, and drones lift off.

**2 · Broadcast.** Buildings boot floor by floor on a rising synth. Hologram billboards 20-40 m tall flick icons on the beat. Trees turn to wireframes, and people walk robot dogs.

**3 · The Rewrite.** The streets turn to dark glass streaming neon. On the bass drop, the tallest buildings print hologram floors up to four times their height. You fly straight through them.

**4 · Overdrive.** Slow motion, then a lock-click. Houses rise on hydraulic legs. Towers turn in sharp snaps on the beat. Then the Skyway snaps out: the area's real street map, copied in lanes of light 220 m up. *(The first draft turned them floor by floor. The buildings aren't made in floors, so whole towers turn.)*

**5 · The Arc Spire.** A plasma spire stabs 450 m up inside spinning rings of light. At its top hangs the neighbourhood itself, upside down, rebuilt in neon. From the street you fly between two cities. It's different in every city, because it is that city. It costs the most of any god, so it's capped at 30 buildings.

**Bus.** Chrome with neon underglow and hover pads for wheels. Its breath is a beam of light. **MEGA, the Strike:** a bolt from the sky, then a pulse that lights every edge in the blast, kept under the safety limit for flashing. The firehose is a Tesla coil.

**The world.** Light pulses run along bridge cables. Water becomes a black mirror under a cyan grid. Cars hover, ships' containers blink like server racks, and planes draw one laser line.

### Inferno: the Doomfire

The fire at the end of the world, and it's gorgeous. Everything burns, nothing is consumed, and nothing turns brown or grey.

**Colours.** Crimson and wine, black glass with a violet sheen, and gold only in the brightest flame. Smoke is black-violet lit red from below, ash is plum, and bones are white with violet shadows.

**1 · Ignite.** WHUMPF: every window in the blast blows out a tongue of flame at once. The walls cool from white-hot to crimson, and glowing cracks open in the ground.

**2 · The Pyre.** Every roofline catches in turn. Black glass horns stab 20-40 m out of the roofs. People become skeletons in party clothes, dancing in crowns of flame.

**3 · The Breaking.** The street splits open from where you hit. Molten gold runs down the real streets with the real slope, under a black crust. From a kilometre up it's the brightest grid in the city.

**4 · The Hellmouth.** Slow motion. The lava rises as four columns and fuses into a black sun 120 m across. The painted houses float over a lake of fire on rafts of black glass, held by glowing chains. The sky above goes black-violet. *(The first draft dropped the ground away. Everything stands on it, so the lake lies at street level.)*

**5 · The Phoenix Throne.** The black sun cracks. Black glass spires burst 240 m up around a crater of white-gold fire. A phoenix 320 m across the wings is born from it. About every 20 seconds it rises to 450 m, cries, and dies in a storm of embers. On the next downbeat it's reborn.

**Bus.** Black-violet with crimson flames, black glass horns and a burning gold eye. Its breath is real fire. **MEGA, the Meteor:** a burning rock arcs high and lands like an impact. The firehose is a fire tornado.

**The world.** Bridge cables glow like hot wire. Water burns between floes of black glass. Hot rods, headbanging skeletons, ghost ships under burning sails, and planes trailing embers.

## 3. Rivals and PvP

### How factions fight over the map

*You decided the rules in October.* The city is cut into 128 m squares, one owner each. A rival's hit knocks off a stage. Seven hits topple a Wonder, at most one every five seconds.

#### Neighbourhoods: you rule them, and you fight in the squares

*Approved by the producer on 6 November 2026 (decisions 27 and 28: "Regarding 27 and 28, yes I approve both"). Where the five-stage list above or the October rules below disagree with this, this wins.*

**Yes, territory is ruled by neighbourhood: 79 in San Francisco, from map data, with one god at most each.** You still paint and fight square by square, as you decided in October.

You asked: "shouldn't territory ownership be separated by neighbourhoods? mission district vs pac heights etc?" Taken literally, with one owner for a whole neighbourhood, a busy shared city flickers in the crowd model. A neighbourhood changed stage every 13-24 s, and its god lived 21-34 s.

Two levels keep the fight and the calm. A hit moves one square one stage, and the god follows whoever holds the neighbourhood's streets. The Mission is 171 squares (2.7 km²), and Pacific Heights 63 (1.0 km²).

**Where they come from.** Overture maps most SF neighbourhoods as single points, and its drawn outlines cover only 14.3 % of the land. So each patch of land goes to its nearest named point, and drawn outlines and big parks win where they exist. That gives 79 territories of 17-365 squares, 72 at the median.

**Fixes before it's built:**
- **Split anything over 3 km²:** that's 7 in SF, including the Presidio at 6 km².
- **Islands:** Treasure Island and Yerba Buena form one 2.25 km² territory. Alcatraz is about 5 squares, too small for a god, so our pick is squares only.
- **Never cut a park in two.** Dolores Park sits between the Mission's point (694 m away) and the Castro's (715 m).
- **Hearts stay at least 450 m apart.** Five pairs are closer today, such as Little Saigon and the Tenderloin at 320 m.
- **One list of names, used everywhere, the street sign included.** Today's list has no "Mission" (it says Mission Dolores), and it carries pairs like Castro and Castro District. The 51 hand-placed SF names go.
- **A merged territory keeps both names,** such as Japantown inside Western Addition.
- **Drop points named after a whole borough,** like London's "City of Westminster".
- **Fill sparse places from a grid.** San Jose has 44 points over 468 km², and Stockton has none. Put points about 1.2 km apart, each moved to open ground within 400 m. Merge pieces under 0.25 km², and name each from the nearest place, park or street.

That gives Amsterdam 6 territories and London 9, with Hyde Park and Kensington Gardens as their own.

**The heart.** Each neighbourhood's heart is one square: its biggest park, or else its highest open ground. The Mission's is Dolores Park, Pacific Heights' is Alta Plaza and Bernal Heights' is Bernal Hill. A 70 m stone ring marks it and fills by each faction's share, at no extra draw.

Gods and stages 4-5 stay off places the map tags as worship, cemetery, memorial, school or hospital. West Portal's highest ground is Mount Davidson. Its summit carries a 31.4 m cross used for Easter sunrise services.

**Raising a god** (solo, the bots demo and two phones):
- your faction holds half the neighbourhood's squares at stage 3 or higher;
- the 8 squares around the heart reach the Lift, so every god rises over a ring of floating houses (about 8 more hits, about 25 s);
- the heart reaches stage 4, and your sky mark rises over it at 200-250 m;
- your next hit on the heart, at least 5 s later, raises the god, and the 9-second arrival plays.

Alone, the god rises the moment you qualify, with no clock to wait for.

**Toppling a god.** It takes 5 hits at the heart for a neighbourhood of 0.5 km² or less, rising to 9 at 3 km² or more. At most one hit counts every 5 s. As first proposed every god fell to 7, so the Presidio's god was as fragile as Alamo Square's. Scaling the hits is what makes big neighbourhoods fortresses.

Each hit cracks the god in the attacker's colour, and an owner's hit heals one crack. The last hit gives the heart to the attacker at stage 1. Losing the half doesn't topple a god.

The Crown still makes the leader's gods fall faster (decision 17, adjustable). A possessed bus's hiccups only ever claim stage 1, so they can never call a god.

**How long a god takes alone** (estimates, fresh ground):
- Alamo Square, 17 squares: 1-2 minutes.
- Pacific Heights, 63: 3-4 minutes.
- The median, 72: about 4 minutes.
- The Mission, 171: about 9 minutes.
- The Presidio, 365: 18-20 minutes, before its split.

**The first god.** SF opens under the Golden Gate into the Presidio, which is the slowest god in the city. Decisions 15 and 18 both wait on that first god. Our pick is for the sky mark to point a newcomer at the nearest neighbourhood under 1 km², near where the bus first reaches land.

**Borders and teaching.** Every neighbourhood's border shows from the air before any god stands. It's a thin neutral ink line, lit in the leading faction's colour. The square fronts keep their looks: steam, and roots cracking circuit boards.

The street sign names the neighbourhood when a hit changes its count or the bus crosses a border. Today it names the street and shows the neighbourhood only when it finds no street.

**Big against small.** Every square costs the same hits, so the work is fair per square. A god's height, its topple hits and the score follow size. The score counts squares and stages, so the Presidio is worth about 21 Alamo Squares.

**Recess, the bots demo.** The game picks a 1.5 km circle where three real neighbourhoods of 15-40 squares meet. In SF that could be Alamo Square (17), the Lower Haight (24) and Hayes Valley (26). If no such spot exists, three camps of about 36 squares each are the fallback. Scoring is 1 point per stage per square, plus 36 per god held.

**A shared city needs a different god rule.** In the crowd model, a fixed half fails a crowd in both directions. The best run decided each neighbourhood's god every 15 minutes, by who held the most of it. The "If it goes viral" tab has the numbers, and the crowd model sets them before any shared server is built.

**What it adds to the plan.**
- The areas grow from 5 to 7 agent-days: the neighbourhood layer (1.5) and a city-scale crowd simulation (0.5).
- Neighbourhoods from map data are a new step of 2-3 days. The designer said 1.5, but the list of fixes has grown since, so we take the larger figure.
- The fantasy proof gains 1.5 days for one Elderwood skyline on a downtown neighbourhood, so you can judge "too much?" on your phone.
- The bots demo gains 0.5 day, and the rest gains 1.5-4: four skylines and the borders seen from the air.
- In all it's about 95-105 agent-days. The fantasy proof lands around day 28-29, the bots demo around day 32 and two phones around day 42.

**What it changes in the 26 you approved:**
- **15 and 18:** "first Wonder" now means your first neighbourhood god.
- **5:** 450 m stays the ceiling, and gods now run 250-450 m by size.
- **6:** SF has at most 79 Moonroads, with 3 drawn at a time plus the leader's.
- **9:** the upside-down city is the 30 tallest buildings near the heart.
- **16:** the cracks are at the heart.
- **19:** the bot captains' homes become neighbourhoods.
- **26:** the Moon's named seas and craters become its neighbourhoods, with a cap, because there are 1,533 named features.

*Proposed:*

- **Borders are fronts:** steam where sea meets lava, roots cracking circuit boards. It's looks and sound only; no faction beats another.
- **A siege shows.** The first hit cracks a Wonder with veins of the attacker's colour.
- **Gods duel.** Rival Wonders in sight trade blows, painting nothing: the phoenix circles the Sea King, and his wave answers.
- **Home ground comes from the map:** Atlantis by the most shore, the Elderwood by the most trees, Hyperglow at the tallest blocks, Inferno on the highest ground.
- **The Crown.** The leading faction's Wonders wear a crown seen from anywhere and fall in five hits, not seven. Everyone gains most by hitting the leader.
- **Splatting a bus wins a siege.** The raider is flung 2 km away for 10-15 seconds. You take the next two or three hits. There's no kill count.

### When a bus gets splatted

Every idea had to pass five rules: nobody loses the steering; a hit costs time, never paint; what glints is what your tap hits; both players see it; no new buttons.

**The hit.** A rival bus within 600 m and nearly dead ahead glints, and flashes your colour as a warning. Your breath curves after it. In the breath's last third of a second, their bus flashes white-hot. A flick then hops them sideways. A hit freezes both screens. You read GOTCHA; they read NO BRAKES.

**Your idea, and our pick: Possessed.** You wrote: "maybe they're auto turned into turbo mode and can't turn it off and splat the other persons factions colors onto the map for a bit." Every designer came back to it. If you're the one hit:

- Your bus floods with the hitter's colours and jumps into Jet, the gear you call turbo. A flick down only wheezes NO BRAKES.
- **The driver keeps the steering.** That's the one change from your words.
- For two bars, about six seconds, your bus hiccups a blast of their paint on every beat. Where it lands is a game inside the ride. Grey it hits becomes theirs at stage 1, which one hit can flip back. Nobody else's ground changes.
- Each faction possesses its own way: Rainbow giggles, Atlantis leaks fish, the Elderwood sprouts vines, Hyperglow glitches, Inferno burns.
- **Riding it out pays.** Your hitter then glints for you from 1.2 km for eight seconds. Your super-splat comes back ready. A teammate's breath can wash it off early.
- **Why it wins:** it's the only punishment that makes the world more colourful, and being hit becomes the fastest ride in the game.
- **For your phone to judge:** speed sickness, and distance. Jet carries a bus about 2 km, wider than the bots demo's arena. So our pick is Nonstop there, and Jet in the open city.

**The others.**

- **Piñata:** the victim's belly bursts into six drops of their paint; each drop the hitter catches is a tenth of a MEGA. Runner-up, built so you can try both.
- **Bubbled:** three seconds in the hitter's bubble, popping as their paint. Funny, but it stops flight. The fallback if the ride makes people sick.
- **Paint bomb:** a fuse, then a MEGA under the bus. Dropped on a bystander's Wonder, it wrecks it.

### Protection

- **The stop arm is the shield.** A protected bus holds its stop-sign arm out, red lights flashing, mouth shut. You don't pass a school bus with its stop arm out. It can't be hit or fire at buses. Every ride ends with four seconds of it.
- **No ganging up:** only a possessed bus's own crew can hit it, to wash it off. The same pair a third time in two minutes bounces off.
- **Bullies** with three rides unanswered are WANTED: they glint for every rival from 1.2 km.
- **New players:** until your first Wonder, rival breaths burst on you as sparkles. Once, an AI captain splats you for a short ride, as the lesson.

## 4. The PvP demo

**First: Recess, against bots, on your phone.** No server.

- Three minutes between two school bells, in a 1.5 km circle the game picks where any city is densest.
- You fly Rainbow against two AI captains in ornate buses. Our pick: Atlantis and Inferno, because pale-cool against dark-hot against the rainbow reads clearest.
- Each side holds a Heart at stage 5. At the bell the camera rises to 1,500 m, and the painted map is the scoreboard.
- Bots come in three levels: Learner, Rival and Veteran. Each glints you for a full second before it breathes at you, so you learn the lock by being locked.
- A switch in the link lets you try Possessed, Piñata or Bubbled.
- Before it reaches you, a test plays thousands of duels and fails if anyone loses the steering or gets bullied.

**Beside it: the fantasy proof.** Rainbow's stages 1-4 in one area, on your phone, plus a still of each faction at stage 4 from the street and from a kilometre up. You judge all five looks before they're built. Our pick: build both at once, the fantasy proof slightly ahead, because "way more fantastical" was your louder note.

**Second: two phones.**

- You send a link, and a friend joins. No accounts. A bot fills any empty seat.
- It needs a small server: one room on Cloudflare per match, which also referees the area fight. It's the first brick of the shared-world server.
- That's a second exception to "no server", after the planes' relay. You'd OK it and open a Cloudflare account. A demo probably fits the free plan; the paid one is $5 a month. We'd check before you sign up.

**How long.** These are estimates in agent-days: one agent working one day. With two agents at once after the groundwork, the fantasy proof lands around day 25. The bots demo lands around day 30, and two phones around day 40.

## 5. What it costs, in order

The technical lead's check: it can be built, mostly inside paint the game already draws. Three pictures needed stand-ins, noted in their factions.

**The real limit is the slowest phone.** The live game already goes over that phone's budget in some views, and nobody has measured it on one. Your iPhone 17 Pro is far faster, so a pass on it proves little. Nothing here should go live before that check.

1. **Paint learns whose it is.** Today a splash remembers only its colour. 1 day; nothing on screen changes.
2. **Measure the slowest phone, and slim the game to fit.** 3-5 days, with an iPhone 13 or SE in hand.
3. **A beat clock,** so every stage-up lands on the music. 1 day.
4. **The areas:** squares, stages, the fight, saving. 5 days.
5. **The new colours** in all seven skies of the live clock. 2 days.
6. **The fantasy proof.** 12 days.
7. **Recess with bots,** alongside step 6. 16 days.
8. **Two phones.** 9 days.
9. **The rest:** the Wellspring, the other factions' stages 3-5, the gods' moving parts, and paint on the distant city. 38-43 days.

In all, about 90-100 agent-days. If the slow phone says no, every shape survives smaller: houses lift 3 m, Wardens sway in place, and only the nearest god moves.

**Colours.** In shadow, Rainbow's red can match Inferno's. We'll test all five side by side, in shade and at dusk, and add colours where two blur, about half a day each.

**What changes now in work already going.**

- **The freeways and bridges** being built now: about 230 San Francisco decks will take paint. Decks cross water, where there are no areas, so each must remember whose paint it holds.
- **The cars,** next in the moving things, must remember whose paint they wear. The other account builds them, so the rule goes into its rulebook.
- Step 1 should land before either takes paint, or both get redone.

## 6. Your decisions

The producer approved every pick below on 5 November: "i vote all your recommendations for the rest of the plan". They approved 27 and 28 on 6 November: "Regarding 27 and 28, yes I approve both".

1. Atlantis in place of The Tide, and Inferno, beside your Team Super Rainbow, Hyperglow and The Elderwood. *Pick: yes.*
2. Possessed as what a splat does. *Pick: yes; Piñata runner-up, Bubbled fallback.*
3. Possessed's gear. *Pick: Nonstop in the bots arena, Jet in the open city; your phone decides.*
4. Do hiccup claims fade after a minute? *Pick: no.*
5. Gods up to 450 m tall, not 160 m. *Pick: yes.*
6. The Wellspring as Rainbow's Wonder, now with the Moonroad. *Pick: yes.*
7. The Sea King as Atlantis's Wonder, and the Great Wave as its MEGA. *Pick: yes.*
8. The Elder Heartwood, which you picked, at 400 m and walking in. *Pick: yes.*
9. The Arc Spire, which you picked, with the upside-down city. *Pick: yes.*
10. The Phoenix Throne as Inferno's Wonder. *Pick: yes.*
11. The beanstalk as the Elderwood's firehose. *Pick: yes.*
12. The three stand-ins: Inferno's lake at street level, the Elderwood's houses rising at stage 4 not 3, Hyperglow's towers turning whole. *Pick: yes.*
13. Slow motion only at stages 4 and 5; stage 1 loud as it lands, quiet after. *Pick: yes.*
14. Music speed: 84 or 96 beats a minute. *Pick: your ear; these timings use 84.*
15. Changing faction. *Pick: start as Rainbow; join another after your first Wonder; your Rainbow ground stays Rainbow.*
16. An owner's hit heals a crack, and a hit on stage 4 or 5 restarts the five-second wait. *Pick: yes and yes.*
17. The Crown on the leader. *Pick: yes, adjustable.*
18. New players' shield: until their first Wonder, or their first 30 minutes. *Pick: first Wonder.*
19. AI captains on after the opening, with homes from map data. *Pick: yes.*
20. The demo's order. *Pick: the fantasy proof and the bots demo side by side, the fantasy proof slightly ahead.*
21. Recess's rivals. *Pick: Atlantis and Inferno.*
22. Borrow or buy an iPhone 13 or SE to measure on. *Pick: yes, before anything here goes live.*
23. Teach paint whose it is now, before the freeways and cars take paint. *Pick: yes.*
24. A small Cloudflare server for two phones, a second exception to "no server". *Pick: yes.*
25. Owned ground fading back over days. *Pick: only in the shared world, never solo.*
26. Later: water as territory, and the Moon as each season's scoreboard. *Pick: yes, after the land stages ship.*
27. How many stages. The producer asked: "i think five stages for the ladder is overkill but i will wait on your feedback for this. please act as a world class game design studio and give your opinion. but i do like the god idea. and for instance, if you're the elderwood faction... maybe your top stage turns skyscrapers for instance into trees? or is that too much? i do like the floating house/skyscraper idea that you can fly under. thats pretty cool. maybe we should keep five stages." The answer: keep five, re-cut. Every 128 m square climbs four: skin, roofs, streets, then the Lift, where its houses float and you fly under them. The fifth, the god, belongs to a whole neighbourhood and stands 250-450 m tall by its size. When it stands, the neighbourhood's painted towers take its form, and the Elderwood's become trees (§1, "The studio's view"). *Approved 6 November: "Regarding 27 and 28, yes I approve both".*
28. Territory by neighbourhood. The producer asked: "shouldn't territory ownership be separated by neighbourhoods? mission district vs pac heights etc? that way its not over populated with gods if each neighbourhood is at god level." The answer: paint and fight square by square, and rule neighbourhood by neighbourhood. At most one god per neighbourhood, 79 in San Francisco from map data. A god rises at the heart once a faction holds half the neighbourhood's squares at stage 3 or more and lifts the ring around the heart; toppling it takes 5-9 hits, by size. For a shared city, the crowd model sets these numbers before the shared server is built (§3, "Neighbourhoods"). *Approved 6 November.*
