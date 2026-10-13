# Architecture

WorkTrackLite is a zoneless Angular 22 single-page app. All state lives in
IndexedDB (via [Dexie](https://dexie.org)) and is mirrored into Angular signals.
There is no server.

```
src/app/
  app.component.*      shell: header, router outlet, timer bar, toasts
  app.routes.ts        hash routes (eagerly loaded, see "Single-file build")
  app.nav.ts           top-level navigation items
  core/                stateful services (Angular, IndexedDB)
    models.ts          persisted types: Node, TimeEntry, Budget, Settings
    db.ts              Dexie schema + migrations, WORKTRACK_DB token, uid()
    data.service.ts    the single source of truth; owns every write
    timer.service.ts   live timer (transactional start/stop/toggle/undo)
    backup.service.ts  JSON export / import
    storage.service.ts persistent-storage request + usage
    theme.service.ts   dark / light / system
    toast.service.ts   notifications with optional "Undo"
  domain/              pure functions, no Angular or DB: unit-test these
    time.ts            DST-safe calendar math (never add 24h to change days)
    tree.ts            TreeIndex (children, paths, subtrees) + time aggregation
    budget.ts          budget reports
    csv.ts             CSV export (RFC 4180, formula-injection safe)
    backup.ts          backup file format: create, validate, migrate
    schedule-layout.ts calendar segments, overlap lanes, snapping
    burndown.ts        dashboard chart geometry
    entries.ts         entry invariants (one running timer)
  features/            one folder per route (+ the first-run setup)
    dashboard/  schedule/  manage/  settings/  setup/
  shared/              reusable UI: entry editor, context menu, command
                       palette, timer bar, toasts, long-press directive
  testing/             helpers for unit tests (fresh DB per test, factories)
e2e/                   Playwright tests against the production build
scripts/               single-file inliner, static server for e2e
```

## Data flow

1. Components call `DataService` / `TimerService` methods. Each write runs in a
   Dexie transaction and reads current state **from the database**, never from
   signals (which can be a few milliseconds stale). This is what makes rapid
   double clicks and multiple tabs safe.
2. Dexie's `liveQuery` notices the change (in every open tab) and
   `DataService` updates its signals: `nodes`, `entries`, `templates`,
   `settings`.
3. Derived signals are computed once and shared:
   - `tree`: a `TreeIndex` (children, paths, subtrees, dashboard visibility)
   - `entriesByNode`, `closedSubtreeSeconds` (totals of finished entries)
   - `runningEntry`
4. Views add live time on top via `liveSubtreeSeconds(...)`, so the per-second
   clock (`TimerService.now`) only triggers cheap work. Charts and the calendar
   use `TimerService.minute` instead.

Components are `OnPush` and signal-based (`input()`, `output()`, `computed`,
`linkedSignal`). There is no zone.js.

### Invariants

- At most one `TimeEntry` has `end === null` (enforced by `TimerService`,
  repaired by the v2 migration and by backup import).
- Closed entries have `end > start` (`DataService.addEntry/updateEntry`).
- The node graph is a forest: `moveNode` refuses cycles, backups with cycles or
  dangling references are rejected.
- Budgets apply to a node **and its descendants**, everywhere.

## Data and backups

Schema changes need two steps, both covered by tests:

1. **IndexedDB:** add `this.version(n + 1)` in `core/db.ts` with an
   `.upgrade()` callback. Never edit an existing version block.
2. **Backup format:** bump `BACKUP_FORMAT_VERSION` in `domain/backup.ts` and
   lift older files in `migrateBackup`. Validation lives in the same file.

A backup is `{ app: 'worktracklite', formatVersion, exportedAt, nodes, entries,
templates, settings }`. Import replaces all data in one transaction.

## Time zones

All calendar math goes through `domain/time.ts` (local-time `Date` setters).
Unit tests run with `TZ=Europe/Zurich` (set in `src/test-setup.ts`) and
Playwright uses `timezoneId: 'Europe/Zurich'`, so daylight-saving bugs show up
on every machine. CSV exports use UTC ISO timestamps.

## Single-file build

`npm run build:singlefile` runs `scripts/inline-singlefile.mjs`, which inlines
the JS and CSS bundles into `dist/worktrack-singlefile.html`. Two rules keep it
working:

- **No lazy loading** (`loadComponent`, dynamic `import()`): the script fails the
  build if extra chunks appear.
- **Scripts keep `type="module"`** and the page has **no `<base>` tag**, so hash
  routing works from `file://` under any file name.

The e2e test `single-file.spec.ts` opens the file from disk to guard both.

## Testing

| Layer                 | Tool                          | Where                            |
| --------------------- | ----------------------------- | -------------------------------- |
| Pure logic            | Vitest                        | `src/app/domain/*.spec.ts`       |
| Services + migrations | Vitest + fake-indexeddb       | `src/app/core/*.spec.ts`         |
| Components            | Vitest + TestBed (jsdom)      | `src/app/**/*.component.spec.ts` |
| User flows            | Playwright (desktop + mobile) | `e2e/*.spec.ts`                  |

Use `provideTestDb()` from `src/app/testing/test-db.ts` for a fresh database in
unit tests. E2E tests seed data through the real backup-restore flow
(`seed(page, backupJson(...))` in `e2e/fixtures.ts`) and fail on any uncaught
page error.

## Recipes

**Add a field to nodes** (e.g. an hourly rate)

1. Add it to `Node` in `core/models.ts` (optional, so old data stays valid).
2. If it needs an index or a data fix, add a Dexie version; otherwise nothing.
3. Accept it in `toNode()` in `domain/backup.ts` and add a backup test.
4. Edit it in `features/manage/node-detail.component.*`.

**Add a page**

1. Create `features/<name>/<name>.component.ts` (`ng g c features/<name>`).
2. Register it in `app.routes.ts` (eager `component:`), add it to `app.nav.ts`
   if it belongs in the main navigation (the command palette picks it up too).
3. Add an e2e spec.

**Add a command to the palette:** push an `Action` in
`CommandPaletteComponent.actions`.

**Add a derived metric:** write a pure function in `domain/`, test it, expose
it as a `computed` in `DataService` if several views need it.
