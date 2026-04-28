import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal, effect, ElementRef, viewChild, AfterViewInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { TimerService } from '../../services/timer.service';

interface Action {
  label: string;
  hint?: string;
  run: () => unknown | Promise<unknown>;
}

@Component({
    selector: 'app-command-palette',
    imports: [CommonModule, FormsModule],
    template: `
    <div class="cp" *ngIf="open()" (click)="close($event)">
      <div class="cp__panel" (click)="$event.stopPropagation()">
        <input #input class="cp__input"
               type="text"
               placeholder="Type a command or node name…"
               [ngModel]="query()" (ngModelChange)="query.set($event)"
               (keydown)="onKey($event)" />
        <ul class="cp__list">
          <li *ngFor="let a of filtered(); let i = index"
              [class.cp__item--active]="i === active()"
              (mouseenter)="active.set(i)"
              (click)="invoke(a)">
            <span>{{ a.label }}</span>
            <span class="cp__hint">{{ a.hint }}</span>
          </li>
          <li *ngIf="!filtered().length" class="cp__empty">No matches</li>
        </ul>
      </div>
    </div>
  `,
    styles: [`
    .cp { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: flex-start; justify-content: center; padding-top: 10vh; z-index: 1000; }
    .cp__panel { width: min(560px, 92vw); background: var(--c-bg-2); border: 1px solid var(--c-border); border-radius: 8px; box-shadow: 0 24px 64px rgba(0,0,0,0.4); overflow: hidden; }
    .cp__input { width: 100%; box-sizing: border-box; padding: 12px 14px; font-size: 1.05rem; background: transparent; color: inherit; border: 0; border-bottom: 1px solid var(--c-border); outline: none; }
    .cp__list { list-style: none; margin: 0; padding: 6px 0; max-height: 50vh; overflow: auto; }
    .cp__list li { padding: 6px 14px; display: flex; justify-content: space-between; gap: 12px; cursor: pointer; }
    .cp__item--active { background: var(--c-accent-bg); color: var(--c-accent); }
    .cp__hint { color: var(--c-fg-3); font-size: 0.8rem; }
    .cp__empty { color: var(--c-fg-3); padding: 12px 14px; cursor: default; }
  `]
})
export class CommandPaletteComponent implements AfterViewInit {
  data = inject(DataService);
  timer = inject(TimerService);
  open = signal(false);
  query = signal('');
  active = signal(0);
  inputRef = viewChild<ElementRef<HTMLInputElement>>('input');

  /** Provided by parent so palette can request selection. */
  selectNode: (id: string) => void = () => {};

  constructor() {
    effect(() => { if (this.open()) queueMicrotask(() => this.inputRef()?.nativeElement.focus()); });
  }

  ngAfterViewInit(): void {
    window.addEventListener('keydown', (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') {
        ev.preventDefault();
        this.openPalette();
      } else if (ev.key === 'Escape' && this.open()) {
        this.open.set(false);
      }
    });
  }

  openPalette() { this.query.set(''); this.active.set(0); this.open.set(true); }

  readonly actions = computed<Action[]>(() => {
    const acts: Action[] = [];
    const r = this.timer.running();
    if (r) {
      acts.push({ label: 'Stop active timer', hint: 'timer', run: () => this.timer.stop() });
    }
    const last = this.data.settings().lastNodeId;
    if (!r && last) {
      const n = this.data.nodes().find(x => x.id === last);
      if (n) acts.push({ label: `Resume last: ${n.name}`, hint: 'timer', run: () => this.timer.resumeLast() });
    }
    for (const n of this.data.nodes()) {
      if (n.archived) continue;
      acts.push({
        label: `Open ${n.name}`,
        hint: n.kind,
        run: () => this.selectNode(n.id),
      });
      if (!r || r.nodeId !== n.id) {
        acts.push({
          label: `Start timer on ${n.name}`,
          hint: n.kind,
          run: () => this.timer.start(n.id),
        });
      }
    }
    return acts;
  });

  readonly filtered = computed<Action[]>(() => {
    const q = this.query().toLowerCase();
    if (!q) return this.actions().slice(0, 50);
    return this.actions().filter(a => a.label.toLowerCase().includes(q)).slice(0, 50);
  });

  onKey(ev: KeyboardEvent) {
    const list = this.filtered();
    if (ev.key === 'ArrowDown') { ev.preventDefault(); this.active.set(Math.min(list.length - 1, this.active() + 1)); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); this.active.set(Math.max(0, this.active() - 1)); }
    else if (ev.key === 'Enter') { ev.preventDefault(); const a = list[this.active()]; if (a) this.invoke(a); }
    else if (ev.key === 'Escape') { this.open.set(false); }
  }

  async invoke(a: Action) {
    this.open.set(false);
    await a.run();
  }

  close(ev: MouseEvent) { if (ev.target === ev.currentTarget) this.open.set(false); }
}
