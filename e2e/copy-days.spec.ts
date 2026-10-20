import { ACME, backupJson, expect, readStore, seed, test, zurich } from './fixtures';

interface Entry {
  id: string;
  nodeId: string;
  start: number;
  end: number | null;
  note?: string;
}
const byStart = (es: Entry[]) => [...es].sort((a, b) => a.start - b.start);

test.beforeEach(async ({ page }) => {
  // Wednesday of the week with the autumn DST change (Sun 25 Oct 2026).
  await page.clock.setFixedTime(new Date(zurich('2026-10-21T18:00')));
});

test('copy last week into this week; running it again adds nothing; undo removes the copies', async ({ page }) => {
  await seed(
    page,
    backupJson(ACME, [
      { id: 'mon', nodeId: 'design', start: zurich('2026-10-12T09:00'), end: zurich('2026-10-12T12:00'), note: 'standup + design' },
      { id: 'sun', nodeId: 'app', start: zurich('2026-10-18T10:00'), end: zurich('2026-10-18T11:00') },
      { id: 'here', nodeId: 'app', start: zurich('2026-10-19T11:00'), end: zurich('2026-10-19T13:00') },
    ]),
  );
  await page.goto('/#/schedule');
  await page.getByRole('button', { name: 'More schedule actions' }).click();
  await page.getByRole('menuitem', { name: 'Copy from last week' }).click();
  await expect(page.getByText('Copied 2 entries from last week (1 overlaps existing entries)')).toBeVisible();

  const copies = byStart(await readStore<Entry>(page, 'entries')).filter((e) => !['mon', 'sun', 'here'].includes(e.id));
  // Sunday 10:00 stays 10:00 although that Sunday is the 25-hour DST day.
  expect(copies.map((e) => [e.nodeId, e.start, e.end, e.note])).toEqual([
    ['design', zurich('2026-10-19T09:00'), zurich('2026-10-19T12:00'), 'standup + design'],
    ['app', zurich('2026-10-25T10:00'), zurich('2026-10-25T11:00'), undefined],
  ]);

  await page.getByRole('button', { name: 'More schedule actions' }).click();
  await page.getByRole('menuitem', { name: 'Copy from last week' }).click();
  await expect(page.getByText('Nothing to copy from last week: those entries are already there.')).toBeVisible();

  await page.locator('.toast', { hasText: 'Copied 2 entries' }).getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await readStore<Entry>(page, 'entries')).length).toBe(3);
});

test('copy one day to the next day from its context menu', async ({ page }) => {
  await seed(
    page,
    backupJson(ACME, [
      { id: 'a', nodeId: 'design', start: zurich('2026-10-20T09:00'), end: zurich('2026-10-20T10:00') },
      { id: 'b', nodeId: 'app', start: zurich('2026-10-20T14:00'), end: zurich('2026-10-20T15:30') },
      { id: 'run', nodeId: 'app', start: zurich('2026-10-20T17:00'), end: null },
    ]),
  );
  await page.goto('/#/schedule');
  const tuesday = page.locator('.sched__col[data-day="1"]');
  const box = (await tuesday.boundingBox())!;
  // Right-click an empty spot (06:00) of Tuesday.
  await tuesday.click({ button: 'right', position: { x: box.width / 2, y: (box.height / 24) * 6 } });
  await page.getByRole('menuitem', { name: 'Copy this day to the next day' }).click();
  await expect(page.getByText('Copied 2 entries to the next day')).toBeVisible();
  const wed = (await readStore<Entry>(page, 'entries')).filter((e) => e.start >= zurich('2026-10-21T00:00'));
  expect(byStart(wed).map((e) => [e.nodeId, e.start, e.end])).toEqual([
    ['design', zurich('2026-10-21T09:00'), zurich('2026-10-21T10:00')],
    ['app', zurich('2026-10-21T14:00'), zurich('2026-10-21T15:30')],
  ]);
  // (The running timer since Tuesday 17:00 also reaches into Wednesday; it was not copied.)
  await expect(page.locator('.sched__col[data-day="2"] .block:not(.block--running)')).toHaveCount(2);
});

test('@mobile copy from last week works in the day view', async ({ page }) => {
  await seed(page, backupJson(ACME, [{ id: 'a', nodeId: 'design', start: zurich('2026-10-14T09:00'), end: zurich('2026-10-14T10:00') }]));
  await page.goto('/#/schedule');
  await page.getByRole('button', { name: 'More schedule actions' }).click();
  await page.getByRole('menuitem', { name: 'Copy from last week' }).click();
  await expect(page.getByText('Copied 1 entry from last week')).toBeVisible();
  await expect(page.locator('.block')).toHaveCount(1);
});
