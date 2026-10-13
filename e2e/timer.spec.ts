import { ACME, backupJson, expect, readStore, seed, test } from './fixtures';

interface Entry {
  id: string;
  nodeId: string;
  end: number | null;
}

test.beforeEach(async ({ page }) => {
  await seed(page, backupJson(ACME));
});

test('regression: double-clicking a dashboard card starts exactly one timer', async ({ page }) => {
  await page.getByRole('button', { name: 'Start timer on Design' }).dblclick();
  await expect(page.getByRole('button', { name: 'Stop timer on Design' })).toBeVisible();
  const entries = await readStore<Entry>(page, 'entries');
  expect(entries.filter((e) => e.end === null)).toHaveLength(1);
});

test('start, switch and stop timers from the dashboard; undo reverts', async ({ page }) => {
  await page.getByRole('button', { name: 'Start timer on Design' }).click();
  await expect(page.locator('.bar__name')).toHaveText('Design');

  await page.getByRole('button', { name: 'Start timer on App' }).click();
  await expect(page.locator('.bar__name')).toHaveText('App');
  let entries = await readStore<Entry>(page, 'entries');
  expect(entries.filter((e) => e.end === null).map((e) => e.nodeId)).toEqual(['app']);

  // Undo the switch: Design runs again, App's entry is gone.
  await page.getByRole('button', { name: 'Undo' }).last().click();
  await expect(page.locator('.bar__name')).toHaveText('Design');
  entries = await readStore<Entry>(page, 'entries');
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ nodeId: 'design', end: null });

  await page.getByRole('button', { name: '■ Stop' }).click();
  await expect(page.getByText('No active timer')).toBeVisible();
  await expect(page.getByRole('button', { name: /Resume Design/ })).toBeVisible();
});

test('keyboard: cards are focusable buttons', async ({ page }) => {
  const card = page.getByRole('button', { name: 'Start timer on App' });
  await card.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Stop timer on App' })).toBeFocused();
});

test('timer from the node page and manual entries', async ({ page }) => {
  await page.goto('/#/manage/design');
  await page.getByRole('button', { name: '▶ Start' }).click();
  await expect(page.getByText('running…')).toBeVisible();
  await page.getByRole('button', { name: '■ Stop' }).first().click();
  await expect(page.getByText('running…')).toBeHidden();

  await page.getByRole('button', { name: '+ Log time' }).click();
  const dialog = page.getByRole('dialog', { name: 'New time entry' });
  await dialog.getByLabel('Duration (h)').fill('2');
  await dialog.getByLabel('Duration (h)').blur();
  await dialog.getByLabel('Note').fill('Workshop');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Entries (2)' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Workshop' })).toBeVisible();
});
