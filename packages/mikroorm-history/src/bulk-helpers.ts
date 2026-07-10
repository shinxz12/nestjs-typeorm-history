import type { EntityManager, FilterQuery } from '@mikro-orm/core';
import { ERR, HistoryType } from '@entity-history/core';
import { MikroEntry, requireEntry } from './entry';
import type { EntityClass } from './history-repository';
import { writeHistoryRowsRaw } from './history-subscriber';
import { validateEntry } from './runtime-meta';

/**
 * Raw select of full source rows by pk (raw db column names). The query
 * builder does not apply MikroORM global filters, so soft-deleted rows are
 * included — exactly what history snapshots need.
 */
async function selectRawByIds(
  em: EntityManager,
  targetName: string,
  pkProp: string,
  ids: unknown[],
): Promise<Record<string, unknown>[]> {
  return (em as any)
    .createQueryBuilder(targetName, 't')
    .select('*')
    .where({ [pkProp]: { $in: ids } })
    .execute('all', false);
}

async function bulkOp<T extends object>(
  em: EntityManager,
  target: EntityClass<T>,
  where: FilterQuery<T>,
  op: (tem: EntityManager, ids: unknown[], pkProp: string, entry: MikroEntry) => Promise<void>,
  snapshotPhase: 'before' | 'after',
  type: HistoryType,
): Promise<{ affected: number }> {
  const entry = requireEntry(target);
  return em.transactional(async (tem) => {
    validateEntry(tem, entry);
    const meta = (tem.getMetadata() as any).getByClassName?.(target.name) ?? (tem.getMetadata() as any).find?.(target.name);
    const pkProp = meta.primaryKeys[0];
    const matched = await tem.find(target, where, { fields: [pkProp] as any, filters: false });
    if (matched.length === 0) return { affected: 0 };
    const ids = matched.map((m: any) => m[pkProp]);

    let rawRows: Record<string, unknown>[];
    if (snapshotPhase === 'before') {
      rawRows = await selectRawByIds(tem, target.name, pkProp, ids);
      await op(tem, ids, pkProp, entry);
    } else {
      await op(tem, ids, pkProp, entry);
      rawRows = await selectRawByIds(tem, target.name, pkProp, ids);
    }
    await writeHistoryRowsRaw(type, entry, rawRows, tem);
    return { affected: ids.length };
  });
}

/**
 * Updates every row matching `where` and writes one 'update' history row per
 * affected entity, in a single transaction. Plain `em.nativeUpdate` bypasses
 * subscriber events and produces no history — use this instead.
 */
export async function bulkUpdateWithHistory<T extends object>(
  em: EntityManager,
  target: EntityClass<T>,
  where: FilterQuery<T>,
  patch: Partial<T>,
): Promise<{ affected: number }> {
  return bulkOp(
    em,
    target,
    where,
    async (tem, ids, pkProp) => {
      await tem.nativeUpdate(target, { [pkProp]: { $in: ids } } as any, patch);
    },
    'after',
    'update',
  );
}

/**
 * Deletes every row matching `where` and writes one 'delete' history row per
 * affected entity (captured before the delete, so FK columns survive).
 */
export async function bulkDeleteWithHistory<T extends object>(
  em: EntityManager,
  target: EntityClass<T>,
  where: FilterQuery<T>,
): Promise<{ affected: number }> {
  return bulkOp(
    em,
    target,
    where,
    async (tem, ids, pkProp) => {
      await tem.nativeDelete(target, { [pkProp]: { $in: ids } } as any);
    },
    'before',
    'delete',
  );
}

/**
 * Soft-deletes (sets `softDeleteField`) every row matching `where` with one
 * 'delete' history row per entity. Requires `@Historized({ softDeleteField })`.
 */
export async function bulkSoftDeleteWithHistory<T extends object>(
  em: EntityManager,
  target: EntityClass<T>,
  where: FilterQuery<T>,
): Promise<{ affected: number }> {
  const entry = requireEntry(target);
  const field = entry.options.softDeleteField;
  if (!field) throw new Error(`${ERR} ${target.name} has no softDeleteField — cannot soft delete.`);
  return bulkOp(
    em,
    target,
    where,
    async (tem, ids, pkProp) => {
      await tem.nativeUpdate(target, { [pkProp]: { $in: ids } } as any, { [field]: new Date() } as any);
    },
    'after',
    'delete',
  );
}

/**
 * Restores (clears `softDeleteField`) every row matching `where` with one
 * 'update' history row per entity.
 */
export async function bulkRestoreWithHistory<T extends object>(
  em: EntityManager,
  target: EntityClass<T>,
  where: FilterQuery<T>,
): Promise<{ affected: number }> {
  const entry = requireEntry(target);
  const field = entry.options.softDeleteField;
  if (!field) throw new Error(`${ERR} ${target.name} has no softDeleteField — nothing to restore.`);
  return bulkOp(
    em,
    target,
    where,
    async (tem, ids, pkProp) => {
      await tem.nativeUpdate(target, { [pkProp]: { $in: ids } } as any, { [field]: null } as any);
    },
    'after',
    'update',
  );
}
