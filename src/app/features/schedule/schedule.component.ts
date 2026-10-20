import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  afterRenderEffect,
  computed,
  effect,
  input,
  untracked,
  inject,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { renderNow } from '../../shared/render-now';
import { DataService } from '../../core/data.service';
import { Absence, Node, TimeEntry } from '../../core/models';
import { TimerService } from '../../core/timer.service';
import { ToastService } from '../../core/toast.service';
import { WorkTimeService } from '../../core/worktime.service';
import { uid } from '../../core/db';
import { ABSENCE_KINDS } from '../../domain/worktime';
import { readableTextColor } from '../../domain/color';
import { mergeNeighbors, midpoint, planCopy, shiftEntry } from '../../domain/entry-edit';
import { isLocked, lockEnd } from '../../domain/lock';
import { Suggestion, WEEKDAY_NAMES, WORKDAYS, ruleFromEntry, suggestions, weekdaysLabel } from '../../domain/recurring';
import { formatClock, formatHM, formatRange } from '../../domain/format';
import { DaySegment, layoutWeek, snapToGrid, snapToNeighbors } from '../../domain/schedule-layout';
import { ScheduleView, ScheduleViewSetting, VIEW_DAYS, alignStart, resolveView, stepStart } from '../../domain/schedule-view';
import {
  MINUTES_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  addDays,
  atWallClockMinutes,
  daysFrom,
  isSameDay,
  wallClockMinutes,
} from '../../domain/time';
import { LongPressDirective, LongPressEvent, swallowNextClick } from '../../shared/long-press.directive';
import { ContextMenuComponent, MenuItem } from '../../shared/ui/context-menu.component';
import { EntryDraft, EntryEditorComponent, draftFields } from '../../shared/ui/entry-editor.component';

const SNAP_MIN = 15;
const FINE_SNAP_MIN = 1;
const NEIGHBOR_SNAP_MIN = 10;
const DRAG_THRESHOLD_PX = 4;
const LONG_PRESS_MS = 500;
const HOUR_HEIGHT_PX = 56;
const DRAG_MIME = 'application/x-worktrack-node';
const VIEW_KEY = 'worktracklite.scheduleView';
/** Pointer-picked split points snap to this. */
const SPLIT_SNAP_MIN = 5;

function readViewSetting(): ScheduleViewSetting {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === 'day' || v === '3day' || v === 'week' || v === 'auto') return v;
  } catch {
    /* ignore */
  }
  return 'auto';
}

interface DragState {
  kind: 'move' | 'resize-start' | 'resize-end';
  entry: TimeEntry;
  /** Entries that move together: the selection when dragging a selected block, else just `entry`. */
  group: TimeEntry[];
  pointerId: number;
  startX: number;
  startY: number;
  colWidth: number;
  moved: boolean;
  lastEvent: PointerEvent | null;
  longPress: ReturnType<typeof setTimeout> | null;
}

/** `at`: the time under the pointer when the menu was opened on an entry (split point). */
type MenuState = { x: number; y: number } & (
  | { entry: TimeEntry; at?: number | null }
  | { dayStart: number; minutes: number }
  /** The header's ⋯ menu (actions for the visible range). */
  | { page: true }
  /** A recurring entry's suggested occurrence. */
  | { suggestion: Suggestion }
  /** All suggestions of one visible day (from the day header). */
  | { daySuggestions: number }
);
interface Range {
  start: number;
  end: number;
}

@Component({
  selector: 'app-schedule',
  host: { '(window:resize)': 'onResize()', '(document:keydown.escape)': 'onEscape($event)' },
  imports: [NgTemplateOutlet, EntryEditorComponent, ContextMenuComponent, LongPressDirective],
  templateUrl: './schedule.component.html',
  styleUrl: './schedule.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScheduleComponent {
  private readonly data = inject(DataService);
  private readonly cdr = inject(ChangeDetectorRef);
  protected readonly timer = inject(TimerService);
  private readonly toast = inject(ToastService);
  private readonly host = inject(ElementRef);
  private readonly workTime = inject(WorkTimeService);

  protected readonly hours = Array.from({ length: 24 }, (_, i) => i);
  protected readonly dayHeightPx = 24 * HOUR_HEIGHT_PX;
  protected readonly formatRange = formatRange;
  protected readonly formatClock = formatClock;
  protected readonly formatHM = formatHM;
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  private readonly weekStartsOn = computed(() => this.data.settings().weekStartsOn ?? 1);

  /** Query parameters from search results: show the days around `at` and highlight `entry`. */
  readonly at = input<string | undefined>();
  readonly entry = input<string | undefined>();
  protected readonly found = computed(() => this.entry() ?? null);

  /** Day / 3 days / Week, or automatic by screen width. Remembered per device. */
  protected readonly viewSetting = signal<ScheduleViewSetting>(readViewSetting());
  private readonly width = signal(globalThis.innerWidth ?? 1280);
  protected readonly view = computed(() => resolveView(this.viewSetting(), this.width()));
  private readonly layout = computed(() => ({ view: this.view(), weekStartsOn: this.weekStartsOn() }));

  /**
   * Local midnight of the first visible day. Re-aligns when the view or the
   * week-start setting changes, keeping today in view if it was visible.
   */
  protected readonly rangeStart = linkedSignal<{ view: ScheduleView; weekStartsOn: number }, number>({
    source: this.layout,
    computation: ({ view, weekStartsOn }, prev) => {
      let anchor = Date.now();
      if (prev) {
        const prevEnd = addDays(prev.value, VIEW_DAYS[prev.source.view]);
        if (anchor < prev.value || anchor >= prevEnd) anchor = prev.value;
      }
      return alignStart(view, anchor, weekStartsOn);
    },
  });

  protected readonly days = computed(() => {
    const today = this.timer.minute();
    return daysFrom(this.rangeStart(), VIEW_DAYS[this.view()]).map((ms) => ({
      ms,
      label: new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'numeric', day: 'numeric' }),
      isToday: isSameDay(ms, today),
    }));
  });

  /** End of the locked period (null: nothing locked). */
  private readonly lockEndMs = computed(() => lockEnd(this.data.settings().lockedUntil));
  protected isEntryLocked(e: TimeEntry): boolean {
    return isLocked(e.start, this.lockEndMs());
  }
  protected isDayLocked(dayStart: number): boolean {
    return isLocked(dayStart, this.lockEndMs());
  }
  private lockedHint(): void {
    this.toast.show('This entry is in a locked period. Unlock it in Settings to change it.');
  }

  // --- Recurring suggestions -----------------------------------------------------------

  /** Pending occurrences of recurring rules in the visible days, per day column. */
  protected readonly suggested = computed(() => {
    const s = this.data.settings();
    const days = this.days().map((d) => d.ms);
    const tree = this.data.tree();
    const list = suggestions(s.recurring ?? [], days, {
      entries: this.data.entries(),
      skipped: new Set(s.recurringSkipped ?? []),
      absences: new Map((s.absences ?? []).map((a) => [a.date, a])),
      lockEnd: this.lockEndMs(),
      usable: (id) => {
        const n = tree.get(id);
        return !!n && !n.archived && !tree.hasArchivedAncestor(id);
      },
    });
    const entries = this.data.entries();
    const now = this.timer.minute();
    return days.map((day, i) => {
      const next = i + 1 < days.length ? days[i + 1] : addDays(day, 1);
      return list
        .filter((x) => x.start >= day && x.start < next)
        .map((x) => {
          const topMin = wallClockMinutes(x.start);
          // Under another entry it would be unreachable: then only the day header lists it.
          const hidden = entries.some((e) => e.start < x.end && (e.end ?? now) > x.start);
          return { s: x, topMin, hidden, heightMin: Math.max(15, Math.min(MINUTES_PER_DAY - topMin, (x.end - x.start) / MS_PER_MINUTE)) };
        });
    });
  });
  private readonly allSuggested = computed(() =>
    this.suggested()
      .flat()
      .map((g) => g.s),
  );

  protected suggestionName(x: Suggestion): string {
    return this.data.tree().get(x.nodeId)?.name ?? '?';
  }
  protected suggestionLabel(x: Suggestion): string {
    return `Suggested: ${this.suggestionName(x)}, ${formatRange(x.start, x.end)}`;
  }

  protected openDaySuggestions(button: HTMLElement, dayIdx: number): void {
    const r = button.getBoundingClientRect();
    this.openMenu({ x: r.left, y: r.bottom + 4, daySuggestions: dayIdx });
  }

  protected onSuggestionClick(ev: MouseEvent, x: Suggestion): void {
    ev.stopPropagation();
    ev.preventDefault();
    this.openMenu({ x: ev.clientX, y: ev.clientY, suggestion: x });
  }

  private async acceptSuggestions(list: Suggestion[]): Promise<void> {
    if (!list.length) return;
    try {
      const ids = await this.data.addEntries(list.map(({ nodeId, start, end, note, tags }) => ({ nodeId, start, end, note, tags })));
      const what = list.length === 1 ? (this.data.tree().get(list[0].nodeId)?.name ?? 'entry') : `${list.length} suggested entries`;
      this.toast.show(`Added ${what}`, { action: { label: 'Undo', run: () => this.data.deleteEntries(ids) } });
    } catch (err) {
      this.toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  private async skipSuggestion(x: Suggestion): Promise<void> {
    const before = await this.data.skipSuggestions([x.key]);
    this.toast.show('Skipped this time', { action: { label: 'Undo', run: () => this.data.updateSettings({ recurringSkipped: before }) } });
  }

  private async stopRepeating(ruleId: string): Promise<void> {
    const before = await this.data.deleteRecurring(ruleId);
    this.toast.show('Stopped repeating', {
      action: { label: 'Undo', run: () => this.data.updateSettings({ recurring: before.length ? before : undefined }) },
    });
  }

  private async repeat(e: TimeEntry, weekdays: number[]): Promise<void> {
    const rule = ruleFromEntry(e, weekdays, uid());
    await this.data.saveRecurring(rule);
    const at = formatClock(e.start);
    this.toast.show(`Repeats ${weekdaysLabel(rule.weekdays, this.weekStartsOn())} at ${at}; it shows as suggestions to confirm`, {
      action: { label: 'Undo', run: () => this.data.deleteRecurring(rule.id) },
    });
  }

  /** Worked / target hours and absences per visible day (empty while working time is off). */
  protected readonly dayWork = computed(() => (this.workTime.work() ? this.workTime.daysInfo(this.days().map((d) => d.ms)) : []));

  protected absenceLabel(a: Absence): string {
    const kind = ABSENCE_KINDS.find((k) => k.id === a.kind)?.label ?? a.kind;
    return a.half ? `${kind} (½)` : kind;
  }

  // --- Drag state ------------------------------------------------------------
  private drag: DragState | null = null;
  private rafId = 0;
  /** Set after a drag so the click that follows pointerup does not open the editor. */
  private suppressClick = false;
  /** Live positions of the entries being dragged, by id. */
  protected readonly preview = signal<ReadonlyMap<string, Range> | null>(null);

  // --- Sidebar drag (HTML5 DnD) ------------------------------------------------
  protected readonly dragNodeId = signal<string | null>(null);
  protected readonly dropGhost = signal<{ dayIdx: number; topMin: number } | null>(null);

  protected readonly menu = signal<MenuState | null>(null);
  protected readonly clipboard = signal<TimeEntry | null>(null);
  protected readonly editor = signal<EntryDraft | null>(null);
  protected readonly editorLocked = computed(() => {
    const d = this.editor();
    return !!d?.id && isLocked(d.start, this.lockEndMs());
  });

  protected readonly columns = computed<DaySegment[][]>(() => {
    const p = this.preview();
    const now = this.timer.minute() + MS_PER_MINUTE;
    return layoutWeek(
      this.data.entries(),
      this.days().map((d) => d.ms),
      (e) => p?.get(e.id)?.end ?? e.end ?? Math.max(now, e.start + MS_PER_MINUTE),
      (e) => p?.get(e.id)?.start ?? e.start,
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
    // Jump to a search result's days (when opened with ?at=…).
    effect(() => {
      const at = Number(this.at());
      if (this.at() && Number.isFinite(at)) {
        const view = untracked(() => this.view());
        this.rangeStart.set(
          alignStart(
            view,
            at,
            untracked(() => this.weekStartsOn()),
          ),
        );
      }
    });
    // Start scrolled to the found entry, else an hour before now (or 7:00) instead of midnight.
    afterNextRender(() => {
      const at = Number(this.at());
      const hour =
        this.at() && Number.isFinite(at) ? Math.max(0, new Date(at).getHours() - 1) : Math.max(0, Math.min(new Date().getHours() - 1, 7));
      this.scroller()?.nativeElement.scrollTo?.({ top: hour * HOUR_HEIGHT_PX });
    });
    // Focus the found entry once it is rendered.
    afterRenderEffect(() => {
      const id = this.found();
      if (!id || this.columns().length === 0) return;
      const el = (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(id)}"]`);
      if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
    });
    inject(DestroyRef).onDestroy(() => this.endDrag());
  }

  // --- Navigation ----------------------------------------------------------------

  protected readonly pageLabel = computed(() => ({ day: 'day', '3day': '3 days', week: 'week' })[this.view()]);
  protected readonly rangeLabel = computed(() => {
    const d = this.days();
    return d.length === 1 ? d[0].label : `${d[0].label} – ${d[d.length - 1].label}`;
  });

  protected prevPage(): void {
    this.rangeStart.set(stepStart(this.view(), this.rangeStart(), -1, this.weekStartsOn()));
  }
  protected nextPage(): void {
    this.rangeStart.set(stepStart(this.view(), this.rangeStart(), 1, this.weekStartsOn()));
  }
  protected today(): void {
    this.rangeStart.set(alignStart(this.view(), Date.now(), this.weekStartsOn()));
  }

  protected setViewSetting(v: ScheduleViewSetting): void {
    this.viewSetting.set(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* per-device convenience only */
    }
  }

  protected onResize(): void {
    this.width.set(globalThis.innerWidth);
  }

  // --- Labels / helpers ------------------------------------------------------------

  /** Node colour (inherited) with readable text; default accent when uncoloured. */
  protected blockColor(seg: DaySegment): { bg: string | null; fg: string | null } {
    const c = this.data.tree().colorOf(seg.entry.nodeId);
    return c ? { bg: c, fg: readableTextColor(c) } : { bg: null, fg: null };
  }

  protected nodeName(e: TimeEntry): string {
    return this.data.tree().get(e.nodeId)?.name ?? '(deleted)';
  }
  protected pathLabel(e: TimeEntry): string {
    return this.data.tree().pathNames(e.nodeId).slice(0, -1).join(' / ');
  }
  protected segEnd(seg: DaySegment): number {
    return this.preview()?.get(seg.entry.id)?.end ?? seg.entry.end ?? this.timer.minute();
  }
  protected segStart(seg: DaySegment): number {
    return this.preview()?.get(seg.entry.id)?.start ?? seg.entry.start;
  }
  protected blockLabel(seg: DaySegment): string {
    const state = seg.entry.end == null ? ', running' : this.isSelected(seg.entry.id) ? ', selected' : '';
    return `${this.nodeName(seg.entry)}, ${formatRange(this.segStart(seg), this.segEnd(seg))}${state}`;
  }

  /** Wall-clock minutes (snapped) for a pointer position inside a day column. */
  private minutesAt(clientY: number, col: HTMLElement, stepMin = SNAP_MIN): number {
    const rect = col.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    return Math.min(MINUTES_PER_DAY - stepMin, Math.round((ratio * MINUTES_PER_DAY) / stepMin) * stepMin);
  }

  /** The time under the pointer inside a block's day column (for "Split at"). */
  private timeAt(clientY: number, el: Element): number | null {
    const col = el.closest<HTMLElement>('.sched__col');
    const day = col ? this.days()[Number(col.dataset['day'])] : undefined;
    return col && day ? atWallClockMinutes(day.ms, this.minutesAt(clientY, col, SPLIT_SNAP_MIN)) : null;
  }

  // --- Block pointer interaction ------------------------------------------------------

  protected onBlockPointerDown(ev: PointerEvent, seg: DaySegment, kind: DragState['kind']): void {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    ev.stopPropagation();
    // A new gesture: forget a click suppression left over from a drag that ended elsewhere.
    this.suppressClick = false;
    if (seg.entry.end == null) return; // running timers are not draggable
    if (this.isEntryLocked(seg.entry)) return; // locked: click opens it read-only
    ev.preventDefault();
    const target = ev.currentTarget as HTMLElement;
    const col = target.closest('.sched__col') as HTMLElement | null;
    const sel = this.selectedEntries();
    const group = kind === 'move' && this.isSelected(seg.entry.id) ? sel : [seg.entry];
    this.drag = {
      kind,
      entry: seg.entry,
      group,
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
              if (entry) this.openMenu({ x: startX, y: startY, entry, at: this.timeAt(startY, target) });
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
    const result = this.preview()?.get(d.entry.id);
    const moves = this.preview();
    this.endDrag();
    if (!d.moved || !result || !moves) return;
    this.suppressClick = true;
    if (result.start === d.entry.start && result.end === d.entry.end) return;
    try {
      if (d.group.length > 1) {
        const before = await this.data.updateEntries([...moves.keys()], (e) => moves.get(e.id)!);
        this.toast.show(`Moved ${before.length} entries`, { action: { label: 'Undo', run: () => this.data.restoreEntries(before) } });
        return;
      }
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
      // Whole days plus a snapped offset, applied the same way to every entry in the group.
      const dayShift = Math.round((ev.clientX - d.startX) / Math.max(1, d.colWidth));
      const offset = snap(addDays(s0, dayShift) + dtMs) - addDays(s0, dayShift);
      this.preview.set(new Map(d.group.map((e) => [e.id, shiftEntry(e, dayShift, offset)])));
      return;
    } else if (d.kind === 'resize-start') {
      start = Math.min(snap(s0 + dtMs), e0 - minLen);
    } else {
      end = Math.max(snap(e0 + dtMs), s0 + minLen);
    }
    this.preview.set(new Map([[d.entry.id, { start, end }]]));
  }

  protected onBlockClick(ev: MouseEvent, seg: DaySegment): void {
    ev.stopPropagation();
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    // Ctrl/Cmd/Shift-click selects; once something is selected, plain clicks and taps select too.
    if (seg.entry.end != null && (ev.ctrlKey || ev.metaKey || ev.shiftKey || this.selecting())) {
      this.toggleSelected(seg.entry);
      return;
    }
    this.activate(seg.entry, ev.clientX, ev.clientY);
  }

  protected onBlockKey(ev: KeyboardEvent, seg: DaySegment): void {
    const el = ev.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      if (seg.entry.end != null && (ev.ctrlKey || ev.metaKey || ev.shiftKey || this.selecting())) this.toggleSelected(seg.entry);
      else this.activate(seg.entry, r.left, r.top);
    } else if (ev.key === 'ContextMenu' || (ev.shiftKey && ev.key === 'F10')) {
      ev.preventDefault();
      this.openMenu({ x: r.left, y: r.top, entry: seg.entry });
    } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
      ev.preventDefault();
      if (this.isEntryLocked(seg.entry)) this.lockedHint();
      else if (this.isSelected(seg.entry.id)) void this.deleteSelection();
      else if (seg.entry.end != null) void this.deleteEntry(seg.entry.id);
    }
  }

  private activate(entry: TimeEntry, x: number, y: number): void {
    if (entry.end == null) this.openMenu({ x, y, entry });
    else this.openEditor(entry);
  }

  protected onBlockContext(ev: MouseEvent, seg: DaySegment): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.openMenu({ x: ev.clientX, y: ev.clientY, entry: seg.entry, at: this.timeAt(ev.clientY, ev.currentTarget as HTMLElement) });
  }

  // --- Column interaction -------------------------------------------------------------

  protected onColContext(ev: MouseEvent, dayStart: number): void {
    ev.preventDefault();
    this.openMenu({ x: ev.clientX, y: ev.clientY, dayStart, minutes: this.minutesAt(ev.clientY, ev.currentTarget as HTMLElement) });
  }

  protected onColLongPress(ev: LongPressEvent, dayStart: number, col: HTMLElement): void {
    if ((ev.target as HTMLElement | null)?.closest?.('.block, .suggest')) return;
    this.openMenu({ x: ev.x, y: ev.y, dayStart, minutes: this.minutesAt(ev.y, col) });
  }

  protected menuItems(m: MenuState): MenuItem[] {
    if ('entry' in m) {
      const e = m.entry;
      if (e.end == null) return [{ label: 'Stop timer', run: () => this.timer.stop() }];
      if (this.isEntryLocked(e)) {
        return [
          { label: 'View…', run: () => this.openEditor(e) },
          { label: 'Copy', run: () => this.clipboard.set({ ...e }) },
          { label: '🔒 Locked period', disabled: true, run: () => undefined },
        ];
      }
      const splitAt = m.at != null && m.at > e.start && m.at < e.end ? m.at : null;
      const half = midpoint(e);
      const { prev, next } = mergeNeighbors(this.data.entries(), e);
      const items: MenuItem[] = [
        { label: 'Edit…', run: () => this.openEditor(e) },
        { label: 'Duplicate', run: () => this.paste(e, e.end!, true) },
        { label: 'Copy', run: () => this.clipboard.set({ ...e }) },
      ];
      if (splitAt != null) items.push({ label: `Split at ${formatClock(splitAt)}`, run: () => this.split(e, splitAt) });
      else if (half != null) items.push({ label: 'Split in half', run: () => this.split(e, half) });
      if (prev && !this.isEntryLocked(prev)) items.push({ label: 'Merge with previous', run: () => this.merge([prev.id, e.id]) });
      if (next) items.push({ label: 'Merge with next', run: () => this.merge([e.id, next.id]) });
      const weekday = new Date(e.start).getDay();
      items.push({ label: `Repeat every ${WEEKDAY_NAMES[weekday]}`, run: () => this.repeat(e, [weekday]) });
      if (WORKDAYS.includes(weekday)) items.push({ label: 'Repeat every weekday (Mon–Fri)', run: () => this.repeat(e, WORKDAYS) });
      items.push(
        { label: this.isSelected(e.id) ? 'Deselect' : 'Select', run: () => this.toggleSelected(e) },
        { label: 'Delete', danger: true, run: () => this.deleteEntry(e.id) },
      );
      return items;
    }
    if ('page' in m) {
      const days = VIEW_DAYS[this.view()];
      const from = this.rangeStart();
      const pending = this.allSuggested();
      return [
        { label: 'Copy from last week', run: () => this.copyRange(addDays(from, -7), addDays(from, days - 7), 7, 'from last week') },
        {
          label: pending.length ? `Add all suggestions (${pending.length})` : 'Add all suggestions',
          disabled: !pending.length,
          run: () => this.acceptSuggestions(pending),
        },
      ];
    }
    if ('daySuggestions' in m) {
      const list = (this.suggested()[m.daySuggestions] ?? []).map((g) => g.s);
      const items: MenuItem[] = list.map((x) => ({
        label: `Add ${this.suggestionName(x)} ${formatRange(x.start, x.end)}`,
        run: () => this.acceptSuggestions([x]),
      }));
      if (list.length > 1) items.push({ label: `Add all (${list.length})`, run: () => this.acceptSuggestions(list) });
      items.push({
        label: list.length > 1 ? `Skip all (${list.length})` : 'Skip',
        run: async () => {
          const before = await this.data.skipSuggestions(list.map((x) => x.key));
          this.toast.show('Skipped', { action: { label: 'Undo', run: () => this.data.updateSettings({ recurringSkipped: before }) } });
        },
      });
      return items;
    }
    if ('suggestion' in m) {
      const x = m.suggestion;
      return [
        { label: 'Add', run: () => this.acceptSuggestions([x]) },
        { label: 'Skip this time', run: () => this.skipSuggestion(x) },
        { label: 'Stop repeating', danger: true, run: () => this.stopRepeating(x.ruleId) },
      ];
    }
    const at = atWallClockMinutes(m.dayStart, m.minutes);
    const cb = this.clipboard();
    const nextDay = addDays(m.dayStart, 1);
    const dayLocked = this.isDayLocked(m.dayStart);
    return [
      { label: dayLocked ? 'New entry here… (locked)' : 'New entry here…', disabled: dayLocked, run: () => this.openEditor(null, at) },
      { label: cb ? `Paste ${this.nodeName(cb)}` : 'Paste', disabled: !cb || dayLocked, run: () => cb && this.paste(cb, at) },
      { label: 'Copy this day to the next day', run: () => this.copyRange(m.dayStart, nextDay, 1, 'to the next day') },
      { label: 'Copy this day to next week', run: () => this.copyRange(m.dayStart, nextDay, 7, 'to next week') },
    ];
  }

  private async paste(src: TimeEntry, start: number, isDuplicate = false): Promise<void> {
    const dur = (src.end ?? src.start + MS_PER_HOUR) - src.start;
    try {
      await this.data.addEntry({ nodeId: src.nodeId, start, end: start + dur, note: src.note, tags: src.tags, billable: src.billable });
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

  // --- Copy days ------------------------------------------------------------------------

  protected openPageMenu(button: HTMLElement): void {
    const r = button.getBoundingClientRect();
    this.openMenu({ x: r.right - 220, y: r.bottom + 4, page: true });
  }

  /** Copies the finished entries starting in [from, to) by `dayShift` days. */
  private async copyRange(from: number, to: number, dayShift: number, what: string): Promise<void> {
    const plan = planCopy(this.data.entries(), from, to, dayShift);
    if (!plan.copies.length) {
      this.toast.show(plan.duplicates ? `Nothing to copy ${what}: those entries are already there.` : `Nothing to copy ${what}.`);
      return;
    }
    try {
      const ids = await this.data.addEntries(plan.copies);
      const n = ids.length;
      const extra = [
        plan.duplicates ? `${plan.duplicates} already there` : '',
        plan.overlaps ? `${plan.overlaps} ${plan.overlaps === 1 ? 'overlaps' : 'overlap'} existing entries` : '',
      ].filter(Boolean);
      this.toast.show(`Copied ${n} ${n === 1 ? 'entry' : 'entries'} ${what}${extra.length ? ` (${extra.join(', ')})` : ''}`, {
        action: { label: 'Undo', run: () => this.data.deleteEntries(ids) },
      });
    } catch (err) {
      this.toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  // --- Split / merge -----------------------------------------------------------------

  private async split(e: TimeEntry, at: number): Promise<void> {
    try {
      const { original, newId } = await this.data.splitEntry(e.id, at);
      this.toast.show(`Split at ${formatClock(at)}`, {
        action: { label: 'Undo', run: () => this.data.revertEntries([original], [newId]) },
      });
    } catch (err) {
      this.toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  private async merge(ids: string[]): Promise<boolean> {
    try {
      const { originals, gapMs } = await this.data.mergeEntries(ids);
      const gap = gapMs ? ` (adds ${formatHM(gapMs / 1000)} between them)` : '';
      this.toast.show(`Merged ${originals.length} entries${gap}`, {
        action: { label: 'Undo', run: () => this.data.revertEntries(originals, []) },
      });
      return true;
    } catch (err) {
      this.toast.error(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  // --- Selection -----------------------------------------------------------------------

  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  /** Selected entries that still exist (others may have been deleted meanwhile). */
  protected readonly selectedEntries = computed(() => this.data.entries().filter((e) => this.selected().has(e.id) && e.end != null));
  protected readonly selecting = computed(() => this.selectedEntries().length > 0);
  protected readonly selectedSeconds = computed(() => this.selectedEntries().reduce((s, e) => s + (e.end! - e.start) / 1000, 0));
  /** Targets for "Move to": every node not archived, with its path. */
  protected readonly assignableNodes = computed(() => {
    const tree = this.data.tree();
    return tree.nodes
      .filter((n) => !n.archived && !tree.hasArchivedAncestor(n.id))
      .map((n) => ({ id: n.id, label: tree.pathLabel(n.id) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  protected isSelected(id: string): boolean {
    return this.selected().has(id);
  }

  protected toggleSelected(e: TimeEntry): void {
    if (e.end == null) return;
    if (this.isEntryLocked(e)) {
      this.lockedHint();
      return;
    }
    const next = new Set(this.selectedEntries().map((x) => x.id));
    if (!next.delete(e.id)) next.add(e.id);
    this.selected.set(next);
  }

  protected clearSelection(): void {
    this.selected.set(new Set());
  }

  protected onEscape(ev: Event): void {
    // A menu or dialog handles its own Escape first (and marks it handled).
    if (ev.defaultPrevented || this.menu() || this.editor()) return;
    this.clearSelection();
  }

  protected async reassignSelection(select: HTMLSelectElement): Promise<void> {
    const nodeId = select.value;
    select.value = '';
    if (!nodeId) return;
    try {
      const before = await this.data.updateEntries(
        this.selectedEntries().map((e) => e.id),
        () => ({ nodeId }),
      );
      this.toast.show(`Moved ${before.length} entries to ${this.data.tree().get(nodeId)?.name ?? 'node'}`, {
        action: { label: 'Undo', run: () => this.data.restoreEntries(before) },
      });
    } catch (err) {
      this.toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  protected async mergeSelection(): Promise<void> {
    if (await this.merge(this.selectedEntries().map((e) => e.id))) this.clearSelection();
  }

  protected async deleteSelection(): Promise<void> {
    try {
      const removed = await this.data.deleteEntries(this.selectedEntries().map((e) => e.id));
      this.clearSelection();
      this.toast.show(`Deleted ${removed.length} ${removed.length === 1 ? 'entry' : 'entries'}`, {
        action: { label: 'Undo', run: () => this.data.restoreEntries(removed) },
      });
    } catch (err) {
      this.toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  // --- Editor ----------------------------------------------------------------------

  protected openEditor(entry: TimeEntry | null, start?: number): void {
    if (entry) {
      this.showEditor({
        id: entry.id,
        nodeId: entry.nodeId,
        start: entry.start,
        end: entry.end ?? Date.now(),
        note: entry.note,
        tags: entry.tags,
        billable: entry.billable,
      });
    } else {
      const s = start ?? snapToGrid(Date.now(), SNAP_MIN);
      this.showEditor({ nodeId: null, start: s, end: s + MS_PER_HOUR, note: '' });
    }
  }

  protected async onEditorSave(d: EntryDraft): Promise<void> {
    try {
      const fields = draftFields(d);
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
    try {
      await this.data.addEntry({ nodeId, start, end: start + MS_PER_HOUR });
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  protected isPreviewing(seg: DaySegment): boolean {
    return this.preview()?.has(seg.entry.id) ?? false;
  }

  /** Opens a menu and renders it now, so it has focus before the next keystroke. */
  private openMenu(m: MenuState): void {
    this.menu.set(m);
    renderNow(this.cdr);
  }

  /** Opens the entry editor and renders it now, so it has focus before the next keystroke. */
  private showEditor(draft: EntryDraft): void {
    this.editor.set(draft);
    renderNow(this.cdr);
  }
}
