import { describe, expect, it } from 'vitest';
import { getHistoryContext, setChangeReason, withHistoryContext } from '../src/history-context';

describe('history context', () => {
  it('is undefined outside a context', () => {
    expect(getHistoryContext()).toBeUndefined();
  });

  it('propagates through async calls', async () => {
    const seen = await withHistoryContext({ userId: 'u1' }, async () => {
      await new Promise((r) => setTimeout(r, 1));
      return getHistoryContext();
    });
    expect(seen).toEqual({ userId: 'u1' });
  });

  it('setChangeReason mutates the active context and no-ops outside', async () => {
    setChangeReason('ignored'); // no throw
    await withHistoryContext({ userId: 'u1' }, async () => {
      setChangeReason('because');
      expect(getHistoryContext()).toEqual({ userId: 'u1', changeReason: 'because' });
    });
  });

  it('nested contexts restore on exit', async () => {
    await withHistoryContext({ userId: 'outer' }, async () => {
      await withHistoryContext({ userId: 'inner' }, async () => {
        expect(getHistoryContext()?.userId).toBe('inner');
      });
      expect(getHistoryContext()?.userId).toBe('outer');
    });
  });
});
