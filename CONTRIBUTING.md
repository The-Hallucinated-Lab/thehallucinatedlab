# Contributing

## The one-minute version

```bash
git clone https://github.com/The-Hallucinated-Lab/thehallucinatedlab.git
cd thehallucinatedlab

python -m pip install -e "python[dev,eda,eda-excel]"

pytest python/ -q                     # the suite
ruff check python/                    # lint
python scripts/sync_spec.py --check   # spec and wheel copy agree
```

There is **no build step**. What is in the repo is what runs.

## Read this first

[STANDARDS.md](STANDARDS.md) holds the project's standing constraints — the
invariants CI enforces, the judgment rules review enforces, and the things we
have deliberately decided not to do. They do not change when a feature does.
This file is the practical how-to; that one is the what and the why.

## The rules that are not obvious

These are the ones that cost someone an afternoon when they were learned the
hard way. Everything else the linter will tell you.

### The manifest is the contract

`spec/manifest.json` is read by the CLI, the intent parser and the Python
package. Argument names, bounds and defaults live there and nowhere else.
Change it and run:

```bash
python scripts/sync_spec.py
```

CI fails if the copy inside the wheel has drifted, and a test asserts the same
thing from the other side.

### Optional dependencies are imported late

The base install is Pillow and nothing else. If your code needs pandas, torch,
a document parser — import it *inside the function that needs it* and raise
`DependencyMissing` naming the extra. See `deps.py`. Importing it at module
scope makes the extra mandatory at import time, which is the thing we are
protecting against.

### Errors are classified, never raw

Raise a `THLError` subclass that names what failed and what the caller can do.
The CLI turns those into one line. A traceback is the right output for a bug
and the wrong one for "quality must be between 1 and 100".

### A partial pipeline is not a crash

The stages that finished left real artefacts. Say what ran, say where, say how
to resume — and exit 2 rather than 1, which is the convention for "written,
but something inside failed".

### Money, dates, and IDs

Timestamps are stored as full ISO 8601 with the offset — never
`.split('T')[0]`, which throws the timezone away.

## Tests

```bash
pytest python/ -q                     # everything
pytest python/tests/test_nlp.py -q    # one file
pytest python/tests/eda -q            # just the EDA suite
```

The EDA suite draws several hundred figures and takes a while — CI allows it
twenty minutes, so a local run that feels slow is normal rather than hung.

Some tests are contract tests against a shared fixture file in `spec/`
(`nlp-fixtures.json`, `chunk-fixtures.json`, `extract-fixtures.json`). Those
fixtures are the specification. If a case fails, fix the implementation — do
not special-case the fixture.

**Write the failing test first when fixing a bug.** Then fix it. A bug that
shipped once can ship twice.

### Verify your tests actually fail

A test that passes against broken code is worse than no test. Before you trust
a new test, break the thing it covers and watch it go red.

## Linting

```bash
ruff check python/
ruff check python/ --fix
```

If you need to suppress a rule, use a targeted `# noqa: <CODE>` with a reason
after it. A bare suppression is a TODO nobody will ever find.

## Commits and PRs

- Branch off `main`. Name it for what it does: `fix/quality-bounds`,
  `feat/parquet-extra`.
- Explain **why** in the commit body, not what — the diff already says what.
  If you found a bug, say what the symptom was.
- Open a PR. Get a review. `CODEOWNERS` will pull in the right person.
- CI must be green, and `CONTEXT.md` must carry a timeline entry for the
  change — the sync gate blocks a PR into `main` that does not.

## Working in parallel

Two people, one repo. Every rule below is here because ignoring it already
cost us something.

### Merge within days, not months

Two branches opened in May were still sitting there in August, 102 commits
behind `main`. Neither could be merged without hand-resolving seven files, so
the work in them was effectively lost.

A branch's conflict surface grows with its age. If a branch is going to live
longer than a few days, it is too big: split it.

### Rebase before you push

```bash
git fetch origin main && git -c rebase.autoStash=true rebase origin/main
```

Run it whenever you sit down on a branch. Ten small rebases are free; one big
one at the end is where the afternoon goes. It autostashes, so it is safe with
a dirty tree.

### Never force-push anything the other person has pulled

This is the one that actually broke things. A history rewrite — removing
committed MNIST binaries — replaced every commit SHA on `main`. The
consequences are still visible:

- Branches created before the rewrite have **no common ancestor** with `main`.
  Git cannot merge them at all; it is not a conflict, it is two unrelated
  histories.
- Every clone taken before it has a stranded `main` that can never
  fast-forward.

If history genuinely has to be rewritten (a leaked credential, a huge binary),
it is a planned operation: agree a time, everyone pushes and stops, one person
rewrites, everyone re-clones. Not a Tuesday afternoon.

## When git does fight you

| Symptom | Fix |
|---|---|
| Conflict in `python/thehallucinatedlab/data/manifest.json` | It is generated. Take either side, then `python scripts/sync_spec.py`. Only `spec/manifest.json` is edited by hand. |
| `refusing to merge unrelated histories` | Your branch predates the history rewrite. Cherry-pick the commits you still want onto a fresh branch off `main`; the branch itself cannot be saved. |
| Whole file shows as changed when you touched one line | Line endings. Should be impossible now — `.gitattributes` pins LF — but if it happens, `git add --renormalize .`. |

### Recovering a clone whose `main` is stranded

You have this if `git merge-base main origin/main` prints nothing at all. It
means your `main` and the real one share no history.

```bash
git fetch origin
git branch rescue/my-local-work main   # only if main has commits you want
git checkout main
git reset --hard origin/main
```

## Repo settings this all assumes

These live in GitHub's settings, not in the repo, so they have to be switched
on by hand. They are recorded here because a setting nobody wrote down is a
setting nobody can check.

**Settings → General → Pull Requests**

- **Allow squash merging** — and *only* squash merging. Every PR lands as
  exactly one commit, so `main` stays a straight line. This is the setting
  that does the most for us: with linear history there is never an ambiguous
  merge base, which is where the confusing conflicts come from.
- Allow merge commits — off.
- Allow rebase merging — off.
- **Automatically delete head branches.** Without it, merged branches pile up;
  we hit seven at once and it stopped being obvious which were alive.

**Settings → Branches → rule for `main`**

- **Block force pushes.** The single most important one. A history rewrite is
  what stranded every clone and orphaned a branch entirely; see above.
- **Require status checks to pass:** `THL library (3.10)`,
  `THL library (3.13)`, `Secret scan`, `CONTEXT.md is in sync`.

### Deliberately not enabled

These were considered and turned down, so nobody has to re-litigate them by
accident:

- **Required approvals.** With two people, requiring an approval means whoever
  is awake cannot ship. Read each other's PRs anyway — the review is the
  point, the enforcement was the cost.
- **Require branches to be up to date before merging.** Would catch two PRs
  that are green alone and broken together, at the cost of forcing an "Update
  branch" click on whichever lands second. If we ever get burned by that case,
  this is the fix.
- **Require Code Owner review.** `CODEOWNERS` still routes the review request;
  it just is not a gate.

## Working with an AI agent on this repo

Most of this codebase was written with one, so: it is a fast junior, not a
senior. It will confidently produce code that runs and is subtly wrong. Things
it got wrong here, more than once:

- A `fetch` with no timeout, which cannot fail, it can only hang.
- A test asserting a documentation URL appeared in CLI output — green long
  after the URL had stopped resolving.
- A stale header comment claiming the file talked to Ollama, four lines above
  the comment explaining there is deliberately no model.

**Read every line before you commit it.** Ask what happens when the input is
empty, when the optional parser is not installed, and when the thing gets
called twice. Those three questions catch most of it.
