import { EntityManager, EntityMetadata, FindOptionsWhere, In, ObjectLiteral, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { ERR } from '../errors';
import { RegistryEntry, requireHistorized } from '../metadata/registry';
import { writeHistoryRowsRaw } from '../subscriber/history-subscriber';

function requireEntry(repo: Repository<any>): RegistryEntry {
  return requireHistorized(repo.metadata.target as Function, { needSchema: true });
}

/**
 * Raw select by primary key (not `em.find`, which doesn't load relation FK
 * columns and hides soft-deleted rows). Escapes the pk name ourselves: the
 * raw-from alias has no metadata, so TypeORM won't rewrite/escape it.
 */
function selectRawByIds(
  em: EntityManager,
  metadata: EntityMetadata,
  ids: unknown[],
): Promise<Record<string, unknown>[]> {
  const pkDb = metadata.primaryColumns[0].databaseName;
  return em
    .createQueryBuilder()
    .select('*')
    .from(metadata.tablePath, 't')
    // TypeORM resolves the table name to entity metadata and would append
    // `deleted_at IS NULL` — history snapshots must see soft-deleted rows.
    .withDeleted()
    .where(`${em.connection.driver.escape(pkDb)} IN (:...ids)`, { ids })
    .getRawMany();
}

function normalizeRawRowsForHistoryInsert(
  em: EntityManager,
  metadata: EntityMetadata,
  entry: RegistryEntry,
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  return rows.map((row) => {
    const normalized = { ...row };
    for (const col of metadata.columns) {
      if (!entry.trackedDbNames!.has(col.databaseName) || col.transformer) continue;
      normalized[col.databaseName] = em.connection.driver.prepareHydratedValue(row[col.databaseName], col);
    }
    return normalized;
  });
}

/**
 * Updates every row matching `criteria` and writes one `'update'` history row
 * per affected entity, in a single transaction. Plain
 * `repository.update()` does not produce history (see the package
 * README) — use this instead for bulk updates.
 */
export async function bulkUpdateWithHistory<T extends ObjectLiteral>(
  repo: Repository<T>,
  criteria: FindOptionsWhere<T>,
  patch: QueryDeepPartialEntity<T>,
): Promise<{ affected: number }> {
  const entry = requireEntry(repo);
  const pkProp = repo.metadata.primaryColumns[0].propertyName;
  return repo.manager.transaction(async (em) => {
    const matched = await em.find(repo.target, { where: criteria, select: [pkProp] as any });
    if (matched.length === 0) return { affected: 0 };
    const ids = matched.map((m) => (m as any)[pkProp]);
    await em.update(repo.target, { [pkProp]: In(ids) } as any, patch);
    const rawRows = normalizeRawRowsForHistoryInsert(em, repo.metadata, entry, await selectRawByIds(em, repo.metadata, ids));
    await writeHistoryRowsRaw('update', entry, rawRows, em);
    return { affected: rawRows.length };
  });
}

/**
 * Deletes every row matching `criteria` and writes one `'delete'` history row
 * per affected entity (captured before the delete, so relation FK columns
 * survive), in a single transaction.
 */
export async function bulkDeleteWithHistory<T extends ObjectLiteral>(
  repo: Repository<T>,
  criteria: FindOptionsWhere<T>,
): Promise<{ affected: number }> {
  const entry = requireEntry(repo);
  const pkProp = repo.metadata.primaryColumns[0].propertyName;
  return repo.manager.transaction(async (em) => {
    const matched = await em.find(repo.target, { where: criteria });
    if (matched.length === 0) return { affected: 0 };
    const ids = matched.map((m) => (m as any)[pkProp]);
    const rawRows = normalizeRawRowsForHistoryInsert(em, repo.metadata, entry, await selectRawByIds(em, repo.metadata, ids));
    await em.delete(repo.target, { [pkProp]: In(ids) } as any);
    await writeHistoryRowsRaw('delete', entry, rawRows, em);
    return { affected: matched.length };
  });
}

/**
 * Soft-deletes every row matching `criteria` and writes one `'delete'` history
 * row per affected entity, in a single transaction. Criteria-based
 * `repository.softDelete()` broadcasts its subscriber event without the
 * entity, so it cannot produce history (see the package README) — use
 * this instead for bulk soft deletes.
 */
export async function bulkSoftDeleteWithHistory<T extends ObjectLiteral>(
  repo: Repository<T>,
  criteria: FindOptionsWhere<T>,
): Promise<{ affected: number }> {
  const entry = requireEntry(repo);
  if (!repo.metadata.deleteDateColumn)
    throw new Error(`${ERR} ${repo.metadata.name} has no @DeleteDateColumn — cannot soft delete.`);
  const pkProp = repo.metadata.primaryColumns[0].propertyName;
  return repo.manager.transaction(async (em) => {
    const matched = await em.find(repo.target, { where: criteria });
    if (matched.length === 0) return { affected: 0 };
    const ids = matched.map((m) => (m as any)[pkProp]);
    await em.softDelete(repo.target, { [pkProp]: In(ids) } as any);
    // Reselect after the soft delete so the history row carries the
    // populated delete-date column.
    const rawRows = normalizeRawRowsForHistoryInsert(em, repo.metadata, entry, await selectRawByIds(em, repo.metadata, ids));
    await writeHistoryRowsRaw('delete', entry, rawRows, em);
    return { affected: matched.length };
  });
}

/**
 * Restores every soft-deleted row matching `criteria` and writes one `'update'`
 * history row per affected entity, in a single transaction. Criteria-based
 * `repository.restore()` broadcasts its subscriber event without the
 * entity, so it cannot produce history — use this instead.
 */
export async function bulkRestoreWithHistory<T extends ObjectLiteral>(
  repo: Repository<T>,
  criteria: FindOptionsWhere<T>,
): Promise<{ affected: number }> {
  const entry = requireEntry(repo);
  const deleteCol = repo.metadata.deleteDateColumn;
  if (!deleteCol) throw new Error(`${ERR} ${repo.metadata.name} has no @DeleteDateColumn — nothing to restore.`);
  const pkProp = repo.metadata.primaryColumns[0].propertyName;
  return repo.manager.transaction(async (em) => {
    const matched = (await em.find(repo.target, { where: criteria, withDeleted: true })).filter(
      (m) => deleteCol.getEntityValue(m) != null,
    );
    if (matched.length === 0) return { affected: 0 };
    const ids = matched.map((m) => (m as any)[pkProp]);
    await em.restore(repo.target, { [pkProp]: In(ids) } as any);
    const rawRows = normalizeRawRowsForHistoryInsert(em, repo.metadata, entry, await selectRawByIds(em, repo.metadata, ids));
    await writeHistoryRowsRaw('update', entry, rawRows, em);
    return { affected: matched.length };
  });
}
