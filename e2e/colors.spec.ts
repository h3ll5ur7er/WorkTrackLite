import { ACME, H, backupJson, expect, seed, test, zurich } from './fixtures';

test('a customer colour flows to its projects, tasks and calendar blocks', async ({ page }) => {
  await page.clock.setFixedTime(new Date(zurich('2026-10-20T10:00')));
  const start = zurich('2026-10-20T08:00');
  await seed(page, backupJson(ACME, [{ id: 'e1', nodeId: 'design', start, end: start + H }]));

  await page.goto('/#/manage/acme');
  await page.getByRole('radiogroup', { name: 'Colour' }).getByTitle('Red').click();

  // Inherited by Design (grandchild): shown as the default choice there.
  await page.goto('/#/manage/design');
  await expect(page.getByText('Colour (inherited)')).toBeVisible();

  await page.goto('/#/schedule');
  const block = page.locator('[data-entry-id="e1"]');
  await expect(block).toHaveCSS('background-color', 'rgb(239, 68, 68)');
  await expect(block).toHaveCSS('color', 'rgb(17, 24, 39)');

  await page.goto('/#/dashboard');
  await expect(page.locator('.card', { hasText: 'Design' })).toHaveCSS('border-left-color', 'rgb(239, 68, 68)');
});

test('tag colours are set in Settings and used on chips', async ({ page }) => {
  await seed(page, backupJson([ACME[0], { id: 'app', parentId: 'acme', name: 'App', kind: 'Project', tags: ['urgent'] }]));
  await page.goto('/#/settings');
  await page.getByRole('radiogroup', { name: 'Colour for tag urgent' }).getByTitle('Green').click();
  await page.goto('/#/dashboard');
  await expect(page.locator('.card', { hasText: 'App' }).locator('.chip', { hasText: 'urgent' })).toHaveCSS(
    'background-color',
    'rgb(34, 197, 94)',
  );
});
