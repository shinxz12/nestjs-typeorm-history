import {
  EntityManager,
  EntityMetadata,
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
  RecoverEvent,
  RemoveEvent,
  SoftRemoveEvent,
  UpdateEvent,
} from 'typeorm';
import { ApplyValueTransformers } from 'typeorm/util/ApplyValueTransformers';
import { getHistoryContext } from '../context/history-context';
import { META, HistoryType } from '../metadata/meta-columns';
import { getHistorizedEntry, RegistryEntry, requireHistorized } from '../metadata/registry';

function entryFor(metadata: EntityMetadata): RegistryEntry | undefined {
  if (!getHistorizedEntry(metadata.target as Function)) return undefined;
  return requireHistorized(metadata.target as Function, { needSchema: true });
}

async function reselectRaw(
  metadata: EntityMetadata,
  pkVal: unknown,
  manager: EntityManager,
): Promise<Record<string, unknown> | undefined> {
  const pkCol = metadata.primaryColumns[0];
  // The raw-from alias has no metadata, so TypeORM won't rewrite/escape the
  // column name for us: escape it here or camelCase/reserved names break.
  const pkDb = manager.connection.driver.escape(pkCol.databaseName);
  return manager
    .createQueryBuilder()
    .select('*')
    .from(metadata.tablePath, 't')
    // Include soft-deleted rows: afterSoftRemove reselects after the
    // delete-date column is already set.
    .withDeleted()
    .where(`${pkDb} = :pk`, { pk: pkVal })
    .getRawOne();
}

/** Writes one history row per already-flat raw source row (plain db column names, no ORM relation traversal), in a single INSERT. */
export async function writeHistoryRowsRaw(
  type: HistoryType,
  entry: RegistryEntry,
  rawSourceRows: Array<Record<string, unknown>>,
  manager: EntityManager,
): Promise<void> {
  if (rawSourceRows.length === 0) return;
  const ctx = getHistoryContext();
  const date = new Date();
  const rows = rawSourceRows.map((rawSourceRow) => {
    const row: Record<string, unknown> = {};
    for (const dbName of entry.trackedDbNames!) {
      row[dbName] = rawSourceRow[dbName] ?? null;
    }
    row[META.type] = type;
    row[META.date] = date;
    row[META.user] = ctx?.userId ?? null;
    row[META.reason] = ctx?.changeReason ?? null;
    return row;
  });
  await manager.getRepository(entry.schema!).insert(rows as any);
}

/** Writes one history row from an already-flat raw source row. See {@link writeHistoryRowsRaw}. */
export async function writeHistoryRowRaw(
  type: HistoryType,
  entry: RegistryEntry,
  rawSourceRow: Record<string, unknown>,
  manager: EntityManager,
): Promise<void> {
  await writeHistoryRowsRaw(type, entry, [rawSourceRow], manager);
}

/**
 * Builds and writes one history row for `entity`, using `entity`'s own
 * column values and falling back to a raw re-select by primary key for
 * any column TypeORM didn't populate on the in-memory instance (e.g. an
 * unloaded relation's FK). Used internally by {@link HistorySubscriber}
 * and the bulk helpers; exported for advanced use only.
 */
export async function recordHistoryRow(
  type: HistoryType,
  metadata: EntityMetadata,
  entity: any,
  manager: EntityManager,
  reselect: boolean,
  precomputedRaw?: Record<string, unknown>,
): Promise<void> {
  if (!entity) return;
  const entry = entryFor(metadata);
  if (!entry) return;

  // Query-builder bulk operations (repo.update()/delete() with a criteria object)
  // also broadcast subscriber events in TypeORM 0.3.x, but without a resolvable
  // primary key on `entity`. Those bulk paths write their own history rows
  // (bulkUpdateWithHistory / bulkDeleteWithHistory); skip here to avoid a
  // crash and to avoid double-recording.
  const pkCol = metadata.primaryColumns[0];
  const pkVal = pkCol.getEntityValue(entity);
  if (pkVal === undefined) return;

  let raw = precomputedRaw;
  const needsRaw = () =>
    !raw &&
    metadata.columns.some(
      (c) => entry.trackedDbNames!.has(c.databaseName) && c.getEntityValue(entity) === undefined,
    );
  if (reselect && needsRaw()) {
    raw = await reselectRaw(metadata, pkVal, manager);
  }

  const rawSourceRow: Record<string, unknown> = {};
  for (const col of metadata.columns) {
    if (!entry.trackedDbNames!.has(col.databaseName)) continue;
    const v = col.getEntityValue(entity);
    // Entity values are domain values; history rows store the database
    // representation (like the reselect fallback below), so apply the
    // column's transformer before writing.
    rawSourceRow[col.databaseName] =
      v !== undefined
        ? col.transformer
          ? ApplyValueTransformers.transformTo(col.transformer, v)
          : v
        : raw?.[col.databaseName] ?? null;
  }
  await writeHistoryRowRaw(type, entry, rawSourceRow, manager);
}

// TypeORM removes the row before `afterRemove` fires, so a post-delete reselect
// is impossible; `beforeRemove` captures the full raw row (including relation FK
// columns that may not be loaded on the in-memory entity) while it still exists.
const pendingRemoveSnapshots = new WeakMap<object, Record<string, unknown> | undefined>();

/**
 * TypeORM subscriber that writes a history row after every insert,
 * update, remove, soft-remove, and recover on a `@Historized()` entity.
 * Register it once per `DataSource`:
 *
 * ```ts
 * new DataSource({ subscribers: [HistorySubscriber], ... })
 * ```
 */
@EventSubscriber()
export class HistorySubscriber implements EntitySubscriberInterface {
  async beforeRemove(event: RemoveEvent<any>): Promise<void> {
    const entry = entryFor(event.metadata);
    if (!entry || !event.entity) return;
    const pkCol = event.metadata.primaryColumns[0];
    const pkVal = pkCol.getEntityValue(event.entity);
    if (pkVal === undefined) return;
    const raw = await reselectRaw(event.metadata, pkVal, event.manager);
    pendingRemoveSnapshots.set(event.entity, raw);
  }

  async afterInsert(event: InsertEvent<any>): Promise<void> {
    await recordHistoryRow('create', event.metadata, event.entity, event.manager, true);
  }

  async afterUpdate(event: UpdateEvent<any>): Promise<void> {
    const snapshot = { ...(event.databaseEntity ?? {}), ...stripUndefined(event.entity ?? {}) };
    await recordHistoryRow('update', event.metadata, snapshot, event.manager, true);
  }

  async afterRemove(event: RemoveEvent<any>): Promise<void> {
    const entity = event.databaseEntity ?? event.entity;
    const raw = event.entity ? pendingRemoveSnapshots.get(event.entity) : undefined;
    if (event.entity) pendingRemoveSnapshots.delete(event.entity);
    await recordHistoryRow('delete', event.metadata, entity, event.manager, false, raw);
  }

  async afterSoftRemove(event: SoftRemoveEvent<any>): Promise<void> {
    if (!trackSoft(event.metadata)) return;
    await recordHistoryRow('delete', event.metadata, event.entity ?? event.databaseEntity, event.manager, true);
  }

  async afterRecover(event: RecoverEvent<any>): Promise<void> {
    if (!trackSoft(event.metadata)) return;
    await recordHistoryRow('update', event.metadata, event.entity ?? event.databaseEntity, event.manager, true);
  }
}

function trackSoft(metadata: EntityMetadata): boolean {
  return getHistorizedEntry(metadata.target as Function)?.options.trackSoftDelete === true;
}

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}
