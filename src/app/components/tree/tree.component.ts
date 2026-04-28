import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { Node } from '../../data/models';
import { indexChildren } from '../../services/budget';

@Component({
  selector: 'app-tree',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './tree.component.html',
  styleUrl: './tree.component.scss',
})
export class TreeComponent {
  private data = inject(DataService);
  selected = signal<string | null>(null);
  filter = signal('');

  readonly childrenByParent = computed(() => indexChildren(this.data.nodes().filter(n => !n.archived)));

  readonly roots = computed(() => this.childrenByParent().get(null) ?? []);

  readonly visibleIds = computed(() => {
    const f = this.filter().trim().toLowerCase();
    if (!f) return null;
    const all = this.data.nodes();
    const matching = new Set(all.filter(n => n.name.toLowerCase().includes(f)).map(n => n.id));
    // include all ancestors so matches remain visible in the tree
    const byId = new Map(all.map(n => [n.id, n] as const));
    for (const id of [...matching]) {
      let cur = byId.get(id);
      while (cur?.parentId) {
        matching.add(cur.parentId);
        cur = byId.get(cur.parentId);
      }
    }
    return matching;
  });

  childrenOf(id: string | null): Node[] {
    return this.childrenByParent().get(id) ?? [];
  }

  isVisible(id: string): boolean {
    const v = this.visibleIds();
    return !v || v.has(id);
  }

  select(id: string) {
    this.selected.set(id);
    void this.data.updateSettings({ lastNodeId: id });
  }

  selectedNode = computed<Node | null>(() => {
    const id = this.selected();
    if (!id) return null;
    return this.data.nodes().find(n => n.id === id) ?? null;
  });
}
