import { describe, expect, it } from 'vitest';
import { getHistoryRepositoryToken } from '../src/tokens';

describe('getHistoryRepositoryToken', () => {
  it('scopes tokens by data source name', () => {
    class Scoped {}
    expect(getHistoryRepositoryToken(Scoped, 'second')).not.toBe(getHistoryRepositoryToken(Scoped));
  });

  it('rejects two different classes sharing a class name', () => {
    const make = () => {
      class Dup {}
      return Dup;
    };
    const a = make();
    const b = make();
    getHistoryRepositoryToken(a);
    expect(() => getHistoryRepositoryToken(b)).toThrowError(/Dup/);
  });
});
