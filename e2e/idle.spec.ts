import { ACME, H, backupJson, expect, readStore, seed, test, zurich } from './fixtures';

interface Entry {
  id: string;
  start: number;
  end: number | null;
}

test.describe('forgotten-timer guard', () => {
  test('after the laptop slept: remove the away time and keep timing', async ({ page }) => {
    const now = zurich('2026-10-20T14:00');
    await page.clock.setFixedTime(new Date(now));
    await seed(page, backupJson(ACME, [{ id: 'run', nodeId: 'design', start: now - 4 * H, end: null }]));
    // Simulate: the app was last alive two hours ago.
    await page.evaluate((t) => localStorage.setItem('worktracklite.lastSeen', String(t)), now - 2 * H);
    await page.reload();

    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Welcome back');
    await expect(dialog).toContainText('12:00–14:00 (2:00)');
    await dialog.getByRole('button', { name: 'Remove away time, keep timing' }).click();
    await expect(dialog).toHaveCount(0);

    const entries = (await readStore<Entry>(page, 'entries')).sort((a, b) => a.start - b.start);
    expect(entries.map((e) => [e.start, e.end])).toEqual([
      [now - 4 * H, now - 2 * H],
      [now, null],
    ]);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(async () => (await readStore<Entry>(page, 'entries')).map((e) => e.end)).toEqual([null]);
  });

  test('a timer left running overnight: stop it at a chosen time', async ({ page }) => {
    const now = zurich('2026-10-21T09:00');
    await page.clock.setFixedTime(new Date(now));
    const start = zurich('2026-10-20T16:00');
    await seed(page, backupJson(ACME, [{ id: 'run', nodeId: 'app', start, end: null }]));
    await page.reload(); // the guard checks when the app opens
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('running since yesterday');
    await dialog.getByLabel('Stop at').fill('2026-10-20T18:30');
    await dialog.getByLabel('Stop at').blur();
    await dialog.getByRole('button', { name: /^Stop at .*18:30$/ }).click();
    await expect.poll(async () => (await readStore<Entry>(page, 'entries'))[0].end).toBe(zurich('2026-10-20T18:30'));
    await expect(page.getByText('No active timer')).toBeVisible();
  });

  test('stays quiet for a normal session', async ({ page }) => {
    const now = zurich('2026-10-20T10:00');
    await page.clock.setFixedTime(new Date(now));
    await seed(page, backupJson(ACME, [{ id: 'run', nodeId: 'app', start: now - H, end: null }]));
    await page.reload();
    await expect(page.locator('.bar__name')).toHaveText('App');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });
});
