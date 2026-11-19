// Verification — schema §11.6, step by step. Pure over its input: the
// captures, sources, sets, and principles with plaintext bodies, every file
// under .gnomon/ with seal files decrypted, and a way to digest an
// attachment. The caller holds the pinned root, heads, and revocations,
// which never come from the brain. Version 2 (integrity-proposal.md): a
// source's verdict comes from its own seal, by slug and bytes, and the
// principles tree from its manifest; `inbox_ref` and `curated` grant nothing.
import { isEncryptedBody } from '../crypto/body';
import type { BrainSnapshot } from '../schema/types';
import { bodyBytes, digest, signedBytes, utf8 } from './encoding';
import { type SealAlg, verifySignature } from './keys';
import { type Head, type Heads, RESERVE_SET, type TreePrinciple, type TreeSet, descriptorDigest, principleDigest, sealDigest, textValue } from './make';
import {
  type ClearSealPayload, type ContentSealPayload, type EnrollPayload, KEYS_DIR, type PrinciplesSealPayload, REQUESTS_DIR, ROOT_PATH, type RevokePayload, SEALS_DIR, type SealPayload, type SourceSealPayload,
  checkEnrollPayload, checkRevokePayload, checkSealPayload, parseRootRecord, parseSealPath, parseSigned, revocationPath, stemOf,
} from './records';

export interface SealCapture { path: string; stem: string; body: string; note?: string | undefined; attachment?: string | undefined }
export interface SealSource {
  path: string; inboxRef?: string | undefined; body: string; attachment?: string | undefined;
  /** version 2: the attribution a source seal covers, as text values (schema §11.1), and `curated`, read only to report an unsealed source */
  title?: string | null; author?: string | null; work?: string | null; year?: string | null; curated?: string | undefined;
}
export interface SealSet extends TreeSet { path: string }
export interface SealPrinciple extends TreePrinciple { path: string; /** the `set` field, which must equal the folder */ fmSet?: string | undefined }
export interface SealInput {
  captures: SealCapture[];
  sources: SealSource[];
  /** version 2: the principles tree; `set` is the folder a principle sits in, `_reserve` for the reserve */
  sets?: SealSet[];
  principles?: SealPrinciple[];
  /** every file under `.gnomon/`, path → text, seal files decrypted */
  gnomon: ReadonlyMap<string, string>;
  /** the digest (schema §11.1) of the attachment at a path, or undefined when it does not exist */
  attachmentDigest(path: string): Promise<string | undefined>;
}
export interface PinnedRoot { id: string; pub: string }

export type FindingCode =
  | 'root-replaced' | 'key-record-invalid' | 'unknown-key' | 'seal-invalid' | 'chain-gap' | 'chain-broken' | 'rolled-back' | 'sealed-after-revocation' | 'sealed-capture-deleted'
  | 'revocation-removed' | 'seal-fork' | 'sealed-source-deleted' | 'unsealed-source' | 'principles-changed';
export interface SealFinding { code: FindingCode; path: string; detail: string }
export type SealVerdict =
  | { verdict: 'verified' }
  | { verdict: 'attested'; since: string }
  | { verdict: 'unsealed' }
  /** a source with no seal of its own that matches its sealed capture: awaiting the curator's review; `since` when that capture is only attested */
  | { verdict: 'pending'; since?: string }
  | { verdict: 'broken'; why: string };
export type DifferenceKind = 'edited' | 'reordered' | 'added' | 'removed' | 'description-edited';
export interface PrinciplesDifference { path: string; kind: DifferenceKind }
/** A revocation a verifier has accepted (schema §11.6): its digest, and the point it revokes at, so the key stays revoked if the file is removed. */
export interface PinnedRevocation { digest: string; last_seq: number; last: string | null }
export type PinnedRevocations = Record<string, PinnedRevocation>;
export interface SealResult {
  /** seal files or bodies are still ciphertext: nothing was verified */
  locked: boolean;
  findings: SealFinding[];
  /** by capture path, source `raw.md` path, `_set.md` path, and principle path */
  verdicts: Map<string, SealVerdict>;
  /** the heads to pin; null unless there is no finding and nothing broken (step 8) */
  heads: Heads | null;
  /** the revocations to pin, with the heads; null on the same condition */
  revocations: PinnedRevocations | null;
  /** a valid principles manifest exists: from then on unsealed is a finding and only sealed material is assembled */
  fullySealed: boolean;
  /** how the principles tree differs from its current manifest; each is also a `principles-changed` finding */
  differences: PrinciplesDifference[];
  /** digest of the current seal per source slug, and of the current manifest: what a replacement names in `replaces` */
  current: { sources: Map<string, { digest: string; payload: SourceSealPayload }>; manifest: { digest: string; payload: PrinciplesSealPayload } | null };
}

/** The input for a snapshot whose bodies are decrypted; attachments are digested by the caller. */
export function sealInputFromSnapshot(s: BrainSnapshot, gnomon: ReadonlyMap<string, string>, attachmentDigest: (path: string) => Promise<string | undefined>): SealInput {
  const str = (v: unknown) => (v === undefined || v === null ? undefined : String(v));
  return {
    captures: s.byType('inbox').map((f) => ({ path: f.path, stem: f.path.slice('inbox/'.length, -'.md'.length), body: f.body, note: str(f.fm.note), attachment: f.fm.attachment })),
    sources: s.byType('source').map((f) => ({
      path: f.path, inboxRef: f.fm.inbox_ref, body: f.body, attachment: f.fm.attachment,
      title: textValue(f.fm.title), author: textValue(f.fm.author), work: textValue(f.fm.work), year: textValue(f.fm.year), curated: str(f.fm.curated),
    })),
    sets: s.byType('principle-set').map((f) => ({ path: f.path, slug: f.path.split('/')[1]!, order: f.fm.order, name: f.fm.name, body: f.body })),
    principles: s.byType('principle').map((f) => {
      const [, set, file] = f.path.split('/') as [string, string, string];
      return { path: f.path, set, slug: file.slice(0, -'.md'.length), fmSet: str(f.fm.set), order: f.fm.order, title: f.fm.title, body: f.body, grounds: f.fm.grounds, related: f.fm.related };
    }),
    gnomon,
    attachmentDigest,
  };
}

/** Schema §11.6 step 1 without root.json: the enrollments and revocations the pinned root signed, and what else sits in `.gnomon/keys/`. */
export async function keyRecords(gnomon: ReadonlyMap<string, string>, root: PinnedRoot): Promise<{ enrolled: Map<string, EnrollPayload>; revoked: Map<string, RevokePayload>; revocationDigests: Map<string, string>; findings: SealFinding[] }> {
  const findings: SealFinding[] = [];
  const find = (code: FindingCode, path: string, detail: string) => findings.push({ code, path, detail });
  const keyPaths = [...gnomon.keys()].filter((p) => p.startsWith(KEYS_DIR) && !p.startsWith(REQUESTS_DIR)).sort();
  const enrolled = new Map<string, EnrollPayload>();
  const revoked = new Map<string, RevokePayload>();
  const revocationDigests = new Map<string, string>();
  const rootSigned = async (kind: 'enroll' | 'revoke', payload: { root: string }, sig: string) =>
    payload.root === root.id && (await verifySignature('ed25519', root.pub, sig, signedBytes(kind, payload)));
  for (const path of keyPaths.filter((p) => !p.endsWith('.revoked.json'))) {
    const parsed = parseSigned(gnomon.get(path)!);
    const e = typeof parsed === 'string' ? parsed : await checkEnrollPayload(parsed.payload);
    if (typeof e === 'string') find('key-record-invalid', path, e);
    else if (path !== `${KEYS_DIR}${e.key}.json`) find('key-record-invalid', path, 'its name is not its key id');
    else if (!(await rootSigned('enroll', e, (parsed as { sig: string }).sig))) find('key-record-invalid', path, 'the pinned root did not sign it');
    else enrolled.set(e.key, e);
  }
  for (const path of keyPaths.filter((p) => p.endsWith('.revoked.json'))) {
    const parsed = parseSigned(gnomon.get(path)!);
    const r = typeof parsed === 'string' ? parsed : checkRevokePayload(parsed.payload);
    if (typeof r === 'string') find('key-record-invalid', path, r);
    else if (path !== `${KEYS_DIR}${r.key}.revoked.json`) find('key-record-invalid', path, 'its name is not its key id');
    else if (!enrolled.has(r.key)) find('key-record-invalid', path, 'it revokes a key that is not enrolled');
    else if (!(await rootSigned('revoke', r, (parsed as { sig: string }).sig))) find('key-record-invalid', path, 'the pinned root did not sign it');
    else {
      revoked.set(r.key, r);
      revocationDigests.set(r.key, await digest(signedBytes('revoke', r)));
    }
  }

  return { enrolled, revoked, revocationDigests, findings };
}

interface SealRec { path: string; seq: number; payload?: SealPayload; digest?: string; valid: boolean }

const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);
const extOf = (name: string) => name.slice(name.lastIndexOf('.') + 1);

/** The valid seals of one kind that replace one another: those whose `replaces` names nothing valid are invalid; the current ones are named by no other. */
function replacementChain<P extends { replaces: string | null }>(recs: Array<{ rec: SealRec; payload: P }>, invalid: (rec: SealRec) => void): Array<{ rec: SealRec; payload: P }> {
  let live = recs;
  for (;;) {
    const digests = new Set(live.map((r) => r.rec.digest!));
    const next = live.filter((r) => r.payload.replaces === null || digests.has(r.payload.replaces));
    for (const r of live) if (!next.includes(r)) invalid(r.rec);
    if (next.length === live.length) break;
    live = next;
  }
  const replaced = new Set(live.map((r) => r.payload.replaces));
  return live.filter((r) => !replaced.has(r.rec.digest!));
}

export async function verifySeals(input: SealInput, root: PinnedRoot, pinned: Heads = {}, pinnedRevocations: PinnedRevocations = {}): Promise<SealResult> {
  const findings: SealFinding[] = [];
  const find = (code: FindingCode, path: string, detail: string) => findings.push({ code, path, detail });
  const lockedResult: SealResult = { locked: true, findings: [], verdicts: new Map(), heads: null, revocations: null, fullySealed: false, differences: [], current: { sources: new Map(), manifest: null } };
  const sets = input.sets ?? [];
  const principles = input.principles ?? [];
  for (const [path, text] of input.gnomon) if (path.startsWith(SEALS_DIR) && isEncryptedBody(text)) return lockedResult;
  if ([...input.captures, ...input.sources, ...sets, ...principles].some((f) => isEncryptedBody(f.body))) return lockedResult;

  // 1. Keys.
  const rootText = input.gnomon.get(ROOT_PATH);
  if (rootText !== undefined) {
    const r = parseRootRecord(rootText);
    if (!r || r.id !== root.id || r.pub !== root.pub) find('root-replaced', ROOT_PATH, 'it does not name the pinned root');
  }
  const keys = await keyRecords(input.gnomon, root);
  findings.push(...keys.findings);
  const { enrolled, revoked } = keys;
  // A revocation this verifier accepted and no longer finds, or finds changed: reported, and the key stays revoked at the pinned point.
  for (const [key, pin] of Object.entries(pinnedRevocations)) {
    if (keys.revocationDigests.get(key) === pin.digest) continue;
    find('revocation-removed', revocationPath(key), 'a revocation this verifier accepted is missing or was replaced');
    revoked.set(key, { v: 1, kind: 'revoke', key, last_seq: pin.last_seq, last: pin.last, at: '', root: root.id });
  }

  // 2. Seals.
  const folders = new Map<string, Map<number, SealRec>>();
  for (const path of [...input.gnomon.keys()].filter((p) => p.startsWith(SEALS_DIR)).sort()) {
    const at = parseSealPath(path);
    if (!at) {
      find('seal-invalid', path, 'it is not at a seal path');
      continue;
    }
    const rec: SealRec = { path, seq: at.seq, valid: false };
    const parsed = parseSigned(input.gnomon.get(path)!);
    const payload = typeof parsed === 'string' ? parsed : checkSealPayload(parsed.payload);
    if (typeof payload === 'string') find('seal-invalid', path, payload);
    else {
      rec.payload = payload;
      rec.digest = await sealDigest(payload);
      const key = enrolled.get(at.key);
      if (payload.key !== at.key || payload.seq !== at.seq) find('seal-invalid', path, 'its key or seq disagrees with its path');
      else if (!key) {
        // reported once for the folder below
      } else if (!(await verifySignature(key.alg as SealAlg, key.pub, (parsed as { sig: string }).sig, signedBytes('seal', payload)))) find('seal-invalid', path, 'its signature does not verify');
      else rec.valid = true;
    }
    if (!folders.has(at.key)) folders.set(at.key, new Map());
    folders.get(at.key)!.set(at.seq, rec);
  }
  for (const key of folders.keys()) if (!enrolled.has(key)) find('unknown-key', `${SEALS_DIR}${key}/`, 'no enrolled key signed these seals');

  // 3. Chains.
  for (const [key, recs] of folders) {
    if (!enrolled.has(key)) continue;
    const n = Math.max(...recs.keys());
    for (let seq = 1; seq <= n; seq++) if (!recs.has(seq)) find('chain-gap', `${SEALS_DIR}${key}/`, `seal ${seq} of ${n} is missing`);
    for (const rec of recs.values()) {
      if (!rec.payload) continue;
      if (rec.seq === 1 ? rec.payload.prev !== null : recs.has(rec.seq - 1) && rec.payload.prev !== recs.get(rec.seq - 1)!.digest) find('chain-broken', rec.path, 'its prev does not name the seal before it');
    }
    const r = revoked.get(key);
    if (r) {
      for (const rec of recs.values())
        if (rec.seq > r.last_seq && rec.payload) {
          rec.valid = false;
          find('sealed-after-revocation', rec.path, 'its key was revoked before it');
        }
      if (r.last_seq > 0 && recs.get(r.last_seq)?.digest !== r.last) find('rolled-back', `${SEALS_DIR}${key}/`, `seal ${r.last_seq} differs from the one its revocation names`);
    }
  }
  for (const [key, h] of Object.entries(pinned)) {
    if (folders.get(key)?.get(h.seq)?.digest !== h.digest) find('rolled-back', `${SEALS_DIR}${key}/`, `seal ${h.seq} is missing or differs from the one this verifier accepted`);
  }

  // 4. Captures.
  const content = new Map<string, ContentSealPayload[]>();
  const clears = new Map<string, ClearSealPayload[]>();
  const invalidStems = new Set<string>();
  const invalidSlugs = new Set<string>();
  const sourceSeals = new Map<string, Array<{ rec: SealRec; payload: SourceSealPayload }>>();
  const manifests: Array<{ rec: SealRec; payload: PrinciplesSealPayload }> = [];
  for (const recs of folders.values())
    for (const rec of recs.values()) {
      const p = rec.payload;
      if (!p) continue;
      const stem = stemOf(p);
      if (!rec.valid) {
        if (stem !== undefined) invalidStems.add(stem);
        else if (p.kind === 'source') invalidSlugs.add(p.slug);
      } else if (p.kind === 'clear') clears.set(p.stem, [...(clears.get(p.stem) ?? []), p]);
      else if (p.kind === 'source') sourceSeals.set(p.slug, [...(sourceSeals.get(p.slug) ?? []), { rec, payload: p }]);
      else if (p.kind === 'principles') manifests.push({ rec, payload: p });
      else content.set(p.stem, [...(content.get(p.stem) ?? []), p]);
    }
  const capByStem = new Map(input.captures.map((c) => [c.stem, c]));
  const srcByPath = new Map(input.sources.map((s) => [s.path, s]));
  const broken = new Map<string, string>();
  const attachmentProblem = async (declared: string | undefined, want: ContentSealPayload['attachment'], path: (name: string) => string, name: (n: string) => string): Promise<string | undefined> => {
    if (want === null) return declared === undefined ? undefined : 'it gained an attachment';
    if (declared !== name(want.name)) return 'its attachment field differs from the sealed one';
    const d = await input.attachmentDigest(path(declared));
    return d === undefined ? 'its attached file is missing' : d !== want.digest ? 'its attached file differs from the sealed one' : undefined;
  };
  for (const [stem, seals] of content) {
    const cap = capByStem.get(stem);
    for (const seal of seals) {
      if (cap && !broken.has(cap.path)) {
        const why =
          (await digest(bodyBytes(cap.body))) !== seal.body
            ? 'its passage differs from the sealed one'
            : (cap.note !== undefined) !== (seal.note !== undefined)
              ? 'its note was added or removed'
              : cap.note !== undefined && (await digest(utf8(cap.note))) !== seal.note
                ? 'its note differs from the sealed one'
                : await attachmentProblem(cap.attachment, seal.attachment, (n) => `inbox/${n}`, (n) => n);
        if (why) broken.set(cap.path, why);
      }
    }
    if (!cap) {
      const tombs = clears.get(stem) ?? [];
      if (tombs.length === 0) find('sealed-capture-deleted', `inbox/${stem}.md`, 'a sealed capture is gone and no tombstone says the curator cleared it');
      for (const t of tombs)
        if (t.filed_as !== null && !srcByPath.has(`sources/${t.filed_as}/raw.md`))
          find('sealed-capture-deleted', `sources/${t.filed_as}/raw.md`, 'the source a cleared capture was filed as is gone');
    }
  }

  // 5. Sources: by slug and bytes against `source` seals; a source with none is checked against the capture it names.
  const invalidate = (why: string) => (rec: SealRec) => {
    rec.valid = false;
    find('seal-invalid', rec.path, why);
    if (rec.payload?.kind === 'source') invalidSlugs.add(rec.payload.slug);
  };
  const currentSources = new Map<string, { digest: string; payload: SourceSealPayload }>();
  const sourceVerdicts = new Map<string, SealVerdict>();
  const rawPath = (slug: string) => `sources/${slug}/raw.md`;
  const slugOf = (path: string) => path.split('/')[1]!;
  const same = (a: string | null | undefined, b: string | null) => (a ?? null) === b;
  for (const [slug, recs] of sourceSeals) {
    const current = replacementChain(recs, invalidate('its `replaces` names no seal for this source'));
    if (current.length === 0) continue;
    const path = rawPath(slug);
    if (current.length > 1) {
      find('seal-fork', path, 'more than one seal claims to be the newest for this source');
      broken.set(path, 'two seals disagree about it');
      continue;
    }
    const seal = current[0]!.payload;
    currentSources.set(slug, { digest: current[0]!.rec.digest!, payload: seal });
    const src = srcByPath.get(path);
    if (!src) {
      find('sealed-source-deleted', path, 'a sealed source is gone');
      continue;
    }
    const captureSeals = seal.stem === null ? [] : (content.get(seal.stem) ?? []);
    const why =
      (await digest(bodyBytes(src.body))) !== seal.body
        ? 'its passage differs from the sealed one'
        : ((await attachmentProblem(src.attachment, seal.attachment, (n) => `${dirOf(src.path)}${n}`, (n) => n)) ??
          (!same(src.title, seal.title)
            ? 'its title differs from the sealed one'
            : !same(src.author, seal.author)
              ? 'its author differs from the sealed one'
              : !same(src.work, seal.work)
                ? 'its work differs from the sealed one'
                : !same(src.year, seal.year)
                  ? 'its year differs from the sealed one'
                  : !same(src.inboxRef, seal.stem)
                    ? 'the capture it names differs from the sealed one'
                    : captureSeals.some((c) => c.body !== seal.body || (c.attachment?.digest ?? null) !== (seal.attachment?.digest ?? null))
                      ? 'its seal disagrees with the seal of the capture it names'
                      : undefined));
    if (why) broken.set(path, why);
    else sourceVerdicts.set(path, seal.basis === 'attest' ? { verdict: 'attested', since: seal.since! } : { verdict: 'verified' });
  }
  for (const src of input.sources) {
    if (broken.has(src.path) || sourceVerdicts.has(src.path)) continue;
    const slug = slugOf(src.path);
    if (invalidSlugs.has(slug)) {
      broken.set(src.path, 'a seal naming it is invalid');
      continue;
    }
    const seals = src.inboxRef === undefined ? [] : (content.get(src.inboxRef) ?? []);
    if (src.inboxRef !== undefined && invalidStems.has(src.inboxRef)) {
      broken.set(src.path, 'a seal naming its capture is invalid');
      continue;
    }
    for (const seal of seals) {
      const why =
        (await digest(bodyBytes(src.body))) !== seal.body
          ? 'its passage differs from the sealed capture'
          : await attachmentProblem(src.attachment, seal.attachment, (n) => `${dirOf(src.path)}${n}`, (n) => `original.${extOf(n)}`);
      if (why) {
        broken.set(src.path, why);
        break;
      }
    }
    if (broken.has(src.path)) continue;
    if (seals.length === 0) sourceVerdicts.set(src.path, { verdict: 'unsealed' });
    else if (seals.some((c) => c.kind === 'capture')) sourceVerdicts.set(src.path, { verdict: 'pending' });
    else sourceVerdicts.set(src.path, { verdict: 'pending', since: seals.map((c) => c.at).sort()[0]! });
  }

  // 6. Principles: the tree against the current manifest.
  const currentManifests = replacementChain(manifests, invalidate('its `replaces` names no manifest'));
  const fullySealed = currentManifests.length > 0;
  const differences: PrinciplesDifference[] = [];
  const treeVerdicts = new Map<string, SealVerdict>();
  const manifest = currentManifests.length === 1 ? { digest: currentManifests[0]!.rec.digest!, payload: currentManifests[0]!.payload } : null;
  const setPath = (slug: string) => `principles/${slug}/_set.md`;
  const principlePath = (set: string, slug: string) => `principles/${set}/${slug}.md`;
  if (currentManifests.length > 1) {
    find('seal-fork', 'principles/', 'more than one manifest claims to be the newest');
    for (const f of [...sets, ...principles]) treeVerdicts.set(f.path, { verdict: 'broken', why: 'two manifests disagree about the principles' });
  } else if (manifest) {
    const WHY: Record<DifferenceKind, string> = {
      edited: 'it differs from the sealed one', reordered: 'its place differs from the sealed order', added: 'it is not in the sealed list', removed: 'it is in the sealed list and is gone',
      'description-edited': 'its name or description differs from the sealed one',
    };
    const differ = (path: string, kind: DifferenceKind) => differences.push({ path, kind });
    const groundBody = (slug: string) => currentSources.get(slug)?.payload.body ?? null;
    const bySet = new Map<string, SealPrinciple[]>();
    for (const p of principles) bySet.set(p.set, [...(bySet.get(p.set) ?? []), p]);
    const checkList = async (set: string, listed: ReadonlyArray<{ slug: string; digest: string }>, ordered: boolean) => {
      const here = new Map((bySet.get(set) ?? []).map((p) => [p.slug, p]));
      for (const [i, e] of listed.entries()) {
        const p = here.get(e.slug);
        if (!p) differ(principlePath(set, e.slug), 'removed');
        else if ((await principleDigest(p, groundBody)) !== e.digest) differ(p.path, 'edited');
        else if (p.fmSet !== set || (ordered ? p.order !== i + 1 : p.order !== undefined)) differ(p.path, 'reordered');
      }
      const names = new Set(listed.map((e) => e.slug));
      for (const p of here.values()) if (!names.has(p.slug)) differ(p.path, 'added');
    };
    const treeSets = new Map(sets.map((t) => [t.slug, t]));
    for (const [i, m] of manifest.payload.sets.entries()) {
      const t = treeSets.get(m.slug);
      if (!t) differ(setPath(m.slug), 'removed');
      else if ((await descriptorDigest(t)) !== m.descriptor) differ(t.path, 'description-edited');
      else if (t.order !== i + 1) differ(t.path, 'reordered');
      await checkList(m.slug, m.principles, true);
    }
    const listedSets = new Set(manifest.payload.sets.map((m) => m.slug));
    for (const t of sets)
      if (!listedSets.has(t.slug)) {
        differ(t.path, 'added');
        for (const p of bySet.get(t.slug) ?? []) differ(p.path, 'added');
      }
    await checkList(RESERVE_SET, manifest.payload.reserve, false);
    for (const [set, ps] of bySet) if (set !== RESERVE_SET && !treeSets.has(set) && !listedSets.has(set)) for (const p of ps) differ(p.path, 'added');
    differences.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    for (const d of differences) find('principles-changed', d.path, WHY[d.kind]);
    // A principle's own verdict, then the set's: verified only when nothing in it differs.
    const diffAt = new Map(differences.map((d) => [d.path, d.kind]));
    for (const p of principles) {
      const kind = diffAt.get(p.path);
      treeVerdicts.set(p.path, kind === undefined ? { verdict: 'verified' } : kind === 'added' ? { verdict: 'unsealed' } : { verdict: 'broken', why: WHY[kind] });
    }
    for (const t of sets) {
      const inSet = differences.filter((d) => d.path.startsWith(`principles/${t.slug}/`));
      treeVerdicts.set(t.path, inSet.length === 0 ? { verdict: 'verified' } : { verdict: 'broken', why: inSet.length === 1 ? `${inSet[0]!.path}: ${WHY[inSet[0]!.kind]}` : `${inSet.length} files in it differ from the sealed set` });
    }
  } else for (const f of [...sets, ...principles]) treeVerdicts.set(f.path, { verdict: 'unsealed' });

  // On a fully sealed brain a source that reads as the curator's and has no seal is reported; `curated` grants nothing.
  if (fullySealed)
    for (const src of input.sources)
      if (!currentSources.has(slugOf(src.path)) && !broken.has(src.path) && (src.curated === 'ratified' || src.curated === 'human'))
        find('unsealed-source', src.path, 'it is marked as the curator’s and no seal says so');

  // 7. Verdicts.
  const verdicts = new Map<string, SealVerdict>();
  for (const c of input.captures) {
    const why = broken.get(c.path);
    if (why) verdicts.set(c.path, { verdict: 'broken', why });
    else if (invalidStems.has(c.stem)) verdicts.set(c.path, { verdict: 'broken', why: 'a seal naming it is invalid' });
    else {
      const seals = content.get(c.stem) ?? [];
      const attests = seals.map((s) => s.at).sort();
      verdicts.set(c.path, seals.some((s) => s.kind === 'capture') ? { verdict: 'verified' } : attests.length ? { verdict: 'attested', since: attests[0]! } : { verdict: 'unsealed' });
    }
  }
  for (const src of input.sources) {
    const why = broken.get(src.path) ?? (invalidSlugs.has(slugOf(src.path)) ? 'a seal naming it is invalid' : undefined);
    verdicts.set(src.path, why ? { verdict: 'broken', why } : (sourceVerdicts.get(src.path) ?? { verdict: 'unsealed' }));
  }
  for (const [path, v] of treeVerdicts) verdicts.set(path, v);

  // 8. Pins.
  findings.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  let heads: Heads | null = null;
  let revocations: PinnedRevocations | null = null;
  if (findings.length === 0 && ![...verdicts.values()].some((v) => v.verdict === 'broken')) {
    heads = {};
    for (const [key, recs] of folders) {
      const n = Math.max(...recs.keys());
      heads[key] = { seq: n, digest: recs.get(n)!.digest! } satisfies Head;
    }
    revocations = {};
    for (const [key, r] of revoked) revocations[key] = { digest: keys.revocationDigests.get(key)!, last_seq: r.last_seq, last: r.last };
  }
  return { locked: false, findings, verdicts, heads, revocations, fullySealed, differences, current: { sources: currentSources, manifest } };
}

/**
 * What a prompt may be assembled from (schema §8, §11.6): on a fully sealed
 * brain, only sets that verify as a whole and passages from verified or
 * attested sources. Before that, everything that is not broken, as before
 * version 2. `excluded` names what was left out and why.
 */
export function usable(r: SealResult): { sets(slug: string): boolean; source(slug: string): boolean; excluded: Array<{ path: string; verdict: SealVerdict['verdict'] }> } {
  const ok = (path: string, sealed: (v: SealVerdict['verdict']) => boolean) => {
    const v = r.verdicts.get(path)?.verdict ?? 'unsealed';
    return r.fullySealed ? sealed(v) : v !== 'broken';
  };
  const isSet = (v: SealVerdict['verdict']) => v === 'verified';
  const isSource = (v: SealVerdict['verdict']) => v === 'verified' || v === 'attested';
  const excluded: Array<{ path: string; verdict: SealVerdict['verdict'] }> = [];
  for (const [path, v] of r.verdicts) {
    const sealed = path.endsWith('/_set.md') ? isSet : path.startsWith('sources/') ? isSource : undefined;
    if (sealed && !ok(path, sealed)) excluded.push({ path, verdict: v.verdict });
  }
  return { sets: (slug) => ok(`principles/${slug}/_set.md`, isSet), source: (slug) => ok(`sources/${slug}/raw.md`, isSource), excluded };
}
