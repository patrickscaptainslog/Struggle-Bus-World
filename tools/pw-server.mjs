#!/usr/bin/env node
// One shared browser (tools/browser.mjs: GPU Edge/Chrome here, SwiftShader in the cloud) for several QA scripts:
//   node tools/pw-server.mjs <wsFile>      (writes the ws endpoint to <wsFile>, runs until killed)
//   PW_WS=$(cat <wsFile>) node tools/look.mjs ...   (look.mjs and shots.mjs connect instead of launching)
import { chromium } from 'playwright-core';
import { browserOptions } from './browser.mjs';
import { writeFileSync } from 'node:fs';

const server = await chromium.launchServer({
  ...browserOptions([]),
});
writeFileSync(process.argv[2] ?? 'pw-ws.txt', server.wsEndpoint());
console.log('browser server', server.wsEndpoint());
const stop = async () => { await server.close(); process.exit(0); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
