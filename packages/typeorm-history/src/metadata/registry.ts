import type { EntitySchema } from 'typeorm';
import {
  getHistorizedEntry as coreGet,
  listHistorized as coreList,
  requireHistorized as coreRequire,
  RegistryEntry as CoreRegistryEntry,
} from '@entity-history/core';

export { registerHistorized, clearHistorizedRegistry } from '@entity-history/core';
export type { HistorizedOptions } from '@entity-history/core';

/** Core registry entry with the schema slot narrowed to TypeORM's EntitySchema. */
export type RegistryEntry = CoreRegistryEntry<EntitySchema>;

export function getHistorizedEntry(target: Function): RegistryEntry | undefined {
  return coreGet(target) as RegistryEntry | undefined;
}

export function requireHistorized(target: Function, opts: { needSchema?: boolean } = {}): RegistryEntry {
  return coreRequire(target, opts) as RegistryEntry;
}

export function listHistorized(): RegistryEntry[] {
  return coreList() as RegistryEntry[];
}
