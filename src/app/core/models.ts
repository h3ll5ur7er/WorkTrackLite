// Core data model for WorkTrackLite. Everything here is persisted in IndexedDB
// (see db.ts) and round-trips through the JSON backup format (domain/backup.ts),
// so changes need a schema migration and a backup-format bump.

/**
 * BudgetType describes how a node's budget is interpreted.
 *  - none:    no budget, only sums up time worked.
 *  - target:  count-up target. The tracked total grows without limit and is
 *             compared against the target ("we expect ~40h on this").
 *             Was called `per_hour` before schema v2.
 *  - fixed:   fixed budget that burns down. Remaining = budget - tracked and
 *             may go negative (overshoot).
 */
export type BudgetType = 'none' | 'target' | 'fixed';

export interface Budget {
  type: BudgetType;
  /** Target / total budget in seconds. Ignored when type === 'none'. */
  seconds: number;
  /** Optional early-warning threshold in seconds of tracked time. */
  softLimit?: number;
}

export interface Node {
  id: string;
  parentId: string | null;
  name: string;
  /** User-defined label for this hierarchy level, e.g. "Customer", "Project". */
  kind: string;
  notes?: string;
  tags?: string[];
  /** Sort order among siblings (ascending). */
  order: number;
  budget: Budget;
  /** #rrggbb; children without their own colour inherit it. */
  color?: string;
  /** Hourly rate in the settings currency; children without their own rate inherit it. */
  rate?: number;
  /** Whether time here is billable (inherited; default true). */
  billable?: boolean;
  /** Pinned to the dashboard's quick-start row and listed first. */
  favorite?: boolean;
  /** Archived nodes are hidden from the dashboard, palette and pickers but keep their history. */
  archived?: boolean;
  /**
   * Override for dashboard visibility. When undefined, leaf nodes (no
   * non-archived children) appear on the dashboard and inner nodes do not.
   */
  showInDashboard?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface TimeEntry {
  id: string;
  nodeId: string;
  /** Epoch ms */
  start: number;
  /** Epoch ms; null while a live timer is running. At most one entry may be open. */
  end: number | null;
  note?: string;
  tags?: string[];
  /** Overrides the node's billable flag for this entry. */
  billable?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface HierarchyTemplate {
  id: string;
  name: string;
  /** Ordered list of level labels, e.g. ["Customer","Project","Phase","Task"]. */
  levels: string[];
}

export type ThemePreference = 'dark' | 'light' | 'system';

export interface Settings {
  id: 'app';
  theme: ThemePreference;
  /** Selected hierarchy template id. Only used to suggest kinds for new nodes. */
  templateId?: string;
  /** Last node a timer ran on (for "resume last"). */
  lastNodeId?: string;
  /** First weekday for the schedule (0 = Sunday, 1 = Monday, ...). Defaults to 1. */
  weekStartsOn?: number;
  /** Epoch ms of the last JSON backup export. */
  lastBackupAt?: number;
  /** Forgotten-timer guard (default on). */
  idleGuard?: boolean;
  /** Gap without the app running that counts as "away" (minutes, default 15). */
  idleAwayMinutes?: number;
  /** Ask once when a timer has run this long (hours, default 8). */
  idleLongRunningHours?: number;
  /** Toast when a budget's warning threshold or limit is crossed (default on). */
  budgetAlerts?: boolean;
  /** Also show a system notification for budget alerts (needs browser permission). */
  budgetNotifications?: boolean;
  /** Tag name → #rrggbb. */
  tagColors?: Record<string, string>;
  /** ISO 4217 code for amounts (default EUR). */
  currency?: string;
  /** Billing rounding per entry; minutes 0 = exact. */
  rounding?: Rounding;
}

export interface Rounding {
  minutes: number;
  mode: 'up' | 'nearest' | 'down';
}

export const DEFAULT_SETTINGS: Settings = { id: 'app', theme: 'system', weekStartsOn: 1 };
