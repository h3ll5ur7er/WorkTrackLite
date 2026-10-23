# Where Time Flew: notes for AI assistants

Local-first time tracker: zoneless Angular 22 + Dexie (IndexedDB), no backend.
Read `docs/ARCHITECTURE.md` before larger changes.

## Commands

- `npm test`: Vitest unit/component tests (TZ pinned to Europe/Zurich)
- `npm run lint`: ESLint incl. template a11y rules + e2e type-check
- `npm run format`: Prettier (CI runs `format:check`)
- `npm run e2e`: builds prod + single-file, runs Playwright (`e2e:only` skips the build)
- `npm run check`: everything CI runs

Requires Node 24 (`.nvmrc`). If Playwright's browser is missing, run
`npx playwright install chromium`, or point `PLAYWRIGHT_CHROMIUM_EXECUTABLE` at a Chromium binary.

## Conventions

- Pure logic goes in `src/app/domain/` (no Angular, no Dexie) with a spec next to it.
- All writes go through `DataService`/`TimerService` inside Dexie transactions that
  read from the DB, not from signals.
- Components: standalone, `OnPush`, signals (`input()`, `output()`, `computed`,
  `linkedSignal`), `@if/@for` control flow, no `FormsModule`.
- Calendar math only via `domain/time.ts` (DST-safe; never `+ 24 * 3600 * 1000`).
- Schema change = new Dexie version in `core/db.ts` + `BACKUP_FORMAT_VERSION` bump
  and migration in `domain/backup.ts`.
- No lazy routes or dynamic `import()`: the single-file build must stay one bundle.
- Keep `index.html` free of `<base>` (hash routing from `file://`).
- The app was renamed from WorkTrackLite: keep the `worktracklite` IndexedDB name,
  the `worktracklite.*` localStorage keys and the legacy backup id (existing data).
- Opening something the user types into (menu, dialog, palette): set state, then
  `renderNow(cdr)` from `shared/render-now.ts`, and focus in `ngAfterViewInit`.
- Fixed bugs get a regression test (unit or e2e).
