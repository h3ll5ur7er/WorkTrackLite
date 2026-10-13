import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService } from '../../core/toast.service';

@Component({
  selector: 'app-toasts',
  template: `
    <div class="toasts" role="status" aria-live="polite">
      @for (t of toasts.toasts(); track t.id) {
        <div class="toast" [class.toast--error]="t.kind === 'error'">
          <span class="toast__msg">{{ t.message }}</span>
          @if (t.action; as a) {
            <button type="button" class="btn btn--small" (click)="toasts.runAction(t)">{{ a.label }}</button>
          }
          <button type="button" class="btn btn--ghost btn--small" aria-label="Dismiss" (click)="toasts.dismiss(t.id)">×</button>
        </div>
      }
    </div>
  `,
  styles: `
    .toasts {
      position: fixed;
      left: 50%;
      bottom: 72px;
      transform: translateX(-50%);
      display: flex;
      flex-direction: column;
      gap: 6px;
      z-index: 1200;
      width: min(480px, calc(100vw - 24px));
      pointer-events: none;
    }
    @media (max-width: 720px) {
      .toasts {
        bottom: 132px; /* above the timer bar and the bottom navigation */
      }
    }
    .toast {
      pointer-events: auto;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px 8px 14px;
      background: var(--c-bg-2);
      border: 1px solid var(--c-border);
      border-left: 3px solid var(--c-accent);
      border-radius: 6px;
      box-shadow: 0 8px 24px var(--c-shadow);
    }
    .toast--error {
      border-left-color: var(--c-danger);
    }
    .toast__msg {
      flex: 1;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToastsComponent {
  protected readonly toasts = inject(ToastService);
}
