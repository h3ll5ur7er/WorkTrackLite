import { ACME, H, backupJson, expect, readStore, seed, test, zurich } from './fixtures';

interface Entry {
  id: string;
  end: number | null;
  note?: string;
  tags?: string[];
}

const NOW = zurich('2026-10-21T15:00');

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(NOW));
  await seed(page, backupJson(ACME, [{ id: 'run', nodeId: 'design', start: NOW - H, end: null }]));
  await page.goto('/#/dashboard');
});

test('add a note and tags to the running timer from the timer bar', async ({ page }) => {
  await page.getByRole('button', { name: 'Add a note' }).click();
  // The note field has focus right away: type without clicking.
  await page.keyboard.type('Login page review');
  await page.getByLabel('Tags (comma separated)').fill('review, client');
  await page.getByRole('button', { name: 'Done' }).click();

  await expect(page.getByRole('form', { name: 'Note for the running timer' })).toHaveCount(0);
  const btn = page.getByRole('button', { name: 'Edit note: Login page review' });
  await expect(btn).toContainText('#review');
  await expect(btn).toBeFocused();
  await expect
    .poll(async () => (await readStore<Entry>(page, 'entries'))[0])
    .toMatchObject({
      end: null,
      note: 'Login page review',
      tags: ['review', 'client'],
    });

  // Stopping keeps the note on the entry.
  await page.locator('.bar').getByRole('button', { name: /Stop/ }).click();
  await expect.poll(async () => (await readStore<Entry>(page, 'entries'))[0].end).not.toBeNull();
  expect((await readStore<Entry>(page, 'entries'))[0].note).toBe('Login page review');
});

test('Enter saves, Escape cancels, and clearing removes the note', async ({ page }) => {
  await page.getByRole('button', { name: 'Add a note' }).click();
  await page.keyboard.type('first');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Edit note: first' })).toBeVisible();

  await page.getByRole('button', { name: 'Edit note: first' }).click();
  // The existing note is selected, so typing replaces it.
  await page.keyboard.type('discarded');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Edit note: first' })).toBeFocused();
  expect((await readStore<Entry>(page, 'entries'))[0].note).toBe('first');

  await page.getByRole('button', { name: 'Edit note: first' }).click();
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Add a note' })).toBeVisible();
  await expect.poll(async () => (await readStore<Entry>(page, 'entries'))[0].note).toBeUndefined();
});

test('@mobile the note form fits above the bottom navigation', async ({ page }) => {
  await page.getByRole('button', { name: 'Add a note' }).click();
  const done = page.getByRole('button', { name: 'Done' });
  await expect(done).toBeInViewport();
  // The restore toast is still up; it must not sit on the form.
  const [d, t] = [await done.boundingBox(), await page.locator('.toast').first().boundingBox()];
  expect(t!.y + t!.height <= d!.y || t!.y >= d!.y + d!.height).toBe(true);
  // The node name is not squeezed away by the note preview.
  expect((await page.locator('.bar__name').boundingBox())!.width).toBeGreaterThan(40);
  await page.keyboard.type('on the train');
  await done.click();
  await expect(page.getByRole('button', { name: 'Edit note: on the train' })).toBeVisible();
});
