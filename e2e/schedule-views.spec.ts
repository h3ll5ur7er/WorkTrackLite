import { ACME, H, backupJson, expect, seed, test, zurich } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(zurich('2026-10-24T10:00')));
  await seed(
    page,
    backupJson(ACME, [{ id: 'e1', nodeId: 'design', start: zurich('2026-10-25T09:00'), end: zurich('2026-10-25T09:00') + H }]),
  );
  await page.goto('/#/schedule');
});

test('day and 3-day views step by their own length (across the DST change)', async ({ page }) => {
  const label = page.getByTestId('week-label');
  await page.getByLabel('View').selectOption('day');
  await expect(label).toHaveText('Sat, 10/24');
  await expect(page.locator('.sched__day-head')).toHaveCount(1);
  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(label).toHaveText('Sun, 10/25');
  await expect(page.locator('[data-entry-id="e1"]')).toBeVisible();
  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(label).toHaveText('Mon, 10/26');

  await page.getByLabel('View').selectOption('3day');
  await expect(page.locator('.sched__day-head')).toHaveCount(3);
  await page.getByRole('button', { name: 'Previous 3 days' }).click();
  await expect(label).toHaveText('Fri, 10/23 – Sun, 10/25');
  await page.getByRole('button', { name: 'Today' }).click();
  await expect(label).toHaveText('Sat, 10/24 – Mon, 10/26');
});

test('the chosen view is remembered on this device', async ({ page }) => {
  await page.getByLabel('View').selectOption('3day');
  await page.reload();
  await expect(page.getByLabel('View')).toHaveValue('3day');
  await expect(page.locator('.sched__day-head')).toHaveCount(3);
});

test('@mobile phones show one day by default', async ({ page }) => {
  await expect(page.getByLabel('View')).toHaveValue('auto');
  await expect(page.locator('.sched__day-head')).toHaveCount(1);
  await expect(page.getByTestId('week-label')).toHaveText('Sat, 10/24');
  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(page.locator('[data-entry-id="e1"]')).toBeVisible();
});
