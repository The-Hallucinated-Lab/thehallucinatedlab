# thehallucinatedlab

The [Hallucinated Lab](https://thehallucinatedlab.space) toolkit — local-first tools you can
call as ordinary Python methods.

Every tool runs on your machine. There is no API key, no account, no service to be up, and
nothing is uploaded anywhere.

```bash
pip install thehallucinatedlab
```

## Use it

```python
from thehallucinatedlab import convert

result = convert("photo.jpg", format="png")
print(result.path, result.bytes)
```

Forgot what a tool takes? The argument reference lives on the website, generated from the
same spec this package validates against — so the docs cannot describe an argument the code
does not accept:

**<https://thehallucinatedlab.space/convert.html>**

## Plain english works too

The same intent parser that powers the website's assistant ships in the package:

```python
from thehallucinatedlab import parse

parse("convert it to webp at 80")
# {'tool': 'convert', 'args': {'format': 'webp', 'quality': 80}, 'missing': [], ...}
```

And from a shell:

```bash
thl tools                                    # every tool and its arguments
thl convert photo.jpg --format webp -q 80
thl "convert photo.jpg to webp at 80"
```

## Tools

### `convert`

Convert an image between PNG, JPEG, WebP and AVIF.

| Argument | Accepts | Default | What it does |
|---|---|---|---|
| `format` | `png` \| `jpeg` \| `webp` \| `avif` | **required** | Target format. Aliases like `jpg` are accepted. |
| `quality` | int 1–100 | `92` | Encoder quality. Ignored for PNG, which is lossless. |
| `background` | hex colour | `#ffffff` | Fills transparency when the target has no alpha channel (JPEG). |

```python
convert("logo.png", format="jpeg", quality=85, background="#000000")
convert(raw_bytes, "out.webp", format="webp")   # bytes and file objects work too
```

Converting a transparent PNG to JPEG flattens it onto `background` rather than leaving black
where the transparency was. AVIF needs Pillow 11.3+ or `pillow-avif-plugin`; if your install
cannot encode a format, you get an `UnsupportedFormat` error rather than a file whose
extension lies about its contents.

### `eda` — exploratory data analysis

Profile a data file and get back a report, the figures, a replayable recipe, and the Python
script that produced all of it.

```bash
pip install "thehallucinatedlab[eda]"
thl eda sales.csv
```

```
sales.eda/
├── report.md        the profile, in Markdown so it diffs in a pull request
├── recipe.json      every decision, replayable
├── analysis.py      regenerates everything above — and is meant to be edited
├── summary.json     the same numbers, machine-readable
└── figures/
```

```python
from thehallucinatedlab import eda

result = eda("sales.csv", target="churn", tier2=True)
result.report      # sales.eda/report.md
result.script      # sales.eda/analysis.py
result.warnings    # sampling, low-confidence types, failed columns
```

Three things worth knowing before relying on it:

- **Every column gets an inferred type *and* a confidence.** Anything below 0.7 is flagged in
  the report's caveats and in `result.warnings` rather than asserted, and every verdict is
  overridable. The failures you actually notice in a profiler are misclassifications — a zip
  code read as a quantity, a 0/1/2 encoding given a mean, dates in three formats coerced.
- **The emitted `analysis.py` reproduces the report**: the same figures and a byte-identical
  `summary.json`. It imports nothing from this package, so you can edit it without reading
  anyone else's library. A test executes it and diffs the output.
- **Sampling is never silent.** Under 200 MB everything is exact. Above it the file is
  streamed — counts, nulls, min/max and cardinality stay exact and only the figures use a
  seeded sample — stated in the report banner, on every affected figure, and in the recipe.

The five primitives underneath are ordinary functions, usable without going near a report:

```python
from thehallucinatedlab import describe_dataset, relate_columns

describe_dataset("sales.csv").types()["zip"]        # 'numeric_discrete'
relate_columns("sales.csv", kind="target", target="churn")
```

`thl eda sales.csv -i` opens a nine-screen session, and every screen prints the flag that
would have produced the same choice. Full reference:
**<https://thehallucinatedlab.space/eda.html>**

Optional extras within the extra: `[eda-excel]` for `.xlsx`, `[eda-parquet]` for `.parquet`.

## Companion projects

[NexusLink Engine](https://github.com/06pratyush/NexusLinkEngine) is reachable through the
same namespace once its binding is installed:

```python
from thehallucinatedlab import nexuslink

if nexuslink.is_available():
    ...
```

It is built and released separately and is not yet on PyPI, so the import raises
`NexusLinkNotInstalled` with a pointer to the repository until it ships.

## Errors

Everything deliberate inherits from `THLError`:

`ToolNotFound` · `InvalidArgument` · `MissingArgument` · `UnsupportedFormat` ·
`NexusLinkNotInstalled` · `DependencyMissing`

From the EDA tools: `UnreadableSource` · `EmptyDataset` · `ColumnNotFound` ·
`UnsupportedColumnType` · `InvalidRecipe` · `OutputNotWritable` · `SamplingRequired`

## Licence

MIT.
