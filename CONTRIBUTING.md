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

## Working in parallel

Two people, one repo, no staging environment. Every rule below is here
because ignoring it already cost us something.

### Merge within days, not months

Two branches opened in May were still sitting there in August, 102
commits behind `main`. Neither can be merged now without hand-resolving
seven files, so the work in them is effectively lost.

A branch's conflict surface grows with its age, and it grows fastest in
the files we both touch — `styles.css`, `pages.css`, `index.html`. If a
branch is going to live longer than a few days, it is too big: split it.

### Rebase before you push

```bash
npm run sync     # git fetch origin main && git rebase origin/main
```

Run it whenever you sit down on a branch. Ten small rebases are free;
one big one at the end is where the afternoon goes. It autostashes, so
it is safe with a dirty tree.

### Never force-push anything the other person has pulled

This is the one that actually broke things. A history rewrite — removing
committed MNIST binaries — replaced every commit SHA on `main`. The
consequences are still visible:

- Branches created before the rewrite have **no common ancestor** with
  `main`. Git cannot merge them at all; it is not a conflict, it is two
  unrelated histories.
- Every clone taken before it has a stranded `main` that can never
  fast-forward.

If history genuinely has to be rewritten (a leaked credential, a huge
binary), it is a planned operation: agree a time, everyone pushes and
stops, one person rewrites, everyone re-clones. Not a Tuesday afternoon.

### Say which page you are on

`CODEOWNERS` routes the review; it does not stop two people editing
`pages.css` at the same time. A one-line message before you start is
cheaper than the merge.

## When git does fight you

| Symptom | Fix |
|---|---|
| Conflict in `package-lock.json` | Never hand-merge it. `git checkout --theirs -- package-lock.json && npm install`, then commit the result. |
| Conflict in `python/thehallucinatedlab/data/manifest.json` | It is generated. Take either side, then `npm run spec:sync`. Only `spec/manifest.json` is edited by hand. |
| `refusing to merge unrelated histories` | Your branch predates the history rewrite. Cherry-pick the commits you still want onto a fresh branch off `main`; the branch itself cannot be saved. |
| Whole file shows as changed when you touched one line | Line endings. Should be impossible now — `.gitattributes` pins LF — but if it happens, `git add --renormalize .`. |

### Recovering a clone whose `main` is stranded

You have this if `git merge-base main origin/main` prints nothing at
all. It means your `main` and the real one share no history.

```bash
git fetch origin
git branch rescue/my-local-work main   # only if main has commits you want
git checkout main
git reset --hard origin/main
```

## Repo settings this all assumes

These live in GitHub's settings, not in the repo, so they have to be
switched on by hand — and they are what make the rules above enforceable
rather than advisory.

**Settings → General → Pull Requests**

- ✅ *Automatically delete head branches.* Without it, merged branches
  pile up; we had seven at once, and it stops being obvious which
  branches are alive.

**Settings → Branches → branch protection rule for `main`**

- ✅ Require a pull request before merging — 1 approval. With two of us,
  each approves the other.
- ✅ Require status checks to pass: `Tests and site invariants`,
  `Secret scan`, `THL library (3.10)`, `THL library (3.13)`.
- ✅ **Require branches to be up to date before merging.** This is the
  one that prevents the nastiest case: two PRs that are each green
  alone, and broken together. It costs an "Update branch" click on the
  second PR, which is the point.
- ✅ Require review from Code Owners.
- ✅ **Block force pushes.** See above for why.

If the up-to-date requirement starts to feel like ceremony, the upgrade
is a merge queue rather than turning it off.

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
