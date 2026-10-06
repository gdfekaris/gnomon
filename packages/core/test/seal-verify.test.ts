// Schema §11.6 against the attack table of security.md §7 (T1–T22): each
// test is one agent action on a sealed brain and the verdict or finding that
// must follow. The clean cases come first: a sealed brain verifies, and the
// curator's own acts (attest, clear, revoke) keep it verifying.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type Signer, decryptSealFiles, deriveRoot, ed25519Signer, encryptBody, encryptSealFiles, importBodyKey, makeEnrollment, makeRequest, makeRevocation, makeSeal,
  rootFile, sealContent, sealPath, sealPosition,
} from '../src/index';
import { AT, type World, check, seal, skSigner, snap, verdicts, world } from './seal-world';

const K3M = '20260901-081500-k3m'; // filed as aurelius-meditations-4-3
const P9R = '20260902-190433-p9r'; // note and PDF, filed as didion-why-i-write
const X7Q = '20260905-143012-x7q'; // note, filed as aurelius-meditations-5-1
const BQ = '20260906-070000-2bq'; // note, unfiled
const cap = (stem: string) => `inbox/${stem}.md`;
const RAW_4_3 = 'sources/aurelius-meditations-4-3/raw.md';
const RAW_DIDION = 'sources/didion-why-i-write/raw.md';

let w: World;
beforeEach(async () => {
  w = await world();
});

const edit = (path: string, f: (t: string) => string) => w.files.set(path, f(w.files.get(path)!));
const codes = async (pinned = w.heads) => (await check(w, pinned)).findings.map((f) => f.code);
const agent = () => ed25519Signer(new Uint8Array(32).fill(66));

/** The curator clears a capture: the file goes, a tombstone is sealed (schema §7.19). */
async function clear(stem: string, filedAs: string | null) {
  w.files.delete(cap(stem));
  const s = await makeSeal(w.phone, { kind: 'clear', stem, at: AT, filed_as: filedAs }, await sealPosition(w.gnomon, w.phone.keyId, w.heads[w.phone.keyId]));
  w.gnomon.set(s.path, s.text);
  w.heads[w.phone.keyId] = s.head;
}

describe('a sealed brain', () => {
  it('verifies: every capture and every filed copy, no findings, heads to pin', async () => {
    const r = await check(w);
    expect(r.locked).toBe(false);
    expect(r.findings).toEqual([]);
    expect(Object.fromEntries([...r.verdicts].map(([p, v]) => [p, v.verdict]))).toEqual({
      [cap(K3M)]: 'verified', [cap(P9R)]: 'verified', [cap(X7Q)]: 'verified', [cap(BQ)]: 'verified',
      [RAW_4_3]: 'verified', [RAW_DIDION]: 'verified', 'sources/aurelius-meditations-5-1/raw.md': 'verified',
      'sources/weil-attention/raw.md': 'unsealed',
    });
    expect(r.heads).toEqual(w.heads);
  });

  it('verifies a seal made with the YubiKey, and an attested capture with its date', async () => {
    w.files.set(cap('20261005-090000-abc'), '---\ntype: inbox\nstatus: unfiled\ncurated: human\ncreated: 2026-10-05T09:00:00Z\nupdated: 2026-10-05T09:00:00Z\n---\nAn agent wrote this down.\n');
    expect((await verdicts(w))[cap('20261005-090000-abc')]).toBe('unsealed');
    await seal(w, w.fido, '20261005-090000-abc', 'attest', '2026-10-06T08:00:00Z');
    const r = await check(w);
    expect(r.findings).toEqual([]);
    expect(r.verdicts.get(cap('20261005-090000-abc'))).toEqual({ verdict: 'attested', since: '2026-10-06T08:00:00Z' });
  });

  it('keeps verifying after the curator clears a filed capture; the source verifies against the tombstoned seal', async () => {
    await clear(K3M, 'aurelius-meditations-4-3');
    const r = await check(w);
    expect(r.findings).toEqual([]);
    expect(r.verdicts.get(RAW_4_3)?.verdict).toBe('verified');
  });

  it('keeps verifying after the root revokes a key at its last good seal', async () => {
    const r = await makeRevocation(w.root, { key: w.phone.keyId, last_seq: 4, last: w.heads[w.phone.keyId]!.digest, at: AT });
    w.gnomon.set(r.path, r.text);
    expect(await codes()).toEqual([]);
  });

  it('extends its chain from the tree when the device lost its stored head', async () => {
    delete w.heads[w.phone.keyId];
    const pos = await sealPosition(w.gnomon, w.phone.keyId, undefined);
    expect(pos.seq).toBe(5);
  });
});

describe('the attack table (security.md §7)', () => {
  it('T1: editing a sealed capture’s body breaks the capture, not its untouched source', async () => {
    edit(cap(K3M), (t) => `${t}And an added sentence.\n`);
    const v = await verdicts(w);
    expect([v[cap(K3M)], v[RAW_4_3]]).toEqual(['broken', 'verified']);
    expect((await check(w)).heads).toBeNull();
  });

  it('T2: editing, adding, or removing a note breaks the capture', async () => {
    edit(cap(X7Q), (t) => t.replace('note: Same book, different chapter.', 'note: Same book.'));
    expect((await check(w)).verdicts.get(cap(X7Q))).toEqual({ verdict: 'broken', why: 'its note differs from the sealed one' });
    w = await world();
    edit(cap(X7Q), (t) => t.replace('note: Same book, different chapter.\n', ''));
    expect((await check(w)).verdicts.get(cap(X7Q))).toEqual({ verdict: 'broken', why: 'its note was added or removed' });
  });

  it('T3: replacing the attachment breaks the capture', async () => {
    w.bytes.set(`inbox/${P9R}.pdf`, new Uint8Array([37, 80, 68, 70]));
    expect((await check(w)).verdicts.get(cap(P9R))).toEqual({ verdict: 'broken', why: 'its attached file differs from the sealed one' });
  });

  it('T4: filing with an altered passage breaks the source', async () => {
    edit(RAW_4_3, (t) => t.replace('Men seek retreats', 'Men seek comfort'));
    expect((await check(w)).verdicts.get(RAW_4_3)).toEqual({ verdict: 'broken', why: 'its passage differs from the sealed capture' });
  });

  it('T5: filing with a different original breaks the source', async () => {
    w.bytes.set('sources/didion-why-i-write/original.pdf', new Uint8Array([1, 2, 3]));
    expect((await check(w)).verdicts.get(RAW_DIDION)).toEqual({ verdict: 'broken', why: 'its attached file differs from the sealed one' });
  });

  it('T6: editing a filed source after its capture was cleared breaks the source', async () => {
    await clear(K3M, 'aurelius-meditations-4-3');
    edit(RAW_4_3, (t) => `${t}Edited later.\n`);
    expect((await verdicts(w))[RAW_4_3]).toBe('broken');
  });

  it('T7: deleting a sealed capture without a tombstone is a finding', async () => {
    w.files.delete(cap(BQ));
    expect(await codes()).toEqual(['sealed-capture-deleted']);
  });

  it('T8: deleting a seal in the middle of a chain is a gap, pinned or not', async () => {
    w.gnomon.delete(sealPath(w.phone.keyId, 2));
    expect(await codes({})).toEqual(['chain-gap']);
    expect(await codes()).toContain('chain-gap');
  });

  it('T9: deleting the newest seal and its capture is caught by the pinned head (and only by it)', async () => {
    w.gnomon.delete(sealPath(w.phone.keyId, 4));
    w.files.delete(cap(BQ));
    expect(await codes()).toEqual(['rolled-back']);
    expect(await codes({})).toEqual([]);
  });

  it('T10: rolling the brain back past what a verifier accepted is caught', async () => {
    const accepted = structuredClone(w.heads);
    w.gnomon.delete(sealPath(w.phone.keyId, 4));
    expect(await codes(accepted)).toEqual(['rolled-back']);
  });

  it('T11: editing a seal’s payload invalidates it and breaks the capture', async () => {
    const path = sealPath(w.phone.keyId, 1);
    const file = JSON.parse(w.gnomon.get(path)!);
    file.payload.body = `sha256:${'0'.repeat(64)}`;
    w.gnomon.set(path, JSON.stringify(file));
    const r = await check(w);
    expect(r.findings.map((f) => [f.code, f.detail])).toContainEqual(['seal-invalid', 'its signature does not verify']);
    expect(r.verdicts.get(cap(K3M))?.verdict).toBe('broken');
  });

  it('T12: sealing with its own key is an unknown key, and the capture it names is broken', async () => {
    edit(cap(K3M), (t) => `${t}Tampered.\n`);
    await seal(w, await agent(), K3M, 'attest');
    const r = await check(w);
    expect(r.findings.map((f) => f.code)).toEqual(['unknown-key']);
    expect(r.verdicts.get(cap(K3M))?.verdict).toBe('broken');
  });

  it('T13: enrolling its own key, signed by its own root, is an invalid key record', async () => {
    const a = await agent();
    const e = await makeEnrollment(await deriveRoot(new Uint8Array(32).fill(99)), { alg: a.alg, pub: a.pub, label: 'iPhone', at: AT });
    w.gnomon.set(e.path, e.text);
    await seal(w, a, BQ, 'attest');
    expect(await codes()).toEqual(['key-record-invalid', 'unknown-key']);
  });

  it('T14: replacing root.json is a finding; its root signs nothing the verifier trusts', async () => {
    const fake = await deriveRoot(new Uint8Array(32).fill(99));
    const r = rootFile(fake);
    w.gnomon.set(r.path, r.text);
    expect(await codes()).toEqual(['root-replaced']);
  });

  it('T15: a valid seal copied to another place is invalid, and its capture broken', async () => {
    w.gnomon.set(sealPath(w.phone.keyId, 5), w.gnomon.get(sealPath(w.phone.keyId, 1))!);
    const r = await check(w);
    expect(r.findings.map((f) => [f.code, f.detail])).toContainEqual(['seal-invalid', 'its key or seq disagrees with its path']);
    expect(r.verdicts.get(cap(K3M))?.verdict).toBe('broken');
  });

  it('T16: a capture written in the user’s name has no seal and is never verified', async () => {
    w.files.set(cap('20261005-100000-xyz'), '---\ntype: inbox\nstatus: unfiled\ncurated: human\ncreated: 2026-10-05T10:00:00Z\nupdated: 2026-10-05T10:00:00Z\n---\nI never said this.\n');
    const r = await check(w);
    expect(r.findings).toEqual([]);
    expect(r.verdicts.get(cap('20261005-100000-xyz'))).toEqual({ verdict: 'unsealed' });
  });

  it('T17: a key request enrolls nothing; seals by the requested key are an unknown key', async () => {
    const a = await skSigner(new Uint8Array(32).fill(77));
    const req = await makeRequest({ pub: a.pub, label: 'YubiKey', at: AT });
    w.gnomon.set(req.path, req.text);
    expect(await codes()).toEqual([]);
    await seal(w, a, BQ, 'attest');
    expect(await codes()).toEqual(['unknown-key']);
  });

  it('T18: a forged tombstone does not verify, and the capture counts as deleted', async () => {
    const a = await agent();
    const spoof: Signer = { ...a, keyId: w.phone.keyId };
    w.files.delete(cap(BQ));
    const s = await makeSeal(spoof, { kind: 'clear', stem: BQ, at: AT, filed_as: null }, await sealPosition(w.gnomon, w.phone.keyId, w.heads[w.phone.keyId]));
    w.gnomon.set(s.path, s.text);
    expect(await codes()).toEqual(['seal-invalid', 'sealed-capture-deleted']);
  });

  it('T19: a seal by a revoked key, after its revocation, is a finding and breaks what it names', async () => {
    const r = await makeRevocation(w.root, { key: w.fido.keyId, last_seq: 0, last: null, at: AT });
    w.gnomon.set(r.path, r.text);
    await seal(w, w.fido, BQ, 'attest');
    const res = await check(w);
    expect(res.findings.map((f) => f.code)).toEqual(['sealed-after-revocation']);
    expect(res.verdicts.get(cap(BQ))?.verdict).toBe('broken');
  });

  it('T20: a fork (another seal at a pinned seq, even a validly signed one) is caught', async () => {
    const accepted = structuredClone(w.heads);
    const content = await sealContent({ stem: BQ, body: snap(w).files.get(cap(BQ))!.body, note: 'Heard this quoted; find the source.' });
    const s = await makeSeal(w.phone, { kind: 'attest', stem: BQ, at: '2026-10-07T00:00:00Z', content }, { seq: 4, prev: (await sealPosition(new Map([...w.gnomon].filter(([p]) => p !== sealPath(w.phone.keyId, 4))), w.phone.keyId)).prev });
    w.gnomon.set(s.path, s.text);
    expect(await codes(accepted)).toEqual(['rolled-back']);
  });

  it('a seal whose prev skips the chain is a broken chain', async () => {
    const content = await sealContent({ stem: BQ, body: 'x' });
    const s = await makeSeal(w.phone, { kind: 'attest', stem: BQ, at: AT, content }, { seq: 5, prev: `sha256:${'1'.repeat(64)}` });
    w.gnomon.set(s.path, s.text);
    expect(await codes()).toContain('chain-broken');
  });

  it('T21: on an encrypted brain, verification is locked without the key and works the same with it', async () => {
    const key = await importBodyKey(crypto.getRandomValues(new Uint8Array(32)));
    for (const { path, text } of await encryptSealFiles(key, w.gnomon)) w.gnomon.set(path, text);
    expect((await check(w)).locked).toBe(true);
    w.gnomon = await decryptSealFiles(key, w.gnomon);
    expect(await codes()).toEqual([]);
    edit(cap(K3M), (t) => `${t}Tampered.\n`);
    edit(RAW_4_3, (t) => `${t}Tampered.\n`);
    w.gnomon.delete(sealPath(w.phone.keyId, 2));
    const r = await check(w, {});
    expect(r.findings.map((f) => f.code)).toEqual(['chain-gap']);
    expect([r.verdicts.get(cap(K3M))?.verdict, r.verdicts.get(RAW_4_3)?.verdict]).toEqual(['broken', 'broken']);
  });

  it('T21: a capture body still in ciphertext locks verification', async () => {
    const key = await importBodyKey(crypto.getRandomValues(new Uint8Array(32)));
    const body = await encryptBody(key, cap(K3M), 'whatever\n');
    edit(cap(K3M), (t) => t.slice(0, t.indexOf('---\n', 4) + 4) + body);
    expect((await check(w)).locked).toBe(true);
  });

  it('T22: editing metadata is out of scope and is not caught', async () => {
    edit(RAW_4_3, (t) => t.replace(/^title: .*$/m, 'title: A new title').replace(/^curated: .*$/m, 'curated: human'));
    edit(cap(BQ), (t) => t.replace('status: unfiled', 'status: filed\nfiled_as: weil-attention'));
    const r = await check(w);
    expect(r.findings).toEqual([]);
    expect([r.verdicts.get(RAW_4_3)?.verdict, r.verdicts.get(cap(BQ))?.verdict]).toEqual(['verified', 'verified']);
  });
});
