import { CommonModule } from '@angular/common';
import { Component, AfterViewInit, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DataService } from './services/data.service';
import { TreeComponent } from './components/tree/tree.component';
import { NodeDetailComponent } from './components/node-detail/node-detail.component';
import { TimerBarComponent } from './components/timer-bar/timer-bar.component';
import { CommandPaletteComponent } from './components/command-palette/command-palette.component';
import { SetupComponent } from './components/setup/setup.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { ScheduleComponent } from './components/schedule/schedule.component';
import { AppView } from './data/models';

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
        DashboardComponent,
        ScheduleComponent,
    ],
    templateUrl: './app.component.html',
    styleUrl: './app.component.scss'
})
export class AppComponent implements AfterViewInit {
  data = inject(DataService);

  @ViewChild(TreeComponent) treeRef?: TreeComponent;
  @ViewChild(CommandPaletteComponent) paletteRef?: CommandPaletteComponent;
  @ViewChild(DashboardComponent) dashboardRef?: DashboardComponent;

  readonly empty = computed(() => this.data.nodes().length === 0);
  showAddRoot = signal(false);
  newRootName = signal('');
  newRootKind = signal('');

  readonly view = computed<AppView>(() => this.data.settings().view ?? 'dashboard');

  readonly views: Array<{ id: AppView; label: string; icon: string }> = [
    { id: 'dashboard', label: 'Dashboard', icon: '▦' },
    { id: 'schedule', label: 'Schedule',   icon: '🗓' },
    { id: 'manage',   label: 'Manage',     icon: '⚙' },
  ];

  constructor() {
    // Hook the dashboard's "Open in Manage" callback whenever it's mounted
    effect(() => {
      if (this.dashboardRef) {
        this.dashboardRef.openInManageFn = (id) => this.openInManage(id);
      }
    });
  }

  ngAfterViewInit(): void {
    if (this.paletteRef) this.paletteRef.selectNode = (id) => this.openInManage(id);
  }

  setView(v: AppView) { void this.data.updateSettings({ view: v }); }

  openInManage(nodeId: string) {
    void this.data.updateSettings({ view: 'manage', lastNodeId: nodeId });
    queueMicrotask(() => this.treeRef?.select(nodeId));
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
