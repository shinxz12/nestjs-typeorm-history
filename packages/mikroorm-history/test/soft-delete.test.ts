import 'reflect-metadata';
import { META } from '@entity-history/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Post, initOrm } from './support/blog-fixture';

let orm: Awaited<ReturnType<typeof initOrm>>;
beforeAll(async () => {
  orm = await initOrm();
});
afterAll(async () => {
  await orm.close();
});

describe('softDeleteField mapping', () => {
  it("records 'delete' when the field is set and 'update' when cleared", async () => {
    const em = orm.em.fork();
    const p = em.create(Post, { title: 'soft' });
    await em.flush();
    p.deletedAt = new Date();
    await em.flush(); // soft delete
    p.deletedAt = null;
    await em.flush(); // recover

    const rows = await (em as any)
      .createQueryBuilder('post_history')
      .select('*')
      .where({ id: p.id })
      .execute('all', false);
    expect(rows.map((r: any) => r[META.type])).toEqual(['create', 'delete', 'update']);
  });
});
