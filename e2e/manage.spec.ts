import fs from 'node:fs';
import { ACME, H, backupJson, expect, readStore, seed, test } from './fixtures';

interface N {
  id: string;
  parentId: string | null;
  order: number;
  archived?: boolean;
  notes?: string;
  tags?: string[];
}

test.beforeEach(async ({ page }) => {
  await seed(page, backupJson(ACME, [{ id: 'e1', nodeId: 'design', start: 0, end: 2 * H }]));
});

test('archive hides a node everywhere but keeps its history; unarchive restores it', async ({ page }) => {
  await page.goto('/#/manage/app');
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByLabel('Hierarchy').getByRole('link', { name: /App/ })).toHaveCount(0);
  await page.getByLabel('Show archived').check();
  await expect(page.getByLabel('Hierarchy').getByRole('link', { name: /App/ })).toBeVisible();

  await page.goto('/#/dashboard');
  await expect(page.getByRole('heading', { name: /App/ })).toHaveCount(0);

  await page.goto('/#/manage/app');
  await page.getByRole('button', { name: 'Unarchive' }).click();
  await page.goto('/#/dashboard');
  await expect(page.getByRole('heading', { name: /App/ })).toBeVisible();
});

test('notes, tags, reorder and move are saved', async ({ page }) => {
  await page.goto('/#/manage/app');
  await page.getByLabel('Notes').fill('Mobile app for Acme');
  await page.getByLabel('Notes').blur();
  await page.getByLabel('Tags (comma separated)').fill('mobile, ios');
  await page.getByLabel('Tags (comma separated)').blur();
  await page.getByRole('button', { name: 'Move up' }).click();
  await expect(page.getByRole('button', { name: 'Move up' })).toBeDisabled();
  await page.getByLabel('Parent').selectOption({ label: 'Acme / Website' });

  await expect
    .poll(async () => (await readStore<N>(page, 'nodes')).find((n) => n.id === 'app'))
    .toMatchObject({ parentId: 'web', notes: 'Mobile app for Acme', tags: ['mobile', 'ios'] });
  await expect(page.locator('.nd__path')).toHaveText('Acme › Website');
  // A node cannot become its own descendant's child.
  await page.goto('/#/manage/web');
  await expect(page.getByLabel('Parent').locator('option', { hasText: 'Design' })).toHaveCount(0);
});

test('budgets cover the whole subtree, consistent with the dashboard', async ({ page }) => {
  await page.goto('/#/manage/web');
  await expect(page.locator('.report__row', { hasText: 'Tracked (incl. children)' })).toContainText('2:00:00');
  await expect(page.locator('.report__row', { hasText: 'Remaining' })).toContainText('8:00:00');
});

test('delete cascades and can be undone', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await page.goto('/#/manage/web');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page).toHaveURL(/#\/manage\/acme$/);
  expect((await readStore(page, 'entries')).length).toBe(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await readStore(page, 'nodes')).length).toBe(4);
  expect((await readStore(page, 'entries')).length).toBe(1);
});

test('CSV export neutralises formulas', async ({ page }) => {
  await page.goto('/#/manage/design');
  await page
    .getByRole('button', { name: '✎' })
    .or(page.getByRole('button', { name: 'Edit entry' }))
    .click();
  await page.getByRole('dialog').getByLabel('Note').fill('=1+1');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV (this)' }).click();
  const d = await download;
  expect(d.suggestedFilename()).toBe('worktracklite_Design_node.csv');
  const csv = fs.readFileSync(await d.path(), 'utf8');
  expect(csv).toContain(",'=1+1,");
});

test('command palette: navigate and start timers from the keyboard', async ({ page }) => {
  await page.goto('/#/dashboard');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('start app');
  await page.keyboard.press('Enter');
  await expect(page.locator('.bar__name')).toHaveText('App');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('go to settings');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/settings$/);
});
