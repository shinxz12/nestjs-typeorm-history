import 'reflect-metadata';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Entity, PrimaryKey, Property, ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { MikroORM } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Historized, historyEntities, HistorySubscriber, historyRepo, withHistoryContext } from '../src';
import { bulkSoftDeleteWithHistory } from '../src/bulk-helpers';
import { Author, Post } from './support/blog-fixture';

@Historized()
@Entity()
class CamelCased {
  @PrimaryKey() id!: number;
  @Property({ fieldName: 'camelLabel' }) camelLabel!: string;
}

describe('postgres integration (mikroorm)', () => {
  let container: StartedPostgreSqlContainer;
  let orm: MikroORM;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    orm = await MikroORM.init({
      clientUrl: container.getConnectionUri(),
      entities: [Author, Post, CamelCased, ...historyEntities({ dateColumnType: 'timestamptz' })],
      subscribers: [new HistorySubscriber()],
      metadataProvider: ReflectMetadataProvider,
      allowGlobalContext: true,
    });
    await orm.schema.create();
  }, 120_000);

  afterAll(async () => {
    await orm?.close();
    await container?.stop();
  });

  it('history_date is timestamptz and index exists', async () => {
    const conn = orm.em.getConnection();
    const [{ data_type }] = await conn.execute(
      `SELECT data_type FROM information_schema.columns WHERE table_name = 'post_history' AND column_name = 'history_date'`,
    );
    expect(data_type).toBe('timestamp with time zone');
    const indexes = await conn.execute(`SELECT indexdef FROM pg_indexes WHERE tablename = 'post_history'`);
    expect(indexes.some((i: any) => i.indexdef.includes('id, history_date'))).toBe(true);
  });

  it('full lifecycle works on postgres', async () => {
    const em = orm.em.fork();
    const author = em.create(Author, { name: 'Ann' });
    const post = await withHistoryContext({ userId: 'u1' }, async () => {
      const p = em.create(Post, { title: 'v1', author });
      await em.flush();
      return p;
    });
    post.title = 'v2';
    await em.flush();
    const t = new Date();
    const records = await historyRepo(em, Post).forEntity(post.id).all();
    expect(records.map((r) => r.historyType)).toEqual(['update', 'create']);
    expect(records[1].historyUserId).toBe('u1');
    const at = await historyRepo(em, Post).forEntity(post.id).asOf(t, { relations: ['author'] });
    expect(at!.title).toBe('v2');
    expect((at!.author as Author).name).toBe('Ann');
  });

  it('quotes camelCase columns in raw queries', async () => {
    const em = orm.em.fork();
    const r = em.create(CamelCased, { camelLabel: 'x' });
    await em.flush();
    r.camelLabel = 'y';
    await em.flush();
    em.remove(r);
    await em.flush();
    const recs = await historyRepo(em, CamelCased).forEntity(r.id).all();
    expect(recs.map((x) => x.historyType)).toEqual(['delete', 'update', 'create']);
    expect((recs[0].snapshot as any).camelLabel).toBe('y');
  });

  it('bulkSoftDeleteWithHistory records a delete row on postgres', async () => {
    const em = orm.em.fork();
    const saved = em.create(Post, { title: 'pg-soft' });
    await em.flush();
    const { affected } = await bulkSoftDeleteWithHistory(em, Post, { title: 'pg-soft' });
    expect(affected).toBe(1);
    const [newest] = await historyRepo(em, Post).forEntity(saved.id).all({ take: 1 });
    expect(newest.historyType).toBe('delete');
  });

  it('transaction rollback leaves no history', async () => {
    const em = orm.em.fork();
    const conn = orm.em.getConnection();
    const count = async () => Number((await conn.execute(`SELECT count(*) c FROM post_history`))[0].c);
    const before = await count();
    await expect(
      em.transactional(async (tem) => {
        tem.create(Post, { title: 'doomed' });
        await tem.flush();
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await count()).toBe(before);
  });
});
