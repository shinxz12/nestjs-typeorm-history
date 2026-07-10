import type { EntityManager, EventArgs, EventSubscriber } from '@mikro-orm/core';
import { ReferenceKind } from '@mikro-orm/core';
import { getHistoryContext, HistoryType, META } from '@entity-history/core';
import { entryFor, MikroEntry, shadowNameOf } from './entry';
import { validateEntry } from './runtime-meta';

/** Builds the flat raw row (db column names) for one entity from its in-memory state. */
export function snapshotOf(em: EntityManager, entry: MikroEntry, entity: any): Record<string, unknown> {
  const meta = em.getMetadata().get(entry.target.name);
  const row: Record<string, unknown> = {};
  for (const prop of Object.values(meta.properties) as any[]) {
    const dbName = prop.fieldNames?.[0];
    if (!dbName || !entry.trackedDbNames!.has(dbName)) continue;
    let v = entity[prop.name];
    if (v != null && prop.kind !== ReferenceKind.SCALAR) {
      // Relation: store the referenced pk. Unwrap Reference wrappers.
      const target = typeof v.unwrap === 'function' ? v.unwrap() : v;
      const refPk = em.getMetadata().get(prop.type).primaryKeys[0];
      v = target?.[refPk];
    }
    row[dbName] = v === undefined ? null : v;
  }
  return row;
}

/** Writes one history row per already-flat raw source row, in a single INSERT on `em`'s transaction. */
export async function writeHistoryRowsRaw(
  type: HistoryType,
  entry: MikroEntry,
  rawSourceRows: Array<Record<string, unknown>>,
  em: EntityManager,
): Promise<void> {
  if (rawSourceRows.length === 0) return;
  const ctx = getHistoryContext();
  const date = new Date();
  const rows = rawSourceRows.map((rawSourceRow) => {
    const row: Record<string, unknown> = {};
    for (const dbName of entry.trackedDbNames!) row[dbName] = rawSourceRow[dbName] ?? null;
    row[META.type] = type;
    row[META.date] = date;
    row[META.user] = ctx?.userId ?? null;
    row[META.reason] = ctx?.changeReason ?? null;
    return row;
  });
  await (em as any).createQueryBuilder(shadowNameOf(entry)).insert(rows).execute('run');
}

/**
 * MikroORM subscriber that writes a history row after every create, update,
 * and delete on a `@Historized()` entity. Register once per ORM instance:
 *
 * ```ts
 * MikroORM.init({ ..., subscribers: [new HistorySubscriber()] })
 * ```
 */
export class HistorySubscriber implements EventSubscriber {
  async afterCreate(args: EventArgs<any>): Promise<void> {
    await this.record('create', args);
  }

  async afterUpdate(args: EventArgs<any>): Promise<void> {
    const entry = entryFor(args.entity.constructor);
    if (!entry) return;
    await this.record(softDeleteType(entry, args), args);
  }

  async afterDelete(args: EventArgs<any>): Promise<void> {
    await this.record('delete', args);
  }

  private async record(type: HistoryType, args: EventArgs<any>): Promise<void> {
    const entry = entryFor(args.entity.constructor);
    if (!entry) return;
    validateEntry(args.em, entry);
    await writeHistoryRowsRaw(type, entry, [snapshotOf(args.em, entry, args.entity)], args.em);
  }
}

/** Maps an update to 'delete'/'update' when it sets/clears the configured soft-delete field. */
function softDeleteType(entry: MikroEntry, args: EventArgs<any>): HistoryType {
  const field = entry.options.softDeleteField;
  if (!field || !args.changeSet || !(field in (args.changeSet.payload ?? {}))) return 'update';
  const now = (args.entity as any)[field];
  const before = (args.changeSet.originalEntity as any)?.[field];
  if (now != null && before == null) return 'delete';
  return 'update'; // includes recover (set -> null): same mapping as the TypeORM adapter
}
