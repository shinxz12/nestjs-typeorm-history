import { DataSource, EntityMetadata, LessThanOrEqual, ObjectLiteral, Repository } from 'typeorm';
import { ApplyValueTransformers } from 'typeorm/util/ApplyValueTransformers';
import { getHistoryContext, withHistoryContext } from '../context/history-context';
import { ERR } from '../errors';
import { META } from '../metadata/meta-columns';
import { RegistryEntry, requireHistorized } from '../metadata/registry';
import { HistorySubscriber } from '../subscriber/history-subscriber';
import { HistoryRecord } from './history-record';

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
 * {@link historyRepo}, not directly — the constructor validates that the
 * entity is `@Historized()`, its history schema was generated, and
 * {@link HistorySubscriber} is registered on the `DataSource`.
 */
export class HistoryRepository<T extends ObjectLiteral> {
  readonly entry: RegistryEntry;
  readonly sourceMeta: EntityMetadata;
  /** Tracked db column names, materialized once (handed to every {@link HistoryRecord}). */
  readonly tracked: string[];

  constructor(
    readonly ds: DataSource,
    readonly target: EntityClass<T>,
  ) {
    const entry = requireHistorized(target, { needSchema: true });
    if (!ds.hasMetadata(target))
      throw new Error(`${ERR} ${target.name} is not part of this DataSource's entities.`);
    if (!ds.subscribers.some((s) => s instanceof HistorySubscriber))
      throw new Error(
        `${ERR} HistorySubscriber is not registered. Fix: new DataSource({ ..., subscribers: [HistorySubscriber] })`,
      );
    this.entry = entry;
    this.sourceMeta = ds.getMetadata(target);
    this.tracked = [...entry.trackedDbNames!];
  }

  get histRepo(): Repository<ObjectLiteral> {
    return this.ds.getRepository(this.entry.schema!);
  }

  toRecord(raw: Record<string, any>): HistoryRecord<T> {
    return new HistoryRecord<T>(raw, this.tracked);
  }

  /** Raw history row -> source entity instance. FK columns become relation stubs { pk: value }. */
  toEntity(raw: Record<string, any>): T {
    const data: Record<string, unknown> = {};
    for (const col of this.sourceMeta.columns) {
      if (!this.entry.trackedDbNames!.has(col.databaseName)) continue;
      const value = raw[col.databaseName];
      if (col.relationMetadata && col.referencedColumn) {
        data[col.relationMetadata.propertyName] =
          value == null ? null : { [col.referencedColumn.propertyName]: value };
      } else {
        // History rows store the database representation; convert back to
        // the domain value the way TypeORM does when hydrating the source.
        data[col.propertyName] = col.transformer
          ? ApplyValueTransformers.transformFrom(col.transformer, value)
          : value;
      }
    }
    return this.ds.manager.create(this.target, data as any);
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
    const qb = this.histRepo.createQueryBuilder('h');
    qb.where((outer) => {
      const latest = outer
        .subQuery()
        .select(`MAX(latest.${META.id})`)
        .from(this.entry.schema!, 'latest')
        .where(`latest.${META.date} <= :date`, { date })
        .groupBy(`latest.${pkDb}`)
        .getQuery();
      return `h.${META.id} IN ${latest}`;
    });
    qb.andWhere(`h.${META.type} != :hDeleted`, { hDeleted: 'delete' });
    for (const [k, v] of Object.entries(extraWhere)) {
      qb.andWhere(`h.${k} = :w_${k}`, { [`w_${k}`]: v });
    }
    const rows = await qb.getMany();
    return rows.map((r) => this.toEntity(r));
  }
}

/** History operations scoped to one entity instance (by primary key). Obtained via {@link HistoryRepository.forEntity}. */
export class EntityHistoryQuery<T extends ObjectLiteral> {
  constructor(
    private readonly repo: HistoryRepository<T>,
    private readonly pk: unknown,
  ) {}

  async all(opts: AllOptions = {}): Promise<HistoryRecord<T>[]> {
    const rows = await this.repo.histRepo.find({
      where: { [this.repo.entry.pkDbName!]: this.pk } as any,
      order: { [META.id]: 'DESC' } as any,
      take: opts.take,
      skip: opts.skip,
    });
    return rows.map((r) => this.repo.toRecord(r));
  }

  async asOf(date: Date, opts: AsOfOptions = {}): Promise<T | null> {
    const rows = await this.repo.histRepo.find({
      where: {
        [this.repo.entry.pkDbName!]: this.pk,
        [META.date]: LessThanOrEqual(date),
      } as any,
      order: { [META.id]: 'DESC' } as any,
      take: 1,
    });
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
    const rel = this.repo.sourceMeta.relations.find((r) => r.propertyName === name);
    if (!rel) throw new Error(`${ERR} unknown relation '${name}' on ${this.repo.target.name}.`);
    const relatedTarget = rel.inverseEntityMetadata.target as new () => any;
    let relatedRepo: HistoryRepository<any>;
    try {
      relatedRepo = new HistoryRepository(this.repo.ds, relatedTarget);
    } catch {
      throw new Error(
        `${ERR} relation '${name}' targets ${rel.inverseEntityMetadata.name}, which is not @Historized. ` +
          `Add @Historized() to it to reconstruct this relation.`,
      );
    }
    if (rel.isManyToOne || (rel.isOneToOne && rel.isOwning)) {
      const fkDb = rel.joinColumns[0].databaseName;
      const fk = raw[fkDb];
      (entity as any)[name] = fk == null ? null : await relatedRepo.forEntity(fk).asOf(date);
    } else if (rel.isOneToMany) {
      const childFkDb = rel.inverseRelation!.joinColumns[0].databaseName;
      (entity as any)[name] = await relatedRepo.asOf(date, { [childFkDb]: this.pk });
    } else if (rel.isOneToOne && !rel.isOwning) {
      const ownerFkDb = rel.inverseRelation!.joinColumns[0].databaseName;
      const matches = await relatedRepo.asOf(date, { [ownerFkDb]: this.pk });
      (entity as any)[name] = matches[0] ?? null;
    } else {
      throw new Error(`${ERR} relation kind of '${name}' is not supported by asOf in v1 (many-to-many: see docs).`);
    }
  }

  async revertTo(historyId: number): Promise<T> {
    const row = await this.repo.histRepo.findOneBy({ [META.id]: historyId } as any);
    if (!row) throw new Error(`${ERR} history row ${historyId} not found.`);
    // String-compare: drivers return bigint/numeric pks as strings, and callers
    // often pass route params as strings for numeric columns.
    if (String(row[this.repo.entry.pkDbName!]) !== String(this.pk))
      throw new Error(`${ERR} history row ${historyId} belongs to a different entity.`);
    const entity = this.repo.toEntity(row);
    const ctx = getHistoryContext() ?? {};
    return withHistoryContext({ ...ctx, changeReason: 'reverted' }, () =>
      this.repo.ds.manager.save(this.repo.target, entity),
    );
  }
}

/** Creates a {@link HistoryRepository} for `target` on `ds`. */
export function historyRepo<T extends ObjectLiteral>(ds: DataSource, target: EntityClass<T>): HistoryRepository<T> {
  return new HistoryRepository(ds, target);
}
