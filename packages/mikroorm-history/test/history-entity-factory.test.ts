import 'reflect-metadata';
import { META } from '@entity-history/core';
import { describe, expect, it } from 'vitest';
import { historyEntities } from '../src/history-entity-factory';
import { initOrm } from './support/blog-fixture';

describe('historyEntities (mikroorm)', () => {
  it('generates one shadow schema per @Historized entity with META columns', () => {
    const schemas = historyEntities();
    const names = schemas.map((s: any) => s.meta?.className ?? s.name);
    expect(names).toContain('author_history');
    expect(names).toContain('post_history');
    const author: any = schemas.find((s: any) => (s.meta?.className ?? s.name) === 'author_history');
    for (const col of Object.values(META)) {
      expect(author.meta.properties[col as string]).toBeDefined();
    }
  });

  it('predicts FK columns and survives discovery + runtime validation', async () => {
    const orm = await initOrm();
    const postHistory = orm.getMetadata().get('post_history');
    expect(postHistory.properties['author_id']).toBeDefined();
    expect(postHistory.properties['deleted_at']).toBeDefined();
    expect((postHistory.properties as any)[META.id].autoincrement).toBe(true);
    await orm.close();
  });
});
