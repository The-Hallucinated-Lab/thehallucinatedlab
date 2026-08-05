# Contributing

## The one-minute version

```bash
git clone https://github.com/The-Hallucinated-Lab/thehallucinatedlab.git
cd thehallucinatedlab
npm install                      # dev tooling only — the site ships none of it
npm run check                    # lint + tests + spec sync
python -m http.server 4173       # then open http://localhost:4173
```

For the Python package:

```bash
pip install -e "python[dev]"
ruff check python/
pytest python/ -q
```

There is **no build step**. What is in the repo is what gets served.

## Read this first

[STANDARDS.md](STANDARDS.md) holds the project's standing constraints —
the invariants CI enforces, the judgment rules review enforces, and the
things we have deliberately decided not to do. They do not change when a
feature does. This file is the practical how-to; that one is the what
and the why.

## The rules that are not obvious

These are the ones that cost someone an afternoon when they were
learned the hard way. Everything else the linter will tell you.

### No inline `<script>`, ever. No `onclick=` either.

Every page sets `script-src 'self'` with no `unsafe-inline`. An inline
script does not error — the browser silently refuses to run it, and the
feature just quietly does not work. The same goes for an `onclick`
attribute. A print button sat dead for a whole release because of this.

Put it in a `.js` file and bind the handler there.
`test/site-invariants.test.js` fails the build if you forget.

### Never point an `<img>` at a master image

`assets/images/logo.jpeg` is 1024×1024 and exists **only** for the
social card. The navbar uses `logo-72.*`. A master image in a 36px box
costs ~4 MB of decoded memory to display 3 KB worth of pixels.

Use a sized variant, and always set `width` and `height` so nothing
shifts while it loads.

### The manifest is the contract

`spec/manifest.json` is read by the website, the Assistant's intent
parser, and the Python package. Argument names, bounds and defaults live
there and nowhere else. Change it and run:

```bash
npm run spec:sync
```

CI fails if the copy inside the wheel has drifted.

### Anything that observes must also stop

Observers get `unobserve`d when they fire. Timers get cleared. The
particle canvas stops when the tab is hidden or the hero scrolls away.
This is not premature optimisation — an `IntersectionObserver` rebuilt
per render held a detached DOM tree per search keystroke, and that bug
shipped.

### Decoration checks `shouldAnimate()` first

`script.js` skips the particle canvas and the typing loop under
`prefers-reduced-motion`, Save-Data, 2G, and on devices with ≤2 GB of
memory. New animation should do the same.

### Money, dates, and IDs

Timestamps are stored as full ISO 8601 with the offset — never
`.split('T')[0]`, which throws the timezone away.

## Tests

```bash
npm test                     # the whole JS suite
node --test test/nlp.test.js # one file
npm run test:coverage        # with coverage
pytest python/ -q            # the package
```

Browser scripts are plain `<script>` files, so the pure logic in each is
marked with sentinels:

```js
/* @pure-start */
function escapeHtml(str) { ... }
/* @pure-end */
```

`test/helpers/load-pure.js` evaluates just that block under Node. If you
reach for `document` inside the markers, the tests fail with a
`ReferenceError`. That is the point — it keeps the testable logic
genuinely separable from the DOM.

**Write the failing test first when fixing a bug.** Then fix it. A bug
that shipped once can ship twice.

### Verify your tests actually fail

A test that passes against broken code is worse than no test. Before you
trust a new test, break the thing it covers and watch it go red. The
existing suite was checked this way — reverting the markdown fix,
dropping the category allowlist, and removing body validation each
produce a failure.

## Linting

```bash
npm run lint
npm run lint:fix
```

The config is strict about correctness and silent about style. Two rules
are deliberately off, and the reasoning is in `eslint.config.js` — read
it before turning them on. Short version: `no-var` and
`no-implicit-globals` between them flagged 199 things, none of which was
a bug, because they were arguing with the architecture rather than
finding defects in it.

If you need to suppress a rule, use a targeted
`eslint-disable-next-line` **with a reason after `--`**. A bare disable
is a TODO nobody will ever find.

## Commits and PRs

- Branch off `main`. Name it for what it does: `fix/print-button`,
  `feat/converter-webp`.
- Explain **why** in the commit body, not what — the diff already says
  what. If you found a bug, say what the symptom was.
- Open a PR. Get a review. `CODEOWNERS` will pull in the right person.
- CI must be green.

## Working with an AI agent on this repo

Most of this codebase was written with one, so: it is a fast junior, not
a senior. It will confidently produce code that runs and is subtly
wrong. Things it got wrong here, more than once:

- Escaping newlines *before* matching fenced code blocks, so every code
  block rendered as literal backticks. It looked fine in review.
- Building a fresh `IntersectionObserver` on every render and never
  disconnecting it.
- `if (!name || !title || !body) return;` as an entire form validator —
  a silent bail indistinguishable from a broken page.
- A `fetch` with no timeout, which cannot fail, it can only hang.

**Read every line before you commit it.** Ask what happens when the
input is empty, when the network never answers, and when the thing gets
called twice. Those three questions catch most of it.
