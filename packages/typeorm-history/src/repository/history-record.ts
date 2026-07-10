import { META, HistoryType } from '../metadata/meta-columns';

/** The result of {@link HistoryRecord.diffAgainst}: tracked columns whose value differs between two history rows. */
export interface HistoryDiff {
  changes: Array<{ field: string; old: unknown; new: unknown }>;
}

function eq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (a instanceof Date || b instanceof Date) {
    return new Date(a as any).getTime() === new Date(b as any).getTime();
  }
  // json/jsonb columns hydrate to fresh objects per row: compare structurally.
  if (typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/**
 * One row from an entity's history table, with typed accessors for the
 * `history_*` metadata columns and the original entity's tracked columns
 * (via {@link HistoryRecord.snapshot}).
 */
export class HistoryRecord<T> {
  constructor(
    readonly raw: Record<string, any>,
    private readonly trackedDbNames: string[],
  ) {}

  get historyId(): number {
    return this.raw[META.id];
  }
  get historyType(): HistoryType {
    return this.raw[META.type];
  }
  get historyDate(): Date {
    const v = this.raw[META.date];
    return v instanceof Date ? v : new Date(v);
  }
  get historyUserId(): string | null {
    return this.raw[META.user] ?? null;
  }
  get historyChangeReason(): string | null {
    return this.raw[META.reason] ?? null;
  }
  get snapshot(): Record<string, unknown> {
    return Object.fromEntries(this.trackedDbNames.map((k) => [k, this.raw[k]]));
  }

  diffAgainst(older: HistoryRecord<T>): HistoryDiff {
    const changes = this.trackedDbNames
      .filter((k) => !eq(this.raw[k], older.raw[k]))
      .map((k) => ({ field: k, old: older.raw[k], new: this.raw[k] }));
    return { changes };
  }
}
