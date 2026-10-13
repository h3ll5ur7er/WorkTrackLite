import { Directive, ElementRef, inject, input, output } from '@angular/core';

export interface LongPressEvent {
  x: number;
  y: number;
  target: EventTarget | null;
}

/**
 * Emits `appLongPress` when a touch/pen pointer is held still for `delay` ms,
 * giving touch users the same context menu that right-click opens on desktop
 * (iOS Safari never fires `contextmenu`).
 */
@Directive({
  selector: '[appLongPress]',
  host: {
    '(pointerdown)': 'onDown($event)',
    '(pointermove)': 'onMove($event)',
    '(pointerup)': 'cancel()',
    '(pointercancel)': 'cancel()',
    '(click)': 'onClick($event)',
  },
})
export class LongPressDirective {
  readonly longPressDelay = input(500);
  readonly appLongPress = output<LongPressEvent>();

  private readonly el = inject(ElementRef<HTMLElement>);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private origin: { x: number; y: number } | null = null;
  /** Swallow the click that follows a recognised long press. */
  private fired = false;

  protected onDown(ev: PointerEvent): void {
    if (ev.pointerType === 'mouse') return;
    this.cancel();
    this.fired = false;
    this.origin = { x: ev.clientX, y: ev.clientY };
    const target = ev.target;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.fired = true;
      this.appLongPress.emit({ x: this.origin!.x, y: this.origin!.y, target: target ?? this.el.nativeElement });
    }, this.longPressDelay());
  }

  protected onMove(ev: PointerEvent): void {
    if (this.origin && Math.hypot(ev.clientX - this.origin.x, ev.clientY - this.origin.y) > 10) this.cancel();
  }

  protected onClick(ev: MouseEvent): void {
    if (this.fired) {
      ev.stopPropagation();
      ev.preventDefault();
      this.fired = false;
    }
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
