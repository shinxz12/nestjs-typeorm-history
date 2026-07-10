import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { Historized } from '../src/decorators/historized';
import { getHistorizedEntry, listHistorized } from '../src/metadata/registry';

@Entity()
@Historized({ exclude: ['secret'], trackSoftDelete: true })
class Doc {
  @PrimaryGeneratedColumn() id!: number;
  @Column() title!: string;
  @Column() secret!: string;
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
