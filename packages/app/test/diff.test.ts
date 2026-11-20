// The word-level comparison under "what changed, beside what you sealed" (spec §6.5).
import { describe, expect, it } from 'vitest';
import { diffText } from '../src/lib/diff';

const was = (parts: ReturnType<typeof diffText>) => parts.filter((p) => p.kind !== 'new').map((p) => p.text).join('');
const now = (parts: ReturnType<typeof diffText>) => parts.filter((p) => p.kind !== 'gone').map((p) => p.text).join('');

describe('diffText', () => {
  it('marks one changed word and keeps the rest', () => {
    const d = diffText('Choose courage before comfort.\n', 'Choose comfort before comfort.\n');
    expect(d).toEqual([
      { kind: 'same', text: 'Choose ' },
      { kind: 'gone', text: 'courage' },
      { kind: 'new', text: 'comfort' },
      { kind: 'same', text: ' before comfort.\n' },
    ]);
  });

  it('gives both texts back whole, whatever changed', () => {
    const a = 'one two  three\nfour five\n\nsix';
    const b = 'one three\nfour 5 five six seven\n';
    const d = diffText(a, b);
    expect(was(d)).toBe(a);
    expect(now(d)).toBe(b);
    expect(diffText(a, a)).toEqual([{ kind: 'same', text: a }]);
    expect(diffText('', b)).toEqual([{ kind: 'new', text: b }]);
    expect(diffText(a, '')).toEqual([{ kind: 'gone', text: a }]);
    expect(diffText('', '')).toEqual([]);
  });

  it('shows a middle too large to compare as gone then new, between the shared ends', () => {
    const big = (w: string) => Array.from({ length: 1500 }, (_, i) => `${w}${i}`).join(' ');
    const d = diffText(`start ${big('a')} end`, `start ${big('b')} end`);
    expect(d.map((p) => p.kind)).toEqual(['same', 'gone', 'new', 'same']);
    expect(d[0]!.text).toBe('start ');
    expect(d[3]!.text).toBe(' end');
  });
});
