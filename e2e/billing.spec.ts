import fs from 'node:fs';
import { ACME, backupJson, expect, seed, test, zurich } from './fixtures';

const nodes = [{ ...ACME[0], rate: 100 }, ACME[1], ACME[2], { ...ACME[3], billable: false }];
const settings = { id: 'app', theme: 'dark', weekStartsOn: 1, currency: 'CHF', rounding: { minutes: 15, mode: 'up' } };
const day = (h: number, m = 0) => zurich(`2026-10-20T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(zurich('2026-10-21T12:00')));
  await seed(
    page,
    backupJson(
      nodes,
      [
        { id: 'e1', nodeId: 'design', start: day(9), end: day(10, 5) }, // 65 min → 75 min billable → 125
        { id: 'e2', nodeId: 'app', start: day(11), end: day(12) }, // not billable (node)
      ],
      { settings },
    ),
  );
});

test('rates inherit, rounding applies, and reports show amounts', async ({ page }) => {
  await page.goto('/#/manage/design');
  await expect(page.getByLabel('Hourly rate (CHF)')).toHaveAttribute('placeholder', 'Inherits 100');
  await expect(page.getByTestId('tracked-value')).toHaveText(/CHF\s?125\.00/);

  await page.goto('/#/reports');
  await expect(page.getByTestId('report-amount')).toHaveText(/CHF\s?125\.00/);
  await expect(page.getByText('Billable · 1:15')).toBeVisible();
});

test('an entry can override the billable flag', async ({ page }) => {
  await page.goto('/#/manage/app');
  await page.getByRole('button', { name: 'Edit entry' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Billable')).toHaveValue('');
  await dialog.getByLabel('Billable').selectOption('yes');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await page.goto('/#/reports');
  // 125 (Design) + 1 h on App at the inherited 100.
  await expect(page.getByTestId('report-amount')).toHaveText(/CHF\s?225\.00/);
});

test('budget value and CSV amounts', async ({ page }) => {
  await page.goto('/#/manage/web'); // fixed budget 10 h × 100
  await expect(page.locator('.report__row', { hasText: 'Budget value' })).toContainText(/CHF\s?1,000\.00/);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV (subtree)' }).click();
  const csv = fs.readFileSync(await (await download).path(), 'utf8');
  expect(csv.split('\n')[0]).toContain(',billable,rate,amount');
  expect(csv).toContain(',yes,100,125.00');
});
