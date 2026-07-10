import type { EntitySchema } from 'typeorm';
import { ERR } from '../errors';

/** Options for {@link Historized}. */
export interface HistorizedOptions {
  /** Property names omitted from the history table entirely. */
  exclude?: string[];
  /** Default: `${sourceTable}_history`. */
  tableName?: string;
  /** Record soft remove as 'delete' and recover as 'update'. */
  trackSoftDelete?: boolean;
}

/** Internal bookkeeping for a `@Historized()` entity, populated incrementally by {@link historyEntities} and the write path. */
export interface RegistryEntry {
  target: Function;
  options: HistorizedOptions;
  schema?: EntitySchema;
  trackedDbNames?: Set<string>;
  pkDbName?: string;
}

// Must be a true process-wide singleton: @Historized() writes here at import
// time, historyRepo()/HistorySubscriber read it later from other call sites.
// Shipping both a CJS and an ESM build (each with its own module-level state)
// silently splits this into two registries when a consumer's dependency graph
// crosses the require/import boundary (e.g. a CJS package requiring us while
// an ESM entrypoint also imports us) - hence CJS-only output (see package.json).
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
 * class isn't decorated — and, with `needSchema`, when {@link historyEntities}
 * wasn't included in the DataSource. Single source of truth for these checks.
 */
export function requireHistorized(target: Function, opts: { needSchema?: boolean } = {}): RegistryEntry {
  const entry = registry.get(target);
  if (!entry) throw new Error(`${ERR} ${target.name} is not @Historized.`);
  if (opts.needSchema && !entry.schema)
    throw new Error(
      `${ERR} ${target.name} is @Historized but historyEntities() was not included in the DataSource. ` +
        `Fix: new DataSource({ entities: [..., ...historyEntities()], subscribers: [HistorySubscriber] })`,
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
