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

  it("restores an old version and records 'update' with reason 'reverted'", async () => {
    const repo = historyRepo(ds, Post);
    const records = await repo.forEntity(postId).all();
    const v1 = records.find((r) => r.snapshot.title === 'v1')!;
    const restored = await repo.forEntity(postId).revertTo(v1.historyId);
    expect(restored.title).toBe('v1');
    expect((await ds.manager.findOneByOrFail(Post, { id: postId })).title).toBe('v1');
    const [newest] = await repo.forEntity(postId).all();
    expect(newest.historyType).toBe('update');
    expect(newest.historyChangeReason).toBe('reverted');
  });

  it("re-inserts a deleted entity and records 'create'", async () => {
    const repo = historyRepo(ds, Post);
    const loaded = await ds.manager.findOneByOrFail(Post, { id: postId });
    await ds.manager.remove(Post, loaded);
    const records = await repo.forEntity(postId).all();
    const lastAlive = records.find((r) => r.historyType !== 'delete')!;
    await repo.forEntity(postId).revertTo(lastAlive.historyId);
    expect(await ds.manager.findOneBy(Post, { id: postId })).not.toBeNull();
    const [newest] = await repo.forEntity(postId).all();
    expect(newest.historyType).toBe('create');
    expect(newest.historyChangeReason).toBe('reverted');
  });

  it('accepts a string pk for a numeric column (route params, bigint drivers)', async () => {
    const repo = historyRepo(ds, Post);
    const records = await repo.forEntity(postId).all();
    const target = records.find((r) => r.historyType !== 'delete')!;
    const restored = await repo.forEntity(String(postId)).revertTo(target.historyId);
    expect(restored.title).toBe(target.snapshot.title);
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
