import { H, backupJson, expect, seed, test, zurich } from './fixtures';

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

test('alerts can be turned off; system notifications ask for permission', async ({ page, context }) => {
  await page.clock.install({ time: new Date(NOW) });
  await seed(page, backupJson(nodes, [{ id: 'run', nodeId: 'web', start: NOW - 7 * H - 59 * MIN, end: null }], SETTINGS));
  await page.goto('/#/settings');
  await page.getByLabel(/Tell me when a node reaches its warning threshold/).uncheck();
  await page.clock.runFor(MIN + 2000);
  await expect(page.locator('.toast', { hasText: 'warning threshold' })).toHaveCount(0);

  await page.getByLabel(/Tell me when a node reaches/).check();
  await context.grantPermissions(['notifications']);
  const system = page.getByLabel(/Also as a system notification/);
  await system.check();
  await expect(system).toBeChecked();
});
