# typeorm-entity-history

[![CI](https://github.com/shinxz12/nestjs-typeorm-history/actions/workflows/ci.yml/badge.svg)](https://github.com/shinxz12/nestjs-typeorm-history/actions/workflows/ci.yml)
[![npm (core)](https://img.shields.io/npm/v/typeorm-entity-history?label=typeorm-entity-history)](https://www.npmjs.com/package/typeorm-entity-history)
[![npm (nestjs)](https://img.shields.io/npm/v/nestjs-typeorm-history?label=nestjs-typeorm-history)](https://www.npmjs.com/package/nestjs-typeorm-history)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Entity history for TypeORM and NestJS: every insert/update/delete on a tracked entity writes a full snapshot to a per-entity shadow table (`<table>_history`), with user attribution, change reasons, time-travel queries, diffing, and revert.

| Package | Description |
|---|---|
| [`typeorm-entity-history`](packages/typeorm-history) | Core: decorator, subscriber, query API. Usable standalone without NestJS. |
| [`nestjs-typeorm-history`](packages/nestjs-typeorm-history) | NestJS module: request-scoped user attribution, DI-friendly history repositories. |

## Features

- **One decorator** — `@Historized()` on an entity generates a matching `_history` table (same columns + `history_id`, `history_type`, `history_date`, `history_user_id`, `history_change_reason`). Migrations come free via `typeorm migration:generate`.
- **Who and why** — user attribution and change reasons per write, automatic per-request in NestJS.
- **Time travel** — reconstruct any entity (or the whole table) as it was at a point in time, including one level of relations.
- **Diff & revert** — compare any two versions field-by-field; restore an entity to a previous version (even a deleted one).
- **Bulk-safe** — transactional helpers for bulk update/delete/soft-delete/restore, since TypeORM subscribers can't see those.
- **Tested on** SQLite and Postgres (Testcontainers) in CI.

## Quick start (TypeORM, no NestJS)

```bash
npm install typeorm-entity-history   # peer: typeorm >= 0.3.20
```

```typescript
import { Column, DataSource, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { Historized, historyEntities, HistorySubscriber } from 'typeorm-entity-history';

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
import { withHistoryContext } from 'typeorm-entity-history';

await withHistoryContext({ userId: 'admin-7', changeReason: 'GDPR request' }, async () => {
  await dataSource.getRepository(User).save(user);
});
```

### Query the history

```typescript
import { historyRepo } from 'typeorm-entity-history';

const history = historyRepo(dataSource, User);

await history.forEntity(userId).all();               // every version, newest first
await history.forEntity(userId).asOf(date);           // the User as it was at `date`, or null
await history.asOf(date);                             // table-wide snapshot at `date`
record.diffAgainst(olderRecord);                      // { changes: [{ field, old, new }] }
await history.forEntity(userId).revertTo(historyId);  // restore a previous version
```

## Quick start (NestJS)

```bash
npm install nestjs-typeorm-history typeorm-entity-history
```

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { historyEntities, HistorySubscriber } from 'typeorm-entity-history';
import { HistoryModule } from 'nestjs-typeorm-history';
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
import { InjectHistoryRepository } from 'nestjs-typeorm-history';
import { HistoryRepository } from 'typeorm-entity-history';
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

- [`typeorm-entity-history` README](packages/typeorm-history/README.md) — `@Historized` options (exclude columns, soft-delete tracking), relations (one-to-many, many-to-many via join entity), bulk helpers, migrations, v1 limitations.
- [`nestjs-typeorm-history` README](packages/nestjs-typeorm-history/README.md) — multiple data sources, usage outside HTTP requests (cron, queues).
- [API reference](https://shinxz12.github.io/nestjs-typeorm-history/) — generated TypeDoc for both packages.

## Development

```bash
pnpm install
pnpm test               # both packages, in-memory sqlite
pnpm -F typeorm-entity-history test:pg   # postgres integration suite (requires Docker)
pnpm build               # build both packages
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Releases are automated with Changesets ([PUBLISHING.md](PUBLISHING.md)). Security issues: see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
