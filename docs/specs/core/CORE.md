# The core, before we expand

The studio's one answer to the producer's question of 2026-11-12: "Before we expand, let's really try and perfect the fundamental gameplay mechanics. Are we missing anything? Is this a fun game that has the chance to be a success?"

**Status: the studio's proposal.** Nothing in it is ruled until the producer says so. Section 8 has the calls. Written 2026-11-12 by the first account's review.

How this was made: four designers read the live code (`main` at 058217c), the candidate code (`feat/handling` at 44dde05, which holds `rc/1` and `feat/swerve`) and the docs, each through a different lens (feel, goals, a first-time player, a publisher). A checker then tested their claims against the code. Where the checker found a claim wrong, it is dropped here. Where it found one only partly true, it is softened. The first account then read again, in the code, the facts this answer leans on hardest, and corrected three lines: the triangle counts in 3.3, Streak's window in 3.2 and Safari's storage rule in 3.8. The designers' reports and the check are the studio's working files and are not in this repo. Nobody ran the game or watched anyone play it.

Words used:
- **Live** is what anyone with the plain link gets today. **The candidate** is the newest build that is not live yet.
- **A flag** is a word added to the link (like `?life`) that turns on a hidden feature.
- **The belly** is the bus's paint tank. One tap empties it. It refills in 1.6 s.
- **A level** is one of a building's three paint steps: colour, roof garden, crown.
- **A square** is one of the 128 m cells the city is cut into. **A hood** is a neighbourhood.
- **Agent-day** is one AI engineer's working day. Every agent-day figure here is an ESTIMATE.
- Code references like `PaintState.ts:109` point at the line in the game's code that shows the fact.

---

## 0. In one minute

**Are we missing anything?** Yes. One big thing and a few smaller ones. The game has no goal. Nothing on screen says what you have painted, what is left, or where to go next. Nothing tells you that you played well. Nothing calls you back tomorrow. The parts to fix this are mostly built already: neighbourhood data, the street sign, the bloom wave, the music, the Lob's beacon. They are just not joined up.

Two other gaps matter as much as any feature. No first-time player has ever been watched playing it. And it has never run on an ordinary phone. The iPhone 13 is the floor, and nothing has been measured on one.

**Is it fun?** The first three minutes are probably fun. That is a judgement from the code, not something we watched. The Golden Gate opening, the splat and the thumb controls are studio-grade. After that, today it is a toy, not a game. The same tap every 2.6 s, buildings stop at level 3, and nothing builds over a session.

**Can it succeed?** It has a real chance as a game that locals play and send to friends. But only if two things come first, and are proven on strangers and on an ordinary iPhone before any expansion: a visible neighbourhood goal, and a tap that rewards good play. More planet, wild places and Moon would make a goalless loop bigger. They would not make it better.

**The plan:** three stages, about 14 to 22 agent-days (ESTIMATE). Each one ends with something you can feel on your phone. Then two cheap rounds of watching five strangers. Expansion waits until the second round passes.

---

## 1. What the game is today

**Live, plain link.**
- The page is flat grey with no words until the first frame (`index.html:16`).
- Then the opening: fog lifts, and the bus glides under the Golden Gate. Any touch steers. Climbing and gears unlock about 16 to 30 s in (ESTIMATE). A three-line hint shows once, for 6.5 s.
- A tap splats the building that glints. You get a squash, a rainbow jet, a flash, a 4-frame freeze, a camera kick, buildings popping in a wave, and paint on the ground. The music moves one chord of Pachelbel's canon. A street sign names the street.
- Each building climbs three levels: colour, roof garden, crown. Paint is saved on the phone.
- Gears go from Cruise to Turbo 3 (900 m/s), one flick per gear. There is a sonic boom at Jet. The ceiling is at 15 km.
- MEGA (hold to charge) is still live, though you ruled it off on 2026-11-06.
- There is no goal, score, percent, map, timer, unlock, way to lose, share or other player. The only thing that changes from day to day is the real sky. The Moon trip exists but needs a flag.
- After about 30 s nothing new is taught, asked or counted.

**Built but not live (the candidate and its branches).**
- The 85 m splat. The Comet: a tap at Nonstop or faster lands ahead, in view. The Lob: a tap with the nose up arcs into the distance. The Hose: a still hold pours. Hold to aim. School Zone: a hover gear below Cruise. MEGA is off.
- Behind flags: the Bomb, Waterfall, Sonic Boom ring, Curb (riding the street), Torpedo and Parade.
- Five faction looks. The Lift: floating houses, behind a flag, Rainbow only on the real path, gone on reload.
- Life (`?life`): cars, picnics, ferries, sailboats and live planes.
- The new handling with rival crews' buses (`?swerve`): hard turns, the skid, the swoop, the long swipe, the shell, the ram. It has two review blockers whose fixes are not yet reviewed. With rivals on, nothing you paint is saved.
- Nothing on any branch gives the open world a goal or a count. The square-and-hood rules run only inside Recess, which is shelved.
- None of the shots, School Zone or Curb has a flight report from you on record. There is no record of anyone remarking on a shot's sound.

---

## 2. What is strong, and must not be lost

- **The opening.** Fog, the low shot under the Golden Gate, and any touch flies. It is the trailer and the tutorial in one. Keep it for the first visit.
- **The splat's feedback stack.** Squash, jet, flash, freeze, kick, the bloom wave, the ground pinwheel (`config.ts:537-606`). It reads with the sound off. Every loop in this plan spends it.
- **Music the player plays.** One chord per splat, and a bell note per bloom (`music.ts:3-38`). Nothing else in the game is as clever.
- **The belly's beat.** A breath, a steer, a breath. It is the game's pulse.
- **Aim by steering.** The building that glints is the one you hit. It fits one thumb and the no-button ruling.
- **The thumbs.** Your words: "New thumb controls work great! Very intuitive." It is the clearest praise on record for a control build you flew. Do not churn it.
- **The real place.** The sign names the real street. The real sky runs on the real clock. The far field from up high is the thing you praised most ("it's amazing well done"). "I painted my street" is a sentence no other game has.
- **Visible growth on each building**, and **paint that stays.** Together these are the seed of any week-long loop.
- **No install, no account, no server.** One tap from a link to the Golden Gate is the whole funnel.
- **On the branches:** the Comet and the Lob, which are the same tap in a new situation (nothing new to learn), School Zone for lingering, ramming that grows with speed, and life that wakes when painted. All the right instincts.

---

## 3. What is missing, most important first

### 3.1 A goal you can see
- **What.** Nothing counts. The game keeps a count of painted buildings, but nothing ever reads it (`PaintState.ts:109`). The hood map is on a branch (115 hoods, 8,625 land squares), and only the Lift flag reads it.
- **Why a player feels it.** At minute two the player asks "what am I doing?", and the game has no answer. Most people put a fidget down.
- **Smallest fix.** Count each hood's share by its squares. That is the approved rule: territory by neighbourhood, fought square by square (decisions 27 and 28). Then:
  - Show the share as a second line on the street sign the game already springs at each blast.
  - Show the hood's name and share for 2 s on entering it.
  - When the hood crosses a set mark, play a finale. Start the mark at 60 % (ESTIMATE, tuned on the phone).
  - Raise a beacon over the next grey hood. On load, show the city count.
  - Section 4 has the full screen.
  - The count shows only at these moments. It is never a bar that stays up.
- **Cost.** 4 to 6 agent-days, plus 1 to 2 to make the save safe (3.8). ESTIMATE.
- **How we would know.** In watched sessions, strangers say a hood's name or "let me finish this one" before minute 5. On your phone: the share moves on every splat and is still right after a reload.

### 3.2 A tap that pays more when you play well
- **What.** The freeze is a fixed 4 frames on every tap (`config.ts:606`). A tap into finished paint feels almost the same as a tap into a fresh grey block. There is a little scaling: the bell run grows up to 6 notes, and the blast grows with height (`SoundGraph.ts:382-388`). But it is weak. Streak is approved and not built. The approved "Comet reach grows with height" is not built either, so in Turbo 1 to 3 from about 300 m up, the tap lands out of view.
- **Why a player feels it.** Skill is what turns a toy into a game. Today a clever line and a lazy tap feel the same.
- **Smallest fix.** Count the levels a blast actually raised. Scale the freeze (2 to 7 frames), the kick, the ring and the bell run by that count. A fresh grey block lands like a thunderclap. A re-pop of finished paint is a soft pop. That teaches "go where it's grey" with no words.
  - Build Streak as already approved: fresh blocks within 2.5 s of each other, each hit a note up the scale, and the splat grows 8 % a hit, up to 1.4 times. One thing to settle as it is built: today a tap can come only every 2.6 s (a breath of 1.0 s, then 1.6 s to refill, `config.ts:491-494`), so a 2.5 s window can never be met as written. The window or the refill is tuned on the phone until a run is possible but not free.
  - Build the approved Comet reach, so every tap in every gear lands in view.
  - For 0.6 s after a shot, ease the camera toward the impact.
  - When two buildings tie for the aim, prefer one that is painted but unfinished, so crowns get seen.
- **Cost.** 4 to 6 agent-days. ESTIMATE.
- **How we would know.** A tool logs the fresh levels per tap over a 5-minute flight, before and after. A tool reports the share of impacts in frame in every gear; the target is all of them. And on the phone: do you start hunting grey without being told?

### 3.3 The ordinary phone has never run it
- **What.** The floor is an iPhone 13 (A15 chip) at 30 fps. Nothing has been measured on one. Buying one has been approved and left open since 2026-11-04. By our own counts on a laptop, some views already sit over the budget of 1.0 to 1.5 M triangles and 120 to 200 draws: some hillside views from 350 m read over 1.5 M triangles on the live game, the worst about 1.7 M (`HANDOFF.md`), and the Lift reads 1.54 M from 250 m. A far worse case, 4 M triangles from roof gardens late in a Recess match, was fixed on 2026-11-06 (`docs/specs/gardens/BUDGET.md` on `feat/shots`). Your iPhone 17 Pro hides all of this.
- **Why a player feels it.** A stutter on the impact frame makes every splat feel broken. A tab that reloads looks like a crash. The friend you send it to has the older phone.
- **Smallest fix.** Get the phone. Measure the core release on it (section 6).
- **Cost.** 0.5 to 2 agent-days per measuring pass, plus whatever it finds. ESTIMATE. The engineers cannot buy anything.
- **How we would know.** 30 fps held, the impact frame under 33 ms, and no tab reload in a 10-minute flight.

### 3.4 No stranger has ever played it
- **What.** Every flight on record is yours. No friend's report and no watched first-timer exists in the docs. The automated "stranger" is a script.
- **Why it matters.** "Is it fun?" can only be answered by people who did not build the controls in their own hands.
- **Smallest fix.** Two rounds of five people each (section 6). No code.
- **Cost.** 0.5 agent-day for the watch sheet, plus your afternoon per round.
- **How we would know.** The written sheets.

### 3.5 Live is a week behind, and the core has too many hidden, clashing verbs
- **What.** Live still has MEGA. The better tap and the cleaner shots are on branches. On the candidate, several shots fire by accident:
  - A resting thumb high on the screen pours the Hose.
  - A tap while pouring splats nothing.
  - The Lob can fire seconds late from a level bus. Its fix is on the shots branch but not in the candidate.
  - A quick look down can read as the long swipe.
  - Nothing teaches climbing, flicking down, School Zone, the Comet or the Hose. The candidate does teach aim, the Bomb, the Lob, Curb and lock-on, once each.
- **Why a player feels it.** "I didn't do that" reads as a bug.
- **Smallest fix.** One small core release:
  - Main, plus the shots that need nothing new to learn: the 85 m tap, the Comet, the Lob with its fix, hold to aim, School Zone.
  - MEGA off, and the Hose off by default (your call, section 8).
  - Everything else stays behind its flag.
  - Then teach a gesture once, at the moment it applies: "PULL DOWN TO CLIMB" after the gate, "FLICK UP" after 20 s at Cruise with no flick, "FLICK DOWN TO SLOW" the first time you are high.
- **Cost.** 2 to 3 agent-days for the release, 1 to 2 for the hints. ESTIMATE.
- **How we would know.** Zero accidental shots in a 5-minute flight. In watched sessions, three of five climb on their own within 2 minutes.

### 3.6 The first seconds and the return visit
- **What.** A blank grey page while it loads. On every visit, the locked gate holds for 16 to 30 s (ESTIMATE). TAP TO SKIP only speeds up the fog. And every visit starts at the Golden Gate, far from your paint (`main.ts:217-229, 1314-1327`).
- **Why a player feels it.** On a weak signal a grey screen looks broken. On day two, sitting through locked controls far from your paint says your work does not matter.
- **Smallest fix.**
  - A title and a small pixel bus on the loading page.
  - Link-preview tags, so a pasted link shows a picture.
  - On a return visit: the skip tap also opens the gate, and the bus starts over your last painted place.
  - The gate rule is the studio's own call, so we can change it.
- **Cost.** 1.5 to 2.5 agent-days. ESTIMATE.
- **How we would know.** The loading screen says something within the first second. A returning player makes a first splat within 5 s.

### 3.7 The climb stops at level 3
- **What.** After three hits a building only re-pops. The Lift exists, but behind a flag, Rainbow only, and gone on reload.
- **Why a player feels it.** Your own first vision was an area that grows "each time" until "the top most absolutely over the top extravagant display". Today the growth stops at the third tap.
- **Smallest fix.**
  - The hood finale (3.1) is the first top.
  - Then save the Lift, and let a square earn it when its buildings are finished, as decision 27 says. Your faction first.
- **Cost.** 2 to 4 agent-days. ESTIMATE.
- **How we would know.** You finish squares in flight and react to the Lift in the air, not in stills.

### 3.8 The save is fragile
- **What.** All building paint is one block of text in the browser's small store, rewritten whole after every change. A failed save is ignored without a word (`PaintState.ts:219-221, 263-269`). A fully painted city may be about 3.7 MB (ESTIMATE), near Safari's usual limit, which we did not check. Safari has also had a rule since 2020 that deletes what a site saved once seven days of Safari use pass without a visit to it. A game added to the Home Screen is treated differently. How today's iPhones apply the rule was not confirmed (SOURCE: reports on WebKit's change of March 2020, and WebKit's post "Updates to Storage Policy" of 2023).
- **Why a player feels it.** Once there is a goal, the save is the progress. Losing it in silence is the worst thing the game can do.
- **Smallest fix.** Pack the levels into the browser's larger database at 1 to 2 bytes a building, and write only the changes.
- **Cost.** 1 to 2 agent-days. ESTIMATE. It is part of stage 2.
- **How we would know.** A scripted run that paints everything and reloads keeps every level.

### 3.9 Nothing to send anyone
- **What.** No share code, no picture, no link preview.
- **Why it matters.** A no-install web game spreads by people sending it. "I painted the Mission", with a picture, is the ad.
- **Smallest fix.** Link-preview tags now (in 3.6). After the second test round, and only if testers ask "can I send this?": offer the phone's own share sheet once, at the hood finale. That is a button, so it is your call at that point. A link that carries a friend's paint is a later step.
- **Cost.** 1 agent-day for the finale share. 3 to 4 for a paint-carrying link. ESTIMATE.

### 3.10 The fight has no stakes
- **What.** Rival buses paint, shoot and ram, but nothing is counted. With rivals on, nothing is saved, and you do not see your own city.
- **Why a player feels it.** A fight with nothing at stake is a slapstick bit, not a reason to fight twice.
- **Smallest fix, later.** Once the handling's review blockers are settled and the goal loop has passed its test:
  - Run the rivals over your saved city.
  - Your paint is saved. Theirs lasts the visit, as the studio's existing call says.
  - Split the hood share on the sign by faction.
- **Cost.** 2 to 4 agent-days, after stage 3. ESTIMATE.

---

## 4. The core loop the studio recommends: turn the hoods

**The next ten seconds.** Steer toward the grey. When a building glints, tap. The bloom wave, the chord and the sign come up. A fresh grey block lands hard. A finished one gives a soft pop. Chain fresh blocks within 2.5 s and the notes climb and the splat grows.

**The next three minutes.** Take this hood to its mark, or follow the beacon to the next grey one. Use School Zone to hover and crown a block. Use a gear to cross town. At speed, the Comet paints in view. With the nose up, the Lob reaches across the water.

**This sitting.** Turn three to six hoods (ESTIMATE: 3 to 5 minutes of focused painting a hood). See a crown, and a finale.

**Tomorrow.** You open the game over your last paint, not at the bridge. The city count says how far you are. The beacon is already on the nearest grey hood. The sky has moved on.

To be honest, this daily pull is modest. Stronger ones, like a friend's paint arriving by link or rivals taking your turf, come only after the test shows the base loop holds.

**Exactly what is on screen.**
- **While flying:** the bus, the city and the glint. No bar or number stays on screen. The settings button fades as today. The gear readout shows only after a shift. MEGA is gone.
- **On each splat:** the street sign springs up as now, with a second line, for example "MISSION 34 %". It ticks up and sinks with the sign.
- **On entering a hood:** "THE MISSION 12 %" at the top middle, in the sign's type, for 2 s.
- **At 25 % and 50 %:** a chime, and the line flashes once.
- **At the mark (start at 60 %, ESTIMATE):**
  - A bloom wave sweeps the hood outward from your last hit.
  - The canon resolves to its home chord and the choir swells.
  - The camera climbs for 3 s over the hood. This is Recess's end shot, reused.
  - The words "THE MISSION IS PAINTED" and "8 OF 115" show.
  - The camera comes home and the next beacon rises.
- **The beacon:** a tall pillar of paint light over the heart of the nearest grey hood. The Lob's beacon is reused. When the hood is off screen, a chevron sits at the screen's edge (the rivals' chevron, reused). The beacon goes once you are inside that hood.
- **On a return visit:** "SAN FRANCISCO 8 OF 115" for 3 s, over your last painted place.
- **Streak:** no number. You hear it in the notes and see it in the splat's size.

It needs no new button and no new gesture. Painting stays the point. It works from map data for any city, and needs no server.

**Loops the studio turned down, one line each.**
- **A hood of the day for everyone:** a cheap later layer, but on its own it is thin, and a timer fights your wish to "casually almost hang out and linger".
- **Turf against the rival crews as the core:** it is your stated core, but it needs the handling's blockers fixed and a save first. It becomes this loop's second chapter (3.10).
- **Rivals painting while you are away:** a reason to return, but it is a form of decay, and that needs your ruling. Not before the base loop is proven.
- **Matches like Recess:** shelved by your ruling.
- **Gods:** on hold by your ruling.
- **A reward for flying low between towers:** a new mechanic before the main one is deep, and its roof paint trail breaks the ruling that the trail is for the street only.
- **More shots (Cloudburst, Belly Flop, a polished Bomb):** they add rare verbs before the common one is deep.
- **The Moon as the main goal:** it is behind a flag, and a plain climb takes about 6 minutes. It stays the late surprise.
- **Sharing as the core loop:** first we need proof that testers want to send it.

---

## 5. The plan

Each stage ends with a build you fly on your phone, with a list of what to try. Agent-days are ESTIMATES.

**Stage 1. The core release** (4 to 6 agent-days)
- **Built:**
  - Main, plus the candidate's default shots: the 85 m tap, Comet, Lob with its latch fix, hold to aim, School Zone. MEGA off. The Hose off by default (call 4).
  - The other features stay behind their flags.
  - The loading page with a title and a pixel bus, and link-preview tags.
  - On a return visit: the skip tap opens the gate, and the bus starts over your last paint.
  - A first measuring pass on the iPhone 13, if you have it by then.
  - It is reviewed, and goes live only with your OK.
- **You feel:**
  - The grey page now says something.
  - MEGA is gone, the tap is bigger, and School Zone lets you linger.
  - The Comet shows up ahead of you in fast gears.
  - Reopening the game puts you over your own paint in seconds.
- **Then:** test round 1, the baseline (section 6).

**Stage 2. The goal** (5 to 8 agent-days)
- **Built:**
  - The hood share by squares, on the sign and on entering a hood.
  - The 25 % and 50 % chimes, the finale at the mark, the beacon, and the city count on load.
  - The safe save.
- **You feel:** "PRESIDIO 12 %" ticking up as you paint, a beacon pulling you across town, and a finale when a hood is done.

**Stage 3. Playing well pays** (5 to 8 agent-days)
- **Built:**
  - Feedback that scales with fresh paint. Streak as approved. The approved Comet reach that grows with height. The camera easing toward each impact. The aim preferring unfinished buildings.
  - The one-time hints at the moment each applies (call 3).
  - The iPhone's own Reduce Motion setting respected: smaller kicks, no flash.
- **You feel:** a fresh grey block lands like a thunderclap. A run of them climbs the scale. Turbo from up high paints where you can see it.
- **Then:** test round 2 with five new people, and the iPhone 13 run. **This is the gate for expansion.**

Stages 1 to 3 total about 14 to 22 agent-days (ESTIMATE).

**Stage 4. The top of the climb** (3 to 6 agent-days; only after round 2 passes or nearly passes)
- **Built:** the saved Lift, earned square by square, as decision 27 says, your faction first. The share sheet at the finale, if testers asked to send it and you agree to that one button.
- **You feel:** finished squares rise and stay risen. You fly under them the next day.

**Stage 5. The fight with stakes** (2 to 4 agent-days; after the handling's review passes)
- **Built:** rivals over your saved city, the hood share split by faction, and a shell's landing taking squares back.
- **You feel:** you chase an Inferno bus to win back your hood.

**What waits until stage 3's test passes:**
- The whole planet and the Earth's detail.
- Wild places: the 62 to 88 agent-day plan, and its 973 MB first download, which is still unanswered.
- The Bay Area surround (4.5 to 6.5).
- More of the Moon: free flight (5 to 7) and home where you aim.
- The gods, which are on hold anyway.
- Other cities.
- New shot types.
- The other four factions' Lift.
- Pinch to zoom.

The live bug where land north of 38 N shows as sea from the ceiling can be fixed on its own if it is small. Otherwise it waits with the surround.

**What running work carries on:**
- **The new handling** on its branch behind `?swerve`. Its two blockers and its review go ahead. Its turning, without the rivals (the `&norivals` link), joins the next stage once it is reviewed and you like it on the phone. You asked for harder turns in every gear, so this is core work, not expansion.
- **The shots' review fixes.** The Lob's latch fix goes into stage 1. The Bomb's approved changes wait behind its flag.
- **Life** stays behind `?life` until you fly it again after its fixes.

---

## 6. The test of fun

Nobody can know from code whether it is fun. Only people who have never seen it can tell us. This test is cheap.

**Who.** Five people per round, two rounds, ten different people in all. None of them should know the project. A mix if you can: two who know San Francisco, two who don't, and one who rarely plays games. Use at least two iPhones that are not a Pro.

**How.**
- Hand over the phone with the plain link open in Safari. Say only "it's a game, try it." Do not help, explain or react.
- Watch for up to 10 minutes. Stop when they put it down.
- Sound as you find the phone. Note whether the mute switch was on. With it on, Safari is likely silent (ESTIMATE, not checked on this build), and many players will hear nothing.

**Write down for each person** (a one-page sheet, half an agent-day to make):
- Seconds to the first splat.
- Whether they climb, change gear or look around, and when, without being told.
- Every "that wasn't me" moment: a shot or gesture they did not mean.
- Anything they say about a place ("that's my street", "let me finish this one").
- When they stop, and the reason they give.
- At the end, three questions. What were you trying to do? What was the best moment? Would you send this to someone, and who?
- The next day, ask them to tell you whether they opened it again on their own.

**What counts as a pass for round 2:**
- At least 3 of 5 keep playing past 5 minutes by their own choice.
- At least 3 of 5 play toward the goal: they name a hood or chase the beacon.
- At most one accidental-shot moment per person.
- At least 2 of 5 open it again the next day without being asked.

If 3 of 5 stop before 3 minutes, do not expand. Fix what the sheets show, and run a new round. If 3 of 5 ask to send it, the share step in stage 4 moves up.

Round 1, on the stage-1 build, has no pass line. It is the "before" picture, so round 2 can show whether the goal changed anything. If people are at hand before stage 1 is built, two or three of them can be handed the live link as it is and watched the same way: it costs no code, and it already shows where strangers stop.

**The ordinary-phone check.** This needs an iPhone 13 (the A15 floor). Run it on the stage-1 build and again after stage 3.
- A cold start from the plain link on a phone network, not wifi. Write down the seconds to the first frame.
- Frames per second under the bridge, at Jet over downtown, and on a big splat. Use the `?fps` read-out.
- The impact frame must stay under 33 ms, or the hit reads as a stutter.
- No tab reload, and note how hot the phone gets, over a 10-minute flight.
- Draws and triangles against the budget of 120 to 200 draws and 1.0 to 1.5 M triangles.
- **Pass:** 30 fps held through the opening and a 5-minute paint run, with no reload. If it fails, fixing it comes before stage 4.

---

## 7. Is it fun, and can it succeed?

**The honest answer.** The first three minutes are probably fun. That is a judgement from the code, not something we watched. The opening, the splat and the thumbs are the strongest work in the project. After that it is a toy: it has nothing to aim at, nothing that grows, and nothing that marks good play. Toys can sell. Townscaper did, with no goal. But a toy with no way to show what you made has a harder road. The branches add many verbs, and verbs buy minutes, not days.

**What success depends on.**
1. Strangers chasing a goal they can see. Stage 2 builds it. Round 2 proves it or not.
2. The tap rewarding skill, so minute 20 feels different from minute 2.
3. An ordinary iPhone holding 30 fps, because the friend you send it to has one.
4. Something worth sending, and a way to send it. With no marketing and no server, people sending it to each other is the only growth.
5. Focus. The core gets finished before more world gets built.

**The biggest risks.**
- **Scope.** Two engineering accounts are building planet, Moon, factions and handling. Meanwhile the live site has not changed since 2026-11-05, and no stranger has played.
- **The stated core has no second human.** Factions are "the core element", but with no server, no matches and the gods on hold, a faction is a colour fought by computer buses. That holds until a second real player can arrive, by link or by server.
- **A count can turn a toy into a chore.** That is why it shows only at moments, and why its mark gets tuned on the phone.
- **The save.** It fails silently today, and Safari's storage rules have not been checked on today's iPhones.
- **Your phone hides problems.** On an iPhone 17 Pro, "a pass proves little".

---

## 8. The producer's calls

1. **May the game show a neighbourhood goal now?** That means a hood share at moments (on the sign, on entering, at a finale), with a beacon to the next grey hood. It comes ahead of the gods, as the solo goal under factions. **Studio's pick: yes.** It is the approved territory rule (decisions 27 and 28) made visible.
2. **Which set of hoods: the 115 baked from map data, or the 79 approved?** The question has been open since 2026-11-06. **Pick: the 115 from map data,** because any city gets its set that way. Tiny pieces are folded in, and Marin's 14 count as the real places they are. The plan works the same with 79.
3. **May a gesture be taught once, at the moment it applies, instead of all in one first-run hint?** Climb after the gate, flick up after 20 s, flick down when high. **Pick: yes.** One hint was right for three verbs, not for today's. If you say no, "PULL DOWN TO CLIMB" goes into the one first-run hint, and everything else stays.
4. **May the Hose be off by default until strangers have flown the core?** **Pick: yes.** A resting thumb pours by accident, and a tap while pouring splats nothing. If you say no, we fix the accidental pour before stage 1 ships, at about 1 more agent-day (ESTIMATE).
   Hose off also turns off hold to aim. Without the Hose it does nothing. (Nothing else on the plain link takes a hold, so the aim has no use without the Hose; CORE named hold to aim a stage-1 shot, so this is a cut, said out loud. The first-run hint drops HOLD HIGH UP TO AIM with it.)
5. **May the stage-1 core release go live, MEGA off, before the first test round?** **Pick: yes.** Strangers should meet the game we mean, and live is a week behind your rulings. If you say no, the rounds run on a preview link instead.
6. **Will you buy or borrow the used iPhone 13 this week?** **Pick: yes.** It has been open since 2026-11-04. Stage 1's measuring and round 2's pass both need it.
7. **Expansion waits: is the studio reading you right?** Your words of 2026-11-12: "Before we expand, let's really try and perfect the fundamental gameplay mechanics." The studio reads that as no new expansion work, and "not yet" to wild places' 973 MB first download, until round 2 passes. **Pick: yes, hold it all.** The planned expansion is about 70 to 100 agent-days in total (ESTIMATE, from the plans' own figures). That is four or five times the core plan, and it would make the loop bigger, not better.

---

## 9. Where the designers disagreed, and what was dropped after the check

**Disagreements, and the choice made.**
- **What the count counts.** Three designers counted painted buildings. One counted squares. *Chosen: squares,* because the approved territory rule is square by square, and the faction fight will need the same unit.
- **Where the count shows.** Three put it on the street sign. One put it in a label at the top of the screen. *Chosen: both,* the sign on a splat and the label on entering a hood.
- **When the finale fires.** Some said 100 %, some said 25/50/100, one said 60 %. *Chosen: a mark tuned on the phone, starting at 60 %,* because 100 % means hunting the last scraps.
- **The Lift as a whole-hood reward.** One designer wanted it. *Chosen: the Lift per square, as decision 27 says.* The other view changes an approved rule.
- **The Hose.** One said off by default, one said behind a flag, one said keep it, one said merge it with aim. *Chosen: off by default for now,* as call 4.
- **The Bomb in the core.** One designer wanted it in, with its approved fix. *Chosen: behind its flag.* Its charge "reads only by ear", which a player with the sound off never gets.
- **The rivals.** One said run them over the saved city now. One said save their paint too. Two said hold them. *Chosen: hold them until stage 5, then run them over your saved city with their paint lasting the visit.* Saving their paint, or letting them paint while you are away, waits for your ruling on decay.
- **Sharing.** Some wanted a share line in settings, some a share at the finale, some a paint-carrying link. *Chosen: link-preview tags now. The finale share after round 2 if testers ask. The paint link later.*
- **A list of moves in settings.** One designer wanted it. *Dropped:* it un-hides the gestures, which goes against your ruling.
- **The Moon on the plain link.** Two said open it now. One said defer. *Chosen: defer until after round 2.* A stranger needs about 6 minutes of climbing to reach it.
- **A reward for flying low.** One designer only. *Dropped for now* (see section 4).

**Dropped or corrected after the check.**
- **"The sign already names the neighbourhood": corrected.** It names the street first. The hood only shows when there is no street. So the share needs a new line on the sign.
- **"Nothing names a neighbourhood outside the Lift flag": wrong.** The sign does, when there is no street. Only the newer hood map is unused.
- **"A tap pays the same either way": softened.** The bell run grows with the count, up to 6 notes, and the blast grows with height. The payoff is weak, not flat.
- **"The fast gears are dead time": softened.** On the candidate the Comet lands in view at Nonstop and faster near the roofs. Only Turbo 1 to 3 from about 300 m up loses it.
- **"Nothing invites a hold" on the candidate: wrong.** Its first-run hint says HOLD HIGH UP TO AIM, and the Bomb has its own hint.
- **"Most verbs are unhinted": softened.** Aim, the Bomb, the Lob, Curb and lock-on are each taught once.
- **The Lob's fix: corrected.** The commit the designers cited is a docs commit. The code fixes are different commits, and neither is in the candidate yet.
- **"About 1.4 MB before the first frame": dropped.** It fits no measured figure. Boot data is about 0.56 MB, plus the script, whose real download size was not measured.
- **"8 OF 94" next to squares from a 115-hood map: corrected.** One set is used throughout (call 2).
- **The 27-degree camera tip: narrowed.** It happens only while straining at the ceiling above 5 km, not in normal play.
- **Safari's 7-day wipe and the 3.7 MB full save: kept only as unchecked risks.** Neither has been measured on today's iPhones.
