# @entity-history/core

ORM-agnostic core shared by the `@entity-history` adapters. You normally don't install this directly — it comes in as a dependency of an adapter:

| Package | Use with |
| --- | --- |
| [`@entity-history/typeorm`](https://www.npmjs.com/package/@entity-history/typeorm) | TypeORM |
| [`@entity-history/nestjs-typeorm`](https://www.npmjs.com/package/@entity-history/nestjs-typeorm) | NestJS + TypeORM |
| [`@entity-history/mikroorm`](https://www.npmjs.com/package/@entity-history/mikroorm) | MikroORM |
| [`@entity-history/nestjs-mikroorm`](https://www.npmjs.com/package/@entity-history/nestjs-mikroorm) | NestJS + MikroORM |

## What lives here

- **`@Historized()` decorator + registry** — marks an entity for history tracking and records its options in a process-wide registry that adapters read to generate shadow history tables (`registerHistorized`, `getHistorizedEntry`, `requireHistorized`, `listHistorized`).
- **History context** — `AsyncLocalStorage`-based user attribution and change reasons (`withHistoryContext`, `getHistoryContext`, `setChangeReason`), so every history row can carry `history_user_id` and `history_change_reason`.
- **`HistoryRecord`** — base class for history rows, including `diffAgainst()` field-level diffing.
- **`META` column definitions** — the shared meta columns every history table gets: `history_id`, `history_type` (`'create' | 'update' | 'delete'`), `history_date`, `history_user_id`, `history_change_reason`.

All exports are re-exported by the adapters, so application code imports from the adapter package (e.g. `import { Historized, withHistoryContext } from '@entity-history/typeorm'`) and never needs a direct dependency on this package.

## Docs

Full documentation: https://shinxz12.github.io/entity-history/
