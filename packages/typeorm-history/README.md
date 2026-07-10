# @entity-history/typeorm

> Renamed from `typeorm-entity-history` (deprecated on npm).

Entity history for TypeORM: every insert/update/delete on a tracked entity writes a full snapshot to a per-entity shadow table (`<table>_history`), with user attribution, change reasons, time-travel queries, diffing, and revert.

## Install

```bash
npm install @entity-history/typeorm
```

Requires `typeorm >= 0.3.20` as a peer dependency.

## Quickstart

```typescript
import { Column, DataSource, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { Historized, historyEntities, HistorySubscriber } from '@entity-history/typeorm';

@Entity()
@Historized()
export class User {
  @PrimaryGeneratedColumn() id!: number;
  @Column() email!: string;
}

export const dataSource = new DataSource({
  type: 'postgres',
  entities: [User, ...historyEntities()],
  subscribers: [HistorySubscriber],
});
```

`historyEntities()` reads TypeORM metadata for every `@Historized()` entity and generates a matching `user_history` table (same columns, plus `history_id`, `history_type` (`'create' | 'update' | 'delete'`), `history_date`, `history_user_id`, `history_change_reason`). Because the generated entity lives in the `DataSource` like any other, `typeorm migration:generate` produces migrations for it automatically, including on later schema changes.

### `@Historized` options

```typescript
@Historized({
  exclude: ['passwordHash'],   // columns omitted from the history table entirely
  tableName: 'user_history',   // default: <sourceTable>_history
  trackSoftDelete: true,       // record softRemove(entity) as 'delete' and recover(entity) as 'update'
})
```

> `trackSoftDelete` covers the **entity-based** `softRemove()`/`recover()` calls. Criteria-based `repository.softDelete(id)` / `restore(id)` broadcast their subscriber events without the entity, so they cannot produce history — use `bulkSoftDeleteWithHistory` / `bulkRestoreWithHistory` (see Bulk helpers) for those.

## Context: user attribution and change reasons

```typescript
import { withHistoryContext } from '@entity-history/typeorm';

await withHistoryContext({ userId: 'system', changeReason: 'nightly sync' }, async () => {
  await repo.save(entity);
});
```

Missing context is not an error — `history_user_id` and `history_change_reason` are simply `null`. The [NestJS wrapper](../nestjs-typeorm-history) sets this automatically per-request; for cron jobs, queue consumers, or scripts, call `withHistoryContext` explicitly.

## Query API

```typescript
import { historyRepo } from '@entity-history/typeorm';

const history = historyRepo(dataSource, User);

await history.forEntity(userId).all();              // every version, newest first
await history.forEntity(userId).all({ take: 20, skip: 0 }); // paginated
await history.forEntity(userId).asOf(date);          // reconstructed User at `date`, or null
await history.asOf(date);                            // table-wide snapshot at `date`
record.diffAgainst(olderRecord);                     // { changes: [{ field, old, new }] }
await history.forEntity(userId).revertTo(historyId);  // restore + record a new 'update' (or 'create' if deleted) row, reason 'reverted'
```

### Relations

- **ManyToOne / owning OneToOne** — automatic. The FK id column is part of the snapshot.
- **OneToMany / inverse OneToOne** — put `@Historized()` on the child entity; reconstruct via `asOf(date, { relations: ['posts'] })`.

```typescript
const author = await historyRepo(ds, Author).forEntity(authorId).asOf(date, { relations: ['posts'] });
// author.posts is reconstructed from Post's own history at the same date
```

  Nested relation paths (`posts.comments`) are not supported in v1.

- **ManyToMany** — not natively tracked. Model the junction as an explicit join entity and historize that instead:

```typescript
@Entity()
@Historized()
export class UserGroup {
  @PrimaryGeneratedColumn() id!: number;
  @ManyToOne(() => User) user!: User;
  @ManyToOne(() => Group) group!: Group;
}
```

## Bulk helpers

TypeORM subscribers don't carry a resolvable row identity for query-builder bulk operations, so plain `repository.update()`, `.delete()`, `.softDelete()`, `.restore()`, `.upsert()`, and query-builder `.execute()` calls do **not** produce history. Use these instead:

```typescript
import {
  bulkUpdateWithHistory,
  bulkDeleteWithHistory,
  bulkSoftDeleteWithHistory,
  bulkRestoreWithHistory,
} from '@entity-history/typeorm';

await bulkUpdateWithHistory(repo, { status: 'draft' }, { status: 'archived' });
await bulkDeleteWithHistory(repo, { status: 'spam' });
await bulkSoftDeleteWithHistory(repo, { status: 'stale' }); // records 'delete'
await bulkRestoreWithHistory(repo, { status: 'stale' });    // records 'update'
```

Each runs in a single transaction and writes all history rows in one batched insert.

## Limitations (v1)

- Single-column primary keys only (no composite keys).
- Relation targets must be class references (`@ManyToOne(() => Author)`), not string entity names.
- Default TypeORM naming strategy is assumed.
- Plain `repository.update()` / `.delete()` / `.softDelete()` / `.restore()` / `.upsert()` / `.increment()` and query-builder `.execute()` bypass history — use the bulk helpers above where one exists.
- Columns with a value `transformer` are stored in the history table in their **database** representation (the transformer is applied on write and reversed by `asOf`/`revertTo`).
- A history-row insert failure aborts the whole transaction, including the original write — history is never silently dropped.
- `asOf` relation reconstruction is one level deep; many-to-many needs an explicit join entity (see above).
- Distributed as CommonJS only. `@Historized()` registers into a process-wide singleton read later by `historyRepo()`/`HistorySubscriber`; a dual CJS+ESM build would give each format its own copy of that state, silently splitting the registry for any consumer whose dependency graph crosses the require/import boundary (a real risk in pnpm/yarn workspaces where a package is reached both directly and transitively). Some test runners (e.g. Vitest, in certain monorepo/symlink configurations) can still load the same CJS file twice via separate SSR module graphs — if `@Historized` entities mysteriously report as "not @Historized" only under a test runner but work under plain `node`/`ts-node`, this is the cause; it is a test-harness artifact, not a runtime bug.

## Migrations

Because history entities are generated before `DataSource` initialization and included in `entities`, TypeORM's CLI sees them like any other entity:

```bash
typeorm migration:generate -d data-source.ts src/migrations/AddUserHistory
```
