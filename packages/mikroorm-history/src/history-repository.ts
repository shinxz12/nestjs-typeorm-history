import type { EntityManager } from '@mikro-orm/core';
import { raw, ReferenceKind } from '@mikro-orm/core';
import {
  ERR,
  getHistoryContext,
  HistoryRecord,
  META,
  requireHistorized,
  withHistoryContext,
} from '@entity-history/core';
import { MikroEntry, shadowNameOf } from './entry';
import { HistorySubscriber } from './history-subscriber';
import { validateEntry } from './runtime-meta';

export type EntityClass<T> = new (...args: any[]) => T;

/** Options for {@link EntityHistoryQuery.asOf}. */
export interface AsOfOptions {
  relations?: string[];
}

/** Options for {@link EntityHistoryQuery.all}. */
export interface AllOptions {
  /** Max records to return (newest first). Default: unlimited. */
  take?: number;
  /** Records to skip from the newest end. Default: 0. */
  skip?: number;
}

/**
 * Entry point for querying one entity type's history. Construct via
 * {@link historyRepo}, not directly. Pass a contextual/forked EntityManager.
 */
export class HistoryRepository<T extends object> {
  readonly entry: MikroEntry;
  readonly sourceMeta: any;
  /** Tracked db column names, materialized once (handed to every {@link HistoryRecord}). */
  readonly tracked: string[];
  readonly shadowName: string;

  constructor(
    readonly em: EntityManager,
    readonly target: EntityClass<T>,
  ) {
    this.entry = requireHistorized(target, { needSchema: true }) as MikroEntry;
    // v7 keys the discovered store by `ClassName-hash`, so `.has(name)` is
    // always false for a bare class name; resolve via the className index.
    const ms = this.em.getMetadata() as any;
    const registered = ms.getByClassName?.(target.name) ?? ms.find?.(target.name);
    if (!registered) throw new Error(`${ERR} ${target.name} is not part of this ORM's entities.`);
    const subscribers = (this.em.config.get('subscribers') as unknown[]) ?? [];
    if (!subscribers.some((s) => s instanceof HistorySubscriber))
      throw new Error(
        `${ERR} HistorySubscriber is not registered. Fix: MikroORM.init({ ..., subscribers: [new HistorySubscriber()] })`,
      );
    validateEntry(em, this.entry);
    this.sourceMeta = this.em.getMetadata().get(target.name);
    this.tracked = [...this.entry.trackedDbNames!];
    this.shadowName = shadowNameOf(this.entry);
  }

  toRecord(raw: Record<string, any>): HistoryRecord<T> {
    return new HistoryRecord<T>(raw, this.tracked);
  }

  /** Raw history row -> plain data keyed by property name. FK columns become getReference stubs. */
  rowToData(raw: Record<string, any>): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    for (const prop of Object.values(this.sourceMeta.properties) as any[]) {
      const dbName = prop.fieldNames?.[0];
      if (!dbName || !this.entry.trackedDbNames!.has(dbName)) continue;
      const value = raw[dbName];
      if (prop.kind !== ReferenceKind.SCALAR) {
        data[prop.name] = value == null ? null : this.em.getReference(prop.type, value);
      } else {
        data[prop.name] = value;
      }
    }
    return data;
  }

  /**
   * Raw history row -> detached source entity instance. Never goes through
   * `em.create`: with an existing pk that merges into the identity map and
   * silently mutates the managed entity instead of returning a snapshot.
   */
  toEntity(raw: Record<string, any>): T {
    const entity = Object.create(this.target.prototype) as T;
    Object.assign(entity as object, this.rowToData(raw));
    return entity;
  }

  forEntity(pk: unknown): EntityHistoryQuery<T> {
    return new EntityHistoryQuery(this, pk);
  }

  /**
   * Table-wide snapshot at `date`. `extraWhere` filters the winning
   * (latest-per-entity) rows, never the candidate set — otherwise an
   * entity whose filtered column changed before `date` would be
   * reconstructed from a stale row.
   */
  async asOf(date: Date, extraWhere: Record<string, unknown> = {}): Promise<T[]> {
    const pkDb = this.entry.pkDbName!;
    const winners = await (this.em as any)
      .createQueryBuilder(this.shadowName, 'l')
      .select(raw(`max(l.${META.id}) as winner_id`))
      .where({ [META.date]: { $lte: date } })
      .groupBy(`l.${pkDb}`)
      .execute('all', false);
    const winnerIds = winners.map((w: any) => w.winner_id);
    if (winnerIds.length === 0) return [];
    const rows = await (this.em as any)
      .createQueryBuilder(this.shadowName, 'h')
      .select('*')
      .where({
        [META.id]: { $in: winnerIds },
        [META.type]: { $ne: 'delete' },
        ...extraWhere,
      })
      .execute('all', false);
    return rows.map((r: Record<string, any>) => this.toEntity(r));
  }
}

/** History operations scoped to one entity instance (by primary key). Obtained via {@link HistoryRepository.forEntity}. */
export class EntityHistoryQuery<T extends object> {
  constructor(
    private readonly repo: HistoryRepository<T>,
    private readonly pk: unknown,
  ) {}

  private qb() {
    return (this.repo.em as any).createQueryBuilder(this.repo.shadowName, 'h');
  }

  async all(opts: AllOptions = {}): Promise<HistoryRecord<T>[]> {
    let qb = this.qb()
      .select('*')
      .where({ [this.repo.entry.pkDbName!]: this.pk })
      .orderBy({ [META.id]: 'desc' });
    if (opts.take != null) qb = qb.limit(opts.take);
    if (opts.skip != null) qb = qb.offset(opts.skip);
    const rows = await qb.execute('all', false);
    return rows.map((r: Record<string, any>) => this.repo.toRecord(r));
  }

  async asOf(date: Date, opts: AsOfOptions = {}): Promise<T | null> {
    const rows = await this.qb()
      .select('*')
      .where({ [this.repo.entry.pkDbName!]: this.pk, [META.date]: { $lte: date } })
      .orderBy({ [META.id]: 'desc' })
      .limit(1)
      .execute('all', false);
    if (rows.length === 0 || rows[0][META.type] === 'delete') return null;
    const entity = this.repo.toEntity(rows[0]);
    for (const name of opts.relations ?? []) {
      await this.attachRelationAsOf(entity, rows[0], name, date);
    }
    return entity;
  }

  private async attachRelationAsOf(
    entity: T,
    raw: Record<string, any>,
    name: string,
    date: Date,
  ): Promise<void> {
    if (name.includes('.')) throw new Error(`${ERR} nested relations are not supported in v1: '${name}'.`);
    const prop = this.repo.sourceMeta.properties[name];
    if (!prop || prop.kind === ReferenceKind.SCALAR)
      throw new Error(`${ERR} unknown relation '${name}' on ${this.repo.target.name}.`);
    const relatedTarget = this.repo.em.getMetadata().get(prop.type).class as EntityClass<any>;
    let relatedRepo: HistoryRepository<any>;
    try {
      relatedRepo = new HistoryRepository(this.repo.em, relatedTarget);
    } catch {
      throw new Error(
        `${ERR} relation '${name}' targets ${prop.type}, which is not @Historized. ` +
          `Add @Historized() to it to reconstruct this relation.`,
      );
    }
    if (prop.kind === ReferenceKind.MANY_TO_ONE || (prop.kind === ReferenceKind.ONE_TO_ONE && !prop.mappedBy)) {
      const fk = raw[prop.fieldNames[0]];
      (entity as any)[name] = fk == null ? null : await relatedRepo.forEntity(fk).asOf(date);
    } else if (prop.kind === ReferenceKind.ONE_TO_MANY) {
      const childMeta = this.repo.em.getMetadata().get(prop.type);
      const childFkDb = childMeta.properties[prop.mappedBy].fieldNames[0];
      (entity as any)[name] = await relatedRepo.asOf(date, { [childFkDb]: this.pk });
    } else if (prop.kind === ReferenceKind.ONE_TO_ONE && prop.mappedBy) {
      const ownerMeta = this.repo.em.getMetadata().get(prop.type);
      const ownerFkDb = ownerMeta.properties[prop.mappedBy].fieldNames[0];
      const matches = await relatedRepo.asOf(date, { [ownerFkDb]: this.pk });
      (entity as any)[name] = matches[0] ?? null;
    } else {
      throw new Error(`${ERR} relation kind of '${name}' is not supported by asOf in v1 (many-to-many: see docs).`);
    }
  }

  async revertTo(historyId: number): Promise<T> {
    const rows = await this.qb().select('*').where({ [META.id]: historyId }).execute('all', false);
    if (rows.length === 0) throw new Error(`${ERR} history row ${historyId} not found.`);
    const row = rows[0];
    // String-compare: drivers return bigint/numeric pks as strings, and callers
    // often pass route params as strings for numeric columns.
    if (String(row[this.repo.entry.pkDbName!]) !== String(this.pk))
      throw new Error(`${ERR} history row ${historyId} belongs to a different entity.`);

    const em = this.repo.em;
    const data = this.repo.rowToData(row);
    const existing = await em.findOne(this.repo.target, this.pk as any, { filters: false });
    let entity: T;
    if (existing) {
      em.assign(existing, data as any);
      entity = existing;
    } else {
      entity = em.create(this.repo.target, data as any);
      em.persist(entity);
    }
    const ctx = getHistoryContext() ?? {};
    await withHistoryContext({ ...ctx, changeReason: 'reverted' }, () => em.flush());
    return entity;
  }
}

/** Creates a {@link HistoryRepository} for `target` on `em`. */
export function historyRepo<T extends object>(em: EntityManager, target: EntityClass<T>): HistoryRepository<T> {
  return new HistoryRepository(em, target);
}
