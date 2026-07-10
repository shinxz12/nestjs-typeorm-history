import { describe, expect, it } from 'vitest';
import { HistoryRecord } from '../src/repository/history-record';

const rec = (raw: Record<string, any>) => new HistoryRecord(raw, ['val']);

describe('diffAgainst value comparison', () => {
  it('reports a change from null to an epoch-zero date', () => {
    const changes = rec({ val: new Date(0) }).diffAgainst(rec({ val: null })).changes;
    expect(changes).toHaveLength(1);
  });

  it('reports a change from an epoch-zero date to null', () => {
    const changes = rec({ val: null }).diffAgainst(rec({ val: new Date(0) })).changes;
    expect(changes).toHaveLength(1);
  });

  it('compares equal dates as unchanged', () => {
    const changes = rec({ val: new Date(5000) }).diffAgainst(rec({ val: new Date(5000) })).changes;
    expect(changes).toHaveLength(0);
  });

  it('does not report identical json values as changed', () => {
    const changes = rec({ val: { a: 1, b: [1, 2] } }).diffAgainst(rec({ val: { a: 1, b: [1, 2] } })).changes;
    expect(changes).toHaveLength(0);
  });

  it('reports differing json values as changed', () => {
    const changes = rec({ val: { a: 2 } }).diffAgainst(rec({ val: { a: 1 } })).changes;
    expect(changes).toHaveLength(1);
  });
});
