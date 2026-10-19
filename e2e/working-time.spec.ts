import { ACME, backupJson, expect, seed, test, zurich } from './fixtures';

const NOW = zurich('2026-10-21T18:00'); // Wednesday
const nodes = [...ACME, { id: 'gym', name: 'Gym', kind: 'Personal', work: false }];
const entries = [
  { id: 'mon', nodeId: 'design', start: zurich('2026-10-19T08:00'), end: zurich('2026-10-19T17:00') }, // 9 h
  { id: 'tue', nodeId: 'app', start: zurich('2026-10-20T08:00'), end: zurich('2026-10-20T15:00') }, // 7 h
  { id: 'gym', nodeId: 'gym', start: zurich('2026-10-20T18:00'), end: zurich('2026-10-20T20:00') }, // not work
  { id: 'wed', nodeId: 'design', start: zurich('2026-10-21T08:00'), end: zurich('2026-10-21T11:00') }, // 3 h
];
const settings = (extra: Record<string, unknown> = {}) => ({
  settings: { id: 'app', theme: 'dark', weekStartsOn: 1, templateId: 'dev', idleGuard: false, ...extra },
});

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(NOW));
});

test('turn on working time, set the hours, and see today, the week and the balance', async ({ page }) => {
  await seed(page, backupJson(nodes, entries, settings()));
  await page.goto('/#/dashboard');
  await expect(page.getByTestId('work-today')).toHaveCount(0);

  await page.goto('/#/settings');
  await page.getByLabel('Track working hours and an overtime balance').check();
  const days = page.getByRole('group', { name: 'Hours per day' });
  await expect(days.getByRole('spinbutton')).toHaveCount(7);
  await expect(days.getByLabel('Mon')).toHaveValue('8');
  await expect(days.getByLabel('Sun')).toHaveValue('0');
  await days.getByLabel('Fri').fill('4');
  await days.getByLabel('Fri').blur();
  await page.getByLabel('Count the balance from').fill('2026-10-19');
  await page.getByLabel('Count the balance from').blur();
  await page.getByLabel(/Starting balance/).fill('1.5');
  await page.getByLabel(/Starting balance/).blur();
  await expect(page.getByText('Weekly target 36:00')).toBeVisible();

  await page.goto('/#/dashboard');
  await expect(page.getByTestId('work-today')).toHaveText('3:00 of 8:00');
  await expect(page.getByTestId('work-week')).toHaveText('19:00 of 36:00');
  // Mon +1, Tue −1 (the gym does not count), plus 1:30 carried over; today is not in yet.
  await expect(page.getByTestId('work-balance')).toHaveText('+1:30');

  await page.goto('/#/schedule');
  await expect(page.getByTestId('day-hours-0')).toHaveText('9:00 / 8:00');
  await expect(page.getByTestId('day-hours-1')).toHaveText('7:00 / 8:00');
});

test('absences: a range skips days off, credits their hours, and can be removed', async ({ page }) => {
  await seed(page, backupJson(nodes, entries, settings({ workTime: { hours: [0, 8, 8, 8, 8, 8, 0], from: '2026-10-19' } })));
  await page.goto('/#/settings');
  const form = page.getByRole('form', { name: 'Add an absence' });
  await form.getByLabel('From').fill('2026-10-22');
  await form.getByLabel('To (inclusive)').fill('2026-10-26');
  await form.getByLabel('Kind').selectOption({ label: 'Vacation' });
  await form.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('Added 3 days of vacation')).toBeVisible();
  const list = page.getByRole('list', { name: 'Absences' });
  await expect(list.getByRole('listitem')).toHaveCount(3);

  await form.getByLabel('From').fill('2026-10-20');
  await form.getByLabel('Kind').selectOption({ label: 'Sick' });
  await form.getByLabel('Half day').check();
  await form.getByRole('button', { name: 'Add' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(4);
  await expect(list).toContainText('Sick (half day)');

  await page.goto('/#/dashboard');
  // Week target: Mon 8 + Tue 4 (half sick) + Wed 8; Thu and Fri on vacation.
  await expect(page.getByTestId('work-week')).toHaveText('19:00 of 20:00');
  // Mon +1, Tue 7 − 4 = +3.
  await expect(page.getByTestId('work-balance')).toHaveText('+4:00');

  await page.goto('/#/schedule');
  await expect(page.getByTestId('day-work-3')).toHaveText('Vacation');
  await expect(page.getByTestId('day-work-1')).toHaveText('Sick (½)');

  await page.goto('/#/settings');
  await list.getByRole('button', { name: /Remove absence on Thu/ }).click();
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await page.locator('.toast', { hasText: 'Removed the absence' }).getByRole('button', { name: 'Undo' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(4);
});

test('a node can be excluded from working time in Manage', async ({ page }) => {
  await seed(page, backupJson(ACME, entries.slice(0, 2), settings({ workTime: { hours: [0, 8, 8, 8, 8, 8, 0], from: '2026-10-19' } })));
  await page.goto('/#/dashboard');
  await expect(page.getByTestId('work-balance')).toHaveText('0:00');
  await page.goto('/#/manage/app');
  await page.getByLabel('Working time').selectOption({ label: 'Does not count (e.g. personal)' });
  await page.goto('/#/dashboard');
  await expect(page.getByTestId('work-balance')).toHaveText('-7:00');
});

test('@mobile the working-time panel fits on a phone', async ({ page }) => {
  await seed(page, backupJson(nodes, entries, settings({ workTime: { hours: [0, 8, 8, 8, 8, 8, 0], from: '2026-10-19' } })));
  await page.goto('/#/dashboard');
  for (const id of ['work-today', 'work-week', 'work-balance']) await expect(page.getByTestId(id)).toBeInViewport();
  const panel = (await page.locator('.ws').boundingBox())!;
  expect(panel.x + panel.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});
