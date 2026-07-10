import { describe, expect, it } from 'vitest';
import { Historized } from '../src/historized';
import { getHistorizedEntry, listHistorized } from '../src/registry';

// The registry is ORM-agnostic: plain classes suffice, no entity decorators.
@Historized({ exclude: ['secret'], trackSoftDelete: true })
class Doc {
  id!: number;
  title!: string;
  secret!: string;
}

describe('registry', () => {
  it('registers decorated entity with its options', () => {
    const entry = getHistorizedEntry(Doc);
    expect(entry).toBeDefined();
    expect(entry!.options.exclude).toEqual(['secret']);
    expect(entry!.options.trackSoftDelete).toBe(true);
    expect(listHistorized().map((e) => e.target)).toContain(Doc);
  });

  it('returns undefined for unregistered class', () => {
    class Other {}
    expect(getHistorizedEntry(Other)).toBeUndefined();
  });
});
