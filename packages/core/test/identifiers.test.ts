import { describe, expect, it } from 'vitest';
import { SET_ONE_SLUG, isInboxStem, isProposalId, isSetSlug, isSourceSlug } from '../src/index';

describe('identifiers (schema §3)', () => {
  it('accepts the examples from the schema', () => {
    expect(isSourceSlug('aurelius-meditations-4-3')).toBe(true);
    expect(isSourceSlug('didion-why-i-write')).toBe(true);
    expect(isSetSlug('ps-7k2m')).toBe(true);
    expect(isSetSlug(SET_ONE_SLUG)).toBe(true);
    expect(isInboxStem('20260905-143012-x7q')).toBe(true);
    expect(isProposalId('P-20260905-003')).toBe(true);
  });
  it('rejects malformed identifiers', () => {
    expect(isSourceSlug('-leading')).toBe(false);
    expect(isSourceSlug('ab')).toBe(false);
    expect(isSourceSlug('Upper-Case')).toBe(false);
    expect(isSetSlug('ps-0o1l')).toBe(false); // ambiguous characters excluded
    expect(isInboxStem('2026-09-05-x7q')).toBe(false);
    expect(isProposalId('P3')).toBe(false);
  });
});
