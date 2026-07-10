# Contributing

Thanks for your interest in contributing! This repo is a pnpm monorepo with two packages:

- `packages/typeorm-history` → [`typeorm-entity-history`](https://www.npmjs.com/package/typeorm-entity-history) (core, framework-agnostic)
- `packages/nestjs-typeorm-history` → [`nestjs-typeorm-history`](https://www.npmjs.com/package/nestjs-typeorm-history) (NestJS wrapper)

## Development setup

Requirements: Node.js >= 18, [pnpm](https://pnpm.io), and Docker (only for the Postgres integration suite).

```bash
pnpm install
pnpm build                                # build both packages (core first)
pnpm test                                 # both packages, in-memory sqlite — fast, no Docker
pnpm -F typeorm-entity-history test:pg    # postgres integration suite (Testcontainers, needs Docker)
```

The NestJS package depends on the core package via `workspace:*`, so build the core package before building or testing the wrapper.

## Making changes

1. Fork and create a branch from `main`.
2. Write tests for your change. New features and bug fixes should come with test coverage; the sqlite suite is the default home for most tests.
3. Make sure `pnpm build` and `pnpm test` pass.
4. **Add a changeset** if your change affects a published package:

   ```bash
   pnpm changeset
   ```

   Pick the affected package(s), choose the bump type (patch/minor/major), and write a one-line summary — it becomes the CHANGELOG entry. Commit the generated `.changeset/*.md` file with your change. Docs-only or CI-only changes don't need one.

5. Open a pull request against `main`. CI runs the sqlite suite and the Postgres integration suite; both must pass.

## Releases

Releases are fully automated via [Changesets](https://github.com/changesets/changesets) — see [PUBLISHING.md](PUBLISHING.md). Maintainers merge the auto-generated "Version Packages" PR to publish; contributors never run `npm publish`.

## Reporting bugs and requesting features

Use the [issue templates](https://github.com/shinxz12/entity-history/issues/new/choose). For security issues, see [SECURITY.md](SECURITY.md) — please don't open a public issue.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Be kind.
