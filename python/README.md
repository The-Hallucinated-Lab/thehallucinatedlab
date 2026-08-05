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
`NexusLinkNotInstalled`

## Licence

MIT.
