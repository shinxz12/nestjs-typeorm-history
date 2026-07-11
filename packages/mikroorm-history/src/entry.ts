import type { EntitySchema } from '@mikro-orm/core';
import { getHistorizedEntry, RegistryEntry, requireHistorized } from '@entity-history/core';

/** Core registry entry with the schema slot narrowed to MikroORM's EntitySchema. */
export type MikroEntry = RegistryEntry<EntitySchema>;

export function entryFor(target: Function): MikroEntry | undefined {
  if (!getHistorizedEntry(target)) return undefined;
  return requireHistorized(target, { needSchema: true }) as MikroEntry;
}

export function requireEntry(target: Function): MikroEntry {
  return requireHistorized(target, { needSchema: true }) as MikroEntry;
}

/** The shadow entity's registered name (== its table name). */
export function shadowNameOf(entry: MikroEntry): string {
  return (entry.schema as any).meta?.className ?? (entry.schema as any).name;
}
