import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DataService } from '../../core/data.service';
import { TimerService } from '../../core/timer.service';
import { formatHMS } from '../../domain/format';

@Component({
  selector: 'app-timer-bar',
  template: `
    <div class="bar" [class.bar--running]="timer.running()">
      <div class="bar__left">
        @if (timer.running(); as r) {
          <span class="bar__dot" aria-hidden="true"></span>
          <span class="bar__name" [title]="activePath()">{{ activeName() }}</span>
          <span class="bar__elapsed" role="timer" aria-label="Elapsed time">{{ elapsed() }}</span>
        } @else {
          <span class="bar__idle">No active timer</span>
        }
      </div>
      <div class="bar__right">
        @if (timer.running()) {
          <button type="button" class="btn btn--danger" (click)="timer.stop()">■ Stop</button>
        } @else if (lastNodeName(); as last) {
          <button type="button" class="btn" (click)="timer.resumeLast()" [title]="'Start a new timer on ' + last">
            ▶ Resume {{ last }}
          </button>
        }
      </div>
    </div>
  `,
  styles: `
    .bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 8px 14px;
      background: var(--c-bg-2);
      border-top: 1px solid var(--c-border);
      font-variant-numeric: tabular-nums;
    }
    .bar--running {
      background: var(--c-accent-bg);
    }
    .bar__left {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      flex: 1;
    }
    .bar__name {
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .bar__dot {
      flex: 0 0 auto;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--c-danger);
      animation: pulse 1.2s ease-in-out infinite;
    }
    .bar__elapsed {
      color: var(--c-accent);
      font-weight: 600;
    }
    .bar__idle {
      color: var(--c-fg-3);
    }
    .bar__right {
      display: flex;
      gap: 6px;
    }
    @keyframes pulse {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.4;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .bar__dot {
        animation: none;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TimerBarComponent {
  private readonly data = inject(DataService);
  protected readonly timer = inject(TimerService);

  protected readonly elapsed = computed(() => formatHMS(this.timer.elapsedSeconds()));
  protected readonly activeName = computed(() => {
    const r = this.timer.running();
    return r ? (this.data.tree().get(r.nodeId)?.name ?? '(deleted)') : '';
  });
  protected readonly activePath = computed(() => {
    const r = this.timer.running();
    return r ? this.data.tree().pathLabel(r.nodeId) : '';
  });
  protected readonly lastNodeName = computed(() => {
    const n = this.data.tree().get(this.data.settings().lastNodeId);
    return n && !n.archived ? n.name : null;
  });
}
