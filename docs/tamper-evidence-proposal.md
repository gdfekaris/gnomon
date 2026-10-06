# Proposal: tamper-evident captures

2026-10-05. Rewritten the same day from the maintainer's commit-audit
proposal, once the goal was stated: Gnomon, on the phone and on the
desktop, has safeguards against agents tampering with what the user
captures, and an audit that tells whether one did, defensible to an
expert reviewer. The commit audit remains as a hygiene layer (Appendix
A); its block A1, one commit vocabulary, is done (`415827a`).

Decided by the maintainer on 2026-10-05: protect only what the user
captures; metadata is excluded; the desktop signs with a YubiKey touch;
credential separation for agent sessions (§4.6); a recovery phrase as the
root of trust (§4.1); D1 to D6 as recommended (§7). Block S1 moved the
format into Schema §11 and §7.20, the implementation into Technical
Specification §6.5, and the claim and threat model into `security.md`;
those are now the normative texts, and where this proposal differs from
them, they win.

---

## 1. The claim

> For every capture made on an enrolled device after sealing was set up,
> Gnomon shows that its passage text, its note, and its attached file are
> byte for byte what the user captured, in the inbox and in the filed
> source, or it shows that they are not. Under the assumptions of §2.3,
> an agent working on the brain cannot change, swap, or delete such
> content, or pass off a capture as the user's, without a trusted
> verifier reporting it the next time it runs.

The claim is detection, not prevention (§2.4). Its strength rests on one
fact: every seal is signed by a key that never exists anywhere an agent
runs, and every verifier that the claim relies on runs where no agent
does.

## 2. Threat model

### 2.1 Assets

The captured content, and only that (maintainer's decision):

- the body of `inbox/<stem>.md`, and its `note` (§7 D1);
- the capture's attachment, `inbox/<stem>.<ext>`;
- the filed copies: the body of `sources/<slug>/raw.md` and
  `sources/<slug>/original.<ext>`, which schema §4.2 already requires to
  be byte-identical to the capture.

Not assets: all other frontmatter (title, author, tags, curation state,
`status`, `filed_as`), principles, set descriptions, notes, proposals,
the indexes.

### 2.2 The adversary

An agent (Claude Code, OpenCode with a local model, anything that speaks
git) working on the brain on the desktop, which ignores AGENTS.md by
mistake or by design. It can:

- read and write every file in its clone of the brain, and push any
  commit, with any message, author, and date, to the brain repository;
- force-push, rewrite history, and delete files;
- read the encryption passphrase (AGENTS.md gives it `GNOMON_PASSPHRASE`
  on an encrypted brain) and so read and write every body;
- run arbitrary code, and read and write anything, in the OS account or
  container it runs in;
- write convincing text, including commit messages and instructions
  addressed to the user.

### 2.3 Assumptions

The claim holds while these do. Each is something a reviewer can check.

- **S1. Separate account for agents.** Agent sessions run in their own OS
  account or container, whose only GitHub credential is a deploy key with
  write access to the brain repository alone (§4.6). The maintainer's
  `gh` login, tokens, SSH keys, YubiKey handle file, and the `gnomon-cli`
  install used for verification live in the maintainer's own account,
  which the agent account cannot read.
- **S2. The phone.** No agent runs on the phone, and the phone is not
  compromised. The app it runs is the one built from this repository and
  served from `gdfekaris.com/gnomon/`.
- **S3. The recovery phrase.** It is kept on paper and typed only on a
  phone, never on the desktop.
- **S4. Primitives.** SHA-256, Ed25519, ECDSA P-256, AES-256-GCM, and the
  OpenSSH FIDO signature format (`sk-ssh-ed25519@openssh.com`) are sound;
  the YubiKey does not sign without a touch.
- **S5. The release path.** The maintainer's GitHub account is protected
  by a security key, and no token that can push to `gdfekaris/gnomon` or
  change its settings is available to an agent (S1 gives this).

### 2.4 Out of scope, stated

- **Prevention.** A git host cannot stop a holder of write access from
  changing a file, and GitHub cannot limit a credential to some paths on
  a direct push. Gnomon makes tampering evident; it does not make it
  impossible.
- **Availability.** An agent can delete content or vandalize the seal
  record. That is detected and reported, never hidden, but recovery is
  from git history or another clone, not from Gnomon.
- **Metadata**, and everything in §2.1's "not assets".
- **Content an agent captures.** AGENTS.md lets an agent write a
  `Capture:` at the user's request. Such a capture is unsealed by
  construction and shows as unsealed until the user reads it and seals
  it as their own (§4.4).
- **History before sealing.** Existing captures are sealed once, as they
  stand (§4.4). That proves they are unchanged *since that day*, not
  since they were captured, and the app says so.
- **The user attesting tampered text.** Sealing an agent's capture, or
  backfilling, attests what is on screen. The app shows the whole text
  before the user seals it; it cannot know what the user meant to
  capture.
- **Coding agents.** An agent developing Gnomon itself runs with the
  maintainer's credentials and could change the app or the verifier. That
  is a supply-chain risk, separate from agents working on a brain;
  optional block S10 (signed release tags) narrows it. Seals already made
  stay verifiable by any honest build.
- **A compromised phone, browser, or GitHub account** (S2, S5).

## 3. How it works, in one page

1. **A root key** comes from a 24-word recovery phrase the phone shows
   once, at setup. The root signs only enrollments and revocations of
   device keys. The app forgets the phrase and the root secret at once;
   every verifier pins the root's public key.
2. **Two device keys** do the sealing: the phone's, a non-extractable
   WebCrypto key in IndexedDB, and the YubiKey's, an OpenSSH FIDO key
   that signs only on a touch. Each is enrolled by the root.
3. **A seal** is a signed statement made when a capture is committed:
   this stem, these hashes of the body, note, and attachment, this
   device, this sequence number, this previous seal. Seals live under
   `.gnomon/seals/`, one file each, one chain per device key.
4. **Filing needs no key.** A filed source verifies when its `raw.md` and
   `original.<ext>` hash to what its capture's seal names, so agents keep
   filing and a filing that alters the passage fails.
5. **Verifiers** (the phone app, and `gnomon verify` in the maintainer's
   own account) check every seal against the pinned root, every chain for
   gaps, forks, and rollback against the heads they last saw, and every
   capture and source against its seal. The app shows the result on every
   capture and source and refuses to ratify what does not verify.

## 4. Design

### 4.1 Keys and trust

**Root.** At setup the phone draws 256 random bits and shows them as 24
words (the BIP-39 English list, with its checksum), then asks for three
of them back. The root signing key is Ed25519 from
`HKDF-SHA256(entropy, info = "gnomon root v1")` as the seed (libsodium
`crypto_sign_seed_keypair`); the phrase carries full entropy, so no
password hashing is needed. The root signs the first enrollment, and the
app zeroes the entropy and the secret. `.gnomon/root.json` records the
public key and its fingerprint for convenience; **no verifier trusts that
file**. The phone pins the public key in IndexedDB at setup or recovery,
and the CLI pins it when the maintainer compares the fingerprint printed
on the paper card with the one it shows (`gnomon keys trust`).

**Phone key.** Generated in WebCrypto with `extractable: false`, Ed25519
where the browser offers it and ECDSA P-256 otherwise (to settle on the
maintainer's iPhone in block S3), stored in IndexedDB beside the
remembered encryption key (spec §6.4, §10.3). The app calls
`navigator.storage.persist()`; iOS may still evict storage, which is
what the phrase is for.

**Desktop key.** `ssh-keygen -t ed25519-sk` on the YubiKey, touch
required (the default), **non-resident**, so signing needs the handle
file `~/.ssh/id_ed25519_sk` in the maintainer's account as well as the
key and a touch. A FIDO signature carries a flags byte; the verifier
requires the user-presence bit, so a seal from this key is cryptographic
evidence of a touch. PIN (`-O verify-required`) is optional, §7 D5.

**Enrollment.** `.gnomon/keys/<key-id>.json`: the key id (the first 16
bytes of SHA-256 of the public key, hex), algorithm, public key, a label
("iPhone"), the kind (`phone` or `fido`), the date, and the
root's signature over all of it. The phone enrolls itself at setup. A
desktop key is enrolled from the phone: `gnomon keys request` in the
maintainer's account commits a request file with the public key; the
phone lists pending requests with their fingerprints; the maintainer
compares the fingerprint on the desktop with the one on the phone,
types the phrase, and the phone signs and commits the enrollment. An
agent can write a request too; the fingerprint comparison is what stops
it.

**Revocation.** From the phone, with the phrase:
`.gnomon/keys/<key-id>.revoked.json` names the key, the last good
sequence number and seal hash as the phone has seen them, and the date,
signed by the root. Seals from that key after that point fail.

**Recovery.** On a new phone, the maintainer types the phrase; the app
derives the root itself (trusting nothing in the repository), pins it,
enrolls a new phone key, and forgets the phrase. Losing a device stops
sealing on that device only; old seals keep verifying. Losing the phrase
and every device means a new root: old seals then show as "sealed under
a retired root", and the docs say so.

### 4.2 Seals

One file per seal, `.gnomon/seals/<key-id>/<seq>.json` with `seq` zero
padded to six digits, so concurrent devices never touch the same file:

```json
{
  "payload": {
    "v": 1,
    "kind": "capture",
    "stem": "20261005-142233-k3m",
    "body": "sha256:…",
    "note": "sha256:…",
    "attachment": { "name": "20261005-142233-k3m.pdf", "sha256": "…" },
    "at": "2026-10-05T14:22:33Z",
    "key": "<key-id>",
    "seq": 42,
    "prev": "sha256:<hash of seal 41's payload bytes>"
  },
  "sig": "<base64 signature, or an armored SSHSIG for a fido key>"
}
```

- The signed bytes are the payload in RFC 8785 canonical JSON, prefixed
  by the context string `gnomon-seal v1\n`, so a signature can never be
  replayed as anything else. For a FIDO key the SSHSIG namespace is
  `gnomon-seal@v1`.
- `body` is the SHA-256 of the body bytes after the frontmatter, exactly
  as the schema defines the body, in plaintext. `note` is absent when the
  capture has none; `attachment` is null when it has none.
- `kind` is one of: `capture` (made with the capture), `attest` (the user
  sealed an existing capture: an agent's, or a backfill; `at` is when),
  `clear` (a tombstone, §4.4, naming the stem and the slug it was filed
  as, if any).
- The chain: `seq` starts at 1 per key and `prev` is null only there. A
  device advances its stored head only after the commit that carries the
  seal succeeds, and before sealing it takes the greater of its stored
  head and the highest seal of its key in the repository, so a crash
  between commit and store cannot make a fork.

A seal is made at commit time, not at tap time: an offline capture (spec
§14 queues one, in memory) is sealed when it is committed, with `at` set
to when it was captured, so a capture lost before reaching the network
leaves no gap.

### 4.3 Encrypted brains

On an unencrypted brain the passage text is public to the git host, so a
public hash of it reveals nothing more. On an encrypted brain a public
hash would let anyone with read access confirm a guessed passage. So
when `.gnomon/encryption.json` exists, seal files are encrypted at rest
in the body format (spec §6.4, AAD = path), whole. `Encrypt:`,
`Decrypt:`, and `Change passphrase` rewrite them as they do bodies; the
signatures inside never change, so no re-signing is needed. Enrollment,
revocation, and root files stay cleartext: they hold only public keys.
Verifying an encrypted brain needs the key, which the phone has once
unlocked and `gnomon verify` takes as `GNOMON_PASSPHRASE` in the
maintainer's account. The agent also has the passphrase; it does not
matter, because the passphrase protects confidentiality and the
signature protects integrity.

### 4.4 Operations

| Operation | Where | Commit | Seal |
|---|---|---|---|
| Set up sealing | phone | `Set up sealing` (new): `root.json`, the phone's enrollment | — |
| Capture | phone; desktop `gnomon capture` (touch) | `Capture: <stem>`, now with its seal file | `capture` |
| Capture by an agent | desktop, agent account | `Capture: <stem>`, no seal | none: shows unsealed |
| Seal as mine | phone, after showing the whole text; desktop `gnomon seal <stem>` (touch) | `Seal: <stem>` (new) | `attest` |
| Seal existing captures | phone, once, after setup | `Seal: <n> existing captures` (new) | one `attest` each |
| File | anyone: app or agent | `File: <slug>`, unchanged | none needed |
| Clear | phone (§7.19, not yet offered) | `Clear: <stem>`, with its tombstone | `clear` |
| Enroll a key | phone, with the phrase | `Enroll key: <label>` (new) | — |
| Revoke a key | phone, with the phrase | `Revoke key: <label>` (new) | — |
| Request a desktop key | desktop, maintainer's account | `Request key: <label>` (new) | — |

The new messages go into schema §7 first (the vocabulary test enforces
it). AGENTS.md gains one hard rule: never create, edit, or delete
anything under `.gnomon/` (today it says this of `encryption.json`
only). An agent that breaks it is caught by verification anyway.

The CLI commits these operations itself, unlike today's commands (spec
§13: "makes no commits"), because a seal's sequence number and the
commit that carries it must agree (§7 D4).

### 4.5 Verification

Inputs: the tree at `HEAD`, the pinned root, and the verifier's pinned
heads (the highest `seq` and seal hash it has seen per key).

1. **Keys.** Every enrollment carries a valid root signature; every
   revocation too. A seal by an unenrolled key, or by a revoked key
   after its last good seal, is invalid.
2. **Chains.** Per key: `seq` runs 1..n with no gap; each `prev` matches;
   no two seals share a `seq`; the head is at or beyond the pinned head,
   with the same hash where they overlap. A failure is a brain-level
   finding: *the seal record was altered*.
3. **Signatures.** Ed25519 or P-256 over the context and the canonical
   payload; for FIDO, the SSHSIG over the same bytes with the
   user-presence flag set.
4. **Content.** For each stem named by a valid `capture` or `attest`
   seal: if `inbox/<stem>.md` exists, its body, note, and attachment
   match; if a source names the stem in `inbox_ref`, its `raw.md` body
   and `original.<ext>` match the same hashes; if neither exists, there
   must be a valid `clear` tombstone, and when the tombstone names a
   slug, that source must still exist and match.
5. **Verdicts,** per capture and per source:
   - **verified** — a `capture` seal, and everything matches;
   - **attested** — an `attest` seal, and everything matches; shown with
     its date: "unchanged since 5 Oct 2026";
   - **unsealed** — no seal names it (before setup, or an agent's
     capture);
   - **broken** — a seal names it and something does not match, or its
     only seal is invalid.
6. The verifier advances its pinned heads only when steps 1 to 4 pass.

**Where it runs, and what each run is worth:**

- **The phone app**, on every snapshot load: a trusted verifier (S2).
- **`gnomon verify [--json]` in the maintainer's account**, over a fresh
  fetch: a trusted verifier (S1). Heads pinned in
  `~/.config/gnomon/`.
- **`gnomon verify` in an agent's account, or in the brain's CI:**
  advisory only. The agent controls that environment, so the claim never
  rests on it. AGENTS.md may still ask agents to run it, as a courtesy
  check of their own work.

### 4.6 The agent account (assumption S1)

A one-time setup on the maintainer's machine, documented step by step in
`docs/agent-sessions.md`:

1. Create an OS user, `gnomon-agent`, or a container, for brain sessions.
2. Generate an SSH key there and add it to `brain-1` as a deploy key
   with write access. GitHub ties a deploy key to one repository, so the
   limit is enforced by GitHub, not by us.
3. Clone `brain-1` there, install the agent tools there, set
   `GNOMON_PASSPHRASE` there if the brain is encrypted.
4. Check, from inside that account: `gh auth status` shows no login;
   reading `/home/geo/.ssh`, `/home/geo/.config/gh`, and the YubiKey handle is
   refused; a push to `gdfekaris/gnomon` is refused.

The maintainer's own account keeps the `gh` login, the YubiKey handle,
and the `gnomon-cli` used for `verify`, `capture`, and `seal`.

### 4.7 What the app does with verdicts

- Every capture in the Inbox and every source in Browse carries its
  verdict as a small mark; broken is loud, unsealed is quiet.
- A brain-level finding (§4.5 step 2) is a banner on every screen until
  the record verifies again.
- **Ratify** is refused for a broken source and, for an unsealed one,
  offered as "Seal as mine and ratify" after showing the whole passage
  (§7 D2).
- **Filing** in the app refuses a broken capture.
- **Reasoning** leaves out broken passages, with a notice naming them
  (§7 D3).
- **Settings → Sealing:** set up, enrolled keys with their fingerprints,
  pending desktop requests, revoke, recover on this phone, the last
  verification and its result, "verify now".

## 5. What a reviewer can check

### 5.1 Attacks and what catches them

Each row is a test fixture: a brain plus one agent action, verified by
core, by `gnomon verify`, and by the Python reference.

| # | Agent action | Caught by | Verdict |
|---|---|---|---|
| T1 | Edit a sealed capture's body | §4.5 step 4 | capture broken |
| T2 | Edit its note | step 4 | capture broken |
| T3 | Replace its attachment | step 4 | capture broken |
| T4 | File it with an altered `raw.md` body | step 4 | source broken |
| T5 | File it with a different `original.<ext>` | step 4 | source broken |
| T6 | Edit a filed source after the capture was cleared | step 4 via the tombstone | source broken |
| T7 | Delete a sealed capture | step 4 (no tombstone) | brain finding |
| T8 | Delete a seal file in the middle of a chain | step 2 (gap) | brain finding |
| T9 | Delete the newest seal and its capture | step 2 (below the pinned head) | brain finding |
| T10 | Force-push the brain to an older state | step 2 (below the pinned head) | brain finding |
| T11 | Edit a seal's payload | step 3 | capture broken |
| T12 | Write a seal with its own key | step 1 (unenrolled) | capture broken |
| T13 | Add its own key to `.gnomon/keys/` | step 1 (no root signature) | brain finding |
| T14 | Replace `.gnomon/root.json` with its own root | the pinned root differs | brain finding |
| T15 | Copy a valid seal to another stem | step 4 (`stem` is signed) | capture broken |
| T16 | Write a capture in the user's name | no seal | unsealed, never verified |
| T17 | Write a `Request key:` for its own key | the fingerprint does not match on the phone | not enrolled |
| T18 | Write a tombstone | step 3 (it cannot sign) | brain finding |
| T19 | Seal with a revoked key after revocation | step 1 | capture broken |
| T20 | Two seals with one `seq` (a fork) | step 2 | brain finding |
| T21 | T1, T4, T8 on an encrypted brain | as above, with the key | as above |
| T22 | Edit metadata (title, tags, `status`) | not caught: out of scope | verified |

T22 is in the list on purpose: the claim says what it does not cover,
and a test holds that it doesn't.

### 5.2 Evidence a reviewer gets

- `docs/security.md`: §1 to §2 of this proposal as maintained text: the
  claim, the threat model, the assumptions, what is out of scope.
- The seal format and verification algorithm in the schema and the
  spec, with the canonical-bytes rules exact enough to reimplement.
- Two independent verifiers: core (TypeScript) and the Python reference,
  which must agree on every fixture.
- FIDO verification tested against `ssh-keygen -Y verify` on signatures
  made by the real YubiKey (recorded once as fixtures, since CI has no
  key).
- The attack table above, running in CI.

## 6. Settled decisions, and the spec

Nothing in `alignment-review.md` is reopened. `.gnomon/` was reserved
for app metadata (3.10.6) and this is app metadata. Three spec texts
change: §6.4 (seal files are encrypted with bodies), §10.3 (IndexedDB
gains the device key, the pinned root, and pinned heads), §13 (the CLI
commits sealed operations). Capture's fifteen-second budget (US-1) is
unaffected: one signature is milliseconds.

## 7. Decisions (all six accepted as recommended, 2026-10-05)

| # | Question | Recommendation |
|---|---|---|
| D1 | Seal the capture's `note`? It is frontmatter, but it is words the user typed at capture. | Yes. |
| D2 | Ratifying an unsealed source: refuse, or offer "Seal as mine and ratify" after showing the passage? | Offer it. Refusing would strand every pre-setup source until a backfill. |
| D3 | Reasoning with a broken passage: leave it out with a notice, or include it marked? | Leave it out, with the notice. |
| D4 | Let the CLI commit sealed operations (spec §13 says it makes no commits)? | Yes; the seal and its commit must agree. |
| D5 | YubiKey PIN as well as touch? | Touch only. Under S1 an agent cannot reach the handle file, and a PIN adds a step to every desktop capture. Document the option. |
| D6 | Seal existing captures once at setup, as "attested"? | Yes, with the date shown, and the docs saying what it does and does not prove. |

## 8. Blocks (Phase 5)

Order as listed; S6 can happen any time and is best done early.

- [x] **S1. The claim and the format** (S) — done 2026-10-05.
  `docs/security.md` (claim, assets, adversary, assumptions with how to
  check each, limits, mechanism, attack table, evidence; marked "designed,
  not yet built" until S2 to S7 ship); Schema §11 (what is sealed, files,
  encodings, keys and root derivation, the seal payload, verification
  steps and verdicts, making seals, FIDO signatures byte for byte), §7.20
  and the new messages, §2, §7.5, §7.17, §7.19, §10; Technical
  Specification §6.5 (`core/seal` interface, the phone, the CLI, where
  verification counts), §10.3, §13, §15; AGENTS.md hard rule 11. Two
  choices made in writing it: each brain has its own root, and the FIDO
  wire format of Schema §11.8 is confirmed against `ssh-keygen -Y verify`
  in S5 before anything ships.
- [x] **S2. Core: seals and verification** (L) — done 2026-10-05.
  `packages/core/src/seal`: encodings, keys and the root, the BIP-39
  phrase, SSHSIG, records, making seals, verification; 50 tests. Checked
  against independent implementations: Node's Ed25519, HKDF, and P-256,
  OpenSSH's own `ed25519_sk` vector (`core/fixtures/sshsig`), and
  `ssh-keygen -Y verify` on our FIDO signatures, which settles the Schema
  §11.8 wire format S5 was to confirm. Every row of `security.md` §7
  yields its verdict; the clean cases (a sealed brain, an attested
  capture, a YubiKey seal, a cleared capture, a revocation) verify. T9
  showed a limit now stated in `security.md` §5: a verifier's first look
  cannot see seals removed from a chain's tail before it.
- [ ] **S3. The phone: keys** (L) — setup with the phrase, root
  derivation, the phone key, pins, recovery on a new phone, revocation,
  enrolling a desktop key from a request; `storage.persist()`. Done when
  the maintainer sets up sealing on the iPhone, recovers it in a second
  browser profile from the phrase, and Ed25519-or-P-256 is settled on
  the device.
- [ ] **S4. The phone: sealing and verdicts** (L) — seals on capture
  (offline included), verdict marks, the banner, ratify and filing
  rules, "Seal as mine", sealing existing captures, seals in the
  encryption plans; Playwright on both engines and the built projects.
  Done when brain-1's captures show verified or attested on the phone,
  and an edit made in a scratch brain shows broken.
- [ ] **S5. The CLI** (M) — `gnomon keys request|trust`,
  `gnomon capture`, `gnomon seal`, `gnomon verify [--json]`, heads in
  `~/.config/gnomon/`; YubiKey signatures recorded as fixtures and
  checked against `ssh-keygen -Y verify`. Release `gnomon-cli` 0.3.0.
  Done when a desktop capture made with a touch verifies on the phone.
- [ ] **S6. The agent account** (S, the maintainer) —
  `docs/agent-sessions.md`, then the setup of §4.6 and its four checks.
  Done when an agent session in that account files a capture and cannot
  push to `gdfekaris/gnomon`.
- [ ] **S7. Independent verifier** (M) — `tools/gnomon-check.py
  --verify`, written from the schema and spec, not from the TypeScript;
  CI compares verdicts on every fixture.
- [ ] **S8. Commit audit, hygiene** (M) — Appendix A's A2 to A4: shape
  rules for every operation, reported by `gnomon audit`. Not part of the
  claim; it catches agents breaking the rules on what seals do not
  cover.
- [ ] **S9. Outside review** (the maintainer) — give `docs/security.md`,
  the format, and core's verifier to a security practitioner.
- [ ] **S10. Signed releases** (S, optional) — deploy the app and
  publish the CLI only from tags signed with the YubiKey, narrowing the
  coding-agent risk of §2.4.

Cost: about Phase 4 blocks 1 to 4 together. Who needs it: the maintainer,
whose brain is worked on by agents and who wants the claim of §1 to hold
up to an expert.

---

# Appendix A — the commit audit (hygiene)

The first version of this proposal, worked through the same day. It is
no longer the security mechanism: an agent writes a commit's message,
author, and date, so a check of whether a diff fits its label cannot tell
an agent from the user (its open question 1). Seals carry the claim
(§1–§5). The audit stays useful as hygiene: it reports commits that
break the shape rules on everything seals do not cover (metadata,
principles, proposals, the indexes), and it is block S8.

Kept from that session: the vocabulary decisions (A.0, done in block
A1), the rule table (A.1), where the code lives (A.2), and the fixtures
(A.3). Section numbers in A.1 cite the schema unless marked "spec".
Its answers that still stand: the audit is a separate
`gnomon audit`, not part of `validate`, since one old violation would
fail every session's validate forever; it audits from an anchor (the
last audited head) kept outside the repository, and an anchor that is
no longer an ancestor of `HEAD` means history was rewritten; merges are
reported, and AGENTS.md now pulls with `--rebase` so sessions make none;
`Reject:` is checked as the exact inverse of its filing.

## A.0 Vocabulary (decided 2026-10-05, block A1)

The code commits messages the schema does not list, and the schema names
operations the code does not have. The rule table needs one vocabulary.
None of these reopens a decision in `alignment-review.md`.

| # | Gap | Recommendation |
|---|---|---|
| V1 | The app commits `Edit principle: <title>`, `Edit source: <slug>`, `Edit notes: <slug>`, `Update principle set: <label>`, `Reorder principles: <label>`, `Reorder principle sets`, `Delete principle: <title>` (core `sets`, app `services/edit.ts`). Schema §7.2, §7.3, §7.9 say "one commit" with no message; edits have no procedure at all. | Adopt the code's messages into schema §7 as they stand; they are already in real brains. Add a short §7 entry for the three edits. |
| V2 | AGENTS.md's message list (session discipline, rule 2) omits `Relate:`, though §7.15 lets a desktop agent run Task F. | Add `Relate: <n> proposals for <set label>` to the list. |
| V3 | Schema §4.6 says the app deletes a capture "when the curator explicitly clears it". No code does, and no message exists. | Name it now, `Clear: <stem>` (deletes `inbox/<stem>.md` and its attachment, only when filed and ratified or unfiled after a rejection), so the audit has a rule the day it is built. Or strike the sentence. |
| V4 | AGENTS.md says `git pull`. A desktop session that races the phone then makes a merge commit. | `git pull --rebase`. The audit reports merges; this keeps sessions from making them. |
| V5 | Commits outside every vocabulary: the host's initial commit, the curator's hand edits on desktop, GitHub web edits. | An *unrecognized* finding, acknowledged by moving the anchor past it (`gnomon audit --ack`). Not a violation, but it still fails the exit code until acknowledged, so nothing slips by unseen. |

## A.1 Operation rules

Universal rules, applied to every commit before the operation's own:

| # | Rule | Source |
|---|---|---|
| U1 | `principles/_index.md` and `maps/_index.md` may change only to equal `generateIndexes` of the tree after the commit. `Capture:`, `File:`, and the three encryption operations change neither. | §1 rule 3, §4.8, §7.5, §7.6 last line, §7.17; spec §7.2 |
| U2 | `created` never changes; `updated` may change on any modified file. | §4.1 |
| U3 | `raw.md` body of a `human` or `ratified` source never changes; `original.<ext>` never changes. | §4.2, §9 |
| U4 | Nothing under `.gnomon/` changes except in the encryption operations. | §10, §7.17 |
| U5 | No operation allows deleting a path and adding one with the same content, so a move is always a violation, reported as "moved" when blobs match. | §1 rule 1 |
| U6 | A merge commit is reported; its non-merge parents are audited on their own, and a conflict resolution (a merge diff equal to neither side) is a violation. | §7 preamble, §10 |
| U7 | On an encrypted brain, a changed body ciphertext is a changed body. Holds because the wrapper and `gnomon encrypt` keep ciphertext when plaintext is unchanged. | spec §6.4 (review view paragraph); `cli/src/crypt.ts` |

Per operation. "Agent" in *Emitted by* means AGENTS.md permits it; every
operation without "agent" is curator-only and goes on the confirm list.
"+ idx" means indexes may change under U1.

| Operation (message) | Emitted by | Add | Modify | Delete | Source |
|---|---|---|---|---|---|
| `Capture: <stem>` | app, agent | `inbox/<stem>.md` (`type: inbox`, `curated: human`, `status: unfiled`); optionally `inbox/<stem>.<ext>` | — | — | §7.5, §4.6 |
| `File: <slug>` | app, agent | `sources/<slug>/raw.md` (`agent-proposed`, `inbox_ref` = the capture, body byte-identical to the capture's); `notes.md` (`agent-proposed`); optionally `original.<ext>` byte-identical to the capture's attachment; any number of `maps/proposals/P-*.md` with `kind: principle`, `target_set: _reserve`, `from_source: <slug>`, `<slug>` in `grounds`, `agent-proposed`, `open` | the one capture named by `inbox_ref`: `status` unfiled → filed and `filed_as: <slug>`, nothing else (not `updated`; the code leaves it) | — | §7.6, §4.6, §4.2; spec §7.6 |
| `Ratify: <slug>` | curator | — | `sources/<slug>/raw.md` and/or `notes.md`: `curated` agent-proposed → ratified, `updated`; at least one | — + idx | §5, §7.7; spec §9 |
| `Reject: <slug>` | curator | exactly the inverse of the latest `File: <slug>` diff | | | §5, §7.7; spec §9 |
| `Decide: <id>` | app, agent (curator's decision) | — | `maps/proposals/<id>.md`: `status` open → accepted or declined, `updated` | — + idx | §7.10, §4.7, alignment 2.5a |
| `Keep: <n> proposals in reserve` | curator | n principles in `principles/_reserve/` (`set: _reserve`, no `order`, `human`) | n proposals with `kind: principle`, `target_set: _reserve`: open → accepted | — + idx | §7.16 |
| `Decline: <n> proposals` | curator | — | n proposals: open → declined | — + idx | §7.16 |
| `Add proposal: <id>` | curator | one proposal, `curated: human`, `status: open` | — | — + idx | §7.11 |
| `Derive: <n> proposals for <label>` | app, agent | n proposals: `kind: principle`, `target_set` = the set, `grounds` ≥ 1, no `from_source`, `agent-proposed`, `open` | — | — + idx | §7.12 |
| `Relate: <n> proposals for <label>` | app, agent (V2) | n proposals: `kind` link, amendment, or principle; `target_set` = the set; no `from_source`; `agent-proposed`, `open` | — | — + idx | §7.15 |
| `Add principle: <title>` | curator | one principle in a set at `order` = count + 1, or in the reserve with no `order`; `human` | — | — + idx | §7.9, §7.14 |
| `Reserve principle: <title>` | curator | one principle in `principles/_reserve/` | — | — + idx | §7.14 |
| `Place principle: <title> in <label>` | curator | one principle in the set at count + 1 | — | — + idx | §7.14 |
| `Delete principle: <title>` (V1) | curator | — | `order` only, on principles of the same set below it | one principle file + idx | §7.9 |
| `Reorder principles: <label>` (V1) | curator | — | `order` (and `updated`) on principles of one set; result 1..N | — + idx | §7.9 |
| `Edit principle: <title>` (V1) | curator | — | one principle: `title`, `grounds`, `related`, `tags`, body; never `set`, `order`, `curated` | — + idx | §4.5; also the second commit of accepting a link proposal |
| `Create principle set: <label>` | curator | `principles/<slug>/_set.md`, `order` = N + 1, `human` | — | — + idx | §7.1 |
| `Update principle set: <label>` (V1) | curator | — | one `_set.md`: `name`, body | — + idx | §7.2 |
| `Reorder principle sets` (V1) | curator | — | `order` on `_set.md` files; result 1..N | — + idx | §7.3 |
| `Delete principle set: <label>` | curator | — | `order` − 1 on every later set | one set folder, every file in it + idx | §7.4 |
| `Edit source: <slug>` (V1) | curator | — | one `raw.md`: `title`, `author`, `work`, `year`, `locator`, `origin`, `tags`; `curated` → human; body unchanged | — + idx | §4.2, §5 |
| `Edit notes: <slug>` (V1) | curator | — | one `notes.md`: body; `curated` → human | — + idx | §4.3, §5 |
| `Scaffold: template` | app | the template tree, onto a host commit | — | — | §7.1 last paragraph |
| `Scaffold: <path>` | app | that path (a folder as its `.gitkeep`) | — | — | §7.8 |
| `Index` | app, agent | — | the index files only (U1) | — | AGENTS.md rule 3, §7.8 step 3, §7.13 |
| `Encrypt: <n> files` | curator | `.gnomon/encryption.json` | n bodies to ciphertext; frontmatter byte-identical | — | §7.17; spec §6.4 |
| `Decrypt: <n> files` | curator | — | n bodies to plaintext; frontmatter byte-identical | `.gnomon/encryption.json` | §7.17 |
| `Change passphrase` | curator | — | every body re-sealed; `.gnomon/encryption.json`; frontmatter byte-identical | — | §7.17 |
| `Clear: <stem>` (V3) | curator | — | — | `inbox/<stem>.md` and its attachment | §4.6 |

Where the schema is silent or ambiguous:

- **Proposal counts.** §7.6 says "at most four", §7.12 "at most twenty",
  §7.15 "at most ten". These read as guidance to the model; the app does
  not enforce them. Recommendation: a warning, not a violation.
- **`updated` on the filed capture.** §4.1 says `updated` is "rewritten on
  every content change"; `buildFiling` leaves it alone and §4.6 says the
  two fields are the only ones an agent may write. The rule follows §4.6:
  `updated` must not change. Worth a line in §4.6.
- **Byte-identical `raw.md` on an encrypted brain.** The ciphertext is
  bound to its path (AAD), so the inbox and source ciphertexts always
  differ. Without the key the audit cannot prove the copy; it says so in
  one note, as `validate` does (§9 last paragraph). With
  `GNOMON_PASSPHRASE` it can.
- **Edits on desktop.** The schema lets the curator edit by hand
  (`order`, notes) but gives no message; V5 covers these.

## A.2 Where the code lives

**Core, `core/audit`** (pure, no Node, no DOM):

- `rules.json`: the operation table of A.1 as data (message pattern,
  emitters, add/modify/delete path patterns, allowed fields per type,
  body allowed or not, index allowed or not, and the name of any extra
  check). JSON so that TypeScript imports it and the Python reference
  reads it; core's tsconfig takes `resolveJsonModule`.
- Named checks for what a table cannot say: `rejectIsInverse`,
  `keepPairsProposals`, `orderContiguous`, `rawCopiesCapture`,
  `indexesRegenerate`.
- `auditCommit(commit, before, after): Finding[]` and
  `auditRange(source, range): AsyncIterable<Finding>`.

The interface core needs, beside `FileChange` and `CommitInfo` in
`schema/types`:

```ts
export interface HistorySource {
  /** Commits after `since` (exclusive) up to `until`, oldest first, with parents. */
  commits(since: string | null, until: string): AsyncIterable<{ sha: string; parents: string[]; message: string }>;
  /** Paths added, modified, deleted between a commit and its parent; renames as delete + add. */
  changes(parent: string | null, sha: string): Promise<FileChange[]>;
  /** File contents at a commit; absent paths are missing from the map. */
  readAt(sha: string, paths: string[]): Promise<Map<string, string | Uint8Array>>;
  /** Every path at a commit, for U1's regeneration. */
  listAt(sha: string): Promise<string[]>;
  isAncestor(a: string, b: string): Promise<boolean>;
}

export interface Finding {
  sha: string;
  op: string | null;          // null when unrecognized
  kind: 'violation' | 'unrecognized' | 'merge' | 'warning';
  path?: string;
  detail: string;             // what fell outside the allowance
}
```

U1 is the expensive rule: it needs every frontmatter at each commit. It
runs only on commits that touch an index file, and the CLI reads with
`git cat-file --batch`, so a brain of a few thousand files stays seconds.

**Implementations:**

- CLI: a `GitHistory` beside `WorkingTreeDriver` (`git rev-list`,
  `git diff-tree --no-renames`, `git cat-file --batch`,
  `git merge-base --is-ancestor`).
- `packages/storage`: the GitHub driver already has `history` and
  `compare`; `readAt` needs `readMany` to take a ref, which its GraphQL
  query already expresses (`"<sha>:<path>"`). `MemoryDriver` keeps its
  commits so unit tests can audit what core builders produced.

**CLI:** `gnomon audit [--since <rev>] [--ack] [--json]`. Anchor in
`$XDG_CONFIG_HOME/gnomon/audit.json`. `--ack` moves the anchor to `HEAD`
after printing.

**Reference:** `tools/gnomon-check.py --audit <since>`, reading
`packages/core/src/audit/rules.json` and shelling to git.

**App:** after loading new commits, audit from the stored anchor; a
flagged commit gets the "needs your review" treatment schema §5 promises, next to
the commit in the Inbox's history list, and the curator-only list is
shown in Settings → About or a small Audit panel. Errors next to the
control, per the conventions.

## A.3 Fixtures

Fixtures are histories, not trees: each is a short script (start from
`packages/core/fixtures/brain`, apply commits) that a test helper replays
into a temporary git repo for the CLI and the reference, and into
`MemoryDriver` for core. `template/` and the fixture brain have no brain
history of their own (they live in the monorepo), so they are starting
points, not clean histories.

**Seeded violations, one bad commit each, exactly one finding expected:**

1. `File:` that edits the capture's body.
2. `File:` that writes the capture's `note`.
3. `File:` that also edits a principle.
4. `File:` whose `raw.md` body differs from the capture's by one byte.
5. `File:` whose `original.<ext>` differs from the capture's attachment.
6. `File:` that writes a proposal with `target_set` other than `_reserve`.
7. `Index` that touches a note.
8. `Index` whose index file is not the generator's output.
9. `Capture:` that also changes an index file.
10. An unrecognized message ("fix stuff").
11. A moved file (`git mv` a principle into another set).
12. A reserve done as one commit that moves the file.
13. `Ratify:` that also edits a principle body (a curator label over an
    agent's change set).
14. `Ratify:` that flips `curated` on a principle.
15. `Decide:` that also rewrites the proposal's title.
16. `Decline:` that touches a principle.
17. `Reject:` that is not the inverse of its filing (leaves `notes.md`).
18. `Derive:` that writes a principle file.
19. `Edit source:` that changes a ratified `raw.md` body.
20. `Keep: 2 proposals` that accepts two but writes one principle.
21. `Reorder principles:` that leaves a gap.
22. `Encrypt:` that changes frontmatter.
23. A non-encryption commit that writes `.gnomon/encryption.json`.
24. A change to `created`.
25. A merge commit with a conflict resolution.
26. Encrypted brain: `File:` whose capture body ciphertext changed.
27. Anchor no longer an ancestor (history rewritten after the audit).

**Clean, zero findings expected:**

- C1. Every core builder replayed in sequence on `MemoryDriver`: capture,
  file, ratify, reject, decide, keep, decline, add proposal, derive,
  relate, add/reserve/place/edit/reorder/delete principle,
  create/update/reorder/delete set, edit source and notes, scaffold,
  index. A failure here is a bug in the table or in the app.
- C2. C1 on an encrypted brain, plus encrypt, change passphrase, decrypt.
- C3. A desktop session in git: `Capture:`, `File:`, `Decide:`,
  `Derive:`, `Relate:`, `Index`, each wrapped by `gnomon encrypt` as
  AGENTS.md asks on an encrypted brain.
- C4. The brains the Playwright flows produce, audited at the end of each
  flow.
- C5. A legacy prefix (free-form commits) before `--since` is ignored.
- C6. The maintainer's brain-1, locally, from a baseline they choose.
  Never pushed anywhere by the agent; geo-brain-2 is all pre-format and
  is not a useful clean case.

**Parity:** the CLI and the reference report the same findings, by sha,
kind, and path, on every fixture above except C4.

**CI:** fixtures 1–27 and C1–C3, C5 run in the existing unit and
cross-check jobs; C4 in the Playwright jobs.

## A.4 Blocks (A2–A4 are block S8)

- [x] **A1. Vocabulary** (S) — done 2026-10-05. V1–V5 in schema §7
  (§7.2, §7.3, §7.8, §7.9, §7.13, new §7.18 edits and §7.19 `Clear:`, the
  §7 preamble on commits outside the vocabulary) and §4.6 (`updated`
  stays); AGENTS.md in the template and the fixture (`Relate:`,
  `git pull --rebase`). Core's batch decide declined only: its unused
  `Accept: <n> proposals` had no schema operation (a batch accept is
  `Keep:`), so it is now `declineProposals`. `core/test/vocabulary.test.ts`
  checks every message the code builds, and every one AGENTS.md gives an
  agent, against the heads named in schema §7.
- [ ] **A2. Core audit** (M) — `core/audit`, `rules.json`, the named
  checks, `HistorySource`; `MemoryDriver` keeps commits. Done when C1 and
  C2 pass and fixtures 1–24 and 26 each yield exactly their finding in
  unit tests.
- [ ] **A3. `gnomon audit`** (M) — `GitHistory`, the anchor, `--since`,
  `--ack`, `--json`, the curator-only list; fixture histories replayed
  into temporary git repos. Done when all fixtures pass in CI and the
  maintainer runs it on brain-1 from a baseline with zero violations (or
  each one explained).
- [ ] **A4. Reference parity** (S) — `gnomon-check.py --audit` over
  `rules.json`; the cross-check test compares findings. Done when CI
  compares the two on every fixture.

A5, the app's view of the audit, is dropped: the app shows seal verdicts
(S4), and the audit stays a desktop and CI check. A2 to A4 are block S8,
after the seal blocks.
