import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DataService } from '../../core/data.service';
import { TimerService } from '../../core/timer.service';
import { entryDurationSeconds } from '../../domain/budget';
import { entriesToCsv } from '../../domain/csv';
import { formatHM, formatRange } from '../../domain/format';
import { highlight, isEmptyQuery, parseQuery, searchEntries } from '../../domain/search';
import { toDateKey } from '../../domain/time';
import { downloadFile } from '../../shared/download';
import { TagChipsComponent } from '../../shared/ui/tag-chips.component';

const PAGE = 100;

/** Full-text search over all entries (#/search?q=…). */
@Component({
  selector: 'app-search',
  imports: [RouterLink, TagChipsComponent],
  template: `
    <div class="search">
      <h1>Search entries</h1>
      <label class="visually-hidden" for="search-q">Search notes, tags and nodes</label>
      <input
        #box
        id="search-q"
        class="search__input"
        type="search"
        placeholder="Words in notes, tags or node names; #tag for tags"
        autocomplete="off"
        [value]="query()"
        (input)="setQuery($any($event.target).value)"
      />
      @if (!empty()) {
        <div class="search__summary">
          <span data-testid="search-summary" aria-live="polite"
            >{{ results().length }} {{ results().length === 1 ? 'entry' : 'entries' }} · {{ formatHM(totalSeconds()) }}</span
          >
          @if (results().length) {
            <button type="button" class="btn btn--small" (click)="exportCsv()">⬇ CSV of these</button>
          }
        </div>
        <ol class="search__list" aria-label="Results">
          @for (r of shown(); track r.entry.id) {
            <li>
              <a class="search__hit" [routerLink]="['/schedule']" [queryParams]="{ at: r.entry.start, entry: r.entry.id }">
                <span class="search__when">
                  <span>{{ r.day }}</span>
                  <span class="muted">{{ r.range }}</span>
                </span>
                <span class="search__what">
                  <span class="search__path">
                    @for (seg of r.path; track $index) {
                      @if (seg.match) {
                        <mark>{{ seg.text }}</mark>
                      } @else {
                        {{ seg.text }}
                      }
                    }
                  </span>
                  @if (r.note.length) {
                    <span class="search__note">
                      @for (seg of r.note; track $index) {
                        @if (seg.match) {
                          <mark>{{ seg.text }}</mark>
                        } @else {
                          {{ seg.text }}
                        }
                      }
                    </span>
                  }
                  <app-tag-chips [tags]="r.entry.tags" />
                </span>
              </a>
            </li>
          } @empty {
            <li class="muted">No entries match.</li>
          }
        </ol>
        @if (results().length > shown().length) {
          <button type="button" class="btn" (click)="limit.set(limit() + PAGE)">
            Show more ({{ results().length - shown().length }} left)
          </button>
        }
      } @else {
        <p class="muted">
          Finds entries by their note, tags and node path (customer, project, …). All words must match; accents are ignored.
        </p>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .search {
      max-width: 860px;
      padding: 16px 16px 100px;
      box-sizing: border-box;
    }
    .search__input {
      width: 100%;
      box-sizing: border-box;
      padding: 10px 12px;
      font: inherit;
      font-size: 1.05rem;
      background: var(--c-bg-2);
      color: inherit;
      border: 1px solid var(--c-border);
      border-radius: 8px;
    }
    .search__summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin: 12px 0 6px;
      color: var(--c-fg-3);
    }
    .search__list {
      list-style: none;
      margin: 0 0 12px;
      padding: 0;
    }
    .search__hit {
      display: flex;
      gap: 14px;
      padding: 8px 10px;
      border-bottom: 1px solid var(--c-border);
      color: inherit;
      text-decoration: none;
      border-radius: 6px;
      &:hover,
      &:focus-visible {
        background: var(--c-accent-bg);
      }
    }
    .search__when {
      display: flex;
      flex-direction: column;
      min-width: 9.5rem;
      font-variant-numeric: tabular-nums;
      font-size: 0.85rem;
    }
    .search__what {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .search__path {
      font-weight: 600;
    }
    mark {
      background: var(--c-accent-bg);
      color: var(--c-accent);
      border-radius: 2px;
    }
    @media (max-width: 520px) {
      .search__hit {
        flex-direction: column;
        gap: 4px;
      }
      .search__when {
        flex-direction: row;
        gap: 8px;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchComponent implements AfterViewInit {
  private readonly data = inject(DataService);
  private readonly timer = inject(TimerService);
  private readonly router = inject(Router);

  /** Query parameter (bound via withComponentInputBinding). */
  readonly q = input<string | undefined>();
  protected readonly query = linkedSignal(() => this.q() ?? '');
  protected readonly limit = signal(PAGE);
  protected readonly PAGE = PAGE;
  protected readonly formatHM = formatHM;
  private readonly box = viewChild.required<ElementRef<HTMLInputElement>>('box');

  private readonly parsed = computed(() => parseQuery(this.query()));
  protected readonly empty = computed(() => isEmptyQuery(this.parsed()));
  protected readonly results = computed(() => searchEntries(this.data.entries(), this.data.tree(), this.parsed()));
  protected readonly totalSeconds = computed(() => this.results().reduce((s, e) => s + entryDurationSeconds(e, this.timer.minute()), 0));
  protected readonly shown = computed(() => {
    const tree = this.data.tree();
    const words = this.parsed().words;
    return this.results()
      .slice(0, this.limit())
      .map((entry) => ({
        entry,
        day: new Date(entry.start).toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }),
        range: formatRange(entry.start, entry.end ?? this.timer.minute()) + (entry.end == null ? ' · running' : ''),
        path: highlight(tree.pathLabel(entry.nodeId) || '(deleted node)', words),
        note: highlight(entry.note ?? '', words),
      }));
  });

  ngAfterViewInit(): void {
    this.box().nativeElement.focus();
  }

  protected setQuery(v: string): void {
    this.query.set(v);
    this.limit.set(PAGE);
    // Keep the query in the URL (Back returns to it) without piling up history entries.
    void this.router.navigate([], { queryParams: { q: v || null }, replaceUrl: true });
  }

  protected exportCsv(): void {
    const csv = entriesToCsv(this.results(), this.data.tree(), Date.now(), this.data.settings().rounding);
    downloadFile(`where-time-flew-search-${toDateKey(Date.now())}.csv`, csv, 'text/csv');
  }
}
