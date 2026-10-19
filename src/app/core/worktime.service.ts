import { Injectable, computed, inject } from '@angular/core';
import { addDays, startOfDay, toDateKey } from '../domain/time';
import { WorkSummary, targetSeconds, workSummary, workedByDay } from '../domain/worktime';
import { DataService } from './data.service';
import { Absence, TimeEntry } from './models';
import { TimerService } from './timer.service';

export interface DayWork {
  worked: number;
  target: number;
  absence: Absence | null;
}

/** Working hours, absences and the overtime balance, derived from settings and entries. */
@Injectable({ providedIn: 'root' })
export class WorkTimeService {
  private readonly data = inject(DataService);
  private readonly timer = inject(TimerService);

  readonly work = computed(() => this.data.settings().workTime ?? null);
  readonly absences = computed(() => this.data.settings().absences ?? []);
  private readonly absenceByDate = computed(() => new Map(this.absences().map((a) => [a.date, a])));

  /** Entries on nodes that count as working time. */
  private readonly workEntries = computed<TimeEntry[]>(() => {
    const tree = this.data.tree();
    return this.data.entries().filter((e) => tree.countsAsWork(e.nodeId));
  });

  /** Updated once a minute while a timer runs. */
  readonly summary = computed<WorkSummary | null>(() => {
    const work = this.work();
    if (!work) return null;
    return workSummary(this.workEntries(), work, this.absences(), this.timer.minute(), this.data.settings().weekStartsOn ?? 1);
  });

  /** Worked / target / absence for each of the given days (local midnights). */
  daysInfo(days: readonly number[]): DayWork[] {
    const work = this.work();
    if (!work || !days.length) return days.map(() => ({ worked: 0, target: 0, absence: null }));
    const worked = workedByDay(this.workEntries(), startOfDay(days[0]), addDays(startOfDay(days[days.length - 1]), 1), this.timer.minute());
    return days.map((d) => ({
      worked: worked.get(d) ?? 0,
      target: targetSeconds(d, work, this.absenceByDate()),
      absence: this.absenceByDate().get(toDateKey(d)) ?? null,
    }));
  }
}
