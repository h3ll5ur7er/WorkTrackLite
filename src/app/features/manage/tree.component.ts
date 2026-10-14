import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { DataService } from '../../core/data.service';
import { Node } from '../../core/models';

/** Hierarchy sidebar with filter and an archived toggle. Selection is a router link. */
@Component({
  selector: 'app-tree',
  imports: [RouterLink, NgTemplateOutlet],
  templateUrl: './tree.component.html',
  styleUrl: './tree.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TreeComponent {
  private readonly data = inject(DataService);

  readonly selectedId = input<string | null>(null);
  protected readonly filter = signal('');
  protected readonly showArchived = signal(false);

  protected readonly roots = computed(() => this.data.tree().roots({ includeArchived: this.showArchived() }));
  protected readonly hasArchived = computed(() => this.data.nodes().some((n) => n.archived));

  /** Matching nodes plus their ancestors, or null when not filtering. */
  protected readonly visibleIds = computed(() => {
    const f = this.filter().trim().toLowerCase();
    if (!f) return null;
    const tree = this.data.tree();
    const out = new Set<string>();
    for (const n of tree.nodes) {
      if (n.name.toLowerCase().includes(f) || n.kind.toLowerCase().includes(f)) {
        out.add(n.id);
        for (const a of tree.ancestorIds(n.id)) out.add(a);
      }
    }
    return out;
  });

  protected childrenOf(n: Node): Node[] {
    return this.data.tree().childrenOf(n.id, { includeArchived: this.showArchived() });
  }

  protected colorOf(id: string): string | null {
    return this.data.tree().colorOf(id);
  }

  protected isVisible(id: string): boolean {
    const v = this.visibleIds();
    return !v || v.has(id);
  }
}
