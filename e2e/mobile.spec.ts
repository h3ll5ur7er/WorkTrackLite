import { ACME, H, backupJson, expect, seed, test, zurich } from './fixtures';

test('@mobile long-press on a card opens its menu; bottom navigation works', async ({ page }) => {
  await seed(page, backupJson(ACME));
  const card = page.locator('.card', { hasText: 'Design' });
  const box = (await card.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  // Touch press and hold via CDP (Playwright's tap() releases immediately).
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await page.waitForTimeout(700);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

  await expect(page.getByRole('menuitem', { name: 'Open in Manage' })).toBeVisible();
  // The long press must not also toggle the timer.
  await expect(page.getByText('No active timer')).toBeVisible();
  await page.getByRole('menuitem', { name: 'Open in Manage' }).click();
  await expect(page).toHaveURL(/#\/manage\/design$/);

  await page
    .getByRole('navigation', { name: 'Main (mobile)' })
    .getByRole('link', { name: /Schedule/ })
    .click();
  await expect(page).toHaveURL(/#\/schedule$/);
});

test('@mobile long-press on a calendar entry opens its menu', async ({ page }) => {
  const start = zurich('2026-10-20T09:00');
  await page.clock.setFixedTime(new Date(zurich('2026-10-20T10:00')));
  await seed(page, backupJson(ACME, [{ id: 'e1', nodeId: 'design', start, end: start + H }]));
  await page.goto('/#/schedule');
  const box = (await page.locator('[data-entry-id="e1"]').boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await page.waitForTimeout(700);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByRole('menuitem', { name: 'Duplicate' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
