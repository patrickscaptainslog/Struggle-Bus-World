# Module: input-ui

Files you own: src/game/Input.ts, src/ui/Tuner.ts, src/ui/Perf.ts, dev/input.html

## Spec

Build (1) the one-thumb input and (2) the hidden tuning panel + performance meter.
(1) Input — the "floating bungee": touch anywhere; the vector from the touch-down point to the current finger is the bungee stretch.
API (exact):
  export interface InputState { dragging: boolean; stretch: { x: number; y: number } /* in units of config.flight.stretchPx, +x right, +y UP (screen up), soft-saturated so |stretch| <= 1 */; anchor: { x: number; y: number } | null /* css px */; finger: { x: number; y: number } | null }
  export class Input {
    constructor(el: HTMLElement)
    readonly state: InputState
    onTap: (() => void) | null          // a quick tap (< 230 ms, < 12 px movement) with no drag, OR a second finger touching down while dragging
    onTripleFinger: (() => void) | null // three fingers down at once (toggles tuner)
    onFirstGesture: (() => void) | null // fires once, synchronously inside the first pointerdown/touchend (used to unlock audio on iOS)
    update(dt: number): void
    dispose(): void
  }
Use Pointer Events with touch-action none, handle pointercancel, multiple pointers (first pointer steers), dead zone config.flight.deadZonePx,
soft saturation (e.g. tanh-like) beyond stretchPx, and when the anchor drifts too far (> 2.2x stretchPx) drag the anchor along behind the
finger (like a leash) so the player never runs out of room. Prevent iOS gestures: double-tap zoom, long-press callout, pinch zoom, rubber-band
scroll, text selection. Desktop dev: mouse drag works the same; Space or click = tap; arrow keys / WASD = stretch (up = surge, down = hover).
(2) Tuner (src/ui/Tuner.ts): export class Tuner { constructor(); toggle(): void; readonly visible: boolean; onResetPaint: (() => void) | null; onAction: ((name: string) => void) | null } —
a hidden DOM overlay (opened by Input.onTripleFinger or URL ?tune) that auto-generates sliders for EVERY numeric field in config (import { config }
from '../config') grouped by section, plus every group from tunableGroups() (src/ui/tunables.ts; subscribe to onTunablesChanged). Infer
ranges (0..3x default, step sensible; honor explicit ranges; negative defaults get symmetric ranges), show value, double-tap a row to reset.
Buttons: "Copy JSON" (copies the changed values as JSON via navigator.clipboard with a fallback textarea), "Reset paint" (calls onResetPaint),
"Close". Persist changed values in localStorage (try/catch) and re-apply on load (export function applySavedTuning(): void). The panel must be
usable with one thumb on an iPhone: big touch targets, scrollable, semi-transparent dark panel, crisp system font, does not steal input from the game when closed.
Perf (src/ui/Perf.ts): export class Perf { constructor(renderer: THREE.WebGLRenderer); frame(dtMs: number, workMs: number): void; setVisible(v: boolean): void; readonly fps: number; snapshot(): object } —
small corner meter: fps (1 s avg), 1% low, frame ms, GPU-side unknown so show CPU work ms, draw calls/triangles from renderer.info, low-res size,
and a "30 Hz cap? (Low Power Mode)" warning heuristic when frames lock to ~33 ms while work is < 8 ms. Shown via ?fps or from the tuner.
Also set window.__stats = perf.snapshot() every second (the screenshot tool reads it).
dev/input.html: a visual test page (plain canvas 2D is fine) showing the anchor, finger, stretch vector, taps; plus the tuner open. Use
playwright-core (see tools/shot.mjs for launch args) to script touch drags/taps and verify events, and screenshot the tuner on an iPhone viewport.
