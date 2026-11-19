// A sealed brain for tests (schema §11): the fixture brain with a root, a
// phone key, and a FIDO key enrolled, and every capture sealed by the phone.
// `skSigner` stands in for a YubiKey: it makes the SSHSIG a real one makes
// (OpenSSH's vectors and `ssh-keygen -Y verify` keep it honest).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type BrainSnapshot, type Heads, type PinnedRevocations, type Signer, SEAL_NAMESPACE, SK_ED25519, buildManifest, buildSnapshot, concat, deriveRoot, digest, ed25519Signer, isFrontmatterPath, keyId,
  loadSodium, makeEnrollment, makeSeal, rootFile, sealContent, sealInputFromSnapshot, sealPosition, sha256, sourceContent, sshString, toBase64, utf8, verifySeals,
} from '../src/index';
import { FIXTURE, readBrain } from './brains';

export const AT = '2026-10-05T12:00:00Z';

const u32 = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);

/** An `sk-ed25519` signer that signs as a FIDO authenticator would, with the given flags. */
export async function skSigner(seed: Uint8Array, opts: { flags?: number; namespace?: string; application?: string } = {}): Promise<Signer> {
  const sodium = await loadSodium();
  const pair = sodium.crypto_sign_seed_keypair(seed);
  const application = opts.application ?? 'ssh:';
  const blob = concat(sshString(SK_ED25519), sshString(pair.publicKey), sshString(application));
  const pub = `${SK_ED25519} ${toBase64(blob)} test-yubikey`;
  let counter = 0x1000;
  return {
    alg: 'sk-ed25519',
    pub,
    keyId: await keyId('sk-ed25519', pub),
    async sign(message) {
      const flags = opts.flags ?? 0x01;
      const ns = opts.namespace ?? SEAL_NAMESPACE;
      counter += 1;
      const hm = new Uint8Array(await crypto.subtle.digest('SHA-512', new Uint8Array(message)));
      const d = concat(utf8('SSHSIG'), sshString(ns), sshString(''), sshString('sha512'), sshString(hm));
      const signed = concat(await sha256(utf8(application)), new Uint8Array([flags]), u32(counter), await sha256(d));
      const sig = sodium.crypto_sign_detached(signed, pair.privateKey);
      const sigBlob = concat(sshString(SK_ED25519), sshString(sig), new Uint8Array([flags]), u32(counter));
      const all = concat(utf8('SSHSIG'), u32(1), sshString(blob), sshString(ns), sshString(''), sshString('sha512'), sshString(sigBlob));
      const b64 = toBase64(all);
      return ['-----BEGIN SSH SIGNATURE-----', ...(b64.match(/.{1,70}/g) ?? []), '-----END SSH SIGNATURE-----'].join('\n');
    },
  };
}

export interface World {
  files: Map<string, string>;
  bytes: Map<string, Uint8Array>;
  gnomon: Map<string, string>;
  root: Signer & { wipe(): void };
  phone: Signer;
  fido: Signer;
  heads: Heads;
}

export function snap(w: Pick<World, 'files' | 'bytes'>): BrainSnapshot {
  const tree = [...w.files.keys(), ...w.bytes.keys()].map((path) => ({ path, sha: '', size: 0 }));
  return buildSnapshot({ head: 'HEAD', tree, texts: new Map([...w.files].map(([p, text]) => [p, { text, sha: '' }])) });
}

/** Seal one capture with `signer` and record the seal and the head. */
export async function seal(w: World, signer: Signer, stem: string, kind: 'capture' | 'attest' = 'capture', at = AT): Promise<string> {
  const f = snap(w).files.get(`inbox/${stem}.md`)!;
  const fm = f.fm as { note?: string; attachment?: string };
  const content = await sealContent({ stem, body: f.body, note: fm.note, attachment: fm.attachment }, fm.attachment ? w.bytes.get(`inbox/${fm.attachment}`) : undefined);
  const s = await makeSeal(signer, { kind, stem, at, content }, await sealPosition(w.gnomon, signer.keyId, w.heads[signer.keyId]));
  w.gnomon.set(s.path, s.text);
  w.heads[signer.keyId] = s.head;
  return s.path;
}

export async function world(): Promise<World> {
  const files = new Map<string, string>();
  const bytes = new Map<string, Uint8Array>();
  for (const [path, text] of readBrain(FIXTURE)) {
    if (isFrontmatterPath(path)) files.set(path, text);
    else if (!path.endsWith('.md') && !path.endsWith('.gitkeep')) bytes.set(path, new Uint8Array(readFileSync(join(FIXTURE, path))));
  }
  const root = await deriveRoot(new Uint8Array(32).fill(7));
  const phone = await ed25519Signer(new Uint8Array(32).fill(1));
  const fido = await skSigner(new Uint8Array(32).fill(2));
  const gnomon = new Map<string, string>();
  const r = rootFile(root);
  gnomon.set(r.path, r.text);
  for (const [k, label] of [[phone, 'iPhone'], [fido, 'YubiKey']] as const) {
    const e = await makeEnrollment(root, { alg: k.alg, pub: k.pub, label, at: AT });
    gnomon.set(e.path, e.text);
  }
  const w: World = { files, bytes, gnomon, root, phone, fido, heads: {} };
  for (const stem of ['20260901-081500-k3m', '20260902-190433-p9r', '20260905-143012-x7q', '20260906-070000-2bq']) await seal(w, phone, stem);
  return w;
}

const inputOf = (w: World) => sealInputFromSnapshot(snap(w), w.gnomon, async (p) => (w.bytes.has(p) ? digest(w.bytes.get(p)!) : undefined));

export async function check(w: World, pinned: Heads = w.heads, revocations: PinnedRevocations = {}) {
  return verifySeals(inputOf(w), { id: w.root.keyId, pub: w.root.pub }, pinned, revocations);
}

async function put(w: World, signer: Signer, req: Parameters<typeof makeSeal>[1]): Promise<string> {
  const s = await makeSeal(signer, req, await sealPosition(w.gnomon, signer.keyId, w.heads[signer.keyId]));
  w.gnomon.set(s.path, s.text);
  w.heads[signer.keyId] = s.head;
  return s.path;
}

/** The curator seals a source as it stands (schema §11.5, version 2), replacing its current seal when it has one. */
export async function sealSource(w: World, signer: Signer, slug: string, basis: 'ratify' | 'create' | 'attest' = 'ratify', at = AT): Promise<string> {
  const input = inputOf(w);
  const src = input.sources.find((s) => s.path === `sources/${slug}/raw.md`)!;
  const now = (await check(w, {})).current.sources.get(slug);
  const content = await sourceContent({ slug, ...src }, src.attachment ? w.bytes.get(`sources/${slug}/${src.attachment}`) : undefined);
  return put(w, signer, { kind: 'source', slug, basis: now?.payload.basis ?? basis, ...((now?.payload.basis ?? basis) === 'attest' ? { since: now?.payload.since ?? at } : {}), at, content, replaces: now?.digest ?? null });
}

/** The curator signs the principles tree as it stands (schema §11.5, version 2). */
export async function sealPrinciples(w: World, signer: Signer, at = AT): Promise<string> {
  const input = inputOf(w);
  const now = (await check(w, {})).current;
  const manifest = await buildManifest(input.sets!, input.principles!, (slug) => now.sources.get(slug)?.payload.body ?? null);
  return put(w, signer, { kind: 'principles', at, manifest, replaces: now.manifest?.digest ?? null });
}

/** "Seal everything that exists" (schema §7.20): every source the curator holds, then the first manifest. */
export async function fullySeal(w: World): Promise<void> {
  for (const s of inputOf(w).sources) if (s.curated === 'ratified' || s.curated === 'human') await sealSource(w, w.phone, s.path.split('/')[1]!, s.inboxRef ? 'ratify' : 'attest');
  await sealPrinciples(w, w.phone);
}

/** The verdict names by path, for compact assertions. */
export async function verdicts(w: World, pinned?: Heads): Promise<Record<string, string>> {
  const r = await check(w, pinned);
  return Object.fromEntries([...r.verdicts].map(([p, v]) => [p, v.verdict]));
}
