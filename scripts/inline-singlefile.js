#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Inline the Angular build into a single self-contained HTML file.
 *
 * Reads dist/worktrack/browser/index.html and inlines every same-origin
 * <script src> and <link rel="stylesheet" href> as inline tags. The result is
 * written to dist/worktrack-singlefile.html.
 *
 * The PWA service worker, manifest and icon links are stripped because they
 * cannot be served from a `file://` URL anyway. The resulting file works when
 * opened directly from disk or hosted on any static server, and stores all
 * data locally via IndexedDB.
 */
const fs = require('fs');
const path = require('path');

const browserDir = path.resolve(__dirname, '..', 'dist', 'worktrack', 'browser');
const indexPath = path.join(browserDir, 'index.html');
const outPath = path.resolve(__dirname, '..', 'dist', 'worktrack-singlefile.html');

if (!fs.existsSync(indexPath)) {
  console.error(`Build output not found at ${indexPath}. Run "npm run build" first.`);
  process.exit(1);
}

let html = fs.readFileSync(indexPath, 'utf8');

// Inline external <script src="..."> tags (same-origin only).
html = html.replace(/<script\b([^>]*)\ssrc="([^"]+)"([^>]*)><\/script\s*>/gi, (m, pre, src, post) => {
  if (/^https?:|^\/\//.test(src)) return m;
  const file = path.join(browserDir, src.replace(/^\.?\//, ''));
  if (!fs.existsSync(file)) {
    console.warn(`  warn: ${src} not found, leaving as-is`);
    return m;
  }
  const code = fs.readFileSync(file, 'utf8');
  // strip type="module" so it works from file:// without CORS
  const attrs = (pre + ' ' + post).replace(/\stype="module"/g, '').trim();
  return `<script${attrs ? ' ' + attrs : ''}>${code}\n</script>`;
});

// Inline <link rel="stylesheet" href="..."> tags (same-origin only).
html = html.replace(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (m, href) => {
  if (/^https?:|^\/\//.test(href)) return m;
  const file = path.join(browserDir, href.replace(/^\.?\//, ''));
  if (!fs.existsSync(file)) return m;
  const css = fs.readFileSync(file, 'utf8');
  return `<style>${css}\n</style>`;
});

// Strip features that don't work from file:// (manifest, service worker registration links).
html = html.replace(/<link[^>]+rel="manifest"[^>]*>\s*/g, '');
html = html.replace(/<link[^>]+rel="icon"[^>]*>\s*/g, '');
// Make sure base href works from file://
html = html.replace(/<base[^>]*>/g, '<base href="./">');

fs.writeFileSync(outPath, html);
const size = fs.statSync(outPath).size;
console.log(`Wrote ${outPath} (${(size / 1024).toFixed(1)} kB)`);
