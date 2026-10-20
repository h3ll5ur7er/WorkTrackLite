import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { NAV_ITEMS } from '../../app.nav';
import { BackupService } from '../../core/backup.service';
import { DataService } from '../../core/data.service';
import { renderNow } from '../render-now';
import { ThemeService } from '../../core/theme.service';
import { TimerService } from '../../core/timer.service';

interface Action {
  id: string;
  label: string;
  hint?: string;
  run: () => unknown;
}

const MAX_RESULTS = 50;

/** Ctrl/Cmd+K launcher for navigation, timers and common commands. */
@Component({
  selector: 'app-command-palette',
  host: { '(document:keydown)': 'onGlobalKey($event)' },
  template: `
    <button type="button" class="btn" (click)="openPalette()" aria-haspopup="dialog" title="Command palette (Ctrl/Cmd+K)">
      <span aria-hidden="true">⌘K</span><span class="visually-hidden">Open command palette</span>
    </button>
    @if (open()) {
      <div class="cp">
        <button type="button" class="cp__backdrop" tabindex="-1" aria-label="Close command palette" (click)="close()"></button>
        <div class="cp__panel" role="dialog" aria-modal="true" aria-label="Command palette">
          <input
            #input
            class="cp__input"
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-controls="cp-list"
            aria-expanded="true"
            [attr.aria-activedescendant]="filtered().length ? 'cp-item-' + active() : null"
            placeholder="Type a command or node name…"
            [value]="query()"
            (input)="query.set($any($event.target).value); active.set(0)"
            (keydown)="onKey($event)"
          />
          <ul id="cp-list" class="cp__list" role="listbox" aria-label="Results">
            @for (a of filtered(); track a.id; let i = $index) {
              <!-- Options are driven from the combobox input via aria-activedescendant; mouse clicks are a shortcut. -->
              <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
              <li
                [id]="'cp-item-' + i"
                role="option"
                [attr.aria-selected]="i === active()"
                [class.cp__item--active]="i === active()"
                (mouseenter)="active.set(i)"
                (click)="invoke(a)"
              >
                <span>{{ a.label }}</span>
                <span class="cp__hint">{{ a.hint }}</span>
              </li>
            } @empty {
              <li class="cp__empty" role="presentation">No matches</li>
            }
          </ul>
        </div>
      </div>
    }
  `,
  styles: `
    .cp {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding-top: 10vh;
      z-index: 1000;
    }
    .cp__backdrop {
      position: fixed;
      inset: 0;
      border: 0;
      background: transparent;
      cursor: default;
    }
    .cp__panel {
      position: relative;
      width: min(560px, 92vw);
      background: var(--c-bg-2);
      border: 1px solid var(--c-border);
      border-radius: 8px;
      box-shadow: 0 24px 64px var(--c-shadow);
      overflow: hidden;
    }
    .cp__input {
      width: 100%;
      box-sizing: border-box;
      padding: 12px 14px;
      font-size: 1.05rem;
      background: transparent;
      color: inherit;
      border: 0;
      border-bottom: 1px solid var(--c-border);
      outline: none;
    }
    .cp__list {
      list-style: none;
      margin: 0;
      padding: 6px 0;
      max-height: 50vh;
      overflow: auto;
    }
    .cp__list li {
      padding: 6px 14px;
      display: flex;
      justify-content: space-between;
      gap: 12px;
      cursor: pointer;
    }
    .cp__item--active {
      background: var(--c-accent-bg);
      color: var(--c-accent);
    }
    .cp__hint {
      color: var(--c-fg-3);
      font-size: 0.8rem;
    }
    .cp__empty {
      color: var(--c-fg-3);
      cursor: default;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommandPaletteComponent {
  private readonly data = inject(DataService);
  private readonly timer = inject(TimerService);
  private readonly router = inject(Router);
  private readonly backup = inject(BackupService);
  private readonly theme = inject(ThemeService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly cdr = inject(ChangeDetectorRef);

  readonly open = signal(false);
  readonly query = signal('');
  readonly active = signal(0);
  private readonly input = viewChild<ElementRef<HTMLInputElement>>('input');
  private returnFocus: HTMLElement | null = null;

  constructor() {
    effect(() => {
      const i = this.active();
      if (this.open()) {
        (this.host.nativeElement as HTMLElement).querySelector(`#cp-item-${i}`)?.scrollIntoView?.({ block: 'nearest' });
      }
    });
  }

  readonly actions = computed<Action[]>(() => {
    const acts: Action[] = [];
    const running = this.timer.running();
    const tree = this.data.tree();
    if (running) acts.push({ id: 'stop', label: 'Stop active timer', hint: 'timer', run: () => this.timer.stop() });
    const last = tree.get(this.data.settings().lastNodeId);
    if (!running && last && !last.archived) {
      acts.push({ id: 'resume', label: `Resume last: ${last.name}`, hint: 'timer', run: () => this.timer.resumeLast() });
    }
    for (const nav of NAV_ITEMS) {
      acts.push({ id: `nav:${nav.path}`, label: `Go to ${nav.label}`, hint: 'view', run: () => this.router.navigateByUrl(nav.path) });
    }
    acts.push(
      { id: 'search', label: 'Search entries', hint: 'view', run: () => this.router.navigateByUrl('/search') },
      { id: 'backup', label: 'Export backup (JSON)', hint: 'data', run: () => this.backup.exportToFile() },
      { id: 'theme', label: 'Toggle theme', hint: 'view', run: () => this.theme.toggle() },
    );
    // Favourites first, then tree order (stable sort).
    const nodes = [...tree.nodes].sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite));
    for (const n of nodes) {
      if (n.archived || tree.hasArchivedAncestor(n.id)) continue;
      const path = tree.pathLabel(n.id);
      if (!running || running.nodeId !== n.id) {
        acts.push({
          id: `start:${n.id}`,
          label: `Start timer on ${path}`,
          hint: n.favorite ? `★ ${n.kind}` : n.kind,
          run: () => this.timer.start(n.id),
        });
      }
      acts.push({ id: `open:${n.id}`, label: `Open ${path}`, hint: n.kind, run: () => this.router.navigate(['/manage', n.id]) });
    }
    return acts;
  });

  readonly filtered = computed<Action[]>(() => {
    const q = this.query().trim();
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const acts = terms.length ? this.actions().filter((a) => terms.every((t) => a.label.toLowerCase().includes(t))) : this.actions();
    const out = acts.slice(0, MAX_RESULTS);
    // Always offer a full-text search for what was typed.
    if (q)
      out.push({
        id: 'search:q',
        label: `Search entries for “${q}”`,
        hint: 'search',
        run: () => this.router.navigate(['/search'], { queryParams: { q } }),
      });
    return out;
  });

  openPalette(): void {
    this.returnFocus = document.activeElement as HTMLElement | null;
    this.query.set('');
    this.active.set(0);
    this.open.set(true);
    renderNow(this.cdr);
    this.input()?.nativeElement.focus();
  }

  close(): void {
    this.open.set(false);
    if (this.returnFocus?.isConnected) this.returnFocus.focus();
  }

  protected onGlobalKey(ev: KeyboardEvent): void {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') {
      ev.preventDefault();
      if (this.open()) this.close();
      else this.openPalette();
    }
  }

  protected onKey(ev: KeyboardEvent): void {
    const n = this.filtered().length;
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      if (n) this.active.set((this.active() + 1) % n);
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (n) this.active.set((this.active() - 1 + n) % n);
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      const a = this.filtered()[this.active()];
      if (a) void this.invoke(a);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      this.close();
    }
  }

  protected async invoke(a: Action): Promise<void> {
    this.open.set(false);
    await a.run();
  }
}
