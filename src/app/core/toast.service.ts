import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error';
  action?: { label: string; run: () => unknown };
}

/** Short-lived notifications with an optional action (e.g. "Undo"). */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private nextId = 1;

  show(message: string, opts: { action?: Toast['action']; kind?: Toast['kind']; durationMs?: number } = {}): number {
    const id = this.nextId++;
    this.toasts.update((ts) => [...ts.slice(-2), { id, message, kind: opts.kind ?? 'info', action: opts.action }]);
    setTimeout(() => this.dismiss(id), opts.durationMs ?? 6000);
    return id;
  }

  error(message: string): number {
    return this.show(message, { kind: 'error', durationMs: 10000 });
  }

  dismiss(id: number): void {
    this.toasts.update((ts) => ts.filter((t) => t.id !== id));
  }

  async runAction(t: Toast): Promise<void> {
    this.dismiss(t.id);
    await t.action?.run();
  }
}
