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
  },
})
export class LongPressDirective {
  readonly longPressDelay = input(500);
  readonly appLongPress = output<LongPressEvent>();

  private readonly el = inject(ElementRef<HTMLElement>);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private origin: { x: number; y: number } | null = null;

  protected onDown(ev: PointerEvent): void {
    if (ev.pointerType === 'mouse') return;
    this.cancel();
    this.origin = { x: ev.clientX, y: ev.clientY };
    const target = ev.target;
    this.timer = setTimeout(() => {
      this.timer = null;
      swallowNextClick();
      this.appLongPress.emit({ x: this.origin!.x, y: this.origin!.y, target: target ?? this.el.nativeElement });
    }, this.longPressDelay());
  }

  protected onMove(ev: PointerEvent): void {
    if (this.origin && Math.hypot(ev.clientX - this.origin.x, ev.clientY - this.origin.y) > 10) this.cancel();
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

/**
 * Lifting the finger after a long press produces a click — on whatever is now
 * under it (often the backdrop of the menu that just opened). Swallow it once.
 */
export function swallowNextClick(windowMs = 800): void {
  const handler = (ev: Event) => {
    ev.stopPropagation();
    ev.preventDefault();
    done();
  };
  const done = () => {
    window.removeEventListener('click', handler, true);
    clearTimeout(timer);
  };
  const timer = setTimeout(done, windowMs);
  window.addEventListener('click', handler, true);
}
