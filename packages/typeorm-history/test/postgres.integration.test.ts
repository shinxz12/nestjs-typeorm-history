import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import { historyEntities } from '../src/metadata/history-entity-factory';
import { HistorySubscriber } from '../src/subscriber/history-subscriber';
import { historyRepo } from '../src/repository/history-repository';
import { withHistoryContext } from '../src/context/history-context';
import { bulkSoftDeleteWithHistory } from '../src/bulk/bulk-helpers';
import { Author, Book, Library, Post, ReservedPk } from './support/blog-fixture';

describe('postgres integration', () => {
  let container: StartedPostgreSqlContainer;
  let ds: DataSource;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    ds = new DataSource({
      type: 'postgres',
      url: container.getConnectionUri(),
      entities: [Author, Post, Library, Book, ReservedPk, ...historyEntities({ dateColumnType: 'timestamptz' })],
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
    expect(indexes.some((i: any) => i.indexdef.includes('(id, history_date)'))).toBe(true);
  });

  it('full lifecycle works on postgres', async () => {
    const author = await ds.manager.save(Author, { name: 'Ann' });
    const post = await withHistoryContext({ userId: 'u1' }, () =>
      ds.manager.save(Post, { title: 'v1', author }),
    );
    await ds.manager.save(Post, { id: post.id, title: 'v2' });
    const t = new Date();
    const records = await historyRepo(ds, Post).forEntity(post.id).all();
    expect(records.map((r) => r.historyType)).toEqual(['update', 'create']);
    const at = await historyRepo(ds, Post).forEntity(post.id).asOf(t, { relations: ['author'] });
    expect(at!.title).toBe('v2');
    expect((at!.author as Author).name).toBe('Ann');
  });

  it('does not attribute a re-parented child to its old parent (subquery path)', async () => {
    const libA = await ds.manager.save(Library, { name: 'A' });
    const libB = await ds.manager.save(Library, { name: 'B' });
    const moved = await ds.manager.save(Book, { title: 'moved', library: libA });
    await ds.manager.save(Book, { id: moved.id, title: 'moved', library: libB });
    const t = new Date();
    const atA = await historyRepo(ds, Library).forEntity(libA.id).asOf(t, { relations: ['books'] });
    const atB = await historyRepo(ds, Library).forEntity(libB.id).asOf(t, { relations: ['books'] });
    expect(atA!.books).toEqual([]);
    expect(atB!.books.map((b: any) => b.title)).toEqual(['moved']);
  });

  it('quotes reserved-word pk columns in raw queries', async () => {
    const r = await ds.manager.save(ReservedPk, { label: 'x' });
    const loaded = await ds.manager.findOneByOrFail(ReservedPk, { order: r.order });
    await ds.manager.remove(ReservedPk, loaded);
    const recs = await historyRepo(ds, ReservedPk).forEntity(r.order).all();
    expect(recs.map((x) => x.historyType)).toEqual(['delete', 'create']);
  });

  it('bulkSoftDeleteWithHistory records a - row on postgres', async () => {
    const saved = await ds.manager.save(Post, { title: 'pg-soft' });
    const { affected } = await bulkSoftDeleteWithHistory(ds.getRepository(Post), { title: 'pg-soft' });
    expect(affected).toBe(1);
    const [newest] = await historyRepo(ds, Post).forEntity(saved.id).all({ take: 1 });
    expect(newest.historyType).toBe('delete');
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
