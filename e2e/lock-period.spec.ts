import { ACME, backupJson, expect, readStore, seed, test, zurich } from './fixtures';

interface Entry {
  id: string;
  start: number;
  end: number | null;
  note?: string;
}

const NOW = zurich('2026-10-21T15:00'); // Wednesday
const entries = [
  { id: 'mon', nodeId: 'design', start: zurich('2026-10-19T09:00'), end: zurich('2026-10-19T11:00'), note: 'invoiced' },
  { id: 'wed', nodeId: 'design', start: zurich('2026-10-21T09:00'), end: zurich('2026-10-21T10:00') },
];

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(NOW));
});

test('lock a period in Settings; its entries become read-only everywhere; unlock again', async ({ page }) => {
  await seed(page, backupJson(ACME, entries));
  await page.goto('/#/settings');
  const form = page.getByRole('form', { name: 'Lock a period' });
  // Only past days can be picked (DataService refuses others too; see its unit tests).
  await expect(form.getByLabel('Lock everything up to and including')).toHaveAttribute('max', '2026-10-20');

  await form.getByLabel('Lock everything up to and including').fill('2026-10-20');
  await form.getByRole('button', { name: 'Lock', exact: true }).click();
  await expect(page.getByTestId('lock-state')).toContainText('October 20, 2026');

  // Schedule: Monday and Tuesday are marked; the Monday entry opens read-only and cannot be dragged.
  await page.goto('/#/schedule');
  await expect(page.locator('.sched__col--locked')).toHaveCount(2);
  const mon = page.locator('[data-entry-id="mon"]');
  const box = (await mon.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 10);
  await page.mouse.down();
  for (let i = 1; i <= 4; i++) await page.mouse.move(box.x + box.width / 2, box.y + 10 + i * 14);
  await page.mouse.up();
  const dialog = page.getByRole('dialog', { name: 'Time entry (locked)' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Note')).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Save' })).toHaveCount(0);
  const close = dialog.locator('.modal__footer').getByRole('button', { name: 'Close' });
  await expect(close).toBeFocused();
  await close.click();
  expect((await readStore<Entry>(page, 'entries')).find((e) => e.id === 'mon')!.start).toBe(entries[0].start);

  // The menu offers no editing; keyboard Delete explains instead of deleting.
  await mon.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: /Locked period/ })).toBeDisabled();
  await page.keyboard.press('Escape');
  await mon.focus();
  await page.keyboard.press('Delete');
  await expect(page.getByText('This entry is in a locked period.')).toBeVisible();
  expect(await readStore<Entry>(page, 'entries')).toHaveLength(2);

  // Unlocked days still work.
  await page.locator('[data-entry-id="wed"]').click();
  await expect(page.getByRole('dialog', { name: 'Edit time entry' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Manage shows a lock instead of edit/delete; deleting the node is refused.
  await page.goto('/#/manage/design');
  await expect(page.getByRole('button', { name: 'Edit entry' })).toHaveCount(1);
  await expect(page.locator('.entries').getByText('Locked')).toHaveCount(1);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText(/Archive the node instead/)).toBeVisible();
  expect(await readStore(page, 'nodes')).toHaveLength(4);

  // Unlock: editable again.
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.goto('/#/schedule');
  await expect(page.locator('.sched__col--locked')).toHaveCount(0);
  await page.locator('[data-entry-id="mon"]').click();
  await expect(page.getByRole('dialog', { name: 'Edit time entry' })).toBeVisible();
});

test('"Lock up to the end of last month", and copying into a locked day is refused', async ({ page }) => {
  await seed(page, backupJson(ACME, [{ id: 'sep', nodeId: 'app', start: zurich('2026-09-29T09:00'), end: zurich('2026-09-29T10:00') }]));
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Lock up to the end of last month' }).click();
  await expect(page.getByTestId('lock-state')).toContainText('September 30, 2026');

  // Sep 29 → Sep 30 (both locked): the copy is refused with the reason.
  await page.goto('/#/schedule');
  await page.getByRole('button', { name: 'Previous week' }).click();
  await page.getByRole('button', { name: 'Previous week' }).click();
  await page.getByRole('button', { name: 'Previous week' }).click();
  const tue = page.locator('.sched__col[data-day="1"]');
  await expect(tue.locator('.block')).toHaveCount(1);
  const b = (await tue.boundingBox())!;
  await tue.click({ button: 'right', position: { x: b.width / 2, y: (b.height / 24) * 3 } });
  await expect(page.getByRole('menuitem', { name: 'New entry here… (locked)' })).toBeDisabled();
  await page.getByRole('menuitem', { name: 'Copy this day to the next day' }).click();
  await expect(page.getByText(/are locked\. Unlock the period in Settings/)).toBeVisible();
  expect(await readStore(page, 'entries')).toHaveLength(1);
});
