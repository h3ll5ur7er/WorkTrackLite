# Changelog

## Unreleased

### Added

- The running timer is visible outside the app: the tab title shows
  `▶ 1:02:03 Design · …`, and the installed app gets an icon badge.
- App-icon shortcuts (long-press the installed app): Resume last timer, Stop
  timer, Schedule. They open `#/action/resume|stop`.
- Forgotten-timer guard: when the app comes back after the device slept or was
  closed with a timer running (15 min+), or a timer ran 8 h+ or past midnight,
  a dialog offers to remove the away time and keep timing, stop at a chosen
  time, or keep it. Undoable; thresholds and an off switch are in Settings.
- Colours: pick a colour per node (children inherit it) and per tag (Settings).
  Used for calendar blocks (with readable text), dashboard card stripes, tree
  dots and tag chips. Included in backups; only `#rrggbb` values are accepted.
- Reports: this/last week, this/last month, last 30 days or a custom range,
  optionally scoped to one customer/project; grouped by node (tree with
  subtotals), by day (DST-safe, midnight-crossing entries split) or by tag.
  Summary CSV and entries CSV (clipped to the range).
- Billing: hourly rate and billable flag per node (inherited by children),
  billable override per entry, currency and per-entry rounding in Settings.
  Manage shows the money value of tracked time and of the budget; Reports show
  billable time and amounts; CSV exports gain `billable,rate,amount` columns
  (appended at the end, so existing column positions are unchanged).
- Schedule views: Day, 3 days or Week, or Auto (day on phones, 3 days on
  narrow windows, week otherwise). The choice is remembered per device;
  Previous/Next step by the visible days and a Today button jumps back.
- Schedule editing: split an entry where you right-click or long-press it
  ("Split at 10:30", or "Split in half" from the keyboard); merge it with the
  previous/next entry on the same node (gaps up to 15 min, reported in the
  toast). Ctrl/Cmd/Shift-click (or "Select" in the menu) selects several
  entries: move them to another node, drag them together, merge or delete
  them. Every change can be undone; Esc clears the selection.

### Fixed

- Keys pressed right after opening a context menu or the entry editor could be
  lost: both now render and take focus inside the triggering event (as the
  command palette already did since 0.2.0), via `shared/render-now.ts`.
- After a long-press on a touch screen, the next real tap could be swallowed if
  the browser never sent the finger-lift click. Click suppression now ends as
  soon as a new touch starts.
- "Move up/down" did nothing visible when the neighbouring sibling was archived
  (and therefore hidden); it now skips hidden siblings.

## 0.2.0 (2026-10)

A renovation of the original prototype.

### Fixed

- **Single-file build rendered a blank page.** The inliner stripped
  `type="module"`, so both bundles shared one global scope and clobbered each
  other. Scripts now stay modules, and `<base>` was removed so hash routing works
  from `file://`.
- **Double-clicking a card started two timers**, one of which ran forever.
  Timer operations are now transactional and read the database; existing
  duplicates are repaired by the v2 migration.
- **"Next week" got stuck around daylight-saving changes**, and calendar days
  were off by an hour that week. All calendar math is now DST-safe.
- A quick drag release in the schedule could crash (`dragState` null), and every
  drag also opened the edit dialog.
- Concurrent settings updates could overwrite each other.
- CSV export allowed spreadsheet formula injection.
- Budget numbers on the node page ignored child nodes while the dashboard
  included them; both now use the whole subtree.

### Added

- JSON backup export / restore (validated, versioned, migrates old files),
  persistent-storage request and a Settings page.
- Archive / unarchive, notes, tags, reordering and moving nodes.
- Edit entries from the node page; undo for timer actions, moves and deletes.
- Hash routing (deep links, back button), keyboard-accessible dashboard cards,
  context menus with keyboard support, touch long-press menus.
- Live display of the running timer in the schedule.
- System theme option.

### Changed

- Angular 20 → 22, zoneless, signal-based components, new folder structure
  (`core/`, `domain/`, `features/`, `shared/`).
- Budget type `per_hour` renamed to `target` (migrated automatically).
- Karma/Jasmine replaced by Vitest; Playwright e2e suite added; ESLint and
  Prettier; CI runs everything and deploys to Pages only when green.
- Dashboard and calendar no longer recompute everything every second.

## 0.1.0 (2026-04)

Initial prototype.
