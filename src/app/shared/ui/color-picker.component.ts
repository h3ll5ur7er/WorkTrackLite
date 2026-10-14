import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { PALETTE } from '../../domain/color';

/** Palette swatches as a radio group, plus "none" (inherit / default). */
@Component({
  selector: 'app-color-picker',
  template: `
    <div class="cp" role="radiogroup" [attr.aria-label]="label()">
      <label class="cp__swatch cp__swatch--none" [title]="noneLabel()">
        <input type="radio" [name]="name()" [checked]="!value()" (change)="changed.emit(undefined)" />
        <span class="cp__dot" [style.background]="inherited() ?? 'transparent'" aria-hidden="true">{{ inherited() ? '' : '∅' }}</span>
        <span class="visually-hidden">{{ noneLabel() }}</span>
      </label>
      @for (c of palette; track c.hex) {
        <label class="cp__swatch" [title]="c.name">
          <input type="radio" [name]="name()" [checked]="value() === c.hex" (change)="changed.emit(c.hex)" />
          <span class="cp__dot" [style.background]="c.hex" aria-hidden="true"></span>
          <span class="visually-hidden">{{ c.name }}</span>
        </label>
      }
    </div>
  `,
  styles: `
    .cp {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .cp__swatch {
      position: relative;
      cursor: pointer;
    }
    .cp__swatch input {
      position: absolute;
      opacity: 0;
      inset: 0;
      margin: 0;
      cursor: pointer;
    }
    .cp__dot {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      border: 2px solid var(--c-border);
      font-size: 0.75rem;
      color: var(--c-fg-3);
      box-sizing: border-box;
    }
    .cp__swatch--none .cp__dot {
      border-style: dashed;
    }
    input:checked + .cp__dot {
      border-color: var(--c-fg);
      box-shadow: 0 0 0 2px var(--c-bg-2) inset;
    }
    input:focus-visible + .cp__dot {
      outline: 2px solid var(--c-accent);
      outline-offset: 2px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ColorPickerComponent {
  readonly value = input<string | undefined>();
  /** Colour used when none is set (e.g. inherited from a parent). */
  readonly inherited = input<string | null>(null);
  readonly label = input('Colour');
  readonly name = input.required<string>();
  readonly noneLabel = input('No colour');
  readonly changed = output<string | undefined>();
  protected readonly palette = PALETTE;
}
