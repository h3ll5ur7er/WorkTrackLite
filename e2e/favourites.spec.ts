import { ACME, H, backupJson, expect, readStore, seed, test, zurich } from './fixtures';

const NOW = zurich('2026-10-21T15:00');

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(NOW));
});

test('quick start lists favourites, then recently used nodes, and toggles timers', async ({ page }) => {
  const nodes = [...ACME, { id: 'ops', name: 'Ops', kind: 'Project', favorite: true }];
  await seed(
    page,
    backupJson(nodes, [
      { id: 'e1', nodeId: 'design', start: NOW - 5 * H, end: NOW - 4 * H },
      { id: 'e2', nodeId: 'app', start: NOW - 3 * H, end: NOW - 2 * H },
    ]),
  );
  await page.goto('/#/dashboard');
  const quick = page.getByRole('region', { name: 'Quick start' });
  await expect(quick.getByRole('button')).toHaveText([/★\s*Ops/, /App/, /Design/]);

  // Toggle buttons: the name stays the node's, aria-pressed says whether it runs.
  const app = quick.getByRole('button', { name: 'App', exact: true });
  await expect(app).toHaveAttribute('aria-pressed', 'false');
  await app.click();
  await expect(page.locator('.bar__name')).toHaveText('App');
  await expect(app).toHaveAttribute('aria-pressed', 'true');
  // Past the dashboard's double-click guard (the clock is frozen otherwise).
  await page.clock.setFixedTime(new Date(NOW + 60_000));
  await app.click();
  await expect(page.getByText('No active timer')).toBeVisible();
});

test('favourite a node from its card and from Manage; it sorts first', async ({ page }) => {
  await seed(page, backupJson(ACME));
  await page.goto('/#/dashboard');
  const firstCard = page.locator('.card').first();
  await expect(firstCard).toHaveAttribute('data-node-id', 'app');

  await page.getByRole('button', { name: 'More actions for Design' }).click();
  await page.getByRole('menuitem', { name: 'Add to favourites' }).click();
  await expect(firstCard).toHaveAttribute('data-node-id', 'design');
  await expect(page.getByRole('region', { name: 'Quick start' }).getByRole('button', { name: 'Design (favourite)' })).toBeVisible();
  await expect
    .poll(async () => (await readStore<{ id: string; favorite?: boolean }>(page, 'nodes')).find((n) => n.id === 'design')?.favorite)
    .toBe(true);

  // Undo, then favourite App from its Manage page instead.
  await page.locator('.toast', { hasText: 'added to favourites' }).getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('region', { name: 'Quick start' })).toHaveCount(0);
  await page.goto('/#/manage/app');
  const star = page.getByRole('button', { name: 'Favourite' });
  await expect(star).toHaveAttribute('aria-pressed', 'false');
  await star.click();
  await expect(star).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/#/dashboard');
  await expect(page.getByRole('region', { name: 'Quick start' }).getByRole('button')).toHaveText([/★\s*App/]);
});

test('favourites come first in the command palette', async ({ page }) => {
  await seed(page, backupJson([...ACME.map((n) => (n.id === 'app' ? { ...n, favorite: true } : n))]));
  await page.goto('/#/dashboard');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('start timer');
  await expect(page.getByRole('option').first()).toContainText('Start timer on Acme / App');
});

test('@mobile the quick-start row scrolls sideways instead of wrapping', async ({ page }) => {
  const many = Array.from({ length: 8 }, (_, i) => ({ id: `f${i}`, name: `Favourite number ${i}`, favorite: true }));
  await seed(page, backupJson(many));
  await page.goto('/#/dashboard');
  const list = page.locator('.quick__list');
  const box = (await list.boundingBox())!;
  expect(box.height).toBeLessThan(60);
  const last = page.locator('.quick__btn', { hasText: 'Favourite number 7' });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
});
