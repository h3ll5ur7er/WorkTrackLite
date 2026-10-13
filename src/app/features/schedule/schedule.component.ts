import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { DataService } from '../../core/data.service';
import { Node, TimeEntry } from '../../core/models';
import { TimerService } from '../../core/timer.service';
import { ToastService } from '../../core/toast.service';
import { formatClock, formatRange } from '../../domain/format';
import { DaySegment, layoutWeek, snapToGrid, snapToNeighbors } from '../../domain/schedule-layout';
import {
  MINUTES_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  addDays,
  atWallClockMinutes,
  daysFrom,
  isSameDay,
  startOfWeek,
  wallClockMinutes,
} from '../../domain/time';
import { LongPressDirective, LongPressEvent, swallowNextClick } from '../../shared/long-press.directive';
import { ContextMenuComponent, MenuItem } from '../../shared/ui/context-menu.component';
import { EntryDraft, EntryEditorComponent } from '../../shared/ui/entry-editor.component';

const SNAP_MIN = 15;
const FINE_SNAP_MIN = 1;
const NEIGHBOR_SNAP_MIN = 10;
const DRAG_THRESHOLD_PX = 4;
const LONG_PRESS_MS = 500;
const HOUR_HEIGHT_PX = 56;
const DRAG_MIME = 'application/x-worktrack-node';

interface DragState {
  kind: 'move' | 'resize-start' | 'resize-end';
  entry: TimeEntry;
  pointerId: number;
  startX: number;
  startY: number;
  colWidth: number;
  moved: boolean;
  lastEvent: PointerEvent | null;
  longPress: ReturnType<typeof setTimeout> | null;
}

type MenuState = { x: number; y: number } & ({ entry: TimeEntry } | { dayStart: number; minutes: number });

@Component({
  selector: 'app-schedule',
  imports: [NgTemplateOutlet, EntryEditorComponent, ContextMenuComponent, LongPressDirective],
  templateUrl: './schedule.component.html',
  styleUrl: './schedule.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScheduleComponent {
  private readonly data = inject(DataService);
  protected readonly timer = inject(TimerService);
  private readonly toast = inject(ToastService);

  protected readonly hours = Array.from({ length: 24 }, (_, i) => i);
  protected readonly dayHeightPx = 24 * HOUR_HEIGHT_PX;
  protected readonly formatRange = formatRange;
  protected readonly formatClock = formatClock;
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  private readonly weekStartsOn = computed(() => this.data.settings().weekStartsOn ?? 1);
  /** Local midnight of the first visible day; re-anchors when the week-start setting changes. */
  protected readonly weekStart = linkedSignal<number, number>({
    source: this.weekStartsOn,
    computation: (ws, prev) => startOfWeek(prev?.value ?? Date.now(), ws),
  });

  protected readonly days = computed(() => {
    const today = this.timer.minute();
    return daysFrom(this.weekStart(), 7).map((ms) => ({
      ms,
      label: new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'numeric', day: 'numeric' }),
      isToday: isSameDay(ms, today),
    }));
  });

  // --- Drag state ------------------------------------------------------------
  private drag: DragState | null = null;
  private rafId = 0;
  /** Set after a drag so the click that follows pointerup does not open the editor. */
  private suppressClick = false;
  protected readonly preview = signal<{ id: string; start: number; end: number } | null>(null);

  // --- Sidebar drag (HTML5 DnD) ------------------------------------------------
  protected readonly dragNodeId = signal<string | null>(null);
  protected readonly dropGhost = signal<{ dayIdx: number; topMin: number } | null>(null);

  protected readonly menu = signal<MenuState | null>(null);
  protected readonly clipboard = signal<TimeEntry | null>(null);
  protected readonly editor = signal<EntryDraft | null>(null);

  protected readonly columns = computed<DaySegment[][]>(() => {
    const p = this.preview();
    const now = this.timer.minute() + MS_PER_MINUTE;
    return layoutWeek(
      this.data.entries(),
      this.days().map((d) => d.ms),
      (e) => (p?.id === e.id ? p.end : (e.end ?? Math.max(now, e.start + MS_PER_MINUTE))),
      (e) => (p?.id === e.id ? p.start : e.start),
    );
  });

  protected readonly nowTopMin = computed(() => wallClockMinutes(this.timer.minute()));
  protected readonly todayIdx = computed(() => this.days().findIndex((d) => d.isToday));

  // --- Sidebar tree ------------------------------------------------------------
  protected readonly treeFilter = signal('');
  protected readonly treeRoots = computed(() => this.data.tree().roots());
  protected childrenOf(n: Node): Node[] {
    return this.data.tree().childrenOf(n.id);
  }
  private readonly treeVisible = computed(() => {
    const f = this.treeFilter().trim().toLowerCase();
    if (!f) return null;
    const tree = this.data.tree();
    const out = new Set<string>();
    for (const n of tree.nodes) {
      if (n.name.toLowerCase().includes(f)) {
        out.add(n.id);
        for (const a of tree.ancestorIds(n.id)) out.add(a);
      }
    }
    return out;
  });
  protected isTreeVisible(id: string): boolean {
    const v = this.treeVisible();
    return !v || v.has(id);
  }

  constructor() {
    // Start scrolled to an hour before now (or 7:00) instead of midnight.
    afterNextRender(() => {
      const hour = Math.max(0, Math.min(new Date().getHours() - 1, 7));
      this.scroller()?.nativeElement.scrollTo?.({ top: hour * HOUR_HEIGHT_PX });
    });
    inject(DestroyRef).onDestroy(() => this.endDrag());
  }

  // --- Navigation ----------------------------------------------------------------

  protected prevWeek(): void {
    this.weekStart.set(startOfWeek(addDays(this.weekStart(), -7), this.weekStartsOn()));
  }
  protected nextWeek(): void {
    this.weekStart.set(startOfWeek(addDays(this.weekStart(), 7), this.weekStartsOn()));
  }
  protected thisWeek(): void {
    this.weekStart.set(startOfWeek(Date.now(), this.weekStartsOn()));
  }

  // --- Labels / helpers ------------------------------------------------------------

  protected nodeName(e: TimeEntry): string {
    return this.data.tree().get(e.nodeId)?.name ?? '(deleted)';
  }
  protected pathLabel(e: TimeEntry): string {
    return this.data.tree().pathNames(e.nodeId).slice(0, -1).join(' / ');
  }
  protected segEnd(seg: DaySegment): number {
    const p = this.preview();
    if (p?.id === seg.entry.id) return p.end;
    return seg.entry.end ?? this.timer.minute();
  }
  protected segStart(seg: DaySegment): number {
    const p = this.preview();
    return p?.id === seg.entry.id ? p.start : seg.entry.start;
  }
  protected blockLabel(seg: DaySegment): string {
    return `${this.nodeName(seg.entry)}, ${formatRange(this.segStart(seg), this.segEnd(seg))}${seg.entry.end == null ? ', running' : ''}`;
  }

  /** Wall-clock minutes (snapped) for a pointer position inside a day column. */
  private minutesAt(clientY: number, col: HTMLElement, stepMin = SNAP_MIN): number {
    const rect = col.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    return Math.min(MINUTES_PER_DAY - stepMin, Math.round((ratio * MINUTES_PER_DAY) / stepMin) * stepMin);
  }

  // --- Block pointer interaction ------------------------------------------------------

  protected onBlockPointerDown(ev: PointerEvent, seg: DaySegment, kind: DragState['kind']): void {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    ev.stopPropagation();
    if (seg.entry.end == null) return; // running timers are not draggable
    ev.preventDefault();
    const target = ev.currentTarget as HTMLElement;
    const col = target.closest('.sched__col') as HTMLElement | null;
    this.drag = {
      kind,
      entry: seg.entry,
      pointerId: ev.pointerId,
      startX: ev.clientX,
      startY: ev.clientY,
      colWidth: col?.getBoundingClientRect().width || 100,
      moved: false,
      lastEvent: null,
      longPress:
        ev.pointerType === 'mouse'
          ? null
          : setTimeout(() => {
              const entry = this.drag?.entry;
              const { startX, startY } = this.drag ?? { startX: 0, startY: 0 };
              this.endDrag();
              swallowNextClick();
              if (entry) this.menu.set({ x: startX, y: startY, entry });
            }, LONG_PRESS_MS),
    };
    target.setPointerCapture?.(ev.pointerId);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerCancel);
  }

  private readonly onPointerMove = (ev: PointerEvent): void => {
    const d = this.drag;
    if (!d || ev.pointerId !== d.pointerId) return;
    if (!d.moved && Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY) < DRAG_THRESHOLD_PX) return;
    d.moved = true;
    if (d.longPress) {
      clearTimeout(d.longPress);
      d.longPress = null;
    }
    d.lastEvent = ev;
    if (!this.rafId) {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = 0;
        if (this.drag?.lastEvent) this.applyDrag(this.drag, this.drag.lastEvent);
      });
    }
  };

  private readonly onPointerUp = async (ev: PointerEvent): Promise<void> => {
    const d = this.drag;
    if (!d || ev.pointerId !== d.pointerId) return;
    // Apply the final position synchronously; a pending frame must not run after we clear state.
    if (d.moved) this.applyDrag(d, ev);
    const result = this.preview();
    this.endDrag();
    if (!d.moved || !result) return;
    this.suppressClick = true;
    if (result.start === d.entry.start && result.end === d.entry.end) return;
    try {
      await this.data.updateEntry(d.entry.id, { start: result.start, end: result.end });
      this.toast.show(`Moved to ${formatRange(result.start, result.end)}`, {
        action: { label: 'Undo', run: () => this.data.updateEntry(d.entry.id, { start: d.entry.start, end: d.entry.end }) },
      });
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  private readonly onPointerCancel = (): void => this.endDrag();

  private endDrag(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    if (this.drag?.longPress) clearTimeout(this.drag.longPress);
    this.drag = null;
    this.preview.set(null);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerCancel);
  }

  private applyDrag(d: DragState, ev: PointerEvent): void {
    const fine = ev.shiftKey;
    const step = fine ? FINE_SNAP_MIN : SNAP_MIN;
    const snap = (ms: number) => {
      const s = snapToGrid(ms, step);
      return fine ? s : snapToNeighbors(s, this.data.entries(), d.entry.id, NEIGHBOR_SNAP_MIN);
    };
    const dtMs = ((ev.clientY - d.startY) / HOUR_HEIGHT_PX) * MS_PER_HOUR;
    const { start: s0, end: e0 } = { start: d.entry.start, end: d.entry.end! };
    const minLen = step * MS_PER_MINUTE;
    let start = s0;
    let end = e0;
    if (d.kind === 'move') {
      const dayShift = Math.round((ev.clientX - d.startX) / Math.max(1, d.colWidth));
      start = snap(addDays(s0, dayShift) + dtMs);
      end = start + (e0 - s0);
    } else if (d.kind === 'resize-start') {
      start = Math.min(snap(s0 + dtMs), e0 - minLen);
    } else {
      end = Math.max(snap(e0 + dtMs), s0 + minLen);
    }
    this.preview.set({ id: d.entry.id, start, end });
  }

  protected onBlockClick(ev: MouseEvent, seg: DaySegment): void {
    ev.stopPropagation();
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    this.activate(seg.entry, ev.clientX, ev.clientY);
  }

  protected onBlockKey(ev: KeyboardEvent, seg: DaySegment): void {
    const el = ev.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      this.activate(seg.entry, r.left, r.top);
    } else if (ev.key === 'ContextMenu' || (ev.shiftKey && ev.key === 'F10')) {
      ev.preventDefault();
      this.menu.set({ x: r.left, y: r.top, entry: seg.entry });
    } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
      ev.preventDefault();
      if (seg.entry.end != null) void this.deleteEntry(seg.entry.id);
    }
  }

  private activate(entry: TimeEntry, x: number, y: number): void {
    if (entry.end == null) this.menu.set({ x, y, entry });
    else this.openEditor(entry);
  }

  protected onBlockContext(ev: MouseEvent, seg: DaySegment): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.menu.set({ x: ev.clientX, y: ev.clientY, entry: seg.entry });
  }

  // --- Column interaction -------------------------------------------------------------

  protected onColContext(ev: MouseEvent, dayStart: number): void {
    ev.preventDefault();
    this.menu.set({ x: ev.clientX, y: ev.clientY, dayStart, minutes: this.minutesAt(ev.clientY, ev.currentTarget as HTMLElement) });
  }

  protected onColLongPress(ev: LongPressEvent, dayStart: number, col: HTMLElement): void {
    if ((ev.target as HTMLElement | null)?.closest?.('.block')) return;
    this.menu.set({ x: ev.x, y: ev.y, dayStart, minutes: this.minutesAt(ev.y, col) });
  }

  protected menuItems(m: MenuState): MenuItem[] {
    if ('entry' in m) {
      const e = m.entry;
      if (e.end == null) return [{ label: 'Stop timer', run: () => this.timer.stop() }];
      return [
        { label: 'Edit…', run: () => this.openEditor(e) },
        { label: 'Duplicate', run: () => this.paste(e, e.end!, true) },
        { label: 'Copy', run: () => this.clipboard.set({ ...e }) },
        { label: 'Delete', danger: true, run: () => this.deleteEntry(e.id) },
      ];
    }
    const at = atWallClockMinutes(m.dayStart, m.minutes);
    const cb = this.clipboard();
    return [
      { label: 'New entry here…', run: () => this.openEditor(null, at) },
      { label: cb ? `Paste ${this.nodeName(cb)}` : 'Paste', disabled: !cb, run: () => cb && this.paste(cb, at) },
    ];
  }

  private async paste(src: TimeEntry, start: number, isDuplicate = false): Promise<void> {
    const dur = (src.end ?? src.start + MS_PER_HOUR) - src.start;
    try {
      await this.data.addEntry({ nodeId: src.nodeId, start, end: start + dur, note: src.note, tags: src.tags });
      if (isDuplicate) this.toast.show('Entry duplicated after the original.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  private async deleteEntry(id: string): Promise<void> {
    const removed = await this.data.deleteEntry(id);
    this.editor.set(null);
    if (removed) this.toast.show('Entry deleted', { action: { label: 'Undo', run: () => this.data.restoreEntries([removed]) } });
  }

  // --- Editor ----------------------------------------------------------------------

  protected openEditor(entry: TimeEntry | null, start?: number): void {
    if (entry) {
      this.editor.set({
        id: entry.id,
        nodeId: entry.nodeId,
        start: entry.start,
        end: entry.end ?? Date.now(),
        note: entry.note,
        tags: entry.tags,
      });
    } else {
      const s = start ?? snapToGrid(Date.now(), SNAP_MIN);
      this.editor.set({ nodeId: null, start: s, end: s + MS_PER_HOUR, note: '' });
    }
  }

  protected async onEditorSave(d: EntryDraft): Promise<void> {
    try {
      const fields = {
        nodeId: d.nodeId!,
        start: d.start,
        end: d.end,
        note: d.note || undefined,
        tags: d.tags?.length ? d.tags : undefined,
      };
      if (d.id) await this.data.updateEntry(d.id, fields);
      else await this.data.addEntry(fields);
      this.editor.set(null);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  protected onEditorDelete(id: string): Promise<void> {
    return this.deleteEntry(id);
  }

  // --- Sidebar → calendar drag (desktop) ------------------------------------------------

  protected onTreeDragStart(ev: DragEvent, node: Node): void {
    ev.dataTransfer?.setData(DRAG_MIME, node.id);
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'copy';
    this.dragNodeId.set(node.id);
  }
  protected onTreeDragEnd(): void {
    this.dragNodeId.set(null);
    this.dropGhost.set(null);
  }
  protected onColDragOver(ev: DragEvent, dayIdx: number): void {
    if (!this.dragNodeId()) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
    this.dropGhost.set({ dayIdx, topMin: this.minutesAt(ev.clientY, ev.currentTarget as HTMLElement) });
  }
  protected async onColDrop(ev: DragEvent, dayStart: number): Promise<void> {
    const nodeId = ev.dataTransfer?.getData(DRAG_MIME) || this.dragNodeId();
    const minutes = this.minutesAt(ev.clientY, ev.currentTarget as HTMLElement);
    this.onTreeDragEnd();
    if (!nodeId) return;
    ev.preventDefault();
    const start = atWallClockMinutes(dayStart, minutes);
    await this.data.addEntry({ nodeId, start, end: start + MS_PER_HOUR });
  }

  protected isPreviewing(seg: DaySegment): boolean {
    return this.preview()?.id === seg.entry.id;
  }
}
