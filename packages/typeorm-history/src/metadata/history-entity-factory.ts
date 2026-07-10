import 'reflect-metadata';
import {
  ColumnType,
  DefaultNamingStrategy,
  EntitySchema,
  EntitySchemaColumnOptions,
  getMetadataArgsStorage,
} from 'typeorm';
import { ColumnMetadataArgs } from 'typeorm/metadata-args/ColumnMetadataArgs';
import { ERR } from '../errors';
import { META } from './meta-columns';
import { listHistorized, RegistryEntry } from './registry';

/** Options for {@link historyEntities}. */
export interface HistoryEntitiesOptions {
  /** e.g. 'timestamptz' on Postgres. Default: Date (driver default). */
  dateColumnType?: ColumnType;
  /** Default: String. */
  userIdColumnType?: ColumnType;
}

function inheritanceChain(target: Function): Function[] {
  const chain: Function[] = [];
  let t: Function | null = target;
  while (t && t !== Function.prototype && t.name) {
    chain.push(t);
    t = Object.getPrototypeOf(t);
  }
  return chain;
}

// We compute source table and FK column names ourselves from metadata-args
// before the DataSource (and its naming strategy) exists, so use TypeORM's
// own DefaultNamingStrategy — the exact code that names the real columns.
// A custom `namingStrategy` on the DataSource is a known v1 limitation.
const naming = new DefaultNamingStrategy();

function designType(target: Function, prop: string): ColumnType | undefined {
  return Reflect.getMetadata('design:type', target.prototype, prop) as ColumnType | undefined;
}

function findPrimaryColumn(target: Function): ColumnMetadataArgs {
  const chain = inheritanceChain(target);
  const primaries = getMetadataArgsStorage().columns.filter(
    (c) => chain.includes(c.target as Function) && c.options.primary,
  );
  if (primaries.length === 0) throw new Error(`${ERR} ${target.name} has no primary column.`);
  if (primaries.length > 1)
    throw new Error(`${ERR} ${target.name}: composite primary keys are not supported in v1.`);
  return primaries[0];
}

function buildSchemaFor(entry: RegistryEntry, opts: HistoryEntitiesOptions): EntitySchema {
  const storage = getMetadataArgsStorage();
  const target = entry.target;
  const chain = inheritanceChain(target);
  const exclude = new Set(entry.options.exclude ?? []);

  const tableArgs = storage.tables.find((t) => t.target === target);
  const sourceTable = naming.tableName(target.name, tableArgs?.name);

  const columns: Record<string, EntitySchemaColumnOptions> = {};
  const tracked = new Set<string>();

  // regular columns (incl. create/update/delete-date columns, copied as plain columns)
  for (const col of storage.columns.filter((c) => chain.includes(c.target as Function))) {
    if (exclude.has(col.propertyName)) continue;
    const dbName = col.options.name ?? col.propertyName;
    let resolvedType: unknown = col.options.type ?? designType(col.target as Function, col.propertyName) ?? String;
    if (resolvedType === Object) {
      // design:type reflects unions (e.g. `Date | null`) as Object; fall back by column mode.
      if (col.mode === 'createDate' || col.mode === 'updateDate' || col.mode === 'deleteDate') resolvedType = Date;
      else if (col.mode === 'version') resolvedType = Number;
      else resolvedType = String;
    }
    const type = resolvedType as ColumnType;
    columns[dbName] = {
      name: dbName,
      type,
      // History rows are point-in-time snapshots, not live data: never enforce the
      // source table's NOT NULL (constraints are stripped, per design).
      nullable: !col.options.primary,
      length: col.options.length,
      precision: col.options.precision ?? undefined,
      scale: col.options.scale,
      enum: col.options.enum,
      array: col.options.array,
    };
    tracked.add(dbName);
    if (col.options.primary) {
      entry.pkDbName = dbName;
    }
  }

  findPrimaryColumn(target); // asserts exactly one pk exists

  // FK columns of owning relations (many-to-one, one-to-one with JoinColumn)
  const fkDbNames: string[] = [];
  for (const rel of storage.relations.filter((r) => chain.includes(r.target as Function))) {
    if (exclude.has(rel.propertyName)) continue;
    const joinCol = storage.joinColumns.find(
      (j) => chain.includes(j.target as Function) && j.propertyName === rel.propertyName,
    );
    const owning = rel.relationType === 'many-to-one' || (rel.relationType === 'one-to-one' && !!joinCol);
    if (!owning) continue;
    if (typeof rel.type !== 'function')
      throw new Error(`${ERR} ${target.name}.${rel.propertyName}: string relation targets are not supported in v1.`);
    const related = (rel.type as () => Function)();
    const refPk = findPrimaryColumn(related);
    const refType = (refPk.options.type ??
      designType(refPk.target as Function, refPk.propertyName) ??
      Number) as ColumnType;
    const dbName = joinCol?.name ?? naming.joinColumnName(rel.propertyName, refPk.propertyName);
    columns[dbName] = { name: dbName, type: refType, nullable: true };
    tracked.add(dbName);
    fkDbNames.push(dbName);
  }

  if (!entry.pkDbName)
    throw new Error(`${ERR} ${target.name}: primary column not found (a primary column cannot be excluded).`);

  for (const metaName of Object.values(META)) {
    if (columns[metaName])
      throw new Error(
        `${ERR} ${target.name}: column '${metaName}' collides with a history metadata column. ` +
          `Rename it or add it to @Historized({ exclude: [...] }).`,
      );
  }

  columns[META.id] = { name: META.id, type: Number, primary: true, generated: 'increment' };
  columns[META.type] = { name: META.type, type: String, length: 6 };
  columns[META.date] = { name: META.date, type: opts.dateColumnType ?? Date };
  columns[META.user] = { name: META.user, type: opts.userIdColumnType ?? String, nullable: true };
  columns[META.reason] = { name: META.reason, type: String, nullable: true };

  entry.trackedDbNames = tracked;

  // Schema name = history table name: table names are unique per database,
  // while bare class names can collide across modules (blog/Category vs
  // shop/Category would both produce a 'CategoryHistory' schema).
  const tableName = entry.options.tableName ?? `${sourceTable}_history`;
  return new EntitySchema({
    name: tableName,
    tableName,
    columns,
    indices: [
      { columns: [entry.pkDbName, META.date] },
      // One-to-many / inverse one-to-one reconstruction filters and groups
      // on the child's FK column — give each one its own index.
      ...fkDbNames.map((fk) => ({ columns: [fk] })),
    ],
  });
}

/**
 * Generates one `EntitySchema` per `@Historized()` entity, matching its
 * source columns plus the `history_*` metadata columns. Call once, after
 * all entity modules are imported and before constructing the
 * `DataSource`, and include the result in `entities`:
 *
 * ```ts
 * new DataSource({ entities: [User, ...historyEntities()], subscribers: [HistorySubscriber] })
 * ```
 */
export function historyEntities(opts: HistoryEntitiesOptions = {}): EntitySchema[] {
  return listHistorized().map((entry) => {
    const schema = buildSchemaFor(entry, opts);
    entry.schema = schema;
    return schema;
  });
}
