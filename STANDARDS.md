# Engineering Standards

These are the project's standing constraints. **They do not change when a
feature does.** Anything built here — a tool, a pipeline, a dependency, a
refactor — has to satisfy them, and most of them fail CI if it doesn't.

The distinction that matters:

- **Invariants** are enforced by a test. You cannot regress one without a red
  build. Do not weaken the test to make a change pass.
- **Judgment rules** cannot be tested. They are here so a reviewer has
  something specific to point at.

---

## 1. Invariants (enforced — a red build means you broke one)

| Rule | Enforced by |
|---|---|
| The packaged tool spec matches `spec/manifest.json` | `scripts/sync_spec.py --check`, and `test_registry.py` from the other side |
| Every tool in the manifest has a `title`, `summary`, `description`, `aliases` and `keywords` | `test_registry.py` |
| Every parameter has a `description` and a type the registry knows | `test_registry.py` |
| Every case in `spec/nlp-fixtures.json` parses to the agreed result | `test_nlp.py` |
| Every case in `spec/chunk-fixtures.json` chunks to the documented records | `test_chunk.py` |
| Every case in `spec/extract-fixtures.json` assembles to the documented output | `test_extract.py` |
| Python lints and passes on 3.10 and 3.13 | `ruff check python/`, `pytest python/` |
| The alias version and its pin match the package version | `release.yml`, before the build |
| No credential patterns committed | CI secret scan |

**The spec is the contract.** A bound written anywhere other than
`spec/manifest.json` is a bug waiting for the day the two disagree. Neither
the registry nor a tool implementation may restate one.

---

## 2. Judgment rules

Not testable. Enforced by review.

**Errors**

- Never an empty `except`. If you are absorbing something deliberately, say
  what and why in the block.
- Never surface a raw exception message. Raise a `THLError` subclass that
  names what failed and what the caller can do — the CLI turns those into one
  line, and a traceback is the right output for a bug and the wrong one for
  "quality must be between 1 and 100".
- A failure must leave the filesystem in a state the caller can act on. A
  pipeline that stopped at stage three leaves stages one and two on disk, and
  says how to resume.
- Every outbound network call gets a timeout. A call with no deadline cannot
  fail; it can only hang.

**Dependencies**

- The base install is Pillow and nothing else. Protect that.
- Import optional dependencies *inside* the function that needs them, and
  raise `DependencyMissing` naming the extra. See `deps.py`.
- Bound every range (`>=x,<y`). An unbounded `>=` lets a new lint rule turn
  CI red on code nobody touched — that has happened.

**Data**

- Validate at the boundary, report every problem at once, and normalise
  before writing.
- Bounds live in `spec/manifest.json` and nowhere else.
- Sampling is never silent. If a large file is streamed rather than read
  whole, the report says so on the figure and in the recipe.

**Comments**

- Explain *why*, not *what*. The diff already says what.
- A comment that contradicts the code is worse than no comment. When
  behaviour changes, the header comment changes in the same commit.

---

## 3. Deliberately not done

Recorded so nobody re-proposes them without new information.

| Rejected | Reason |
|---|---|
| A web UI in this repo | It was here and was removed. Two front ends sharing one spec meant every tool change had to land twice, and the browser copy could not do the work that needs a real parser. The CLI is the front end. |
| `thl serve` (loopback HTTP bridge) | It existed so a page could hand a document to a local install. With no page, nothing calls it. |
| Hard dependency on pandas / torch | Would take `pip install thehallucinatedlab` from megabytes to gigabytes for people who came for `convert`. |
| An LLM in the intent parser | "make it a jpg at 80 quality" is bounded classification and slot filling. Rules run instantly and can be tested; weights cannot. |
| A config file | Defaults live in the manifest, and flags override them. Nothing to find, nothing to get out of sync. |
| Sentry / APM / telemetry | Every one phones home. This package's premise is that nothing leaves the machine. |

---

## 4. Recipes

### Adding a tool

1. Define it in `spec/manifest.json` — name, params, types, bounds, defaults,
   and the `aliases` and `keywords` the parser matches on. This is the
   contract.
2. `python scripts/sync_spec.py` so the package carries the same copy.
3. Implement it under `python/thehallucinatedlab/tools/`. Read the bounds
   from the registry; do not restate them.
4. Export it from `python/thehallucinatedlab/__init__.py`.
5. Wire it into `cli.py` — a subparser and a runner.
6. Test it, and add a fixture case if it shares behaviour with the parser,
   the chunker or the extractor.

`thl tool` picks the new entry up from the manifest with no further work, and
so does the intent parser, because both read the same vocabulary.

### Adding a dependency

Assume the answer is no. If it must happen:

- **Optional.** New dependency means a new extra in `pyproject.toml`, imported
  inside the function that needs it, and named in the `DependencyMissing`
  message.
- **Bounded.** `>=x,<y`. Never a bare `>=`.
- **Mirrored in the alias.** Every extra in `python/pyproject.toml` has a line
  in `alias/pyproject.toml`, or `pip install "thl.lab[that]"` fails with
  "does not provide the extra" and the alias becomes a trap.

---

## 5. Working with an AI agent

Most of this codebase was written with one. It is a fast junior, not a peer.
It produces code that runs and is subtly wrong.

Real examples from this repo:

- A `fetch` with no timeout on the path that mattered.
- A stale header comment claiming the file talked to Ollama, four lines above
  the comment explaining there is deliberately no model.
- A test that asserted a documentation URL was present in CLI output, which
  kept passing long after the URL stopped resolving.
- An escaped-newline bug that made every fenced code block render as literal
  backticks. Reviewed fine.

**Three questions catch most of it.** What happens when the input is empty?
When the parser is not installed? When it gets called twice?

Read every line before committing it. When the agent proposes a new
dependency, a network call, or weakening a test to make something pass — the
answer is no.
