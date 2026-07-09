# typeorm-entity-history v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v1 of `typeorm-entity-history` (core) and `nestjs-typeorm-history` (Nest wrapper): django-simple-history-style shadow-table history for TypeORM entities with user attribution, time-travel queries, diff, revert, and bulk helpers.

**Architecture:** pnpm monorepo with two packages. Core registers entities via `@Historized()`, generates history `EntitySchema`s at runtime from TypeORM metadata-args storage (`historyEntities()`), records snapshots via a global `EntitySubscriberInterface` inside the triggering transaction, and reads ambient user/reason from `AsyncLocalStorage`. The Nest package wraps this in a dynamic module with a global interceptor and DI tokens.

**Tech Stack:** TypeScript (strict), TypeORM >= 0.3.20 (peer), better-sqlite3 (tests), vitest + unplugin-swc (decorator metadata), tsup (build), Testcontainers Postgres (integration), NestJS 10/11 (peer of wrapper).

**Spec:** `docs/superpowers/specs/2026-07-09-typeorm-history-design.md`

## Global Constraints

- Package names exactly: `typeorm-entity-history`, `nestjs-typeorm-history`.
- Node >= 18 (AsyncLocalStorage), `"engines": { "node": ">=18" }` in both packages.
- `typeorm` is a **peerDependency** `>=0.3.20` (devDependency for tests). Never a direct dependency.
- Meta column names exactly: `history_id`, `history_type` (`'+' | '~' | '-'`), `history_date`, `history_user_id`, `history_change_reason`.
- Default history table name: `<sourceTable>_history`.
- v1 limitations enforced with loud errors: single-column primary keys only; class-reference relation targets only (no string targets); default TypeORM naming strategy assumed.
- Missing user context is never an error (`history_user_id = null`). Missing setup (no `historyEntities()`, no `HistorySubscriber`) always throws with a fix-it message.
- History rows are written with `event.manager` — same transaction as the triggering write.
- All tests run on in-memory better-sqlite3 except Task 12 (Postgres/Testcontainers).
- vitest MUST use `unplugin-swc` (esbuild does not emit `design:type` decorator metadata, TypeORM needs it).
- TDD: every behavior gets a failing test before implementation. Conventional commits.

---

### Task 1: Monorepo scaffold + core package skeleton

**Files:**
- Create: `pnpm-workspace.yaml`, `package.json` (root), `tsconfig.base.json`, `.gitignore`
- Create: `packages/typeorm-history/package.json`, `packages/typeorm-history/tsconfig.json`, `packages/typeorm-history/vitest.config.ts`, `packages/typeorm-history/src/index.ts`, `packages/typeorm-history/test/smoke.test.ts`

**Interfaces:**
- Produces: workspace layout `packages/typeorm-history` (npm name `typeorm-entity-history`); test command `pnpm -F typeorm-entity-history test`; build command `pnpm -F typeorm-entity-history build`.

- [ ] **Step 1: Root files**

`pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
```

Root `package.json`:

```json
{
  "name": "typeorm-history-workspace",
  "private": true,
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test"
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2021",
    "module": "commonjs",
    "moduleResolution": "node",
    "strict": true,
    "declaration": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

`.gitignore`:

```
node_modules/
dist/
*.tsbuildinfo
```

- [ ] **Step 2: Core package skeleton**

`packages/typeorm-history/package.json`:

```json
{
  "name": "typeorm-entity-history",
  "version": "0.1.0",
  "description": "django-simple-history-style shadow-table history for TypeORM",
  "license": "MIT",
  "main": "dist/index.js",
  "module": "dist/index.mjs",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "engines": { "node": ">=18" },
  "scripts": {
    "build": "tsup src/index.ts --dts --format cjs,esm",
    "test": "vitest run"
  },
  "peerDependencies": { "typeorm": ">=0.3.20" },
  "devDependencies": {
    "@swc/core": "^1.7.0",
    "better-sqlite3": "^11.0.0",
    "reflect-metadata": "^0.2.2",
    "tsup": "^8.0.0",
    "typeorm": "^0.3.20",
    "typescript": "^5.5.0",
    "unplugin-swc": "^1.5.0",
    "vitest": "^2.0.0"
  }
}
```

`packages/typeorm-history/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`packages/typeorm-history/vitest.config.ts` (swc is mandatory — see Global Constraints):

```typescript
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node' },
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2021',
      },
      module: { type: 'commonjs' },
    }),
  ],
});
```

`packages/typeorm-history/src/index.ts`:

```typescript
export const VERSION = '0.1.0';
```

`packages/typeorm-history/test/smoke.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/index';

describe('smoke', () => {
  it('package loads', () => {
    expect(VERSION).toBe('0.1.0');
  });
});
```

- [ ] **Step 3: Install and run**

Run: `pnpm install` then `pnpm -F typeorm-entity-history test`
Expected: 1 test passes.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: scaffold pnpm workspace and typeorm-entity-history package"
```

---

### Task 2: Registry + `@Historized` decorator

**Files:**
- Create: `packages/typeorm-history/src/metadata/registry.ts`, `packages/typeorm-history/src/decorators/historized.ts`
- Modify: `packages/typeorm-history/src/index.ts`
- Test: `packages/typeorm-history/test/registry.test.ts`

**Interfaces:**
- Produces:
  - `interface HistorizedOptions { exclude?: string[]; tableName?: string; trackSoftDelete?: boolean }`
  - `interface RegistryEntry { target: Function; options: HistorizedOptions; schema?: EntitySchema; trackedDbNames?: Set<string>; pkProp?: string; pkDbName?: string }`
  - `Historized(options?: HistorizedOptions): ClassDecorator`
  - `registerHistorized(target: Function, options: HistorizedOptions): void`
  - `getHistorizedEntry(target: Function): RegistryEntry | undefined`
  - `listHistorized(): RegistryEntry[]`
  - `clearHistorizedRegistry(): void` (test helper, exported)

- [ ] **Step 1: Write failing test**

`test/registry.test.ts`:

```typescript
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { Historized } from '../src/decorators/historized';
import { getHistorizedEntry, listHistorized } from '../src/metadata/registry';

@Entity()
@Historized({ exclude: ['secret'], trackSoftDelete: true })
class Doc {
  @PrimaryGeneratedColumn() id!: number;
  @Column() title!: string;
  @Column() secret!: string;
}

describe('registry', () => {
  it('registers decorated entity with its options', () => {
    const entry = getHistorizedEntry(Doc);
    expect(entry).toBeDefined();
    expect(entry!.options.exclude).toEqual(['secret']);
    expect(entry!.options.trackSoftDelete).toBe(true);
    expect(listHistorized().map((e) => e.target)).toContain(Doc);
  });

  it('returns undefined for unregistered class', () => {
    class Other {}
    expect(getHistorizedEntry(Other)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F typeorm-entity-history vitest run test/registry.test.ts`
Expected: FAIL — cannot resolve `../src/decorators/historized`.

- [ ] **Step 3: Implement**

`src/metadata/registry.ts`:

```typescript
import type { EntitySchema } from 'typeorm';

export interface HistorizedOptions {
  /** Property names omitted from the history table entirely. */
  exclude?: string[];
  /** Default: `${sourceTable}_history`. */
  tableName?: string;
  /** Record soft remove as '-' and recover as '~'. */
  trackSoftDelete?: boolean;
}

export interface RegistryEntry {
  target: Function;
  options: HistorizedOptions;
  schema?: EntitySchema;
  trackedDbNames?: Set<string>;
  pkProp?: string;
  pkDbName?: string;
}

const registry = new Map<Function, RegistryEntry>();

export function registerHistorized(target: Function, options: HistorizedOptions): void {
  registry.set(target, { target, options });
}

export function getHistorizedEntry(target: Function): RegistryEntry | undefined {
  return registry.get(target);
}

export function listHistorized(): RegistryEntry[] {
  return [...registry.values()];
}

export function clearHistorizedRegistry(): void {
  registry.clear();
}
```

`src/decorators/historized.ts`:

```typescript
import { HistorizedOptions, registerHistorized } from '../metadata/registry';

export function Historized(options: HistorizedOptions = {}): ClassDecorator {
  return (target) => {
    registerHistorized(target, options);
  };
}
```

`src/index.ts` — replace content:

```typescript
export { Historized } from './decorators/historized';
export {
  HistorizedOptions,
  RegistryEntry,
  getHistorizedEntry,
  listHistorized,
  clearHistorizedRegistry,
} from './metadata/registry';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F typeorm-entity-history vitest run test/registry.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): Historized decorator and registry"
```

---

### Task 3: History entity factory (`historyEntities()`)

**Files:**
- Create: `packages/typeorm-history/src/metadata/history-entity-factory.ts`, `packages/typeorm-history/src/metadata/meta-columns.ts`
- Modify: `packages/typeorm-history/src/index.ts`
- Test: `packages/typeorm-history/test/history-entity-factory.test.ts`

**Interfaces:**
- Consumes: registry from Task 2.
- Produces:
  - `const META = { id: 'history_id', type: 'history_type', date: 'history_date', user: 'history_user_id', reason: 'history_change_reason' } as const` (in `meta-columns.ts`)
  - `interface HistoryEntitiesOptions { dateColumnType?: ColumnType; userIdColumnType?: ColumnType }`
  - `historyEntities(opts?: HistoryEntitiesOptions): EntitySchema[]` — generates one `EntitySchema` per registered entity, stores `schema`, `trackedDbNames`, `pkProp`, `pkDbName` on the registry entry. History schema name is `${ClassName}History`.

- [ ] **Step 1: Write failing test**

`test/history-entity-factory.test.ts`:

```typescript
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Column, DataSource, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Historized } from '../src/decorators/historized';
import { historyEntities } from '../src/metadata/history-entity-factory';
import { getHistorizedEntry } from '../src/metadata/registry';

@Entity()
@Historized()
class Author {
  @PrimaryGeneratedColumn() id!: number;
  @Column() name!: string;
}

@Entity()
@Historized({ exclude: ['draftNotes'] })
class Post {
  @PrimaryGeneratedColumn() id!: number;
  @Column() title!: string;
  @Column({ nullable: true }) draftNotes!: string | null;
  @ManyToOne(() => Author) author!: Author;
}

describe('historyEntities', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Author, Post, ...historyEntities()],
      synchronize: true,
    });
    await ds.initialize();
  });
  afterAll(() => ds.destroy());

  it('creates a <table>_history table per entity', () => {
    const meta = ds.getMetadata('PostHistory');
    expect(meta.tableName).toBe('post_history');
    expect(ds.getMetadata('AuthorHistory').tableName).toBe('author_history');
  });

  it('copies source columns, demotes pk, adds FK id column, drops excluded', () => {
    const meta = ds.getMetadata('PostHistory');
    const names = meta.columns.map((c) => c.databaseName);
    expect(names).toEqual(
      expect.arrayContaining(['id', 'title', 'authorId', 'history_id', 'history_type', 'history_date', 'history_user_id', 'history_change_reason']),
    );
    expect(names).not.toContain('draftNotes');
    const id = meta.columns.find((c) => c.databaseName === 'id')!;
    expect(id.isPrimary).toBe(false);
    expect(id.isGenerated).toBe(false);
    const hid = meta.columns.find((c) => c.databaseName === 'history_id')!;
    expect(hid.isPrimary).toBe(true);
    expect(hid.isGenerated).toBe(true);
  });

  it('adds composite index (pk, history_date)', () => {
    const meta = ds.getMetadata('PostHistory');
    const idx = meta.indices.find(
      (i) => i.columns.length === 2 && i.columns.some((c) => c.databaseName === 'id') && i.columns.some((c) => c.databaseName === 'history_date'),
    );
    expect(idx).toBeDefined();
  });

  it('fills registry entry bookkeeping', () => {
    const entry = getHistorizedEntry(Post)!;
    expect(entry.schema).toBeDefined();
    expect(entry.pkProp).toBe('id');
    expect(entry.pkDbName).toBe('id');
    expect([...entry.trackedDbNames!]).toEqual(expect.arrayContaining(['id', 'title', 'authorId']));
    expect([...entry.trackedDbNames!]).not.toContain('draftNotes');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F typeorm-entity-history vitest run test/history-entity-factory.test.ts`
Expected: FAIL — cannot resolve `../src/metadata/history-entity-factory`.

- [ ] **Step 3: Implement**

`src/metadata/meta-columns.ts`:

```typescript
export const META = {
  id: 'history_id',
  type: 'history_type',
  date: 'history_date',
  user: 'history_user_id',
  reason: 'history_change_reason',
} as const;

export type HistoryType = '+' | '~' | '-';
```

`src/metadata/history-entity-factory.ts`:

```typescript
import 'reflect-metadata';
import {
  ColumnType,
  EntitySchema,
  EntitySchemaColumnOptions,
  getMetadataArgsStorage,
} from 'typeorm';
import { ColumnMetadataArgs } from 'typeorm/metadata-args/ColumnMetadataArgs';
import { META } from './meta-columns';
import { listHistorized, RegistryEntry } from './registry';

export interface HistoryEntitiesOptions {
  /** e.g. 'timestamptz' on Postgres. Default: Date (driver default). */
  dateColumnType?: ColumnType;
  /** Default: String. */
  userIdColumnType?: ColumnType;
}

const ERR = '[typeorm-entity-history]';

function inheritanceChain(target: Function): Function[] {
  const chain: Function[] = [];
  let t: Function | null = target;
  while (t && t !== Function.prototype && t.name) {
    chain.push(t);
    t = Object.getPrototypeOf(t);
  }
  return chain;
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function upperFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function designType(target: Function, prop: string): ColumnType | undefined {
  return Reflect.getMetadata('design:type', target.prototype, prop) as ColumnType | undefined;
}

function findPrimaryColumn(target: Function): ColumnMetadataArgs {
  const chain = inheritanceChain(target);
  const primaries = getMetadataArgsStorage().columns.filter(
    (c) => chain.includes(c.target as Function) && c.options.primary,
  );
  if (primaries.length === 0) throw new Error(`${ERR} ${target.name} has no primary column.`);
  if (primaries.length > 1)
    throw new Error(`${ERR} ${target.name}: composite primary keys are not supported in v1.`);
  return primaries[0];
}

function buildSchemaFor(entry: RegistryEntry, opts: HistoryEntitiesOptions): EntitySchema {
  const storage = getMetadataArgsStorage();
  const target = entry.target;
  const chain = inheritanceChain(target);
  const exclude = new Set(entry.options.exclude ?? []);

  const tableArgs = storage.tables.find((t) => t.target === target);
  const sourceTable = tableArgs?.name ?? lowerFirst(target.name);

  const columns: Record<string, EntitySchemaColumnOptions> = {};
  const tracked = new Set<string>();

  // regular columns (incl. create/update/delete-date columns, copied as plain columns)
  for (const col of storage.columns.filter((c) => chain.includes(c.target as Function))) {
    if (exclude.has(col.propertyName)) continue;
    const dbName = col.options.name ?? col.propertyName;
    const type = (col.options.type ?? designType(col.target as Function, col.propertyName) ?? String) as ColumnType;
    columns[dbName] = {
      name: dbName,
      type,
      nullable: col.options.primary ? false : col.options.nullable ?? false,
      length: col.options.length,
      precision: col.options.precision ?? undefined,
      scale: col.options.scale,
      enum: col.options.enum,
    };
    tracked.add(dbName);
    if (col.options.primary) {
      entry.pkProp = col.propertyName;
      entry.pkDbName = dbName;
    }
  }

  findPrimaryColumn(target); // asserts exactly one pk exists

  // FK columns of owning relations (many-to-one, one-to-one with JoinColumn)
  for (const rel of storage.relations.filter((r) => chain.includes(r.target as Function))) {
    if (exclude.has(rel.propertyName)) continue;
    const joinCol = storage.joinColumns.find(
      (j) => chain.includes(j.target as Function) && j.propertyName === rel.propertyName,
    );
    const owning = rel.relationType === 'many-to-one' || (rel.relationType === 'one-to-one' && !!joinCol);
    if (!owning) continue;
    if (typeof rel.type !== 'function')
      throw new Error(`${ERR} ${target.name}.${rel.propertyName}: string relation targets are not supported in v1.`);
    const related = (rel.type as () => Function)();
    const refPk = findPrimaryColumn(related);
    const refType = (refPk.options.type ??
      designType(refPk.target as Function, refPk.propertyName) ??
      Number) as ColumnType;
    const dbName = joinCol?.name ?? `${rel.propertyName}${upperFirst(refPk.propertyName)}`;
    columns[dbName] = { name: dbName, type: refType, nullable: true };
    tracked.add(dbName);
  }

  if (!entry.pkDbName) throw new Error(`${ERR} ${target.name}: primary column not found.`);

  columns[META.id] = { name: META.id, type: Number, primary: true, generated: 'increment' };
  columns[META.type] = { name: META.type, type: String, length: 1 };
  columns[META.date] = { name: META.date, type: opts.dateColumnType ?? Date };
  columns[META.user] = { name: META.user, type: opts.userIdColumnType ?? String, nullable: true };
  columns[META.reason] = { name: META.reason, type: String, nullable: true };

  return new EntitySchema({
    name: `${target.name}History`,
    tableName: entry.options.tableName ?? `${sourceTable}_history`,
    columns,
    indices: [{ columns: [entry.pkDbName, META.date] }],
  });
}

export function historyEntities(opts: HistoryEntitiesOptions = {}): EntitySchema[] {
  return listHistorized().map((entry) => {
    const schema = buildSchemaFor(entry, opts);
    entry.schema = schema;
    entry.trackedDbNames = new Set(
      Object.keys((schema.options.columns ?? {}) as object).filter(
        (k) => !Object.values(META).includes(k as (typeof META)[keyof typeof META]),
      ),
    );
    return schema;
  });
}
```

Add to `src/index.ts`:

```typescript
export { historyEntities, HistoryEntitiesOptions } from './metadata/history-entity-factory';
export { META, HistoryType } from './metadata/meta-columns';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F typeorm-entity-history vitest run test/history-entity-factory.test.ts`
Expected: PASS (4 tests). If `authorId` mismatch: inspect `ds.getMetadata(Post).columns.map(c => c.databaseName)` — the FK db name computed by the factory must equal TypeORM's runtime name for the source entity.

- [ ] **Step 5: Add error-case tests, verify, commit**

Append to the same test file:

```typescript
describe('historyEntities error cases', () => {
  it('rejects composite primary keys', async () => {
    const { PrimaryColumn } = await import('typeorm');
    const { clearHistorizedRegistry } = await import('../src/metadata/registry');
    // isolated registry: snapshot current entries is not needed; this file's DataSource is already built
    @Entity()
    @Historized()
    class Composite {
      @PrimaryColumn() a!: number;
      @PrimaryColumn() b!: number;
    }
    expect(() => historyEntities()).toThrowError(/composite primary keys/);
    clearHistorizedRegistry();
  });
});
```

Note: this test runs LAST in the file (registry is shared per process; `clearHistorizedRegistry()` cleans up). Run the file; expected: PASS.

```bash
git add -A && git commit -m "feat(core): runtime history EntitySchema generation via historyEntities()"
```

---

### Task 4: AsyncLocalStorage context

**Files:**
- Create: `packages/typeorm-history/src/context/history-context.ts`
- Modify: `packages/typeorm-history/src/index.ts`
- Test: `packages/typeorm-history/test/history-context.test.ts`

**Interfaces:**
- Produces:
  - `interface HistoryContext { userId?: string | number | null; changeReason?: string | null }`
  - `withHistoryContext<T>(ctx: HistoryContext, fn: () => T): T`
  - `getHistoryContext(): HistoryContext | undefined`
  - `setChangeReason(reason: string): void` (no-op outside a context)

- [ ] **Step 1: Write failing test**

`test/history-context.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { getHistoryContext, setChangeReason, withHistoryContext } from '../src/context/history-context';

describe('history context', () => {
  it('is undefined outside a context', () => {
    expect(getHistoryContext()).toBeUndefined();
  });

  it('propagates through async calls', async () => {
    const seen = await withHistoryContext({ userId: 'u1' }, async () => {
      await new Promise((r) => setTimeout(r, 1));
      return getHistoryContext();
    });
    expect(seen).toEqual({ userId: 'u1' });
  });

  it('setChangeReason mutates the active context and no-ops outside', async () => {
    setChangeReason('ignored'); // no throw
    await withHistoryContext({ userId: 'u1' }, async () => {
      setChangeReason('because');
      expect(getHistoryContext()).toEqual({ userId: 'u1', changeReason: 'because' });
    });
  });

  it('nested contexts restore on exit', async () => {
    await withHistoryContext({ userId: 'outer' }, async () => {
      await withHistoryContext({ userId: 'inner' }, async () => {
        expect(getHistoryContext()?.userId).toBe('inner');
      });
      expect(getHistoryContext()?.userId).toBe('outer');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F typeorm-entity-history vitest run test/history-context.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/context/history-context.ts`:

```typescript
import { AsyncLocalStorage } from 'node:async_hooks';

export interface HistoryContext {
  userId?: string | number | null;
  changeReason?: string | null;
}

const als = new AsyncLocalStorage<HistoryContext>();

export function withHistoryContext<T>(ctx: HistoryContext, fn: () => T): T {
  return als.run({ ...ctx }, fn);
}

export function getHistoryContext(): HistoryContext | undefined {
  return als.getStore();
}

export function setChangeReason(reason: string): void {
  const store = als.getStore();
  if (store) store.changeReason = reason;
}
```

Add to `src/index.ts`:

```typescript
export { HistoryContext, getHistoryContext, setChangeReason, withHistoryContext } from './context/history-context';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F typeorm-entity-history vitest run test/history-context.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): AsyncLocalStorage history context"
```

---

### Task 5: HistorySubscriber write path

**Files:**
- Create: `packages/typeorm-history/src/subscriber/history-subscriber.ts`, `packages/typeorm-history/test/support/blog-fixture.ts`
- Modify: `packages/typeorm-history/src/index.ts`
- Test: `packages/typeorm-history/test/history-subscriber.test.ts`

**Interfaces:**
- Consumes: registry (Task 2), `historyEntities()` (Task 3), context (Task 4).
- Produces:
  - `class HistorySubscriber implements EntitySubscriberInterface` — user adds it to `DataSource.subscribers`.
  - `recordHistoryRow(type: HistoryType, metadata: EntityMetadata, entity: any, manager: EntityManager, reselect: boolean): Promise<void>` (exported from the same file; reused by bulk helpers in Task 9).
- Snapshot rule: per tracked source column, value = `column.getEntityValue(entity)`; if `undefined` and `reselect`, fall back to a raw re-select of the source row by pk within `manager` (covers FK values absent from partial entities and DB defaults). `'-'` never reselects (row is gone).

- [ ] **Step 1: Shared fixture**

`test/support/blog-fixture.ts`:

```typescript
import 'reflect-metadata';
import {
  Column,
  DataSource,
  DeleteDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Historized } from '../../src/decorators/historized';
import { historyEntities } from '../../src/metadata/history-entity-factory';
import { HistorySubscriber } from '../../src/subscriber/history-subscriber';

@Entity()
@Historized()
export class Author {
  @PrimaryGeneratedColumn() id!: number;
  @Column() name!: string;
}

@Entity()
@Historized({ exclude: ['draftNotes'], trackSoftDelete: true })
export class Post {
  @PrimaryGeneratedColumn() id!: number;
  @Column() title!: string;
  @Column({ nullable: true }) draftNotes!: string | null;
  @ManyToOne(() => Author, { nullable: true }) author!: Author | null;
  @DeleteDateColumn() deletedAt!: Date | null;
}

export function buildDataSource(): DataSource {
  return new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [Author, Post, ...historyEntities()],
    subscribers: [HistorySubscriber],
    synchronize: true,
  });
}
```

- [ ] **Step 2: Write failing test**

`test/history-subscriber.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { withHistoryContext } from '../src/context/history-context';
import { Author, Post, buildDataSource } from './support/blog-fixture';

describe('HistorySubscriber', () => {
  let ds: DataSource;
  beforeAll(async () => {
    ds = buildDataSource();
    await ds.initialize();
  });
  afterAll(() => ds.destroy());

  const historyRows = () =>
    ds.getRepository('PostHistory').find({ order: { history_id: 'ASC' } as any }) as Promise<any[]>;

  it("records '+' with context, FK id, and excluded column absent", async () => {
    const author = await ds.manager.save(Author, { name: 'Ann' });
    const post = await withHistoryContext({ userId: 'u1', changeReason: 'create' }, () =>
      ds.manager.save(Post, { title: 'Hello', author, draftNotes: 'wip' }),
    );
    const rows = await historyRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: post.id,
      title: 'Hello',
      authorId: author.id,
      history_type: '+',
      history_user_id: 'u1',
      history_change_reason: 'create',
    });
    expect(rows[0]).not.toHaveProperty('draftNotes');
  });

  it("records '~' on update, keeping FK from a partial save", async () => {
    const post = await ds.manager.findOneByOrFail(Post, { title: 'Hello' });
    await ds.manager.save(Post, { id: post.id, title: 'Hello v2' });
    const rows = await historyRows();
    expect(rows).toHaveLength(2);
    expect(rows[1].history_type).toBe('~');
    expect(rows[1].title).toBe('Hello v2');
    expect(rows[1].authorId).not.toBeNull(); // reselect fallback preserved the FK
    expect(rows[1].history_user_id).toBeNull(); // no context → null, no throw
  });

  it("records '-' on soft remove and '~' on recover", async () => {
    const post = await ds.manager.findOneByOrFail(Post, { title: 'Hello v2' });
    await ds.manager.softRemove(Post, post);
    await ds.manager.recover(Post, post);
    const rows = await historyRows();
    expect(rows.map((r) => r.history_type)).toEqual(['+', '~', '-', '~']);
  });

  it("records '-' on hard remove with the final snapshot", async () => {
    const post = await ds.manager.findOneByOrFail(Post, { title: 'Hello v2' });
    const id = post.id;
    await ds.manager.remove(Post, post);
    const rows = await historyRows();
    const last = rows[rows.length - 1];
    expect(last.history_type).toBe('-');
    expect(last.id).toBe(id);
    expect(last.title).toBe('Hello v2');
  });

  it('history rolls back with the surrounding transaction', async () => {
    const before = (await historyRows()).length;
    await expect(
      ds.transaction(async (em) => {
        await em.save(Post, { title: 'doomed' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect((await historyRows()).length).toBe(before);
  });

  it('non-historized entities are ignored', async () => {
    // Author IS historized here; assert its rows landed in its own table only
    const authorRows = (await ds.getRepository('AuthorHistory').find()) as any[];
    expect(authorRows.every((r) => 'name' in r)).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm -F typeorm-entity-history vitest run test/history-subscriber.test.ts`
Expected: FAIL — `HistorySubscriber` not found.

- [ ] **Step 4: Implement**

`src/subscriber/history-subscriber.ts`:

```typescript
import {
  EntityManager,
  EntityMetadata,
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
  RecoverEvent,
  RemoveEvent,
  SoftRemoveEvent,
  UpdateEvent,
} from 'typeorm';
import { getHistoryContext } from '../context/history-context';
import { META, HistoryType } from '../metadata/meta-columns';
import { getHistorizedEntry, RegistryEntry } from '../metadata/registry';

const ERR = '[typeorm-entity-history]';

function entryFor(metadata: EntityMetadata): RegistryEntry | undefined {
  const entry = getHistorizedEntry(metadata.target as Function);
  if (!entry) return undefined;
  if (!entry.schema) {
    throw new Error(
      `${ERR} ${metadata.name} is @Historized but historyEntities() was not included in the DataSource. ` +
        `Fix: new DataSource({ entities: [..., ...historyEntities()], subscribers: [HistorySubscriber] })`,
    );
  }
  return entry;
}

export async function recordHistoryRow(
  type: HistoryType,
  metadata: EntityMetadata,
  entity: any,
  manager: EntityManager,
  reselect: boolean,
): Promise<void> {
  if (!entity) return;
  const entry = entryFor(metadata);
  if (!entry) return;

  let raw: Record<string, unknown> | undefined;
  const needsRaw = () => metadata.columns.some((c) => entry.trackedDbNames!.has(c.databaseName) && c.getEntityValue(entity) === undefined);
  if (reselect && needsRaw()) {
    const pkCol = metadata.primaryColumns[0];
    const pkVal = pkCol.getEntityValue(entity);
    raw = await manager
      .createQueryBuilder()
      .select('*')
      .from(metadata.tablePath, 't')
      .where(`${pkCol.databaseName} = :pk`, { pk: pkVal })
      .getRawOne();
  }

  const ctx = getHistoryContext();
  const row: Record<string, unknown> = {};
  for (const col of metadata.columns) {
    if (!entry.trackedDbNames!.has(col.databaseName)) continue;
    const v = col.getEntityValue(entity);
    row[col.databaseName] = v !== undefined ? v : raw?.[col.databaseName] ?? null;
  }
  row[META.type] = type;
  row[META.date] = new Date();
  row[META.user] = ctx?.userId ?? null;
  row[META.reason] = ctx?.changeReason ?? null;

  await manager.getRepository(entry.schema!).insert(row as any);
}

@EventSubscriber()
export class HistorySubscriber implements EntitySubscriberInterface {
  async afterInsert(event: InsertEvent<any>): Promise<void> {
    await recordHistoryRow('+', event.metadata, event.entity, event.manager, true);
  }

  async afterUpdate(event: UpdateEvent<any>): Promise<void> {
    const snapshot = { ...(event.databaseEntity ?? {}), ...stripUndefined(event.entity ?? {}) };
    await recordHistoryRow('~', event.metadata, snapshot, event.manager, true);
  }

  async afterRemove(event: RemoveEvent<any>): Promise<void> {
    await recordHistoryRow('-', event.metadata, event.databaseEntity ?? event.entity, event.manager, false);
  }

  async afterSoftRemove(event: SoftRemoveEvent<any>): Promise<void> {
    if (!trackSoft(event.metadata)) return;
    await recordHistoryRow('-', event.metadata, event.entity ?? event.databaseEntity, event.manager, true);
  }

  async afterRecover(event: RecoverEvent<any>): Promise<void> {
    if (!trackSoft(event.metadata)) return;
    await recordHistoryRow('~', event.metadata, event.entity ?? event.databaseEntity, event.manager, true);
  }
}

function trackSoft(metadata: EntityMetadata): boolean {
  return getHistorizedEntry(metadata.target as Function)?.options.trackSoftDelete === true;
}

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}
```

Add to `src/index.ts`:

```typescript
export { HistorySubscriber, recordHistoryRow } from './subscriber/history-subscriber';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -F typeorm-entity-history vitest run test/history-subscriber.test.ts`
Expected: PASS (6 tests). Then run the whole suite: `pnpm -F typeorm-entity-history test` — all green.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(core): HistorySubscriber records +/~/- snapshots in-transaction"
```

---

### Task 6: HistoryRepository — `forEntity().all()`, `HistoryRecord.diffAgainst()`

**Files:**
- Create: `packages/typeorm-history/src/repository/history-record.ts`, `packages/typeorm-history/src/repository/history-repository.ts`
- Modify: `packages/typeorm-history/src/index.ts`
- Test: `packages/typeorm-history/test/history-repository.test.ts`

**Interfaces:**
- Consumes: fixture (Task 5), registry entries with `schema`/`pkDbName`/`trackedDbNames`.
- Produces:
  - `class HistoryRecord<T>`: getters `historyId: number`, `historyType: HistoryType`, `historyDate: Date`, `historyUserId: string | null`, `historyChangeReason: string | null`, `snapshot: Record<string, unknown>`; method `diffAgainst(older: HistoryRecord<T>): HistoryDiff`.
  - `interface HistoryDiff { changes: Array<{ field: string; old: unknown; new: unknown }> }`
  - `historyRepo<T>(ds: DataSource, target: new () => T): HistoryRepository<T>` — validates setup (throws if entity not historized, schema missing, entity metadata missing from DataSource, or `HistorySubscriber` not in `ds.subscribers`).
  - `HistoryRepository<T>.forEntity(pk: unknown): EntityHistoryQuery<T>` with `all(): Promise<HistoryRecord<T>[]>` (newest first).
  - Internal helper `toEntity(raw): T` — maps raw history row to a source-entity instance; FK columns become relation stubs (`entity.author = { id: <fk> }`). Used by `asOf`/`revertTo` in later tasks.

- [ ] **Step 1: Write failing test**

`test/history-repository.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { withHistoryContext } from '../src/context/history-context';
import { historyRepo } from '../src/repository/history-repository';
import { Author, Post, buildDataSource } from './support/blog-fixture';

describe('HistoryRepository basics', () => {
  let ds: DataSource;
  let postId: number;

  beforeAll(async () => {
    ds = buildDataSource();
    await ds.initialize();
    const author = await ds.manager.save(Author, { name: 'Ann' });
    const post = await withHistoryContext({ userId: 'u1' }, () =>
      ds.manager.save(Post, { title: 'v1', author }),
    );
    postId = post.id;
    await ds.manager.save(Post, { id: postId, title: 'v2' });
    await ds.manager.save(Post, { id: postId, title: 'v3' });
  });
  afterAll(() => ds.destroy());

  it('all() returns records newest first with meta accessors', async () => {
    const records = await historyRepo(ds, Post).forEntity(postId).all();
    expect(records.map((r) => r.historyType)).toEqual(['~', '~', '+']);
    expect(records[2].historyUserId).toBe('u1');
    expect(records[0].historyDate).toBeInstanceOf(Date);
    expect(records[0].snapshot.title).toBe('v3');
  });

  it('diffAgainst() lists changed tracked fields only', async () => {
    const [newest, , oldest] = await historyRepo(ds, Post).forEntity(postId).all();
    const diff = newest.diffAgainst(oldest);
    expect(diff.changes).toEqual([{ field: 'title', old: 'v1', new: 'v3' }]);
  });

  it('throws a clear error for non-historized entities', () => {
    class Plain {}
    expect(() => historyRepo(ds, Plain as any)).toThrowError(/not @Historized/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F typeorm-entity-history vitest run test/history-repository.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/repository/history-record.ts`:

```typescript
import { META, HistoryType } from '../metadata/meta-columns';

export interface HistoryDiff {
  changes: Array<{ field: string; old: unknown; new: unknown }>;
}

function eq(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    return new Date(a as any).getTime() === new Date(b as any).getTime();
  }
  return a === b;
}

export class HistoryRecord<T> {
  constructor(
    readonly raw: Record<string, any>,
    private readonly trackedDbNames: string[],
  ) {}

  get historyId(): number {
    return this.raw[META.id];
  }
  get historyType(): HistoryType {
    return this.raw[META.type];
  }
  get historyDate(): Date {
    const v = this.raw[META.date];
    return v instanceof Date ? v : new Date(v);
  }
  get historyUserId(): string | null {
    return this.raw[META.user] ?? null;
  }
  get historyChangeReason(): string | null {
    return this.raw[META.reason] ?? null;
  }
  get snapshot(): Record<string, unknown> {
    return Object.fromEntries(this.trackedDbNames.map((k) => [k, this.raw[k]]));
  }

  diffAgainst(older: HistoryRecord<T>): HistoryDiff {
    const changes = this.trackedDbNames
      .filter((k) => !eq(this.raw[k], older.raw[k]))
      .map((k) => ({ field: k, old: older.raw[k], new: this.raw[k] }));
    return { changes };
  }
}
```

`src/repository/history-repository.ts`:

```typescript
import { DataSource, EntityMetadata, ObjectLiteral, Repository } from 'typeorm';
import { META } from '../metadata/meta-columns';
import { getHistorizedEntry, RegistryEntry } from '../metadata/registry';
import { HistorySubscriber } from '../subscriber/history-subscriber';
import { HistoryRecord } from './history-record';

const ERR = '[typeorm-entity-history]';

export type EntityClass<T> = new (...args: any[]) => T;

export class HistoryRepository<T extends ObjectLiteral> {
  readonly entry: RegistryEntry;
  readonly sourceMeta: EntityMetadata;

  constructor(
    readonly ds: DataSource,
    readonly target: EntityClass<T>,
  ) {
    const entry = getHistorizedEntry(target);
    if (!entry) throw new Error(`${ERR} ${target.name} is not @Historized.`);
    if (!entry.schema)
      throw new Error(`${ERR} historyEntities() was not called before DataSource init for ${target.name}.`);
    if (!ds.hasMetadata(target))
      throw new Error(`${ERR} ${target.name} is not part of this DataSource's entities.`);
    if (!ds.subscribers.some((s) => s instanceof HistorySubscriber))
      throw new Error(
        `${ERR} HistorySubscriber is not registered. Fix: new DataSource({ ..., subscribers: [HistorySubscriber] })`,
      );
    this.entry = entry;
    this.sourceMeta = ds.getMetadata(target);
  }

  get histRepo(): Repository<ObjectLiteral> {
    return this.ds.getRepository(this.entry.schema!);
  }

  get tracked(): string[] {
    return [...this.entry.trackedDbNames!];
  }

  toRecord(raw: Record<string, any>): HistoryRecord<T> {
    return new HistoryRecord<T>(raw, this.tracked);
  }

  /** Raw history row -> source entity instance. FK columns become relation stubs { pk: value }. */
  toEntity(raw: Record<string, any>): T {
    const data: Record<string, unknown> = {};
    for (const col of this.sourceMeta.columns) {
      if (!this.entry.trackedDbNames!.has(col.databaseName)) continue;
      const value = raw[col.databaseName];
      if (col.relationMetadata && col.referencedColumn) {
        data[col.relationMetadata.propertyName] =
          value == null ? null : { [col.referencedColumn.propertyName]: value };
      } else {
        data[col.propertyName] = value;
      }
    }
    return this.ds.manager.create(this.target, data as any);
  }

  forEntity(pk: unknown): EntityHistoryQuery<T> {
    return new EntityHistoryQuery(this, pk);
  }
}

export class EntityHistoryQuery<T extends ObjectLiteral> {
  constructor(
    private readonly repo: HistoryRepository<T>,
    private readonly pk: unknown,
  ) {}

  async all(): Promise<HistoryRecord<T>[]> {
    const rows = await this.repo.histRepo.find({
      where: { [this.repo.entry.pkDbName!]: this.pk } as any,
      order: { [META.id]: 'DESC' } as any,
    });
    return rows.map((r) => this.repo.toRecord(r));
  }
}

export function historyRepo<T extends ObjectLiteral>(ds: DataSource, target: EntityClass<T>): HistoryRepository<T> {
  return new HistoryRepository(ds, target);
}
```

Add to `src/index.ts`:

```typescript
export { HistoryRecord, HistoryDiff } from './repository/history-record';
export { EntityHistoryQuery, HistoryRepository, historyRepo } from './repository/history-repository';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F typeorm-entity-history vitest run test/history-repository.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): history repository with all() and diffAgainst()"
```

---

### Task 7: Time travel — `asOf()` (entity-level and table-wide)

**Files:**
- Modify: `packages/typeorm-history/src/repository/history-repository.ts`
- Test: `packages/typeorm-history/test/as-of.test.ts`

**Interfaces:**
- Consumes: Task 6 classes.
- Produces:
  - `EntityHistoryQuery<T>.asOf(date: Date, opts?: AsOfOptions): Promise<T | null>` — latest row with `history_date <= date`; `null` if none or latest is `'-'`.
  - `HistoryRepository<T>.asOf(date: Date, opts?: AsOfOptions): Promise<T[]>` — table-wide snapshot; internally accepts an extra filter param `where?: Record<string, unknown>` (used by Task 10 relations).
  - `interface AsOfOptions { relations?: string[] }` — declared now, implemented in Task 10 (until then, passing `relations` throws `not implemented` is NOT acceptable; instead leave the option out of the type until Task 10 — declare `AsOfOptions` in Task 10 only).

- [ ] **Step 1: Write failing test**

`test/as-of.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { historyRepo } from '../src/repository/history-repository';
import { Author, Post, buildDataSource } from './support/blog-fixture';

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('asOf', () => {
  let ds: DataSource;
  let postId: number;
  let t0: Date, t1: Date, t2: Date, t3: Date;

  beforeAll(async () => {
    ds = buildDataSource();
    await ds.initialize();
    t0 = new Date();
    await tick();
    const author = await ds.manager.save(Author, { name: 'Ann' });
    const post = await ds.manager.save(Post, { title: 'v1', author });
    postId = post.id;
    await tick();
    t1 = new Date();
    await tick();
    await ds.manager.save(Post, { id: postId, title: 'v2' });
    await tick();
    t2 = new Date();
    await tick();
    const loaded = await ds.manager.findOneByOrFail(Post, { id: postId });
    await ds.manager.remove(Post, loaded);
    await tick();
    t3 = new Date();
  });
  afterAll(() => ds.destroy());

  it('returns null before the entity existed', async () => {
    expect(await historyRepo(ds, Post).forEntity(postId).asOf(t0)).toBeNull();
  });

  it('returns the reconstructed instance at each point in time', async () => {
    const at1 = await historyRepo(ds, Post).forEntity(postId).asOf(t1);
    expect(at1).toBeInstanceOf(Post);
    expect(at1!.title).toBe('v1');
    expect(at1!.author).toEqual({ id: 1 }); // FK relation stub
    const at2 = await historyRepo(ds, Post).forEntity(postId).asOf(t2);
    expect(at2!.title).toBe('v2');
  });

  it('returns null after deletion', async () => {
    expect(await historyRepo(ds, Post).forEntity(postId).asOf(t3)).toBeNull();
  });

  it('table-wide asOf excludes deleted entities and picks latest version', async () => {
    const author2 = await ds.manager.save(Author, { name: 'Bob' });
    await ds.manager.save(Post, { title: 'other', author: author2 });
    const nowAll = await historyRepo(ds, Post).asOf(new Date());
    expect(nowAll.map((p) => p.title)).toEqual(['other']);
    const at2All = await historyRepo(ds, Post).asOf(t2);
    expect(at2All.map((p) => p.title)).toEqual(['v2']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F typeorm-entity-history vitest run test/as-of.test.ts`
Expected: FAIL — `asOf is not a function`.

- [ ] **Step 3: Implement**

Add to `EntityHistoryQuery` in `src/repository/history-repository.ts`:

```typescript
  async asOf(date: Date): Promise<T | null> {
    const { LessThanOrEqual } = await import('typeorm');
    const rows = await this.repo.histRepo.find({
      where: {
        [this.repo.entry.pkDbName!]: this.pk,
        [META.date]: LessThanOrEqual(date),
      } as any,
      order: { [META.id]: 'DESC' } as any,
      take: 1,
    });
    if (rows.length === 0 || rows[0][META.type] === '-') return null;
    return this.repo.toEntity(rows[0]);
  }
```

(Use a top-of-file static import `import { LessThanOrEqual, In } from 'typeorm';` instead of the dynamic import — shown inline here only for locality.)

Add to `HistoryRepository`:

```typescript
  /** Table-wide snapshot at `date`. `extraWhere` filters candidate rows (used for relation reconstruction). */
  async asOf(date: Date, extraWhere: Record<string, unknown> = {}): Promise<T[]> {
    const pkDb = this.entry.pkDbName!;
    const qb = this.histRepo
      .createQueryBuilder('h')
      .select(`MAX(h.${META.id})`, 'mid')
      .where(`h.${META.date} <= :date`, { date })
      .groupBy(`h.${pkDb}`);
    for (const [k, v] of Object.entries(extraWhere)) {
      qb.andWhere(`h.${k} = :w_${k}`, { [`w_${k}`]: v });
    }
    const maxRows: Array<{ mid: number }> = await qb.getRawMany();
    if (maxRows.length === 0) return [];
    const rows = await this.histRepo.find({ where: { [META.id]: In(maxRows.map((r) => Number(r.mid))) } as any });
    return rows.filter((r) => r[META.type] !== '-').map((r) => this.toEntity(r));
  }
```

Note on sqlite date params in the query builder: better-sqlite3 stores `Date` columns as ISO-like strings; if the `:date` comparison misbehaves, pass `date.toISOString()` for the parameter when `this.ds.options.type === 'better-sqlite3'`. Verify against the failing test before adding the special case.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F typeorm-entity-history vitest run test/as-of.test.ts`
Expected: PASS (4 tests). Run full suite too.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): asOf time-travel queries (entity and table-wide)"
```

---

### Task 8: `revertTo()`

**Files:**
- Modify: `packages/typeorm-history/src/repository/history-repository.ts`
- Test: `packages/typeorm-history/test/revert.test.ts`

**Interfaces:**
- Consumes: Tasks 4–7.
- Produces: `EntityHistoryQuery<T>.revertTo(historyId: number): Promise<T>` — loads the snapshot, saves it through `manager.save` inside `withHistoryContext({ ...current, changeReason: 'reverted' })`. The subscriber then records `'~'` (entity exists) or `'+'` (entity was deleted; save re-inserts) automatically. Throws if `historyId` doesn't exist or belongs to a different entity.

- [ ] **Step 1: Write failing test**

`test/revert.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { historyRepo } from '../src/repository/history-repository';
import { Author, Post, buildDataSource } from './support/blog-fixture';

describe('revertTo', () => {
  let ds: DataSource;
  let postId: number;

  beforeAll(async () => {
    ds = buildDataSource();
    await ds.initialize();
    const author = await ds.manager.save(Author, { name: 'Ann' });
    const post = await ds.manager.save(Post, { title: 'v1', author });
    postId = post.id;
    await ds.manager.save(Post, { id: postId, title: 'v2' });
  });
  afterAll(() => ds.destroy());

  it("restores an old version and records '~' with reason 'reverted'", async () => {
    const repo = historyRepo(ds, Post);
    const records = await repo.forEntity(postId).all();
    const v1 = records.find((r) => r.snapshot.title === 'v1')!;
    const restored = await repo.forEntity(postId).revertTo(v1.historyId);
    expect(restored.title).toBe('v1');
    expect((await ds.manager.findOneByOrFail(Post, { id: postId })).title).toBe('v1');
    const [newest] = await repo.forEntity(postId).all();
    expect(newest.historyType).toBe('~');
    expect(newest.historyChangeReason).toBe('reverted');
  });

  it("re-inserts a deleted entity and records '+'", async () => {
    const repo = historyRepo(ds, Post);
    const loaded = await ds.manager.findOneByOrFail(Post, { id: postId });
    await ds.manager.remove(Post, loaded);
    const records = await repo.forEntity(postId).all();
    const lastAlive = records.find((r) => r.historyType !== '-')!;
    await repo.forEntity(postId).revertTo(lastAlive.historyId);
    expect(await ds.manager.findOneBy(Post, { id: postId })).not.toBeNull();
    const [newest] = await repo.forEntity(postId).all();
    expect(newest.historyType).toBe('+');
    expect(newest.historyChangeReason).toBe('reverted');
  });

  it('rejects a historyId belonging to another entity', async () => {
    const repo = historyRepo(ds, Post);
    const other = await ds.manager.save(Post, { title: 'other' });
    const [otherRec] = await repo.forEntity(other.id).all();
    await expect(repo.forEntity(postId).revertTo(otherRec.historyId)).rejects.toThrow(/belongs to/);
  });

  it('rejects an unknown historyId', async () => {
    await expect(historyRepo(ds, Post).forEntity(postId).revertTo(999999)).rejects.toThrow(/not found/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F typeorm-entity-history vitest run test/revert.test.ts`
Expected: FAIL — `revertTo is not a function`.

- [ ] **Step 3: Implement**

Add to `EntityHistoryQuery` (imports: `getHistoryContext`, `withHistoryContext` from `../context/history-context`):

```typescript
  async revertTo(historyId: number): Promise<T> {
    const row = await this.repo.histRepo.findOneBy({ [META.id]: historyId } as any);
    if (!row) throw new Error(`[typeorm-entity-history] history row ${historyId} not found.`);
    if (row[this.repo.entry.pkDbName!] !== this.pk)
      throw new Error(`[typeorm-entity-history] history row ${historyId} belongs to a different entity.`);
    const entity = this.repo.toEntity(row);
    const ctx = getHistoryContext() ?? {};
    return withHistoryContext({ ...ctx, changeReason: 'reverted' }, () =>
      this.repo.ds.manager.save(this.repo.target, entity),
    );
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F typeorm-entity-history vitest run test/revert.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): revertTo restores snapshots through the normal save path"
```

---

### Task 9: Bulk helpers

**Files:**
- Create: `packages/typeorm-history/src/bulk/bulk-helpers.ts`
- Modify: `packages/typeorm-history/src/index.ts`
- Test: `packages/typeorm-history/test/bulk.test.ts`

**Interfaces:**
- Consumes: `recordHistoryRow` (Task 5), registry.
- Produces:
  - `bulkUpdateWithHistory<T>(repo: Repository<T>, criteria: FindOptionsWhere<T>, patch: QueryDeepPartialEntity<T>): Promise<{ affected: number }>`
  - `bulkDeleteWithHistory<T>(repo: Repository<T>, criteria: FindOptionsWhere<T>): Promise<{ affected: number }>`
  - Both run in one transaction: select matching rows first (by criteria), apply the bulk statement by primary key `In(ids)`, then write one history row per affected entity (`'~'` from post-update reselect, `'-'` from the pre-delete rows).

- [ ] **Step 1: Write failing test**

`test/bulk.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { withHistoryContext } from '../src/context/history-context';
import { bulkDeleteWithHistory, bulkUpdateWithHistory } from '../src/bulk/bulk-helpers';
import { Post, buildDataSource } from './support/blog-fixture';

describe('bulk helpers', () => {
  let ds: DataSource;
  beforeAll(async () => {
    ds = buildDataSource();
    await ds.initialize();
    await ds.manager.save(Post, [{ title: 'a' }, { title: 'a' }, { title: 'b' }]);
  });
  afterAll(() => ds.destroy());

  it("bulkUpdateWithHistory updates rows and records '~' per row with context", async () => {
    const result = await withHistoryContext({ userId: 'admin', changeReason: 'bulk rename' }, () =>
      bulkUpdateWithHistory(ds.getRepository(Post), { title: 'a' }, { title: 'a2' }),
    );
    expect(result.affected).toBe(2);
    const rows = (await ds.getRepository('PostHistory').find()) as any[];
    const bulk = rows.filter((r) => r.history_change_reason === 'bulk rename');
    expect(bulk).toHaveLength(2);
    expect(bulk.every((r) => r.history_type === '~' && r.title === 'a2' && r.history_user_id === 'admin')).toBe(true);
  });

  it('bulkUpdateWithHistory with no matches is a no-op', async () => {
    const before = ((await ds.getRepository('PostHistory').find()) as any[]).length;
    const result = await bulkUpdateWithHistory(ds.getRepository(Post), { title: 'missing' }, { title: 'x' });
    expect(result.affected).toBe(0);
    expect(((await ds.getRepository('PostHistory').find()) as any[]).length).toBe(before);
  });

  it("bulkDeleteWithHistory deletes rows and records '-' snapshots", async () => {
    const result = await bulkDeleteWithHistory(ds.getRepository(Post), { title: 'b' });
    expect(result.affected).toBe(1);
    expect(await ds.getRepository(Post).countBy({ title: 'b' })).toBe(0);
    const rows = (await ds.getRepository('PostHistory').find()) as any[];
    const deleted = rows.filter((r) => r.history_type === '-');
    expect(deleted).toHaveLength(1);
    expect(deleted[0].title).toBe('b');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F typeorm-entity-history vitest run test/bulk.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/bulk/bulk-helpers.ts`:

```typescript
import { FindOptionsWhere, In, ObjectLiteral, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { getHistorizedEntry } from '../metadata/registry';
import { recordHistoryRow } from '../subscriber/history-subscriber';

const ERR = '[typeorm-entity-history]';

function assertHistorized(repo: Repository<any>): void {
  if (!getHistorizedEntry(repo.metadata.target as Function))
    throw new Error(`${ERR} ${repo.metadata.name} is not @Historized.`);
}

export async function bulkUpdateWithHistory<T extends ObjectLiteral>(
  repo: Repository<T>,
  criteria: FindOptionsWhere<T>,
  patch: QueryDeepPartialEntity<T>,
): Promise<{ affected: number }> {
  assertHistorized(repo);
  const pkProp = repo.metadata.primaryColumns[0].propertyName;
  return repo.manager.transaction(async (em) => {
    const matched = await em.find(repo.target, { where: criteria });
    if (matched.length === 0) return { affected: 0 };
    const ids = matched.map((m) => (m as any)[pkProp]);
    await em.update(repo.target, { [pkProp]: In(ids) } as any, patch);
    const updated = await em.find(repo.target, { where: { [pkProp]: In(ids) } as any });
    for (const entity of updated) {
      await recordHistoryRow('~', repo.metadata, entity, em, true);
    }
    return { affected: updated.length };
  });
}

export async function bulkDeleteWithHistory<T extends ObjectLiteral>(
  repo: Repository<T>,
  criteria: FindOptionsWhere<T>,
): Promise<{ affected: number }> {
  assertHistorized(repo);
  const pkProp = repo.metadata.primaryColumns[0].propertyName;
  return repo.manager.transaction(async (em) => {
    const matched = await em.find(repo.target, { where: criteria });
    if (matched.length === 0) return { affected: 0 };
    const ids = matched.map((m) => (m as any)[pkProp]);
    await em.delete(repo.target, { [pkProp]: In(ids) } as any);
    for (const entity of matched) {
      await recordHistoryRow('-', repo.metadata, entity, em, false);
    }
    return { affected: matched.length };
  });
}
```

Add to `src/index.ts`:

```typescript
export { bulkDeleteWithHistory, bulkUpdateWithHistory } from './bulk/bulk-helpers';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F typeorm-entity-history vitest run test/bulk.test.ts`
Expected: PASS (3 tests). Watch out: `em.find` with relations unset returns entities without `author` loaded — `recordHistoryRow(..., reselect: true)` fills FK values via raw reselect.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): bulkUpdateWithHistory and bulkDeleteWithHistory"
```

---

### Task 10: `asOf` relations (one level)

**Files:**
- Modify: `packages/typeorm-history/src/repository/history-repository.ts`
- Test: `packages/typeorm-history/test/as-of-relations.test.ts`

**Interfaces:**
- Consumes: `asOf` from Task 7.
- Produces:
  - `interface AsOfOptions { relations?: string[] }` (exported)
  - `EntityHistoryQuery<T>.asOf(date: Date, opts?: AsOfOptions)` — for each named relation:
    - many-to-one / owning one-to-one: read FK value from the snapshot row, reconstruct the single related entity via its own history `forEntity(fk).asOf(date)`.
    - one-to-many: use the inverse relation's FK column on the child; reconstruct children via child table-wide `asOf(date, { [childFkDb]: pk })`.
    - Any other relation kind, or a relation whose target is not `@Historized` → throw with a fix-it message.
  - Nested relation names (containing `.`) throw `nested relations are not supported in v1`.

- [ ] **Step 1: Write failing test**

`test/as-of-relations.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { historyRepo } from '../src/repository/history-repository';
import { Author, Post, buildDataSource } from './support/blog-fixture';

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('asOf with relations', () => {
  let ds: DataSource;
  let authorId: number;
  let t1: Date;

  beforeAll(async () => {
    ds = buildDataSource();
    await ds.initialize();
    const author = await ds.manager.save(Author, { name: 'Ann' });
    authorId = author.id;
    await ds.manager.save(Post, { title: 'p1', author });
    await ds.manager.save(Post, { title: 'p2', author });
    await tick();
    t1 = new Date();
    await tick();
    await ds.manager.save(Author, { id: authorId, name: 'Ann Renamed' });
    const p2 = await ds.manager.findOneByOrFail(Post, { title: 'p2' });
    await ds.manager.remove(Post, p2);
  });
  afterAll(() => ds.destroy());

  it('reconstructs one-to-many children as of the date', async () => {
    // Note: Author has no `posts` inverse property in the fixture; this test uses Post.author (many-to-one) below,
    // and a dedicated Library/Book fixture pair defined in this file for one-to-many.
  });

  it('reconstructs many-to-one relation as of the date', async () => {
    const post = await historyRepo(ds, Post).forEntity(1).asOf(t1, { relations: ['author'] });
    expect(post!.author).toBeInstanceOf(Author);
    expect((post!.author as Author).name).toBe('Ann'); // name at t1, not 'Ann Renamed'
  });

  it('throws for nested relations', async () => {
    await expect(
      historyRepo(ds, Post).forEntity(1).asOf(t1, { relations: ['author.posts'] }),
    ).rejects.toThrow(/nested relations/);
  });

  it('throws for unknown relation names', async () => {
    await expect(historyRepo(ds, Post).forEntity(1).asOf(t1, { relations: ['nope'] })).rejects.toThrow(
      /unknown relation/,
    );
  });
});
```

One-to-many needs an inverse side. Add to `test/support/blog-fixture.ts` (new entities, exported, added to `buildDataSource` entities list):

```typescript
import { OneToMany } from 'typeorm';

@Entity()
@Historized()
export class Library {
  @PrimaryGeneratedColumn() id!: number;
  @Column() name!: string;
  @OneToMany(() => Book, (b) => b.library) books!: Book[];
}

@Entity()
@Historized()
export class Book {
  @PrimaryGeneratedColumn() id!: number;
  @Column() title!: string;
  @ManyToOne(() => Library, (l) => l.books) library!: Library;
}
```

Replace the placeholder first test with:

```typescript
  it('reconstructs one-to-many children as of the date', async () => {
    const { Library, Book } = await import('./support/blog-fixture');
    const lib = await ds.manager.save(Library, { name: 'lib' });
    await ds.manager.save(Book, { title: 'b1', library: lib });
    await ds.manager.save(Book, { title: 'b2', library: lib });
    await tick();
    const tBooks = new Date();
    await tick();
    const b2 = await ds.manager.findOneByOrFail(Book, { title: 'b2' });
    await ds.manager.remove(Book, b2);

    const at = await historyRepo(ds, Library).forEntity(lib.id).asOf(tBooks, { relations: ['books'] });
    expect(at!.books.map((b: any) => b.title).sort()).toEqual(['b1', 'b2']);
    const now = await historyRepo(ds, Library).forEntity(lib.id).asOf(new Date(), { relations: ['books'] });
    expect(now!.books.map((b: any) => b.title)).toEqual(['b1']);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F typeorm-entity-history vitest run test/as-of-relations.test.ts`
Expected: FAIL — `asOf` does not accept a second argument / relations unhandled.

- [ ] **Step 3: Implement**

In `src/repository/history-repository.ts` add:

```typescript
export interface AsOfOptions {
  relations?: string[];
}
```

Change `EntityHistoryQuery.asOf` signature to `asOf(date: Date, opts: AsOfOptions = {})`. After reconstructing `entity` (before returning), resolve relations. Also change it to keep the raw row in scope:

```typescript
  async asOf(date: Date, opts: AsOfOptions = {}): Promise<T | null> {
    const rows = await this.repo.histRepo.find({
      where: { [this.repo.entry.pkDbName!]: this.pk, [META.date]: LessThanOrEqual(date) } as any,
      order: { [META.id]: 'DESC' } as any,
      take: 1,
    });
    if (rows.length === 0 || rows[0][META.type] === '-') return null;
    const entity = this.repo.toEntity(rows[0]);
    for (const name of opts.relations ?? []) {
      await this.attachRelationAsOf(entity, rows[0], name, date);
    }
    return entity;
  }

  private async attachRelationAsOf(entity: T, raw: Record<string, any>, name: string, date: Date): Promise<void> {
    const ERR = '[typeorm-entity-history]';
    if (name.includes('.')) throw new Error(`${ERR} nested relations are not supported in v1: '${name}'.`);
    const rel = this.repo.sourceMeta.relations.find((r) => r.propertyName === name);
    if (!rel) throw new Error(`${ERR} unknown relation '${name}' on ${this.repo.target.name}.`);
    const relatedTarget = rel.inverseEntityMetadata.target as new () => any;
    let relatedRepo: HistoryRepository<any>;
    try {
      relatedRepo = new HistoryRepository(this.repo.ds, relatedTarget);
    } catch {
      throw new Error(
        `${ERR} relation '${name}' targets ${rel.inverseEntityMetadata.name}, which is not @Historized. ` +
          `Add @Historized() to it to reconstruct this relation.`,
      );
    }
    if (rel.isManyToOne || (rel.isOneToOne && rel.isOwning)) {
      const fkDb = rel.joinColumns[0].databaseName;
      const fk = raw[fkDb];
      (entity as any)[name] = fk == null ? null : await relatedRepo.forEntity(fk).asOf(date);
    } else if (rel.isOneToMany) {
      const childFkDb = rel.inverseRelation!.joinColumns[0].databaseName;
      (entity as any)[name] = await relatedRepo.asOf(date, { [childFkDb]: this.pk });
    } else {
      throw new Error(`${ERR} relation kind of '${name}' is not supported by asOf in v1 (many-to-many: see docs).`);
    }
  }
```

Export `AsOfOptions` from `src/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F typeorm-entity-history vitest run test/as-of-relations.test.ts`
Expected: PASS (4 tests). Run full core suite: `pnpm -F typeorm-entity-history test`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): one-level relation reconstruction in asOf"
```

---

### Task 11: NestJS wrapper package

**Files:**
- Create: `packages/nestjs-typeorm-history/package.json`, `packages/nestjs-typeorm-history/tsconfig.json`, `packages/nestjs-typeorm-history/vitest.config.ts`
- Create: `packages/nestjs-typeorm-history/src/index.ts`, `packages/nestjs-typeorm-history/src/history.module.ts`, `packages/nestjs-typeorm-history/src/history-context.interceptor.ts`, `packages/nestjs-typeorm-history/src/tokens.ts`
- Test: `packages/nestjs-typeorm-history/test/history.module.test.ts`

**Interfaces:**
- Consumes: `withHistoryContext`, `historyRepo`, `HistoryRepository` from `typeorm-entity-history` (workspace dep).
- Produces:
  - `interface HistoryModuleOptions { userResolver?: (ctx: ExecutionContext) => string | number | null | undefined }`
  - `HistoryModule.forRoot(options?: HistoryModuleOptions): DynamicModule` — global; binds `HistoryContextInterceptor` as `APP_INTERCEPTOR`.
  - `HistoryModule.forFeature(entities: Array<new () => any>): DynamicModule` — provides one `HistoryRepository` per entity.
  - `getHistoryRepositoryToken(entity: Function): string` (`HISTORY_REPOSITORY_<ClassName>`)
  - `InjectHistoryRepository(entity: Function): ParameterDecorator`
  - `HISTORY_MODULE_OPTIONS` injection token.

- [ ] **Step 1: Package skeleton**

`packages/nestjs-typeorm-history/package.json`:

```json
{
  "name": "nestjs-typeorm-history",
  "version": "0.1.0",
  "description": "NestJS integration for typeorm-entity-history",
  "license": "MIT",
  "main": "dist/index.js",
  "module": "dist/index.mjs",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "engines": { "node": ">=18" },
  "scripts": {
    "build": "tsup src/index.ts --dts --format cjs,esm",
    "test": "vitest run"
  },
  "dependencies": { "typeorm-entity-history": "workspace:*" },
  "peerDependencies": {
    "@nestjs/common": ">=10",
    "@nestjs/core": ">=10",
    "@nestjs/typeorm": ">=10",
    "rxjs": ">=7",
    "typeorm": ">=0.3.20"
  },
  "devDependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "@nestjs/testing": "^11.0.0",
    "@nestjs/typeorm": "^11.0.0",
    "@swc/core": "^1.7.0",
    "better-sqlite3": "^11.0.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.0",
    "supertest": "^7.0.0",
    "tsup": "^8.0.0",
    "typeorm": "^0.3.20",
    "typescript": "^5.5.0",
    "unplugin-swc": "^1.5.0",
    "vitest": "^2.0.0"
  }
}
```

`tsconfig.json` and `vitest.config.ts`: identical to the core package's (Task 1 Step 2). Run `pnpm install`.

- [ ] **Step 2: Write failing test**

`test/history.module.test.ts`:

```typescript
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Controller, Get, INestApplication, Module, Query } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import request from 'supertest';
import { Column, DataSource, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { Historized, historyEntities, HistorySubscriber } from 'typeorm-entity-history';
import { HistoryModule } from '../src/history.module';
import { InjectHistoryRepository } from '../src/tokens';
import type { HistoryRepository } from 'typeorm-entity-history';

@Entity()
@Historized()
class Note {
  @PrimaryGeneratedColumn() id!: number;
  @Column() body!: string;
}

@Controller('notes')
class NotesController {
  constructor(
    private readonly ds: DataSource,
    @InjectHistoryRepository(Note) private readonly noteHistory: HistoryRepository<Note>,
  ) {}

  @Get('create')
  async create(@Query('body') body: string) {
    const note = await this.ds.manager.save(Note, { body });
    return { id: note.id };
  }

  @Get('history')
  async history(@Query('id') id: string) {
    const records = await this.noteHistory.forEntity(Number(id)).all();
    return records.map((r) => ({ type: r.historyType, user: r.historyUserId }));
  }
}

describe('HistoryModule', () => {
  let app: INestApplication;

  beforeAll(async () => {
    @Module({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [Note, ...historyEntities()],
          subscribers: [HistorySubscriber],
          synchronize: true,
        }),
        HistoryModule.forRoot({
          userResolver: (ctx) => ctx.switchToHttp().getRequest().headers['x-user-id'] ?? null,
        }),
        HistoryModule.forFeature([Note]),
      ],
      controllers: [NotesController],
    })
    class AppModule {}

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());

  it('attributes writes to the resolved user', async () => {
    const { body } = await request(app.getHttpServer())
      .get('/notes/create?body=hi')
      .set('x-user-id', 'rider-1')
      .expect(200);
    const res = await request(app.getHttpServer()).get(`/notes/history?id=${body.id}`).expect(200);
    expect(res.body).toEqual([{ type: '+', user: 'rider-1' }]);
  });

  it('writes null user when the resolver returns nothing', async () => {
    const { body } = await request(app.getHttpServer()).get('/notes/create?body=anon').expect(200);
    const res = await request(app.getHttpServer()).get(`/notes/history?id=${body.id}`).expect(200);
    expect(res.body).toEqual([{ type: '+', user: null }]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm -F nestjs-typeorm-history vitest run test/history.module.test.ts`
Expected: FAIL — `../src/history.module` not found.

- [ ] **Step 4: Implement**

`src/tokens.ts`:

```typescript
import { Inject } from '@nestjs/common';

export const HISTORY_MODULE_OPTIONS = Symbol('HISTORY_MODULE_OPTIONS');

export function getHistoryRepositoryToken(entity: Function): string {
  return `HISTORY_REPOSITORY_${entity.name}`;
}

export function InjectHistoryRepository(entity: Function): ParameterDecorator {
  return Inject(getHistoryRepositoryToken(entity));
}
```

`src/history-context.interceptor.ts`:

```typescript
import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor, Optional } from '@nestjs/common';
import { Observable } from 'rxjs';
import { withHistoryContext } from 'typeorm-entity-history';
import { HISTORY_MODULE_OPTIONS } from './tokens';
import type { HistoryModuleOptions } from './history.module';

@Injectable()
export class HistoryContextInterceptor implements NestInterceptor {
  constructor(
    @Optional() @Inject(HISTORY_MODULE_OPTIONS) private readonly options?: HistoryModuleOptions,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const userId = this.options?.userResolver?.(context) ?? null;
    return new Observable((subscriber) => {
      const sub = withHistoryContext({ userId }, () => next.handle().subscribe(subscriber));
      return () => sub.unsubscribe();
    });
  }
}
```

`src/history.module.ts`:

```typescript
import { DynamicModule, ExecutionContext, Module, Provider } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { historyRepo } from 'typeorm-entity-history';
import { HistoryContextInterceptor } from './history-context.interceptor';
import { getHistoryRepositoryToken, HISTORY_MODULE_OPTIONS } from './tokens';

export interface HistoryModuleOptions {
  /** Extract the acting user's id from the execution context. Return null/undefined for anonymous. */
  userResolver?: (ctx: ExecutionContext) => string | number | null | undefined;
}

@Module({})
export class HistoryModule {
  static forRoot(options: HistoryModuleOptions = {}): DynamicModule {
    return {
      module: HistoryModule,
      global: true,
      providers: [
        { provide: HISTORY_MODULE_OPTIONS, useValue: options },
        { provide: APP_INTERCEPTOR, useClass: HistoryContextInterceptor },
      ],
      exports: [HISTORY_MODULE_OPTIONS],
    };
  }

  static forFeature(entities: Array<new (...args: any[]) => any>): DynamicModule {
    const providers: Provider[] = entities.map((entity) => ({
      provide: getHistoryRepositoryToken(entity),
      useFactory: (ds: DataSource) => historyRepo(ds, entity),
      inject: [getDataSourceToken()],
    }));
    return { module: HistoryModule, providers, exports: providers.map((p: any) => p.provide) };
  }
}
```

`src/index.ts`:

```typescript
export { HistoryModule, HistoryModuleOptions } from './history.module';
export { HistoryContextInterceptor } from './history-context.interceptor';
export { HISTORY_MODULE_OPTIONS, InjectHistoryRepository, getHistoryRepositoryToken } from './tokens';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -F nestjs-typeorm-history vitest run test/history.module.test.ts`
Expected: PASS (2 tests). Note: `historyRepo` in `forFeature` runs at DI resolution — after TypeORM init, so validation errors (missing subscriber etc.) surface at boot with the fix-it message. Verify by temporarily removing `subscribers: [HistorySubscriber]` from the test module: boot must fail with `HistorySubscriber is not registered`. Restore afterwards.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(nestjs): HistoryModule with request-scoped user attribution and DI repositories"
```

---

### Task 12: Postgres integration suite (Testcontainers)

**Files:**
- Create: `packages/typeorm-history/test/postgres.integration.test.ts`
- Modify: `packages/typeorm-history/package.json` (devDeps: `@testcontainers/postgresql`, `pg`; script `test:pg`)
- Modify: `packages/typeorm-history/vitest.config.ts` (exclude `*.integration.test.ts` from the default run)

**Interfaces:**
- Consumes: everything from Tasks 2–10.
- Produces: `pnpm -F typeorm-entity-history test:pg` — requires Docker; not part of `pnpm test`.

- [ ] **Step 1: Wire configs**

Add devDeps: `"@testcontainers/postgresql": "^10.13.0", "pg": "^8.12.0"`. Add script: `"test:pg": "vitest run test/postgres.integration.test.ts --testTimeout=120000"`. In `vitest.config.ts` add `test: { environment: 'node', exclude: [...configDefaults.exclude, '**/*.integration.test.ts'] }` (import `configDefaults` from `vitest/config`). Run `pnpm install`.

- [ ] **Step 2: Write the integration test**

`test/postgres.integration.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import { historyEntities } from '../src/metadata/history-entity-factory';
import { HistorySubscriber } from '../src/subscriber/history-subscriber';
import { historyRepo } from '../src/repository/history-repository';
import { withHistoryContext } from '../src/context/history-context';
import { Author, Post } from './support/blog-fixture';

describe('postgres integration', () => {
  let container: StartedPostgreSqlContainer;
  let ds: DataSource;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    ds = new DataSource({
      type: 'postgres',
      url: container.getConnectionUri(),
      entities: [Author, Post, ...historyEntities({ dateColumnType: 'timestamptz' })],
      subscribers: [HistorySubscriber],
      synchronize: true,
    });
    await ds.initialize();
  }, 120_000);

  afterAll(async () => {
    await ds?.destroy();
    await container?.stop();
  });

  it('history_date is timestamptz and index exists', async () => {
    const [{ data_type }] = await ds.query(
      `SELECT data_type FROM information_schema.columns WHERE table_name = 'post_history' AND column_name = 'history_date'`,
    );
    expect(data_type).toBe('timestamp with time zone');
    const indexes = await ds.query(`SELECT indexdef FROM pg_indexes WHERE tablename = 'post_history'`);
    expect(indexes.some((i: any) => i.indexdef.includes('"id"') && i.indexdef.includes('"history_date"'))).toBe(true);
  });

  it('full lifecycle works on postgres', async () => {
    const author = await ds.manager.save(Author, { name: 'Ann' });
    const post = await withHistoryContext({ userId: 'u1' }, () =>
      ds.manager.save(Post, { title: 'v1', author }),
    );
    await ds.manager.save(Post, { id: post.id, title: 'v2' });
    const t = new Date();
    const records = await historyRepo(ds, Post).forEntity(post.id).all();
    expect(records.map((r) => r.historyType)).toEqual(['~', '+']);
    const at = await historyRepo(ds, Post).forEntity(post.id).asOf(t, { relations: ['author'] });
    expect(at!.title).toBe('v2');
    expect((at!.author as Author).name).toBe('Ann');
  });

  it('transaction rollback leaves no history', async () => {
    const count = async () => Number((await ds.query(`SELECT count(*) c FROM post_history`))[0].c);
    const before = await count();
    await expect(
      ds.transaction(async (em) => {
        await em.save(Post, { title: 'doomed' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await count()).toBe(before);
  });
});
```

- [ ] **Step 3: Run**

Run: `pnpm -F typeorm-entity-history test:pg` (requires Docker running).
Expected: PASS (3 tests). Also confirm `pnpm -F typeorm-entity-history test` still passes and does NOT run the integration file.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "test(core): postgres integration suite via testcontainers"
```

---

### Task 13: Builds, READMEs, root docs

**Files:**
- Create: `packages/typeorm-history/README.md`, `packages/nestjs-typeorm-history/README.md`, `README.md` (root), `LICENSE`
- Modify: none

**Interfaces:**
- Consumes: the final public APIs of both packages.
- Produces: publishable packages (`pnpm -r build` green), quickstart docs.

- [ ] **Step 1: Verify builds**

Run: `pnpm -r build`
Expected: both packages emit `dist/index.js`, `dist/index.mjs`, `dist/index.d.ts`. Fix any type errors surfaced by `--dts` before writing docs.

- [ ] **Step 2: Write docs**

`packages/typeorm-history/README.md` — sections: install (`npm i typeorm-entity-history`, peer typeorm >= 0.3.20), quickstart (the `@Historized` + `historyEntities()` + `HistorySubscriber` DataSource snippet from the spec), context (`withHistoryContext`, `setChangeReason`), query API (`all`, `asOf`, table-wide `asOf`, `diffAgainst`, `revertTo`), bulk helpers, relations behavior (ManyToOne automatic; OneToMany via historized child; ManyToMany via explicit join entity pattern with a code example), limitations (single-column PKs, default naming strategy, class-target relations, query-builder writes bypass history, subscriber failure aborts the transaction), migrations (`migration:generate` sees history tables automatically).

`packages/nestjs-typeorm-history/README.md` — install with peers, `HistoryModule.forRoot({ userResolver })` + `forFeature([User])` + `@InjectHistoryRepository(User)` example, note on non-HTTP contexts (`withHistoryContext` for cron/queues).

Root `README.md` — one paragraph pitch ("django-simple-history for TypeORM/NestJS"), table linking both packages, development commands (`pnpm install`, `pnpm test`, `pnpm -F typeorm-entity-history test:pg`).

`LICENSE` — MIT, copyright 2026.

All code snippets in the READMEs must be copied from passing tests, not written from memory.

- [ ] **Step 3: Full verification**

Run: `pnpm test && pnpm -r build`
Expected: all suites green, builds clean.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "docs: READMEs, license, and build verification for v1"
```

---

## Spec coverage check

- Shadow table per entity, meta columns, composite index → Task 3
- `@Historized` options (exclude/tableName/trackSoftDelete) → Tasks 2, 3, 5
- Write path in-transaction, `+/~/-`, partial-save snapshots, soft delete/recover, rollback safety → Task 5
- Missing context ⇒ null attribution, never throws → Tasks 4, 5
- Setup misconfiguration ⇒ loud fix-it errors → Tasks 5 (schema missing), 6 (repo validation), 10 (non-historized relation), 11 (boot-time surfacing)
- Query API: `all`, entity/table `asOf`, `diffAgainst`, `revertTo` (`~`/`+` cases) → Tasks 6, 7, 8
- Bulk helpers → Task 9
- Relations: ManyToOne auto, OneToMany reconstruction, nested/many-to-many rejected with guidance → Tasks 3, 10
- NestJS module, interceptor, DI tokens → Task 11
- Postgres timestamptz + integration → Task 12
- Docs incl. M2M join-entity pattern, limitations → Task 13
- MikroORM future-proofing → packaging split only (per spec, no abstraction layer in v1)
