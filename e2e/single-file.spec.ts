import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from './fixtures';

const singleFilePath = path.resolve(__dirname, '..', 'dist', 'where-time-flew-singlefile.html');
const singleFileUrl = pathToFileURL(singleFilePath).href;

test('regression: inlined bundles stay ES modules and there is no <base> tag', () => {
  // As classic scripts, several minified bundles share one global scope and clobber
  // each other (the original blank-page bug). A <base> breaks hash routing on file://.
  const html = fs.readFileSync(singleFilePath, 'utf8');
  // Large scripts are the inlined bundles (Angular also adds a tiny inline CSS-loader script).
  const bundles = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter((m) => m[2].length > 10_000);
  expect(bundles.length).toBeGreaterThan(0);
  for (const [, attrs] of bundles) expect(attrs).toContain('type="module"');
  expect(html).not.toMatch(/<base\s[^>]*href/i);
  expect(html).not.toMatch(/<script[^>]+src=/);
});

test('regression: the single-file build works when opened from disk (file://)', async ({ page }) => {
  await page.goto(singleFileUrl);
  await expect(page.getByRole('heading', { name: 'Welcome to Where Time Flew' })).toBeVisible();
  await page.getByLabel(/First customer name/i).fill('Offline Co');
  await page.getByRole('button', { name: 'Get started' }).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Offline Co');
  await page
    .getByRole('link', { name: /Dashboard/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Start timer on Offline Co' }).click();
  await expect(page.locator('.bar__name')).toHaveText('Offline Co');
  // WebCrypto needs a secure context; file:// pages are one, so encrypted backups work offline too.
  await page
    .getByRole('link', { name: /Settings/ })
    .first()
    .click();
  await expect(page.getByLabel('Protect the backup with a password')).toBeVisible();
});

test('the deployed app links to the single-file download', async ({ page, request }) => {
  const res = await request.get('/where-time-flew-singlefile.html');
  expect(res.ok()).toBe(true);
  expect(await res.text()).not.toMatch(/<script[^>]+src=/);

  await page.goto('/');
  await page.getByLabel(/First customer name/i).fill('Acme');
  await page.getByRole('button', { name: 'Get started' }).click();
  await expect(page).toHaveURL(/#\/manage\//);
  await page.goto('/#/settings');
  await expect(page.getByRole('link', { name: /Download single-file app/ })).toHaveAttribute('href', 'where-time-flew-singlefile.html');
});
