// A flick, as a thumb in the left of the screen gives one (docs/specs/flight/THUMBS.md): 74 px straight up or down in 85 ms,
// on the second thumb's rule. The left zone never flies, so the stroke never touches the stick, in either loop. Its events are
// stamped (CDP's timestamp), all 2 s back, so a slow frame on software GL can't stretch it into a drag: Input reads the landing
// and the lift, nothing between. A frame that lands mid-stroke may start a look, which goes home on the lift. back: how far back the stamps start
// (s, 2). With hold to aim on (?hose, ?life, so ?show) a stroke in the look zone stamped 2 s back is a finger held still 2 s to the frames that see it
// before its first move, and two of them start an aim (Input.canAim reads the frame's clock against the landing's stamp): its lift pours the Hose. A real
// thumb's 85 ms flick never aims; back 0 stamps it as it happens.
//   await flick(cdp, 1)                       up a rung, or what TURBO's tap was out in space; -1: down one, or its down tab
//   await flickTo(page, cdp, 5)               up or down the low game's ladder to that gear (Cruise 0 ... Rainbow Warp 5)
export async function flick(cdp, dir, { x = 70, y = 560, id = 9, back = 2 } = {}) {
  const t0 = Date.now() / 1000 - back;
  const at = (dy, ms) => ({ touchPoints: [{ x, y: y + dy, id, radiusX: 4, radiusY: 4, force: 1 }], timestamp: t0 + ms / 1000 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', ...at(0, 0) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', ...at(-37 * dir, 42) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', ...at(-74 * dir, 85) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t0 + 0.085 });
}

/** Flicks the low game's ladder to `gear`, a rung at a time, each one seen to go before the next. Throws if a flick doesn't land. */
export async function flickTo(page, cdp, gear) {
  const now = () => page.evaluate(() => window.__game.controls.turbo.gear);
  for (let i = 0, g = await now(); g !== gear; i++, g = await now()) {
    if (i >= 8) throw new Error(`flicked 8 times and the gear is ${g}, not ${gear}`);
    await flick(cdp, g < gear ? 1 : -1);
    await page.waitForFunction((was) => window.__game.controls.turbo.gear !== was, g, { timeout: 60000, polling: 50 });
  }
}
