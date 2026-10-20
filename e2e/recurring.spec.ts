import { ACME, backupJson, expect, readStore, seed, test, zurich } from './fixtures';

interface Entry {
  id: string;
  nodeId: string;
  start: number;
  end: number | null;
  note?: string;
}

const NOW = zurich('2026-10-19T18:00'); // Monday
const standup = { id: 'su', nodeId: 'design', start: zurich('2026-10-19T09:00'), end: zurich('2026-10-19T09:15'), note: 'standup' };

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(NOW));
});

test('repeat an entry every weekday, then add, skip and add-all its suggestions', async ({ page }) => {
  await seed(page, backupJson(ACME, [standup]));
  await page.goto('/#/schedule');
  await page.locator('[data-entry-id="su"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Repeat every weekday (Mon–Fri)' }).click();
  await expect(page.getByText(/Repeats Mon–Fri at 09:00/)).toBeVisible();

  // Monday is covered by the original entry; Tue–Fri are suggested.
  const suggested = page.locator('.suggest');
  await expect(suggested).toHaveCount(4);
  await page.locator('.sched__col[data-day="1"] .suggest').click();
  await page.getByRole('menuitem', { name: 'Add', exact: true }).click();
  await expect(suggested).toHaveCount(3);
  const added = (await readStore<Entry>(page, 'entries')).find((e) => e.id !== 'su')!;
  expect([added.nodeId, added.start, added.end, added.note]).toEqual([
    'design',
    zurich('2026-10-20T09:00'),
    zurich('2026-10-20T09:15'),
    'standup',
  ]);

  await page.locator('.sched__col[data-day="2"] .suggest').click();
  await page.getByRole('menuitem', { name: 'Skip this time' }).click();
  await expect(suggested).toHaveCount(2);

  await page.getByRole('button', { name: 'More schedule actions' }).click();
  await page.getByRole('menuitem', { name: 'Add all suggestions (2)' }).click();
  await expect(suggested).toHaveCount(0);
  await expect.poll(async () => (await readStore<Entry>(page, 'entries')).length).toBe(4);
  await page.locator('.toast', { hasText: 'Added 2 suggested entries' }).getByRole('button', { name: 'Undo' }).click();
  await expect(suggested).toHaveCount(2);

  // Settings lists the rule; pausing hides the suggestions.
  await page.goto('/#/settings');
  const list = page.getByRole('list', { name: 'Recurring entries' });
  await expect(list).toContainText('Mon–Fri 09:00, 0:15');
  await expect(list).toContainText('Acme / Website / Design · standup');
  await list.getByRole('button', { name: 'Pause' }).click();
  await page.goto('/#/schedule');
  await expect(page.locator('.block')).toHaveCount(2);
  await expect(suggested).toHaveCount(0);
});

test('add a rule in Settings; "Stop repeating" from a suggestion removes it', async ({ page }) => {
  await seed(page, backupJson(ACME));
  await page.goto('/#/settings');
  const form = page.getByRole('form', { name: 'Add a recurring entry' });
  await form.getByLabel('Node').selectOption({ label: 'Acme / App' });
  // Mon–Fri is preselected; add Saturday, drop Friday.
  await form.getByLabel('Sat').check();
  await form.getByLabel('Fri').uncheck();
  await form.getByLabel('Start').fill('13:30');
  await form.getByLabel('Minutes').fill('45');
  await form.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByRole('list', { name: 'Recurring entries' })).toContainText('Mon, Tue, Wed, Thu, Sat 13:30, 0:45');

  await page.goto('/#/schedule');
  // From today (Monday) on: Mon, Tue, Wed, Thu, Sat.
  await expect(page.locator('.suggest')).toHaveCount(5);
  await expect(page.locator('.sched__col[data-day="4"] .suggest')).toHaveCount(0);
  await page.locator('.suggest').first().click();
  await page.getByRole('menuitem', { name: 'Stop repeating' }).click();
  await expect(page.locator('.suggest')).toHaveCount(0);
  expect(((await readStore<{ recurring?: unknown[] }>(page, 'settings'))[0].recurring ?? []).length).toBe(0);
});

test('@mobile tap a suggestion to add it', async ({ page }) => {
  await seed(
    page,
    backupJson(ACME, [], {
      settings: {
        id: 'app',
        theme: 'dark',
        weekStartsOn: 1,
        templateId: 'dev',
        recurring: [{ id: 'r', nodeId: 'app', weekdays: [1], startMinutes: 600, minutes: 30, from: '2026-10-01' }],
      },
    }),
  );
  await page.goto('/#/schedule');
  await page.locator('.suggest').tap();
  await page.getByRole('menuitem', { name: 'Add', exact: true }).tap();
  await expect(page.locator('.block')).toHaveCount(1);
  await expect(page.locator('.suggest')).toHaveCount(0);
});

test('regression: a suggestion under another entry is still reachable from the day header', async ({ page }) => {
  await seed(
    page,
    backupJson(ACME, [{ id: 'busy', nodeId: 'app', start: zurich('2026-10-20T08:00'), end: zurich('2026-10-20T12:00') }], {
      settings: {
        id: 'app',
        theme: 'dark',
        weekStartsOn: 1,
        templateId: 'dev',
        recurring: [{ id: 'r', nodeId: 'design', weekdays: [2], startMinutes: 540, minutes: 15, from: '2026-10-01', note: 'standup' }],
      },
    }),
  );
  await page.goto('/#/schedule');
  // Not drawn under the 08:00–12:00 block, where nobody could click it...
  await expect(page.locator('.suggest')).toHaveCount(0);
  // ...but listed in Tuesday's header.
  await page.getByTestId('day-suggested-1').click();
  await page.getByRole('menuitem', { name: /^Add Design 09:00–09:15/ }).click();
  await expect.poll(async () => (await readStore<Entry>(page, 'entries')).length).toBe(2);
  await expect(page.getByTestId('day-suggested-1')).toHaveCount(0);
});
