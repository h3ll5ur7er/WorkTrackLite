// Calendar math in the user's local time zone.
//
// Never add multiples of 24h to move between days: days are 23h or 25h long
// around daylight-saving changes. Use the local-time Date setters instead,
// which is what every function here does.

export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MINUTES_PER_DAY = 24 * 60;

/** Local midnight of the day containing `ms`. */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Same wall-clock time `days` calendar days later (DST-safe). */
export function addDays(ms: number, days: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** Local midnight of the first day of the week containing `ms`. */
export function startOfWeek(ms: number, weekStartsOn = 1): number {
  const d = new Date(startOfDay(ms));
  const delta = (d.getDay() - weekStartsOn + 7) % 7;
  d.setDate(d.getDate() - delta);
  return d.getTime();
}

export function isSameDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b);
}

/** Minutes since local midnight as shown on a wall clock (0..1439). */
export function wallClockMinutes(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60 + d.getMilliseconds() / MS_PER_MINUTE;
}

/** The instant at `minutes` past local midnight of `dayStart`'s day (DST-safe). */
export function atWallClockMinutes(dayStart: number, minutes: number): number {
  const d = new Date(dayStart);
  d.setHours(0, 0, 0, 0);
  d.setMinutes(minutes);
  return d.getTime();
}

/** Start instants of `count` consecutive days beginning at `firstDay`. */
export function daysFrom(firstDay: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => addDays(startOfDay(firstDay), i));
}

/** `yyyy-mm-dd` of the local day containing `ms` (also the value of `<input type="date">`). */
export function toDateKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Local midnight of a `yyyy-mm-dd` day, or null if it is not a real date. */
export function fromDateKey(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? d.getTime() : null;
}

/** Formats epoch ms for an `<input type="datetime-local">` (local time, minute precision). */
export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parses an `<input type="datetime-local">` value as local time; null if invalid. */
export function fromLocalInput(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const t = new Date(+y, +mo - 1, +d, +h, +mi, s ? +s : 0).getTime();
  return Number.isNaN(t) ? null : t;
}
