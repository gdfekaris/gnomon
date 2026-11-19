# Proposal: integrity, version 2 (phone first)

2026-11-19. Decisions D1 to D4 accepted by the maintainer the same day,
as recommended (§9). No code until the maintainer says go on a block. It
builds on what blocks S1 to S4 of
`tamper-evidence-proposal.md` already put on the phone, widens the
protection to principles, closes three gaps, and sets the desktop blocks
(S5 to S7) aside until the phone app works well.

Each section says the thing twice: once in plain words, once exactly.

---

## 1. The promise

**In plain words.** Every text you put into your brain, and every principle
you write, carries a seal that only your phone can make. Each time the app
opens it re-checks every seal. If anything was changed, swapped, removed,
or added by anyone other than you on your phone, the app says so, names
the file, and keeps that file out of reasoning. Nothing the AI reasons
from is unchecked.

**Exactly.** For every capture, every ratified source, and the whole
`principles/` tree, a trusted verifier (the phone app) either shows that
the protected bytes equal what an enrolled device signed, or reports a
verdict of *broken* or *unsealed* for the file, or a finding for the
brain. Only *verified* and *attested* content is assembled into a prompt.

This is **detection plus exclusion**, with repair as a later step (§6).
It is not prevention: GitHub will accept a changed file from anyone who
holds a write credential. What Gnomon guarantees is that such a change
cannot pass as yours.

## 2. Who we are defending against

| Adversary | What they can do | Covered? |
|---|---|---|
| The AI model inside the app | Return any text it likes | Yes, by construction (§3.1) |
| Someone with your GitHub token, or GitHub itself | Change, delete, add, or roll back any file in the brain | Yes, detected (§3.2 to §3.5) |
| A desktop agent with write access to the brain | The same | Yes, detected; the stronger desktop setup is deferred (§8) |
| Someone who can change the app you are served | Ship an app that lies | **No.** See §7 |
| Someone holding your phone unlocked, or your recovery phrase | Seal anything as you | **No.** See §7 |

## 3. The mechanisms

### 3.1 The AI never holds the pen

**In plain words.** When the app asks a model to file a capture or suggest
a principle, the model only sends back a suggestion. The app itself copies
your text, byte for byte, and the app itself writes the files. The model
has no way to touch your repository.

**Exactly.** Provider calls return text or structured JSON. Every write is
a `CommitBatch` built by `packages/core` and sent by the app through
`StorageDriver.commit`. A filed `raw.md` body is copied from the capture
by the app, never taken from the model's reply. This is already true
today.

### 3.2 Fingerprints

**In plain words.** A fingerprint is a short code computed from a text.
Change one comma and the code is completely different. Nobody can craft a
different text with the same code.

**Exactly.** SHA-256 over defined bytes (Schema §11.1): the body after
newline normalisation, the note, the attachment's bytes. Written as
`sha256:` plus 64 hex digits.

### 3.3 Seals: signatures only your phone can make

**In plain words.** When you save a capture, your phone writes a small
signed slip: "this capture has this fingerprint, signed by this phone."
The signing key was created inside your phone's browser and cannot be
copied out of it, not even by the app. Anyone can check a slip; only the
phone can make one. An attacker who changes your text cannot make a
matching slip.

**Exactly.** A device key (Ed25519 where WebKit offers it, else ECDSA
P-256) generated with WebCrypto as `extractable: false` and kept in
IndexedDB. A seal is `{payload, sig}` in `.gnomon/seals/<key-id>/<seq>.json`;
the signature covers a context line plus the RFC 8785 canonical JSON of
the payload. The payload names the stem, the digests, the key, a sequence
number, and the digest of the previous seal. Built and in use (S2 to S4).

### 3.4 The recovery phrase: who counts as "your phone"

**In plain words.** At setup the phone showed you 24 words once. Those
words are the master key. The master key does one job: it vouches for a
device ("this iPhone is mine") or withdraws that ("that phone was lost").
The app forgets the words at once. An attacker can add their own key file
to your repository, but without the 24 words nothing vouches for it, and
the app reports it.

**Exactly.** 256 bits of entropy as a BIP-39 phrase; the root Ed25519 seed
is HKDF-SHA256 of it. The root signs enrollments and revocations under
`.gnomon/keys/`. The phone **pins** the root's public key in its own
storage at setup or recovery and never reads it from the repository.
Built (S3).

### 3.5 The chain and the phone's memory

**In plain words.** Seals are numbered, and each one names the one before
it, like pages of a bound ledger. Your phone also remembers the last page
number it saw. So an attacker cannot quietly tear out a page, remove the
newest pages, or wind the whole repository back to last week: the ledger
would have a gap, or would end before the page your phone remembers.

**Exactly.** Per-key hash chain (`seq`, `prev`); the verifier keeps pinned
heads (highest accepted `seq` and its digest) outside the repository and
reports *chain gap*, *chain broken*, or *rolled back*. Deleting a sealed
capture without a signed `clear` tombstone is *sealed capture deleted*.
Built (S2).

## 4. What version 2 adds

### 4.1 Principles and their order are sealed

**In plain words.** Today only captures are sealed. But a reworded
principle, or two principles swapped in rank, changes your reasoning more
than an edited passage does. In version 2, each time you save, reorder,
move, or delete a principle or a set, the phone signs a table of contents
of all your principles: every set in order, each set's description, every
principle in rank order with its fingerprint, and the reserve.

**Exactly.** A new seal kind, `principles`: a signed manifest of the
`principles/` tree. For each set, in `order`: its slug, the digest of its
name and descriptor body, and its principles in `order`, each as slug plus
digest. Then the reserve, as slugs plus digests. A principle's digest
covers its title, its body, its `related` list, and its `grounds` as
pairs of source slug **and that source's body digest**. Each manifest
names the digest of the manifest it replaces. The tree must equal the
newest manifest; anything else is *broken*.

Binding each ground to the passage's fingerprint matters: it means a
principle is tied to the exact words it was grounded on, not just to a
file name.

### 4.2 Ratifying becomes a signature

**In plain words.** Today "ratified" is a word in a file's header, which
an attacker could type. In version 2, when you tap Ratify, your phone
signs: "the source named X holds the text with fingerprint Y." A source
counts as yours only if such a slip exists and the text still matches.

**Exactly.** A new seal kind, `source`, made in the `Ratify:` commit (and
when the curator creates a source by hand): slug, body digest, attachment
digest, and the stem it was filed from. A source's verdict is computed
from its slug and its bytes against `source` seals, and no longer from
the unprotected `inbox_ref` field. This closes two gaps in the current
verifier, both confirmed by reading `core/src/seal/verify.ts`:

- **Downgrade.** Editing a filed source and deleting its `inbox_ref`
  makes it read as *unsealed*, not *broken*, with no finding.
- **Swap.** Pointing source A's `inbox_ref` at capture B and pasting in
  B's text reads as *verified*, so a principle grounded on A would quietly
  cite B.

### 4.3 Unsealed means untrusted

**In plain words.** Once sealing is on and your existing material has been
sealed, a text with no seal is treated like a broken one: flagged, and
never sent to the model.

**Exactly.** After the backfill, *unsealed* on a ratified source or on any
principle is a finding, and prompt assembly takes only *verified* and
*attested* files. Agent-proposed filings awaiting review stay *unsealed*
and are simply not yet usable, which is what "awaiting review" should
mean.

### 4.4 Revocations cannot be erased

**In plain words.** If you declare a phone lost, an attacker must not be
able to undo that by deleting the declaration.

**Exactly.** The verifier pins the revocations it has accepted alongside
its heads; a pinned revocation missing from the tree is a finding.
Confirmed missing today: `keyRecords` reads revocations only from the
tree.

### 4.5 Every answer shows what it stood on

**In plain words.** Under each answer in Reason: which principles, in what
order, and which passages the model was given, each with its seal mark.
And any quotation in the answer that does not appear word for word in a
passage it was given is marked, because a model can misquote even a text
nobody tampered with.

**Exactly.** The assembly record is already stored per turn
(`Turn.assembly`) and never shown. Quote checking is a string match of
quoted spans against the included passage bodies.

## 5. What you see

- A mark on every capture, source, and principle: **sealed**, **sealed
  since \<date\>**, **awaiting your review**, or **changed**.
- A red banner, naming the files, whenever the brain does not verify.
- Changed or unsealed content cannot be ratified, filed, or reasoned from.
- Under each answer: its principles and passages, all checked.

## 6. Repair (after the local cache exists)

**In plain words.** Once the phone keeps its own copy of your brain for
speed, that copy doubles as a safe: when a text is found changed, the
phone can put the sealed version back.

**Exactly.** The cache stores verified bodies keyed by digest. "Restore"
writes the body whose digest the seal names, in one commit. It works only
while the cache survives; iOS may evict it, and then recovery is from git
history.

## 7. What this does not protect, stated plainly

- **The app itself.** The phone runs whatever `gdfekaris.com/gnomon/`
  serves. Whoever controls that GitHub account or its deploy can ship an
  app that signs false seals or hides findings, and the same account holds
  the brain. Mitigations, none complete: a hardware security key on the
  account; the app updates only when you accept the prompt, which can show
  the build id; hosting the app under a different account than the brain;
  in the end, a native app signed through Apple.
- **The phone and the phrase.** Anyone with your unlocked phone can seal
  as you. Anyone with the 24 words can enroll their own device.
- **Injected script.** The key cannot be copied, but script running in the
  app's page could ask it to sign. The app's content security policy and
  HTML-free markdown rendering are the defence.
- **A new device's first look.** A phone just recovered from the phrase
  cannot tell that the newest seals were removed before it first looked.
- **Material older than its seal.** "Sealed since \<date\>" proves no
  change since that date, not since you first captured it.
- **Deletion.** It is detected and reported, never prevented.
- **Most metadata**: tags, dates, and (pending decision D2) titles and
  authors.
- **Privacy.** Seals say nothing about who can read your texts; that is
  encryption's job.

## 8. Deferred to the desktop phase

The YubiKey, `gnomon keys|seal|verify`, the separate agent account, and
the independent Python verifier (S5 to S7). The FIDO verification code in
core stays, tested and unused. When desktop agents return, the
recommended shape is that they hold no write credential for your texts or
principles at all, which turns detection into prevention.

## 9. Decisions (all four accepted as recommended, 2026-11-19)

- **D1. One manifest for all principles, or one per set?** Recommended:
  one. Simpler to explain and verify. Cost: each principle edit writes a
  seal that grows with the number of principles (roughly 25 KB at 200).
- **D2. Should the `source` seal also cover title, author, work, and
  year?** Recommended: yes. Ratify is the moment you approve them, and a
  false attribution misleads reasoning. This amends the 2026-10-05
  decision that metadata is excluded.
- **D3. Is *unsealed* excluded from reasoning (§4.3)?** Recommended: yes.
- **D4. Keep captures and filed sources as two copies?** Recommended:
  yes. §4.2 makes the copy safe, and storing once would restructure the
  schema for no further gain. (I floated storing once earlier; this is
  the cheaper fix.)

## 10. Blocks

- [x] **I1. The texts** (S). `security.md`, Schema §11 and §7.20,
  Technical Specification §6.5 rewritten to this; `security.md`'s status
  line and its reference to a Python `--verify` corrected. Done
  2026-11-19. Five things the texts had to settle beyond §4, for the
  maintainer to confirm before I2: (a) a brain is *fully sealed* once
  "Seal everything that exists" has made the first manifest, and only
  from then is unsealed a finding; (b) a set is reasoned from only when
  the whole set verifies, not principle by principle; (c) a filing
  awaiting review has its own verdict, *pending*; (d) `notes.md` is not
  sealed and is no longer sent to a model, the sealed title and author
  go instead; (e) "Accept as mine" (`Seal: principles`) is the way out
  when principles show as changed, after every difference was shown.
- [x] **I2. Core** (L; done 2026-11-19, `core/src/seal`, 70 seal tests; the sealer hooks on the plans moved to I3). `source` and `principles` seals; verdicts by slug
  and bytes; pinned revocations; new attack rows: remove `inbox_ref`,
  swap a source's text, delete a revocation, edit a principle, reorder,
  edit a set's description, delete a principle, flip `curated` to
  `ratified`, add an unsealed principle.
- [ ] **I3. The app** (L). Seal on ratify and on every principle and set
  write; "Seal existing" extended to sources and principles; marks on
  principles; unsealed treated as untrusted; Reason's provenance line and
  quote check.
- [ ] **I4. Repair** (M). After the local cache block.
- [ ] **I5. The maintainer's check on brain-1.** Includes the pending S4
  check. Existing seals stay valid; nothing is re-signed.
