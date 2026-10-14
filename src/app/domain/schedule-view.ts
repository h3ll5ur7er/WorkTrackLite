import { addDays, startOfDay, startOfWeek } from './time';

export type ScheduleView = 'day' | '3day' | 'week';
export type ScheduleViewSetting = ScheduleView | 'auto';

export const VIEW_DAYS: Record<ScheduleView, number> = { day: 1, '3day': 3, week: 7 };

/** Screen width breakpoints for the automatic view (CSS pixels). */
export const AUTO_BREAKPOINTS = { day: 600, threeDay: 1000 };

export function resolveView(setting: ScheduleViewSetting, width: number): ScheduleView {
  if (setting !== 'auto') return setting;
  if (width < AUTO_BREAKPOINTS.day) return 'day';
  if (width < AUTO_BREAKPOINTS.threeDay) return '3day';
  return 'week';
}

/** First visible day for a view that should include `anchor` (weeks snap to the week start). */
export function alignStart(view: ScheduleView, anchor: number, weekStartsOn = 1): number {
  return view === 'week' ? startOfWeek(anchor, weekStartsOn) : startOfDay(anchor);
}

/** The previous (-1) or next (+1) page of days (DST-safe). */
export function stepStart(view: ScheduleView, start: number, direction: -1 | 1, weekStartsOn = 1): number {
  return alignStart(view, addDays(start, direction * VIEW_DAYS[view]), weekStartsOn);
}
