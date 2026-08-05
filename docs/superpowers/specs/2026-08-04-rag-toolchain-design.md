# RAG toolchain — design

**Date:** 2026-08-04
**Status:** approved, in implementation
**Scope:** five tools — `extract`, `chunk`, `tokenize`, `embed`, `index` — plus the shared
foundations they force into the manifest, the registry and the browser runtime.

---

## 1. What this is

A document-ingestion pipeline that turns arbitrary documents into a vector database the user
owns and can query with their own code. Five tools, each usable on its own:

```
extract ──> chunk ──> embed ──> index          the data path
              │
              └── calls ──> tokenize            library function AND standalone tool
```

`retrieve` is deliberately **not** built. Every vector database ships nearest-neighbour
search (`collection.query`, `index.search`, `as_retriever`), so the retrieval half is free.
The consequence is that the BGE reranker is out of scope entirely — a cross-encoder scores
`(query, passage)` pairs and there is no query at index time, so it has no home in an
ingest-only pipeline.

### Three conceptual corrections this design encodes

1. **`tokenize` is not a data-path stage.** Embedding models tokenize internally with their
   own vocabulary. BGE-M3 is XLM-RoBERTa — SentencePiece, ~250k vocab. A tiktoken BPE id
   stream is a different id space; feeding it to BGE-M3 produces garbage. So `tokenize`
   answers *"how many tokens, what distribution, what overflows 8192"* and `chunk` imports
   the same code to size its cuts.

2. **Structure-aware chunking needs surviving structure.** `extract` emits Markdown, not
   flat text. Flattening to `.txt` first destroys the headings that
   `MarkdownHeaderTextSplitter` exists to split on.

3. **One chunk per file loses what matters.** A LangChain `Document` is
   `page_content + metadata`, and metadata is what makes citation possible. Chunks ship as
   JSONL, one record per line — inspectable, greppable, streamable.

---

## 2. Architecture

### Runtime split

The five tools are not equally heavy, and `spec/manifest.json` already has a per-tool
`runtimes` field to say so.

| Tool | Runtimes | Browser dependency |
|---|---|---|
| `extract` | browser, python | **none** — see below |
| `chunk` | browser, python | none — pure logic |
| `tokenize` | browser, python | HF tokenizers WASM + `tokenizer.json` ~17MB |
| `embed` | python | — (BGE-M3 is 568M params, ~570MB int8) |
| `index` | python | — |

**Decided: nothing is vendored.** pdf.js (~1MB) and mammoth (~150KB) were considered and rejected. CI states the position plainly — *"No package.json, no lockfile, no npm install. Keeping the repo dependency-free means there is no supply chain to audit"* — and ~1.2MB of third-party JS is an order of magnitude beyond the GSAP precedent.

So the browser tier is what needs no parser at all: `.txt`, `.md`, `.markdown`, `.html`, `.htm`, `.csv`, via `FileReader`, `DOMParser` and a hand-written RFC4180 CSV reader. Everything heavier goes to the bridge. This makes the bridge earn its place at stage one rather than sitting unused until `embed`.

### The bridge

`thl serve` runs a loopback HTTP server so a browser page can hand work to the local Python
package when it is installed. It is **an upgrade path, never load-bearing**: every browser
tool works fully with the bridge absent, and the page degrades to "install the package" for
capability it cannot provide itself.

This is a deliberate contrast with the Ollama integration removed in `8067c93`, which met a
first-time visitor with install instructions before the page did anything.

**Contract**

```
GET  /thl/v1/capabilities  -> { version, tools: [...], formats: [...] }
POST /thl/v1/run/<tool>    -> multipart upload, JSON result
```

- Binds `127.0.0.1` only. Never `0.0.0.0`.
- CORS origin allowlist, defaulting to `https://thehallucinatedlab.space` plus
  `http://localhost:*` for local development.
- Answers preflight with `Access-Control-Allow-Private-Network: true`, required by
  Chromium's Private Network Access checks for public → loopback requests.
- Default port 8787. The browser probes once, with a short timeout, and caches the result
  for the session.

The origin allowlist is the security boundary: it is what stops an unrelated site the user
happens to be visiting from driving their local file system. Loopback binding alone does
not provide that.

**Known limitation.** Safari has been unreliable about `https://` pages reaching
`http://127.0.0.1`. The bridge is best-effort by design, so Safari users get the
browser-only path. This is acceptable precisely because the bridge is not load-bearing.

### Dependency strategy

The package's entire dependency list today is `pillow>=10.0`. LangChain plus torch plus
sentence-transformers would take a `pip install thehallucinatedlab` from ~3MB to multiple
gigabytes.

Every heavy dependency goes behind an optional extra with a lazy import, extending the
existing `nexuslink.py` lazy-door pattern and its `NexusLinkNotInstalled` error:

```
pip install thehallucinatedlab                # convert only, unchanged
pip install thehallucinatedlab[extract]       # + langchain loaders, pypdf, docx2txt
pip install thehallucinatedlab[chunk]         # + langchain-text-splitters, tokenizers
pip install thehallucinatedlab[embed]         # + sentence-transformers, torch
pip install thehallucinatedlab[index]         # + chromadb
pip install thehallucinatedlab[rag]           # all of the above
```

Importing `thehallucinatedlab` must never import torch. Tools raise a typed
`DependencyMissing` naming the exact extra to install.

---

## 3. Foundations

### Manifest param types

Both runtimes today handle exactly `enum`, `integer`, `color` (`toolkit.js:105-126`,
`registry.py:134-160`). These tools need more. Adding a type means touching `registry.py`,
`toolkit.js` and `test/manifest.test.js` together.

| Type | Validation | Notes |
|---|---|---|
| `string` | optional `pattern`, `maxLength` | |
| `boolean` | true/false, plus `"true"`/`"false"`/`1`/`0` from the CLI | |
| `number` | float, optional `min`/`max` | distinct from `integer` |
| `path` | non-empty string | python-only semantics; the browser supplies `File` objects |

Unknown types currently fall through `registry.py`'s validate loop into an unvalidated
passthrough. That silent acceptance is why the type set must be extended deliberately
rather than relied on.

### Manifest input kinds

`input.kind` is `"image"` today. Adding `document`, `text`, `jsonl`, `folder`.

### Staging

All five tools ship `status: "dev"` and are invisible to visitors behind the founder-gated
switch (`script.js:188-230`) until each is finished. Work merges to `main` continuously;
no long-lived branches.

---

## 4. The tools

### `extract`

Documents → Markdown with preserved structure.

**Coverage tiers.** Browser: TXT, MD, HTML, CSV -- no parser needed. Python adds PDF, DOCX,
PPTX, XLSX, EPUB, RTF, ODT, EML. The page offers the Python tier through the bridge when
present.

`thl serve` reports ``readable_extensions()``, not ``extensions()`` -- only formats whose
parser is actually importable. A bridge running without the ``extract`` extra must not
advertise ``.pdf``: the visitor has already chosen the file by the time it would fail.

**Output** — one self-describing file:

```markdown
---
source: report.pdf
pages: 42
extracted: 2026-08-04T10:22:31Z
extractor: pdfjs-4.x
---

# Chapter 3
<!-- page: 12 -->
Body text...
```

YAML frontmatter carries document-level metadata; HTML comments mark page boundaries.
Markdown renderers ignore both and `chunk` parses both.

**Out of scope:** OCR for scanned PDFs, multi-file batch, table-structure extraction beyond
what loaders give natively.

### `chunk`

Markdown → JSONL of `Document` records. Splits on heading structure via
`MarkdownHeaderTextSplitter`, then applies a recursive character split within each section
so no chunk exceeds the token budget. Calls `tokenize` to measure.

Each record carries `text` plus `source`, `heading_path`, `page`, `chunk_index`,
`token_count`.

Params: `max_tokens` (default 512), `overlap` (default 64), `tokenizer` (default `bge-m3`).

### `tokenize`

Text or JSONL → token statistics. Total tokens, per-chunk distribution, count over the
8192 ceiling, and an estimated embedding cost.

Defaults to BGE-M3's own tokenizer, which downloads ~17MB — the tokenizer alone, not the
2.3GB model. Also offers tiktoken encodings (`cl100k_base`, `o200k_base`) for estimating
against OpenAI models.

### `embed`

JSONL → vectors. BGE-M3 dense only, 1024 dimensions, L2-normalized so cosine equals dot
product. No instruction prefix — BGE-M3, unlike `bge-large-en`, does not want one.

Output is a single `.npy` plus an id column, not one file per chunk.

### `index`

Vectors + chunks → a portable database directory.

**Chroma is the default.** FAISS through LangChain pickles its docstore and now requires
`allow_dangerous_deserialization=True` to load — an unacceptable default for a tool whose
entire purpose is handing someone a database to open later. Chroma is sqlite-backed with no
pickle in the load path. LanceDB is offered as an alternative.

**The database must be self-describing.** It records embedding model, dimension,
normalization and pooling, and ships a copy-pasteable query snippet. Without this the user
receives a folder they cannot actually open: Chroma's default embedder is
`all-MiniLM-L6-v2` at 384 dimensions, so a naive `query_texts=[...]` against 1024-dim
BGE-M3 vectors either raises a dimension error or silently returns nonsense.

---

## 5. Error handling

Follows the existing model in `registry.py`: collect every problem before raising, so
fixing a call does not mean discovering mistakes one run at a time.

| Failure | Behaviour |
|---|---|
| Missing optional dependency | `DependencyMissing`, naming the exact extra |
| Unsupported format | Named before reading the file, not after |
| Bridge absent | Browser silently uses its own tier; no error surfaced |
| Bridge present but tool unavailable | Page states which extra to install |
| Corrupt/encrypted PDF | `InvalidArgument` with the underlying reason |
| Chunk exceeds model context | Warned at chunk time, not discovered at embed time |
| Model/dimension mismatch at index | Hard failure — never silently write a mixed index |

## 6. Testing

- **Node** — `node --test`, no package.json. Manifest sync, new param-type validation in
  `toolkit.js`, pure-logic chunking against fixtures.
- **pytest** — matrix on 3.10 and 3.13. Heavy-dependency tests guard with
  `pytest.importorskip` so CI stays fast and the suite passes without torch installed.
- **Shared fixtures** — chunking cases live in `spec/` and are run by both suites, matching
  the existing `spec/nlp-fixtures.json` pattern.
- **Site invariants** — new pages must satisfy CSP, asset resolution, image sizing, and the
  40KB per-page script budget.

## 7. Build order

1. Foundations + `extract` — param types, input kinds, pip extras, and `thl serve` **built**,
   not merely specified: with nothing vendored, the bridge is what makes PDF and Word reachable
   from the page at all  ✅ **done**
2. `chunk` + `tokenize` — paired; they share an interface  ✅ **done**
3. `embed` + `index` — paired; `index` consumes `embed` directly

## 8. Decisions taken during implementation

**`index` ships as `vector-index.html`.** The tool is named `index`, but `index.html` is the
site homepage — and `manifest.test.js` asserts every tool's `page` exists on disk, which would
have invited overwriting 27KB of homepage.

**`embed` offers two models, not one.** `bge` (1024 dims) and `minilm` (384 dims). A
single-value enum would be pointless, and more importantly the width difference makes the
sidecar's purpose concrete: an index built with one genuinely cannot be queried with the other.

**`index` offers `numpy` alongside `chroma`.** The numpy store writes a `.npy` plus a JSONL and
no database at all. It needs nothing beyond numpy, which means the whole index path — including
the metadata recording that stops a directory being unopenable — is exercisable in CI with no
vector database installed. FAISS stays out: LangChain's wrapper pickles its docstore and
requires `allow_dangerous_deserialization=True` to load, which is the wrong thing to hand
someone whose entire purpose is opening the folder later.

**`_build_encoder` is a deliberate seam.** Tests monkeypatch it with a deterministic fake, so
argument handling, normalisation, id assignment and the dimension guard all run without
downloading 2.3GB of weights.

**Browser chunking counts by estimate.** BGE-M3's tokenizer is a ~17MB download against a 40KB
per-page script budget, so the browser uses a heuristic and records `tokenizer: "estimate"` on
every record. The heuristic is biased high: an under-count produces a chunk that exceeds the
model's context, and an oversized chunk is not rejected at embed time — it is silently
truncated and its tail never reaches the vector.
