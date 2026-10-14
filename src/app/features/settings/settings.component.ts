import { ChangeDetectionStrategy, Component, computed, inject, isDevMode, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { BackupService } from '../../core/backup.service';
import { DataService } from '../../core/data.service';
import { IdleService } from '../../core/idle.service';
import { Rounding, Settings, ThemePreference } from '../../core/models';
import { StorageService } from '../../core/storage.service';
import { ToastService } from '../../core/toast.service';
import { BackupData } from '../../domain/backup';
import { ColorPickerComponent } from '../../shared/ui/color-picker.component';
import { TagChipsComponent } from '../../shared/ui/tag-chips.component';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SINGLE_FILE_NAME = 'worktrack-singlefile.html';

@Component({
  selector: 'app-settings',
  imports: [DatePipe, ColorPickerComponent, TagChipsComponent],
  template: `
    <div class="settings">
      <h1>Settings</h1>

      <section class="panel" aria-labelledby="s-data">
        <h2 id="s-data">Your data</h2>
        <p>
          Everything is stored only in this browser ({{ data.nodes().length }} nodes, {{ data.entries().length }} entries). Export a backup
          regularly — clearing site data or switching browsers loses it otherwise.
        </p>
        <p class="muted">
          Last backup:
          @if (data.settings().lastBackupAt; as at) {
            {{ at | date: 'medium' }}
          } @else {
            never
          }
        </p>
        <div class="row">
          <button type="button" class="btn btn--primary" (click)="exportBackup()">⬇ Export backup (JSON)</button>
          <label class="btn">
            ⬆ Restore from backup…
            <input type="file" accept="application/json,.json" class="visually-hidden" (change)="pickBackup($event)" />
          </label>
        </div>
        @if (pending(); as p) {
          <div class="settings__confirm" role="alertdialog" aria-labelledby="s-restore-title">
            <p id="s-restore-title">
              <strong>Replace all current data</strong> with this backup ({{ p.nodes.length }} nodes, {{ p.entries.length }} entries)?
            </p>
            @for (w of pendingWarnings(); track w) {
              <p class="muted">{{ w }}</p>
            }
            <div class="row">
              <button type="button" class="btn btn--danger" (click)="confirmRestore()">Replace my data</button>
              <button type="button" class="btn" (click)="pending.set(null)">Cancel</button>
            </div>
          </div>
        }
      </section>

      <section class="panel" aria-labelledby="s-storage">
        <h2 id="s-storage">Storage</h2>
        @switch (storage.state()) {
          @case ('persisted') {
            <p>✔ Persistent storage is granted: the browser will not evict your data automatically.</p>
          }
          @case ('best-effort') {
            <p>
              Storage is <em>best effort</em>: the browser may delete it when space runs low (Safari after 7 days without a visit unless the
              app is installed).
            </p>
            <button type="button" class="btn" (click)="requestPersistence()">Request persistent storage</button>
          }
          @default {
            <p class="muted">This browser does not report storage persistence. Keep regular backups.</p>
          }
        }
        @if (usageLabel(); as u) {
          <p class="muted">{{ u }}</p>
        }
      </section>

      <section class="panel" aria-labelledby="s-appearance">
        <h2 id="s-appearance">Preferences</h2>
        <div class="grid">
          <label class="field">
            <span>Theme</span>
            <select (change)="setTheme($any($event.target).value)">
              @for (t of themes; track t.id) {
                <option [value]="t.id" [selected]="data.settings().theme === t.id">{{ t.label }}</option>
              }
            </select>
          </label>
          <label class="field">
            <span>Week starts on</span>
            <select (change)="setWeekStart(+$any($event.target).value)">
              @for (d of weekdays; track $index) {
                <option [value]="$index" [selected]="(data.settings().weekStartsOn ?? 1) === $index">{{ d }}</option>
              }
            </select>
          </label>
          <label class="field">
            <span>Hierarchy template (kind suggestions)</span>
            <select (change)="setTemplate($any($event.target).value)">
              @for (t of data.templates(); track t.id) {
                <option [value]="t.id" [selected]="data.settings().templateId === t.id">{{ t.name }} — {{ t.levels.join(' → ') }}</option>
              }
            </select>
          </label>
        </div>
      </section>

      <section class="panel" aria-labelledby="s-billing">
        <h2 id="s-billing">Billing</h2>
        <div class="grid">
          <label class="field">
            <span>Currency</span>
            <select (change)="setCurrency($any($event.target).value)">
              @for (c of currencies; track c) {
                <option [value]="c" [selected]="(data.settings().currency ?? 'EUR') === c">{{ c }}</option>
              }
            </select>
          </label>
          <label class="field">
            <span>Round each entry to</span>
            <select (change)="setRounding({ minutes: +$any($event.target).value })">
              @for (m of roundingSteps; track m) {
                <option [value]="m" [selected]="(data.settings().rounding?.minutes ?? 0) === m">
                  {{ m ? m + ' min' : 'Exact (no rounding)' }}
                </option>
              }
            </select>
          </label>
          @if (data.settings().rounding?.minutes) {
            <label class="field">
              <span>Rounding direction</span>
              <select (change)="setRounding({ mode: $any($event.target).value })">
                <option value="up" [selected]="data.settings().rounding?.mode === 'up'">Up</option>
                <option value="nearest" [selected]="data.settings().rounding?.mode === 'nearest'">Nearest</option>
                <option value="down" [selected]="data.settings().rounding?.mode === 'down'">Down</option>
              </select>
            </label>
          }
        </div>
        <p class="muted">
          Rates and the billable flag are set per node in Manage and inherited by children. Rounding applies to amounts in reports and CSV
          exports, not to tracked time.
        </p>
      </section>

      <section class="panel" aria-labelledby="s-tags">
        <h2 id="s-tags">Tag colours</h2>
        @for (tag of allTags(); track tag) {
          <div class="tag-row">
            <app-tag-chips [tags]="[tag]" />
            <app-color-picker
              [name]="'tag-' + tag"
              [label]="'Colour for tag ' + tag"
              [value]="data.settings().tagColors?.[tag]"
              (changed)="setTagColor(tag, $event)"
            />
          </div>
        } @empty {
          <p class="muted">No tags yet. Add tags to nodes or time entries, then colour them here.</p>
        }
      </section>

      <section class="panel" aria-labelledby="s-idle">
        <h2 id="s-idle">Forgotten-timer guard</h2>
        <label class="check-row">
          <input type="checkbox" [checked]="idle.settings().enabled" (change)="updateIdle({ idleGuard: $any($event.target).checked })" />
          Ask when a timer kept running while the device slept or the app was closed, ran very long, or crossed midnight
        </label>
        @if (idle.settings().enabled) {
          <div class="grid">
            <label class="field">
              <span>Away after (minutes)</span>
              <input
                type="number"
                min="1"
                step="1"
                [value]="idle.settings().awayMinutes"
                (change)="updateIdle({ idleAwayMinutes: positive($any($event.target).valueAsNumber) })"
              />
            </label>
            <label class="field">
              <span>Ask after a timer runs (hours)</span>
              <input
                type="number"
                min="1"
                step="0.5"
                [value]="idle.settings().longRunningHours"
                (change)="updateIdle({ idleLongRunningHours: positive($any($event.target).valueAsNumber) })"
              />
            </label>
          </div>
        }
      </section>

      @if (singleFileAvailable()) {
        <section class="panel" aria-labelledby="s-offline">
          <h2 id="s-offline">Offline copy</h2>
          <p>Download the whole app as one HTML file you can open from disk or host anywhere. Its data is separate from this copy's.</p>
          <a class="btn" [href]="singleFileName" download="worktracklite.html">⬇ Download single-file app</a>
        </section>
      }
    </div>
  `,
  styles: `
    .settings {
      padding: 16px 20px 32px;
      max-width: 760px;
    }
    h1 {
      font-size: 1.3rem;
      margin: 0 0 14px;
    }
    .grid {
      display: grid;
      gap: 10px;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    }
    .tag-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
      padding: 6px 0;
      border-bottom: 1px solid var(--c-border);
    }
    .tag-row app-tag-chips {
      min-width: 120px;
    }
    .check-row {
      display: flex;
      gap: 8px;
      align-items: flex-start;
      margin-bottom: 10px;
    }
    .settings__confirm {
      margin-top: 12px;
      padding: 10px 12px;
      border: 1px solid var(--c-danger);
      border-radius: 6px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent {
  protected readonly data = inject(DataService);
  protected readonly storage = inject(StorageService);
  protected readonly idle = inject(IdleService);
  private readonly backup = inject(BackupService);
  private readonly toast = inject(ToastService);

  protected readonly weekdays = WEEKDAYS;
  protected readonly singleFileName = SINGLE_FILE_NAME;
  protected readonly themes: { id: ThemePreference; label: string }[] = [
    { id: 'system', label: 'Follow system' },
    { id: 'dark', label: 'Dark' },
    { id: 'light', label: 'Light' },
  ];

  protected readonly pending = signal<BackupData | null>(null);
  protected readonly pendingWarnings = signal<string[]>([]);
  /** The single-file build only exists in deployed builds, not in `ng serve` or inside itself. */
  protected readonly singleFileAvailable = signal(false);

  /** Every tag used on a node or entry, sorted. */
  protected readonly allTags = computed(() => {
    const tags = new Set<string>();
    for (const n of this.data.nodes()) for (const t of n.tags ?? []) tags.add(t);
    for (const e of this.data.entries()) for (const t of e.tags ?? []) tags.add(t);
    return [...tags].sort((a, b) => a.localeCompare(b));
  });

  protected setTagColor(tag: string, color: string | undefined): Promise<void> {
    return this.data.setTagColor(tag, color);
  }

  protected readonly usageLabel = computed(() => {
    const u = this.storage.usage();
    if (!u || !u.quota) return null;
    const mb = (b: number) => (b / 1024 / 1024).toFixed(1);
    return `Using ${mb(u.usage)} MB of ${mb(u.quota)} MB available to this site.`;
  });

  constructor() {
    void this.storage.refresh();
    void this.checkSingleFile();
  }

  private async checkSingleFile(): Promise<void> {
    if (isDevMode() || location.protocol === 'file:' || location.pathname.endsWith(SINGLE_FILE_NAME)) return;
    try {
      const res = await fetch(SINGLE_FILE_NAME, { method: 'HEAD', cache: 'no-store' });
      // Guard against SPA fallbacks answering 200 with the (small) index.html.
      const size = Number(res.headers.get('content-length') ?? Infinity);
      this.singleFileAvailable.set(res.ok && (res.headers.get('content-type') ?? '').includes('html') && size > 50_000);
    } catch {
      this.singleFileAvailable.set(false);
    }
  }

  protected async exportBackup(): Promise<void> {
    await this.backup.exportToFile();
    this.toast.show('Backup downloaded.');
  }

  protected async pickBackup(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const res = await this.backup.read(file);
    if (!res.ok) {
      this.toast.error(res.error);
      return;
    }
    this.pendingWarnings.set(res.warnings);
    this.pending.set(res.data);
  }

  protected async confirmRestore(): Promise<void> {
    const data = this.pending();
    if (!data) return;
    this.pending.set(null);
    await this.backup.restore(data);
    this.toast.show(`Restored ${data.nodes.length} nodes and ${data.entries.length} entries.`);
  }

  protected async requestPersistence(): Promise<void> {
    const state = await this.storage.requestPersistence();
    if (state !== 'persisted') {
      this.toast.show('The browser declined. Installing the app or using it regularly usually helps. Keep backups.');
    }
  }

  protected setTheme(theme: ThemePreference): Promise<void> {
    return this.data.updateSettings({ theme });
  }
  protected setWeekStart(weekStartsOn: number): Promise<void> {
    return this.data.updateSettings({ weekStartsOn });
  }
  protected readonly currencies = ['EUR', 'USD', 'CHF', 'GBP', 'CAD', 'AUD', 'JPY', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK'];
  protected readonly roundingSteps = [0, 1, 5, 6, 10, 15, 30, 60];

  protected setCurrency(currency: string): Promise<void> {
    return this.data.updateSettings({ currency });
  }
  protected setRounding(patch: Partial<Rounding>): Promise<void> {
    const cur = this.data.settings().rounding ?? { minutes: 0, mode: 'up' as const };
    return this.data.updateSettings({ rounding: { ...cur, ...patch } });
  }

  protected updateIdle(patch: Partial<Pick<Settings, 'idleGuard' | 'idleAwayMinutes' | 'idleLongRunningHours'>>): Promise<void> {
    return this.data.updateSettings(patch);
  }
  /** Positive number or undefined (falls back to the default). */
  protected positive(v: number): number | undefined {
    return Number.isFinite(v) && v > 0 ? v : undefined;
  }
  protected setTemplate(templateId: string): Promise<void> {
    return this.data.updateSettings({ templateId });
  }
}
