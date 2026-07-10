import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { historyRepo } from '../src/repository/history-repository';
import { Author, Post, buildDataSource } from './support/blog-fixture';

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('asOf', () => {
  let ds: DataSource;
  let postId: number;
  let t0: Date, t1: Date, t2: Date, t3: Date;

  beforeAll(async () => {
    ds = buildDataSource();
    await ds.initialize();
    t0 = new Date();
    await tick();
    const author = await ds.manager.save(Author, { name: 'Ann' });
    const post = await ds.manager.save(Post, { title: 'v1', author });
    postId = post.id;
    await tick();
    t1 = new Date();
    await tick();
    await ds.manager.save(Post, { id: postId, title: 'v2' });
    await tick();
    t2 = new Date();
    await tick();
    const loaded = await ds.manager.findOneByOrFail(Post, { id: postId });
    await ds.manager.remove(Post, loaded);
    await tick();
    t3 = new Date();
  });
  afterAll(() => ds.destroy());

  it('returns null before the entity existed', async () => {
    expect(await historyRepo(ds, Post).forEntity(postId).asOf(t0)).toBeNull();
  });

  it('returns the reconstructed instance at each point in time', async () => {
    const at1 = await historyRepo(ds, Post).forEntity(postId).asOf(t1);
    expect(at1).toBeInstanceOf(Post);
    expect(at1!.title).toBe('v1');
    expect(at1!.author).toEqual({ id: 1 }); // FK relation stub
    const at2 = await historyRepo(ds, Post).forEntity(postId).asOf(t2);
    expect(at2!.title).toBe('v2');
  });

  it('returns null after deletion', async () => {
    expect(await historyRepo(ds, Post).forEntity(postId).asOf(t3)).toBeNull();
  });

  it('table-wide asOf excludes deleted entities and picks latest version', async () => {
    const author2 = await ds.manager.save(Author, { name: 'Bob' });
    await ds.manager.save(Post, { title: 'other', author: author2 });
    const nowAll = await historyRepo(ds, Post).asOf(new Date());
    expect(nowAll.map((p) => p.title)).toEqual(['other']);
    const at2All = await historyRepo(ds, Post).asOf(t2);
    expect(at2All.map((p) => p.title)).toEqual(['v2']);
  });
});
