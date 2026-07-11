import 'reflect-metadata';
import { META, withHistoryContext } from '@entity-history/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Author, Post, initOrm } from './support/blog-fixture';

let orm: Awaited<ReturnType<typeof initOrm>>;

beforeAll(async () => {
  orm = await initOrm();
});
afterAll(async () => {
  await orm.close();
});

async function historyRows(table: string, where: Record<string, unknown> = {}) {
  return (orm.em.fork() as any).createQueryBuilder(table).select('*').where(where).execute('all', false);
}

describe('HistorySubscriber', () => {
  it('writes create/update/delete rows with context attribution', async () => {
    const em = orm.em.fork();
    const a = await withHistoryContext({ userId: 'u1' }, async () => {
      const a = em.create(Author, { name: 'ada' });
      await em.flush();
      return a;
    });
    a.name = 'ada l.';
    await em.flush();
    em.remove(a);
    await em.flush();

    const rows = await historyRows('author_history', { id: a.id });
    expect(rows.map((r: any) => r[META.type])).toEqual(['create', 'update', 'delete']);
    expect(rows[0][META.user]).toBe('u1');
    expect(rows[1][META.user]).toBeNull();
    expect(rows[2].name).toBe('ada l.');
  });

  it('stores FK columns for relations', async () => {
    const em = orm.em.fork();
    const a = em.create(Author, { name: 'rel' });
    const p = em.create(Post, { title: 't', author: a });
    await em.flush();
    const rows = await historyRows('post_history', { id: p.id });
    expect(rows[0].author_id).toBe(a.id);
  });
});
