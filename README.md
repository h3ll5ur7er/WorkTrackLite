# WorkTrackLite

A **local-first, hierarchical time tracker** that runs entirely in your browser.
Built with Angular 18, ships as a Progressive Web App, persists everything to
IndexedDB, and can be exported as a single self-contained HTML file you can
drop on any disk or static host.

## Highlights

- **User-defined hierarchies.** Customer → Project → Phase → Task is just one
  template — pick `Software Development`, `Accounting`, `Consulting` or
  `Personal` on first run, or define your own labels per node.
- **Multiple budget models per node:**
  - `none` — track only.
  - `per_hour` — sum-up target (target hours, can grow without limit).
  - `fixed` — burn-down budget that goes negative on overshoot.
  - Optional **soft limit** for early warnings.
- **Live timer** with one-click start/stop, plus **manual entry** and a
  **resume last task** action.
- **Command palette** (`Ctrl/Cmd+K`) for keyboard-first navigation, search and
  starting timers.
- **CSV export** of the selected node or its full subtree.
- **PWA** — installable on desktop & mobile, fully offline once loaded
  (service worker, manifest, icons all included).
- **Single-file build** — `npm run build:singlefile` produces a ~360 kB
  `dist/worktrack-singlefile.html` containing the whole app inline. There's
  a download button in the header to grab it from the running app.
- **Dark / light theme**, responsive layout.
- **No backend, no telemetry.** All data lives in your browser's IndexedDB.

## Quick start

```bash
npm ci
npm start            # dev server on http://localhost:4200
npm test             # headless unit tests
npm run build        # production PWA build → dist/worktrack/browser/
npm run build:singlefile  # also produces dist/worktrack-singlefile.html
```

## Deployment

A GitHub Actions workflow (`.github/workflows/deploy.yml`) builds and
deploys to **GitHub Pages** on every push to `main`. The deployed site
includes both the regular PWA and the single-file artifact at
`/worktrack-singlefile.html`.

To enable Pages once, in the repo settings choose
*Settings → Pages → Build and deployment → Source: GitHub Actions*.

## Architecture

```
src/app/
  data/
    models.ts        # Node, TimeEntry, Budget, Settings, HierarchyTemplate
    db.ts            # Dexie schema + uid()
    templates.ts     # built-in hierarchy templates
  services/
    data.service.ts  # liveQuery → Angular signals; node/entry CRUD
    timer.service.ts # single live timer state
    budget.ts        # pure budget math (unit-tested)
    csv.ts           # pure CSV export (unit-tested)
  components/
    tree/            # hierarchical sidebar with filter
    node-detail/     # selected-node panel: budget, entries, manual log, CSV
    timer-bar/       # sticky bottom timer status
    command-palette/ # Ctrl/Cmd+K overlay
    setup/           # first-run template chooser
```

The pure logic in `services/budget.ts` and `services/csv.ts` is covered by
Jasmine specs (`*.spec.ts`) so the budget rules and CSV escaping are pinned.

## Roadmap (deliberately out of scope today)

- Charts and richer reports
- External API integration / centralised sync
- Optional encryption-at-rest
- Idle detection and predictive burn-down
