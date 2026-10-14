import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DataService } from '../../core/data.service';
import { readableTextColor } from '../../domain/color';

/** Tags as small chips, coloured with the tag colours from Settings. */
@Component({
  selector: 'app-tag-chips',
  template: `
    @for (t of chips(); track t.name) {
      <span class="chip" [style.background]="t.bg" [style.color]="t.fg" [style.border-color]="t.bg ?? null">{{ t.name }}</span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .chip {
      font-size: 0.7rem;
      line-height: 1.5;
      padding: 0 7px;
      border-radius: 999px;
      border: 1px solid var(--c-border);
      color: var(--c-fg-3);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TagChipsComponent {
  private readonly data = inject(DataService);
  readonly tags = input<readonly string[] | undefined>([]);
  protected readonly chips = computed(() => {
    const colors = this.data.settings().tagColors ?? {};
    return (this.tags() ?? []).map((name) => {
      const bg = colors[name];
      return { name, bg: bg ?? null, fg: bg ? readableTextColor(bg) : null };
    });
  });
}
