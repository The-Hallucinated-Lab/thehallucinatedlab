# Tool contract

**Read this before adding a tool. Every tool in this repo follows it — no exceptions.**

A tool is not one file. It is one capability that must appear identically on four surfaces:
the engine, the standalone page, the assistant, and the Utilities listing. A tool that exists
on some of them but not others is a bug, not a partial feature.

---

## 1. One name, everywhere

Pick one name. Use it verbatim on every surface — website, code, and terminal.

| Surface | Form | Converter example |
|---|---|---|
| Display name | Title case, no filler words | `Converter` |
| Tool id | lowercase, hyphenated | `converter` |
| Engine file | `tools/<id>.js` | `tools/converter.js` |
| Page file | `tools/<id>.html` | `tools/converter.html` |
| Global | `window.HallucinatedLab.<idCamel>` | `window.HallucinatedLab.converter` |
| CLI command | `thl <verb>` | `thl convert` |

Do **not** name it "Image Converter" in the UI and `converter` in code. A user who reads the
website and then the CLI help must see the same words. If a rename is needed, rename all
surfaces in the same commit.

### Argument names are part of the name

An argument is called the same thing in the UI label, the engine parameter, the CLI flag, and
the SDK positional. `format` is `format` everywhere. `quality` is `quality` everywhere. Never
`fmt` in one place and `format` in another.

| Surface | Form |
|---|---|
| Website control label | `Output format`, `Quality` |
| Engine parameter | `convert(file, format, quality)` |
| CLI flag | `--format png --quality 70` |
| SDK positional | `.converter("png", 70)` |

**Argument order is fixed: format first, quality second.** The website must present the controls
stacked vertically in that same order — format on top, quality below — so a user reading the page
learns the positional order without being told it.

### Quality is expressed as 0–100 everywhere the user can see it

The canvas API takes 0–1. That conversion happens **inside** the engine boundary. Users type `70`,
never `0.7`, in the UI, the CLI, and the SDK.

---

## 2. The engine — `tools/<id>.js`

The engine is the only place the actual work happens. Every other surface calls it.

```js
(function () {
  'use strict';
  function doThing(file, format, quality) { /* ... */ return Promise.resolve(result); }
  window.HallucinatedLab = window.HallucinatedLab || {};
  window.HallucinatedLab.myTool = { doThing };
})();
```

Rules:

- **Self-registering IIFE.** No module system, no build step. The site ships as static files.
- **No DOM reads.** The engine may create elements it owns (a `<canvas>`), but must never read
  page state or write to the page. It receives inputs and returns outputs. This is what lets the
  same file serve both the tool page and the assistant.
- **Return a Promise.** Reject with a `new Error()` carrying a message safe to show a user —
  "That image format could not be decoded by your browser", not a stack trace.
- **Validate inputs and reject early.** Unknown format rejects before any work starts.
- **No network.** Everything runs locally. A tool that uploads has failed the point of this site.

---

## 3. The standalone page — `tools/<id>.html`

Uses the shared `.tool-page-*` classes from `pages.css`. Do not invent per-tool layout CSS.

- `../styles.css` then `../pages.css`, in that order.
- The full six-link navbar. Copy it from an existing page — do not trim it.
- Controls in fixed argument order, stacked vertically (format, then quality).
- Elements that start hidden use `class="hidden"`. That utility is `!important` because
  component rules later in `pages.css` set their own `display` and would otherwise win.
- Loads the engine via `<script src="<id>.js">` and calls it. No duplicated logic.

---

## 4. Assistant integration — `interface.html`

The assistant is a **pure-NLP router**. There is no model. Do not add one.

Two things to add per tool:

**An intent matcher** returning parsed arguments or `null`:

```js
function detectMyToolIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (!/(verb|another verb)/.test(lower)) return null;   // gate on an action verb
  // ... extract args
  return { /* args */ };
}
```

- **Gate on an action verb.** Without it, "what is png?" routes as a conversion request.
- **Tolerate typos** on any closed vocabulary — see `FORMAT_TYPOS` (`pgn` → `png`).
- **Match the more specific pattern first.** `"by 50%"` must be tested before `"50%"`, or the
  general pattern swallows the specific one.
- **Clamp results, not just inputs.** Clamping a percentage to 100 still let "reduce by 200%"
  produce quality 0. Clamp the computed value too.

**A dispatch branch** in `runTool()`, which owns all preconditions:

- Check file present → check file type → check format. In that order: for a quality-only request
  the format is derived from the file, so a missing format usually means a missing file, and
  reporting it as a format problem misdirects the user.
- Never write a message to the bubble that a later line overwrites. If a caveat must survive
  (like "PNG is lossless, quality ignored"), carry it in a variable and append it to the result.
- Load the engine on demand with `loadToolScript('tools/<id>.js')`.

**Add a quick-action chip** to `#chat-quick` if the tool has a common one-line invocation. Chips
fill the input; they do not send. The user sees the phrasing, which teaches what the router
understands.

---

## 5. Utilities listing — `utilities.html`

One `<li class="tool-card fade-in">` per tool, linking to `tools/<id>.html`. Description says
what it does and that it runs locally.

---

## 6. Failure messages

Every rejection path must tell the user what to do next, not just what went wrong.

- Bad: "Conversion failed."
- Good: "Attach an image first, then ask me to convert it."
- Good: "PNG is lossless, so quality has no effect on it. Convert to JPG or WebP to make the file
  smaller."

Because there is no model to absorb unmatched input, the no-match path must list what the tool
*can* do. Silence is a failure.

---

## 7. Checklist

Before opening a PR that adds a tool:

- [ ] One name used identically across display, id, files, global, and CLI
- [ ] Argument names identical across UI label, engine param, CLI flag, SDK positional
- [ ] Argument order fixed and shown vertically on the tool page in that order
- [ ] User-facing quality is 0–100; the 0–1 conversion is inside the engine
- [ ] Engine is a self-registering IIFE with no DOM reads and no network
- [ ] Engine rejects with user-safe `Error` messages
- [ ] Standalone page uses shared `.tool-page-*` classes and the full six-link navbar
- [ ] Intent matcher gates on an action verb and tolerates typos
- [ ] Specific patterns tested before general ones
- [ ] Computed values clamped, not just parsed inputs
- [ ] Dispatch checks file → type → format, in that order
- [ ] No message written to a bubble that a later line overwrites
- [ ] Quick-action chip added if there is a common one-line invocation
- [ ] Card added to `utilities.html`
- [ ] Every failure path names the next action
- [ ] Stress-tested with typos, casing, filler words, out-of-range numbers, and wrong file types
