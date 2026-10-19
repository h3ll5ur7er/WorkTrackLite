import { TimeEntry } from '../core/models';
import { addDays, fromDateKey, startOfDay } from './time';

/** End of the locked period (local midnight after `lockedUntil`), or null when nothing is locked. */
export function lockEnd(lockedUntil: string | undefined): number | null {
  const day = lockedUntil ? fromDateKey(lockedUntil) : null;
  return day == null ? null : addDays(day, 1);
}

/** An entry is locked if it starts inside the locked period (an entry crossing its end has locked time in it). */
export function isLocked(start: number, lockEndMs: number | null): boolean {
  return lockEndMs != null && start < lockEndMs;
}

export class LockedError extends Error {
  constructor(lockedUntil: string) {
    const day = fromDateKey(lockedUntil);
    const label =
      day == null ? lockedUntil : new Date(day).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    super(`Entries up to ${label} are locked. Unlock the period in Settings to change them.`);
  }
}

/** Why `lockedUntil` cannot be locked now, or null if it can. */
export function lockProblem(lockedUntil: string, now: number, running: TimeEntry | null): string | null {
  const end = lockEnd(lockedUntil);
  if (end == null) return 'Pick a valid date.';
  if (end > startOfDay(now)) return 'Only days before today can be locked.';
  if (running && running.start < end) return 'A running timer started in that period; stop it first.';
  return null;
}
