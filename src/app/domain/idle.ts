import { TimeEntry } from '../core/models';
import { MS_PER_HOUR, MS_PER_MINUTE, startOfDay } from './time';

/** Why the guard asks about the running timer. */
export type IdleReason = 'away' | 'long' | 'midnight';

export interface IdleCheck {
  reason: IdleReason;
  entryId: string;
  /** For `away`: when the app was last seen alive and when it came back. */
  awayFrom?: number;
  awayTo?: number;
}

export interface IdleSettings {
  /** Gap without a heartbeat that counts as "away" (minutes). */
  awayMinutes: number;
  /** Running time after which to ask once (hours). */
  longRunningHours: number;
}

export const DEFAULT_IDLE_SETTINGS: IdleSettings = { awayMinutes: 15, longRunningHours: 8 };

/**
 * Decides whether to ask about the running timer.
 *
 * `lastSeen` is the last heartbeat of any open app tab. Hidden tabs keep
 * beating (throttled to about once a minute), so a gap only appears when the
 * device slept or the app was closed. `acknowledged` lists the reasons the
 * user already answered "keep" for this entry; an away gap is always new.
 */
export function detectIdle(
  running: TimeEntry | null,
  now: number,
  lastSeen: number | null,
  settings: IdleSettings,
  acknowledged: readonly IdleReason[] = [],
): IdleCheck | null {
  if (!running || running.end != null) return null;
  if (lastSeen != null && now - lastSeen >= settings.awayMinutes * MS_PER_MINUTE) {
    const awayFrom = Math.max(lastSeen, running.start);
    if (now - awayFrom >= settings.awayMinutes * MS_PER_MINUTE) {
      return { reason: 'away', entryId: running.id, awayFrom, awayTo: now };
    }
  }
  if (!acknowledged.includes('midnight') && running.start < startOfDay(now)) {
    return { reason: 'midnight', entryId: running.id };
  }
  if (!acknowledged.includes('long') && now - running.start >= settings.longRunningHours * MS_PER_HOUR) {
    return { reason: 'long', entryId: running.id };
  }
  return null;
}

/** Default "stop at" suggestion when there is no away gap: an hour after the start, never in the future. */
export function suggestedStop(running: TimeEntry, now: number): number {
  return Math.min(now, running.start + MS_PER_HOUR);
}
