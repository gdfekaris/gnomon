import { describe, expect, it } from 'vitest';
import { estimateTokens } from '../src/index';

describe('estimateTokens (spec §8.2)', () => {
  it('is ceil(bytes / 3.6) and conservative', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(2);
    expect(estimateTokens('a'.repeat(360))).toBe(100);
  });
});
