import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Node, TimeEntry } from '../../data/models';
import { DataService } from '../../services/data.service';
import { TimerService } from '../../services/timer.service';
import { indexChildren } from '../../services/budget';
import { EntryEditorComponent, EntryDraft } from '../entry-editor/entry-editor.component';

const MS_PER_MIN = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const SNAP_MIN = 15;
const SNAP_NEIGHBOR_MIN = 10; // snap window for neighboring block edges

interface RenderedBlock {
  entry: TimeEntry;
  node: Node | null;
  pathLabel: string;
  topPct: number;     // 0..100 (relative to one day)
  heightPct: number;  // 0..100
  laneIdx: number;    // for overlap handling
  laneCount: number;
  overlap: boolean;
}

interface DragState {
  kind: 'move' | 'resize-start' | 'resize-end';
  entryId: string;
  pointerStartY: number;
  pointerStartX: number;
  origStart: number;
  origEnd: number;
  origDayIndex: number;
  pxPerMs: number;
  colWidth: number;
  shift: boolean;
  // live preview values:
  previewStart: number;
  previewEnd: number;
}

@Component({
  selector: 'app-schedule',
  imports: [CommonModule, FormsModule, EntryEditorComponent],
  templateUrl: './schedule.component.html',
  styleUrl: './schedule.component.scss',
})
export class ScheduleComponent implements OnDestroy {
  private data = inject(DataService);
  protected timer = inject(TimerService);

  /** Week anchor: midnight of the first visible day. */
  readonly weekStart = signal<number>(this.startOfWeek(Date.now()));
  /** Pixel height of one day's full timeline (24h). User-tweakable later. */
  readonly dayHeightPx = signal<number>(24 * 56);

  readonly grid = viewChild<ElementRef<HTMLDivElement>>('grid');

  // --- Drag state ---
  private dragState: DragState | null = null;
  private dragRaf = 0;
  /** Live preview render: entryId → {start,end} while a drag is happening. */
  readonly dragPreview = signal<Record<string, { start: number; end: number }> | null>(null);

  // --- Tree-template drag state ---
  /** Node id currently being dragged from the tree (or null). */
  readonly templateDragNodeId = signal<string | null>(null);
  /** Live ghost preview while dragging a template into the grid. */
  readonly templateDragPreview = signal<{ dayIdx: number; topPct: number; heightPct: number } | null>(null);

  // --- Context menu + clipboard ---
  readonly menu = signal<{ x: number; y: number; entryId?: string; dayIdx?: number; minutes?: number } | null>(null);
  readonly clipboard = signal<TimeEntry | null>(null);

  // --- Editor modal ---
  readonly editor = signal<{ open: boolean; draft: EntryDraft } | null>(null);

  constructor() {
    // Re-anchor week if user changes weekStartsOn setting
    effect(() => {
      const ws = this.data.settings().weekStartsOn ?? 1;
      const cur = new Date(this.weekStart());
      const want = this.startOfWeek(cur.getTime(), ws);
      if (want !== this.weekStart()) this.weekStart.set(want);
    });
  }

  // ---------- Week navigation ----------

  startOfWeek(ms: number, weekStartsOn: number = this.data.settings().weekStartsOn ?? 1): number {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    const delta = (day - weekStartsOn + 7) % 7;
    d.setDate(d.getDate() - delta);
    return d.getTime();
  }

  prevWeek() { this.weekStart.set(this.weekStart() - 7 * MS_PER_DAY); }
  nextWeek() { this.weekStart.set(this.weekStart() + 7 * MS_PER_DAY); }
  thisWeek() { this.weekStart.set(this.startOfWeek(Date.now())); }

  readonly days = computed(() => {
    const start = this.weekStart();
    return Array.from({ length: 7 }, (_, i) => {
      const ms = start + i * MS_PER_DAY;
      return {
        ms,
        label: new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'numeric', day: 'numeric' }),
        isToday: this.isSameDay(ms, Date.now()),
      };
    });
  });

  readonly hours = Array.from({ length: 24 }, (_, i) => i);

  isSameDay(a: number, b: number) {
    const da = new Date(a), db = new Date(b);
    return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
  }

  // ---------- Layout ----------

  /**
   * Splits an entry that crosses midnight into per-day segments. Each segment
   * is keyed by `dayIdx` (0..6) and clamped to that day's [0, MS_PER_DAY).
   */
  private segmentsForEntry(entry: TimeEntry, end: number, weekStart: number): Array<{ dayIdx: number; from: number; to: number }> {
    const segs: Array<{ dayIdx: number; from: number; to: number }> = [];
    for (let i = 0; i < 7; i++) {
      const dayStart = weekStart + i * MS_PER_DAY;
      const dayEnd = dayStart + MS_PER_DAY;
      const from = Math.max(entry.start, dayStart);
      const to = Math.min(end, dayEnd);
      if (to > from) segs.push({ dayIdx: i, from: from - dayStart, to: to - dayStart });
    }
    return segs;
  }

  readonly columns = computed(() => {
    const ws = this.weekStart();
    const now = this.timer.now();
    const entries = this.data.entries();
    const byId = new Map(this.data.nodes().map(n => [n.id, n] as const));
    const previews = this.dragPreview();

    // Build path labels lazily
    const pathCache = new Map<string, string>();
    const pathOf = (id: string): string => {
      const cached = pathCache.get(id);
      if (cached !== undefined) return cached;
      const n = byId.get(id);
      if (!n) return '';
      const p = n.parentId ? pathOf(n.parentId) + ' / ' + n.name : n.name;
      pathCache.set(id, p);
      return p;
    };

    // Per-day list of placed segments first, then assign overlap lanes.
    const days: Array<Array<RenderedBlock & { from: number; to: number }>> = Array.from({ length: 7 }, () => []);
    for (const e of entries) {
      // running entry shows as static placeholder - skip the live segment if it
      // grew past now. Use start..start+1min so it appears as a faint mark.
      let liveStart = e.start;
      let liveEnd = e.end ?? Math.min(e.start + MS_PER_MIN, now);
      // Apply preview overrides
      const pv = previews?.[e.id];
      if (pv) { liveStart = pv.start; liveEnd = pv.end; }
      if (liveEnd <= ws || liveStart >= ws + 7 * MS_PER_DAY) continue;
      const segs = this.segmentsForEntry({ ...e, start: liveStart }, liveEnd, ws);
      for (const seg of segs) {
        days[seg.dayIdx].push({
          entry: e,
          node: byId.get(e.nodeId) ?? null,
          pathLabel: pathOf(e.nodeId),
          topPct: (seg.from / MS_PER_DAY) * 100,
          heightPct: ((seg.to - seg.from) / MS_PER_DAY) * 100,
          laneIdx: 0,
          laneCount: 1,
          overlap: false,
          from: seg.from,
          to: seg.to,
        });
      }
    }

    // Lane assignment per day for overlapping rendering
    for (const list of days) {
      list.sort((a, b) => a.from - b.from || a.to - b.to);
      // greedy: keep currently active lanes; place into first lane that ended before this starts
      const lanesEnd: number[] = [];
      for (const b of list) {
        let placed = -1;
        for (let i = 0; i < lanesEnd.length; i++) {
          if (lanesEnd[i] <= b.from) { placed = i; break; }
        }
        if (placed === -1) { placed = lanesEnd.length; lanesEnd.push(0); }
        b.laneIdx = placed;
        lanesEnd[placed] = b.to;
      }
      // count concurrent lanes for each block, and flag overlapping
      for (const b of list) {
        let count = 0;
        for (const o of list) {
          if (o.from < b.to && o.to > b.from) count++;
        }
        b.laneCount = Math.max(1, count);
        b.overlap = count > 1;
      }
    }
    return days;
  });

  // ---------- Drag/resize ----------

  private snap(ms: number, shift: boolean): number {
    if (shift) return Math.round(ms / MS_PER_MIN) * MS_PER_MIN;
    return Math.round(ms / (SNAP_MIN * MS_PER_MIN)) * SNAP_MIN * MS_PER_MIN;
  }

  private snapToNeighbors(absMs: number, shift: boolean, ignoreEntryId: string): number {
    if (shift) return absMs;
    const win = SNAP_NEIGHBOR_MIN * MS_PER_MIN;
    let best = absMs;
    let bestDelta = win + 1;
    for (const e of this.data.entries()) {
      if (e.id === ignoreEntryId || e.end == null) continue;
      for (const edge of [e.start, e.end]) {
        const d = Math.abs(edge - absMs);
        if (d < bestDelta) { bestDelta = d; best = edge; }
      }
    }
    return bestDelta <= win ? best : absMs;
  }

  onBlockPointerDown(ev: PointerEvent, block: RenderedBlock & { from: number; to: number }, kind: DragState['kind']) {
    if (ev.button !== 0) return;
    if (block.entry.end == null) return; // running entry not draggable
    ev.preventDefault();
    ev.stopPropagation();
    const dayHeight = this.dayHeightPx();
    this.dragState = {
      kind,
      entryId: block.entry.id,
      pointerStartY: ev.clientY,
      pointerStartX: ev.clientX,
      origStart: block.entry.start,
      origEnd: block.entry.end!,
      origDayIndex: this.dayIndexFor(block.entry.start),
      pxPerMs: dayHeight / MS_PER_DAY,
      colWidth: this.measureDayColumn(),
      shift: ev.shiftKey,
      previewStart: block.entry.start,
      previewEnd: block.entry.end!,
    };
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('keydown', this.onShiftCheck);
    window.addEventListener('keyup', this.onShiftCheck);
  }

  private dayIndexFor(ms: number): number {
    return Math.floor((ms - this.weekStart()) / MS_PER_DAY);
  }

  private measureDayColumn(): number {
    const g = this.grid()?.nativeElement;
    if (!g) return 100;
    const cols = g.querySelectorAll('.sched__col');
    if (!cols.length) return 100;
    return (cols[0] as HTMLElement).getBoundingClientRect().width;
  }

  private onShiftCheck = (e: KeyboardEvent) => {
    if (this.dragState) this.dragState.shift = e.shiftKey;
  };

  private onPointerMove = (ev: PointerEvent) => {
    const s = this.dragState;
    if (!s) return;
    s.shift = ev.shiftKey;
    if (this.dragRaf) cancelAnimationFrame(this.dragRaf);
    this.dragRaf = requestAnimationFrame(() => this.applyDrag(ev));
  };

  private applyDrag(ev: PointerEvent) {
    const s = this.dragState!;
    const dy = ev.clientY - s.pointerStartY;
    const dx = ev.clientX - s.pointerStartX;
    const dtMs = dy / s.pxPerMs;
    const colShift = s.kind === 'move' ? Math.round(dx / Math.max(1, s.colWidth)) : 0;
    let newStart = s.origStart;
    let newEnd = s.origEnd;
    if (s.kind === 'move') {
      newStart = s.origStart + dtMs + colShift * MS_PER_DAY;
      newEnd = s.origEnd + dtMs + colShift * MS_PER_DAY;
      // snap start
      let sn = this.snap(newStart, s.shift);
      sn = this.snapToNeighbors(sn, s.shift, s.entryId);
      const delta = sn - newStart;
      newStart += delta; newEnd += delta;
    } else if (s.kind === 'resize-start') {
      newStart = s.origStart + dtMs;
      let sn = this.snap(newStart, s.shift);
      sn = this.snapToNeighbors(sn, s.shift, s.entryId);
      newStart = Math.min(sn, newEnd - SNAP_MIN * MS_PER_MIN);
    } else if (s.kind === 'resize-end') {
      newEnd = s.origEnd + dtMs;
      let sn = this.snap(newEnd, s.shift);
      sn = this.snapToNeighbors(sn, s.shift, s.entryId);
      newEnd = Math.max(sn, newStart + SNAP_MIN * MS_PER_MIN);
    }
    s.previewStart = newStart;
    s.previewEnd = newEnd;
    this.dragPreview.set({ [s.entryId]: { start: newStart, end: newEnd } });
  }

  private onPointerUp = async () => {
    const s = this.dragState;
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('keydown', this.onShiftCheck);
    window.removeEventListener('keyup', this.onShiftCheck);
    this.dragState = null;
    this.dragPreview.set(null);
    if (!s) return;
    if (s.previewStart === s.origStart && s.previewEnd === s.origEnd) return;
    await this.data.updateEntry(s.entryId, { start: s.previewStart, end: s.previewEnd });
  };

  ngOnDestroy(): void {
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('keydown', this.onShiftCheck);
    window.removeEventListener('keyup', this.onShiftCheck);
    if (this.dragRaf) cancelAnimationFrame(this.dragRaf);
    this.dragState = null;
    this.dragPreview.set(null);
  }

  // ---------- Click / context menu / editing ----------

  onBlockClick(ev: MouseEvent, block: RenderedBlock) {
    ev.stopPropagation();
    this.openEditorFor(block.entry);
  }

  onBlockContext(ev: MouseEvent, block: RenderedBlock) {
    ev.preventDefault();
    ev.stopPropagation();
    this.menu.set({ x: ev.clientX, y: ev.clientY, entryId: block.entry.id });
  }

  onColContext(ev: MouseEvent, dayIdx: number) {
    ev.preventDefault();
    const minutes = this.minutesFromEvent(ev, dayIdx);
    this.menu.set({ x: ev.clientX, y: ev.clientY, dayIdx, minutes });
  }

  private minutesFromEvent(ev: MouseEvent, dayIdx: number): number {
    const colEl = (ev.currentTarget as HTMLElement);
    const rect = colEl.getBoundingClientRect();
    const y = ev.clientY - rect.top;
    const ratio = Math.max(0, Math.min(1, y / rect.height));
    const totalMin = ratio * 24 * 60;
    return Math.round(totalMin / SNAP_MIN) * SNAP_MIN;
  }

  closeMenu() { this.menu.set(null); }

  async menuEdit() {
    const m = this.menu(); this.closeMenu();
    if (!m?.entryId) return;
    const e = this.data.entries().find(x => x.id === m.entryId);
    if (e) this.openEditorFor(e);
  }
  async menuDelete() {
    const m = this.menu(); this.closeMenu();
    if (!m?.entryId) return;
    if (!confirm('Delete this entry?')) return;
    await this.data.deleteEntry(m.entryId);
  }
  menuCopy() {
    const m = this.menu(); this.closeMenu();
    if (!m?.entryId) return;
    const e = this.data.entries().find(x => x.id === m.entryId);
    if (e) this.clipboard.set({ ...e });
  }
  async menuPaste() {
    const m = this.menu(); this.closeMenu();
    const cb = this.clipboard();
    if (!cb || m?.dayIdx == null || m?.minutes == null) return;
    const dayStart = this.weekStart() + m.dayIdx * MS_PER_DAY;
    const start = dayStart + m.minutes * MS_PER_MIN;
    const dur = (cb.end ?? cb.start + MS_PER_HOUR) - cb.start;
    await this.data.addManualEntry(cb.nodeId, start, start + dur, cb.note);
  }
  menuNew() {
    const m = this.menu(); this.closeMenu();
    if (m?.dayIdx == null || m?.minutes == null) return;
    const dayStart = this.weekStart() + m.dayIdx * MS_PER_DAY;
    const start = dayStart + m.minutes * MS_PER_MIN;
    this.openEditorFor(null, start);
  }

  openEditorFor(entry: TimeEntry | null, fallbackStart?: number) {
    if (entry) {
      this.editor.set({
        open: true,
        draft: { id: entry.id, nodeId: entry.nodeId, start: entry.start, end: entry.end ?? entry.start + MS_PER_HOUR, note: entry.note },
      });
    } else {
      const start = fallbackStart ?? Date.now();
      this.editor.set({
        open: true,
        draft: { nodeId: null, start, end: start + MS_PER_HOUR, note: '' },
      });
    }
  }

  async onEditorSave(draft: EntryDraft) {
    if (!draft.nodeId) return;
    if (draft.id) {
      await this.data.updateEntry(draft.id, { nodeId: draft.nodeId, start: draft.start, end: draft.end, note: draft.note });
    } else {
      await this.data.addManualEntry(draft.nodeId, draft.start, draft.end, draft.note);
    }
    this.editor.set(null);
  }
  async onEditorDelete(id: string) {
    if (!confirm('Delete this entry?')) return;
    await this.data.deleteEntry(id);
    this.editor.set(null);
  }
  onEditorCancel() { this.editor.set(null); }

  // ---------- Tree template drag ----------

  /** Tree (in-page) supplies leaf-friendly drag start. */
  onTreeDragStart(ev: DragEvent, node: Node) {
    ev.dataTransfer?.setData('application/x-worktrack-node', node.id);
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'copy';
    this.templateDragNodeId.set(node.id);
  }
  onTreeDragEnd() {
    this.templateDragNodeId.set(null);
    this.templateDragPreview.set(null);
  }

  onColDragOver(ev: DragEvent, dayIdx: number) {
    if (!this.templateDragNodeId()) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
    const minutes = this.minutesFromEvent(ev, dayIdx);
    this.templateDragPreview.set({
      dayIdx,
      topPct: (minutes / (24 * 60)) * 100,
      heightPct: (60 / (24 * 60)) * 100,
    });
  }
  async onColDrop(ev: DragEvent, dayIdx: number) {
    const nodeId = ev.dataTransfer?.getData('application/x-worktrack-node') || this.templateDragNodeId();
    this.templateDragNodeId.set(null);
    this.templateDragPreview.set(null);
    if (!nodeId) return;
    ev.preventDefault();
    const minutes = this.minutesFromEvent(ev, dayIdx);
    const dayStart = this.weekStart() + dayIdx * MS_PER_DAY;
    const start = dayStart + minutes * MS_PER_MIN;
    await this.data.addManualEntry(nodeId, start, start + MS_PER_HOUR);
  }

  // ---------- Tree (sidebar) data ----------

  readonly treeFilter = signal('');
  private readonly childrenByParent = computed(() => indexChildren(this.data.nodes().filter(n => !n.archived)));
  readonly treeRoots = computed(() => this.childrenByParent().get(null) ?? []);
  childrenOf(id: string | null): Node[] { return this.childrenByParent().get(id) ?? []; }

  readonly treeVisibleIds = computed(() => {
    const f = this.treeFilter().trim().toLowerCase();
    if (!f) return null;
    const all = this.data.nodes();
    const matching = new Set(all.filter(n => n.name.toLowerCase().includes(f)).map(n => n.id));
    const byId = new Map(all.map(n => [n.id, n] as const));
    for (const id of [...matching]) {
      let cur = byId.get(id);
      while (cur?.parentId) { matching.add(cur.parentId); cur = byId.get(cur.parentId); }
    }
    return matching;
  });
  isTreeVisible(id: string): boolean {
    const v = this.treeVisibleIds();
    return !v || v.has(id);
  }

  // ---------- Misc ----------

  /** Live "now" indicator position for today's column. */
  readonly nowPct = computed(() => {
    const now = this.timer.now();
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    return ((now - day.getTime()) / MS_PER_DAY) * 100;
  });
  readonly todayDayIdx = computed(() => {
    for (let i = 0; i < 7; i++) {
      if (this.isSameDay(this.weekStart() + i * MS_PER_DAY, this.timer.now())) return i;
    }
    return -1;
  });

  formatBlockTime(ms: number): string {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  formatRange(start: number, end: number): string {
    const dur = Math.max(0, Math.round((end - start) / MS_PER_MIN));
    const h = Math.floor(dur / 60), m = dur % 60;
    return `${this.formatBlockTime(start)}–${this.formatBlockTime(end)} · ${h}:${String(m).padStart(2, '0')}`;
  }
}
