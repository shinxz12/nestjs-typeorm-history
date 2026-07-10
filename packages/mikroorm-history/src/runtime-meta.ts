import type { EntityManager } from '@mikro-orm/core';
import { ERR, META } from '@entity-history/core';
import { MikroEntry } from './entry';

const validated = new WeakSet<object>();
const metaCols = new Set<string>(Object.values(META));

/**
 * Compares the factory's predicted column names against the discovered
 * source metadata; a mismatch means a custom naming strategy (or schema
 * drift) — fail loudly instead of writing history rows that miss columns.
 */
export function validateEntry(em: EntityManager, entry: MikroEntry): void {
  if (validated.has(entry)) return;
  const sourceMeta = em.getMetadata().get(entry.target.name);
  const actual = new Set<string>();
  for (const prop of Object.values(sourceMeta.properties) as any[]) {
    for (const f of prop.fieldNames ?? []) actual.add(f);
  }
  for (const dbName of entry.trackedDbNames!) {
    if (metaCols.has(dbName)) continue;
    if (!actual.has(dbName))
      throw new Error(
        `${ERR} history column '${dbName}' has no matching column on '${sourceMeta.tableName}'. ` +
          `Custom naming strategies are not supported in v1.`,
      );
  }
  validated.add(entry);
}
