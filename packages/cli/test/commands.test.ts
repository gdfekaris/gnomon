import { describe, expect, it } from 'vitest';
import { run, USAGE } from '../src/commands';

describe('gnomon cli (spec §13)', () => {
  it('prints usage and exits 0 with no command', async () => {
    const lines: string[] = [];
    expect(await run([], (s) => lines.push(s))).toBe(0);
    expect(lines[0]).toBe(USAGE);
  });
  it('rejects unknown commands with exit 2', async () => {
    expect(await run(['frobnicate'], () => {})).toBe(2);
  });
});
