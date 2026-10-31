#!/usr/bin/env node
// What in a build can iOS 15.0 (the oldest Safari with WebGL2) not parse, or not run? A script that doesn't parse never
// runs at all and nothing says so: the page stays fog-grey, boot().catch included. vite.config.ts's build.target lowers
// syntax, but not what it can't: a regex literal that doesn't compile is an early error too, and no target touches an API.
//   node tools/iosfloor.mjs <build dir>      (default ../sb-build-next; exit 1 if a chunk won't parse on iOS 15.0)
// Parsed, not grepped: minified text is full of false matches. API hits are for reading, not a failure: `.at(` may well be
// three's Ray.at, and a name the chunk tests with `typeof` is guarded (DecompressionStream, OffscreenCanvas).
import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';

const dir = process.argv[2] ?? '../sb-build-next';
const assets = readdirSync(dir).includes('assets') ? `${dir}/assets` : dir;

/** members newer than Safari 15.0 (Array.at, hasOwn, findLast 15.4; the change-by-copy family 16; the rest later) */
const MEMBERS = new Set(['at', 'findLast', 'findLastIndex', 'hasOwn', 'toSorted', 'toReversed', 'toSpliced', 'with', 'groupBy', 'withResolvers', 'fromAsync', 'randomUUID', 'isWellFormed', 'toWellFormed']);
/** globals newer than Safari 15.0, or never in Safari */
const GLOBALS = new Set(['structuredClone', 'OffscreenCanvas', 'requestIdleCallback', 'BroadcastChannel', 'CompressionStream', 'DecompressionStream', 'scheduler']);

let fatal = 0;
for (const file of readdirSync(assets).filter((f) => f.endsWith('.js'))) {
  const text = readFileSync(`${assets}/${file}`, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const bad = [];
  const fields = { instance: 0, static: 0, private: 0 };
  const api = new Map();
  const guarded = new Set();
  const hit = (name, node) => {
    const at = node.getStart();
    if (!api.has(name)) api.set(name, []);
    api.get(name).push(text.slice(Math.max(0, at - 12), at + 26));
  };
  const walk = (n) => {
    if (n.kind === ts.SyntaxKind.ClassStaticBlockDeclaration) bad.push('class static block (Safari 16.4)');
    if (n.kind === ts.SyntaxKind.PropertyDeclaration) fields[n.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword) ? 'static' : 'instance']++;
    if (n.kind === ts.SyntaxKind.PrivateIdentifier) fields.private++;
    if (n.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      const t = n.getText();
      const flags = t.slice(t.lastIndexOf('/') + 1);
      if (/\(\?<[=!]/.test(t)) bad.push(`regex lookbehind (Safari 16.4): ${t.slice(0, 50)}`);
      if (flags.includes('v')) bad.push(`regex v flag (Safari 17): ${t.slice(0, 50)}`);
    }
    if (ts.isTypeOfExpression(n) && ts.isIdentifier(n.expression)) guarded.add(n.expression.text);
    if (ts.isPropertyAccessExpression(n) && MEMBERS.has(n.name.text) && ts.isCallExpression(n.parent) && n.parent.expression === n) hit('.' + n.name.text, n.parent);
    if (ts.isIdentifier(n) && GLOBALS.has(n.text) && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)) hit(n.text, n);
    ts.forEachChild(n, walk);
  };
  walk(sf);
  for (const d of sf.parseDiagnostics) bad.push(`parse error: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
  fatal += bad.length;
  const native = fields.instance + fields.static + fields.private;
  console.log(`${file}: ${bad.length ? `${bad.length} WON'T PARSE` : 'parses'}${native ? `, ${native} native class fields (build.target lowers them below Safari 16: is it still safari15?)` : ''}`);
  for (const b of [...new Set(bad)].slice(0, 8)) console.log(`  ${b}`);
  for (const [name, where] of api) if (!guarded.has(name)) console.log(`  ${name} x${where.length}: ${where.slice(0, 8).map((w) => JSON.stringify(w)).join(' ')}`);
}
console.log(fatal ? `${fatal} things iOS 15.0 can't parse` : 'iOS 15.0 parses every chunk');
process.exit(fatal ? 1 : 0);
