# @entity-history/nestjs-mikroorm

NestJS integration for [@entity-history/mikroorm](../mikroorm-history): automatic user attribution per request, and DI-friendly history repositories.

## Install

```bash
npm install @entity-history/nestjs-mikroorm @entity-history/mikroorm
```

Peer dependencies: `@nestjs/common`, `@nestjs/core` (>= 10), `@mikro-orm/core`, `@mikro-orm/nestjs` (>= 7), `rxjs` (>= 7), and `@entity-history/mikroorm` itself — it is a peer (not a regular dependency) so your app and this package always share the single copy whose registry and context the subscriber reads.

## Setup

```typescript
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { historyEntities, HistorySubscriber } from '@entity-history/mikroorm';
import { HistoryModule } from '@entity-history/nestjs-mikroorm';

@Module({
  imports: [
    MikroOrmModule.forRoot({
      // ...driver config
      entities: [User, ...historyEntities()],
      subscribers: [new HistorySubscriber()],
    }),
    HistoryModule.forRoot({
      userResolver: (ctx) => ctx.switchToHttp().getRequest().user?.id ?? null,
    }),
    HistoryModule.forFeature([User]),
  ],
})
export class AppModule {}
```

`HistoryModule.forRoot()` installs a global interceptor that runs `userResolver` per request and attributes every history row written during that request to the resolved user. `forFeature([Entity], contextName?)` provides an injectable `HistoryRepository` per entity; pass a `contextName` for non-default MikroORM instances.

## Usage

```typescript
import { InjectHistoryRepository } from '@entity-history/nestjs-mikroorm';
import { HistoryRepository } from '@entity-history/mikroorm';

@Injectable()
export class UsersService {
  constructor(@InjectHistoryRepository(User) private readonly history: HistoryRepository<User>) {}

  findHistory(id: number) {
    return this.history.forEntity(id).all();
  }
}
```

## Outside HTTP requests

Cron jobs, queue consumers, and scripts aren't covered by the interceptor. Use the context API directly:

```typescript
import { withHistoryContext } from '@entity-history/mikroorm';

await withHistoryContext({ userId: 'system', changeReason: 'nightly sync' }, () => em.flush());
```
