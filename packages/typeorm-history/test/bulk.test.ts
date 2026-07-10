import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { withHistoryContext } from '../src/context/history-context';
import {
  bulkDeleteWithHistory,
  bulkRestoreWithHistory,
  bulkSoftDeleteWithHistory,
  bulkUpdateWithHistory,
} from '../src/bulk/bulk-helpers';
import { Post, buildDataSource } from './support/blog-fixture';

describe('bulk helpers', () => {
  let ds: DataSource;
  beforeAll(async () => {
    ds = buildDataSource();
    await ds.initialize();
    await ds.manager.save(Post, [{ title: 'a' }, { title: 'a' }, { title: 'b' }]);
  });
  afterAll(() => ds.destroy());

  it("bulkUpdateWithHistory updates rows and records 'update' per row with context", async () => {
    const result = await withHistoryContext({ userId: 'admin', changeReason: 'bulk rename' }, () =>
      bulkUpdateWithHistory(ds.getRepository(Post), { title: 'a' }, { title: 'a2' }),
    );
    expect(result.affected).toBe(2);
    const rows = (await ds.getRepository('post_history').find()) as any[];
    const bulk = rows.filter((r) => r.history_change_reason === 'bulk rename');
    expect(bulk).toHaveLength(2);
    expect(bulk.every((r) => r.history_type === 'update' && r.title === 'a2' && r.history_user_id === 'admin')).toBe(true);
  });

  it('bulkUpdateWithHistory with no matches is a no-op', async () => {
    const before = ((await ds.getRepository('post_history').find()) as any[]).length;
    const result = await bulkUpdateWithHistory(ds.getRepository(Post), { title: 'missing' }, { title: 'x' });
    expect(result.affected).toBe(0);
    expect(((await ds.getRepository('post_history').find()) as any[]).length).toBe(before);
  });

  it("bulkDeleteWithHistory deletes rows and records 'delete' snapshots", async () => {
    const result = await bulkDeleteWithHistory(ds.getRepository(Post), { title: 'b' });
    expect(result.affected).toBe(1);
    expect(await ds.getRepository(Post).countBy({ title: 'b' })).toBe(0);
    const rows = (await ds.getRepository('post_history').find()) as any[];
    const deleted = rows.filter((r) => r.history_type === 'delete');
    expect(deleted).toHaveLength(1);
    expect(deleted[0].title).toBe('b');
  });

  it("bulkSoftDeleteWithHistory soft-deletes rows and records 'delete' snapshots", async () => {
    const [saved] = await ds.manager.save(Post, [{ title: 'soft' }]);
    const result = await bulkSoftDeleteWithHistory(ds.getRepository(Post), { title: 'soft' });
    expect(result.affected).toBe(1);
    const post = await ds.getRepository(Post).findOne({ where: { title: 'soft' }, withDeleted: true });
    expect(post!.deletedAt).not.toBeNull();
    const rows = (await ds.getRepository('post_history').find()) as any[];
    const mine = rows.filter((r) => r.id === saved.id);
    expect(mine.at(-1)?.history_type).toBe('delete');
  });

  it("bulkRestoreWithHistory restores rows and records 'update'", async () => {
    const [saved] = await ds.manager.save(Post, [{ title: 'resurrect' }]);
    await bulkSoftDeleteWithHistory(ds.getRepository(Post), { title: 'resurrect' });
    const result = await bulkRestoreWithHistory(ds.getRepository(Post), { title: 'resurrect' });
    expect(result.affected).toBe(1);
    const post = await ds.getRepository(Post).findOneByOrFail({ title: 'resurrect' });
    expect(post.deletedAt).toBeNull();
    const rows = (await ds.getRepository('post_history').find()) as any[];
    const mine = rows.filter((r) => r.id === saved.id);
    expect(mine.at(-1)?.history_type).toBe('update');
  });
});
