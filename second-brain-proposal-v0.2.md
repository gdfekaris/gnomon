# Second Brain — Product Proposal

**A portable, model-agnostic personal knowledge base with a bring-your-own-AI companion app**

Version 0.2 — Draft for spec development
September 2026

*Changes from 0.1: introduced principle sets (multiple, ordered, switchable collections of principles); resolved the four open questions from §9 into decisions; replaced the format summary in §5 with a normative schema (Appendix A); added Task D (compare principle sets); adjusted screens, delivery plan, and acceptance criteria accordingly.*

---

## 1. Summary

Second Brain is a personal knowledge system for people who collect passages, notes, and snippets by hand and want any AI model — cloud or local, subscription or API — to reason coherently from that collection. It consists of two artifacts: a **brain repository** (a conventions-based folder of plain markdown files stored in the user's own git repo) and a **companion web app** (an installable PWA for iPhone and desktop browsers) that provides capture, browsing, curation, and AI reasoning against the brain.

The brain has two layers. **Sources** are hand-picked passages preserved verbatim, with the curator's marginalia alongside. **Principle sets** are collections of principles the curator writes in their own words, each grounded in source passages. A user may keep several principle sets — Set 1, Set 2, Set 3 — and apply any one (or several) to a reasoning task, so the same question can be thought through under different sets of commitments and the differences laid side by side.

The system's defining commitment is that all state lives in the user's repository, never in the app, never in a model, and never on infrastructure operated by us. Models are stateless visitors; the repo is the single source of truth. This makes the brain portable across AI providers and tools by construction: a session in Claude Code on a Claude subscription, a session with a local model, and a session in the PWA via OpenRouter all read and write the same files, synchronized through git.

The initial audience is the maintainer plus family and friends — real external users, but a small, high-trust circle. Design decisions favor simplicity and honest privacy communication over enterprise hardening.

## 2. Goals and Non-Goals

**Goals.** Preserve hand-picked source material verbatim and immutably while allowing layered annotation. Let the curator maintain one or more principle sets, authored solely by the human, and switch between them freely. Enable three canonical AI tasks: reasoning *from* a principle set, relating *new* texts *to* a principle set, and comparing principle sets against one another. Support any AI model the user chooses, including subscription-based tools (Claude Code) that require no API key, API-key tools (Anthropic, OpenRouter), and local models — with full state continuity between sessions across all of them. Run with zero operator infrastructure: static hosting only, user-owned storage, user-owned AI credentials. Install to an iPhone home screen without the App Store.

**Non-goals (v1).** Real-time collaboration or shared brains. Multi-user permissions within one brain. Operating any server, database, or proxy. Full offline editing with automatic conflict resolution. Native iOS/Android builds. Sharing a single principle file across sets (cross-set reuse is by reference, not by shared file). Guaranteeing privacy from the AI provider the user selects (impossible by definition; addressed through disclosure and local-model support instead).

## 3. Users and User Stories

The system serves one persona at different levels of technical comfort: a thoughtful collector. Some users (the maintainer) also use developer tools; most will only ever touch the PWA.

### 3.1 Capture and curation

**US-1 — Quick capture.** As a user reading a book or browsing, I want to capture a passage or thought into my inbox in under fifteen seconds from my phone, so that collection never interrupts reading. *Acceptance: an inbox capture screen reachable in one tap from launch; text paste plus optional note; saved as a timestamped file in `inbox/` via a single commit; works while the passage is still on my clipboard.*

**US-2 — Agent-assisted filing.** As a user with items in my inbox, I want to ask an AI to process the inbox — identify sources, create verbatim `raw.md` files with frontmatter, stub `notes.md`, propose tags and principle links — so that clerical filing is done for me. *Acceptance: filing follows Task C in AGENTS.md and Appendix A §7.6; one commit per inbox item; inbox originals are never deleted by the agent; all agent-created files carry `curated: agent-proposed`; proposals are appended to `maps/_proposals.md` and name the principle set they target; agents never touch the generated index files.*

**US-3 — Ratification.** As a curator, I want to review agent filings and approve or reject them, so that nothing enters my brain without my judgment. *Acceptance: the app lists recent filing commits; each shows the files it introduced, with new files readable in full and modified files showing added lines only (see §9, decision 3); one tap ratifies (a single commit flipping `curated: agent-proposed` to `curated: ratified` across the filing and marking the inbox item filed) or rejects (a single revert commit); rejection is refused with an explanation if later commits have built on the filing.*

**US-4 — Manual filing.** As a curator, I want to create and edit sources, notes, and principles by hand whenever I choose, so that the agent workflow never becomes mandatory. *Acceptance: full create/edit UI for any editable file; hand-created files are marked `curated: human`; the app and AGENTS.md both enforce that agents treat `curated: human` files as read-only.*

**US-5 — Immutability of raw sources.** As a curator, I want captured passages preserved verbatim forever, so that my collection remains trustworthy primary material. *Acceptance: the app UI does not offer editing of existing `raw.md` content (corrections go to `notes.md`); AGENTS.md forbids agent modification; the app's write validator refuses any write that alters a ratified or human `raw.md` body; git history provides recovery if the rule is ever violated.*

### 3.2 Principle sets

**US-6 — Principle authorship.** As a curator, I want to write principle files in my own words, each grounded in linked source passages, so that my brain expresses coherent principles rather than a pile of quotes. *Acceptance: principle editor with template frontmatter; wikilink insertion helper for grounding passages; every principle belongs to exactly one set; principles are always `curated: human`; agents may only suggest principles via `maps/_proposals.md`.*

**US-7 — Cross-referencing.** As a curator, I want bidirectional links between passages, notes, and principles, so that the brain is navigable as a web rather than a filing cabinet. *Acceptance: dual-link format (`[[path]]` plus standard relative markdown link) on every cross-reference; the app renders both link forms as one tappable element; a backlinks panel on each file lists inbound references; both `_index.md` files are regenerated by the app on every write.*

**US-18 — Multiple principle sets.** As a curator, I want to keep more than one set of principles, so that I can think about the same question under different sets of commitments. *Acceptance: every brain starts with Set 1; "New set" creates Set N+1 in one commit; each set may carry an optional sub-name shown as "Set 2 — Work"; sets can be renamed and reordered; deleting a set renumbers the survivors so the sequence is always 1..N while every survivor keeps its sub-name; the last set cannot be deleted; set folders are keyed by a stable slug so no path ever changes and no link ever breaks; agents can never create, rename, reorder, or delete a set.*

### 3.3 Reasoning with the brain

**US-8 — Reason from a principle set.** As a user, I want to point a model at a question or text and say "reason according to Set 2, coherently, using my collected texts," so that the AI thinks *as an extension of that set* rather than from its general priors. *Acceptance: a chat screen with a principle-set picker; context assembled per Appendix A §8 (the set's descriptor, all its principles verbatim, grounding passages to budget); responses cite specific principles and passages as links; works with any configured AI provider; selecting several sets keeps each set's material separately labelled and requires the model to attribute every claim to a set.*

**US-9 — Relate a new text.** As a user encountering any new text, I want to ask "relate this to Set 1," so that I see where it agrees, challenges, echoes, or suggests amendment. *Acceptance: paste or upload the new text; principle-set picker as in US-8; output structured per Task B in AGENTS.md — agreements, challenges, echoed/contradicted passages with links, and proposal-only suggestions for new or amended principles, each naming its target set.*

**US-19 — Compare principle sets.** As a user with several sets, I want to ask "where do Set 1 and Set 3 agree and conflict," so that I understand the relationship between my own sets of commitments. *Acceptance: Task D preset; two or more sets selected; output lists shared ground, direct conflicts, and gaps (questions one set addresses and another is silent on), each cited to principles.*

**US-10 — Model choice.** As a user, I want to choose which AI does the reasoning — per session or per task — so that I control cost, capability, and privacy exposure. *Acceptance: provider settings support Anthropic API keys and OpenRouter keys (browser-callable); provider and model selectable at chat time; the context budget defaults to 60% of the selected model's window and is adjustable; keys stored only on-device.*

### 3.4 Multi-tool, multi-device continuity

**US-11 — Claude subscription on desktop, no API key.** As a desktop user with a Claude subscription, I want to work on my brain in Claude Code using my subscription auth, so that heavy sessions cost nothing beyond what I already pay. *Acceptance: the brain repo cloned locally is fully operable by Claude Code via AGENTS.md conventions alone; AGENTS.md instructs agents to pull at session start and commit-and-push at session end; no app involvement required.*

**US-12 — Cross-model continuity.** As a user, I want every update from any session — Claude Code, local model, PWA with OpenRouter — intact and visible in my next session with any other tool, so that the brain is one brain. *Acceptance: git remote is the synchronization point; the PWA reads/writes the remote directly via the GitHub API; desktop tools sync via ordinary git; a session started after another session's push sees all its changes; no tool holds private state; index files regenerate deterministically so two devices never disagree about them.*

**US-13 — Local model on desktop.** As a privacy-conscious user, I want to run reasoning tasks against my local clone with a local model (e.g., via OpenCode or Pi), so that on selected sessions no external AI sees my brain. *Acceptance: same AGENTS.md protocol works with local-model agent tools; documentation covers the recommended local setup; continuity via git as in US-12.*

### 3.5 Onboarding and administration

**US-14 — First-run setup.** As a new user (family/friend), I want the app to create my brain for me, so that I never have to understand git or repository structure. *Acceptance: onboarding walks through creating a GitHub account and a personal access token with in-app, step-by-step guidance; the app creates a private repo from the canonical template and commits the full scaffold including Set 1; total setup under ten minutes for a non-developer.*

**US-15 — Bring an existing brain.** As the maintainer (or any advanced user), I want to point the app at my already-existing brain repo, so that adoption doesn't require starting over. *Acceptance: setup accepts an existing repo selection; the app validates the scaffold against Appendix A §2 and offers to add anything missing without touching existing content; if principles exist in the pre-set flat layout the app offers a one-time repair that moves them into a newly created Set 1 and rewrites affected links — the only file move the app ever performs.*

**US-16 — Privacy disclosure and options.** As a user placing personal material in the system, I want to understand exactly who can technically access my brain and to have escalating privacy options, so that my trust is informed. *Acceptance: onboarding includes a plain-language "who can see what" screen (GitHub as host; the chosen AI provider during reasoning; nobody else); settings expose the optional client-side encryption toggle when implemented; documentation covers self-hosted git and local-model configurations.*

**US-17 — Optional encryption.** As a high-privacy user, I want file contents encrypted on my device before upload, so that my git host stores only ciphertext. *Acceptance (phase 4): AES-GCM via WebCrypto with a passphrase-derived key (slow KDF, unlocked once per session); transparent encrypt-on-write/decrypt-on-read in the app; clear warnings that encrypted brains are not readable on github.com or by desktop tools without an added decryption layer (e.g., git-crypt).*

## 4. System Architecture

### 4.1 Components

The system has exactly three kinds of components, none operated by us:

**The brain repository** — a git repository owned by the user (GitHub by default), containing only plain markdown and the AGENTS.md protocol, laid out per Appendix A. It is the single source of truth and the synchronization point for every tool.

**The companion PWA** — static HTML/CSS/JS hosted on a static host (GitHub Pages or equivalent). It executes entirely in the user's browser. It holds no backend. It communicates with two external services on the user's behalf, using credentials stored only on the user's device: the git host's HTTPS API (file read/write/commit, repo creation) and the user's chosen AI provider's API (reasoning requests). It is also the sole generator of the two index files.

**Desktop agent tools** — Claude Code (subscription auth), OpenCode/Pi with local models, or any agent that reads AGENTS.md. These operate on a local clone and synchronize with ordinary git. They are out of our codebase entirely; the brain's conventions are their integration surface. The template repo ships a small script that regenerates the index files so desktop sessions can keep them fresh without the app.

### 4.2 Data flow

The static host delivers the app once. Thereafter the phone talks directly to the git host API (reads and writes, each a real commit) and directly to the AI provider (prompt assembly happens on-device: the app fetches the selected principle sets and their grounding passages, applies the fill order and budget in Appendix A §8, concatenates them with the user's question according to the AGENTS.md task procedures, and sends the result to the provider). No request transits operator infrastructure. Responses that produce file changes (e.g., inbox filing performed by the model through the app) are written back through the git API as `curated: agent-proposed` commits, one per inbox item.

### 4.3 Storage abstraction

The app's storage layer is a thin interface — `list`, `read`, `write`, `commitBatch`, `history`, `compare`, `revert`, `createRepo` — with GitHub as the default driver. This is a day-one architectural requirement (cheap now, painful to retrofit) so that GitLab or self-hosted Forgejo/Gitea drivers, and an encrypting wrapper driver, can be added without touching feature code. `compare` and `revert` exist to support ratification (§9, decisions 2 and 3).

### 4.4 AI provider abstraction

Similarly, a provider interface (`complete(messages, model, options)` plus `contextWindow(model)`) with drivers for the Anthropic API (browser-callable with the CORS header) and OpenRouter (browser-callable; one key, many models). `contextWindow` feeds the default budget. Providers that block browser calls are out of scope for the PWA; those users are served by the desktop path.

### 4.5 Synchronization model

Git is the only sync mechanism. The discipline, encoded in AGENTS.md and in app behavior: pull (or fetch latest via API) at session start; commit and push at session end; the PWA additionally commits per meaningful action so phone work is never lost. All work happens on `main`; neither the app nor agents create branches. For a single user across devices, conflicts are rare; when they occur, markdown merges gracefully and the app surfaces a "your repo has newer changes — refresh" state rather than attempting silent resolution. Concurrent-edit locking is explicitly out of scope.

## 5. The Brain Format

The normative specification is Appendix A. In brief:

The scaffold is `sources/<slug>/raw.md` (verbatim, immutable) with sibling `notes.md` (curator marginalia); `principles/<set-slug>/` folders, one per principle set, each holding a `_set.md` descriptor and the set's principle files; `maps/_index.md` and `principles/_index.md` (generated, never hand- or agent-edited) and `maps/_proposals.md` (agent suggestions awaiting curator action); `inbox/` (unfiled captures); `templates/`.

Three rules make principle sets work without ever moving a file. Set folders are keyed by a short **stable slug** (`ps-7k2m`) that users never see as a label. The user-visible number is an **`order` field** in `_set.md`, kept contiguous 1..N by the app; renumbering after a deletion is a frontmatter edit, not a rename. The optional **sub-name** travels with the set through any renumbering. Each principle carries a `set:` field and a `grounds:` list so the index and prompt assembly can be computed from frontmatter alone.

Frontmatter carries `curated: human | agent-proposed | ratified`, tags, and source metadata. Every cross-reference uses dual-link format so Obsidian, GitHub's renderer, the PWA, and plain text all resolve it. The hard rules — raw immutability, human-file read-onlyness, principle and set authorship reserved to the curator, index files generated only — are enforced twice: procedurally in AGENTS.md for any agent, and structurally in the PWA's UI and write validator.

## 6. Companion App — Screens and Behavior

**Capture** (default screen): large paste target, optional note field, save-to-inbox.

**Browse**: folder-aware file list with tag filter; principles grouped by set in `order`, labelled "Set 2 — Work"; file view renders markdown, links, backlinks panel; edit honors curation rules; `raw.md` bodies have no edit affordance.

**Inbox & proposals**: inbox items, "process inbox with AI" action, proposals list from `maps/_proposals.md` grouped by target set, ratify/reject flows built on commit history with the mobile review view from §9 decision 3.

**Principle sets**: list of sets with ordinal and sub-name; new set, rename, reorder (drag), delete with confirmation and a dangling-reference report; per-set description editor (the `_set.md` body, which is also the set's framing instruction to the model).

**Reason**: chat interface; principle-set picker (multi-select chips, last selection remembered per device) above the task presets ("Reason from my principles," "Relate a new text," "Compare sets," free-form); provider/model picker; budget indicator showing how much of the selection fits; citations rendered as links into the brain.

**Settings**: git connection (token, repo), AI providers (keys), context budget percentage, privacy disclosure, encryption toggle (phase 4), theme.

**Onboarding**: token walkthrough with annotated steps, create-from-template or connect-existing (with the flat-principles repair offer), privacy explainer.

PWA installability: web app manifest, appropriate icons, standalone display; served over HTTPS; "Add to Home Screen" instructions for iOS. Local storage holds only credentials and UI preferences — the app remains disposable because the repo holds everything that matters.

## 7. Security and Privacy Posture

Credentials (git token, AI keys, encryption passphrase-derived key) live only in on-device browser storage; the operator never sees them. The recommended token is fine-grained and single-repo scoped; onboarding uses a broader token once for repo creation and then guides a swap for the cautious. Threat model honesty, stated in-app: the git host can technically read plaintext private repos (current GitHub policy excludes private repo content at rest from model training, but the protection is contractual, not technical); the selected AI provider sees whatever the reasoning task sends it — which, per Appendix A §8, is the selected principle sets and as many of their grounding passages as fit the budget, never the whole brain by default; the operator sees nothing. Escalation ladder: default (private GitHub repo + trusted provider) → client-side encryption (host sees ciphertext) → self-hosted git driver → local models (no external AI). Cryptography (phase 4): AES-GCM via WebCrypto, per-file random nonces, key derived with a deliberately slow KDF once per session; performance impact is negligible (<1 ms per file; network and model latency dominate by orders of magnitude).

## 8. Delivery Plan

**Phase 1 — Foundation.** Finalize the brain template repo: scaffold per Appendix A with Set 1 pre-created, AGENTS.md (session pull/push rules, the forbidden-actions list, Task A/B/C/D procedures, fill order and budget), templates, and the index regeneration script. Build the PWA core: GitHub driver including `compare` and `revert`, write validator, index generator, capture, browse/read, settings, manifest/installability. Maintainer connects existing brain (US-15) including the flat-principles repair; desktop continuity (US-11, US-12) validated end-to-end with Claude Code.

**Phase 2 — The full loop.** Principle-set management (US-18). Reason screen with Anthropic + OpenRouter drivers, set picker, budgeted assembly, and Tasks A, B, D (US-8, US-9, US-19, US-10). Inbox processing through the app (US-2), proposals and ratification with the mobile review view (US-3), manual filing/editing with curation enforcement (US-4, US-5, US-6, US-7).

**Phase 3 — Other people.** Onboarding with template-based repo creation and token walkthrough (US-14), privacy disclosure (US-16), polish for non-technical users; first family/friend installs.

**Phase 4 — Privacy options.** Client-side encryption toggle (US-17) with its documented tradeoffs; pluggable-backend driver #2 (Forgejo or GitLab); local-model documentation (US-13).

## 9. Decisions, Risks, and Open Questions

### 9.1 Decisions (resolving the 0.1 open questions)

**1. Prompt-assembly budget.** Tiered, per Appendix A §8: principle sets are always included verbatim and are never truncated (if they alone exceed budget the user is told to narrow the selection); grounding passages fill the remaining budget verbatim in order of first reference; overflow passages appear as `notes.md` summary plus link under an explicit "not included" heading so the model knows what it hasn't seen. Budget defaults to 60% of the model's window and is user-adjustable. Rationale: the principles are small by construction and are the thing that must never be lossy; passages are the variable cost; and a set that no longer fits is a signal to prune the set, not to build a cleverer assembler.

**2. Ratification: revert on `main`, not staged branches.** `curated: agent-proposed` is the staging area. Ratify is one commit flipping state across the filing; reject is one revert commit, refused if later commits touch the filing's files. Rationale: branches would double the git API surface, break the "one action, one commit" model, and force desktop sessions to know which branch to work on. Revisit only if agents begin producing large multi-commit filings.

**3. Mobile review view: files, not line diffs.** Filing commits are almost entirely additions of new files, so the review view lists touched files tagged new/modified, renders new files in full as markdown, and shows only added lines for the rare modified file (`_proposals.md`, an inbox item's status). Built from the compare endpoint with no diff library. Full line diffs remain a desktop concern.

**4. Index files are generated by the app only.** `maps/_index.md` and `principles/_index.md` are regenerated deterministically from frontmatter on every app write; agents never edit them; the template ships a regeneration script for desktop use. Rationale: LLM-maintained indexes drift, and a single deterministic generator means two devices can never disagree. Agents contribute navigation through `_proposals.md`.

**5. Principle sets are display-ordered, not path-ordered.** Stable slug folders plus an `order` field, so renumbering never moves a file or breaks a link (US-18, Appendix A §3.2, §4.4, §7.4).

**6. A principle belongs to exactly one set.** Cross-set reuse is by `related` reference. Rationale: keeps assembly, ratification, and the index simple; sources — not principles — are the shared layer.

### 9.2 Risks

Token UX is the adoption bottleneck: GitHub's token interface is the least friendly step for non-developers; mitigation is heavily guided onboarding, and a watch on GitHub's OAuth device-flow options as a future replacement. Provider CORS policies can change, breaking browser-direct AI calls; the OpenRouter driver plus desktop path is the hedge. iOS PWA storage eviction can log users out unexpectedly; mitigated by making re-auth trivial and keeping all state in the repo. Git-host policy drift (e.g., training-data terms) is a standing watch item; the pluggable backend is the structural answer. Desktop sessions that never run the index script leave indexes stale until the next app write; acceptable since the indexes are navigational, not authoritative, but AGENTS.md should nudge agents to run the script at session end.

### 9.3 Open questions

Whether the `_set.md` body should be sent as a system-level framing instruction or as ordinary context (affects how strongly the set's self-description steers the model). Whether Task D should be offered with a new text as well (a Task B run across several sets is close but not identical). Whether inbox items should support multiple passages per capture, or whether one-passage-per-capture is a feature. Whether the app should offer to auto-populate `grounds` from dual links found in a hand-written principle body, or leave frontmatter and body as independent duties of the curator.

## 10. Acceptance Criteria for v1 (Phases 1–3)

A non-technical iPhone user can go from nothing to an installed home-screen app with a private, scaffolded brain containing Set 1 in under ten minutes. Capture-to-inbox takes under fifteen seconds. The user can create Set 2, give it a sub-name, write a principle in each set, run the same question through Set 1, then Set 2, then both together, and receive cited, set-attributed output; deleting Set 1 leaves the former Set 2 labelled "Set 1 — {its sub-name}" with every link intact. The maintainer can run a Claude Code session on desktop under a Claude subscription, push, then open the PWA and see every change; the reverse also holds, and a subsequent OpenRouter session in the PWA reasons over the updated brain. All three canonical reasoning tasks produce cited, set-grounded output. No agent-written change enters the brain as ratified without explicit curator action, and no agent can create, alter, or remove a principle set. The operator runs nothing but a static file host and stores no user data or credentials.

---

# Appendix A — Brain Format Schema


*Repository layout, identifiers, frontmatter contract, link format, and maintenance procedures**

(Normative. Also maintained as a standalone document, second-brain-schema.md.)

---

### A.1. Scope and principles

This document defines the on-disk format of a brain repository. It is the contract shared by the companion PWA, AGENTS.md, and any desktop agent tool. Anything not defined here is unspecified and must not be relied upon.

Three design rules govern every decision below:

1. **Files never move.** Once created, a file's path is permanent. Ordering, naming, and grouping that the user can change are expressed in frontmatter, never in paths. This keeps every link valid forever and keeps git history contiguous.
2. **Frontmatter is the machine surface; the body is the human surface.** Every fact the app or an agent needs to act on (curation state, set membership, grounding links, ordering) lives in frontmatter so it can be read without parsing prose. Bodies are for people and models.
3. **Generated files are disposable.** Anything the app can regenerate from other files is marked generated, is never hand-edited, and is never edited by agents.

### A.2. Repository layout

```
<brain-root>/
├── AGENTS.md                     # agent protocol (procedural enforcement)
├── README.md                     # human orientation; links to AGENTS.md
├── inbox/
│   └── <timestamp>.md            # unfiled captures
├── sources/
│   └── <source-slug>/
│       ├── raw.md                # verbatim passage — IMMUTABLE
│       └── notes.md              # curator marginalia — editable
├── principles/
│   ├── _index.md                 # GENERATED: all sets and principles
│   └── <set-slug>/
│       ├── _set.md               # principle set descriptor
│       └── <principle-slug>.md   # one principle
├── maps/
│   ├── _index.md                 # GENERATED: master index of the brain
│   └── _proposals.md             # agent suggestions awaiting curator action
└── templates/
    ├── raw.md
    ├── notes.md
    ├── principle.md
    ├── set.md
    └── inbox.md
```

A brain is valid when `AGENTS.md`, the five top-level folders, and at least one principle set exist. The app's connect-time validator (US-15) checks exactly this list and offers to add anything missing.

### A.3. Identifiers

### A.3.1 Source slugs

`<source-slug>` is a human-readable, URL-safe slug derived from author surname and a short title fragment: lowercase ASCII letters, digits, and hyphens; 3–60 characters; no leading/trailing hyphen. Examples: `aurelius-meditations-4-3`, `didion-why-i-write`.

Uniqueness is per repository. On collision, append `-2`, `-3`, etc. The agent proposes the slug during filing; the curator may rename **only by rejecting the filing commit** and re-filing — never by moving the folder after other files link to it.

One source folder holds **one captured passage**. Several passages from the same work are separate folders sharing the same `work` and `author` frontmatter values, which is how the index groups them.

### A.3.2 Principle set slugs

`<set-slug>` is a stable, non-semantic identifier generated by the app at set creation:

```
ps-<4 chars from the alphabet 23456789abcdefghjkmnpqrstuvwxyz>
```

The alphabet omits `0 1 o i l` to avoid transcription ambiguity. Example: `ps-7k2m`. The app draws randomly and re-draws on collision with any existing folder under `principles/`. The slug is never displayed as the set's primary label; users see the set's ordinal and optional name (§4.4). The slug appears only in paths and links.

Desktop agents never create sets and therefore never generate set slugs. A user creating a set by hand on desktop should follow the same pattern; the app will accept any folder under `principles/` that contains a valid `_set.md`.

### A.3.3 Principle slugs

`<principle-slug>` follows the same character rules as source slugs and is derived from the principle's title. Uniqueness is **per set**; two sets may each contain `courage-before-comfort.md`. The fully qualified reference is always `<set-slug>/<principle-slug>`.

### A.3.4 Inbox filenames

`inbox/<YYYYMMDD>-<HHMMSS>-<3 random chars>.md`, UTC. Example: `inbox/20260905-143012-x7q.md`. Inbox files are never renamed; they are marked `status: filed` and left in place.

### A.3.5 Proposal ids

`P-<YYYYMMDD>-<nnn>`, sequential within the day. Example: `P-20260905-003`.

### A.4. Frontmatter contract

All files except `AGENTS.md`, `README.md`, and templates carry YAML frontmatter delimited by `---`. Field names are lowercase snake_case. Dates are ISO 8601 (`2026-09-05` or `2026-09-05T14:30:12Z`). Lists use YAML flow or block syntax; the app writes block syntax.

### A.4.1 Common fields

| Field | Required | Values | Notes |
|---|---|---|---|
| `type` | yes | `source`, `notes`, `principle`, `principle-set`, `inbox`, `proposals`, `index` | Discriminator; the app dispatches on it. |
| `curated` | yes | `human`, `agent-proposed`, `ratified` | See §5. |
| `created` | yes | datetime | Set once at creation. |
| `updated` | yes | datetime | Rewritten on every content change. |
| `tags` | no | list of slugs | Free vocabulary; lowercase, hyphenated. |

### A.4.2 `sources/<slug>/raw.md` — `type: source`

| Field | Required | Notes |
|---|---|---|
| `title` | yes | Short label for the passage, curator-facing. |
| `author` | yes | As printed; `unknown` permitted. |
| `work` | no | Title of the book, essay, article, etc. Shared across passages from the same work. |
| `year` | no | Year of the work. |
| `locator` | no | Page, section, timestamp, or URL fragment identifying where the passage sits in the work. |
| `origin` | no | URL, ISBN, DOI, or other retrieval handle. |
| `inbox_ref` | yes if filed from inbox | Inbox filename the passage came from. |
| `curated` | yes | `agent-proposed` when filed by an agent; `human` when created by hand; becomes `ratified` on approval. |

**Body:** the passage, verbatim, with no editorial marks. The body of `raw.md` is immutable once the file's curation state is `human` or `ratified`. While `agent-proposed`, the only permitted change is rejection (revert of the filing commit). The app never presents an editor for a `raw.md` body; AGENTS.md forbids agents from modifying one.

### A.4.3 `sources/<slug>/notes.md` — `type: notes`

| Field | Required | Notes |
|---|---|---|
| `source` | yes | The parent source slug (redundant with the path; used for validation). |
| `curated` | yes | Stubbed as `agent-proposed`; becomes `human` the first time the curator edits it. |

**Body:** free marginalia. Corrections to the passage (typos in the original, context, translation notes) go here, never into `raw.md`. Cross-references to principles use the dual-link format (§6).

### A.4.4 `principles/<set-slug>/_set.md` — `type: principle-set`

| Field | Required | Notes |
|---|---|---|
| `order` | yes | Positive integer; the user-visible ordinal ("Set 2"). Contiguous across all sets: 1..N with no gaps. |
| `name` | no | Optional sub-name ("Work", "Parenting"). Displayed as "Set 2 — Work". |
| `curated` | yes | Always `human`. |

**Body:** an optional description of what this set is for, written by the curator. Included verbatim in every reasoning prompt that selects the set, so it doubles as the set's framing instruction to the model.

**Display rule:** the label is `Set {order}` when `name` is absent and `Set {order} — {name}` when present. The slug is never part of the label.

### A.4.5 `principles/<set-slug>/<principle-slug>.md` — `type: principle`

| Field | Required | Notes |
|---|---|---|
| `title` | yes | The principle in one line. |
| `set` | yes | The parent set slug (redundant with the path; used for validation and for detecting misplaced files). |
| `grounds` | yes, may be empty | List of source slugs whose passages ground this principle. |
| `related` | no | List of fully qualified principle refs (`<set-slug>/<principle-slug>`), in any set. |
| `curated` | yes | Always `human`. |

**Body:** the principle in the curator's own words, followed by grounding passages as dual links. A principle belongs to exactly one set. Cross-set reuse is expressed with `related`, never by sharing a file.

### A.4.6 `inbox/<timestamp>.md` — `type: inbox`

| Field | Required | Notes |
|---|---|---|
| `captured` | yes | Same as `created`; kept for readability. |
| `note` | no | The optional note field from the capture screen. |
| `status` | yes | `unfiled` or `filed`. |
| `filed_as` | yes if filed | The source slug the passage became. |
| `filed_commit` | yes if filed | SHA of the filing commit, for reject/revert. |
| `curated` | yes | Always `human` (captures are the user's own action). |

**Body:** the captured text exactly as pasted. Inbox files are never deleted by agents. The app deletes an inbox file only when the curator explicitly clears it after ratification or after a rejected filing.

### A.4.7 `maps/_proposals.md` — `type: proposals`

A single append-only file with frontmatter (`type`, `created`, `updated`, `curated: agent-proposed`) and a body made of entries. Each entry is a level-2 heading carrying the proposal id, followed by a fixed key list and a free-text rationale:

```markdown
### P-20260905-003

- kind: principle
- target_set: ps-7k2m
- from_commit: 3f9a1c2
- status: open
- title: Prefer reversible decisions under uncertainty
- grounds: [aurelius-meditations-4-3, didion-why-i-write]

The passages filed in this commit both describe … (agent rationale, any length)
```

`kind` is one of `principle` (a suggested new principle), `link` (a suggested `grounds` or `related` addition to an existing principle), `tag` (suggested tags for a source), `amendment` (a suggested change to an existing principle's wording). `status` is `open`, `accepted`, or `declined`; only the app or the curator changes status. Agents only append entries. Accepting a `principle` proposal means the curator authors the principle by hand — the app pre-fills the editor from the entry but the resulting file is `curated: human` and the curator must save it deliberately.

### A.4.8 `maps/_index.md` and `principles/_index.md` — `type: index`

Generated files. Frontmatter carries `type: index`, `generated: <datetime>`, `generator: <app version>`, `curated: human` (they reflect curator-owned structure). First body line is an HTML comment: `<!-- GENERATED by the Second Brain app. Do not edit. Regenerated on every write. -->`

`maps/_index.md` contains, in order: principle sets by `order` with their principles (title → link, count of grounds); sources grouped by `author` then `work`, each a link with its `title`; a tag cloud as a list of tag → linked files. `principles/_index.md` is the first section only, provided so that prompt assembly for reasoning tasks fetches one file.

Regeneration is deterministic from frontmatter alone; two devices regenerating from the same commit produce byte-identical output.

### A.4.9 Templates

`templates/*.md` are plain files containing the frontmatter skeleton with placeholder values in `{{double_braces}}`. They have no frontmatter of their own. The app reads them to construct new files; agents copy them per AGENTS.md.

### A.5. Curation states and transitions

```
                 agent files from inbox
   (none) ───────────────────────────────▶ agent-proposed
      │                                          │
      │ curator creates by hand        curator   │ curator
      │                                ratifies  │ rejects
      ▼                                          ▼        (revert filing commit;
    human ◀──────────────────────── ratified    ✕          file ceases to exist)
      ▲   curator edits a ratified
      │   or agent-proposed notes.md
      └──────────────────────────
```

Rules:

- `raw.md`: `agent-proposed` → `ratified` on approval, or reverted on rejection. Body immutable in every state except through revert.
- `notes.md`: `agent-proposed` → `ratified` alongside its `raw.md`; either state → `human` on the curator's first edit.
- `principle`, `principle-set`, `inbox`: always `human`. An agent that writes one of these has violated the protocol; the app flags such commits for mandatory review.
- `human` files are read-only to agents. Agents may reference them and propose changes to them via `_proposals.md`, never edit them.
- `ratified` files may be edited by the curator (becoming `human`) but not by agents.

Ratification is a single commit that flips `curated` on every `agent-proposed` file introduced by one filing commit and sets the corresponding inbox item(s) to `status: filed`. Rejection is a single revert commit of the filing commit. Rejection is refused by the app if any later commit touches a file from the filing commit; the curator is then offered per-file manual cleanup instead.

### A.6. Link format

Every cross-reference is written in **dual-link form**: a wikilink immediately followed by a standard relative markdown link to the same target, so the reference resolves in Obsidian, in GitHub's renderer, in the PWA, and as plain text.

```
[[sources/aurelius-meditations-4-3/raw]] ([raw](../../sources/aurelius-meditations-4-3/raw.md))
[[principles/ps-7k2m/courage-before-comfort]] ([principle](../../principles/ps-7k2m/courage-before-comfort.md))
```

The wikilink target is the repository-relative path without the `.md` extension. Heading anchors (`#heading`) may be appended to both halves. The relative link is computed from the referencing file's location. The app's link-insertion helper writes both halves; the app renders both as a single tappable element and never shows the duplication.

`grounds` and `related` in frontmatter use bare slugs / qualified refs, not links; the body carries the links.

### A.7. Procedures

### A.7.1 Create a principle set

1. Generate a set slug (§3.2); re-draw on collision.
2. Determine `order` = current number of sets + 1.
3. Write `principles/<set-slug>/_set.md` with `order`, optional `name`, `curated: human`, timestamps.
4. Regenerate both index files.
5. One commit: `Create principle set: Set {order}{ — name}`.

A new brain is scaffolded with one set at `order: 1` and no `name`.

### A.7.2 Rename a set

Rewrite `name` in `_set.md`; regenerate indexes; one commit. No path changes.

### A.7.3 Reorder sets

Rewrite `order` in each affected `_set.md` so the sequence is 1..N; regenerate indexes; one commit.

### A.7.4 Delete a set

1. If the set contains principles, the app requires an explicit confirmation naming the count; deletion removes the folder and every file in it. (Git history preserves them.)
2. For every surviving set with `order` greater than the deleted set's, decrement `order` by 1.
3. Scan all principles for `related` refs into the deleted set and all `notes.md` bodies for links into it; list them to the curator as now-dangling. The app does not auto-remove them.
4. Regenerate indexes.
5. One commit: `Delete principle set: Set {order}{ — name}`.

The last remaining set cannot be deleted.

### A.7.5 Capture to inbox

Write `inbox/<timestamp>.md` (§3.4) with the pasted body; one commit. Under fifteen seconds end to end (US-1).

### A.7.6 Agent filing (Task C in AGENTS.md)

For each `status: unfiled` inbox item: create `sources/<slug>/raw.md` (body = inbox body verbatim) and `sources/<slug>/notes.md` (stub), both `curated: agent-proposed`; append any proposals to `maps/_proposals.md`; set the inbox item to `status: filed`, `filed_as`, `filed_commit`. One commit per inbox item, message `File: <slug>`. Agents do not touch either index file; the app regenerates on its next write, or the desktop user runs the regeneration script.

### A.7.7 Ratify / reject

See §5. Both are single commits.

### A.7.8 Connect an existing brain (US-15)

1. Validate layout (§2). Offer to add missing folders, `AGENTS.md`, templates.
2. If `principles/` contains `.md` files directly (pre-set layout), offer a one-time repair: create Set 1 (§7.1), move each file into it, add `set:` to each file's frontmatter, rewrite any relative links that referenced the old paths. One commit: `Migrate principles into Set 1`. This is the only move operation the app ever performs.
3. Regenerate indexes.

### A.8. Prompt assembly context rules

These rules govern which files are included when the app or an agent assembles context for a reasoning task. They are restated in AGENTS.md; this is the normative version.

**Budget.** A per-task token budget, default 60% of the selected model's context window, user-adjustable in settings.

**Fill order for Task A (reason from a principle set) and Task B (relate a new text):**

1. For each selected set: `_set.md` body, then every principle file, verbatim. If this alone exceeds budget, stop and tell the user the selection is too large for the model; never truncate principles.
2. For each principle, the `raw.md` of every slug in `grounds`, verbatim, in order of first reference, until the budget is reached.
3. For any grounding passage not included: its `notes.md` body (if any) plus its dual link, under a heading "Passages referenced but not included."
4. Task B adds the new text last; if the new text alone exceeds the remaining budget the user is told before the request is sent.

**Multiple sets.** When more than one set is selected, each set's material is wrapped under its own heading ("Set 2 — Work") and the instructions require the model to reason from each set separately before comparing, and to attribute every claim to a set.

**Task D (compare principle sets).** Step 1 only, for all selected sets, plus grounding passages as budget allows; no new text.

### A.9. Validation rules

The app validates on every read and refuses to write a file that fails validation. Agents are expected to conform; AGENTS.md includes the same list.

- Frontmatter parses as YAML and contains every required field for its `type`.
- `curated` is one of the three values, and is `human` for `principle`, `principle-set`, `inbox`.
- `set` in a principle equals its folder's slug; `source` in a notes file equals its folder's slug.
- `order` values across all sets form the contiguous sequence 1..N.
- Every slug in `grounds` names an existing `sources/<slug>/raw.md`; every ref in `related` names an existing principle. Violations are reported as warnings, not refusals, since a source may be legitimately mid-filing.
- Slugs match their character rules (§3).
- `raw.md` body of a `human` or `ratified` source is byte-identical to its previous committed version on any write that touches the file.

### A.10. Reserved and forbidden

- Filenames beginning with `_` are reserved for descriptors and generated files.
- No file other than `maps/_proposals.md` may carry `type: proposals`.
- Agents must never: create, rename, reorder, or delete a set; write any `human`-curated file; edit either `_index.md`; modify a `raw.md` body; delete an inbox item; create a branch. The app treats any commit that does one of these as requiring mandatory curator review before its files count as part of the brain.
