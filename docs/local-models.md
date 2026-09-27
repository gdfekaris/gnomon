# Reasoning with a local model

When you reason in the app, the AI provider you picked (Anthropic or
OpenRouter) receives the principle sets you selected and as many of their
passages as fit. A local model removes that last party: the model runs on
your own computer, reads your brain from your own clone, and nothing it
reads leaves the machine.

The app cannot do this (a phone does not run these models, and the app
talks only to providers on the internet). It is a desktop session: an agent
tool that reads the brain's `AGENTS.md`, backed by a model running
locally. This page sets that up with [Ollama](https://ollama.com) (runs
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
