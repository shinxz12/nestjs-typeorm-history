import { AsyncLocalStorage } from 'node:async_hooks';

/** Ambient user/reason attached to history rows written during the current async context. */
export interface HistoryContext {
  userId?: string | number | null;
  changeReason?: string | null;
}

const als = new AsyncLocalStorage<HistoryContext>();

/**
 * Runs `fn` with `ctx` as the active {@link HistoryContext}: any history
 * row written during `fn` (including in nested async calls) is attributed
 * to `ctx.userId`/`ctx.changeReason`. Use this outside HTTP requests (cron
 * jobs, queue consumers, scripts) — inside a NestJS request, the
 * `HistoryContextInterceptor` from `nestjs-typeorm-history` sets this
 * automatically per request.
 */
export function withHistoryContext<T>(ctx: HistoryContext, fn: () => T): T {
  return als.run({ ...ctx }, fn);
}

/** The currently active {@link HistoryContext}, or `undefined` outside any `withHistoryContext` call. */
export function getHistoryContext(): HistoryContext | undefined {
  return als.getStore();
}

/** Sets `changeReason` on the currently active context in place, without disturbing `userId`. No-op outside a context. */
export function setChangeReason(reason: string): void {
  const store = als.getStore();
  if (store) store.changeReason = reason;
}
