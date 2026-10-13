import fs from 'node:fs';
import { ACME, backupJson, expect, readStore, seed, test } from './fixtures';

test('export a backup and restore it into an empty browser profile', async ({ page, browser }) => {
  await seed(page, backupJson(ACME, [{ id: 'e1', nodeId: 'design', start: 1_000_000, end: 4_600_000, note: 'n' }]));
  await page.goto('/#/settings');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export backup/ }).click();
  const file = await (await download).path();
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(json).toMatchObject({ app: 'worktracklite', formatVersion: 2 });
  expect(json.nodes).toHaveLength(4);
  expect(json.entries).toHaveLength(1);
  await expect(page.getByText(/Last backup: (?!never)/)).toBeVisible();

  const fresh = await browser.newContext({ timezoneId: 'Europe/Zurich', serviceWorkers: 'block' });
  const page2 = await fresh.newPage();
  await seed(page2, fs.readFileSync(file, 'utf8'));
  await page2.goto('/#/manage/design');
  await expect(page2.getByRole('cell', { name: 'n', exact: true })).toBeVisible();
  await fresh.close();
});

test('restoring over existing data asks for confirmation', async ({ page }) => {
  await seed(page, backupJson(ACME));
  await page.goto('/#/settings');
  await page
    .getByText('Restore from backup…')
    .locator('input[type=file]')
    .setInputFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(backupJson([{ id: 'solo', name: 'Solo' }])) });
  await expect(page.getByRole('alertdialog')).toContainText('1 nodes, 0 entries');
  await page.getByRole('button', { name: 'Replace my data' }).click();
  await expect.poll(async () => (await readStore(page, 'nodes')).length).toBe(1);
});

test('invalid backups are rejected with a reason and change nothing', async ({ page }) => {
  await seed(page, backupJson(ACME));
  await page.goto('/#/settings');
  const bad = backupJson([{ id: 'a', name: 'A', parentId: 'missing' }]);
  await page
    .getByText('Restore from backup…')
    .locator('input[type=file]')
    .setInputFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(bad) });
  await expect(page.getByText('Node "A" refers to a missing parent.')).toBeVisible();
  expect(await readStore(page, 'nodes')).toHaveLength(4);
});

test('older v1 backups are migrated on import', async ({ page }) => {
  const v1 = backupJson([{ id: 'a', name: 'Legacy', budget: { type: 'per_hour' as never, seconds: 3600 } }], [], { formatVersion: 1 });
  await seed(page, v1);
  const [node] = await readStore<{ budget: { type: string } }>(page, 'nodes');
  expect(node.budget.type).toBe('target');
});
