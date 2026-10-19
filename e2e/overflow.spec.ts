import { Page } from '@playwright/test';
import { H, SeedEntry, SeedNode, backupJson, expect, seed, test, zurich } from './fixtures';

// Lots of nodes, long names, overlapping entries and many tags, so every list overflows.
function bigData() {
  const nodes: SeedNode[] = [];
  const entries: SeedEntry[] = [];
  const tags = Array.from({ length: 40 }, (_, i) => `tag-${i}-${'x'.repeat(i % 7)}`);
  for (let c = 0; c < 12; c++) {
    nodes.push({ id: `c${c}`, name: `Customer ${c} with a rather long company name GmbH`, kind: 'Customer' });
    for (let p = 0; p < 4; p++) {
      nodes.push({
        id: `c${c}p${p}`,
        parentId: `c${c}`,
        name: `Project ${p}`,
        kind: 'Project',
        budget: { type: 'fixed', seconds: 20 * 3600 },
      });
      for (let t = 0; t < 3; t++)
        nodes.push({
          id: `c${c}p${p}t${t}`,
          parentId: `c${c}p${p}`,
          name: `Task ${t} ${'long '.repeat(t * 3)}`,
          kind: 'Task',
          tags: [tags[(c + p + t) % 40]],
        });
    }
  }
  let i = 0;
  for (let d = 19; d <= 25; d++) {
    for (let k = 0; k < 14; k++) {
      const start = zurich(`2026-10-${d}T${String(8 + (k % 10)).padStart(2, '0')}:00`);
      const leaf = nodes.filter((n) => n.kind === 'Task')[(i * 7) % 144];
      entries.push({ id: `e${i}`, nodeId: leaf.id, start, end: start + H, note: `note ${i}`, tags: [tags[i % 40]] });
      i++;
    }
  }
  // Lots of entries on one node for the node-detail table.
  for (let k = 0; k < 80; k++) {
    const start = zurich('2026-09-01T08:00') + k * 24 * H;
    entries.push({ id: `x${k}`, nodeId: 'c0p0t0', start, end: start + 2 * H, note: `history ${k}` });
  }
  return backupJson(nodes, entries);
}

/**
 * Lists controls and rows that cannot be brought into view: clipped by an
 * `overflow: hidden` ancestor, or outside the viewport with nothing to scroll.
 * Scroll containers count as reachable only if they are reachable themselves.
 */
async function unreachable(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const vw = innerWidth;
    const vh = innerHeight;
    if (document.documentElement.scrollWidth > vw + 1)
      out.push(`page scrolls horizontally: ${document.documentElement.scrollWidth} > ${vw}`);
    const targets = document.querySelectorAll<HTMLElement>(
      'button, a[href], input, select, textarea, [role=button], [role=menuitem], [role=option], td, th, li, .card, .block',
    );
    for (const el of targets) {
      let r: { top: number; bottom: number; left: number; right: number; width: number; height: number } = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (getComputedStyle(el).visibility === 'hidden') continue;
      if (el.closest('.visually-hidden')) continue;
      let ok = true;
      let why = '';
      let fixed = false;
      for (let a = el.parentElement; a; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (s.position === 'fixed') fixed = true;
        const ox = s.overflowX;
        const oy = s.overflowY;
        if (ox === 'visible' && oy === 'visible') continue;
        const ar = a.getBoundingClientRect();
        const scrollY = oy === 'auto' || oy === 'scroll';
        const scrollX = ox === 'auto' || ox === 'scroll';
        const outY = r.top < ar.top - 1 || r.bottom > ar.bottom + 1;
        const outX = r.left < ar.left - 1 || r.right > ar.right + 1;
        if ((outY && !scrollY) || (outX && !scrollX)) {
          ok = false;
          why = `clipped by ${a.tagName.toLowerCase()}.${[...a.classList].join('.')} (${s.overflowX}/${s.overflowY})`;
          break;
        }
        // Scrolling this ancestor can bring the element into its box; it must still be reachable itself.
        if ((outY && scrollY) || (outX && scrollX)) r = ar;
      }
      const docScrolls = document.scrollingElement!.scrollHeight > vh + 1;
      if (ok && (fixed || !docScrolls) && (r.bottom > vh + 1 || r.right > vw + 1 || r.top < -1)) {
        ok = false;
        why = 'outside the viewport inside a fixed layer';
      }
      if (!ok) {
        const label = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
        out.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} "${label}": ${why}`);
      }
    }
    return [...new Set(out)].slice(0, 25);
  });
}

const PAGES = ['dashboard', 'schedule', 'manage/c0p0t0', 'manage', 'reports', 'settings'];

for (const tag of ['desktop', '@mobile']) {
  test.describe(`${tag}: nothing is out of reach with lots of data`, () => {
    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime(new Date(zurich('2026-10-21T19:00')));
      await seed(page, bigData());
    });

    test('pages', async ({ page }) => {
      for (const path of PAGES) {
        await page.goto(`/#/${path}`);
        await expect(page.locator('.app__main')).toBeVisible();
        expect(await unreachable(page), path).toEqual([]);
      }
    });

    test('menus, the entry editor and the palette', async ({ page }) => {
      await page.goto('/#/schedule');
      const block = page.locator('.block').last();
      await block.scrollIntoViewIfNeeded();
      await block.click({ button: 'right' });
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      expect(await unreachable(page), 'context menu').toEqual([]);
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: /New/ }).click();
      const dialog = page.getByRole('dialog', { name: 'New time entry' });
      await expect(dialog).toBeVisible();
      expect(await unreachable(page), 'entry editor').toEqual([]);
      // The restore toast is still showing; it must not cover the dialog's buttons.
      const [save, toast] = [
        await dialog.getByRole('button', { name: 'Save' }).boundingBox(),
        await page.locator('.toast').first().boundingBox(),
      ];
      expect(toast!.y + toast!.height <= save!.y || toast!.y >= save!.y + save!.height).toBe(true);
      await page.keyboard.press('Escape');

      await page.keyboard.press('Control+k');
      await expect(page.getByPlaceholder('Type a command or node name…')).toBeFocused();
      expect(await unreachable(page), 'palette').toEqual([]);
    });
  });
}

test('regression: the Manage tree scrolls to its last node', async ({ page }) => {
  await seed(page, bigData());
  await page.goto('/#/manage');
  // Wheel, not scrollIntoView: script can scroll even an overflow:hidden box, a user cannot.
  await page.locator('.tree__node').first().hover();
  await page.mouse.wheel(0, 50_000);
  const last = page.locator('.tree__node').last();
  await expect(last).toBeInViewport();
  await last.click();
  await expect(page).toHaveURL(/#\/manage\/c11p3t2$/);
});

test('@mobile the Manage tree folds away while a node is open', async ({ page }) => {
  await seed(page, bigData());
  await page.goto('/#/manage');
  const toggle = page.getByRole('button', { name: /All nodes \(204\)/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page
    .getByRole('link', { name: /Project 1/ })
    .first()
    .click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.tree__node').first()).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Budget' })).toBeInViewport();
  await toggle.click();
  await expect(page.locator('.tree__node').first()).toBeVisible();
});

test('@mobile context menus open as a bottom sheet inside the screen', async ({ page }) => {
  await page.clock.setFixedTime(new Date(zurich('2026-10-21T19:00')));
  await seed(page, bigData());
  await page.goto('/#/schedule');
  await page.locator('.block').first().click({ button: 'right' });
  const box = (await page.getByRole('menu').boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
  expect(box.y + box.height).toBeGreaterThan(vp.height - 40);
  expect(box.width).toBeGreaterThan(vp.width - 24);
});
