import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOLD_MS, hold } from '../src/lib/press';

function stub() {
  const attrs = new Map<string, string>();
  return {
    attrs,
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    removeAttribute: (k: string) => void attrs.delete(k),
    hasAttribute: (k: string) => attrs.has(k),
  };
}

describe('hold: a button stays pressed while its work runs, and for at least HOLD_MS', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('marks busy at once and releases when the work is done, after the minimum hold', () => {
    const el = stub();
    const action = hold(el, false, Date.now);
    expect(el.attrs.has('aria-busy')).toBe(false);
    action.update(true);
    expect(el.attrs.get('aria-busy')).toBe('true');
    vi.advanceTimersByTime(40);
    action.update(false); // instant work: released only once HOLD_MS has passed since the press
    expect(el.attrs.has('aria-busy')).toBe(true);
    vi.advanceTimersByTime(HOLD_MS - 40 - 1);
    expect(el.attrs.has('aria-busy')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(el.attrs.has('aria-busy')).toBe(false);
  });

  it('slow work releases at once when it ends', () => {
    const el = stub();
    const action = hold(el, true, Date.now);
    vi.advanceTimersByTime(HOLD_MS * 10);
    action.update(false);
    vi.advanceTimersByTime(0);
    expect(el.attrs.has('aria-busy')).toBe(false);
  });

  it('a press during a pending release keeps the button pressed', () => {
    const el = stub();
    const action = hold(el, true, Date.now);
    action.update(false);
    action.update(true);
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(el.attrs.get('aria-busy')).toBe('true');
    action.destroy();
  });
});
