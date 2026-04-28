// Core data model for WorkTrackLite

/**
 * BudgetType describes how a node's budget is interpreted.
 *  - none:        no budget tracking, only sums up time worked.
 *  - per_hour:    sum-up budget. A target number of hours is recorded; the
 *                 reported value is the total time tracked (can grow without
 *                 limit). Useful for "we expect ~40h on this".
 *  - fixed:       fixed budget that burns down. Reported value is
 *                 `budgetSeconds - tracked`. May go negative (overshoot).
 */
export type BudgetType = 'none' | 'per_hour' | 'fixed';

export interface Budget {
  type: BudgetType;
  /** Target / total budget in seconds. Ignored when type === 'none'. */
  seconds: number;
  /** Optional soft alert threshold in seconds (e.g. 80% of seconds). */
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
  /** Sort order among siblings. */
  order: number;
  budget: Budget;
  archived?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface TimeEntry {
  id: string;
  nodeId: string;
  /** Epoch ms */
  start: number;
  /** Epoch ms; null while a live timer is running. */
  end: number | null;
  note?: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface HierarchyTemplate {
  id: string;
  name: string;
  /** Ordered list of level labels, e.g. ["Customer","Project","Phase","Task"]. */
  levels: string[];
}

export interface Settings {
  id: 'app';
  theme: 'dark' | 'light';
  /** Currently selected hierarchy template id. Used only as a hint for new node kind suggestions. */
  templateId?: string;
  /** Last opened node id (for "resume"). */
  lastNodeId?: string;
  /** Last running timer entry id (for "resume last task"). */
  lastEntryId?: string;
}
