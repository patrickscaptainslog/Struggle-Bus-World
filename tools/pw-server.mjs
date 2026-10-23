#!/usr/bin/env node
// One headless Chromium (SwiftShader) for several QA scripts at once:
//   node tools/pw-server.mjs <wsFile>      (writes the ws endpoint to <wsFile>, runs until killed)
//   PW_WS=$(cat <wsFile>) node tools/look.mjs ...   (look.mjs and shots.mjs connect instead of launching)
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const server = await chromium.launchServer({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
});
writeFileSync(process.argv[2] ?? 'pw-ws.txt', server.wsEndpoint());
console.log('browser server', server.wsEndpoint());
const stop = async () => { await server.close(); process.exit(0); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
