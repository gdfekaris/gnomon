# Gnomon — integrity of the curator's texts and principles

**Status, 2026-11-19.** This is the claim of integrity version 2
(`integrity-proposal.md`, decisions D1 to D4), phone first. The format is
Schema §11, the implementation Technical Specification §6.5.

- **Built on the phone:** keys, the recovery phrase, seals on captures,
  chains and rollback detection, the banner (blocks S2 to S4); and, since
  2026-11-19 (blocks I2 and I3, marked *(v2)* below and in the schema),
  the seal a source gets at Ratify, the seal over the principles, pinned
  revocations, only sealed material in reasoning, and under each answer
  what it stood on and any quotation not found in it.
- **It takes one act by the curator to switch on for an existing
  brain:** Settings → Sealing → "Seal everything that exists". Until
  that is done on a brain, §1 holds there for captures and for sources
  ratified from then on; rows T23 to T36 of §7 are caught from that act
  onward. The maintainer did it on their own brain on 2026-11-19
  (block I5).
- **Not built:** repair from the copy on the phone (block I4), and
  showing a changed principle beside its sealed text; today the app
  names the file and the kind of change.
- **Set aside until the phone app works well:** the desktop CLI and
  YubiKey, the separate agent account, and a second, independent
  verifier. No such verifier exists today; an earlier version of this
  document described one as if it did.

This document is for someone deciding whether to trust Gnomon with texts
they reason from. It states what Gnomon claims, against whom, under which
assumptions, and what it does not cover. Where it says "the schema" it
means `gnomon-schema.md`, which is normative.

## 1. The claim

> For every capture, every source the curator has ratified, and the whole
> of the curator's principles, the app on the curator's phone either
> shows that the protected content is byte for byte what an enrolled
> device signed, or names the file that is not. Under the assumptions of
> §4, nobody else (not the AI model, not a holder of the repository's
> write credential, not the git host) can change, swap, reorder, remove,
> or add such content, or pass off content as the curator's, without the
> app reporting it the next time it opens the brain. Nothing that fails
> the check, and nothing that was never sealed, is given to a model.

This is detection and exclusion, not prevention (§5). It rests on two
facts: every seal is signed by a key that exists only inside the
curator's phone, and the app that checks the seals keeps its own memory
of what it has already accepted, outside the repository.

## 2. What is protected

- **A capture** (`inbox/<stem>.md`): its passage text, its note, its
  attached file.
- **A ratified source** (`sources/<slug>/raw.md`) *(v2)*: its passage
  text, its attached file, its title, author, work, and year, and which
  capture it was filed from.
- **The principles** *(v2)*: every set, its name and description, and
  the order of the sets; every principle's title, text, related
  principles, and grounds, and the order of principles within each set;
  the reserve. Each ground is bound to the exact text of the passage it
  cites, not only to its file name.

Not protected: notes on a source (`notes.md`), proposals, the generated
indexes, `AGENTS.md`, and the remaining metadata (tags, dates, locators,
origins, curation and filing fields). None of these is sent to a model on
a fully sealed brain, except that the task instructions are part of the
app.

## 3. The adversary

Anyone who can write to the brain's repository without being the curator
on an enrolled phone:

- **The AI model the app calls.** It can return any text.
- **A holder of the repository's token, or the git host itself.** They
  can change, delete, or add any file, push any commit with any message,
  author, and date, force-push, and rewrite history.
- **An agent working on a clone of the brain** (Claude Code, OpenCode
  with a local model, anything that speaks git), which ignores its
  instructions by mistake or by design. It can do all of the above, run
  any code where it runs, read the encryption passphrase when a session
  is given it, and write persuasive text addressed to the curator.

## 4. Assumptions

Each can be checked.

| # | Assumption | How to check it |
|---|---|---|
| A1 | The phone is not compromised, no agent runs on it, and the app it runs is the one built from this repository and served from `gdfekaris.com/gnomon/`. | The deploy workflow; Settings → About shows the build; the app updates only when the curator accepts the prompt. |
| A2 | The recovery phrase is kept on paper and typed only into the app on a phone. | The curator's practice; the app asks for it nowhere else and forgets it at once. |
| A3 | SHA-256, Ed25519, ECDSA P-256, HKDF-SHA256, and AES-256-GCM are sound, and the browser keeps a non-extractable key non-extractable. | Standard primitives; WebCrypto's `extractable: false`. |
| A4 | The GitHub account that serves the app is protected (a hardware security key is recommended), and no credential that can change `gdfekaris/gnomon` or its deploy is available to an adversary of §3. | Account settings. |

A1 and A4 carry the most weight and are the least checkable by the
curator; §5 says so plainly.

## 5. Not covered, on purpose

- **The app itself.** The phone runs whatever `gdfekaris.com/gnomon/`
  serves. Whoever controls that account or its deploy can ship an app
  that signs false seals or hides findings, and the same account holds
  the brain. A coding agent developing Gnomon runs with the maintainer's
  credentials and is inside this risk. Mitigations, none complete: a
  security key on the account; accepting updates deliberately and reading
  the build id; hosting the app under a different account than the
  brain; in the end, an app signed through Apple. Seals already made stay
  verifiable by any honest build.
- **The phone and the phrase.** Anyone holding the phone unlocked can
  seal as the curator. Anyone holding the 24 words can enroll their own
  device.
- **Injected script.** The device key cannot be copied out, but script
  running in the app's page could ask it to sign. The content security
  policy and markdown rendered without HTML are the defence.
- **Prevention and availability.** A git host cannot stop a holder of
  write access from changing or deleting a file. Gnomon makes that
  evident and keeps the result out of reasoning; it does not make it
  impossible. Recovery is from git history, another clone, or, once
  block I4 is built, the copy on the phone.
- **A verifier's first look.** Rollback is caught against what a phone
  has already accepted. A phone just recovered from the phrase cannot
  tell that the newest seals, or a revocation, were removed before it
  first looked. Gaps and breaks inside a chain are caught by any phone.
- **Material older than its seal.** Captures, sources, and principles
  that existed when they were first sealed are sealed as they stood:
  that proves no change since that day, not since they were written. The
  app shows the date.
- **The curator sealing tampered text.** Sealing and ratifying sign what
  is on screen. The app shows the whole text and the attribution first,
  and every difference before the principles are accepted as they
  stand; it cannot know what the curator meant.
- **A model misquoting.** A model can misstate a text nobody tampered
  with. The app marks any quotation in an answer that is not word for
  word in a passage the model was given *(v2)*; it does not judge the
  reasoning.
- **What §2 lists as not protected.**
- **Privacy.** Seals say nothing about who can read the texts; that is
  encryption's job (Technical Specification §6.4).
- **The desktop.** A principle edited by hand on a desktop, or by an
  agent, shows as changed until the curator accepts it on the phone.
  That is the design working, and it is clumsy; the desktop phase will
  give the desktop its own key.

## 6. The mechanism

Each item in plain words, then exactly.

- **The model never holds the pen.** A model only returns a suggestion;
  the app writes every file, and copies a passage byte for byte from the
  capture, never from the model's reply. *Exactly:* provider calls return
  text or JSON; every write is a `CommitBatch` built by `packages/core`
  and sent through `StorageDriver.commit`.
- **Fingerprints.** A short code computed from a text; change one comma
  and the code is entirely different. *Exactly:* SHA-256 over defined
  bytes (Schema §11.1).
- **Seals.** A small signed slip saying "this content has this
  fingerprint", which only the phone can make and anyone can check.
  *Exactly:* a device key (Ed25519 where the browser offers it, else
  ECDSA P-256) generated by WebCrypto as non-extractable and kept in
  IndexedDB; a seal is `{payload, sig}` under `.gnomon/seals/`, the
  signature over a context line and the RFC 8785 canonical JSON of the
  payload. On an encrypted brain seal files are encrypted too.
- **The recovery phrase.** Twenty-four words shown once at setup. They
  are the master key, whose only job is to vouch for a device or withdraw
  that. A key file an attacker adds has nothing vouching for it.
  *Exactly:* 256 bits as a BIP-39 phrase; the root Ed25519 seed is
  HKDF-SHA256 of it; the root signs enrollments and revocations; the
  phone pins the root's public key in its own storage and never reads it
  from the repository.
- **The chain and the phone's memory.** Seals are numbered and each names
  the one before, like pages of a bound ledger, and the phone remembers
  the last page it saw. A page torn out, the newest pages removed, or the
  whole repository wound back all show. *Exactly:* a hash chain per key
  (`seq`, `prev`); pinned heads and, *(v2)*, pinned revocations, kept
  outside the repository.
- **Ratifying is a signature** *(v2)*. Tapping Ratify signs "the source
  named X holds this text, this file, this title and author". A source
  counts as the curator's only if such a slip exists and the file still
  matches. The word `ratified` in a file's header grants nothing.
  *Exactly:* a `source` seal in the `Ratify:` commit (Schema §11.5);
  verdicts by slug and bytes (§11.6 steps 5 and 7).
- **The principles have a signed table of contents** *(v2)*. Every time
  a principle or a set is written, reordered, moved, or deleted, the
  phone signs a list of all sets in order, each description, and every
  principle in order with its fingerprint. The tree must equal the newest
  list. *Exactly:* a `principles` manifest (Schema §11.5), each naming
  the one it replaces; each ground carries its source's sealed body
  digest.
- **Unsealed means untrusted** *(v2)*. Once the existing material has
  been sealed, a ratified source or a principle with no seal is reported
  like a changed one, and only sealed content is sent to a model. A
  filing awaiting review is unsealed by design and simply not yet usable.
- **Every answer shows what it stood on** *(v2)*: the sets, principles,
  and passages the model was given, each with its mark, and any
  quotation not found word for word in them.
- **The app acts on it.** Changed content is marked, cannot be ratified
  or filed, and is left out of reasoning with a notice; a finding is a
  banner on every screen until the brain verifies again.

Schema §11 defines all of this exactly: byte encodings, canonical JSON,
signed bytes, key ids, root derivation, the seal kinds, and the
verification steps and verdicts.

## 7. Attacks and what catches them

Each row is a test in `packages/core/test/seal-verify.test.ts`, and all
of them run. T23 to T36 are the rows of version 2: they are caught on a
brain once its curator has sealed everything that exists (Schema §7.20),
and not before.

| # | Action by an adversary of §3 | Caught by (Schema §11.6) | Result |
|---|---|---|---|
| T1 | Edit a sealed capture's body | step 4 | capture broken |
| T2 | Edit its note | step 4 | capture broken |
| T3 | Replace its attachment | step 4 | capture broken |
| T4 | File it with an altered `raw.md` body | step 5 | source broken |
| T5 | File it with a different `original.<ext>` | step 5 | source broken |
| T6 | Edit a filed source after the capture was cleared | step 5 | source broken |
| T7 | Delete a sealed capture | step 4, no tombstone | brain finding |
| T8 | Delete a seal in the middle of a chain | step 3, gap | brain finding |
| T9 | Delete the newest seal and its capture | step 3, below the pinned head | brain finding |
| T10 | Force-push the brain to an older state | step 3, below the pinned head | brain finding |
| T11 | Edit a seal's payload | step 2 | seal invalid; content broken |
| T12 | Seal with its own key | step 2, unknown key | brain finding |
| T13 | Add its own key to `.gnomon/keys/` | step 1, no root signature | brain finding |
| T14 | Replace `.gnomon/root.json` | step 1, differs from the pinned root | brain finding |
| T15 | Copy a valid seal to another stem | step 2, the stem is signed | seal invalid; capture broken |
| T16 | Write a capture in the curator's name | no seal | unsealed, never verified |
| T17 | Request enrollment of its own key | the fingerprints differ on the two screens | not enrolled |
| T18 | Forge a tombstone | step 2 | seal invalid; brain finding |
| T19 | Seal with a revoked key | step 3 | brain finding |
| T20 | Fork a chain (a different seal at a pinned `seq`) | step 3 | brain finding |
| T21 | T1, T4, T8 on an encrypted brain | as above, with the brain key | as above |
| T22 | Edit unprotected metadata (tags, `locator`, `status`) | not caught, out of scope (§2) | verified |
| T23 | Edit a ratified source and delete its `inbox_ref` *(v2)* | step 5, the source seal | source broken |
| T24 | Replace a source's text and `inbox_ref` with another sealed capture's *(v2)* | step 5, the slug is signed | source broken |
| T25 | Change a ratified source's title, author, work, or year *(v2)* | step 5 | source broken |
| T26 | Flip a filing's `curated` to `ratified` without the curator *(v2)* | step 5, no source seal | brain finding, unsealed source; never assembled |
| T27 | Delete a ratified source *(v2)* | step 5 | brain finding |
| T28 | Edit a principle's text or title *(v2)* | step 6 | principle and set broken |
| T29 | Swap two principles' `order` *(v2)* | step 6 | set broken |
| T30 | Edit a set's description or name, or reorder the sets *(v2)* | step 6 | set broken |
| T31 | Delete a principle, or move one to the reserve *(v2)* | step 6 | set broken |
| T32 | Add a principle or a set *(v2)* | step 6 | principle unsealed, set broken |
| T33 | Change a principle's `grounds` or `related` *(v2)* | step 6 | principle and set broken |
| T34 | Restore an older manifest by deleting the newest *(v2)* | step 3, below the pinned head | brain finding |
| T35 | Delete a revocation *(v2)* | step 1, pinned revocation | brain finding; the key stays revoked |
| T36 | T23, T28, T29 on an encrypted brain *(v2)* | as above, with the brain key | as above |

T22 is there on purpose: a test holds that the claim covers only what it
says.

## 8. Evidence for a reviewer

- This document, Schema §11, and Technical Specification §6.5.
- The verifier, `packages/core/src/seal`, and the attack table of §7 as
  tests in CI.
- Signatures checked against Node's independent implementations, the
  BIP-39 word list held to its published SHA-256, and FIDO signature
  verification (kept for the desktop phase) tested against OpenSSH's own
  vectors and `ssh-keygen -Y verify`.
- There is one verifier. A second, written independently from the
  schema, is the right evidence and is deferred with the desktop phase.
