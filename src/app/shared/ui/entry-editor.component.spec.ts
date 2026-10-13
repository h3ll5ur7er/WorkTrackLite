import { TestBed } from '@angular/core/testing';
import { WorkTrackDB } from '../../core/db';
import { DataService } from '../../core/data.service';
import { provideTestDb, waitFor } from '../../testing/test-db';
import { EntryDraft, EntryEditorComponent } from './entry-editor.component';

describe('EntryEditorComponent', () => {
  let db: WorkTrackDB;
  let nodeId: string;

  beforeEach(async () => {
    const t = provideTestDb();
    db = t.db;
    TestBed.configureTestingModule({ providers: t.providers });
    const data = TestBed.inject(DataService);
    await waitFor(() => data.ready());
    nodeId = await data.addNode({ parentId: null, name: 'Acme', kind: 'Customer' });
    await waitFor(() => data.nodes().length === 1);
  });

  afterEach(async () => {
    TestBed.resetTestingModule();
    db.close();
    await db.delete();
  });

  async function render(draft: EntryDraft) {
    const fixture = TestBed.createComponent(EntryEditorComponent);
    fixture.componentRef.setInput('draft', draft);
    const saved: EntryDraft[] = [];
    fixture.componentInstance.saved.subscribe((d) => saved.push(d));
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement, saved };
  }

  const start = new Date(2026, 9, 20, 9, 0).getTime();

  it('requires a node', async () => {
    const { el } = await render({ nodeId: null, start, end: start + 3_600_000 });
    expect(el.querySelector('[role=alert]')?.textContent).toContain('Pick a node');
    expect(el.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
  });

  it('edits duration and emits the draft on submit', async () => {
    const { fixture, el, saved } = await render({ nodeId, start, end: start + 3_600_000 });
    const dur = el.querySelector<HTMLInputElement>('input[name=duration]')!;
    dur.value = '1.5';
    dur.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(el.querySelector<HTMLInputElement>('input[name=end]')!.value).toBe('2026-10-20T10:30');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ nodeId, start, end: start + 90 * 60_000 });
  });

  it('moving the start keeps the duration', async () => {
    const { fixture, el } = await render({ nodeId, start, end: start + 3_600_000 });
    const s = el.querySelector<HTMLInputElement>('input[name=start]')!;
    s.value = '2026-10-20T13:00';
    s.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(el.querySelector<HTMLInputElement>('input[name=end]')!.value).toBe('2026-10-20T14:00');
  });

  it('rejects an end before the start', async () => {
    const { fixture, el } = await render({ nodeId, start, end: start + 3_600_000 });
    const e = el.querySelector<HTMLInputElement>('input[name=end]')!;
    e.value = '2026-10-20T08:00';
    e.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('End must be after start');
  });
});
