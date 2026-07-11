# @entity-history/mikroorm

Entity history for MikroORM (v7): every create/update/delete on a tracked entity writes a full snapshot to a per-entity shadow table (`<table>_history`), with user attribution, change reasons, time-travel queries, diffing, and revert.

## Install

```bash
npm install @entity-history/mikroorm
```

Requires `@mikro-orm/core >= 7 < 8` as a peer dependency.

## Quickstart

```typescript
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { MikroORM } from '@mikro-orm/postgresql';
import { Historized, historyEntities, HistorySubscriber } from '@entity-history/mikroorm';

@Entity()
@Historized()
export class User {
  @PrimaryKey() id!: number;
  @Property() email!: string;
}

const orm = await MikroORM.init({
  entities: [User, ...historyEntities()],
  subscribers: [new HistorySubscriber()],
});
```

`historyEntities()` reads MikroORM decorator metadata for every `@Historized()` entity and generates a matching `user_history` `EntitySchema` (same columns, plus `history_id`, `history_type` (`'create' | 'update' | 'delete'`), `history_date`, `history_user_id`, `history_change_reason`). Because the generated schema lives in the ORM config like any other entity, the schema generator and migrations cover it automatically.

The meta columns are identical to [`@entity-history/typeorm`](../typeorm-history)'s — shadow tables are cross-ORM compatible, so switching ORMs keeps existing history.

### `@Historized` options

```typescript
@Historized({
  exclude: ['passwordHash'],    // properties omitted from the history table entirely
  tableName: 'user_history',    // default: <sourceTable>_history
  softDeleteField: 'deletedAt', // see Soft delete below
})
```

## Soft delete

MikroORM has no native soft delete. If your entity models it with a nullable date/flag property, name it in `softDeleteField`: an update that sets the field (null → value) is recorded as `'delete'`, an update that clears it (value → null) as `'update'` — the same mapping the TypeORM adapter uses for `softRemove()`/`recover()`. Without the option, only hard creates/updates/deletes are tracked.

## Context: user attribution and change reasons

```typescript
import { withHistoryContext } from '@entity-history/mikroorm';

await withHistoryContext({ userId: 'system', changeReason: 'nightly sync' }, async () => {
  await em.flush();
});
```

Missing context is not an error — `history_user_id` and `history_change_reason` are simply `null`. The NestJS wrapper (`@entity-history/nestjs-mikroorm`) sets this automatically per-request; for cron jobs, queue consumers, or scripts, call `withHistoryContext` explicitly.

## Query API

```typescript
import { historyRepo } from '@entity-history/mikroorm';

const history = historyRepo(em, User); // pass a contextual/forked EntityManager

await history.forEntity(userId).all();                       // every version, newest first
await history.forEntity(userId).all({ take: 20, skip: 0 });  // paginated
await history.forEntity(userId).asOf(date);                  // reconstructed User at `date`, or null
await history.asOf(date);                                    // table-wide snapshot at `date`
record.diffAgainst(olderRecord);                             // { changes: [{ field, old, new }] }
await history.forEntity(userId).revertTo(historyId);         // restore + record a new row, reason 'reverted'
```

Entities returned by `asOf`/`toEntity` are **detached** snapshots — they are never merged into the identity map, so reading history cannot mutate managed entities.

### Relations

- **ManyToOne / owning OneToOne** — automatic. The FK id column is part of the snapshot.
- **OneToMany / inverse OneToOne** — put `@Historized()` on the child entity; reconstruct via `asOf(date, { relations: ['posts'] })`.
- **ManyToMany** — not natively tracked. Model the junction as an explicit join entity and historize that instead.

Nested relation paths (`posts.comments`) are not supported in v1.

## Bulk helpers

`em.nativeUpdate()`, `em.nativeDelete()`, and query-builder writes bypass MikroORM's event system, so they do **not** produce history. Use these instead:

```typescript
import {
  bulkUpdateWithHistory,
  bulkDeleteWithHistory,
  bulkSoftDeleteWithHistory,
  bulkRestoreWithHistory,
} from '@entity-history/mikroorm';

await bulkUpdateWithHistory(em, Post, { status: 'draft' }, { status: 'archived' });
await bulkDeleteWithHistory(em, Post, { status: 'spam' });
await bulkSoftDeleteWithHistory(em, Post, { status: 'stale' }); // sets softDeleteField, records 'delete'
await bulkRestoreWithHistory(em, Post, { status: 'stale' });    // clears softDeleteField, records 'update'
```

Each runs in a single transaction and writes all history rows in one batched insert.

## Limitations (v1)

- MikroORM v7 only (`peerDependencies: @mikro-orm/core >=7 <8`).
- Single-column primary keys only (no composite keys).
- Default MikroORM naming strategy (or explicit `fieldName`s). A custom `namingStrategy` makes the runtime validator throw a configuration error rather than silently miswriting history.
- `em.nativeUpdate` / `nativeDelete` / `em.upsert` / query-builder writes bypass history — use the bulk helpers above where one exists.
- `asOf` relation reconstruction is one level deep; many-to-many needs an explicit join entity.
- A history-row insert failure aborts the whole flush transaction, including the original write — history is never silently dropped.
- Distributed as CommonJS only: `@Historized()` registers into a process-wide singleton shared with `@entity-history/core`; a dual CJS+ESM build would silently split that registry.
