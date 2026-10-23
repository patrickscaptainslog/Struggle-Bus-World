// Browser launch options shared by the QA tools (shots, blast, altitude, ...).
// - In the cloud container (Linux, no GPU): the pinned Chromium with SwiftShader
//   (software GL: correct but ~1.5 fps, so tools wait on the game clock).
// - Anywhere else, e.g. a laptop: the installed Chrome (Edge on Windows) with the
//   real GPU, which makes every capture many times faster.
// Overrides: CHROME_PATH=<exe>, SB_CHANNEL=chrome|msedge, SB_GPU=0|1, SB_HEADED=1
// (a visible window, if headless GPU rendering misbehaves on a machine).
import { existsSync } from 'node:fs';

const PINNED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SOFTWARE_GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'];
const HARDWARE_GL = ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'];

export function browserOptions(extraArgs = []) {
  const pinned = existsSync(PINNED);
  const gpu = process.env.SB_GPU ? process.env.SB_GPU !== '0' : !pinned;
  const opts = { headless: !process.env.SB_HEADED };
  if (process.env.CHROME_PATH) opts.executablePath = process.env.CHROME_PATH;
  else if (pinned) opts.executablePath = PINNED;
  else opts.channel = process.env.SB_CHANNEL || (process.platform === 'win32' ? 'msedge' : 'chrome');
  opts.args = [...(gpu ? HARDWARE_GL : SOFTWARE_GL), ...extraArgs];
  return opts;
}
