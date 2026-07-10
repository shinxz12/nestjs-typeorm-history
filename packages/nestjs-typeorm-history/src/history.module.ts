import { DynamicModule, ExecutionContext, Module, Provider } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { historyRepo } from '@entity-history/typeorm';
import { HistoryContextInterceptor } from './history-context.interceptor';
import { getHistoryRepositoryToken, HISTORY_MODULE_OPTIONS, HistoryDataSourceRef } from './tokens';

/** Options for {@link HistoryModule.forRoot}. */
export interface HistoryModuleOptions {
  /** Extract the acting user's id from the execution context. Return null/undefined for anonymous. */
  userResolver?: (ctx: ExecutionContext) => string | number | null | undefined;
}

/**
 * NestJS integration for `@entity-history/typeorm`. `forRoot()` installs a
 * global interceptor that attributes every request's writes to
 * `userResolver`'s result; `forFeature()` provides an injectable
 * `HistoryRepository` per entity via {@link InjectHistoryRepository}.
 */
@Module({})
export class HistoryModule {
  static forRoot(options: HistoryModuleOptions = {}): DynamicModule {
    return {
      module: HistoryModule,
      global: true,
      providers: [
        { provide: HISTORY_MODULE_OPTIONS, useValue: options },
        { provide: APP_INTERCEPTOR, useClass: HistoryContextInterceptor },
      ],
      exports: [HISTORY_MODULE_OPTIONS],
    };
  }

  static forFeature(
    entities: Array<new (...args: any[]) => any>,
    dataSource?: HistoryDataSourceRef,
  ): DynamicModule {
    const providers: Provider[] = entities.map((entity) => ({
      provide: getHistoryRepositoryToken(entity, dataSource),
      useFactory: (ds: DataSource) => historyRepo(ds, entity),
      inject: [getDataSourceToken(dataSource)],
    }));
    return { module: HistoryModule, providers, exports: providers.map((p: any) => p.provide) };
  }
}
