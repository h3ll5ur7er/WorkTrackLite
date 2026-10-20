import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, computed, inject, linkedSignal } from '@angular/core';
import { DataService } from '../../core/data.service';
import { IdleService, pendingEntry } from '../../core/idle.service';
import { suggestedStop } from '../../domain/idle';
import { formatClock, formatHM } from '../../domain/format';
import { fromLocalInput, isSameDay, toLocalInput } from '../../domain/time';

/** Asks what to do with a timer that kept running while the user was away (see IdleService). */
@Component({
  selector: 'app-idle-dialog',
  template: `
    @if (idle.pending(); as p) {
      @if (entry(); as e) {
        <div class="idle">
          <div class="idle__panel" role="alertdialog" aria-modal="true" aria-labelledby="idle-title" aria-describedby="idle-desc">
            <h2 id="idle-title">{{ heading() }}</h2>
            <p id="idle-desc">{{ description() }}</p>

            @if (p.reason === 'away') {
              <div class="idle__actions">
                <button type="button" class="btn btn--primary" (click)="idle.resolve({ kind: 'split' })">
                  Remove away time, keep timing
                </button>
                <button type="button" class="btn" (click)="idle.resolve({ kind: 'stop-at', at: p.awayFrom! })">
                  Stop at {{ clock(p.awayFrom!) }}
                </button>
                <button type="button" class="btn btn--ghost" (click)="idle.resolve({ kind: 'keep' })">Keep all</button>
              </div>
            } @else {
              <label class="field idle__stop">
                <span>Stop at</span>
                <input type="datetime-local" [value]="stopInput()" (change)="setStop($any($event.target).value)" />
              </label>
              @if (stopError(); as err) {
                <p class="error" role="alert">{{ err }}</p>
              }
              <div class="idle__actions">
                <button
                  type="button"
                  class="btn btn--primary"
                  [disabled]="!!stopError()"
                  (click)="idle.resolve({ kind: 'stop-at', at: stopAt() })"
                >
                  Stop at {{ clock(stopAt()) }}
                </button>
                <button type="button" class="btn" (click)="idle.resolve({ kind: 'stop-at', at: now() })">Stop now</button>
                <button type="button" class="btn btn--ghost" (click)="idle.resolve({ kind: 'keep' })">Keep running</button>
              </div>
            }
          </div>
        </div>
      }
    }
  `,
  styles: `
    .idle {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1150;
      padding: 16px;
    }
    .idle__panel {
      width: min(480px, 100%);
      max-height: calc(100vh - 32px);
      max-height: calc(100dvh - 32px);
      overflow-y: auto;
      background: var(--c-bg-2);
      border: 1px solid var(--c-border);
      border-left: 3px solid var(--c-warn);
      border-radius: 10px;
      padding: 16px 18px;
      box-shadow: 0 24px 64px var(--c-shadow);
    }
    h2 {
      margin: 0 0 8px;
      font-size: 1.05rem;
    }
    .idle__actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
    }
    .idle__stop {
      max-width: 240px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IdleDialogComponent implements AfterViewInit {
  protected readonly idle = inject(IdleService);
  private readonly data = inject(DataService);
  private readonly host = inject(ElementRef<HTMLElement>);

  protected readonly entry = computed(() => pendingEntry(this.data, this.idle.pending()));
  protected readonly now = () => Date.now();

  protected readonly stopAt = linkedSignal(() => {
    const e = this.entry();
    return e ? suggestedStop(e, Date.now()) : Date.now();
  });
  protected readonly stopInput = computed(() => toLocalInput(this.stopAt()));
  protected readonly stopError = computed(() => {
    const e = this.entry();
    const t = this.stopAt();
    if (!e) return null;
    if (t <= e.start) return 'Must be after the timer started.';
    if (t > Date.now()) return 'Cannot be in the future.';
    return null;
  });

  private readonly nodeName = computed(() => {
    const e = this.entry();
    return e ? (this.data.tree().get(e.nodeId)?.name ?? '(deleted)') : '';
  });

  protected readonly heading = computed(() => {
    switch (this.idle.pending()?.reason) {
      case 'away':
        return 'Welcome back — the timer kept running';
      case 'midnight':
        return 'This timer has been running since yesterday';
      default:
        return 'This timer has been running for a long time';
    }
  });

  protected readonly description = computed(() => {
    const p = this.idle.pending();
    const e = this.entry();
    if (!p || !e) return '';
    if (p.reason === 'away') {
      return `“${this.nodeName()}” was running while this app was closed or the device was asleep, ${this.clock(p.awayFrom!)}–${this.clock(p.awayTo!)} (${formatHM((p.awayTo! - p.awayFrom!) / 1000)}).`;
    }
    return `“${this.nodeName()}” started ${this.clock(e.start)} and has run ${formatHM((Date.now() - e.start) / 1000)}. Did you forget to stop it?`;
  });

  ngAfterViewInit(): void {
    (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>('button')?.focus();
  }

  protected setStop(value: string): void {
    const t = fromLocalInput(value);
    if (t != null) this.stopAt.set(t);
  }

  /** "14:05", or "Mon 14:05" when not today. */
  protected clock(ms: number): string {
    return isSameDay(ms, Date.now())
      ? formatClock(ms)
      : `${new Date(ms).toLocaleDateString(undefined, { weekday: 'short' })} ${formatClock(ms)}`;
  }
}
