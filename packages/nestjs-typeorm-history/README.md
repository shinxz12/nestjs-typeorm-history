# nestjs-typeorm-history

NestJS integration for [typeorm-entity-history](../typeorm-history): automatic user attribution per request, and DI-friendly history repositories.

## Install

```bash
npm install nestjs-typeorm-history typeorm-entity-history
```

Peer dependencies: `@nestjs/common`, `@nestjs/core`, `@nestjs/typeorm` (>= 10), `rxjs` (>= 7), `typeorm` (>= 0.3.20), and `typeorm-entity-history` itself — it is a peer (not a regular dependency) so your app and this package always share the single copy whose registry and context the subscriber reads.

## Usage

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

  async historyFor(userId: number) {
    return this.userHistory.forEntity(userId).all();
  }
}
```

`HistoryModule.forRoot()` installs a global interceptor that runs `userResolver` on every request and makes the resolved id available to `typeorm-entity-history`'s write path automatically — no extra code needed at the call site.

### Multiple data sources

`forFeature` accepts the same data-source reference as `@nestjs/typeorm` (name, options object, or instance):

```typescript
HistoryModule.forFeature([Metric], 'analytics');
// ...
constructor(@InjectHistoryRepository(Metric, 'analytics') private readonly metricHistory: HistoryRepository<Metric>) {}
```

### Outside HTTP requests

Cron jobs, queue consumers, and scripts aren't covered by the interceptor. Use `withHistoryContext` from `typeorm-entity-history` directly:

```typescript
import { withHistoryContext } from 'typeorm-entity-history';

await withHistoryContext({ userId: 'system', changeReason: 'nightly sync' }, async () => {
  await userRepo.save(user);
});
```
