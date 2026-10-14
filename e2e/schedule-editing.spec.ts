import { Page } from '@playwright/test';
import { ACME, H, backupJson, expect, readStore, seed, test, zurich } from './fixtures';

interface Entry {
  id: string;
  nodeId: string;
  start: number;
  end: number | null;
  note?: string;
}

const undo = (page: Page, message: string | RegExp) =>
  page.locator('.toast', { hasText: message }).getByRole('button', { name: 'Undo' }).click();
const byStart = (es: Entry[]) => [...es].sort((a, b) => a.start - b.start);
const ranges = async (page: Page) => byStart(await readStore<Entry>(page, 'entries')).map((e) => [e.nodeId, e.start, e.end]);

test.describe('schedule editing', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date(zurich('2026-10-20T18:00')));
  });

  test('split an entry where it was right-clicked; undo joins it again', async ({ page }) => {
    const start = zurich('2026-10-20T09:00');
    await seed(page, backupJson(ACME, [{ id: 'e1', nodeId: 'design', start, end: start + 2 * H, note: 'spec' }]));
    await page.goto('/#/schedule');
    const block = page.locator('[data-entry-id="e1"]');
    const box = (await block.boundingBox())!;
    // Halfway down a 09:00–11:00 block is 10:00.
    await block.click({ button: 'right', position: { x: box.width / 2, y: box.height / 2 } });
    await page.getByRole('menuitem', { name: 'Split at 10:00' }).click();

    await expect(page.locator('.block')).toHaveCount(2);
    const parts = byStart(await readStore<Entry>(page, 'entries'));
    expect(parts.map((e) => [e.start, e.end, e.note])).toEqual([
      [start, start + H, 'spec'],
      [start + H, start + 2 * H, 'spec'],
    ]);
    expect(parts[0].id).toBe('e1');

    await undo(page, 'Split at 10:00');
    await expect(page.locator('.block')).toHaveCount(1);
    expect(await ranges(page)).toEqual([['design', start, start + 2 * H]]);
  });

  test('keyboard: split in half from the menu', async ({ page }) => {
    const start = zurich('2026-10-20T09:00');
    await seed(page, backupJson(ACME, [{ id: 'e1', nodeId: 'design', start, end: start + 90 * 60_000 }]));
    await page.goto('/#/schedule');
    await page.locator('[data-entry-id="e1"]').focus();
    await page.keyboard.press('Shift+F10');
    await page.getByRole('menuitem', { name: 'Split in half' }).click();
    await expect(page.locator('.block')).toHaveCount(2);
    expect(await ranges(page)).toEqual([
      ['design', start, start + 45 * 60_000],
      ['design', start + 45 * 60_000, start + 90 * 60_000],
    ]);
  });

  test('merge with the next entry on the same node, including the short gap', async ({ page }) => {
    const nine = zurich('2026-10-20T09:00');
    await seed(
      page,
      backupJson(ACME, [
        { id: 'e1', nodeId: 'design', start: nine, end: nine + H, note: 'a' },
        { id: 'e2', nodeId: 'design', start: nine + H + 10 * 60_000, end: nine + 2 * H, note: 'b' },
        { id: 'other', nodeId: 'app', start: nine + 2 * H, end: nine + 3 * H },
      ]),
    );
    await page.goto('/#/schedule');
    await page.locator('[data-entry-id="e1"]').click({ button: 'right' });
    // Only same-node neighbours are offered.
    await expect(page.getByRole('menuitem', { name: 'Merge with previous' })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Merge with next' }).click();
    await expect(page.getByText('Merged 2 entries (adds 0:10 between them)')).toBeVisible();
    await expect(page.locator('.block')).toHaveCount(2);
    const merged = (await readStore<Entry>(page, 'entries')).find((e) => e.id === 'e1')!;
    expect([merged.start, merged.end, merged.note]).toEqual([nine, nine + 2 * H, 'a; b']);

    await undo(page, 'Merged 2 entries');
    await expect(page.locator('.block')).toHaveCount(3);
  });

  test('select several entries, move them to another node, drag them together, delete them', async ({ page }) => {
    const tue = zurich('2026-10-20T09:00');
    const wed = zurich('2026-10-21T09:00');
    await seed(
      page,
      backupJson(ACME, [
        { id: 'e1', nodeId: 'design', start: tue, end: tue + H },
        { id: 'e2', nodeId: 'design', start: wed, end: wed + H },
        { id: 'keep', nodeId: 'design', start: tue + 4 * H, end: tue + 5 * H },
      ]),
    );
    await page.goto('/#/schedule');
    const e1 = page.locator('[data-entry-id="e1"]');
    const e2 = page.locator('[data-entry-id="e2"]');

    // Ctrl-click starts a selection; after that a plain click adds to it (no editor).
    await e1.click({ modifiers: ['Control'] });
    await e2.click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const toolbar = page.getByRole('toolbar', { name: 'Selected entries' });
    await expect(toolbar.getByTestId('selection-count')).toHaveText('2 selected · 2:00');
    await expect(e1).toHaveAttribute('aria-pressed', 'true');

    // Reassign both to App, then undo.
    await toolbar.getByLabel('Move selected entries to').selectOption({ label: 'Acme / App' });
    await expect
      .poll(() => ranges(page))
      .toEqual([
        ['app', tue, tue + H],
        ['design', tue + 4 * H, tue + 5 * H],
        ['app', wed, wed + H],
      ]);
    await undo(page, 'Moved 2 entries to App');
    await expect.poll(async () => (await readStore<Entry>(page, 'entries')).every((e) => e.nodeId === 'design')).toBe(true);

    // Dragging one selected block moves the whole selection by the same amount.
    const box = (await e1.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 10);
    await page.mouse.down();
    for (let i = 1; i <= 4; i++) await page.mouse.move(box.x + box.width / 2, box.y + 10 + i * 14);
    await page.mouse.up();
    await expect(page.getByText('Moved 2 entries')).toBeVisible();
    await expect
      .poll(() => ranges(page))
      .toEqual([
        ['design', tue + H, tue + 2 * H],
        ['design', tue + 4 * H, tue + 5 * H],
        ['design', wed + H, wed + 2 * H],
      ]);
    // The drag did not toggle the selection.
    await expect(toolbar.getByTestId('selection-count')).toHaveText('2 selected · 2:00');

    // Merging entries on different days is refused with a reason.
    await toolbar.getByRole('button', { name: 'Merge' }).click();
    await expect(page.getByText('Entries are too far apart to merge.')).toBeVisible();

    await toolbar.getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('.block')).toHaveCount(1);
    await expect(toolbar).toHaveCount(0);
    await undo(page, 'Deleted 2 entries');
    await expect(page.locator('.block')).toHaveCount(3);
  });

  test('Escape clears the selection; running timers cannot be selected', async ({ page }) => {
    const nine = zurich('2026-10-20T09:00');
    await seed(
      page,
      backupJson(ACME, [
        { id: 'e1', nodeId: 'design', start: nine, end: nine + H },
        { id: 'run', nodeId: 'app', start: zurich('2026-10-20T17:00'), end: null },
      ]),
    );
    await page.goto('/#/schedule');
    await page.locator('[data-entry-id="run"]').click({ modifiers: ['Control'] });
    // A running block opens its menu instead.
    await expect(page.getByRole('menuitem', { name: 'Stop timer' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('toolbar', { name: 'Selected entries' })).toHaveCount(0);

    await page.locator('[data-entry-id="e1"]').click({ modifiers: ['Control'] });
    await expect(page.getByRole('toolbar', { name: 'Selected entries' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('toolbar', { name: 'Selected entries' })).toHaveCount(0);
  });

  test('@mobile select from the long-press menu, then tap to add more', async ({ page }) => {
    const nine = zurich('2026-10-20T09:00');
    await seed(
      page,
      backupJson(ACME, [
        { id: 'e1', nodeId: 'design', start: nine, end: nine + H },
        { id: 'e2', nodeId: 'design', start: nine + H, end: nine + 2 * H },
      ]),
    );
    await page.goto('/#/schedule');
    const box = (await page.locator('[data-entry-id="e1"]').boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await page.waitForTimeout(700);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.getByRole('menuitem', { name: 'Select' }).click();
    await page.locator('[data-entry-id="e2"]').tap();
    await expect(page.getByTestId('selection-count')).toHaveText('2 selected · 2:00');
    await page.getByRole('button', { name: 'Merge' }).click();
    await expect(page.getByText(/Merged 2 entries/)).toBeVisible();
    await expect(page.locator('.block')).toHaveCount(1);
  });
});
