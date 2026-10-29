# The Hallucinated Lab

### *Your Machine. Your Power. No Limits.*

A local-first toolkit you call as ordinary Python methods, and from a shell as `thl`.
Every tool runs on your machine. There is no API key, no account, no service to be up,
and nothing is uploaded anywhere.

```bash
pip install thehallucinatedlab
thl tool
```

Requires **Python 3.10 or newer**.

## What is here

This repository ships one thing: the `thl` command and the `thehallucinatedlab` library
under [`python/`](python/). There is no website, no build step, and no bundler in the loop.

| | |
|---|---|
| **Package** | [`thehallucinatedlab`](https://pypi.org/project/thehallucinatedlab/) — the toolkit |
| **Alias** | [`thl.lab`](https://pypi.org/project/thl.lab/) — the same install under a shorter name |
| **Command** | `thl` |
| **Contract** | [`spec/manifest.json`](spec/manifest.json) — every tool, its arguments, bounds and defaults |

## Use it

```python
from thehallucinatedlab import convert

result = convert("photo.jpg", format="png")
print(result.path, result.bytes)
```

From a shell:

```bash
thl tool                                    # every tool and its arguments
thl tool convert photo.jpg --format webp -q 80
thl tool extract report.pdf                 # documents to markdown
thl tool chunk report.md --max-tokens 512   # markdown to jsonl chunks
thl tool tokenize report.jsonl              # what it costs to embed
thl tool embed chunks.jsonl                 # chunks to vectors
thl tool index chunks.npy chunks.jsonl mydb # vectors to a database
```

Plain English works too, because the intent parser ships in the package:

```bash
thl "convert photo.jpg to webp at 80"
thl assistant "extract report.pdf"
```

## Pipelines

A tool does one thing. A pipeline chains tools, and each stage writes its artefact so you
can inspect the middle or resume from it.

```bash
thl pipeline rag report.pdf     # extract -> chunk -> embed -> index
thl pipeline eda sales.csv      # a table to a profile report
```

`thl pipeline eda sales.csv` produces `sales.eda/` containing `report.md`, `recipe.json`,
`analysis.py` (which regenerates everything above, and is meant to be edited), `summary.json`
and `figures/`.

## The tools

| Tool | What it does |
|---|---|
| `convert` | Convert an image between PNG, JPEG, WebP and AVIF |
| `extract` | Turn PDF, Word, slides, spreadsheets, e-books and HTML into markdown |
| `chunk` | Split markdown into jsonl chunks with heading context |
| `tokenize` | Count tokens and report the distribution against a context window |
| `embed` | Turn chunks into vectors |
| `index` | Build a portable vector database, with a `query.py` beside it |
| `eda` | Profile a table: types with confidence, figures, a replayable recipe |

The base install depends on Pillow and nothing else. Everything heavier is an optional
extra — `[extract]`, `[chunk]`, `[embed]`, `[index]`, `[rag]`, `[eda]`, `[eda-excel]`,
`[eda-parquet]` — imported inside the function that needs it, so `pip install
thehallucinatedlab` stays a few megabytes. Ask for a tool whose extra is missing and you get
one line naming the exact install command, not a traceback.

## Repository layout

```
spec/manifest.json              the contract — the only place bounds are written down
scripts/sync_spec.py            copies it into the wheel, and --check verifies the copy
python/thehallucinatedlab/      the package: cli, registry, nlp, tools/, pipelines/
python/tests/                   pytest, including the shared fixture contracts
alias/                          thl.lab — metadata and one pinned dependency, no code
docs/                           design notes
.orchestrator/                  local development harness (see CLAUDE.md)
.github/workflows/              CI, release to PyPI, CONTEXT.md sync gate
```

## Working on it

```bash
python -m pip install -e "python[dev,eda,eda-excel]"

pytest python/ -q                 # the suite
ruff check python/                # lint
python scripts/sync_spec.py --check   # spec and wheel copy agree
```

The EDA suite draws several hundred figures and takes a while; CI allows it twenty minutes.

### The manifest is the contract

`spec/manifest.json` defines every tool, its arguments, their types, bounds and defaults.
The CLI, the intent parser and the library all read it, and the package carries a copy at
`python/thehallucinatedlab/data/manifest.json` because a wheel cannot reach outside its own
root. Edit the spec, then run:

```bash
python scripts/sync_spec.py
```

A test asserts the two copies are identical, so skipping that step turns the build red rather
than shipping a package whose `thl tool` output disagrees with what it accepts. **If you
change one thing, change it in the manifest.**

### Releasing

See [RELEASING.md](RELEASING.md). Pushing a `v*` tag builds both packages, verifies the tag
against `pyproject.toml`, and publishes over PyPI Trusted Publishing — there is no token in
this repository.

## The standards

[STANDARDS.md](STANDARDS.md) holds the invariants a change has to satisfy.
[ARCHITECTURE.md](ARCHITECTURE.md) explains the decisions behind them.
[CONTEXT.md](CONTEXT.md) is the project's memory and its change log.

## The team

Built by [@06pratyush](https://github.com/06pratyush), [@shashwat-deep](https://github.com/shashwat-deep)
and [@TheQMLGuy](https://github.com/TheQMLGuy).

## Contact

**thehallucinatedlab@gmail.com** — or open an issue.

## License

MIT. See [LICENSE](LICENSE).
