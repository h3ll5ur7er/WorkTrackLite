import { Page, expect, test as base } from '@playwright/test';

/**
 * Fails any test whose page throws an uncaught error or logs a console error.
 * Angular catches many failures (e.g. router navigation errors) and only logs
 * them, so uncaught errors alone are not enough.
 */
export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(`uncaught: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
      });
      await use(errors);
      expect(errors, 'errors in the page').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

const H = 3_600_000;

export interface SeedNode {
  id: string;
  parentId?: string | null;
  name: string;
  kind?: string;
  budget?: { type: 'none' | 'target' | 'fixed'; seconds: number; softLimit?: number };
  archived?: boolean;
  order?: number;
  tags?: string[];
  color?: string;
  rate?: number;
  billable?: boolean;
  favorite?: boolean;
  work?: boolean;
}
export interface SeedEntry {
  id: string;
  nodeId: string;
  start: number;
  end: number | null;
  note?: string;
  tags?: string[];
  billable?: boolean;
}

/** A backup file in the app's JSON format. */
export function backupJson(nodes: SeedNode[], entries: SeedEntry[] = [], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    app: 'worktracklite',
    formatVersion: 2,
    exportedAt: new Date().toISOString(),
    nodes: nodes.map((n, i) => ({
      parentId: null,
      kind: 'Item',
      order: i,
      budget: { type: 'none', seconds: 0 },
      createdAt: 0,
      updatedAt: 0,
      ...n,
    })),
    entries: entries.map((e) => ({ createdAt: 0, updatedAt: 0, ...e })),
    templates: [],
    settings: { id: 'app', theme: 'dark', weekStartsOn: 1, templateId: 'dev' },
    ...extra,
  });
}

/** Standard fixture: Acme › Website (fixed 10h) › Design, Acme › App. */
export const ACME = [
  { id: 'acme', name: 'Acme', kind: 'Customer' },
  { id: 'web', parentId: 'acme', name: 'Website', kind: 'Project', budget: { type: 'fixed' as const, seconds: 10 * 3600 } },
  { id: 'design', parentId: 'web', name: 'Design', kind: 'Task' },
  { id: 'app', parentId: 'acme', name: 'App', kind: 'Project' },
];

/** Loads the app on a fresh profile and restores `json` through the first-run screen. */
export async function seed(page: Page, json: string, path = '/#/dashboard'): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'Welcome to WorkTrackLite' })).toBeVisible();
  await page
    .getByText('Restore a backup…')
    .locator('input[type=file]')
    .setInputFiles({
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(json),
    });
  await expect(page.getByText(/Restored \d+ nodes/)).toBeVisible();
}

/** Reads an object store straight from IndexedDB. */
export async function readStore<T = Record<string, unknown>>(page: Page, store: string): Promise<T[]> {
  return page.evaluate(
    (name) =>
      new Promise<T[]>((resolve, reject) => {
        const req = indexedDB.open('worktracklite');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const get = req.result.transaction(name).objectStore(name).getAll();
          get.onsuccess = () => {
            resolve(get.result as T[]);
            req.result.close();
          };
          get.onerror = () => reject(get.error);
        };
      }),
    store,
  );
}

/** Local wall-clock time in the test time zone (Europe/Zurich) as epoch ms. */
export function zurich(iso: string): number {
  // Offsets for the dates used in tests: CEST (+02:00) until 2026-10-25 03:00, CET (+01:00) after.
  const d = new Date(iso + (iso >= '2026-10-25T03:00' || iso < '2026-03-29T02:00' ? '+01:00' : '+02:00'));
  return d.getTime();
}

export { H };
