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
  @Column({ type: 'varchar', nullable: true }) draftNotes!: string | null;
  @ManyToOne(() => Author) author!: Author;
}

@Entity()
@Historized()
class PostTagLink {
  @PrimaryGeneratedColumn() id!: number;
  @ManyToOne(() => Post) post!: Post;
}

describe('historyEntities', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Author, Post, PostTagLink, ...historyEntities()],
      synchronize: true,
    });
    await ds.initialize();
  });
  afterAll(() => ds.destroy());

  it('creates a <table>_history table per entity', () => {
    const meta = ds.getMetadata('post_history');
    expect(meta.tableName).toBe('post_history');
    expect(ds.getMetadata('author_history').tableName).toBe('author_history');
  });

  it('snake_cases multi-word class names to match TypeORM default table naming', () => {
    // The real source table (TypeORM's own default naming strategy) is
    // 'post_tag_link'; the history table must follow the same convention,
    // not a naive lowerFirst('PostTagLink') = 'postTagLink'.
    expect(ds.getMetadata(PostTagLink).tableName).toBe('post_tag_link');
    expect(ds.getMetadata('post_tag_link_history').tableName).toBe('post_tag_link_history');
  });

  it('copies source columns, demotes pk, adds FK id column, drops excluded', () => {
    const meta = ds.getMetadata('post_history');
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
    const meta = ds.getMetadata('post_history');
    const idx = meta.indices.find(
      (i) => i.columns.length === 2 && i.columns.some((c) => c.databaseName === 'id') && i.columns.some((c) => c.databaseName === 'history_date'),
    );
    expect(idx).toBeDefined();
  });

  it('adds an index per relation FK column (one-to-many reconstruction filters on it)', () => {
    const meta = ds.getMetadata('post_history');
    const idx = meta.indices.find((i) => i.columns.length === 1 && i.columns[0].databaseName === 'authorId');
    expect(idx).toBeDefined();
  });

  it('fills registry entry bookkeeping', () => {
    const entry = getHistorizedEntry(Post)!;
    expect(entry.schema).toBeDefined();
    expect(entry.pkDbName).toBe('id');
    expect([...entry.trackedDbNames!]).toEqual(expect.arrayContaining(['id', 'title', 'authorId']));
    expect([...entry.trackedDbNames!]).not.toContain('draftNotes');
  });
});

describe('historyEntities column options', () => {
  it('copies the array flag to the history column', async () => {
    const { clearHistorizedRegistry } = await import('../src/metadata/registry');
    @Entity()
    @Historized()
    class ArrayHolder {
      @PrimaryGeneratedColumn() id!: number;
      @Column('text', { array: true }) tags!: string[];
    }
    const schemas = historyEntities();
    const schema = schemas.find((s) => s.options.tableName === 'array_holder_history')!;
    expect((schema.options.columns as any).tags.array).toBe(true);
    clearHistorizedRegistry();
  });

  it("derives FK column names exactly like TypeORM's default naming strategy", async () => {
    const { PrimaryColumn } = await import('typeorm');
    const { clearHistorizedRegistry } = await import('../src/metadata/registry');
    @Entity()
    @Historized()
    class OddPkParent {
      @PrimaryColumn() uuid_key!: string;
    }
    @Entity()
    @Historized()
    class OddPkChild {
      @PrimaryGeneratedColumn() id!: number;
      @ManyToOne(() => OddPkParent) owner!: OddPkParent;
    }
    const schemas = historyEntities();
    const child = schemas.find((s) => s.options.tableName === 'odd_pk_child_history')!;
    // TypeORM names the real FK column camelCase('owner_uuid_key') = 'ownerUuidKey'.
    expect(Object.keys(child.options.columns as object)).toContain('ownerUuidKey');
    clearHistorizedRegistry();
  });

  it('generates unique schema names for same-named classes in different modules', async () => {
    const { clearHistorizedRegistry } = await import('../src/metadata/registry');
    const make = (table: string) => {
      @Entity({ name: table })
      @Historized()
      class Category {
        @PrimaryGeneratedColumn() id!: number;
      }
      return Category;
    };
    make('blog_category');
    make('shop_category');
    const schemas = historyEntities();
    const names = schemas.map((s) => s.options.name);
    expect(new Set(names).size).toBe(names.length);
    clearHistorizedRegistry();
  });
});

describe('historyEntities error cases', () => {
  it('rejects composite primary keys', async () => {
    const { PrimaryColumn } = await import('typeorm');
    const { clearHistorizedRegistry } = await import('../src/metadata/registry');
    @Entity()
    @Historized()
    class Composite {
      @PrimaryColumn() a!: number;
      @PrimaryColumn() b!: number;
    }
    expect(() => historyEntities()).toThrowError(/composite primary keys/);
    clearHistorizedRegistry();
  });

  it('rejects a source column that collides with a history meta column', async () => {
    const { clearHistorizedRegistry } = await import('../src/metadata/registry');
    @Entity()
    @Historized()
    class MetaClash {
      @PrimaryGeneratedColumn() id!: number;
      @Column() history_type!: string;
    }
    expect(() => historyEntities()).toThrowError(/history_type/);
    clearHistorizedRegistry();
  });
});
