import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

// (?bench's screen names the build: Vercel's commit, else the tree's, + when it has changes not committed)
function buildId(): string {
  const v = process.env.VERCEL_GIT_COMMIT_SHA;
  if (v) return v.slice(0, 7);
  try {
    const head = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    const dirty = execSync('git status --porcelain --untracked-files=no', { encoding: 'utf8' }).trim() !== '';
    return head + (dirty ? '+' : '');
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  base: './',
  server: { host: true, port: 5173 },
  build: {
    // the oldest parser that plays: iOS 15.0 (WebGL2's first). A class static block is a SyntaxError before Safari
    // 16.4: the whole script would never run. Workers get the same target (tools/iosfloor.mjs checks the chunks)
    target: 'safari15',
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        // (L1's WebKit leg, CONTRACT.md section 7: a page of its own, which the game's pages never load)
        lifecheck: resolve(__dirname, 'life-check.html'),
      },
    },
  },
  worker: { format: 'es' },
  // (W6, tools/life/flag-off.mjs: SB_NO_LIFE=1 builds the same commit with life left out, for the page with ?life off to be held to)
  define: { __SB_NO_LIFE__: JSON.stringify(process.env.SB_NO_LIFE === '1'), __SB_BUILD__: JSON.stringify(buildId()) },
});
