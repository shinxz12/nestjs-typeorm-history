import 'reflect-metadata';
import {
  EntitySchema,
  EventArgs,
  EventSubscriber,
  MetadataStorage,
  UnderscoreNamingStrategy,
} from '@mikro-orm/core';
import {
  Entity,
  ManyToOne,
  PrimaryKey,
  Property,
  ReflectMetadataProvider,
} from '@mikro-orm/decorators/legacy';
import { MikroORM } from '@mikro-orm/sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

@Entity()
class SpikeAuthor {
  @PrimaryKey() id!: number;
  @Property() name!: string;
}

@Entity()
class SpikePost {
  @PrimaryKey() id!: number;
  @Property() title!: string;
  @ManyToOne(() => SpikeAuthor, { nullable: true }) author?: SpikeAuthor | null;
}

// Hand-written shadow table for the spike (the factory generates these).
const SpikeAuthorHistory = new EntitySchema({
  name: 'spike_author_history',
  tableName: 'spike_author_history',
  properties: {
    history_id: { type: 'number', primary: true, autoincrement: true },
    history_type: { type: 'string', length: 6 },
    id: { type: 'number', nullable: true },
    name: { type: 'string', nullable: true },
  },
});

const events: string[] = [];

class SpikeSubscriber implements EventSubscriber {
  async afterCreate(args: EventArgs<any>): Promise<void> {
    if (args.entity.constructor !== SpikeAuthor) return;
    events.push(`create:${args.entity.id}`);
    // Raw insert on the flushing em — must join the flush transaction.
    await (args.em as any)
      .createQueryBuilder('spike_author_history')
      .insert({ history_type: 'create', id: args.entity.id, name: args.entity.name })
      .execute('run');
  }
}

describe('spike: MikroORM event semantics', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init({
      dbName: ':memory:',
      entities: [SpikeAuthor, SpikePost, SpikeAuthorHistory],
      subscribers: [new SpikeSubscriber()],
      metadataProvider: ReflectMetadataProvider,
      allowGlobalContext: true,
    });
    await orm.schema.create();
  });

  afterAll(async () => {
    await orm.close();
  });

  it('(2) afterCreate sees the DB-generated primary key', async () => {
    const em = orm.em.fork();
    const a = em.create(SpikeAuthor, { name: 'ada' });
    await em.flush();
    expect(a.id).toBeGreaterThan(0);
    expect(events).toContain(`create:${a.id}`);
    const rows = await (em as any)
      .createQueryBuilder('spike_author_history')
      .select('*')
      .where({ id: a.id })
      .execute('all', false);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('ada');
  });

  it('(1) history insert rolls back with the flush transaction', async () => {
    const em = orm.em.fork();
    await expect(
      em.transactional(async (tem) => {
        tem.create(SpikeAuthor, { name: 'doomed' });
        await tem.flush();
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const rows = await (em as any)
      .createQueryBuilder('spike_author_history')
      .select('*')
      .where({ name: 'doomed' })
      .execute('all', false);
    expect(rows).toHaveLength(0);
  });

  it('(3) one batched flush fires one event per entity', async () => {
    const em = orm.em.fork();
    events.length = 0;
    em.create(SpikeAuthor, { name: 'b1' });
    em.create(SpikeAuthor, { name: 'b2' });
    em.create(SpikeAuthor, { name: 'b3' });
    await em.flush();
    expect(events.filter((e) => e.startsWith('create:'))).toHaveLength(3);
  });

  it('(4) decorator metadata is readable before init', () => {
    // v7: getMetadataFromDecorator was removed; the global store is keyed
    // `ClassName-hash`, entries found by class reference.
    const store = MetadataStorage.getMetadata() as Record<string, any>;
    const meta = Object.values(store).find((m: any) => m.class === SpikePost);
    expect(meta).toBeDefined();
    const props = Object.values(meta.properties) as any[];
    const title = props.find((p) => p.name === 'title');
    const author = props.find((p) => p.name === 'author');
    expect(title.kind).toBe('scalar');
    expect(author.kind).toBe('m:1');
    // Types are not resolved pre-init; the factory falls back to design:type.
    expect(Reflect.getMetadata('design:type', SpikePost.prototype, 'title')).toBe(String);
  });

  it('(5) default naming strategy predicts the discovered FK column', () => {
    const naming = new UnderscoreNamingStrategy();
    const discovered = orm.getMetadata().get(SpikePost.name);
    const authorProp = discovered.properties['author'];
    expect(authorProp.fieldNames[0]).toBe(naming.joinColumnName('author'));
    expect(discovered.properties['title'].fieldNames[0]).toBe(naming.propertyToColumnName('title'));
  });
});
