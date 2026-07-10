import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { historyRepo } from '../src/history-repository';
import { Author, initOrm } from './support/blog-fixture';

let orm: Awaited<ReturnType<typeof initOrm>>;
beforeAll(async () => {
  orm = await initOrm();
});
afterAll(async () => {
  await orm.close();
});

describe('revertTo', () => {
  it('restores an old snapshot and records it as an update with reason "reverted"', async () => {
    const em = orm.em.fork();
    const a = em.create(Author, { name: 'first' });
    await em.flush();
    a.name = 'second';
    await em.flush();

    const repo = historyRepo(em, Author);
    const all = await repo.forEntity(a.id).all();
    const oldest = all[all.length - 1];
    const reverted = await repo.forEntity(a.id).revertTo(oldest.historyId);
    expect(reverted.name).toBe('first');

    const recs = await repo.forEntity(a.id).all();
    expect(recs[0].historyType).toBe('update');
    expect(recs[0].historyChangeReason).toBe('reverted');
  });

  it('rejects a history row belonging to a different entity', async () => {
    const em = orm.em.fork();
    const a = em.create(Author, { name: 'x' });
    const b = em.create(Author, { name: 'y' });
    await em.flush();
    const repo = historyRepo(em, Author);
    const bRow = (await repo.forEntity(b.id).all())[0];
    await expect(repo.forEntity(a.id).revertTo(bRow.historyId)).rejects.toThrow('different entity');
  });
});
