import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { WorkTrackDB } from '../../core/db';
import { DataService } from '../../core/data.service';
import { provideTestDb, waitFor } from '../../testing/test-db';
import { CommandPaletteComponent } from './command-palette.component';

describe('CommandPaletteComponent', () => {
  let db: WorkTrackDB;

  beforeEach(async () => {
    const t = provideTestDb();
    db = t.db;
    TestBed.configureTestingModule({ providers: [...t.providers, provideRouter([])] });
    const data = TestBed.inject(DataService);
    await waitFor(() => data.ready());
    const acme = await data.addNode({ parentId: null, name: 'Acme', kind: 'Customer' });
    await data.addNode({ parentId: acme, name: 'Website', kind: 'Project' });
    await waitFor(() => data.nodes().length === 2);
  });

  afterEach(async () => {
    TestBed.resetTestingModule();
    db.close();
    await db.delete();
  });

  it('opens with Ctrl+K, filters by all words and runs the active action with Enter', async () => {
    const fixture = TestBed.createComponent(CommandPaletteComponent);
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    await fixture.whenStable();
    const input = el.querySelector<HTMLInputElement>('input[role=combobox]')!;
    expect(input).toBeTruthy();

    input.value = 'open web';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    const options = [...el.querySelectorAll('[role=option]')].map((o) => o.textContent?.trim());
    // The match, then the full-text search for what was typed.
    expect(options).toHaveLength(2);
    expect(options[0]).toContain('Open Acme / Website');
    expect(options[1]).toContain('Search entries for “open web”');

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    expect(nav).toHaveBeenCalledWith(['/manage', expect.any(String)]);
    expect(el.querySelector('[role=dialog]')).toBeNull();
  });

  it('regression: focuses its input synchronously, so keys typed right after Ctrl+K are not lost', async () => {
    const fixture = TestBed.createComponent(CommandPaletteComponent);
    await fixture.whenStable();
    document.body.appendChild(fixture.nativeElement);
    // No await between the shortcut and the check: the browser delivers the next keystroke
    // to whatever is focused at that moment, possibly before Angular's scheduled render.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    const input = (fixture.nativeElement as HTMLElement).querySelector('input[role=combobox]');
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect(document.activeElement).toBe(input);
    fixture.nativeElement.remove();
  });
});
