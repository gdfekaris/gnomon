# Smoke checklist for the live human test

The first pass over real GitHub, a real phone, and real providers, with
the maintainer's own brain and keys. Run it once per release candidate,
in order; each step names what to look at. Tick as you go and note
anything odd inline. Version under test: the one Settings shows.

Prerequisites: the app deployed somewhere Safari can reach it over HTTPS
(P1-18b), a GitHub account with an existing brain repository and room for
a scratch one, an Anthropic or OpenRouter key, an iPhone, a desktop with
Node 20+ and Claude Code, and a photo on the phone to attach.

## 1. Install on iPhone

- [ ] Open the app's URL in Safari. The first screen is onboarding, not
      Capture, and the bottom bar is hidden.
- [ ] Choose "Try the demo brain": Capture appears with the bar; the skin
      is Monochrome; switch skins in Settings and back.
- [ ] Share → Add to Home Screen → Add. The icon is the one-bit gnomon.
- [ ] Launch from the Home Screen: full screen, no browser chrome, lands
      on Capture, the demo connection survived.
- [ ] Turn on dark mode in iOS: the app inverts; switch to Gray bevel and
      Four-color workbench and check both dark palettes.

## 2. Create a brain from the template

- [ ] Settings → Disconnect → Set up or connect a brain → Create a new
      brain. Follow the fine-grained token steps as written; note any step
      whose wording no longer matches GitHub's screens.
- [ ] Paste a wrong token first: the sentence says it was rejected and the
      field keeps the value.
- [ ] Create with a good token: "Your brain is ready" names owner/name;
      the check says the brain is valid and its indexes are current.
- [ ] On github.com the repository is private, has one commit
      `Scaffold: template` on top of the initial one, and contains
      AGENTS.md, Set 1, the templates, `.claude/commands/`, and both index
      files.
- [ ] Privacy screen reads right. Swap step: paste a single-repository
      token; it is accepted; delete the broad token on GitHub afterwards.
- [ ] Finish lands on Capture with "All clear. Capture something."

## 3. Capture with a photo

- [ ] Paste a passage, add a note, attach a photo from Photos. Save.
- [ ] "Saved as <stem> with its attachment" within fifteen seconds.
- [ ] Browse → Inbox lists the capture with "attachment"; open it; the
      attachment link shows the image inline.
- [ ] On github.com the commit is `Capture: <stem>` with the .md and the
      image beside it.
- [ ] Airplane mode on: Capture says you are offline; save a text capture;
      it queues. Airplane mode off: it saves by itself. Try attaching a
      file while offline: refused with the sentence, capture kept.
- [ ] Attach a file over 20 MB: refused before upload with both sizes.

## 4. Connect an existing brain

- [ ] Settings → Disconnect → onboarding → Connect an existing brain with
      the maintainer's brain. A read-only token is refused with the
      sentence; a wrong repository name says it cannot be seen.
- [ ] With the right token: "Connected" and the validation results. If
      anything is missing from the scaffold, the offer adds it in one tap
      and one commit; nothing existing is rewritten (check the diff on
      github.com).
- [ ] Browse shows every set, principle, source, and proposal you expect,
      with the right precedence order; tag chips filter.

## 5. File and ratify

- [ ] Settings → add the provider key. Inbox → pick the provider and a
      model → Process inbox with AI on the photo capture from step 3.
- [ ] The filing appears under Recent filings as "awaiting review";
      Review shows raw.md and notes.md as new, the attachment by name and
      size, the proposals, and the two capture lines added.
- [ ] Ratify: state becomes "ratified"; on github.com the commit is
      `Ratify: <slug>` and the source is `curated: ratified`.
- [ ] Capture and file a second passage, then Reject it: state "rejected",
      the files are gone at head, the capture is unfiled again.
- [ ] Reject the ratified one: refused with the paths later commits
      touched.
- [ ] The nudge on Capture followed along: file → review → decide.

## 6. Reason from two sets

- [ ] Reason → both sets selected → the budget bar and note make sense for
      the model's window. Ask a question. The answer is set-attributed,
      names a tension and precedence where there is one, and every
      citation link opens the right file.
- [ ] Stop mid-stream: the partial answer stays with "(stopped)".
- [ ] Relate a new text: four sections; Save as proposal opens the form
      pre-filled; save it; Proposals lists it open and yours in the target
      set; on github.com the commit is `Add proposal: P-…`.
- [ ] Compare sets with no input. Decline a proposal; accept a principle
      proposal and write the principle in the editor; the proposal shows
      what it became.
- [ ] Raise the budget to 90% and pick a small-window model: the budget
      note refuses before anything is sent.

## 7. Desktop round trip through Claude Code

- [ ] Clone the brain on the desktop. `npx gnomon-cli status` matches what
      the app shows (unfiled, awaiting, open, indexes current) and the
      nudge agrees with the app's.
- [ ] In Claude Code, run `/capture` with a passage, then `/file-inbox`,
      then `npx gnomon-cli validate && npx gnomon-cli index`, commit, push.
- [ ] On the phone, the stale banner appears on the next write or the
      snapshot refreshes; Browse shows the desktop's filing awaiting
      review; ratify it from the phone.
- [ ] Back on the desktop, `git pull`; `npx gnomon-cli validate` is clean
      and `status` shows the ratification.
- [ ] Reason from the phone over the updated brain with the provider key:
      the new source is cited when relevant.
- [ ] `npx gnomon-cli --version` and Settings show the same version.

## 8. Wrap up

- [ ] Note every sentence that confused you or a step that took more than
      one try; those become Phase 4 polish items.
- [ ] Delete the scratch repository and the broad token if any remains.
- [ ] Record the date, device, iOS version, and app version at the top of
      this file's copy in the release notes.
