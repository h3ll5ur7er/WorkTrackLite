import { CommonModule } from '@angular/common';
import { Component, AfterViewInit, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DataService } from './services/data.service';
import { TreeComponent } from './components/tree/tree.component';
import { NodeDetailComponent } from './components/node-detail/node-detail.component';
import { TimerBarComponent } from './components/timer-bar/timer-bar.component';
import { CommandPaletteComponent } from './components/command-palette/command-palette.component';
import { SetupComponent } from './components/setup/setup.component';

@Component({
    selector: 'app-root',
    imports: [
        CommonModule,
        FormsModule,
        TreeComponent,
        NodeDetailComponent,
        TimerBarComponent,
        CommandPaletteComponent,
        SetupComponent,
    ],
    templateUrl: './app.component.html',
    styleUrl: './app.component.scss'
})
export class AppComponent implements AfterViewInit {
  data = inject(DataService);

  @ViewChild(TreeComponent) treeRef?: TreeComponent;
  @ViewChild(CommandPaletteComponent) paletteRef?: CommandPaletteComponent;

  readonly empty = computed(() => this.data.nodes().length === 0);
  showAddRoot = signal(false);
  newRootName = signal('');
  newRootKind = signal('');

  ngAfterViewInit(): void {
    if (this.paletteRef) this.paletteRef.selectNode = (id) => this.treeRef?.select(id);
  }

  toggleTheme(): void {
    const t = this.data.settings().theme === 'dark' ? 'light' : 'dark';
    void this.data.updateSettings({ theme: t });
  }

  async addRoot(): Promise<void> {
    const name = this.newRootName().trim();
    if (!name) return;
    const tplId = this.data.settings().templateId;
    const tpl = this.data.templates().find(t => t.id === tplId);
    const kind = this.newRootKind().trim() || tpl?.levels[0] || 'Item';
    const id = await this.data.addNode({ parentId: null, name, kind });
    this.newRootName.set('');
    this.newRootKind.set('');
    this.showAddRoot.set(false);
    this.treeRef?.select(id);
  }

  openPalette(): void { this.paletteRef?.openPalette(); }
}
