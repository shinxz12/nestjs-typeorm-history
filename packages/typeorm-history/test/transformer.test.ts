import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { historyRepo } from '../src/repository/history-repository';
import { Tagged, buildDataSource } from './support/blog-fixture';

describe('columns with a value transformer', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = buildDataSource();
    await ds.initialize();
  });
  afterAll(() => ds.destroy());

  it('stores the transformed (database) value in the history row', async () => {
    const t = await ds.manager.save(Tagged, { tags: ['a', 'b'] });
    const [rec] = await historyRepo(ds, Tagged).forEntity(t.id).all();
    expect(rec.snapshot.tags).toBe('a,b');
  });

  it('asOf returns the domain value', async () => {
    const t = await ds.manager.save(Tagged, { tags: ['x', 'y'] });
    const at = await historyRepo(ds, Tagged).forEntity(t.id).asOf(new Date());
    expect(at!.tags).toEqual(['x', 'y']);
  });
});
