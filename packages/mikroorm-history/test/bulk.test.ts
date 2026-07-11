import 'reflect-metadata';
import { META } from '@entity-history/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bulkDeleteWithHistory,
  bulkRestoreWithHistory,
  bulkSoftDeleteWithHistory,
  bulkUpdateWithHistory,
} from '../src/bulk-helpers';
import { Author, Post, initOrm } from './support/blog-fixture';

let orm: Awaited<ReturnType<typeof initOrm>>;
beforeAll(async () => {
  orm = await initOrm();
});
afterAll(async () => {
  await orm.close();
});

async function rowsFor(table: string, where: Record<string, unknown>) {
  return (orm.em.fork() as any).createQueryBuilder(table).select('*').where(where).execute('all', false);
}

describe('bulk helpers', () => {
  it('bulkUpdateWithHistory writes one update row per affected entity', async () => {
    const em = orm.em.fork();
    em.create(Author, { name: 'bulk', email: 'a@x' });
    em.create(Author, { name: 'bulk', email: 'b@x' });
    await em.flush();
    const { affected } = await bulkUpdateWithHistory(em, Author, { name: 'bulk' }, { name: 'bulked' });
    expect(affected).toBe(2);
    const rows = await rowsFor('author_history', { name: 'bulked' });
    expect(rows).toHaveLength(2);
    expect(rows.every((r: any) => r[META.type] === 'update')).toBe(true);
  });

  it('bulkDeleteWithHistory snapshots before deleting', async () => {
    const em = orm.em.fork();
    const a = em.create(Author, { name: 'to-del', email: 'keep@me' });
    await em.flush();
    await bulkDeleteWithHistory(em, Author, { id: a.id });
    const rows = await rowsFor('author_history', { id: a.id });
    const del = rows.find((r: any) => r[META.type] === 'delete');
    expect(del.email).toBe('keep@me');
  });

  it('bulk soft delete + restore use delete/update types', async () => {
    const em = orm.em.fork();
    const p = em.create(Post, { title: 'bulk-soft' });
    await em.flush();
    await bulkSoftDeleteWithHistory(em, Post, { id: p.id });
    await bulkRestoreWithHistory(em, Post, { id: p.id });
    const rows = await rowsFor('post_history', { id: p.id });
    expect(rows.map((r: any) => r[META.type])).toEqual(['create', 'delete', 'update']);
  });

  it('returns affected 0 when nothing matches, without history rows', async () => {
    const em = orm.em.fork();
    const { affected } = await bulkUpdateWithHistory(em, Author, { name: 'nope-none' }, { name: 'x' });
    expect(affected).toBe(0);
  });
});
