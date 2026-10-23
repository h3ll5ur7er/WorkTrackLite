import fs from 'node:fs';
import { ACME, backupJson, expect, readStore, seed, test } from './fixtures';

const PASSWORD = 'correct horse battery staple';

test('export an encrypted backup and restore it with the password on a fresh profile', async ({ page, browser }) => {
  await seed(page, backupJson(ACME, [{ id: 'e1', nodeId: 'design', start: 1_000_000, end: 4_600_000, note: 'secret note' }]));
  await page.goto('/#/settings');
  await page.getByLabel('Protect the backup with a password').check();
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Repeat password').fill('typo');
  await page.getByRole('button', { name: 'Export encrypted backup (JSON)' }).click();
  await expect(page.getByText('The passwords do not match.')).toBeVisible();

  await page.getByLabel('Repeat password').fill(PASSWORD);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export encrypted backup (JSON)' }).click();
  const dl = await download;
  expect(dl.suggestedFilename()).toMatch(/^where-time-flew-backup-\d{4}-\d\d-\d\d\.encrypted\.json$/);
  const text = fs.readFileSync(await dl.path(), 'utf8');
  expect(JSON.parse(text)).toMatchObject({ app: 'where-time-flew', encrypted: 1, kdf: { name: 'PBKDF2', iterations: 600_000 } });
  expect(text).not.toContain('Acme');
  expect(text).not.toContain('secret note');

  // A fresh browser profile restores it from the first-run screen.
  const fresh = await browser.newContext({ timezoneId: 'Europe/Zurich', serviceWorkers: 'block' });
  const page2 = await fresh.newPage();
  await page2.goto('/');
  await page2
    .getByText('Restore a backup…')
    .locator('input[type=file]')
    .setInputFiles({ name: dl.suggestedFilename(), mimeType: 'application/json', buffer: Buffer.from(text) });
  const field = page2.getByLabel('Backup password');
  // The prompt takes focus, so typing right away works.
  await expect(field).toBeFocused();
  await page2.keyboard.type('wrong');
  await page2.keyboard.press('Enter');
  await expect(page2.getByRole('alert')).toHaveText('Wrong password, or the file is damaged.');
  expect(await readStore(page2, 'nodes')).toHaveLength(0);

  await field.fill(PASSWORD);
  await page2.getByRole('button', { name: 'Unlock' }).click();
  await expect(page2.getByText('Restored 4 nodes and 1 entries.')).toBeVisible();
  await page2.goto('/#/manage/design');
  await expect(page2.getByRole('cell', { name: 'secret note', exact: true })).toBeVisible();
  await fresh.close();
});

test('restoring an encrypted backup over existing data still asks for confirmation', async ({ page }) => {
  await seed(page, backupJson(ACME));
  await page.goto('/#/settings');
  await page.getByLabel('Protect the backup with a password').check();
  await page.getByLabel('Password', { exact: true }).fill('pw');
  await page.getByLabel('Repeat password').fill('pw');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export encrypted backup (JSON)' }).click();
  const text = fs.readFileSync(await (await download).path(), 'utf8');

  await page
    .getByText('Restore from backup…')
    .locator('input[type=file]')
    .setInputFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await page.getByLabel('Backup password').fill('pw');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('4 nodes, 0 entries');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});
