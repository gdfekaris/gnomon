import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type BrainFile, type ProposalFm, validateSnapshot } from '@gnomon/core';
import { MemoryDriver } from '@gnomon/storage';
import { BrainService, type SnapshotState } from '../src/lib/services/brain';
import { createPrincipleIn } from '../src/lib/services/edit';
import { MockProvider, demoScript } from '@gnomon/providers';
import { acceptLink, acceptanceRoute, addGround, decide, extractProposal, groundsToAdd, groupProposals, prefillFrom, proposalId, saveProposal, writtenAs } from '../src/lib/services/proposals';

const here = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE = join(here, '..', '..', 'core', 'fixtures', 'brain');
function seed(): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.set(relative(FIXTURE, full).split('\\').join('/'), new Uint8Array(readFileSync(full)));
    }
  };
  walk(FIXTURE);
  return out;
}
async function connected() {
  const state: SnapshotState = { current: null, stale: false, loading: false, error: null };
  const brain = new BrainService(state);
  await brain.connect(await MemoryDriver.create(seed()));
  return brain;
}

describe('proposals service (US-3, schema §4.7, §7.10)', () => {
  it('groups by target set in set order with untargeted proposals last, newest first', async () => {
    const brain = await connected();
    const groups = groupProposals(brain.snapshot!);
    expect(groups.map((g) => [g.label, g.open.map((p) => proposalId(p.path)), g.decided.map((p) => proposalId(p.path))])).toEqual([
      ['Set 1', [], ['P-20260905-002']],
      ['Set 2 — Work', ['P-20260905-003', 'P-20260905-001'], []],
      ['Sources', [], ['P-20260903-001']],
    ]);
  });

  it('acceptance routes and pre-fill', async () => {
    const brain = await connected();
    const s = brain.snapshot!;
    const at = (id: string) => s.files.get(`maps/proposals/${id}.md`) as BrainFile<ProposalFm>;
    expect(acceptanceRoute(at('P-20260905-001'))).toBe('#/sets/ps-7k2m/new-principle?from=P-20260905-001');
    expect(acceptanceRoute(at('P-20260905-003'))).toBe('#/edit/principles/ps-7k2m/say-the-hard-thing-first.md?from=P-20260905-003');
    expect(acceptanceRoute(at('P-20260905-002'))).toBe('#/edit/principles/ps-g8xw/courage-before-comfort.md?from=P-20260905-002');
    expect(acceptanceRoute(at('P-20260903-001'))).toBe('#/edit/sources/didion-why-i-write/raw.md?from=P-20260903-001');
    const pre = prefillFrom(s, 'P-20260905-001', 'ps-7k2m')!;
    expect(pre.title).toBe('Rise to the work');
    expect(pre.grounds).toEqual(['aurelius-meditations-5-1']);
    expect(pre.body).toBe('Rise to the work\n\n(Drafted from a proposal. Rewrite this in your own words before saving.)\n\n**Grounding passages:**\n\n- [[sources/aurelius-meditations-5-1/raw]] ([raw](../../sources/aurelius-meditations-5-1/raw.md))\n\nWritten from [[maps/proposals/P-20260905-001]] ([proposal](../../maps/proposals/P-20260905-001.md)).\n');
    expect(prefillFrom(s, 'P-20260905-003', 'ps-7k2m')!.title).toBe('');
    expect(prefillFrom(s, 'P-19990101-001', 'ps-7k2m')).toBeNull();
  });

  it('decide commits one Decide: per proposal, and a principle written from it shows as what it became', async () => {
    const brain = await connected();
    await decide(brain, 'P-20260905-001', 'accepted');
    await decide(brain, 'P-20260905-003', 'declined');
    const s = brain.snapshot!;
    expect((s.files.get('maps/proposals/P-20260905-001.md')!.fm as ProposalFm).status).toBe('accepted');
    expect((s.files.get('maps/proposals/P-20260905-003.md')!.fm as ProposalFm).status).toBe('declined');
    expect(groupProposals(s).find((g) => g.key === 'ps-7k2m')!.open).toEqual([]);
    const pre = prefillFrom(s, 'P-20260905-001', 'ps-7k2m')!;
    const path = await createPrincipleIn(brain, 'ps-7k2m', { title: pre.title, body: 'Get up; the work is what you are for.\n\n' + pre.body.split('**Grounding passages:**')[1]!.replace(/^\n+/, '**Grounding passages:**\n'), grounds: pre.grounds, related: [], tags: [] });
    expect(writtenAs(brain.snapshot!, 'maps/proposals/P-20260905-001.md').map((f) => f.path)).toEqual([path]);
    expect(validateSnapshot(brain.snapshot!)).toEqual([]);
  });
});

describe('save as proposal (Phase 3 block 5, schema §4.7)', () => {
  const relateContext = [
    '## Set 1', '<!-- ref: principles/ps-g8xw/courage-before-comfort -->', 'Courage before comfort.', '<!-- ref: principles/ps-g8xw/attention-is-generosity -->', 'Attention is generosity.',
    '<!-- ref: sources/weil-attention/raw -->', 'Attention is the rarest and purest form of generosity.',
    '## New text', 'Attention is a form of prayer. Everything else follows.',
  ].join('\n');
  const answer = demoScript({ model: 'mock-reasoner', system: 'You are reasoning', messages: [{ role: 'user', content: relateContext }], maxTokens: 100, signal: new AbortController().signal });

  it('the demo model answers a relate task with the four sections and labeled proposal lines', () => {
    expect(answer).toMatch(/^1\. Agrees$/m);
    expect(answer).toMatch(/^4\. Proposal$/m);
    expect(answer).toContain('Kind: principle');
    expect(answer).toContain('Target set: ps-g8xw');
    expect(answer).toContain('Wording: Attention is a form of prayer.');
    expect(new MockProvider().id).toBe('mock');
  });

  it('extracts the labeled lines, and falls back to loose text, and reads "None" as nothing', () => {
    expect(extractProposal(answer, ['ps-7k2m'])).toEqual({ kind: 'principle', title: 'Attention is a form of prayer', target_set: 'ps-g8xw', rationale: 'The demo model proposes a principle wherever a new text makes a claim. Decide whether you hold it.', grounds: [] });
    const loose = '## 4. Proposal\n\n**Kind:** amendment\n**Target:** ps-7k2m/say-the-hard-thing-first\n**Wording:** "Say the hard thing first, then the rest."\n**Rationale:** The text shows the rest matters too.\nIt should stay short.\n';
    expect(extractProposal(loose, ['ps-g8xw'])).toEqual({ kind: 'amendment', title: 'Say the hard thing first, then the rest', target_set: 'ps-7k2m', target: 'ps-7k2m/say-the-hard-thing-first', rationale: 'The text shows the rest matters too.\nIt should stay short.', grounds: [] });
    const bare = '1. Agrees\nyes\n\n4. Proposal\nRead before you write.\nBecause the text says so, and the set is silent on reading.\n';
    expect(extractProposal(bare, ['ps-g8xw'])).toMatchObject({ kind: 'principle', title: 'Read before you write.', target_set: 'ps-g8xw', rationale: 'Because the text says so, and the set is silent on reading.' });
    expect(extractProposal('4. Proposal\nNone.\n', ['ps-g8xw'])).toBeNull();
    expect(extractProposal('No proposal section here.', ['ps-g8xw'])).toBeNull();
    const cited = extractProposal(answer, ['ps-g8xw'], [{ ref: 'sources/weil-attention/raw', path: 'sources/weil-attention/raw.md', resolved: true, start: 0, end: 1 } as never]);
    expect(cited!.grounds).toEqual(['weil-attention']);
  });

  it('saves one Add proposal commit: a human, open proposal in the target set, indexed', async () => {
    const brain = await connected();
    const head = brain.head;
    const id = await saveProposal(brain, { kind: 'principle', title: 'Attention is a form of prayer', target_set: 'ps-g8xw', rationale: 'Because it is.', grounds: ['weil-attention'] });
    expect(id).toMatch(/^P-\d{8}-001$/);
    const s = brain.snapshot!;
    expect(s.head).not.toBe(head);
    const f = s.files.get(`maps/proposals/${id}.md`) as BrainFile<ProposalFm>;
    expect(f.fm).toMatchObject({ type: 'proposal', kind: 'principle', title: 'Attention is a form of prayer', target_set: 'ps-g8xw', grounds: ['weil-attention'], status: 'open', curated: 'human' });
    expect(f.body.trim()).toBe('Because it is.');
    expect(s.files.get('maps/_index.md')!.body).toContain(id);
    expect(validateSnapshot(s)).toEqual([]);
    const group = groupProposals(s).find((g) => g.key === 'ps-g8xw')!;
    expect(group.open.map((p) => proposalId(p.path))).toEqual([id]);
    await expect(saveProposal(brain, { kind: 'amendment', title: 'x', target_set: 'ps-g8xw', rationale: 'r', grounds: [] })).rejects.toThrow();
  });
});

describe('accepting a link proposal adds the ground (schema §4.7, 2026-09-12)', () => {
  const link = (target: string, grounds: string[], from?: string): BrainFile<ProposalFm> => ({
    path: 'maps/proposals/P-20260912-001.md', sha: '', encrypted: false, body: 'Evidence.\n',
    fm: { type: 'proposal', kind: 'link', title: 'Ground it', target_set: target.split('/')[0]!, target, grounds, ...(from ? { from_source: from } : {}), status: 'open', curated: 'agent-proposed', created: '2026-09-12T10:00:00Z', updated: '2026-09-12T10:00:00Z' },
  });
  async function connectedWithDriver() {
    const state: SnapshotState = { current: null, stale: false, loading: false, error: null };
    const brain = new BrainService(state);
    const driver = await MemoryDriver.create(seed());
    await brain.connect(driver);
    return { brain, driver };
  }
  async function withOpenLink(brain: BrainService, p: BrainFile<ProposalFm>) {
    const s = brain.snapshot!;
    const text = `---\ntype: proposal\nkind: link\ntitle: ${p.fm.title}\ntarget_set: ${p.fm.target_set}\ntarget: ${p.fm.target}\n${p.fm.from_source ? `from_source: ${p.fm.from_source}\n` : ''}grounds:\n${p.fm.grounds!.map((g) => `  - ${g}`).join('\n')}\nstatus: open\ncurated: agent-proposed\ncreated: ${p.fm.created}\nupdated: ${p.fm.updated}\n---\nEvidence.\n`;
    await brain.commit({ message: 'Add proposal: P-20260912-001', expectedHead: s.head, writes: [{ path: p.path, text }], deletes: [] });
    return brain.snapshot!.files.get(p.path) as BrainFile<ProposalFm>;
  }
  it('names what is still to add: the proposal\'s sources not yet grounds, or the source it came from', async () => {
    const brain = await connected();
    const s = brain.snapshot!;
    expect(groundsToAdd(s, link('ps-g8xw/courage-before-comfort', ['weil-attention']))).toEqual({ path: 'principles/ps-g8xw/courage-before-comfort.md', sources: ['weil-attention'], add: ['weil-attention'] });
    expect(groundsToAdd(s, link('ps-g8xw/courage-before-comfort', ['aurelius-meditations-4-3']))?.add).toEqual([]); // a ground already
    expect(groundsToAdd(s, link('ps-g8xw/courage-before-comfort', [], 'weil-attention'))?.add).toEqual(['weil-attention']);
    expect(groundsToAdd(s, link('ps-g8xw/courage-before-comfort', ['no-such-source']))?.add).toEqual([]); // never a missing source
    expect(groundsToAdd(s, link('ps-g8xw/gone', ['weil-attention']))).toBeNull();
  });
  it('accepts in two commits: the decision, then the ground in the frontmatter and the body', async () => {
    const { brain, driver } = await connectedWithDriver();
    const p = await withOpenLink(brain, link('ps-g8xw/courage-before-comfort', ['weil-attention']));
    const before = brain.snapshot!.head;
    const r = await acceptLink(brain, p);
    expect(r).toEqual({ path: 'principles/ps-g8xw/courage-before-comfort.md', added: ['weil-attention'] });
    const s = brain.snapshot!;
    const history = await driver.history({ limit: 3 });
    expect(history.map((c) => c.message)).toEqual(['Edit principle: Courage before comfort', 'Decide: P-20260912-001', 'Add proposal: P-20260912-001']);
    expect(s.head).not.toBe(before);
    const principle = s.files.get(r.path)!;
    expect((principle.fm as { grounds: string[] }).grounds).toContain('weil-attention');
    expect(principle.body).toContain('[[sources/weil-attention/raw]] ([raw](../../sources/weil-attention/raw.md))');
    expect((s.files.get(p.path)!.fm as ProposalFm).status).toBe('accepted');
    expect(groundsToAdd(s, s.files.get(p.path) as BrainFile<ProposalFm>)?.add).toEqual([]);
    expect(validateSnapshot(s).filter((i) => i.level === 'refusal')).toEqual([]);
  });
  it('a source that is a ground already: the decision only, nothing added', async () => {
    const { brain, driver } = await connectedWithDriver();
    const p = await withOpenLink(brain, link('ps-g8xw/courage-before-comfort', ['aurelius-meditations-4-3']));
    const r = await acceptLink(brain, p);
    expect(r.added).toEqual([]);
    expect((await driver.history({ limit: 1 }))[0]!.message).toBe('Decide: P-20260912-001');
  });
  it('refuses when the principle is gone, and writes nothing', async () => {
    const brain = await connected();
    const p = await withOpenLink(brain, link('ps-g8xw/gone', ['weil-attention']));
    const head = brain.snapshot!.head;
    await expect(acceptLink(brain, p)).rejects.toThrow(/no longer in the brain/);
    await expect(addGround(brain, p)).rejects.toThrow(/no longer in the brain/);
    expect(brain.snapshot!.head).toBe(head);
    expect((brain.snapshot!.files.get(p.path)!.fm as ProposalFm).status).toBe('open');
  });
});
