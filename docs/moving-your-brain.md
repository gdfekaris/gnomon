# Moving your brain

Your brain is one git repository. Nothing lives in the app or on our
side: the phone keeps only your token and preferences, and reloads the
brain from the repository every time it starts. So moving your brain
means moving the repository, and git already knows how.

## Keep a copy somewhere else (the easy insurance)

You can stay on GitHub and keep a second copy on a host or a server you
control. In your clone on the desktop:

```
git remote add backup <url of an empty repository elsewhere>
git push backup main
```

Run `git push backup main` again whenever you like. GitHub stays the
brain the app uses; the copy is yours, with the full history and every
attachment.

## Move to another git host

Create an empty **private** repository on the new host (no README, no
licence file), then, from any directory:

```
git clone --mirror git@github.com:<you>/<brain>.git
cd <brain>.git
git push --mirror <url of the new repository>
```

In your working clone, point it at the new home:

```
git remote set-url origin <url of the new repository>
git pull
```

## Move to your own server

Any machine you can reach over SSH will do: a small AWS, Hetzner, or
home server. Once, on the server:

```
git init --bare ~/brains/brain.git
```

Then in your working clone:

```
git remote set-url origin you@your-server:brains/brain.git
git push -u origin main
```

Nothing else changes: pull at the start of a session, one commit per
action, `npx gnomon-cli validate` and `npx gnomon-cli index` before the
final push, push at the end. A plain storage bucket such as S3 is not a
git server, but git can use one through a helper (for S3, AWS publishes
`git-remote-s3`).

## Check the new copy

Clone it fresh somewhere else and run:

```
npx gnomon-cli validate
npx gnomon-cli status
```

Validate should report no refusals, and status should match what you
expect: the same sets, sources, and proposals.

## What keeps working, and what does not

Keeps working on any git host or server:

- `gnomon-cli`: validate, index, status, and encrypt and decrypt.
- Claude Code, or any agent that reads `AGENTS.md`, over your clone.
- Local models, through the same `AGENTS.md`.
- Obsidian, or any editor, over the folder.
- Encryption. Ciphertext is ordinary file content to the host; the
  passphrase and `.gnomon/encryption.json` travel with the repository. The
  commit guard lives in each clone, so run `npx gnomon-cli guard --install`
  again in a new clone.

Does not, today:

- **The phone app.** It reads and writes through GitHub's web API, so it
  works only with a brain on GitHub. If you move away from GitHub, the
  brain is a desktop brain until the app can talk to your host. If you
  want the app, keep the brain on GitHub and use the backup copy above
  for peace of mind. (Keeping two live copies that both receive writes is
  not recommended: they drift apart.)

## Afterwards

Once the new copy checks out:

1. In the app, Settings → Disconnect.
2. On GitHub, revoke the token the app used (Settings → Developer
   settings → Personal access tokens).
3. If you are leaving GitHub, delete the old repository (its Settings →
   Danger Zone). Until you do, GitHub still holds a copy.
