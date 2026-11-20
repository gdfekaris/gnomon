// A word-level comparison of two texts, for showing a changed file beside
// its sealed text (spec §6.5). Longest common subsequence over words and
// the whitespace between them, after the shared start and end are set
// aside; a middle too large to compare word by word is shown whole.

export interface DiffPart { kind: 'same' | 'gone' | 'new'; text: string }

/** Largest table the comparison fills: about 8 MB of 32-bit cells. */
const MAX_CELLS = 2_000_000;

const tokens = (t: string): string[] => t.split(/(\s+)/).filter((x) => x !== '');

/** `was` against `now`: what both hold, what only `was` holds (gone), what only `now` holds (new), in reading order. */
export function diffText(was: string, now: string): DiffPart[] {
  const a = tokens(was);
  const b = tokens(now);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const am = a.slice(start, a.length - end);
  const bm = b.slice(start, b.length - end);

  const out: DiffPart[] = [];
  const push = (kind: DiffPart['kind'], text: string) => {
    if (text === '') return;
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  push('same', a.slice(0, start).join(''));
  const n = am.length;
  const m = bm.length;
  if (n === 0 || m === 0 || (n + 1) * (m + 1) > MAX_CELLS) {
    push('gone', am.join(''));
    push('new', bm.join(''));
  } else {
    // lcs[i][j]: the longest common subsequence of am[i..] and bm[j..]
    const w = m + 1;
    const lcs = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--) lcs[i * w + j] = am[i] === bm[j] ? lcs[(i + 1) * w + j + 1]! + 1 : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (am[i] === bm[j]) {
        push('same', am[i]!);
        i++;
        j++;
      } else if (lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!) push('gone', am[i++]!);
      else push('new', bm[j++]!);
    }
    push('gone', am.slice(i).join(''));
    push('new', bm.slice(j).join(''));
  }
  push('same', a.slice(a.length - end).join(''));
  return out;
}
