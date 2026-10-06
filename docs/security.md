# Gnomon — tamper evidence for captured content

**Status: designed 2026-10-05, not yet built.** The format is Schema §11,
the implementation plan Technical Specification §6.5, and the work Phase 5
blocks S2 to S7 (`tamper-evidence-proposal.md` §8). Until those blocks
ship, Gnomon makes none of the claims below, and this line says so.

This document is for someone deciding whether to trust Gnomon with
content that AI agents also work on. It states what Gnomon claims, against
whom, under which assumptions, and what it does not cover. Where it says
"the schema" it means `gnomon-schema.md`, which is normative.

## 1. The claim

> For every capture made on an enrolled device after sealing was set up,
> Gnomon shows that its passage text, its note, and its attached file are
> byte for byte what the user captured, in the inbox and in the filed
> source, or it shows that they are not. Under the assumptions of §4, an
> agent working on the brain cannot change, swap, or delete such content,
> or pass off a capture as the user's, without a trusted verifier
> reporting it the next time it runs.

This is detection, not prevention (§5). It rests on one fact: every seal
is signed by a key that never exists where an agent runs, and every
verifier the claim relies on runs where no agent does.

## 2. What is protected

Only what the user captures:

- the body and the `note` of each capture, `inbox/<stem>.md`;
- the capture's attached file, `inbox/<stem>.<ext>`;
- the filed copies, the body of `sources/<slug>/raw.md` and
  `sources/<slug>/original.<ext>`, which the schema requires to be
  byte-identical to the capture.

Not protected: every other frontmatter field (titles, authors, tags,
curation state, filing fields), principles, set descriptions, notes,
proposals, and the generated indexes.

## 3. The adversary

An agent (Claude Code, OpenCode with a local model, anything that speaks
git) working on the brain on the desktop, which ignores its instructions
by mistake or by design. It can:

- read and write every file in its clone of the brain, and push any
  commit, with any message, author, and date;
- force-push, rewrite history, and delete files;
- read the encryption passphrase, which encrypted-brain sessions give it,
  and so read and write every body;
- run any code, and read and write anything, in the OS account or
  container it runs in;
- write persuasive text, including instructions addressed to the user.

## 4. Assumptions

Each can be checked.

| # | Assumption | How to check it |
|---|---|---|
| S1 | Agent sessions run in their own OS account or container, whose only GitHub credential is a deploy key with write access to the brain repository alone. The maintainer's GitHub login, tokens, SSH keys, YubiKey handle file, and the `gnomon-cli` used to verify live in the maintainer's own account, which the agent's cannot read. | From the agent account: `gh auth status` shows no login; the maintainer's `~/.ssh` and `~/.config/gh` are unreadable; a push to `gdfekaris/gnomon` is refused. `docs/agent-sessions.md` (block S6) gives the setup. |
| S2 | No agent runs on the phone, the phone is not compromised, and the app it runs is the one built from this repository and served from `gdfekaris.com/gnomon/`. | The deploy workflow; Settings → About shows the build. |
| S3 | The recovery phrase is kept on paper and typed only on a phone. | The maintainer's practice; the app asks for it nowhere else. |
| S4 | SHA-256, Ed25519, ECDSA P-256, AES-256-GCM, and the OpenSSH FIDO signature format are sound, and the YubiKey does not sign without a touch. | Standard primitives; the FIDO user-presence flag is checked on every desktop seal. |
| S5 | The maintainer's GitHub account is protected by a security key, and no credential that can change `gdfekaris/gnomon` is available to an agent (S1 gives this). | Account settings; S1's checks. |

## 5. Not covered, on purpose

- **Prevention.** A git host cannot stop a holder of write access from
  changing a file, and GitHub cannot limit a credential to some paths on a
  direct push. Gnomon makes tampering evident; it does not make it
  impossible.
- **Availability.** An agent can delete content or vandalize the seal
  record. That is detected and reported, never hidden; recovery is from
  git history or another clone.
- **What §2 lists as not protected,** metadata above all.
- **Content an agent captures.** Agents may write captures at the user's
  request. They are unsealed by construction, and stay so until the user
  reads one and seals it as their own.
- **History before sealing.** Captures that exist when sealing is set up
  are sealed once, as they stand: that proves they are unchanged since
  that day, not since they were captured. The app shows the date.
- **The user attesting tampered text.** Sealing attests what is on
  screen. The app shows the whole text first; it cannot know what the user
  meant to capture.
- **Coding agents.** An agent developing Gnomon itself runs with the
  maintainer's credentials and could change the app or the verifier. That
  is a supply-chain risk, separate from agents working on a brain;
  optional block S10 (releases only from tags signed with the YubiKey)
  narrows it. Seals already made stay verifiable by any honest build.
- **A compromised phone, browser, or GitHub account** (S2, S5).

## 6. The mechanism

- **Keys.** A root key comes from 24 random words the phone shows once,
  at setup, for the user to write down. The root only enrolls and revokes
  device keys; the app forgets it at once, and every verifier pins its
  public key. Two device keys seal: the phone's, generated
  non-extractable in WebCrypto, and the YubiKey's, an OpenSSH FIDO key
  that signs only on a touch, whose handle lives in the maintainer's
  account. A desktop key is enrolled from the phone after the user
  compares its fingerprint on both screens.
- **Seals.** Committing a capture writes a seal: a signed statement of
  the stem and the digests of the body, note, and attachment, by one
  device key, numbered in that key's hash chain. Seals live under
  `.gnomon/seals/`; on an encrypted brain they are encrypted too, so their
  digests reveal nothing about the passages to the git host.
- **Filing needs no key.** A filed source verifies when its `raw.md` and
  `original.<ext>` match its capture's seal.
- **Verification.** A verifier checks every enrollment against its pinned
  root, every chain for gaps, breaks, and rollback against the heads it
  has seen, every signature, and every capture and source against its
  seals. Each capture and source is *verified*, *attested* (sealed after
  the fact, with the date), *unsealed*, or *broken*; anything wrong with
  the seal record itself is a finding on the whole brain.
- **Trusted verifiers.** The app on the phone, on every load, and
  `gnomon verify` in the maintainer's own account. The same command run
  where an agent runs, or in the brain's CI, is advisory only.
- **The app acts on it.** Broken content is marked, refused for
  ratifying and filing, and left out of reasoning, with a notice; a
  finding is a banner until the brain verifies again.

Schema §11 defines all of this exactly: byte encodings, canonical JSON,
signed bytes with a context line per kind, key ids, root derivation,
FIDO signature verification, and the verification steps and verdicts.

## 7. Attacks and what catches them

Each row will be a test fixture (block S2), run by the TypeScript core
and by an independent Python verifier (block S7), which must agree.

| # | Agent action | Caught by (Schema §11.6) | Result |
|---|---|---|---|
| T1 | Edit a sealed capture's body | step 4 | capture broken |
| T2 | Edit its note | step 4 | capture broken |
| T3 | Replace its attachment | step 4 | capture broken |
| T4 | File it with an altered `raw.md` body | step 4 | source broken |
| T5 | File it with a different `original.<ext>` | step 4 | source broken |
| T6 | Edit a filed source after the capture was cleared | step 4 | source broken |
| T7 | Delete a sealed capture | step 4, no tombstone | brain finding |
| T8 | Delete a seal in the middle of a chain | step 3, gap | brain finding |
| T9 | Delete the newest seal and its capture | step 3, below the pinned head | brain finding |
| T10 | Force-push the brain to an older state | step 3, below the pinned head | brain finding |
| T11 | Edit a seal's payload | step 2 | seal invalid; capture broken |
| T12 | Seal with its own key | step 2, unknown key | brain finding |
| T13 | Add its own key to `.gnomon/keys/` | step 1, no root signature | brain finding |
| T14 | Replace `.gnomon/root.json` | step 1, differs from the pinned root | brain finding |
| T15 | Copy a valid seal to another stem | step 2, the stem is signed | seal invalid; capture broken |
| T16 | Write a capture in the user's name | no seal | unsealed, never verified |
| T17 | Request enrollment of its own key | the fingerprints differ on the two screens | not enrolled |
| T18 | Forge a tombstone | step 2 | seal invalid; brain finding |
| T19 | Seal with a revoked key | step 3 | brain finding |
| T20 | Fork a chain (a different seal at a pinned `seq`) | step 3 | brain finding |
| T21 | T1, T4, T8 on an encrypted brain | as above, with the brain key | as above |
| T22 | Edit metadata (title, tags, `status`) | not caught, out of scope (§5) | verified |

T22 is there on purpose: a test holds that the claim covers only what it
says.

## 8. Evidence for a reviewer

- This document, Schema §11, and Technical Specification §6.5.
- Two independent verifiers: `packages/core/src/seal` (TypeScript) and
  `tools/gnomon-check.py --verify` (Python, written from the schema, not
  from the TypeScript), compared on every fixture in CI.
- FIDO verification tested against `ssh-keygen -Y verify` on signatures
  made by a real YubiKey.
- The attack table of §7, in CI.
