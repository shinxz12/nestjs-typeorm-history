# Publishing

Versioning and npm publishing are automated by [Changesets](https://github.com/changesets/changesets) via `.github/workflows/release.yml`. This file documents the one-time GitHub setup (already done for github.com/shinxz12/entity-history) and the day-to-day release flow.

## One-time setup (done 2026-07-10)

1. **NPM_TOKEN secret.** On npmjs.com: Access Tokens → Generate New Token → **Automation** type (bypasses 2FA prompts in CI). In the GitHub repo: Settings → Secrets and variables → Actions → New repository secret, name `NPM_TOKEN`. The token must have publish access to the `@entity-history` scope (packages live in the `entity-history` org).
2. **Branch protection.** A ruleset on `main` requires a PR with the `test` and `test-postgres` checks (from `ci.yml`) passing before merge.
3. **GitHub Pages source.** Settings → Pages → Build and deployment → Source: **GitHub Actions** (not "Deploy from a branch" — `docs.yml` uses the modern Actions-based deploy, no `gh-pages` branch involved).

## Day-to-day release flow

1. Make a change to either package.
2. `pnpm changeset` — pick the affected package(s), bump type, write a one-line summary. Commit the generated `.changeset/*.md` file with your change.
3. Open a PR as normal; `ci.yml` runs.
4. Once merged to `main`, `release.yml` runs `changesets/action`:
   - If there are unreleased changesets, it opens/updates a **"Version Packages"** PR that bumps versions and updates `CHANGELOG.md` files.
   - Merging that PR triggers `release.yml` again; this time it runs `pnpm -r publish`, publishing any package whose version isn't yet on npm.

No manual `npm version` or `npm publish` — ever.
