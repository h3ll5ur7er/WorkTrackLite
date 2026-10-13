import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, inject, input, output } from '@angular/core';

export interface MenuItem {
  label: string;
  run: () => unknown;
  danger?: boolean;
  disabled?: boolean;
}

/** A positioned, keyboard-accessible menu with a click-away backdrop. */
@Component({
  selector: 'app-context-menu',
  template: `
    <div class="ctx">
      <button
        type="button"
        class="ctx__backdrop"
        tabindex="-1"
        aria-label="Close menu"
        (click)="closed.emit()"
        (contextmenu)="$event.preventDefault(); closed.emit()"
      ></button>
      <!-- Arrow-key handling for the menu items; focus lives on the items themselves. -->
      <!-- eslint-disable-next-line @angular-eslint/template/interactive-supports-focus -->
      <ul
        class="ctx__menu"
        role="menu"
        [attr.aria-label]="label()"
        [style.left.px]="clampedX()"
        [style.top.px]="clampedY()"
        (keydown)="onKey($event)"
      >
        @for (item of items(); track item.label) {
          <li role="none">
            <button type="button" role="menuitem" [class.ctx__danger]="item.danger" [disabled]="item.disabled" (click)="choose(item)">
              {{ item.label }}
            </button>
          </li>
        }
      </ul>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContextMenuComponent {
  readonly x = input.required<number>();
  readonly y = input.required<number>();
  readonly items = input.required<MenuItem[]>();
  readonly label = input('Actions');
  readonly closed = output<void>();

  private readonly host = inject(ElementRef<HTMLElement>);

  constructor() {
    // Return focus to whatever opened the menu once it closes.
    const opener = document.activeElement as HTMLElement | null;
    afterNextRender(() =>
      this.buttons()
        .find((b) => !b.disabled)
        ?.focus(),
    );
    inject(DestroyRef).onDestroy(() => {
      if (opener?.isConnected) opener.focus();
    });
  }

  protected clampedX(): number {
    return Math.max(4, Math.min(this.x(), (globalThis.innerWidth ?? 1000) - 190));
  }
  protected clampedY(): number {
    return Math.max(4, Math.min(this.y(), (globalThis.innerHeight ?? 800) - 40 * this.items().length - 12));
  }

  protected async choose(item: MenuItem): Promise<void> {
    this.closed.emit();
    await item.run();
  }

  protected onKey(ev: KeyboardEvent): void {
    const buttons = this.buttons().filter((b) => !b.disabled);
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (ev.key === 'Escape') {
      ev.preventDefault();
      this.closed.emit();
    } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const next = (idx + (ev.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    } else if (ev.key === 'Tab') {
      this.closed.emit();
    }
  }

  private buttons(): HTMLButtonElement[] {
    return [...(this.host.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button[role=menuitem]')];
  }
}
