import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { DataService } from '../../services/data.service';
import { TimerService } from '../../services/timer.service';

@Component({
    selector: 'app-timer-bar',
    imports: [CommonModule],
    template: `
    <div class="bar" [class.bar--running]="running()">
      <div class="bar__left">
        <ng-container *ngIf="running() as r; else idle">
          <span class="bar__dot"></span>
          <strong>{{ activeNodeName() }}</strong>
          <span class="bar__elapsed">{{ format(timer.elapsedSeconds()) }}</span>
        </ng-container>
        <ng-template #idle>
          <span class="bar__idle">No active timer</span>
        </ng-template>
      </div>
      <div class="bar__right">
        <button *ngIf="running()" class="btn btn--danger" (click)="timer.stop()">■ Stop</button>
        <button *ngIf="!running() && data.settings().lastNodeId" class="btn"
                (click)="timer.resumeLast()">▶ Resume last</button>
      </div>
    </div>
  `,
    styles: [`
    .bar {
      display: flex; justify-content: space-between; align-items: center;
      gap: 12px; padding: 8px 14px;
      background: var(--c-bg-2); border-top: 1px solid var(--c-border);
      font-variant-numeric: tabular-nums;
    }
    .bar--running { background: var(--c-accent-bg); }
    .bar__left { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; }
    .bar__dot { width: 10px; height: 10px; border-radius: 50%; background: var(--c-danger); animation: pulse 1.2s ease-in-out infinite; }
    .bar__elapsed { color: var(--c-accent); font-weight: 600; }
    .bar__idle { color: var(--c-fg-3); }
    .bar__right { display: flex; gap: 6px; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
  `]
})
export class TimerBarComponent {
  data = inject(DataService);
  timer = inject(TimerService);

  readonly running = this.timer.running;
  readonly activeNodeName = computed(() => {
    const r = this.running();
    if (!r) return '';
    return this.data.nodes().find(n => n.id === r.nodeId)?.name ?? '(deleted)';
  });

  format(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
}
