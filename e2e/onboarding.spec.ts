import { expect, test } from './fixtures';

test('first run: pick a template, create the first node, build a hierarchy', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to Where Time Flew' })).toBeVisible();
  await page.getByLabel(/Consulting/).check();
  await page.getByLabel(/First account name/i).fill('Globex');
  await page.getByRole('button', { name: 'Get started' }).click();

  await expect(page).toHaveURL(/#\/manage\/[\w-]+$/);
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Globex');

  // Kind suggestions follow the template: Account → Engagement.
  await expect(page.getByLabel('Child kind')).toHaveAttribute('placeholder', 'Kind (Engagement)');
  await page.getByLabel('Child name').fill('Audit 2026');
  await page.getByRole('button', { name: '+ Add' }).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Audit 2026');
  await expect(page.locator('.nd__path')).toHaveText('Globex');

  // Leaves show up on the dashboard; data survives a reload.
  await page.reload();
  await page
    .getByRole('link', { name: /Dashboard/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: /Audit 2026/ })).toBeVisible();
});

test('deep links and the back button work (hash routing)', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel(/First customer name/i).fill('Acme');
  await page.getByRole('button', { name: 'Get started' }).click();
  await expect(page).toHaveURL(/#\/manage\//);
  await page
    .getByRole('link', { name: /Schedule/ })
    .first()
    .click();
  await expect(page).toHaveURL(/#\/schedule$/);
  await page.goBack();
  await expect(page).toHaveURL(/#\/manage\//);
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Acme');
});
