import { describe, expect, it } from 'vitest';
import { Historized } from '../src/index';

describe('smoke', () => {
  it('package loads', () => {
    expect(typeof Historized).toBe('function');
  });
});
