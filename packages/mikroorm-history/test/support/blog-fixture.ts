import 'reflect-metadata';
import {
  Entity,
  ManyToOne,
  PrimaryKey,
  Property,
  ReflectMetadataProvider,
} from '@mikro-orm/decorators/legacy';
import { MikroORM, Options } from '@mikro-orm/sqlite';
import { Historized, historyEntities, HistorySubscriber } from '../../src';

@Historized()
@Entity()
export class Author {
  @PrimaryKey() id!: number;
  @Property() name!: string;
  @Property({ nullable: true }) email?: string | null;
}

@Historized({ softDeleteField: 'deletedAt' })
@Entity()
export class Post {
  @PrimaryKey() id!: number;
  @Property() title!: string;
  @ManyToOne(() => Author, { nullable: true }) author?: Author | null;
  @Property({ nullable: true, type: 'Date' }) deletedAt?: Date | null;
}

export async function initOrm(extra: Partial<Options> = {}): Promise<MikroORM> {
  const { entities: extraEntities = [], ...rest } = extra;
  const orm = await MikroORM.init({
    dbName: ':memory:',
    entities: [Author, Post, ...(extraEntities as any[]), ...historyEntities()],
    subscribers: [new HistorySubscriber()],
    metadataProvider: ReflectMetadataProvider,
    allowGlobalContext: true,
    ...rest,
  });
  await orm.schema.create();
  return orm;
}
