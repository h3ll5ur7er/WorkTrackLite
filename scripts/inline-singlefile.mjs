#!/usr/bin/env node
/**
 * Inlines the production build into one self-contained HTML file:
 *   dist/where-time-flew/browser/index.html → dist/where-time-flew-singlefile.html
 *
 * Every same-origin <script src> and <link rel=stylesheet> is inlined.
 * Scripts KEEP `type="module"`: inline module scripts run fine from file://
 * (only *external* module scripts hit CORS), and each bundle needs its own
 * module scope — as classic scripts the minified top-level names of the
 * polyfills and main bundles collide and the app renders a blank page.
 *
 * The manifest/icon links are dropped (they cannot load from file://). The
 * service-worker registration is harmless: it is skipped where unsupported.
 *
 * Fails loudly if the build emits lazy chunks, because those would be loaded
 * as separate files at runtime and break the single-file promise.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browserDir = path.join(root, 'dist', 'where-time-flew', 'browser');
const indexPath = path.join(browserDir, 'index.html');
const outPath = path.join(root, 'dist', 'where-time-flew-singlefile.html');

function fail(msg) {
  console.error(`inline-singlefile: ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(indexPath)) fail(`build output not found at ${indexPath}. Run "npm run build" first.`);

let html = fs.readFileSync(indexPath, 'utf8');
const inlined = new Set();

const isExternal = (url) => /^(https?:)?\/\//i.test(url) || url.startsWith('data:');
const localFile = (url) => path.join(browserDir, url.replace(/^\.?\//, '').split(/[?#]/)[0]);

// <script src="..."> (Angular emits `type="module"`; keep all attributes except src).
html = html.replace(/<script\b([^>]*?)\ssrc="([^"]+)"([^>]*)>\s*<\/script\s*>/gi, (tag, pre, src, post) => {
  if (isExternal(src)) return tag;
  const file = localFile(src);
  if (!fs.existsSync(file)) fail(`script ${src} referenced by index.html is missing`);
  inlined.add(path.basename(file));
  // A literal "</script" inside the code would end the inline tag early.
  const code = fs.readFileSync(file, 'utf8').replace(/<\/script/gi, '<\\/script');
  const attrs = `${pre} ${post}`
    .replace(/\s(crossorigin|integrity)(="[^"]*")?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return `<script ${attrs}>${code}\n</script>`;
});

// <link rel="stylesheet" href="...">
html = html.replace(/<link\b[^>]*rel="stylesheet"[^>]*>/gi, (tag) => {
  const href = /href="([^"]+)"/i.exec(tag)?.[1];
  if (!href || isExternal(href)) return tag;
  const file = localFile(href);
  if (!fs.existsSync(file)) fail(`stylesheet ${href} referenced by index.html is missing`);
  inlined.add(path.basename(file));
  return `<style>${fs.readFileSync(file, 'utf8').replace(/<\/style/gi, '<\\/style')}\n</style>`;
});

// Angular also emits <link rel="modulepreload"> for eagerly imported chunks.
html = html.replace(/<link\b[^>]*rel="modulepreload"[^>]*>\s*/gi, '');
html = html.replace(/<link\b[^>]*rel="(manifest|icon|apple-touch-icon)"[^>]*>\s*/gi, '');

// Any other JS emitted by the build would be fetched at runtime → not single-file.
const chunks = fs
  .readdirSync(browserDir)
  .filter((f) => /\.m?js$/.test(f) && !inlined.has(f) && !/^(ngsw-worker|safety-worker|worker-basic\.min)\.js$/.test(f));
if (chunks.length)
  fail(`build produced extra JS chunks that cannot be inlined: ${chunks.join(', ')} (avoid lazy loading / dynamic import()).`);
if (!inlined.size) fail('no scripts were inlined — did the index.html format change?');

fs.writeFileSync(outPath, html);
const size = fs.statSync(outPath).size;
console.log(`Wrote ${path.relative(root, outPath)} (${(size / 1024).toFixed(1)} kB, inlined ${[...inlined].join(', ')})`);
