# typeorm-entity-history

Entity history for TypeORM and NestJS: every insert/update/delete on a tracked entity writes a full snapshot to a per-entity shadow table, with user attribution, change reasons, time-travel queries, diffing, and revert.

| Package | Description |
|---|---|
| [`typeorm-entity-history`](packages/typeorm-history) | Core: decorator, subscriber, query API. Usable standalone without NestJS. |
| [`nestjs-typeorm-history`](packages/nestjs-typeorm-history) | NestJS module: request-scoped user attribution, DI-friendly history repositories. |

See each package's README for install and usage.

## Development

```bash
pnpm install
pnpm test               # both packages, in-memory sqlite
pnpm -F typeorm-entity-history test:pg   # postgres integration suite (requires Docker)
pnpm build               # build both packages
```
