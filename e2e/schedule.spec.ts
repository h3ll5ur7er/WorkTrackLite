import { ACME, H, backupJson, expect, readStore, seed, test, zurich } from './fixtures';

interface Entry {
  id: string;
  start: number;
  end: number | null;
}

test.describe('schedule', () => {
  test.beforeEach(async ({ page }) => {
    // Tuesday before the autumn DST change (Sun 2026-10-25 in Europe/Zurich).
    await page.clock.setFixedTime(new Date(zurich('2026-10-20T10:00')));
  });

  test('regression: week navigation steps across the DST change', async ({ page }) => {
    await seed(page, backupJson(ACME), '/#/schedule');
    await page.goto('/#/schedule');
    const label = page.getByTestId('week-label');
    await expect(label).toHaveText('Mon, 10/19 – Sun, 10/25');
    await page.getByRole('button', { name: 'Next week' }).click();
    await expect(label).toHaveText('Mon, 10/26 – Sun, 11/1');
    await page.getByRole('button', { name: 'Next week' }).click();
    await expect(label).toHaveText('Mon, 11/2 – Sun, 11/8');
    await page.getByRole('button', { name: 'Previous week' }).click();
    await page.getByRole('button', { name: 'Previous week' }).click();
    await expect(label).toHaveText('Mon, 10/19 – Sun, 10/25');
  });

  test('an entry on the 25-hour day lines up with the hour grid', async ({ page }) => {
    const start = zurich('2026-10-25T14:00');
    await seed(page, backupJson(ACME, [{ id: 'e1', nodeId: 'design', start, end: start + H }]));
    await page.goto('/#/schedule');
    const block = page.locator('[data-entry-id="e1"]');
    await expect(block).toContainText('14:00–15:00');
    const col = page.locator('.sched__col[data-day="6"]');
    const [b, c] = [await block.boundingBox(), await col.boundingBox()];
    expect(Math.round(((b!.y - c!.y) / c!.height) * 24 * 10) / 10).toBe(14);
  });

  test('regression: dragging a block moves it without errors or opening the editor', async ({ page }) => {
    const start = zurich('2026-10-20T09:00');
    await seed(page, backupJson(ACME, [{ id: 'e1', nodeId: 'design', start, end: start + H }]));
    await page.goto('/#/schedule');
    const block = page.locator('[data-entry-id="e1"]');
    const box = (await block.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // 56px per hour: move down 2h in small steps, then release immediately (no frame in between).
    for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + i * 14);
    await page.mouse.up();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(block).toContainText('11:00–12:00');
    const [e] = await readStore<Entry>(page, 'entries');
    expect(e.start).toBe(zurich('2026-10-20T11:00'));
    expect(e.end).toBe(zurich('2026-10-20T12:00'));

    // Undo from the toast puts it back.
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(block).toContainText('09:00–10:00');
  });

  test('resizing the end handle extends an entry', async ({ page }) => {
    const start = zurich('2026-10-21T13:00');
    await seed(page, backupJson(ACME, [{ id: 'e1', nodeId: 'app', start, end: start + H }]));
    await page.goto('/#/schedule');
    const handle = page.locator('[data-entry-id="e1"] .block__handle--bottom');
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 30, { steps: 5 });
    await page.mouse.move(box.x + box.width / 2, box.y + 30);
    await page.mouse.up();
    await expect(page.locator('[data-entry-id="e1"]')).toContainText('13:00–14:30');
  });

  test('click opens the editor; context menu copies and pastes', async ({ page }) => {
    const start = zurich('2026-10-20T09:00');
    await seed(page, backupJson(ACME, [{ id: 'e1', nodeId: 'design', start, end: start + H, note: 'kickoff' }]));
    await page.goto('/#/schedule');
    await page.locator('[data-entry-id="e1"]').click();
    const dialog = page.getByRole('dialog', { name: 'Edit time entry' });
    await expect(dialog.getByLabel('Note')).toHaveValue('kickoff');
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await page.locator('[data-entry-id="e1"]').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Copy' }).click();
    const thursday = page.locator('.sched__col[data-day="3"]');
    const box = (await thursday.boundingBox())!;
    await thursday.click({ button: 'right', position: { x: box.width / 2, y: (box.height / 24) * 15 } });
    await page.getByRole('menuitem', { name: /Paste Design/ }).click();
    await expect.poll(async () => (await readStore<Entry>(page, 'entries')).length).toBe(2);
    const pasted = (await readStore<Entry>(page, 'entries')).find((e) => e.id !== 'e1')!;
    expect(pasted.start).toBe(zurich('2026-10-22T15:00'));
  });

  test('keyboard: menu keys pressed immediately after opening are not lost', async ({ page }) => {
    const start = zurich('2026-10-20T09:00');
    await seed(page, backupJson(ACME, [{ id: 'e1', nodeId: 'design', start, end: start + H }]));
    await page.goto('/#/schedule');
    await page.locator('[data-entry-id="e1"]').focus();
    // No waiting between keys: Edit… → (ArrowDown) Duplicate → Enter.
    await page.keyboard.press('Shift+F10');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await readStore<Entry>(page, 'entries')).length).toBe(2);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('a running timer is drawn live up to now', async ({ page }) => {
    const start = zurich('2026-10-20T08:00');
    await seed(page, backupJson(ACME, [{ id: 'run', nodeId: 'app', start, end: null }]));
    await page.goto('/#/schedule');
    await expect(page.locator('[data-entry-id="run"]')).toContainText('08:00–10:00 · 2:00 · running');
  });
});
