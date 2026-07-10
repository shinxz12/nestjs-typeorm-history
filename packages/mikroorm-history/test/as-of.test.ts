import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { historyRepo } from '../src/history-repository';
import { Author, Post, initOrm } from './support/blog-fixture';

let orm: Awaited<ReturnType<typeof initOrm>>;
beforeAll(async () => {
  orm = await initOrm();
});
afterAll(async () => {
  await orm.close();
});

describe('asOf', () => {
  it('reconstructs the entity state at a past date', async () => {
    const em = orm.em.fork();
    const a = em.create(Author, { name: 'v1' });
    await em.flush();
    const between = new Date();
    await new Promise((r) => setTimeout(r, 5));
    a.name = 'v2';
    await em.flush();

    const then = await historyRepo(em, Author).forEntity(a.id).asOf(between);
    expect(then?.name).toBe('v1');
    const now = await historyRepo(em, Author).forEntity(a.id).asOf(new Date());
    expect(now?.name).toBe('v2');
  });

  it('returns null after delete; excludes deleted from table-wide asOf', async () => {
    const em = orm.em.fork();
    const a = em.create(Author, { name: 'gone' });
    await em.flush();
    em.remove(a);
    await em.flush();
    expect(await historyRepo(em, Author).forEntity(a.id).asOf(new Date())).toBeNull();
    const all = await historyRepo(em, Author).asOf(new Date());
    expect(all.find((x) => x.name === 'gone')).toBeUndefined();
  });

  it('attaches many-to-one relations as of the same date', async () => {
    const em = orm.em.fork();
    const a = em.create(Author, { name: 'old-name' });
    const p = em.create(Post, { title: 'rel', author: a });
    await em.flush();
    const between = new Date();
    await new Promise((r) => setTimeout(r, 5));
    a.name = 'new-name';
    await em.flush();

    const then = await historyRepo(em, Post).forEntity(p.id).asOf(between, { relations: ['author'] });
    expect((then?.author as any)?.name).toBe('old-name');
  });
});
