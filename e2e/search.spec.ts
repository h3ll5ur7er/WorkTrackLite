import { ACME, backupJson, expect, seed, test, zurich } from './fixtures';

const entries = [
  {
    id: 'old',
    nodeId: 'design',
    start: zurich('2026-09-02T09:00'),
    end: zurich('2026-09-02T11:00'),
    note: 'Login page review',
    tags: ['review'],
  },
  { id: 'mid', nodeId: 'app', start: zurich('2026-10-06T13:00'), end: zurich('2026-10-06T14:30'), note: 'Café meeting about the login' },
  { id: 'new', nodeId: 'app', start: zurich('2026-10-20T08:00'), end: zurich('2026-10-20T09:00'), note: 'Release notes' },
];

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(zurich('2026-10-21T15:00')));
  await seed(page, backupJson(ACME, entries));
});

test('search all entries from the header; open a result in the schedule', async ({ page }) => {
  await page.getByRole('link', { name: 'Search entries' }).click();
  await expect(page).toHaveURL(/#\/search$/);
  // The search box has focus right away.
  await page.keyboard.type('login');
  await expect(page.getByTestId('search-summary')).toHaveText('2 entries · 3:30');
  const results = page.getByRole('list', { name: 'Results' }).getByRole('link');
  await expect(results).toHaveCount(2);
  await expect(results.first()).toContainText('Café meeting about the login');
  await expect(results.first().locator('mark')).toHaveText(['login']);
  await expect(page).toHaveURL(/q=login/);

  // Accents and #tags.
  await page.getByLabel('Search notes, tags and nodes').fill('cafe');
  await expect(results).toHaveCount(1);
  await page.getByLabel('Search notes, tags and nodes').fill('#review');
  await expect(results).toHaveCount(1);
  await expect(results.first()).toContainText('Login page review');

  // Open it: the schedule shows that week, the entry is highlighted and focused.
  await results.first().click();
  await expect(page).toHaveURL(/#\/schedule\?at=\d+&entry=old/);
  await expect(page.getByTestId('week-label')).toHaveText('Mon, 8/31 – Sun, 9/6');
  const block = page.locator('[data-entry-id="old"]');
  await expect(block).toHaveClass(/block--found/);
  await expect(block).toBeFocused();
  await expect(block).toBeInViewport();

  // Back returns to the search with its query.
  await page.goBack();
  await expect(page.getByLabel('Search notes, tags and nodes')).toHaveValue('#review');
});

test('the command palette offers a search for what was typed', async ({ page }) => {
  await page.goto('/#/dashboard');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('release');
  await page.getByRole('option', { name: /Search entries for “release”/ }).click();
  await expect(page).toHaveURL(/#\/search\?q=release$/);
  await expect(page.getByRole('list', { name: 'Results' }).getByRole('link')).toHaveCount(1);
});

test('@mobile results stack and stay inside the screen', async ({ page }) => {
  await page.goto('/#/search?q=app');
  const hits = page.getByRole('list', { name: 'Results' }).getByRole('link');
  await expect(hits).toHaveCount(2);
  const box = (await hits.first().boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await hits.first().tap();
  await expect(page.locator('[data-entry-id="new"]')).toBeInViewport();
});
