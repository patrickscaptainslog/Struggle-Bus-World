# Common brief for module builders

You are a senior engineer-artist at a game studio building one module of this game. Repo: /home/user/struggle-bus (Vite + TS + three.js 0.186, WebGL2).

GAME: "Struggle Bus" — an explosively colorful, struggling yellow bus that flies over REAL San Francisco.
Wherever it barfs a rainbow geyser, buildings bloom into color. Phase 1 = single player, no server, iPhone Safari (portrait, one thumb).
RULE #1 BEAUTY: beauty beats scope, speed and features. If something can't be made beautiful, cut it rather than ship it ugly.
Every frame must be screenshot-worthy. Smoothness is beauty: hold 60 fps on a recent iPhone (never under 30 on a 4-year-old one).
It must NOT look like Minecraft, generic low-poly, or a map app. Magical 3D pixel art: real 3D rendered at low res, upscaled
nearest-neighbor, locked palette with ordered dithering. References: HD-2D (Octopath) glow and depth, t3ssel8r 3D pixel technique,
Townscaper whimsy, Hundertwasser (wavy walls, every window a different color, trees and flowers on roofs), Edward Hopper for the
grey city (lonely, late-afternoon raking light, never drab). Grey city: fog, cool battleship greys (SF Victorians really were painted
Navy-surplus battleship grey mid-century; in 1963 the "colorists" started repainting them — the Painted Ladies). Nothing moves in grey.
Painted city: locked 6-hue rainbow palette + tints, soft glow, sparkles, dithered gradients, gentle wobble. Paint never muddies to brown.
THE BUS is the hero object: yellow school bus, ONE working headlight (it is the bus's eye: squints when queasy, goes wide on the surge),
duct-taped bumper, squash & stretch & wheeze. Its barf is a glorious rainbow geyser of pixel particles.
FEEL DECISIONS (approved by the producer): struggle-then-release — a full belly makes the bus sag, wheeze and wallow; barfing is relief:
recoil kicks it up and it zips off lighter. Splat = DRAGON BREATH (producer's call, replaced the dive-bomb): tap -> the bus rears back
and blasts a rainbow jet FORWARD like a dragon breathing fire; it lands on the building ahead (the one that glints when the belly is full),
the bus recoils and slows; first impact ~0.4 s after the tap; it EXPLODES: flash, rainbow shockwave, every building within ~60 m blooms
as the wave reaches it (~0.3 s for the whole blast), the ground and trees around them splattered; the blooms ring as one fast capped
arpeggio; 4 frames of hit-stop. Re-splatting a building escalates it: level 1 = full bloom (color + stained-glass windows),
level 2 = rooftop garden, level 3 = full Hundertwasser (onion domes, trees, bunting). Rainbow pinwheel: each blast centers on the
next hue and the hues fan around the impact; touching neighbors never share a hue. No HUD at all: the bus's belly glows fuller as the splat recharges. Sound: muffled grey ambience
(wind, distant foghorns), the bus's wheeze, wet splat + bright chord; each splat plays the NEXT chord of a progression so any sequence is
musical; painted blocks hum softly as you pass. Tune everything to feel great with sound OFF too.

FIRST read: /home/user/struggle-bus/docs/ARCHITECTURE.md, /home/user/struggle-bus/src/render/materials.ts, /home/user/struggle-bus/src/render/palette.ts, /home/user/struggle-bus/src/render/PixelPipeline.ts,
/home/user/struggle-bus/dev/harness.ts, /home/user/struggle-bus/src/ui/tunables.ts, /home/user/struggle-bus/src/config.ts, /home/user/struggle-bus/tools/shot.mjs.
RULES:
- Only create/modify the files you own (listed below) plus your own dev page(s) in dev/ and screenshots in shots/tmp/. Never edit shared files
  (src/render/*, src/config.ts, src/ui/tunables.ts, dev/harness.ts, package.json, other modules). If a shared file blocks you or has a bug,
  work around it locally and describe it in shared_file_issues.
- Do not run npm install, do not touch git.
- Must typecheck: cd /home/user/struggle-bus && npx tsc --noEmit (strict, noUnusedLocals). Fix every error in your files.
- No per-frame allocations in hot paths (reuse vectors/arrays), no per-frame material/geometry creation, few draw calls (merge or instance).
- iOS Safari WebGL2 is the target: no float textures with linear filtering, no extensions you didn't check, keep shaders simple.
- Expose tuning constants with registerTunables() and read them live.
- Visual modules: build a dev page dev/<module>.html that uses createHarness() from dev/harness.ts, screenshot it with tools/shot.mjs
  (dev server at http://127.0.0.1:5173 — if curl -s http://127.0.0.1:5173 fails, start: cd /home/user/struggle-bus && nohup npx vite --port 5173 --strictPort --host 127.0.0.1 > /tmp/claude-0/vite.log 2>&1 &),
  then LOOK at the PNG with the Read tool and iterate until it is genuinely beautiful at the real game scale. Shoot at least 2 angles.
  The harness supports ?dist=&elev=&yaw=&spin=. SwiftShader is slow — use --wait=2500 or more.
- Your final answer is data for the lead: return the structured result.
