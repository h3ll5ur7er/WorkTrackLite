import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from './fixtures';

const singleFileUrl = pathToFileURL(path.resolve(__dirname, '..', 'dist', 'worktrack-singlefile.html')).href;

test('regression: the single-file build works when opened from disk (file://)', async ({ page }) => {
  await page.goto(singleFileUrl);
  await expect(page.getByRole('heading', { name: 'Welcome to WorkTrackLite' })).toBeVisible();
  await page.getByLabel(/First customer name/i).fill('Offline Co');
  await page.getByRole('button', { name: 'Get started' }).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Offline Co');
  await page
    .getByRole('link', { name: /Dashboard/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Start timer on Offline Co' }).click();
  await expect(page.locator('.bar__name')).toHaveText('Offline Co');
});

test('the deployed app links to the single-file download', async ({ page, request }) => {
  const res = await request.get('/worktrack-singlefile.html');
  expect(res.ok()).toBe(true);
  expect(await res.text()).not.toMatch(/<script[^>]+src=/);

  await page.goto('/');
  await page.getByLabel(/First customer name/i).fill('Acme');
  await page.getByRole('button', { name: 'Get started' }).click();
  await expect(page).toHaveURL(/#\/manage\//);
  await page.goto('/#/settings');
  await expect(page.getByRole('link', { name: /Download single-file app/ })).toHaveAttribute('href', 'worktrack-singlefile.html');
});
