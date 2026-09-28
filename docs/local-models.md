# Reasoning with a local model

When you reason in the app, the AI provider you picked (Anthropic or
OpenRouter) receives the principle sets you selected and as many of their
passages as fit. A local model removes that last party: the model runs on
your own computer, reads your brain from your own clone, and nothing it
reads leaves the machine.

Most of this page is a desktop session: an agent tool that reads the
brain's `AGENTS.md`, backed by a model running locally. The app at
gdfekaris.com talks only to Anthropic and OpenRouter; a copy of the app
you build and host yourself can also talk to a model you run, which is
the last section, "From the phone". This page sets that up with [Ollama](https://ollama.com) (runs
the model) and [OpenCode](https://opencode.ai) (the agent, which reads
`AGENTS.md` by itself). Any agent tool that reads `AGENTS.md` and can run
shell commands works the same way.

## Who sees what, in a local session

| | Sees your text? |
|---|---|
| The model | Yes, on your computer, and nowhere else |
| Your git host (GitHub) | What you push, as always; ciphertext if the brain is encrypted |
| An AI provider | No |
| Ollama, OpenCode | No brain content. They download models, a provider package, and updates |

## What you need

- Node 20 or newer (for `npx gnomon-cli`), git, and a clone of your brain.
- Memory for the model. The one suggested below is about 19 GB on disk and
  wants roughly that much free RAM, plus a few GB for a long context. A
  laptop with 32 GB or more is comfortable.
- Patience on a computer without a strong graphics card. The model then
  runs on the processor: expect each reply to take from tens of seconds to
  a few minutes, longer when the agent reads many files. It works; it is
  not instant.

## Setup, once

**1. Ollama.** Install it from [ollama.com](https://ollama.com/download).
Then raise its context window: the default is 4,096 tokens, far too small
for an agent that must hold `AGENTS.md`, its tools, and your files. On
Linux, where Ollama runs as a service:

```
sudo systemctl edit ollama.service
```

and add, under `[Service]`:

```
Environment="OLLAMA_CONTEXT_LENGTH=32768"
```

then `sudo systemctl daemon-reload && sudo systemctl restart ollama`. (On
macOS, set `OLLAMA_CONTEXT_LENGTH` in the environment Ollama starts with;
Ollama's FAQ has the details.)

**2. A model that can use tools.** The agent needs a model that supports
tool calling. A good fit for a computer without a graphics card is
`qwen3:30b`, a mixture-of-experts model that uses only about 3B of its
30B parameters per token, so it runs at a usable speed on a processor:

```
ollama pull qwen3:30b
```

With a strong graphics card, larger models work better; with less memory,
`qwen3:14b` (about 9 GB) or `qwen3:8b` (about 5 GB) run, and follow the
rules less reliably.

**3. OpenCode.**

```
npm install -g opencode-ai
```

**4. A config for brain sessions, kept outside the brain.** OpenCode also
reads a config file from the project folder, but the brain's root holds
only brain files (`gnomon validate` flags anything else), so keep this one
in your home directory, at `~/.config/opencode/gnomon-local.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "enabled_providers": ["ollama"],
  "model": "ollama/qwen3:30b",
  "small_model": "ollama/qwen3:30b",
  "share": "disabled",
  "permission": { "webfetch": "deny", "websearch": "deny", "bash": "ask" },
  "provider": {
    "ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Ollama (local)",
      "options": { "baseURL": "http://localhost:11434/v1" },
      "models": { "qwen3:30b": { "name": "Qwen3 30B (local)" } }
    }
  }
}
```

What each line is for:

- `enabled_providers` and both models: only the local model is used, even
  for small jobs like naming the session.
- `share: disabled`: OpenCode can publish a session to a web link; this
  turns that off.
- `webfetch` and `websearch` denied: the model cannot reach the web.
- `bash: ask`: OpenCode asks before each shell command. A local model
  follows `AGENTS.md` less reliably than the largest cloud models, so
  seeing each `git` and `npx` command before it runs is worth the taps.

## A session

In your brain's clone, start OpenCode with that config:

```
cd ~/path/to/your-brain
OPENCODE_CONFIG=~/.config/opencode/gnomon-local.json opencode
```

Then ask in plain words, naming the task from `AGENTS.md`. For example:

- "Follow AGENTS.md. Pull, then reason from Set 1 about this question: …"
  (Task A)
- "Relate this text to Set 2, following Task B: …"
- "File the inbox, following Task C."

`AGENTS.md` carries the rest: pull first, one commit per action, validate
and index before the final push, push at the end. If the model skips a
step, tell it which one.

**An encrypted brain.** Set the passphrase in the shell before starting
OpenCode, so the agent can decrypt without ever seeing it typed:

```
read -rs GNOMON_PASSPHRASE && export GNOMON_PASSPHRASE
npx gnomon-cli guard --install     # once per clone
```

`AGENTS.md` then has the agent decrypt after the pull and wrap every
commit in `npx gnomon-cli encrypt` and `npx gnomon-cli decrypt`; the guard
refuses any commit that would store a plaintext body, whatever the model
does.

## What protects the brain from a careless model

- The hard rules in `AGENTS.md` (captured passages immutable, your files
  read-only, principles and sets yours alone).
- `npx gnomon-cli validate`, which refuses a changed passage, a moved
  file, or broken frontmatter.
- The commit guard, on an encrypted brain.
- Review: a filing arrives as "awaiting review", and nothing an agent
  files counts as part of the brain until you ratify it in the app.
- `bash: ask` in the config above, and `git diff` before you let it push.

## Other tools

LM Studio, llama.cpp's server, and other local runtimes expose the same
kind of local endpoint as Ollama, and other agent tools that read
`AGENTS.md` work the same way. The rules for what stays private are the
same: the model runs locally, the agent has no cloud provider configured,
and web access is off.

## From the phone: your own copy of the app, with your own model

The app installed from gdfekaris.com reasons only through Anthropic or
OpenRouter, and that will not change: its security policy lets it talk to
those two, GitHub, and itself, and nothing else. A copy of the app you build
can also reach **one** model endpoint you run. The feature is off unless
the build switches it on with `VITE_CUSTOM_ENDPOINT` (for a fork on GitHub
Pages, the repository variable `GNOMON_CUSTOM_ENDPOINT`; the main README
says how). It takes one of two values:

- `self`: the model is served from the same server as the app. The
  security policy needs no new address, and the browser needs no CORS.
  The simplest shape, and the one below.
- `https://model.example.com`: the app is hosted in one place (a fork's
  GitHub Pages) and the model in another. That one address is added to the
  policy, and the model's server must allow the app's site (CORS).

Settings → About in any copy says which it allows.

The model's server needs three things a phone requires and a desktop
tunnel does not: **HTTPS** with a real certificate (a phone will not call a
plain `http://` address from an https app), **a key**, because Ollama has
no login of its own and the address is reachable from the internet, and a
**name** the phone can reach.

### One server for both the app and the model (`self`), on AWS

A sketch for Ubuntu; adapt the names. You need a domain name you can point
at the server (for example `brain.example.com`).

1. **An instance.** With a 24 GB GPU, `qwen3:30b` is fast (use an AMI with
   NVIDIA drivers, such as AWS's Deep Learning AMI); on a processor alone,
   pick around 64 GB of RAM and expect slow replies. Give it an Elastic IP,
   point `brain.example.com` at it, and in its security group open 443 and
   80 (for the certificate) to the internet and 22 to your own address only.
   Check AWS's current prices, and stop the instance when you are not
   using it.

2. **Ollama and the model.** On the server:

   ```
   curl -fsSL https://ollama.com/install.sh | sh
   sudo systemctl edit ollama.service     # add under [Service]:
                                          # Environment="OLLAMA_CONTEXT_LENGTH=32768"
   sudo systemctl daemon-reload && sudo systemctl restart ollama
   ollama pull qwen3:30b
   ```

   Ollama listens on `localhost:11434` only, which is what you want: only
   Caddy, below, reaches it.

3. **Your copy of the app.** On your computer, in a clone of this
   repository:

   ```
   npx npm@latest install
   VITE_CUSTOM_ENDPOINT=self VITE_BASE=/ npm run build
   scp -r packages/app/dist/* you@brain.example.com:/srv/gnomon/
   ```

   (Create `/srv/gnomon` on the server first, owned by your user.)

4. **Caddy** in front of both, for automatic HTTPS and the key. Install it
   from its documentation ([caddyserver.com](https://caddyserver.com/docs/install)),
   make a key with `openssl rand -hex 24`, give it to Caddy with
   `sudo systemctl edit caddy` and, under `[Service]`,
   `Environment="GNOMON_MODEL_KEY=<the key>"`, then write
   `/etc/caddy/Caddyfile`:

   ```
   brain.example.com {
   	handle /v1/* {
   		@nokey not header Authorization "Bearer {$GNOMON_MODEL_KEY}"
   		respond @nokey 401
   		reverse_proxy localhost:11434 {
   			header_up Host localhost:11434
   		}
   	}
   	handle {
   		root * /srv/gnomon
   		try_files {path} /index.html
   		file_server
   	}
   }
   ```

   and `sudo systemctl daemon-reload && sudo systemctl restart caddy`. Every
   `/v1/` request without the key gets 401; the rest is the app. The
   `header_up` line presents the request to Ollama as a local one.

5. **On the phone.** Open `https://brain.example.com` in Safari, and add it
   to the Home Screen: it is a separate app from the gdfekaris.com one,
   with its own settings. Connect a brain (a scratch one for a first test),
   then Settings → AI providers → "Your own model": address
   `https://brain.example.com/v1`, the key, context window `32768`, Save.
   Reason and Inbox now offer "Your model".

What leaves the phone in this shape: the reasoning request goes to your
server and nowhere else. Your server sees the passages a task sends, as an
AI provider would; it is yours, which is the point.

### A fork on GitHub Pages with the model elsewhere

Set the fork's `GNOMON_CUSTOM_ENDPOINT` to the model server's origin, say
`https://model.example.com`, and serve only the model there. The browser
now sends a CORS check first, without the key, so the key rule lets it
through, and Ollama answers it once it knows the app's site:

```
model.example.com {
	@nokey {
		not header Authorization "Bearer {$GNOMON_MODEL_KEY}"
		not method OPTIONS
	}
	respond @nokey 401
	reverse_proxy localhost:11434 {
		header_up Host localhost:11434
	}
}
```

and in Ollama's service, beside the context length,
`Environment="OLLAMA_ORIGINS=https://<you>.github.io"`.

### At home

The same shapes work on a computer at home if the phone can reach it by an
HTTPS name. Tailscale gives each machine on your private network one
(`tailscale serve`), and the phone joins the same network with the
Tailscale app. Inside a network only your devices are on, the key matters
less; keep it anyway if other people share the network.

### Not yet known

This setup is written from the documentation of Ollama, Caddy, and the
app, and tested against a faked endpoint; the first run on a real server
(Phase 4 block 8) settles what the page cannot: how fast `qwen3:30b` is
on a given instance, and whether its thinking text stays out of the
answer or shows up in it.
