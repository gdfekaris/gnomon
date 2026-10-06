// Sealing keys on the phone (spec §6.5, schema §7.20; Phase 5 block S3) over
// MemoryDriver: setup, recovery on a second device, enrolling a desktop key
// from its request, revoking, forgetting. Each result is checked with core's
// verifier as well, so the app writes only what verification accepts.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  KEYS_DIR, PhraseError, ROOT_PATH, SK_ED25519, concat, entropyToPhrase, keyRecords, makeRequest, requestPath, sshString, toBase64, verifySeals,
} from '@gnomon/core';
import { MemoryDriver } from '@gnomon/storage';
import { readBrainBytes } from '@gnomon/storage/testing';
import { BrainService, type SnapshotState } from '../src/lib/services/brain';
import {
  type SealingContext, beginSetup, cleanLabel, confirmPositions, defaultLabel, describeSealing, emptySealing, enrollRequest, finishSetup, forgetDeviceKey, loadSealing,
  memorySealStore, readSealingFiles, recoverDevice, revocationPoint, revokeKey, wordsMatch,
} from '../src/lib/services/sealing';

const fresh = (): SnapshotState => ({ current: null, stale: false, loading: false, error: null });
const AT = '2026-10-05T12:00:00Z';

let plain: MemoryDriver;
let phone: SealingContext;

/** A device: its own store and state, the same brain. */
async function device(): Promise<SealingContext> {
  const brain = new BrainService(fresh());
  await brain.connect(plain);
  const ctx: SealingContext = { brain, plain, store: memorySealStore(), brainId: 'me/brain', state: emptySealing() };
  await loadSealing(ctx);
  return ctx;
}

/** Set up sealing on `ctx`, returning the phrase the user wrote down. */
async function setUp(ctx: SealingContext, label = 'iPhone'): Promise<string> {
  const { entropy, words } = await beginSetup();
  await finishSetup(ctx, entropy, label, AT);
  return words.join(' ');
}

const skPub = (fill: number) => `${SK_ED25519} ${toBase64(concat(sshString(SK_ED25519), sshString(new Uint8Array(32).fill(fill)), sshString('ssh:')))}`;
const messages = async () => (await plain.history({ limit: 10 })).map((c) => c.message);

beforeEach(async () => {
  plain = await MemoryDriver.create(readBrainBytes());
  phone = await device();
});

describe('sealing setup', () => {
  it('starts off', () => {
    expect(phone.state.status).toBe('off');
  });

  it('commits the root record and this device’s enrollment in one Set up sealing commit; the device pins the root', async () => {
    const { entropy, words, fingerprint } = await beginSetup();
    expect(words).toHaveLength(24);
    await finishSetup(phone, entropy, '  My   iPhone ', AT);
    expect(entropy.every((b) => b === 0)).toBe(true);
    expect((await messages())[0]).toBe('Set up sealing');
    expect(phone.state.status).toBe('on');
    expect(phone.state.root).toBe(fingerprint);
    expect(phone.state.keys.map((k) => [k.label, k.device, k.thisDevice])).toEqual([['My iPhone', 'phone', true]]);
    const record = (await phone.store.get('me/brain'))!;
    expect(record.key.extractable).toBe(false);
    expect(record.heads).toEqual({});
    const files = await readSealingFiles(plain);
    expect([...files.keys()].sort()).toEqual([`${KEYS_DIR}${record.keyId}.json`, ROOT_PATH]);
    const { enrolled, findings } = await keyRecords(files, record.root);
    expect(findings).toEqual([]);
    expect([...enrolled.keys()]).toEqual([record.keyId]);
  });

  it('refuses a second setup on a sealed brain', async () => {
    await setUp(phone);
    const other = await device();
    const { entropy } = await beginSetup();
    await expect(finishSetup(other, entropy, 'Other', AT)).rejects.toThrow(/already has sealing set up/);
    expect(entropy.every((b) => b === 0)).toBe(true);
  });

  it('asks three distinct words back and checks them', async () => {
    const pos = confirmPositions();
    expect(new Set(pos).size).toBe(3);
    expect(pos.every((p) => p >= 0 && p < 24)).toBe(true);
    const words = await entropyToPhrase(new Uint8Array(32).fill(1));
    expect(wordsMatch(words, [0, 5, 23], [words[0]!, ` ${words[5]!.toUpperCase()} `, words[23]!])).toBe(true);
    expect(wordsMatch(words, [0, 5, 23], [words[0]!, words[6]!, words[23]!])).toBe(false);
  });

  it('names keys on one line, and refuses an empty name', () => {
    expect(cleanLabel(' a\n b ')).toBe('a b');
    expect(cleanLabel('x'.repeat(60))).toHaveLength(40);
    expect(() => cleanLabel('   ')).toThrow();
    expect(defaultLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('iPhone');
  });
});

describe('a second device', () => {
  it('sees a sealed brain it has no key for, and adds itself from the phrase', async () => {
    const phrase = await setUp(phone);
    const second = await device();
    expect(second.state.status).toBe('recover');
    expect(second.state.root).toBe(phone.state.root);
    await recoverDevice(second, phrase.toUpperCase(), 'Old phone', AT);
    expect((await messages())[0]).toBe('Enroll key: Old phone');
    expect(second.state.status).toBe('on');
    expect(second.state.keys.map((k) => [k.label, k.thisDevice]).sort()).toEqual([['Old phone', true], ['iPhone', false]]);
    expect((await second.store.get('me/brain'))!.root).toEqual((await phone.store.get('me/brain'))!.root);
  });

  it('refuses another brain’s phrase, and a phrase that does not check out', async () => {
    await setUp(phone);
    const second = await device();
    const wrong = (await entropyToPhrase(new Uint8Array(32).fill(9))).join(' ');
    await expect(recoverDevice(second, wrong, 'X', AT)).rejects.toThrow(/not this brain’s recovery phrase/);
    await expect(recoverDevice(second, 'abandon '.repeat(24), 'X', AT)).rejects.toThrow(PhraseError);
    expect(second.state.status).toBe('recover');
    expect(await second.store.get('me/brain')).toBeUndefined();
  });
});

describe('desktop keys', () => {
  it('lists a request, enrolls it with the phrase, and removes the request in the same commit', async () => {
    const phrase = await setUp(phone);
    const req = await makeRequest({ pub: skPub(4), label: 'YubiKey', at: AT });
    const head = await plain.head();
    await plain.commit({ message: 'Request key: YubiKey', expectedHead: head, writes: [{ path: req.path, text: req.text }], deletes: [] });
    await phone.brain.refresh();
    await loadSealing(phone);
    expect(phone.state.requests.map((r) => r.label)).toEqual(['YubiKey']);
    await expect(enrollRequest(phone, req.key, (await entropyToPhrase(new Uint8Array(32).fill(9))).join(' '), AT)).rejects.toThrow(/not this brain’s recovery phrase/);
    await enrollRequest(phone, req.key, phrase, AT);
    expect((await messages())[0]).toBe('Enroll key: YubiKey');
    expect(phone.state.requests).toEqual([]);
    expect(phone.state.keys.map((k) => [k.label, k.device]).sort()).toEqual([['YubiKey', 'fido'], ['iPhone', 'phone']]);
    expect((await readSealingFiles(plain)).has(requestPath(req.key))).toBe(false);
  });

  it('revokes another key at its last seal, refuses its own, and the result verifies', async () => {
    const phrase = await setUp(phone);
    const second = await device();
    await recoverDevice(second, phrase, 'Old phone', AT);
    await phone.brain.refresh();
    await loadSealing(phone);
    const old = phone.state.keys.find((k) => !k.thisDevice)!;
    expect(await revocationPoint(phone, old.key)).toEqual({ last_seq: 0, last: null });
    await expect(revokeKey(phone, (await phone.store.get('me/brain'))!.keyId, phrase, AT)).rejects.toThrow(/cannot revoke its own key/);
    await revokeKey(phone, old.key, phrase, AT);
    expect((await messages())[0]).toBe('Revoke key: Old phone');
    expect(phone.state.keys.find((k) => k.key === old.key)?.revoked).toBe(true);
    await expect(revokeKey(phone, old.key, phrase, AT)).rejects.toThrow(/already revoked/);
    await loadSealing(second);
    expect(second.state.status).toBe('unenrolled');
    const record = (await phone.store.get('me/brain'))!;
    const r = await verifySeals({ captures: [], sources: [], gnomon: await readSealingFiles(plain), attachmentDigest: async () => undefined }, record.root, {});
    expect(r.findings).toEqual([]);
  });
});

describe('what the device trusts', () => {
  it('forgets its key and pins, leaving the brain unchanged', async () => {
    await setUp(phone);
    const before = await plain.head();
    await forgetDeviceKey(phone);
    expect(await plain.head()).toBe(before);
    expect(phone.state.status).toBe('recover');
  });

  it('reports a replaced root record as a mismatch, never as on', async () => {
    await setUp(phone);
    const record = (await phone.store.get('me/brain'))!;
    const files = await readSealingFiles(plain);
    const fake = JSON.stringify({ v: 1, alg: 'ed25519', pub: record.pub, id: record.keyId });
    files.set(ROOT_PATH, fake);
    expect((await describeSealing(files, record)).status).toBe('mismatch');
    files.delete(ROOT_PATH);
    expect((await describeSealing(files, record)).status).toBe('mismatch');
  });
});
