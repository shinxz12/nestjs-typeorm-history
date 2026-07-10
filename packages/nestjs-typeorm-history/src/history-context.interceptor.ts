import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor, Optional } from '@nestjs/common';
import { Observable } from 'rxjs';
import { withHistoryContext } from 'typeorm-entity-history';
import { HISTORY_MODULE_OPTIONS } from './tokens';
import type { HistoryModuleOptions } from './history.module';

/**
 * Wraps every request in a `withHistoryContext({ userId })` call, where
 * `userId` comes from `HistoryModuleOptions.userResolver`. Installed
 * automatically by {@link HistoryModule.forRoot}; not meant to be used
 * directly.
 */
@Injectable()
export class HistoryContextInterceptor implements NestInterceptor {
  constructor(
    @Optional() @Inject(HISTORY_MODULE_OPTIONS) private readonly options?: HistoryModuleOptions,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const userId = this.options?.userResolver?.(context) ?? null;
    return new Observable((subscriber) => {
      const sub = withHistoryContext({ userId }, () => next.handle().subscribe(subscriber));
      return () => sub.unsubscribe();
    });
  }
}
