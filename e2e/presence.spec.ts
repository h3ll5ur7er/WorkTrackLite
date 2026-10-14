import { ACME, backupJson, expect, seed, test } from './fixtures';

const withLastNode = (id: string) => ({ settings: { id: 'app', theme: 'dark', weekStartsOn: 1, templateId: 'dev', lastNodeId: id } });

test('the tab title shows the running timer', async ({ page }) => {
  await seed(page, backupJson(ACME));
  await expect(page).toHaveTitle('Dashboard · WorkTrackLite');
  await page.getByRole('button', { name: 'Start timer on Design' }).click();
  await expect(page).toHaveTitle(/^▶ 0:00:0\d Design · Dashboard · WorkTrackLite$/);
  await page
    .getByRole('link', { name: /Schedule/ })
    .first()
    .click();
  await expect(page).toHaveTitle(/^▶ 0:00:\d\d Design · Schedule · WorkTrackLite$/);
  await page.getByRole('button', { name: '■ Stop' }).click();
  await expect(page).toHaveTitle('Schedule · WorkTrackLite');
});

test('the installed app icon gets a badge while a timer runs', async ({ page }) => {
  await page.addInitScript(() => {
    const calls: string[] = [];
    (window as unknown as { badgeCalls: string[] }).badgeCalls = calls;
    Object.assign(navigator, {
      setAppBadge: async () => void calls.push('set'),
      clearAppBadge: async () => void calls.push('clear'),
    });
  });
  await seed(page, backupJson(ACME));
  const last = () => page.evaluate(() => (window as unknown as { badgeCalls: string[] }).badgeCalls.at(-1));
  await expect.poll(last).toBe('clear');
  await page.getByRole('button', { name: 'Start timer on App' }).click();
  await expect.poll(last).toBe('set');
  await page.getByRole('button', { name: '■ Stop' }).click();
  await expect.poll(last).toBe('clear');
});

test('app-icon shortcuts resume and stop the timer', async ({ page }) => {
  await seed(page, backupJson(ACME, [], withLastNode('app')));
  await page.goto('/#/action/resume');
  await expect(page).toHaveURL(/#\/dashboard$/);
  await expect(page.getByText('Resumed App')).toBeVisible();
  await expect(page.locator('.bar__name')).toHaveText('App');

  await page.goto('/#/action/stop');
  await expect(page).toHaveURL(/#\/dashboard$/);
  await expect(page.getByText('Timer stopped')).toBeVisible();
  await expect(page.getByText('No active timer')).toBeVisible();
});

test('the manifest declares the shortcuts', async ({ request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.shortcuts.map((s: { url: string }) => s.url)).toEqual(['./#/action/resume', './#/action/stop', './#/schedule']);
});
