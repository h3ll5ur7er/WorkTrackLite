import { Page } from '@playwright/test';
import { H, backupJson, expect, readStore, seed, test, zurich } from './fixtures';

const NOW = zurich('2026-10-21T15:00');
const MIN = 60_000;
// These tests are about budgets, not the forgotten-timer question (clock jumps look like an away gap).
const SETTINGS = { settings: { id: 'app', theme: 'dark', weekStartsOn: 1, templateId: 'dev', idleGuard: false } };
const nodes = [
  { id: 'web', name: 'Website', kind: 'Project', budget: { type: 'fixed' as const, seconds: 10 * 3600, softLimit: 8 * 3600 } },
  { id: 'misc', name: 'Misc', kind: 'Project' },
];

test('a running timer crossing the warning threshold, then the budget, alerts once each', async ({ page }) => {
  await page.clock.install({ time: new Date(NOW) });
  // 7:58 tracked, plus a timer that started 0 minutes ago.
  await seed(
    page,
    backupJson(
      nodes,
      [
        { id: 'old', nodeId: 'web', start: NOW - 2 * 24 * H, end: NOW - 2 * 24 * H + 7 * H + 58 * MIN },
        { id: 'run', nodeId: 'web', start: NOW, end: null },
      ],
      SETTINGS,
    ),
  );
  await page.goto('/#/dashboard');
  await expect(page.locator('.toast', { hasText: 'warning threshold' })).toHaveCount(0);

  // Toasts last 10 s, so step just past each crossing (checks run at minute resolution).
  await page.clock.runFor(2 * MIN + 2000); // 8:00 tracked
  const soft = page.locator('.toast', { hasText: 'Website reached its warning threshold' });
  await expect(soft).toBeVisible();

  // "Open" jumps to the node.
  await soft.getByRole('button', { name: 'Open' }).click();
  await expect(page).toHaveURL(/#\/manage\/web$/);

  // The next minute stays quiet: still only "soft".
  await page.clock.runFor(MIN);
  await expect(page.locator('.toast', { hasText: 'warning threshold' })).toHaveCount(0);

  // fastForward jumps without running every 1 s tick on the way (runFor would take minutes).
  await page.clock.fastForward(2 * H); // past 10:00 tracked: over the 10 h budget
  await page.clock.runFor(1500);
  await expect(page.locator('.toast', { hasText: /^Website is over its budget \(10:0\d of 10:00\)/ })).toBeVisible();

  // A reload does not repeat what was already announced.
  await page.reload();
  await page.clock.runFor(1500);
  await expect(page.locator('.toast', { hasText: /over its budget|warning threshold/ })).toHaveCount(0);
});

/**
 * A stand-in for the browser's Notification API that answers the permission
 * prompt with `answer`. Real headless browsers differ (CI's reports "denied"
 * even after grantPermissions), so the tests decide the answer themselves.
 */
async function fakeNotifications(page: Page, answer: NotificationPermission): Promise<void> {
  await page.addInitScript((a) => {
    class FakeNotification {
      static permission: NotificationPermission = 'default';
      static async requestPermission(): Promise<NotificationPermission> {
        FakeNotification.permission = a;
        return a;
      }
    }
    Object.defineProperty(window, 'Notification', { value: FakeNotification, configurable: true, writable: true });
  }, answer);
}

test('alerts can be turned off', async ({ page }) => {
  await page.clock.install({ time: new Date(NOW) });
  await seed(page, backupJson(nodes, [{ id: 'run', nodeId: 'web', start: NOW - 7 * H - 59 * MIN, end: null }], SETTINGS));
  await page.goto('/#/settings');
  await page.getByLabel(/Tell me when a node reaches its warning threshold/).uncheck();
  await page.clock.runFor(MIN + 2000);
  await expect(page.locator('.toast', { hasText: 'warning threshold' })).toHaveCount(0);
});

test('system notifications ask for permission and stay on when it is granted', async ({ page }) => {
  await fakeNotifications(page, 'granted');
  await seed(page, backupJson(nodes, [], SETTINGS));
  await page.goto('/#/settings');
  const system = page.getByLabel(/Also as a system notification/);
  await system.check();
  await expect(system).toBeChecked();
  await expect.poll(async () => (await readStore<{ budgetNotifications?: boolean }>(page, 'settings'))[0].budgetNotifications).toBe(true);
});

test('regression: a refused permission leaves system notifications off and says so', async ({ page }) => {
  await fakeNotifications(page, 'denied');
  await seed(page, backupJson(nodes, [], SETTINGS));
  await page.goto('/#/settings');
  const system = page.getByLabel(/Also as a system notification/);
  await system.click();
  await expect(page.getByText('Notifications were not allowed; alerts stay in the app.')).toBeVisible();
  await expect(system).not.toBeChecked();
  await expect(page.getByText(/Notifications are blocked for this site/)).toBeVisible();
  expect((await readStore<{ budgetNotifications?: boolean }>(page, 'settings'))[0].budgetNotifications).toBeFalsy();
});
