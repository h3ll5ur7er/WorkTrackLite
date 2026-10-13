import { defineConfig, devices } from '@playwright/test';

const PORT = 4300;

/**
 * End-to-end tests run against the *production* build (incl. the single-file
 * build), served by scripts/serve-dist.mjs. `npm run e2e` builds first;
 * `npm run e2e:only` reuses an existing dist/.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}/`,
    // A DST time zone so calendar bugs reproduce everywhere.
    timezoneId: 'Europe/Zurich',
    locale: 'en-US',
    // The Angular service worker would cache between tests; it has no behaviour worth e2e-testing here.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    launchOptions: {
      // Use a preinstalled Chromium when the matching Playwright browser is not installed.
      executablePath: process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE'] || undefined,
    },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, grepInvert: /@mobile/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
  webServer: {
    command: `node scripts/serve-dist.mjs ${PORT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env['CI'],
  },
});
