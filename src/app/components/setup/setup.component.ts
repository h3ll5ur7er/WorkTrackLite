import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';

@Component({
    selector: 'app-setup',
    imports: [CommonModule, FormsModule],
    template: `
    <div class="setup">
      <h2>Welcome to WorkTrackLite</h2>
      <p class="muted">Pick a starting hierarchy template — you can change everything later.</p>
      <ul class="tpl">
        <li *ngFor="let t of data.templates()"
            [class.tpl--active]="picked() === t.id"
            (click)="picked.set(t.id)">
          <strong>{{ t.name }}</strong>
          <small>{{ t.levels.join(' → ') }}</small>
        </li>
      </ul>
      <label class="row">
        <span>First node name:</span>
        <input [ngModel]="firstName()" (ngModelChange)="firstName.set($event)" placeholder="e.g. Acme Inc." />
      </label>
      <button class="btn btn--primary" [disabled]="!picked() || !firstName().trim()" (click)="finish()">Get started</button>
    </div>
  `,
    styles: [`
    .setup { max-width: 520px; margin: 8vh auto; padding: 24px; background: var(--c-bg-2); border: 1px solid var(--c-border); border-radius: 12px; }
    .setup h2 { margin-top: 0; }
    .muted { color: var(--c-fg-3); }
    .tpl { list-style: none; padding: 0; margin: 16px 0; display: grid; gap: 8px; }
    .tpl li { padding: 10px 12px; border: 1px solid var(--c-border); border-radius: 6px; cursor: pointer; display: flex; flex-direction: column; gap: 2px; }
    .tpl li small { color: var(--c-fg-3); }
    .tpl--active { background: var(--c-accent-bg); border-color: var(--c-accent); }
    .row { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; }
    .row input { flex: 1; padding: 6px 8px; background: var(--c-bg); border: 1px solid var(--c-border); border-radius: 4px; color: inherit; font: inherit; }
  `]
})
export class SetupComponent {
  data = inject(DataService);
  picked = signal<string | null>(null);
  firstName = signal('');

  async finish() {
    const tpl = this.data.templates().find(t => t.id === this.picked());
    if (!tpl) return;
    await this.data.updateSettings({ templateId: tpl.id });
    await this.data.addNode({ parentId: null, name: this.firstName().trim(), kind: tpl.levels[0] ?? 'Item' });
  }
}
