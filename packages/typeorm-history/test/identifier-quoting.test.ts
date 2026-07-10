import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { bulkDeleteWithHistory } from '../src/bulk/bulk-helpers';
import { historyRepo } from '../src/repository/history-repository';
import { ReservedPk, buildDataSource } from './support/blog-fixture';

describe('identifier quoting in raw queries', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = buildDataSource();
    await ds.initialize();
  });
  afterAll(() => ds.destroy());

  it('records insert and remove history for a reserved-word pk column', async () => {
    const r = await ds.manager.save(ReservedPk, { label: 'x' });
    const loaded = await ds.manager.findOneByOrFail(ReservedPk, { order: r.order });
    await ds.manager.remove(ReservedPk, loaded);
    const recs = await historyRepo(ds, ReservedPk).forEntity(r.order).all();
    expect(recs.map((x) => x.historyType)).toEqual(['delete', 'create']);
  });

  it('bulkDeleteWithHistory works with a reserved-word pk column', async () => {
    const r = await ds.manager.save(ReservedPk, { label: 'bulk' });
    const { affected } = await bulkDeleteWithHistory(ds.getRepository(ReservedPk), { label: 'bulk' });
    expect(affected).toBe(1);
    const recs = await historyRepo(ds, ReservedPk).forEntity(r.order).all();
    expect(recs[0].historyType).toBe('delete');
  });
});
