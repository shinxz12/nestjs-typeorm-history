# @entity-history/nestjs-typeorm

> Renamed from `nestjs-typeorm-history` (deprecated on npm).

NestJS integration for [@entity-history/typeorm](../typeorm-history): automatic user attribution per request, and DI-friendly history repositories.

## Install

```bash
npm install @entity-history/nestjs-typeorm @entity-history/typeorm
```

Peer dependencies: `@nestjs/common`, `@nestjs/core`, `@nestjs/typeorm` (>= 10), `rxjs` (>= 7), `typeorm` (>= 0.3.20), and `@entity-history/typeorm` itself — it is a peer (not a regular dependency) so your app and this package always share the single copy whose registry and context the subscriber reads.

## Usage

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

  async historyFor(userId: number) {
    return this.userHistory.forEntity(userId).all();
  }
}
```

`HistoryModule.forRoot()` installs a global interceptor that runs `userResolver` on every request and makes the resolved id available to `@entity-history/typeorm`'s write path automatically — no extra code needed at the call site.

### Multiple data sources

`forFeature` accepts the same data-source reference as `@nestjs/typeorm` (name, options object, or instance):

```typescript
HistoryModule.forFeature([Metric], 'analytics');
// ...
constructor(@InjectHistoryRepository(Metric, 'analytics') private readonly metricHistory: HistoryRepository<Metric>) {}
```

### Outside HTTP requests

Cron jobs, queue consumers, and scripts aren't covered by the interceptor. Use `withHistoryContext` from `@entity-history/typeorm` directly:

```typescript
import { withHistoryContext } from '@entity-history/typeorm';

await withHistoryContext({ userId: 'system', changeReason: 'nightly sync' }, async () => {
  await userRepo.save(user);
});
```
