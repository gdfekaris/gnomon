# Gnomon — Product Proposal

**A portable, model-agnostic second brain with a bring-your-own-AI companion app**

Version 0.3 — Aligned with Brain Format Schema v0.2
September 2026

*Changes from 0.2, keyed to `alignment-review.md`: renamed to Gnomon (§4); one passage per capture with an optional attached source file (2.3c); principles ordered by precedence within a set (2.1) and without a status field (2.2); proposals are one file each (3.2); the filing commit marks the inbox item and ratification only flips curation state (3.1); the flat-principles repair is gone and the app never moves a file (3.6); the brain carries no Node manifest and the desktop CLI is published as `gnomon-cli` (2.6, 3.8); interface sketches now match the technical spec (3.10.2, 3.10.3); Appendix A is a pointer to the schema (3.9); two open questions closed (6.2, 6.4).*

---

## 1. Summary

Gnomon is a personal knowledge system for people who collect passages, notes, and snippets by hand and want any AI model — cloud or local, subscription or API — to reason coherently from that collection. It consists of two artifacts: a **brain repository** (a conventions-based folder of plain markdown files stored in the user's own git repo) and a **companion web app** (an installable PWA for iPhone and desktop browsers) that provides capture, browsing, curation, and AI reasoning against the brain.

The brain has two layers. **Sources** are captures preserved verbatim — a sentence or a whole essay, optionally with the file it came from — with the curator's marginalia alongside. **Principle sets** are ordered collections of principles the curator writes in their own words, each grounded in source passages. A user may keep several principle sets — Set 1, Set 2, Set 3 — and apply any one (or several) to a reasoning task, so the same question can be thought through under different sets of commitments and the differences laid side by side. Within a set, order is precedence: when two principles pull against each other, the earlier one governs, and the model must say so.

The system's defining commitment is that all state lives in the user's repository, never in the app, never in a model, and never on infrastructure operated by us. Models are stateless visitors; the repo is the single source of truth. This makes the brain portable across AI providers and tools by construction: a session in Claude Code on a Claude subscription, a session with a local model, and a session in the PWA via OpenRouter all read and write the same files, synchronized through git.

The initial audience is the maintainer plus family and friends — real external users, but a small, high-trust circle. Design decisions favor simplicity and honest privacy communication over enterprise hardening.

## 2. Goals and Non-Goals

**Goals.** Preserve captured material verbatim and immutably while allowing layered annotation. Let the curator maintain one or more ordered principle sets, authored solely by the human, and switch between them freely. Enable three canonical AI tasks: reasoning *from* a principle set, relating *new* texts *to* a principle set, and comparing principle sets against one another. Support any AI model the user chooses, including subscription-based tools (Claude Code) that require no API key, API-key tools (Anthropic, OpenRouter), and local models — with full state continuity between sessions across all of them. Run with zero operator infrastructure: static hosting only, user-owned storage, user-owned AI credentials. Install to an iPhone home screen without the App Store.

**Non-goals (v1).** Real-time collaboration or shared brains. Multi-user permissions within one brain. Operating any server, database, or proxy. Full offline editing with automatic conflict resolution. Native iOS/Android builds. Sharing a single principle file across sets (cross-set reuse is by reference, not by shared file). Extracting or indexing text from attached files (an attachment is kept, not parsed; the passage the curator typed or pasted is the searchable, promptable text). Any migration of brains in earlier formats (the app never moves or rewrites existing files; old brains are migrated by hand). Guaranteeing privacy from the AI provider the user selects (impossible by definition; addressed through disclosure and local-model support instead).

## 3. Users and User Stories

The system serves one persona at different levels of technical comfort: a thoughtful collector. Some users (the maintainer) also use developer tools; most will only ever touch the PWA.

### 3.1 Capture and curation

**US-1 — Quick capture.** As a user reading a book or browsing, I want to capture a passage or thought into my inbox in under fifteen seconds from my phone, so that collection never interrupts reading. *Acceptance: an inbox capture screen reachable in one tap from launch; text paste plus optional note plus optional attached file (PDF, HTML, image); saved as a timestamped capture in `inbox/` via a single commit; works while the passage is still on my clipboard.*

**US-2 — Agent-assisted filing.** As a user with captures in my inbox, I want to ask an AI to process the inbox — identify sources, create verbatim `raw.md` files with frontmatter, carry the attachment across, stub `notes.md`, propose tags and principle links — so that clerical filing is done for me. *Acceptance: filing follows Task C in AGENTS.md and Schema §7.6; one commit per capture; the `raw.md` body and the attachment are byte-identical copies of the capture (in the app the copy is made by the app, never by the model); all agent-created files carry `curated: agent-proposed`; proposals are written one file each under `maps/proposals/` and name the set they target; the filing commit marks the capture filed and that is the only field of a human-owned file an agent ever writes; inbox captures are never deleted by the agent; agents never touch the generated index files.*

**US-3 — Ratification.** As a curator, I want to review agent filings and approve or reject them, so that nothing enters my brain without my judgment. *Acceptance: the app lists recent filing commits; each shows the files it introduced, with new files readable in full and modified files showing added lines only (§9, decision 3); one tap ratifies (a single commit flipping `curated: agent-proposed` to `curated: ratified` on the filing's source and notes files) or rejects (a single revert commit, which also returns the capture to unfiled); rejection is refused with an explanation if later commits have built on the filing.*

**US-4 — Manual filing.** As a curator, I want to create and edit sources, notes, and principles by hand whenever I choose, so that the agent workflow never becomes mandatory. *Acceptance: full create/edit UI for any editable file; hand-created files are marked `curated: human`; the app and AGENTS.md both enforce that agents treat `curated: human` files as read-only.*

**US-5 — Immutability of captures.** As a curator, I want captured passages and attached files preserved verbatim forever, so that my collection remains trustworthy primary material. *Acceptance: the app UI does not offer editing of existing `raw.md` content or of any attachment (corrections go to `notes.md`); AGENTS.md forbids agent modification; the app's write validator refuses any write that alters a ratified or human `raw.md` body or any attachment; git history provides recovery if the rule is ever violated.*

### 3.2 Principle sets

**US-6 — Principle authorship.** As a curator, I want to write principle files in my own words, each grounded in linked source passages, so that my brain expresses coherent principles rather than a pile of quotes. *Acceptance: principle editor with template frontmatter; wikilink insertion helper for grounding passages; the editor warns when the body's source links and the `grounds` list disagree and offers a one-tap sync; every principle belongs to exactly one set and has a position in that set's order; principles are always `curated: human`; agents may only suggest principles via `maps/proposals/`.*

**US-7 — Cross-referencing.** As a curator, I want bidirectional links between passages, notes, and principles, so that the brain is navigable as a web rather than a filing cabinet. *Acceptance: dual-link format (`[[path]]` plus standard relative markdown link) on every cross-reference; the app renders both link forms as one tappable element; a backlinks panel on each file lists inbound references; both `_index.md` files are regenerated by the app on every write.*

**US-18 — Multiple principle sets.** As a curator, I want to keep more than one set of principles, so that I can think about the same question under different sets of commitments. *Acceptance: every brain starts with Set 1; "New set" creates Set N+1 in one commit; each set may carry an optional sub-name shown as "Set 2 — Work"; sets can be renamed and reordered; deleting a set renumbers the survivors so the sequence is always 1..N while every survivor keeps its sub-name; the last set cannot be deleted; set folders are keyed by a stable slug so no path ever changes and no link ever breaks; agents can never create, rename, reorder, or delete a set.*

**US-20 — Precedence within a set.** As a curator, I want to rank the principles in a set, so that when two of them conflict the model resolves the tension the way I would. *Acceptance: principles in a set are drag-reorderable and the order is stored in frontmatter, never in paths; the index, the prompt, and the browse view all show a set's principles in that order; a reasoning response that resolves a conflict between two principles names the tension, cites the governing principle, and says it invoked precedence; agents never change the order.*

### 3.3 Reasoning with the brain

**US-8 — Reason from a principle set.** As a user, I want to point a model at a question or text and say "reason according to Set 2, coherently, using my collected texts," so that the AI thinks *as an extension of that set* rather than from its general priors. *Acceptance: a chat screen with a principle-set picker; context assembled per Schema §8 (the set's descriptor, all its principles verbatim in precedence order, grounding passages to budget); responses cite specific principles and passages as links; works with any configured AI provider; selecting several sets keeps each set's material separately labelled and requires the model to attribute every claim to a set.*

**US-9 — Relate a new text.** As a user encountering any new text, I want to ask "relate this to Set 1," so that I see where it agrees, challenges, echoes, or suggests amendment. *Acceptance: paste or upload the new text; principle-set picker as in US-8; output structured per Task B in AGENTS.md — agreements, challenges, echoed/contradicted passages with links, and proposal-only suggestions for new or amended principles, each naming its target set. Selecting several sets gives each set's reading of the text, separately labelled; this is how a new text is compared across sets.*

**US-19 — Compare principle sets.** As a user with several sets, I want to ask "where do Set 1 and Set 3 agree and conflict," so that I understand the relationship between my own sets of commitments. *Acceptance: Task D preset; two or more sets selected; no new text; output lists shared ground, direct conflicts, and gaps (questions one set addresses and another is silent on), each cited to principles.*

**US-10 — Model choice.** As a user, I want to choose which AI does the reasoning — per session or per task — so that I control cost, capability, and privacy exposure. *Acceptance: provider settings support Anthropic API keys and OpenRouter keys (browser-callable); provider and model selectable at chat time; the context budget defaults to 60% of the selected model's window and is adjustable; keys stored only on-device.*

### 3.4 Multi-tool, multi-device continuity

**US-11 — Claude subscription on desktop, no API key.** As a desktop user with a Claude subscription, I want to work on my brain in Claude Code using my subscription auth, so that heavy sessions cost nothing beyond what I already pay. *Acceptance: the brain repo cloned locally is fully operable by Claude Code via AGENTS.md conventions alone; AGENTS.md instructs agents to pull at session start, run `npx gnomon-cli validate` and `npx gnomon-cli index` before the final push, and push at session end; the brain contains no `package.json`; no app involvement required.*

**US-12 — Cross-model continuity.** As a user, I want every update from any session — Claude Code, local model, PWA with OpenRouter — intact and visible in my next session with any other tool, so that the brain is one brain. *Acceptance: git remote is the synchronization point; the PWA reads/writes the remote directly via the GitHub API; desktop tools sync via ordinary git; a session started after another session's push sees all its changes; no tool holds private state; index files regenerate deterministically and carry no timestamp or version, so two devices never disagree about them.*

**US-13 — Local model on desktop.** As a privacy-conscious user, I want to run reasoning tasks against my local clone with a local model (e.g., via OpenCode or Pi), so that on selected sessions no external AI sees my brain. *Acceptance: same AGENTS.md protocol works with local-model agent tools; documentation covers the recommended local setup; continuity via git as in US-12.*

### 3.5 Onboarding and administration

**US-14 — First-run setup.** As a new user (family/friend), I want the app to create my brain for me, so that I never have to understand git or repository structure. *Acceptance: onboarding walks through creating a GitHub account and a personal access token with in-app, step-by-step guidance; the app creates a private repo and commits the canonical template, which already contains Set 1; total setup under ten minutes for a non-developer.*

**US-15 — Bring an existing brain.** As the maintainer (or any advanced user), I want to point the app at my already-existing brain repo, so that adoption doesn't require starting over. *Acceptance: setup accepts an existing repo selection; the app validates the scaffold against Schema §2 and §9 and offers to add anything missing, each addition one commit, without touching existing content; validation refusals and warnings are shown; the app never moves or rewrites an existing file.*

**US-16 — Privacy disclosure and options.** As a user placing personal material in the system, I want to understand exactly who can technically access my brain and to have escalating privacy options, so that my trust is informed. *Acceptance: onboarding includes a plain-language "who can see what" screen (GitHub as host; the chosen AI provider during reasoning; nobody else); settings expose the optional client-side encryption toggle when implemented; documentation covers self-hosted git and local-model configurations.*

**US-17 — Optional encryption.** As a high-privacy user, I want file contents encrypted on my device before upload, so that my git host stores only ciphertext. *Acceptance (phase 4): AES-GCM via WebCrypto with a passphrase-derived key (slow KDF, unlocked once per session); transparent encrypt-on-write/decrypt-on-read in the app; clear warnings that encrypted brains are not readable on github.com or by desktop tools without the `gnomon-cli` decrypt step; the disclosure states which files and fields remain cleartext, including whether attachments are encrypted.*

## 4. System Architecture

### 4.1 Components

The system has exactly three kinds of components, none operated by us:

**The brain repository** — a git repository owned by the user (GitHub by default), containing plain markdown, optional attached source files, and the AGENTS.md protocol, laid out per the Schema. It is the single source of truth and the synchronization point for every tool.

**The companion PWA** — static HTML/CSS/JS hosted on a static host (GitHub Pages or equivalent). It executes entirely in the user's browser. It holds no backend. It communicates with two external services on the user's behalf, using credentials stored only on the user's device: the git host's HTTPS API (file read/write/commit, repo creation) and the user's chosen AI provider's API (reasoning requests).

**Desktop agent tools** — Claude Code (subscription auth), OpenCode/Pi with local models, or any agent that reads AGENTS.md. These operate on a local clone and synchronize with ordinary git. They are out of our codebase entirely; the brain's conventions are their integration surface. The one piece of our code that runs on desktop is `gnomon-cli`, published to npm and invoked with `npx`, which validates a brain and regenerates its index files using the same shared library the app uses. There is one index generator with two entry points.

### 4.2 Data flow

The static host delivers the app once. Thereafter the phone talks directly to the git host API (the whole brain is read in a few batched requests; every write is a real commit) and directly to the AI provider (prompt assembly happens on-device: the app takes the selected principle sets and their grounding passages, applies the fill order and budget in Schema §8, concatenates them with the user's question according to the AGENTS.md task procedures, and sends the result to the provider). No request transits operator infrastructure. Filing performed through the app is a structured-output request: the model proposes metadata and proposals, the app copies the passage and attachment itself, and the result is written back through the git API as a `curated: agent-proposed` commit, one per capture.

### 4.3 Storage abstraction

The app's storage layer is a thin interface — `head`, `list`, `read`, `commit` (an atomic multi-file batch guarded by an expected head), `history`, `compare`, `revert`, and optional `createRepo` — with GitHub as the default driver. This is a day-one architectural requirement (cheap now, painful to retrofit) so that GitLab or self-hosted Forgejo/Gitea drivers, and an encrypting wrapper driver, can be added without touching feature code. `compare` and `revert` exist to support ratification (§9, decisions 2 and 3).

### 4.4 AI provider abstraction

Similarly, a provider interface — `listModels()`, which reports each model's context window, and a streaming `complete(request)` — with drivers for the Anthropic API (browser-callable with the CORS header) and OpenRouter (browser-callable; one key, many models). The reported context window feeds the default budget. Providers that block browser calls are out of scope for the PWA; those users are served by the desktop path.

### 4.5 Synchronization model

Git is the only sync mechanism. The discipline, encoded in AGENTS.md and in app behavior: pull (or fetch latest via API) at session start; commit per action; push at session end; the PWA commits per meaningful action so phone work is never lost. All work happens on `main`; neither the app nor agents create branches. For a single user across devices, conflicts are rare; when they occur, markdown merges gracefully and the app surfaces a "your repo has newer changes — refresh" state rather than attempting silent resolution. Concurrent-edit locking is explicitly out of scope.

## 5. The Brain Format

The normative specification is the Brain Format Schema (`gnomon-schema.md`). In brief:

The scaffold is `sources/<slug>/raw.md` (the capture, verbatim, immutable) with sibling `notes.md` (curator marginalia) and an optional immutable `original.<ext>` (the attached file); `principles/<set-slug>/` folders, one per principle set, each holding a `_set.md` descriptor and the set's principle files; `maps/proposals/`, one file per agent suggestion awaiting curator action; `maps/_index.md` and `principles/_index.md` (generated, never hand- or agent-edited); `inbox/` (captures, filed or not, with their attachments); `templates/`.

Three rules make principle sets work without ever moving a file. Set folders are keyed by a short **stable slug** (`ps-7k2m`) that users never see as a label; Set 1's slug is fixed in the template so every fresh brain is valid as shipped. The user-visible number is an **`order` field** in `_set.md`, kept contiguous 1..N by the app; renumbering after a deletion is a frontmatter edit, not a rename. The optional **sub-name** travels with the set through any renumbering. Each principle carries a `set:` field, an **`order:` field** that is its precedence within the set, and a `grounds:` list, so the index and prompt assembly can be computed from frontmatter alone.

Frontmatter carries `curated: human | agent-proposed | ratified`, tags, and source metadata. Every cross-reference uses dual-link format so Obsidian, GitHub's renderer, the PWA, and plain text all resolve it. The hard rules — capture immutability, human-file read-onlyness, principle and set authorship reserved to the curator, index files generated only, no file ever moved — are enforced twice: procedurally in AGENTS.md for any agent, and structurally in the PWA's UI and write validator.

## 6. Companion App — Screens and Behavior

**Capture** (default screen): large paste target, optional note field, optional attach-a-file control, save-to-inbox.

**Browse**: folder-aware file list with tag filter; principles grouped by set in set `order` and listed in precedence order within each set, labelled "Set 2 — Work"; file view renders markdown, links, backlinks panel, and an attachment preview or download where one exists; edit honors curation rules; `raw.md` bodies and attachments have no edit affordance.

**Inbox & proposals**: inbox captures, "process inbox with AI" action, proposals list from `maps/proposals/` grouped by target set with accept/decline, ratify/reject flows built on commit history with the mobile review view from §9 decision 3.

**Principle sets**: list of sets with ordinal and sub-name; new set, rename, reorder (drag), delete with confirmation and a dangling-reference report; per-set description editor (the `_set.md` body, which is also the set's framing instruction to the model); within a set, drag-reorder of principles.

**Reason**: chat interface; principle-set picker (multi-select chips, last selection remembered per device) above the task presets ("Reason from my principles," "Relate a new text," "Compare sets," free-form); provider/model picker; budget indicator showing how much of the selection fits; citations rendered as links into the brain.

**Settings**: git connection (token, repo), AI providers (keys), context budget percentage, privacy disclosure, encryption toggle (phase 4), theme.

**Onboarding**: token walkthrough with annotated steps, create-from-template or connect-existing (with validation results and offers to add missing scaffold), privacy explainer.

PWA installability: web app manifest, appropriate icons, standalone display; served over HTTPS; "Add to Home Screen" instructions for iOS. Local storage holds only credentials and UI preferences — the app remains disposable because the repo holds everything that matters.

## 7. Security and Privacy Posture

Credentials (git token, AI keys, encryption passphrase-derived key) live only in on-device browser storage; the operator never sees them. The recommended token is fine-grained and single-repo scoped; onboarding uses a broader token once for repo creation and then guides a swap for the cautious. Threat model honesty, stated in-app: the git host can technically read plaintext private repos (current GitHub policy excludes private repo content at rest from model training, but the protection is contractual, not technical); the selected AI provider sees whatever the reasoning task sends it — which, per Schema §8, is the selected principle sets and as many of their grounding passages as fit the budget, never attachments and never the whole brain by default; the operator sees nothing. Escalation ladder: default (private GitHub repo + trusted provider) → client-side encryption (host sees ciphertext) → self-hosted git driver → local models (no external AI). Cryptography (phase 4): AES-GCM via WebCrypto, per-file random nonces, key derived with a deliberately slow KDF once per session; encrypts markdown bodies, and the disclosure states plainly whether attachments are covered; performance impact is negligible (<1 ms per file; network and model latency dominate by orders of magnitude).

## 8. Delivery Plan

**Phase 1 — Foundation.** Finalize the brain template: scaffold per the Schema with Set 1 (`ps-g8xw`) pre-created, AGENTS.md (session pull/validate/index/push rules, the forbidden-actions list, Task A/B/C/D procedures, fill order and budget, precedence), templates, empty generated indexes. Build the shared library (schema, links, index, sets, principle ordering, validation) and publish `gnomon-cli` (`validate`, `index`, `status`). Build the PWA core: GitHub driver including `compare` and `revert`, write validator, index generator, capture with attachment, browse/read, settings, manifest/installability. Migrate the maintainer's existing brain by hand and connect it (US-15); desktop continuity (US-11, US-12) validated end-to-end with Claude Code.

**Phase 2 — The full loop.** Principle-set management and precedence (US-18, US-20). Reason screen with Anthropic + OpenRouter drivers, set picker, budgeted assembly, and Tasks A, B, D (US-8, US-9, US-19, US-10). Inbox processing through the app (US-2), proposals and ratification with the mobile review view (US-3), manual filing/editing with curation enforcement (US-4, US-5, US-6, US-7).

**Phase 3 — Other people.** Onboarding with template-based repo creation and token walkthrough (US-14), privacy disclosure (US-16), polish for non-technical users; first family/friend installs.

**Phase 4 — Privacy options.** Client-side encryption toggle (US-17) with its documented tradeoffs; pluggable-backend driver #2 (Forgejo or GitLab); local-model documentation (US-13).

## 9. Decisions, Risks, and Open Questions

### 9.1 Decisions

**1. Prompt-assembly budget.** Tiered, per Schema §8: principle sets are always included verbatim, in precedence order, and are never truncated (if they alone exceed budget the user is told to narrow the selection); grounding passages fill the remaining budget verbatim in order of first reference; overflow passages appear as `notes.md` summary plus link under an explicit "not included" heading so the model knows what it hasn't seen; attachments are never sent. Budget defaults to 60% of the model's window and is user-adjustable. Rationale: the principles are small by construction and are the thing that must never be lossy; passages are the variable cost; and a set that no longer fits is a signal to prune the set, not to build a cleverer assembler.

**2. Ratification: revert on `main`, not staged branches.** `curated: agent-proposed` is the staging area. Ratify is one commit flipping state on the filing's source and notes files; reject is one revert commit, refused if later commits touch the filing's files. Rationale: branches would double the git API surface, break the "one action, one commit" model, and force desktop sessions to know which branch to work on. Decision 9 keeps filings from colliding with each other.

**3. Mobile review view: files, not line diffs.** Filing commits are almost entirely additions of new files, so the review view lists touched files tagged new/modified, renders new files in full as markdown, and shows only added lines for the rare modified file (the capture's status fields). Built from the compare endpoint with no diff library. Full line diffs remain a desktop concern.

**4. Index files are generated only.** `maps/_index.md` and `principles/_index.md` are regenerated deterministically from frontmatter by the app on every write and by `gnomon-cli index` on desktop; agents never edit them. Their frontmatter is `type: index` alone — no timestamp, no version — so regeneration from the same commit is byte-identical everywhere and a no-op regeneration produces no diff. Rationale: LLM-maintained indexes drift, and a single deterministic generator means two devices can never disagree. Agents contribute navigation through proposals.

**5. Principle sets are display-ordered, not path-ordered.** Stable slug folders plus an `order` field, so renumbering never moves a file or breaks a link (US-18, Schema §3.2, §4.4, §7.4). Set 1's slug is fixed (`ps-g8xw`) so the template is itself a valid brain.

**6. A principle belongs to exactly one set.** Cross-set reuse is by `related` reference. Rationale: keeps assembly, ratification, and the index simple; sources — not principles — are the shared layer.

**7. One passage per capture, with an optional attached file.** A capture is whatever text the curator pasted, and `raw.md` is a byte-for-byte copy of it made by the app, never by a model; a capture may carry one attached file (PDF, HTML, image), kept immutable beside `raw.md` as `original.<ext>`. Rationale: with no selection step there is nothing for an agent to get wrong about the passage, so immutability is structural rather than procedural; the attachment preserves provenance without making the app a document parser. Five passages from one book are five captures grouped by author and work.

**8. Order within a set is precedence.** Each principle carries an `order` field kept contiguous by the app, exactly as sets are; assembly, index, and browse honor it; the Task A prompt says earlier governs and requires the model to announce when it invoked precedence. There is no status field: a principle in a set is in force, a discarded one is deleted (git history keeps it), and an idea not yet held stays a proposal. Rationale: precedence is what turns a list of principles into a stance; statuses were subsumed by sets (scoped), by deletion (retired), and by the proposals queue (provisional).

**9. One file per proposal.** `maps/proposals/P-<date>-<nnn>.md`, each with kind, target, status, and rationale. Rationale: a single shared proposals file is modified by every filing, which makes rejecting any filing but the latest impossible under the revert conflict check; per-file proposals keep each filing's footprint to its own files.

**10. The filing commit marks the capture filed.** Setting `status: filed` and `filed_as` on the inbox capture is the one named exception to "agents never write human files"; the capture's body and attachment stay untouchable. Ratification then only flips curation state, and rejection reverts the capture to unfiled for free. Rationale: the alternative, marking at ratification, requires a commit SHA that cannot be known inside the commit that would record it.

**11. The app never moves a file.** No migration, repair, or rename ever changes a path. Brains in earlier formats are migrated by hand. Rationale: one exception to "files never move" is the seed of the second.

**12. The brain carries no Node manifest.** `gnomon-cli` is published to npm and run with `npx`; the brain stays plain markdown plus attachments. Rationale: a second brain that needs `npm install` is not a folder of markdown.

### 9.2 Risks

Token UX is the adoption bottleneck: GitHub's token interface is the least friendly step for non-developers; mitigation is heavily guided onboarding, and a watch on GitHub's OAuth device-flow options as a future replacement. Provider CORS policies can change, breaking browser-direct AI calls; the OpenRouter driver plus desktop path is the hedge. iOS PWA storage eviction can log users out unexpectedly; mitigated by making re-auth trivial and keeping all state in the repo. Git-host policy drift (e.g., training-data terms) is a standing watch item; the pluggable backend is the structural answer. Attachments make the repository grow in ways markdown never does and are undiffable; the app enforces a size limit, the schema allows at most one per capture, and the disclosure says binaries stay in history forever. Cold-start time depends on reading every file's frontmatter, which is why the snapshot is loaded through batched requests rather than one request per file; the performance target is measured, not assumed. Desktop sessions that never run `gnomon-cli index` leave indexes stale until the next app write; acceptable since the indexes are navigational, not authoritative, and AGENTS.md requires the run before the final push.

### 9.3 Open questions

Whether the `_set.md` body should be sent as a system-level framing instruction or as ordinary context (affects how strongly the set's self-description steers the model); the spec carries a settings flag for evaluating both in Phase 2. Whether Phase 4 encryption should cover attachments or leave them cleartext with disclosure.

*Closed since 0.2:* Task D with a new text — no for v1; Task B with several sets selected is that comparison. Multiple passages per capture — no; one capture, one passage, optionally one file (decision 7). Auto-populating `grounds` from body links — the editor and `gnomon-cli validate` warn on disagreement and the editor offers a sync; frontmatter stays authoritative.

## 10. Acceptance Criteria for v1 (Phases 1–3)

A non-technical iPhone user can go from nothing to an installed home-screen app with a private, scaffolded brain containing Set 1 in under ten minutes. Capture-to-inbox takes under fifteen seconds, with or without an attached file. The user can create Set 2, give it a sub-name, write two principles in each set and rank them, run the same question through Set 1, then Set 2, then both together, and receive cited, set-attributed output that names any tension between principles and says when precedence decided it; deleting Set 1 leaves the former Set 2 labelled "Set 1 — {its sub-name}" with every link intact. The maintainer can run a Claude Code session on desktop under a Claude subscription, push, then open the PWA and see every change; the reverse also holds, and a subsequent OpenRouter session in the PWA reasons over the updated brain. All three canonical reasoning tasks produce cited, set-grounded output. A filing can be rejected even after later filings have landed. No agent-written change enters the brain as ratified without explicit curator action; no agent can create, alter, remove, or reorder a principle or a principle set; no file ever changes path. The operator runs nothing but a static file host and stores no user data or credentials.

---

# Appendix A — Brain Format Schema

The brain format is specified in one normative document, `gnomon-schema.md` (Brain Format Schema v0.2). This proposal cites it by section. It is not reproduced here so that there is exactly one copy to keep correct.
