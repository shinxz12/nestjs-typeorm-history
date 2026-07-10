import { ERR } from './errors';

/** Options for {@link Historized}. */
export interface HistorizedOptions {
  /** Property names omitted from the history table entirely. */
  exclude?: string[];
  /** Default: `${sourceTable}_history`. */
  tableName?: string;
  /** TypeORM adapter: record soft remove as 'delete' and recover as 'update'. */
  trackSoftDelete?: boolean;
  /** MikroORM adapter: property that marks soft deletion (e.g. 'deletedAt'). An update setting it records 'delete'; clearing it records 'update'. */
  softDeleteField?: string;
}

/** Internal bookkeeping for a `@Historized()` entity, populated incrementally by the adapter's `historyEntities()` and write path. */
export interface RegistryEntry<TSchema = unknown> {
  target: Function;
  options: HistorizedOptions;
  schema?: TSchema;
  trackedDbNames?: Set<string>;
  pkDbName?: string;
}

// Must be a true process-wide singleton: @Historized() writes here at import
// time, the adapters read it later from other call sites. Shipping both a
// CJS and an ESM build (each with its own module-level state) silently
// splits this into two registries when a consumer's dependency graph
// crosses the require/import boundary - hence CJS-only output.
const registry = new Map<Function, RegistryEntry>();

export function registerHistorized(target: Function, options: HistorizedOptions): void {
  registry.set(target, { target, options });
}

/** Looks up the {@link RegistryEntry} for a `@Historized()` class, or `undefined` if it isn't decorated. */
export function getHistorizedEntry(target: Function): RegistryEntry | undefined {
  return registry.get(target);
}

/**
 * Like {@link getHistorizedEntry}, but throws with a fix-it message when the
 * class isn't decorated — and, with `needSchema`, when the adapter's
 * `historyEntities()` wasn't included in the ORM's entity list.
 */
export function requireHistorized(target: Function, opts: { needSchema?: boolean } = {}): RegistryEntry {
  const entry = registry.get(target);
  if (!entry) throw new Error(`${ERR} ${target.name} is not @Historized.`);
  if (opts.needSchema && !entry.schema)
    throw new Error(
      `${ERR} ${target.name} is @Historized but historyEntities() was not included in the ORM's entities. ` +
        `Fix: entities: [..., ...historyEntities()] and register the adapter's HistorySubscriber.`,
    );
  return entry;
}

/** All currently registered `@Historized()` entries, in decoration order. */
export function listHistorized(): RegistryEntry[] {
  return [...registry.values()];
}

/** Clears the registry. Test-only — never call this in application code. */
export function clearHistorizedRegistry(): void {
  registry.clear();
}
