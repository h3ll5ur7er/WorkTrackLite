import fs from 'node:fs';
import { Page } from '@playwright/test';
import { ACME, backupJson, expect, seed, test, zurich } from './fixtures';

const entries = [
  { id: 'e1', nodeId: 'design', start: zurich('2026-10-19T09:00'), end: zurich('2026-10-19T11:00') },
  { id: 'e2', nodeId: 'app', start: zurich('2026-10-20T09:00'), end: zurich('2026-10-20T10:30'), tags: ['meeting'] },
  // Last week: excluded from "This week".
  { id: 'e3', nodeId: 'app', start: zurich('2026-10-14T09:00'), end: zurich('2026-10-14T12:00') },
];

/** Table body as rows of trimmed cell texts. */
async function cells(page: Page): Promise<string[][]> {
  return page
    .locator('tbody tr')
    .evaluateAll((rows) => rows.map((r) => [...r.querySelectorAll('td')].map((td) => (td.textContent ?? '').replace(/\s+/g, ' ').trim())));
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(zurich('2026-10-21T12:00')));
  await seed(page, backupJson(ACME, entries));
  await page.goto('/#/reports');
});

test('this week by node shows the tree with subtotals', async ({ page }) => {
  await expect(page.getByTestId('report-total')).toHaveText('3:30');
  expect(await cells(page)).toEqual([
    ['Acme', '', '3:30', '100%'],
    ['Website', '', '2:00', '57.1%'],
    ['Design', '2:00', '2:00', '57.1%'],
    ['App', '1:30', '1:30', '42.9%'],
  ]);
});

test('presets, custom dates and scope change the range', async ({ page }) => {
  await page.getByRole('button', { name: 'Last week' }).click();
  await expect(page.getByTestId('report-total')).toHaveText('3:00');
  await page.getByLabel('From').fill('2026-10-14');
  await page.getByLabel('From').blur();
  await page.getByLabel('To (inclusive)').fill('2026-10-19');
  await page.getByLabel('To (inclusive)').blur();
  await expect(page.getByTestId('report-total')).toHaveText('5:00');
  await page.getByLabel('Scope').selectOption({ label: 'Acme / Website' });
  await expect(page.getByTestId('report-total')).toHaveText('2:00');
});

test('by day and by tag', async ({ page }) => {
  await page.getByRole('button', { name: 'By day' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(7);
  await expect(page.locator('tbody tr').first()).toContainText('2:00');
  await page.getByRole('button', { name: 'By tag' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  expect(await cells(page)).toEqual([
    ['meeting', '1:30', '42.9%'],
    ['(untagged)', '2:00', '57.1%'],
  ]);
});

test('summary and entries CSV export the shown range', async ({ page }) => {
  let download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Summary CSV/ }).click();
  let d = await download;
  expect(d.suggestedFilename()).toBe('worktracklite_report_2026-10-19_2026-10-25_by-node.csv');
  expect(fs.readFileSync(await d.path(), 'utf8')).toContain('Acme / Website / Design,2,2,2,0\n');

  download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Entries CSV/ }).click();
  d = await download;
  const csv = fs.readFileSync(await d.path(), 'utf8');
  expect(csv.trim().split('\n')).toHaveLength(3); // header + e1 + e2 (e3 is last week)
  expect(csv).toContain(',5400,1.5000,');
});
