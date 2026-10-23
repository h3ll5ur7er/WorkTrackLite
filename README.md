# Where Time Flew (WTF)

A **local-first, hierarchical time tracker** that runs entirely in your browser.
No backend, no account, no telemetry: data lives in IndexedDB on your device.
It installs as a PWA, works offline, and also ships as **one self-contained HTML
file** you can open straight from disk.

## Features

- **Your own hierarchy.** Customer → Project → Phase → Task is just one template
  (others: Accounting, Consulting, Personal). Every node has a free-text kind,
  notes and tags; reorder, move or archive nodes at any time.
- **Budgets per node, covering its whole subtree:**
  `none` (track only), `target` (count up towards a goal) or `fixed` (burns down,
  goes negative on overshoot), each with an optional early-warning threshold, and
  an alert (toast or system notification) when a limit is crossed.
- **Dashboard** of leaf nodes with burn-down charts and a quick-start row of
  favourites and recently used nodes. Click to start or stop a timer; every timer
  action can be undone. The running timer also shows in the tab title and on the
  installed app's icon, and its note and tags can be edited while it runs.
- **Schedule** as day, 3-day or week view (automatic by screen size) with
  drag-to-move, resize, snapping (15 min, or 1 min with <kbd>Shift</kbd>),
  copy/paste, drag-from-tree, split and merge, multi-select to move, reassign
  or delete several entries at once, "copy from last week", and recurring entries
  offered as suggestions to confirm.
- **Working time**: target hours per weekday, absences (vacation, sick, holidays,
  half days) and an overtime balance on the dashboard.
- **Locked periods**: after invoicing, make a period read-only.
- **Search** across all notes, tags and node names (accent-insensitive, `#tag`),
  with CSV export of the results.
- **Forgotten-timer guard**: after sleep, a closed tab, 8 h+ or midnight, it asks
  whether to drop the away time, stop at a chosen time, or keep it.
- **Colours** per node (inherited) and per tag.
- **Reports** for any date range, grouped by node, day or tag, with CSV export.
- **Billing**: hourly rates and billable flags (inherited), per-entry rounding,
  amounts in reports and CSV.
- **Command palette** (<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd>) for navigation, timers and commands.
- **JSON backup / restore**, optionally encrypted with a password (AES-256-GCM,
  PBKDF2), and a request for persistent storage, so the browser does not silently
  evict your data. **CSV export** per node or subtree.
- Dark / light / system theme, keyboard and screen-reader friendly, touch support
  (long-press opens context menus).

## Quick start

Requires Node.js 24 LTS (see `.nvmrc`; 22.22.3+ also works).

```bash
npm ci
npm start                 # dev server on http://localhost:4200
npm test                  # unit tests (Vitest)
npm run e2e               # production + single-file build, then Playwright e2e
npm run check             # everything CI runs: format, lint, unit, e2e
```

First e2e run on a new machine: `npx playwright install --with-deps chromium`.

| Script                        | What it does                                                 |
| ----------------------------- | ------------------------------------------------------------ |
| `npm run build`               | Production PWA build → `dist/where-time-flew/browser/`       |
| `npm run build:singlefile`    | Also writes `dist/where-time-flew-singlefile.html`           |
| `npm run test:watch`          | Unit tests in watch mode                                     |
| `npm run test:coverage`       | Unit tests with coverage report in `coverage/`               |
| `npm run e2e:only`            | Playwright against an existing `dist/` (skip the build)      |
| `npm run lint`                | ESLint (incl. template accessibility rules) + e2e type-check |
| `npm run format`              | Prettier                                                     |
| `node scripts/serve-dist.mjs` | Serve the production build on http://localhost:4300          |

## Deployment

`.github/workflows/ci.yml` runs format, lint, unit tests and e2e tests on every
pull request and push. On `main`, a green run deploys to **GitHub Pages**
(including `/where-time-flew-singlefile.html`). Enable it once under
_Settings → Pages → Build and deployment → Source: GitHub Actions_.

The Pages address contains the repository name
(`https://<user>.github.io/<repository>/`), so renaming the repository moves the
app to a new address. Data stays (browsers store it per site, and the site is
the same `github.io` host), but an installed app must be reinstalled from the
new address.

## Your data

Everything is stored in the browser profile that opened the app (and the
single-file copy has its own, separate storage). Use **Settings → Export
backup** regularly; restore works on any device. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#data-and-backups) for the format.

## Project docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the code is organised and how to extend it
- [CHANGELOG.md](CHANGELOG.md): what changed between versions
- [CLAUDE.md](CLAUDE.md): working notes for AI coding assistants

## Roadmap ideas

- Optional sync (e.g. via a user-provided WebDAV/S3 bucket) and encryption at rest
- Invoices (PDF) from a report
