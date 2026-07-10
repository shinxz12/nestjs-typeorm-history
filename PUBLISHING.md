# Publishing

Versioning and npm publishing are automated by [Changesets](https://github.com/changesets/changesets) via `.github/workflows/release.yml`. This file is the one-time GitHub setup checklist — do this once, after the repo has a real GitHub remote.

## One-time setup

1. **NPM_TOKEN secret.** On npmjs.com: Access Tokens → Generate New Token → **Automation** type (bypasses 2FA prompts in CI). In the GitHub repo: Settings → Secrets and variables → Actions → New repository secret, name `NPM_TOKEN`.
2. **Branch protection.** Settings → Branches → add a rule for `main` requiring the `test` and `test-postgres` checks (from `ci.yml`) to pass before merging.
3. **GitHub Pages source.** Settings → Pages → Build and deployment → Source: **GitHub Actions** (not "Deploy from a branch" — `docs.yml` uses the modern Actions-based deploy, no `gh-pages` branch involved).
4. **Fix placeholder URLs.** `packages/*/package.json`'s `repository`/`homepage`/`bugs` fields and this file's examples below use `<github-org>/nestjs-typeorm-history` as a placeholder — replace with the real org/repo name.

## Day-to-day release flow

1. Make a change to either package.
2. `pnpm changeset` — pick the affected package(s), bump type, write a one-line summary. Commit the generated `.changeset/*.md` file with your change.
3. Open a PR as normal; `ci.yml` runs.
4. Once merged to `main`, `release.yml` runs `changesets/action`:
   - If there are unreleased changesets, it opens/updates a **"Version Packages"** PR that bumps versions and updates `CHANGELOG.md` files.
   - Merging that PR triggers `release.yml` again; this time it runs `pnpm -r publish`, publishing any package whose version isn't yet on npm.

No manual `npm version` or `npm publish` — ever.
