---
name: ollama-delegation
description: Use when work can be offloaded to a local Ollama model to conserve Claude tokens - summarizing or analyzing large files instead of reading them, and making test-verified code changes without reading the generated code. Invoke at the start of any session where token economy matters.
---

# Delegating to Ollama to conserve Claude tokens

Claude's context is the scarce resource; Ollama's is not. This skill offloads
work to Ollama so that large inputs and large outputs never enter Claude's
context.

## The core idea

Reading generated code costs tokens proportional to its size. Reading `PASS`
costs about ten tokens no matter how large the change was. **A test is a
compression function over correctness.** So: Claude writes the test, Ollama
writes the implementation and iterates until the test is green, and Claude
sees only the verdict.

The same logic applies to reading. Asking Ollama to summarize a 900-line file
costs ~30 tokens for the receipt instead of ~12,000 to read it.

## When delegation actually pays

Delegation is not free — Claude still writes a prompt and reads a result. It
wins only when input or output is large.

| Delegate | Do directly |
|---|---|
| Summarizing/analyzing files over ~200 lines | Reading a 20-line config |
| Analyzing long logs, diffs, stack traces | A one-line edit |
| Drafting docs, comments, commit messages | Anything needing repo-wide judgment |
| Code changes that a test can verify | Changes with no meaningful test |
| Boilerplate and repetitive edits | Architecture and design decisions |

If Claude would have to read the result closely to trust it, delegation saved
nothing and added a correctness risk. Prefer a test instead.

## Setup check (do this first)

The Ollama server is frequently **not running**; `http://localhost:11434`
refuses connections until it starts. Running any `ollama` CLI command boots it.

```bash
ollama list
```

Model: `gpt-oss:120b-cloud`. Note the `-cloud` suffix — it runs on Ollama's
servers, not locally. There is no local `gpt-oss:120b`. The user has stated
cloud usage limits are not a concern, so use it freely and do not ration calls.
A genuinely local fallback is `gemma4:e4b`.

## Tool 1 — read and summarize without reading

`~/.claude/scripts/ask-ollama.ps1` writes the answer to a file and prints only
a one-line receipt.

```bash
~/.claude/scripts/ask-ollama.ps1 -Prompt "Summarize what this does, its exports, and its state patterns" -In duochat/chat.jsx
```

Add `-Show` only when the answer is genuinely small and Claude must act on it.
Without `-Show`, Claude never pays for the output at all.

## Tool 2 — change code without reading it

`~/.claude/scripts/ollama-task.ps1` runs a fix → test → repair loop locally and
prints only a verdict.

```bash
~/.claude/scripts/ollama-task.ps1 -Task "Make parseTags handle empty input" -File duochat/data.js -Test "node --test tests/tags.test.js" -Context tests/tags.test.js
```

- `-File` is an allow-list. Ollama cannot write anything else.
- Originals are backed up to `%TEMP%\ollama-task-backups\`.
- If tests never pass, **all files are reverted** and it exits 1. A
  half-applied change that fails tests is worse than none, because it looks
  like progress.
- Ollama emits whole files between sentinel markers, not diffs — diffs fail on
  line-offset drift, whole files always apply. This costs more Ollama tokens,
  which is the intended trade.

## The workflow

1. **Write the test first.** This is Claude's job and the only part that needs
   real judgment. The test encodes the requirement and is cheaper than the
   implementation.
2. **Delegate the implementation** with `ollama-task.ps1`.
3. **Read the verdict, not the code.** On `OK`, move on.
4. **On `FAILED`**, the tree is already clean. Either sharpen the test, split
   the task smaller, or do that piece directly.

Do not read the generated file to "just check." That spends exactly the tokens
this workflow exists to save. If the test is too weak to trust, fix the test.

## This repo (thehallucinatedlab)

A static site: no build step, no runtime dependencies. `package.json` and
`node_modules` exist **for tests only** and are gitignored.

```bash
npm test
```

Runs `node --test`, which auto-discovers `tests/*.test.js`.

**JSX components are testable.** `duochat/*.jsx` files are classic browser
scripts — loaded via `<script type="text/babel">`, they declare components at
top level and publish them with `Object.assign(window, {...})`. Nothing is
exported, so they cannot be `require`d. `tests/harness.js` rebuilds the browser
environment (jsdom + React 18.3.1 global + Babel transform) and evaluates each
file in shared global scope, in `duochat.html` order.

Write tests as plain `.js` — no JSX syntax in test files, so no transform hook
is needed on the runner:

```js
const { loadDuochat, h } = require('./harness.js');
const win = loadDuochat();
// Testing Library must be required AFTER loadDuochat installs jsdom globals.
const { render, cleanup } = require('@testing-library/react');

test('renders', () => {
  const { container } = render(h(win.ChatScreen));
  assert.ok(container.textContent.length > 0);
});
```

Gotchas:
- Require `@testing-library/react` **after** `loadDuochat()`, never before.
- `app.jsx` is excluded from the harness on purpose — it is the bootstrap that
  mounts the whole app into `#root`.
- Load order in `LOAD_ORDER` mirrors the HTML and is load-bearing.
- The suite takes ~60s, mostly Babel transforms at startup. Scope the loop's
  `-Test` to a single file rather than `npm test` to keep retries fast.

## Making this available everywhere

This is a project skill. To use it in every project, copy it to the user-level
skills directory:

```bash
cp -r .claude/skills/ollama-delegation ~/.claude/skills/
```

The repo-specific section above will not apply outside this project.
