import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { withHistoryContext } from '../src/context/history-context';
import { Author, Post, buildDataSource } from './support/blog-fixture';

describe('HistorySubscriber', () => {
  let ds: DataSource;
  beforeAll(async () => {
    ds = buildDataSource();
    await ds.initialize();
  });
  afterAll(() => ds.destroy());

  const historyRows = () =>
    ds.getRepository('post_history').find({ order: { history_id: 'ASC' } as any }) as Promise<any[]>;

  it("records 'create' with context, FK id, and excluded column absent", async () => {
    const author = await ds.manager.save(Author, { name: 'Ann' });
    const post = await withHistoryContext({ userId: 'u1', changeReason: 'create' }, () =>
      ds.manager.save(Post, { title: 'Hello', author, draftNotes: 'wip' }),
    );
    const rows = await historyRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: post.id,
      title: 'Hello',
      authorId: author.id,
      history_type: 'create',
      history_user_id: 'u1',
      history_change_reason: 'create',
    });
    expect(rows[0]).not.toHaveProperty('draftNotes');
  });

  it("records 'update' on update, keeping FK from a partial save", async () => {
    const post = await ds.manager.findOneByOrFail(Post, { title: 'Hello' });
    await ds.manager.save(Post, { id: post.id, title: 'Hello v2' });
    const rows = await historyRows();
    expect(rows).toHaveLength(2);
    expect(rows[1].history_type).toBe('update');
    expect(rows[1].title).toBe('Hello v2');
    expect(rows[1].authorId).not.toBeNull(); // reselect fallback preserved the FK
    expect(rows[1].history_user_id).toBeNull(); // no context → null, no throw
  });

  it("records 'delete' on soft remove and 'update' on recover", async () => {
    const post = await ds.manager.findOneByOrFail(Post, { title: 'Hello v2' });
    await ds.manager.softRemove(Post, post);
    await ds.manager.recover(Post, post);
    const rows = await historyRows();
    expect(rows.map((r) => r.history_type)).toEqual(['create', 'update', 'delete', 'update']);
  });

  it("records 'delete' on hard remove with the final snapshot", async () => {
    const post = await ds.manager.findOneByOrFail(Post, { title: 'Hello v2' });
    const id = post.id;
    await ds.manager.remove(Post, post);
    const rows = await historyRows();
    const last = rows[rows.length - 1];
    expect(last.history_type).toBe('delete');
    expect(last.id).toBe(id);
    expect(last.title).toBe('Hello v2');
  });

  it('history rolls back with the surrounding transaction', async () => {
    const before = (await historyRows()).length;
    await expect(
      ds.transaction(async (em) => {
        await em.save(Post, { title: 'doomed' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect((await historyRows()).length).toBe(before);
  });

  it('non-historized entities are ignored', async () => {
    const authorRows = (await ds.getRepository('author_history').find()) as any[];
    expect(authorRows.every((r) => 'name' in r)).toBe(true);
  });
});
