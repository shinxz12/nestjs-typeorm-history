# entity-history

[![CI](https://github.com/shinxz12/entity-history/actions/workflows/ci.yml/badge.svg)](https://github.com/shinxz12/entity-history/actions/workflows/ci.yml)
[![npm (typeorm)](https://img.shields.io/npm/v/@entity-history/typeorm?label=%40entity-history%2Ftypeorm)](https://www.npmjs.com/package/@entity-history/typeorm)
[![npm (nestjs)](https://img.shields.io/npm/v/@entity-history/nestjs-typeorm?label=%40entity-history%2Fnestjs-typeorm)](https://www.npmjs.com/package/@entity-history/nestjs-typeorm)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Entity history for TypeORM and NestJS: every insert/update/delete on a tracked entity writes a full snapshot to a per-entity shadow table (`<table>_history`), with user attribution, change reasons, time-travel queries, diffing, and revert.

> Renamed from `typeorm-entity-history` / `nestjs-typeorm-history` — the old npm names are deprecated and point here.

| Package | Description |
|---|---|
| [`@entity-history/core`](packages/core) | ORM-agnostic core: `@Historized` registry, history context, diffing. |
| [`@entity-history/typeorm`](packages/typeorm-history) | TypeORM adapter: decorator, subscriber, query API. Usable standalone without NestJS. |
| [`@entity-history/nestjs-typeorm`](packages/nestjs-typeorm-history) | NestJS module: request-scoped user attribution, DI-friendly history repositories. |
| `@entity-history/mikroorm` | MikroORM adapter — coming soon. |

## Features

- **One decorator** — `@Historized()` on an entity generates a matching `_history` table (same columns + `history_id`, `history_type`, `history_date`, `history_user_id`, `history_change_reason`). Migrations come free via `typeorm migration:generate`.
- **Who and why** — user attribution and change reasons per write, automatic per-request in NestJS.
- **Time travel** — reconstruct any entity (or the whole table) as it was at a point in time, including one level of relations.
- **Diff & revert** — compare any two versions field-by-field; restore an entity to a previous version (even a deleted one).
- **Bulk-safe** — transactional helpers for bulk update/delete/soft-delete/restore, since TypeORM subscribers can't see those.
- **Tested on** SQLite and Postgres (Testcontainers) in CI.

## Quick start (TypeORM, no NestJS)

```bash
npm install @entity-history/typeorm   # peer: typeorm >= 0.3.20
```

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

Every `save`/`remove` on `User` now also writes a row to `user_history`. Attribute writes to a user with `withHistoryContext`:

```typescript
import { withHistoryContext } from '@entity-history/typeorm';

await withHistoryContext({ userId: 'admin-7', changeReason: 'GDPR request' }, async () => {
  await dataSource.getRepository(User).save(user);
});
```

### Query the history

```typescript
import { historyRepo } from '@entity-history/typeorm';

const history = historyRepo(dataSource, User);

await history.forEntity(userId).all();               // every version, newest first
await history.forEntity(userId).asOf(date);           // the User as it was at `date`, or null
await history.asOf(date);                             // table-wide snapshot at `date`
record.diffAgainst(olderRecord);                      // { changes: [{ field, old, new }] }
await history.forEntity(userId).revertTo(historyId);  // restore a previous version
```

## Quick start (NestJS)

```bash
npm install @entity-history/nestjs-typeorm @entity-history/typeorm
```

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { historyEntities, HistorySubscriber } from '@entity-history/typeorm';
import { HistoryModule } from '@entity-history/nestjs-typeorm';
import { User } from './user.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      // ...
      entities: [User, ...historyEntities()],
      subscribers: [HistorySubscriber],
    }),
    HistoryModule.forRoot({
      // runs on every request; the resolved id lands in history_user_id automatically
      userResolver: (ctx) => ctx.switchToHttp().getRequest().user?.id ?? null,
    }),
    HistoryModule.forFeature([User]),
  ],
})
export class AppModule {}
```

```typescript
import { Injectable } from '@nestjs/common';
import { InjectHistoryRepository } from '@entity-history/nestjs-typeorm';
import { HistoryRepository } from '@entity-history/typeorm';
import { User } from './user.entity';

@Injectable()
export class UserService {
  constructor(@InjectHistoryRepository(User) private readonly userHistory: HistoryRepository<User>) {}

  historyFor(userId: number) {
    return this.userHistory.forEntity(userId).all();
  }
}
```

## Going further

- [`@entity-history/typeorm` README](packages/typeorm-history/README.md) — `@Historized` options (exclude columns, soft-delete tracking), relations (one-to-many, many-to-many via join entity), bulk helpers, migrations, v1 limitations.
- [`@entity-history/nestjs-typeorm` README](packages/nestjs-typeorm-history/README.md) — multiple data sources, usage outside HTTP requests (cron, queues).
- [API reference](https://shinxz12.github.io/entity-history/) — generated TypeDoc for both packages.

## Development

```bash
pnpm install
pnpm test               # both packages, in-memory sqlite
pnpm -F @entity-history/typeorm test:pg   # postgres integration suite (requires Docker)
pnpm build               # build both packages
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Releases are automated with Changesets ([PUBLISHING.md](PUBLISHING.md)). Security issues: see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
