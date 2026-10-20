import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DataService } from '../../core/data.service';
import { NodeDetailComponent } from './node-detail.component';
import { TreeComponent } from './tree.component';

/** Two-pane editor; the selected node lives in the URL (#/manage/:nodeId). */
@Component({
  selector: 'app-manage',
  imports: [TreeComponent, NodeDetailComponent],
  template: `
    <div class="manage">
      <aside class="manage__sidebar" [class.manage__sidebar--collapsed]="treeCollapsed()" aria-label="Hierarchy">
        <!-- Phones only: the tree folds away once a node is open, so its details get the screen. -->
        <button
          type="button"
          class="btn manage__toggle"
          aria-controls="manage-tree"
          [attr.aria-expanded]="!treeCollapsed()"
          (click)="treeCollapsed.set(!treeCollapsed())"
        >
          <span aria-hidden="true">{{ treeCollapsed() ? '▸' : '▾' }}</span> All nodes ({{ nodeCount() }})
        </button>
        <button
          type="button"
          class="btn btn--primary manage__add"
          [attr.aria-expanded]="showAddRoot()"
          (click)="showAddRoot.set(!showAddRoot())"
        >
          + New top-level
        </button>
        @if (showAddRoot()) {
          <form class="row manage__add" (submit)="$event.preventDefault(); addRoot()">
            <input aria-label="Name" placeholder="Name" [value]="newRootName()" (input)="newRootName.set($any($event.target).value)" />
            <input
              aria-label="Kind"
              [placeholder]="'Kind (' + rootKind() + ')'"
              [value]="newRootKind()"
              (input)="newRootKind.set($any($event.target).value)"
            />
            <button type="submit" class="btn" [disabled]="!newRootName().trim()">Add</button>
          </form>
        }
        <app-tree id="manage-tree" [selectedId]="nodeId() ?? null" />
      </aside>
      <section class="manage__content">
        <app-node-detail [node]="selected()" />
      </section>
    </div>
  `,
  styles: `
    :host {
      display: block;
      flex: 1;
      min-height: 0;
    }
    .manage {
      display: grid;
      grid-template-columns: minmax(220px, 300px) 1fr;
      height: 100%;
      min-height: 0;
    }
    .manage__sidebar {
      border-right: 1px solid var(--c-border);
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-height: 0;
      overflow: hidden;
    }
    .manage__content {
      padding: 16px 20px 32px;
      overflow: auto;
    }
    .manage__toggle {
      display: none;
    }
    @media (max-width: 720px) {
      .manage {
        grid-template-columns: 1fr;
        grid-template-rows: auto minmax(0, 1fr);
      }
      .manage__sidebar {
        max-height: 50vh;
        border-right: 0;
        border-bottom: 1px solid var(--c-border);
      }
      .manage__toggle {
        display: block;
        text-align: left;
      }
      .manage__sidebar--collapsed app-tree,
      .manage__sidebar--collapsed .manage__add {
        display: none;
      }
      .manage__content {
        padding: 12px 14px 24px;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManageComponent {
  private readonly data = inject(DataService);
  private readonly router = inject(Router);

  /** Route parameter (bound via withComponentInputBinding). */
  readonly nodeId = input<string | undefined>();

  protected readonly selected = computed(() => this.data.tree().get(this.nodeId()) ?? null);
  protected readonly showAddRoot = signal(false);
  protected readonly nodeCount = computed(() => this.data.nodes().length);
  /** Phones: folded while a node is open; opening another node folds it again. */
  protected readonly treeCollapsed = linkedSignal(() => !!this.nodeId());
  protected readonly newRootName = signal('');
  protected readonly newRootKind = signal('');
  protected readonly rootKind = computed(() => this.data.activeTemplate()?.levels[0] ?? 'Item');

  protected async addRoot(): Promise<void> {
    const name = this.newRootName().trim();
    if (!name) return;
    const id = await this.data.addNode({ parentId: null, name, kind: this.newRootKind().trim() || this.rootKind() });
    this.newRootName.set('');
    this.newRootKind.set('');
    this.showAddRoot.set(false);
    await this.router.navigate(['/manage', id]);
  }
}
