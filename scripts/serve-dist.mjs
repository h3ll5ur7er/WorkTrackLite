#!/usr/bin/env node
/**
 * Minimal static server for the production build (used by the e2e tests and
 * handy for checking a build locally): `node scripts/serve-dist.mjs [port]`.
 * Serves dist/where-time-flew/browser plus dist/where-time-flew-singlefile.html, the same
 * layout the GitHub Pages deploy publishes.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDir = path.join(root, 'dist', 'where-time-flew', 'browser');
const singleFile = path.join(root, 'dist', 'where-time-flew-singlefile.html');
const port = Number(process.argv[2] ?? process.env.PORT ?? 4300);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

if (!fs.existsSync(appDir)) {
  console.error(`serve-dist: ${appDir} not found. Run "npm run build:singlefile" first.`);
  process.exit(1);
}

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    let file = urlPath === '/where-time-flew-singlefile.html' ? singleFile : path.join(appDir, urlPath === '/' ? 'index.html' : urlPath);
    if (!file.startsWith(appDir) && file !== singleFile) file = '';
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    const body = fs.readFileSync(file);
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'content-length': body.length,
      'cache-control': 'no-store',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  })
  .listen(port, () => console.log(`serve-dist: http://localhost:${port}/`));
