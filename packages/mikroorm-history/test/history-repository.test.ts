import 'reflect-metadata';
import { Entity, PrimaryKey } from '@mikro-orm/decorators/legacy';
import { describe, expect, it } from 'vitest';
import { historyRepo } from '../src/history-repository';
import { Author, initOrm } from './support/blog-fixture';

@Entity()
class NotHistorized {
  @PrimaryKey() id!: number;
}

describe('historyRepo guards', () => {
  it('throws for non-@Historized entities and returns records otherwise', async () => {
    const orm = await initOrm({ entities: [NotHistorized] });
    const em = orm.em.fork();
    expect(() => historyRepo(em, NotHistorized)).toThrow('not @Historized');

    const a = em.create(Author, { name: 'g' });
    await em.flush();
    const recs = await historyRepo(em, Author).forEntity(a.id).all();
    expect(recs).toHaveLength(1);
    expect(recs[0].historyType).toBe('create');
    expect(recs[0].snapshot.name).toBe('g');
    await orm.close();
  });
});
