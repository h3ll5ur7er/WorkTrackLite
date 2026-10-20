import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { WorkTrackDB } from '../../core/db';
import { DataService } from '../../core/data.service';
import { provideTestDb, waitFor } from '../../testing/test-db';
import { DashboardComponent } from './dashboard.component';

describe('DashboardComponent', () => {
  let db: WorkTrackDB;
  let data: DataService;

  beforeEach(async () => {
    const t = provideTestDb();
    db = t.db;
    TestBed.configureTestingModule({ providers: [...t.providers, provideRouter([])] });
    data = TestBed.inject(DataService);
    await waitFor(() => data.ready());
    const acme = await data.addNode({ parentId: null, name: 'Acme', kind: 'Customer' });
    await data.addNode({ parentId: acme, name: 'Website', kind: 'Project', budget: { type: 'fixed', seconds: 3600 } });
    await data.addNode({ parentId: acme, name: 'App', kind: 'Project' });
    await waitFor(() => data.nodes().length === 3);
  });

  afterEach(async () => {
    TestBed.resetTestingModule();
    db.close();
    await db.delete();
  });

  async function render() {
    const fixture = TestBed.createComponent(DashboardComponent);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('shows one card per leaf, with its breadcrumb', async () => {
    const { el } = await render();
    const titles = [...el.querySelectorAll('.card__title')].map((t) => t.textContent?.replace(/\s+/g, ' ').trim());
    expect(titles).toEqual(['Project App', 'Project Website']);
    expect(el.querySelector('.card__breadcrumb')?.textContent).toContain('Acme');
  });

  it('filters cards by name and path', async () => {
    const { fixture, el } = await render();
    const input = el.querySelector<HTMLInputElement>('#dash-filter')!;
    input.value = 'web';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(el.querySelectorAll('.card')).toHaveLength(1);
  });

  it('cards are real buttons: activating one starts a timer, and a fast repeat is ignored', async () => {
    const { fixture, el } = await render();
    const btn = el.querySelector<HTMLButtonElement>('button[aria-label="Start timer on App"]')!;
    expect(btn).toBeTruthy();
    btn.click();
    btn.click();
    await waitFor(() => !!data.runningEntry());
    await fixture.whenStable();
    const entries = await db.entries.toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0].end).toBeNull();
    expect(el.querySelector('button[aria-label="Stop timer on App"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('opens an action menu from the ⋯ button', async () => {
    const { fixture, el } = await render();
    el.querySelector<HTMLButtonElement>('button[aria-label="More actions for Website"]')!.click();
    await fixture.whenStable();
    const items = [...el.querySelectorAll('[role=menuitem]')].map((b) => b.textContent?.trim());
    expect(items).toEqual(['Start timer', 'Log time…', 'Add to favourites', 'Open in Manage', 'Hide from dashboard']);
  });

  // Keys pressed right after opening go to whatever is focused at that moment, which can be
  // before Angular's scheduled render. So these checks deliberately do not await anything.
  it('regression: the ⋯ menu has focus synchronously after opening', async () => {
    const { el } = await render();
    const more = el.querySelector<HTMLButtonElement>('button[aria-label="More actions for Website"]')!;
    more.focus();
    more.click();
    const first = el.querySelector('[role=menuitem]');
    expect(first).toBeInstanceOf(HTMLButtonElement);
    expect(document.activeElement).toBe(first);
  });

  it('regression: "Log time…" opens the editor with focus in it, synchronously', async () => {
    const { el } = await render();
    el.querySelector<HTMLButtonElement>('button[aria-label="More actions for Website"]')!.click();
    const logTime = [...el.querySelectorAll<HTMLButtonElement>('[role=menuitem]')].find((b) => b.textContent?.includes('Log time'))!;
    logTime.click();
    const dialog = el.querySelector('[role=dialog]');
    expect(dialog).toBeTruthy();
    expect(dialog!.contains(document.activeElement)).toBe(true);
  });
});
