import { Rounding, TimeEntry } from '../core/models';
import { Piece } from './reports';
import { TreeIndex } from './tree';

export const DEFAULT_CURRENCY = 'EUR';
export const NO_ROUNDING: Rounding = { minutes: 0, mode: 'nearest' };

/** Seconds after applying a rounding rule (e.g. "each entry up to 15 min"). */
export function roundSeconds(seconds: number, rounding: Rounding = NO_ROUNDING): number {
  if (!rounding.minutes || rounding.minutes <= 0 || seconds <= 0) return Math.max(0, seconds);
  const step = rounding.minutes * 60;
  const q = seconds / step;
  const n = rounding.mode === 'up' ? Math.ceil(q - 1e-9) : rounding.mode === 'down' ? Math.floor(q + 1e-9) : Math.round(q);
  return n * step;
}

/** Billable unless the entry or the nearest node that says so says otherwise. */
export function isBillable(tree: TreeIndex, entry: Pick<TimeEntry, 'nodeId' | 'billable'>): boolean {
  if (entry.billable !== undefined) return entry.billable;
  return tree.billableOf(entry.nodeId);
}

export interface Amount {
  /** Rounded billable seconds. */
  billableSeconds: number;
  /** Money for those seconds (0 when no rate applies). */
  amount: number;
}

/** Billable time and money of one piece of an entry. */
export function amountOf(tree: TreeIndex, piece: Piece, rounding: Rounding = NO_ROUNDING): Amount {
  if (!isBillable(tree, piece.entry)) return { billableSeconds: 0, amount: 0 };
  const billableSeconds = roundSeconds(piece.seconds, rounding);
  const rate = tree.rateOf(piece.entry.nodeId) ?? 0;
  return { billableSeconds, amount: roundCents((billableSeconds / 3600) * rate) };
}

/** Billable seconds and amounts per node, summed over each node's subtree. */
export function amountsByNode(tree: TreeIndex, pieces: readonly Piece[], rounding: Rounding = NO_ROUNDING): Map<string, Amount> {
  const own = new Map<string, Amount>();
  for (const p of pieces) {
    const a = amountOf(tree, p, rounding);
    const cur = own.get(p.entry.nodeId) ?? { billableSeconds: 0, amount: 0 };
    own.set(p.entry.nodeId, { billableSeconds: cur.billableSeconds + a.billableSeconds, amount: roundCents(cur.amount + a.amount) });
  }
  const total = new Map<string, Amount>();
  const visit = (id: string): Amount => {
    const sum = { ...(own.get(id) ?? { billableSeconds: 0, amount: 0 }) };
    for (const k of tree.childrenOf(id, { includeArchived: true })) {
      const c = visit(k.id);
      sum.billableSeconds += c.billableSeconds;
      sum.amount = roundCents(sum.amount + c.amount);
    }
    total.set(id, sum);
    return sum;
  };
  for (const r of tree.roots({ includeArchived: true })) visit(r.id);
  return total;
}

export function totalAmount(tree: TreeIndex, pieces: readonly Piece[], rounding: Rounding = NO_ROUNDING): Amount {
  return pieces.reduce<Amount>(
    (acc, p) => {
      const a = amountOf(tree, p, rounding);
      return { billableSeconds: acc.billableSeconds + a.billableSeconds, amount: roundCents(acc.amount + a.amount) };
    },
    { billableSeconds: 0, amount: 0 },
  );
}

export function formatMoney(amount: number, currency = DEFAULT_CURRENCY): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function isCurrencyCode(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Z]{3}$/.test(v);
}

function roundCents(v: number): number {
  return Math.round(v * 100) / 100;
}
