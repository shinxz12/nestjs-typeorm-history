import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Controller, Get, INestApplication, Module, Query } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { EntityManager } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property, ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { SqliteDriver } from '@mikro-orm/sqlite';
import request from 'supertest';
import {
  Historized,
  historyEntities,
  HistorySubscriber,
  type HistoryRepository,
} from '@entity-history/mikroorm';
import { HistoryModule } from '../src/history.module';
import { InjectHistoryRepository } from '../src/tokens';

@Entity()
@Historized()
class Note {
  @PrimaryKey() id!: number;
  @Property() body!: string;
}

@Controller('notes')
class NotesController {
  constructor(
    private readonly em: EntityManager,
    @InjectHistoryRepository(Note) private readonly noteHistory: HistoryRepository<Note>,
  ) {}

  @Get('create')
  async create(@Query('body') body: string) {
    const note = this.em.create(Note, { body });
    await this.em.flush();
    return { id: note.id };
  }

  @Get('history')
  async history(@Query('id') id: string) {
    const records = await this.noteHistory.forEntity(Number(id)).all();
    return records.map((r) => ({ type: r.historyType, user: r.historyUserId }));
  }
}

describe('HistoryModule (mikroorm)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    @Module({
      imports: [
        MikroOrmModule.forRoot({
          driver: SqliteDriver,
          dbName: ':memory:',
          entities: [Note, ...historyEntities()],
          subscribers: [new HistorySubscriber()],
          metadataProvider: ReflectMetadataProvider,
          allowGlobalContext: true,
          ensureDatabase: { create: true },
        }),
        HistoryModule.forRoot({
          userResolver: (ctx) => ctx.switchToHttp().getRequest().headers['x-user-id'] ?? null,
        }),
        HistoryModule.forFeature([Note]),
      ],
      controllers: [NotesController],
    })
    class AppModule {}

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());

  it('attributes writes to the resolved user', async () => {
    const { body } = await request(app.getHttpServer())
      .get('/notes/create?body=hi')
      .set('x-user-id', 'rider-1')
      .expect(200);
    const res = await request(app.getHttpServer()).get(`/notes/history?id=${body.id}`).expect(200);
    expect(res.body).toEqual([{ type: 'create', user: 'rider-1' }]);
  });

  it('writes null user when the resolver returns nothing', async () => {
    const { body } = await request(app.getHttpServer()).get('/notes/create?body=anon').expect(200);
    const res = await request(app.getHttpServer()).get(`/notes/history?id=${body.id}`).expect(200);
    expect(res.body).toEqual([{ type: 'create', user: null }]);
  });
});
