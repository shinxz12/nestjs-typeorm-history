import 'reflect-metadata';
import { EntitySchema, MetadataStorage, ReferenceKind, UnderscoreNamingStrategy } from '@mikro-orm/core';
import { ERR, META, listHistorized, RegistryEntry } from '@entity-history/core';

/** Options for {@link historyEntities}. */
export interface HistoryEntitiesOptions {
  /** e.g. 'timestamptz' on Postgres. Default: driver datetime. */
  dateColumnType?: string;
  /** Default: varchar. */
  userIdColumnType?: string;
}

// We compute column names before MikroORM.init() (and its naming strategy)
// exists, so use MikroORM's own default strategy — the exact code that names
// the real columns. A custom namingStrategy is a known v1 limitation; the
// runtime validator (runtime-meta.ts) turns a mismatch into a loud error.
const naming = new UnderscoreNamingStrategy();

const OWNING = new Set<string>([ReferenceKind.MANY_TO_ONE, ReferenceKind.ONE_TO_ONE]);

/** Pre-init decorator metadata for a class (v7: global store keyed `ClassName-hash`). */
function decoratorMetaOf(target: Function): any {
  const store = MetadataStorage.getMetadata() as Record<string, any>;
  return Object.values(store).find((m: any) => m.class === target);
}

/** Pre-init, `prop.type` is unresolved: fall back to design:type reflection. */
function scalarType(target: Function, prop: any): string {
  if (typeof prop.type === 'string') return prop.type;
  const design = Reflect.getMetadata('design:type', target.prototype, prop.name);
  if (design === Number) return 'number';
  if (design === Boolean) return 'boolean';
  if (design === Date) return 'Date';
  // Unions (e.g. `Date | null`) reflect as Object; primary keys default sensibly.
  if (design === Object && prop.name.toLowerCase().includes('at')) return 'Date';
  return 'string';
}

/** Referenced pk type of an owning relation, for the FK shadow column. */
function fkType(prop: any): string {
  try {
    const related = typeof prop.entity === 'function' ? prop.entity() : undefined;
    if (related) {
      const relatedMeta = decoratorMetaOf(related);
      const pk = Object.values(relatedMeta?.properties ?? {}).find((p: any) => p.primary) as any;
      if (pk) return scalarType(related, pk);
    }
  } catch {
    // fall through to default
  }
  return 'number';
}

function buildSchemaFor(entry: RegistryEntry, opts: HistoryEntitiesOptions): EntitySchema {
  const target = entry.target;
  const meta = decoratorMetaOf(target);
  if (!meta)
    throw new Error(`${ERR} ${target.name} has no MikroORM entity metadata — is it decorated with @Entity()?`);
  const exclude = new Set(entry.options.exclude ?? []);
  const sourceTable = meta.tableName ?? naming.classToTableName(meta.className ?? target.name);

  const properties: Record<string, any> = {};
  const tracked = new Set<string>();
  const fkDbNames: string[] = [];
  let pkDbName: string | undefined;
  let pkCount = 0;

  for (const prop of Object.values(meta.properties) as any[]) {
    if (exclude.has(prop.name)) continue;
    const kind = prop.kind ?? ReferenceKind.SCALAR;

    if (kind === ReferenceKind.SCALAR) {
      // Pre-init an explicit `fieldName` option sits on prop.fieldName; the
      // fieldNames array is only populated during discovery.
      const dbName = prop.fieldNames?.[0] ?? prop.fieldName ?? naming.propertyToColumnName(prop.name);
      // History rows are point-in-time snapshots: never enforce the source
      // table's NOT NULL (constraints are stripped, per design).
      properties[dbName] = {
        type: scalarType(target, prop),
        fieldName: dbName,
        nullable: !prop.primary,
      };
      tracked.add(dbName);
      if (prop.primary) {
        pkCount += 1;
        pkDbName = dbName;
      }
    } else if (OWNING.has(kind) && !prop.mappedBy) {
      // FK column of an owning relation (many-to-one, one-to-one owner).
      const dbName = prop.fieldNames?.[0] ?? prop.fieldName ?? naming.joinColumnName(prop.name);
      properties[dbName] = { type: fkType(prop), fieldName: dbName, nullable: true };
      tracked.add(dbName);
      fkDbNames.push(dbName);
    }
    // 1:m, m:n, inverse 1:1: no column on this table — skipped, like the TypeORM adapter.
  }

  if (pkCount === 0) throw new Error(`${ERR} ${target.name} has no primary column.`);
  if (pkCount > 1) throw new Error(`${ERR} ${target.name}: composite primary keys are not supported in v1.`);

  for (const metaName of Object.values(META)) {
    if (properties[metaName])
      throw new Error(
        `${ERR} ${target.name}: column '${metaName}' collides with a history metadata column. ` +
          `Rename it or add it to @Historized({ exclude: [...] }).`,
      );
  }

  properties[META.id] = { type: 'number', primary: true, autoincrement: true, fieldName: META.id };
  properties[META.type] = { type: 'string', length: 6, fieldName: META.type };
  properties[META.date] = {
    type: 'Date',
    fieldName: META.date,
    ...(opts.dateColumnType ? { columnType: opts.dateColumnType } : {}),
  };
  properties[META.user] = {
    type: 'string',
    fieldName: META.user,
    nullable: true,
    ...(opts.userIdColumnType ? { columnType: opts.userIdColumnType } : {}),
  };
  properties[META.reason] = { type: 'string', fieldName: META.reason, nullable: true };

  entry.pkDbName = pkDbName;
  entry.trackedDbNames = tracked;

  // Schema name = history table name: table names are unique per database,
  // while bare class names can collide across modules.
  const tableName = entry.options.tableName ?? `${sourceTable}_history`;
  return new EntitySchema({
    name: tableName,
    tableName,
    properties,
    indexes: [
      { properties: [pkDbName!, META.date] },
      // One-to-many / inverse one-to-one reconstruction filters and groups
      // on the child's FK column — give each one its own index.
      ...fkDbNames.map((fk) => ({ properties: [fk] })),
    ],
  } as any);
}

/**
 * Generates one `EntitySchema` per `@Historized()` entity, matching its
 * source columns plus the `history_*` metadata columns. Call once, after
 * all entity modules are imported and before `MikroORM.init()`:
 *
 * ```ts
 * MikroORM.init({ entities: [User, ...historyEntities()], subscribers: [new HistorySubscriber()] })
 * ```
 */
export function historyEntities(opts: HistoryEntitiesOptions = {}): EntitySchema[] {
  return listHistorized().map((entry) => {
    const schema = buildSchemaFor(entry, opts);
    entry.schema = schema;
    return schema;
  });
}
