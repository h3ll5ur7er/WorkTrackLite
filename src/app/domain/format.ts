/** `h:mm:ss` with a leading minus for negative values. */
export function formatHMS(seconds: number): string {
  const sign = seconds < 0 ? '-' : '';
  const s = Math.floor(Math.abs(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${sign}${h}:${pad2(m)}:${pad2(s % 60)}`;
}

/** `h:mm` with a leading minus for negative values. */
export function formatHM(seconds: number): string {
  const sign = seconds < 0 ? '-' : '';
  const s = Math.floor(Math.abs(seconds));
  return `${sign}${Math.floor(s / 3600)}:${pad2(Math.floor((s % 3600) / 60))}`;
}

/** Local `HH:mm` of an instant. */
export function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** `09:00–10:30 · 1:30` */
export function formatRange(start: number, end: number): string {
  return `${formatClock(start)}–${formatClock(end)} · ${formatHM(Math.max(0, (end - start) / 1000))}`;
}

/** Splits "a, b ,c" into trimmed, de-duplicated, non-empty tags. */
export function parseTags(input: string): string[] {
  return [
    ...new Set(
      input
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ];
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
