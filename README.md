# typeorm-entity-history

[![CI](https://github.com/shinxz12/nestjs-typeorm-history/actions/workflows/ci.yml/badge.svg)](https://github.com/shinxz12/nestjs-typeorm-history/actions/workflows/ci.yml)
[![npm (core)](https://img.shields.io/npm/v/typeorm-entity-history?label=typeorm-entity-history)](https://www.npmjs.com/package/typeorm-entity-history)
[![npm (nestjs)](https://img.shields.io/npm/v/nestjs-typeorm-history?label=nestjs-typeorm-history)](https://www.npmjs.com/package/nestjs-typeorm-history)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

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

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Releases are automated with Changesets ([PUBLISHING.md](PUBLISHING.md)). Security issues: see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
