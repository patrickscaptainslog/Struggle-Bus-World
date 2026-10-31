import { defineConfig } from 'vite';
import { resolve } from 'node:path';

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
      },
    },
  },
  worker: { format: 'es' },
});
