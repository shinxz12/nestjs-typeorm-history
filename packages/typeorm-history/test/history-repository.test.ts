import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { withHistoryContext } from '../src/context/history-context';
import { historyRepo } from '../src/repository/history-repository';
import { Author, Post, buildDataSource } from './support/blog-fixture';

describe('HistoryRepository basics', () => {
  let ds: DataSource;
  let postId: number;

  beforeAll(async () => {
    ds = buildDataSource();
    await ds.initialize();
    const author = await ds.manager.save(Author, { name: 'Ann' });
    const post = await withHistoryContext({ userId: 'u1' }, () =>
      ds.manager.save(Post, { title: 'v1', author }),
    );
    postId = post.id;
    await ds.manager.save(Post, { id: postId, title: 'v2' });
    await ds.manager.save(Post, { id: postId, title: 'v3' });
  });
  afterAll(() => ds.destroy());

  it('all() returns records newest first with meta accessors', async () => {
    const records = await historyRepo(ds, Post).forEntity(postId).all();
    expect(records.map((r) => r.historyType)).toEqual(['update', 'update', 'create']);
    expect(records[2].historyUserId).toBe('u1');
    expect(records[0].historyDate).toBeInstanceOf(Date);
    expect(records[0].snapshot.title).toBe('v3');
  });

  it('all() supports take/skip pagination', async () => {
    const page = await historyRepo(ds, Post).forEntity(postId).all({ take: 1, skip: 1 });
    expect(page).toHaveLength(1);
    expect(page[0].snapshot.title).toBe('v2');
  });

  it('diffAgainst() lists changed tracked fields only', async () => {
    const [newest, , oldest] = await historyRepo(ds, Post).forEntity(postId).all();
    const diff = newest.diffAgainst(oldest);
    expect(diff.changes).toEqual([{ field: 'title', old: 'v1', new: 'v3' }]);
  });

  it('throws a clear error for non-historized entities', () => {
    class Plain {}
    expect(() => historyRepo(ds, Plain as any)).toThrowError(/not @Historized/);
  });
});
