import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Controller, Get, INestApplication, Module, Query } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule, getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Column, DataSource, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { Historized, historyEntities, HistorySubscriber } from 'typeorm-entity-history';
import { HistoryModule } from '../src/history.module';
import { InjectHistoryRepository } from '../src/tokens';
import type { HistoryRepository } from 'typeorm-entity-history';

@Entity()
@Historized()
class Note {
  @PrimaryGeneratedColumn() id!: number;
  @Column() body!: string;
}

@Entity()
@Historized()
class Memo {
  @PrimaryGeneratedColumn() id!: number;
  @Column() text!: string;
}

@Controller('memos')
class MemosController {
  constructor(
    @InjectHistoryRepository(Memo, 'second') private readonly memoHistory: HistoryRepository<Memo>,
  ) {}

  @Get('history-count')
  async count(@Query('id') id: string) {
    const records = await this.memoHistory.forEntity(Number(id)).all();
    return { count: records.length };
  }
}

@Controller('notes')
class NotesController {
  constructor(
    private readonly ds: DataSource,
    @InjectHistoryRepository(Note) private readonly noteHistory: HistoryRepository<Note>,
  ) {}

  @Get('create')
  async create(@Query('body') body: string) {
    const note = await this.ds.manager.save(Note, { body });
    return { id: note.id };
  }

  @Get('history')
  async history(@Query('id') id: string) {
    const records = await this.noteHistory.forEntity(Number(id)).all();
    return records.map((r) => ({ type: r.historyType, user: r.historyUserId }));
  }
}

describe('HistoryModule', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const schemas = historyEntities();
    @Module({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [Note, ...schemas],
          subscribers: [HistorySubscriber],
          synchronize: true,
        }),
        TypeOrmModule.forRoot({
          name: 'second',
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [Memo, ...schemas],
          subscribers: [HistorySubscriber],
          synchronize: true,
        }),
        HistoryModule.forRoot({
          userResolver: (ctx) => ctx.switchToHttp().getRequest().headers['x-user-id'] ?? null,
        }),
        HistoryModule.forFeature([Note]),
        HistoryModule.forFeature([Memo], 'second'),
      ],
      controllers: [NotesController, MemosController],
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

  it('forFeature works against a named (non-default) DataSource', async () => {
    const second = app.get<DataSource>(getDataSourceToken('second'));
    const memo = await second.manager.save(Memo, { text: 'm1' });
    const res = await request(app.getHttpServer()).get(`/memos/history-count?id=${memo.id}`).expect(200);
    expect(res.body).toEqual({ count: 1 });
  });
});
