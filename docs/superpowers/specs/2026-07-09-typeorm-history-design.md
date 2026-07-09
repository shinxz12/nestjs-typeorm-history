# typeorm-entity-history — Design

**Date:** 2026-07-09
**Status:** Approved design, pre-implementation

## Goal

An npm package family that brings [django-simple-history](https://github.com/django-commons/django-simple-history)-style entity history to TypeORM and NestJS: every insert/update/delete on a tracked entity writes a full snapshot row to a per-entity shadow table, with user attribution, change reasons, time-travel queries, diffing, and revert. A future MikroORM adapter should be possible without rearchitecting.

## Packages

pnpm workspace monorepo, two packages in v1:

| Package | npm name | Contents |
|---|---|---|
| Core | `typeorm-entity-history` | Decorator, metadata registry, subscriber, ALS context, history repository, bulk helpers. Usable standalone without NestJS. |
| Nest wrapper | `nestjs-typeorm-history` | `HistoryModule.forRoot()`, global context interceptor, DI tokens. Depends on core. |

A future `mikroorm-history` package joins the same workspace. No empty "core abstractions" package in v1 (YAGNI); ORM-agnostic interfaces are extracted when the second ORM adapter actually appears.

## Storage model: shadow table per entity

Each `@Historized()` entity gets a generated companion table `<table>_history` containing:

- A copy of every column of the source entity (constraints stripped: no unique, no FK constraints; relation columns keep their plain id column, e.g. `author_id`).
- Meta columns:
  - `history_id` — autoincrement primary key of the history table
  - `history_type` — `'+'` (insert), `'~'` (update), `'-'` (delete)
  - `history_date` — timestamp (timestamptz on Postgres)
  - `history_user_id` — nullable, plain column (string by default, configurable type), **no FK**
  - `history_change_reason` — nullable text
- Composite index on `(<source entity pk>, history_date)` to make `asOf()` and per-entity listing fast.

The original entity's PK loses its PK/generated status in the history table (it becomes a plain indexed column), since one entity has many history rows.

## Entity declaration DX

```typescript
@Entity()
@Historized({
  exclude: ['passwordHash'],   // columns omitted from the history table entirely
  tableName: 'user_history',   // default: <sourceTable>_history
  trackSoftDelete: true,       // record afterSoftRemove as '-' and recover as '~'
})
export class User { ... }
```

- `@Historized()` registers the entity class in a package-level registry.
- `historyEntities()` is called by the user when building the `DataSource`; it reads TypeORM metadata for each registered entity, generates the history entity class at runtime, and returns the list:

```typescript
export const dataSource = new DataSource({
  entities: [User, Post, ...historyEntities()],
  subscribers: [HistorySubscriber],
});
```

- Because history entities live in the DataSource like normal entities, `typeorm migration:generate` produces migrations for them with no extra tooling, including when the source entity's schema changes.

## Write path

`HistorySubscriber` (a standard TypeORM `EntitySubscriberInterface`) listens to `afterInsert`, `afterUpdate`, `afterRemove`, and `afterSoftRemove` for registered entities.

1. Event fires for a historized entity.
2. Subscriber reads the ambient context (userId, changeReason) from `AsyncLocalStorage`. Missing context is fine: `history_user_id` and `history_change_reason` are `null`; the row is still written. Never throws for missing context.
3. Snapshot is built from `event.entity` merged over `event.databaseEntity` (covers partial `save()` calls where only some columns are present on `event.entity`).
4. The history row is inserted **via `event.manager`**, i.e. inside the same transaction as the triggering write. If the surrounding transaction rolls back, the history row rolls back with it. If the history insert fails, the whole transaction fails — history is never silently lost (documented trade-off).

### Bulk operations

TypeORM subscribers do not fire for query-builder / `repository.update()` / `repository.delete()` bulk operations. v1 ships opt-in helpers (mirroring django-simple-history's `bulk_update_with_history`):

```typescript
await bulkUpdateWithHistory(repo, criteria, partialEntity);
await bulkDeleteWithHistory(repo, criteria);
```

Each helper runs the bulk statement and inserts the corresponding history rows in one transaction (it selects affected rows to snapshot them). Plain query-builder writes bypass history; documented prominently.

## Context: user attribution and change reasons

Core provides an `AsyncLocalStorage`-based context:

```typescript
await withHistoryContext({ userId: 'system', changeReason: 'nightly sync' }, async () => {
  await repo.save(entity);
});
```

The Nest wrapper installs a global interceptor that populates this context per request:

```typescript
HistoryModule.forRoot({
  userResolver: (ctx: ExecutionContext) => ctx.switchToHttp().getRequest().user?.id,
})
```

Design choices:

- `history_user_id` is a plain column, not an FK: no schema coupling to any particular user entity, deleting users never breaks history, works across databases. Consumers who want joins can add their own view or query.
- Non-HTTP execution (cron jobs, queue consumers, scripts) uses `withHistoryContext` explicitly.

## Query API

Obtained per entity, standalone or via Nest DI:

```typescript
const history = historyRepo(dataSource, User);                    // core
@InjectHistoryRepository(User) history: HistoryRepository<User>;  // Nest
```

- `history.forEntity(pk).all()` — all history rows for one entity, newest first.
- `history.forEntity(pk).asOf(date)` — reconstructed `User` instance as it existed at `date`. Semantics: latest history row with `history_date <= date`; if that row is `'-'`, the entity did not exist at `date` (returns `null`).
- `history.asOf(date)` — table-wide snapshot at `date` (django `as_of()` queryset equivalent).
- `record.diffAgainst(older)` — `{ changes: [{ field, old, new }] }` between two history rows of the same entity.
- `history.forEntity(pk).revertTo(historyId)` — writes the old snapshot back to the source table and records a new history row with change reason `'reverted'`: `'~'` when the entity currently exists, `'+'` when it was deleted and the revert re-inserts it.

### Relations

- **ManyToOne / owning OneToOne** — automatic. The FK id column is part of the snapshot; relation changes appear as normal column changes.
- **OneToMany / inverse OneToOne** — no column on this side; track by putting `@Historized()` on the child entity.
- **asOf with relations (v1, one level deep):**

  ```typescript
  await history.forEntity(userId).asOf(date, { relations: ['posts'] });
  ```

  Each requested relation is reconstructed from the related entity's own history table at the same `date`. Requires the related entity to be `@Historized()`; throws a clear config error otherwise. Nested relations (`posts.comments`) are out of scope for v1.
- **ManyToMany** — not natively tracked in v1. Documented pattern: model the junction as an explicit join entity (two ManyToOne FKs) and mark it `@Historized()`. Native M2M tracking is a v2 candidate.

## Error handling

- Config errors fail loudly at startup, never silently at runtime:
  - `@Historized` entity missing from the DataSource
  - `historyEntities()` never called / `HistorySubscriber` not registered (detected on first tracked write via a registry check, with a fix-it message)
  - `asOf(..., { relations })` targeting a non-historized relation
- Missing user context is not an error (null attribution).
- Subscriber insert failure propagates and aborts the surrounding transaction.

## Testing

TDD throughout. Vitest.

- **Full suite on in-memory SQLite** (better-sqlite3): fast, CI-friendly, no services.
- **Postgres via Testcontainers** for integration: column type mapping (timestamptz, jsonb-free schema), index generation, transaction semantics.
- Key scenarios: `+`/`~`/`-` recording; partial-save snapshots; soft delete; asOf (including deleted-at-date and relations reconstruction); diff; revert; bulk helpers; rollback leaves no history; excluded columns absent from history table; Nest interceptor attribution; `migration:generate` output for create + schema change.

## Out of scope for v1

- Native ManyToMany tracking (v2)
- Nested relation reconstruction in `asOf`
- DB-trigger capture mode
- Admin UI
- MikroORM adapter (future package; core/Nest split keeps the door open)
- Single-JSON-table storage mode
- History table cleanup/dedup commands (django's `clean_duplicate_history` equivalent — later)

## v1 milestones (implementation order)

1. Core: registry + `@Historized` + runtime history entity generation + `historyEntities()`
2. Core: `HistorySubscriber` write path + context (`withHistoryContext`)
3. Core: query API (`all`, `asOf`, `diffAgainst`, `revertTo`)
4. Core: bulk helpers
5. Core: `asOf` relations (one level)
6. Nest wrapper: module, interceptor, DI tokens
7. Docs + examples (standalone TypeORM app + Nest app), Postgres integration suite
