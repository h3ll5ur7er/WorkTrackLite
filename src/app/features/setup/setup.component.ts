import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DataService } from '../../core/data.service';
import { StorageService } from '../../core/storage.service';
import { ToastService } from '../../core/toast.service';
import { BackupService } from '../../core/backup.service';

/** First-run screen: pick a hierarchy template and create the first node (or restore a backup). */
@Component({
  selector: 'app-setup',
  template: `
    <form class="setup" (submit)="$event.preventDefault(); finish()">
      <h1>Welcome to WorkTrackLite</h1>
      <p class="muted">Pick a starting hierarchy template — you can change everything later.</p>
      <fieldset class="tpl">
        <legend class="visually-hidden">Hierarchy template</legend>
        @for (t of data.templates(); track t.id) {
          <label class="tpl__item" [class.tpl__item--active]="picked() === t.id">
            <input type="radio" name="template" [value]="t.id" [checked]="picked() === t.id" (change)="picked.set(t.id)" />
            <span>
              <strong>{{ t.name }}</strong>
              <small>{{ t.levels.join(' → ') }}</small>
            </span>
          </label>
        }
      </fieldset>
      <label class="setup__name">
        <span>First {{ firstLevel() }} name</span>
        <input
          class="input"
          name="firstName"
          [value]="firstName()"
          (input)="firstName.set($any($event.target).value)"
          placeholder="e.g. Acme Inc."
        />
      </label>
      <div class="setup__actions">
        <button type="submit" class="btn btn--primary" [disabled]="!picked() || !firstName().trim()">Get started</button>
        <label class="btn btn--ghost">
          Restore a backup…
          <input type="file" accept="application/json,.json" class="visually-hidden" (change)="restore($event)" />
        </label>
      </div>
    </form>
  `,
  styles: `
    .setup {
      max-width: 520px;
      margin: 6vh auto;
      padding: 24px;
      background: var(--c-bg-2);
      border: 1px solid var(--c-border);
      border-radius: 12px;
    }
    h1 {
      margin-top: 0;
      font-size: 1.4rem;
    }
    .tpl {
      border: 0;
      padding: 0;
      margin: 16px 0;
      display: grid;
      gap: 8px;
    }
    .tpl__item {
      padding: 10px 12px;
      border: 1px solid var(--c-border);
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      gap: 10px;
      align-items: center;
    }
    .tpl__item span {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .tpl__item small {
      color: var(--c-fg-3);
    }
    .tpl__item--active {
      background: var(--c-accent-bg);
      border-color: var(--c-accent);
    }
    .setup__name {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-bottom: 16px;
    }
    .setup__actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SetupComponent {
  protected readonly data = inject(DataService);
  private readonly storage = inject(StorageService);
  private readonly toast = inject(ToastService);
  private readonly backup = inject(BackupService);
  private readonly router = inject(Router);

  protected readonly picked = signal<string | null>('dev');
  protected readonly firstName = signal('');

  protected firstLevel(): string {
    return (
      this.data
        .templates()
        .find((t) => t.id === this.picked())
        ?.levels[0]?.toLowerCase() ?? 'item'
    );
  }

  protected async finish(): Promise<void> {
    const tpl = this.data.templates().find((t) => t.id === this.picked());
    const name = this.firstName().trim();
    if (!tpl || !name) return;
    await this.data.updateSettings({ templateId: tpl.id });
    const id = await this.data.addNode({ parentId: null, name, kind: tpl.levels[0] ?? 'Item' });
    // The user has data now: ask the browser not to evict it.
    void this.storage.requestPersistence();
    await this.router.navigate(['/manage', id]);
  }

  protected async restore(ev: Event): Promise<void> {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const res = await this.backup.read(file);
    if (!res.ok) {
      this.toast.error(res.error);
      return;
    }
    await this.backup.restore(res.data);
    void this.storage.requestPersistence();
    this.toast.show(`Restored ${res.data.nodes.length} nodes and ${res.data.entries.length} entries.`);
  }
}
