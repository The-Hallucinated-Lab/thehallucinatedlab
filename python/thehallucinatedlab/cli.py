"""The ``thl`` command.

Three ways in, all over the same registry::

    thl tools                                   what exists, and what it takes
    thl convert photo.jpg --format webp -q 80   explicit
    thl extract report.pdf                      documents to markdown
    thl chunk report.md --max-tokens 512        markdown to jsonl chunks
    thl tokenize report.jsonl                   what it costs to embed
    thl embed chunks.jsonl                      chunks to vectors
    thl index chunks.npy chunks.jsonl mydb      vectors to a database
    thl serve                                   let the website use this install
    thl "convert photo.jpg to webp at 80"       plain english

The natural-language form exists because the parser is already there for
the website's assistant; wiring it to argv was nearly free.
"""

from __future__ import annotations

import argparse
import importlib
import sys
from collections.abc import Sequence
from pathlib import Path

from . import __version__
from .errors import DependencyMissing, THLError
from .nlp import parse as parse_intent
from .registry import registry
from .tools.chunk import chunk
from .tools.convert import convert
from .tools.embed import embed
from .tools.extract import extract
from .tools.index import index
from .tools.tokenize import tokenize

# The tool is called "convert" on the website, in the spec, and in the
# Python API, so the subcommand matches it exactly — one name everywhere.
# "converter" stays as a hidden alias: it was the name for one release and
# silently breaking a CLI someone already scripted against is worse than
# carrying one extra word.
_SUBCOMMANDS = (
    "tools", "convert", "converter", "extract", "chunk", "tokenize",
    "embed", "index", "serve", "ask",
)
_ALIASES = {"converter": "convert"}


def _print_tools() -> int:
    print(f"The Hallucinated Lab toolkit {__version__} (spec {registry.version})\n")
    for name in registry.names():
        tool = registry.describe(name)
        print(f"  {name}  -  {tool.get('summary', '')}")
        for param in tool.get("params", []):
            flag = "required" if param.get("required") else f"default {param.get('default', '-')}"
            # Same wording the website's argument table uses, so the two
            # references read alike.
            if param.get("type") == "enum":
                accepts = " | ".join(param.get("values", []))
            elif param.get("type") == "integer":
                accepts = f"int {param.get('min')}-{param.get('max')}"
            elif param.get("type") == "color":
                accepts = "hex colour"
            elif param.get("type") == "number":
                accepts = f"number {param.get('min')}-{param.get('max')}"
            elif param.get("type") == "boolean":
                accepts = "true | false"
            elif param.get("type") == "path":
                accepts = "file path"
            else:
                accepts = param.get("type", "")
            print(f"      --{param['name']:<12} {accepts:<24} ({flag})")
        page = tool.get("page")
        if page:
            print(f"      docs: https://thehallucinatedlab.space/{page}")
        print()
    return 0


def _run_convert(args: argparse.Namespace) -> int:
    result = convert(
        args.source,
        args.output,
        format=args.format,
        quality=args.quality,
        background=args.background,
    )
    print(result)
    return 0


def _run_extract(args: argparse.Namespace) -> int:
    result = extract(
        args.source,
        args.output,
        format=args.format,
        frontmatter=args.frontmatter,
        page_markers=args.page_markers,
        tables=args.tables,
    )
    print(result)
    # Warnings go to stderr so `thl extract x.pdf > out.md` still works;
    # a note about a missing outline should not land in the document.
    for warning in result.warnings:
        print(f"thl: {warning}", file=sys.stderr)
    return 0


def _run_chunk(args: argparse.Namespace) -> int:
    result = chunk(
        args.source,
        args.output,
        max_tokens=args.max_tokens,
        overlap=args.overlap,
        tokenizer=args.tokenizer,
        heading_context=args.heading_context,
    )
    print(result)
    for warning in result.warnings:
        print(f"thl: {warning}", file=sys.stderr)
    return 0


def _run_tokenize(args: argparse.Namespace) -> int:
    report = tokenize(args.source, tokenizer=args.tokenizer, limit=args.limit)
    print(report)
    if report.over_limit:
        print(
            f"thl: {report.over_limit} piece(s) exceed {report.limit} tokens and would be "
            "truncated at embed time, losing whatever follows.",
            file=sys.stderr,
        )
    return 0


def _run_embed(args: argparse.Namespace) -> int:
    result = embed(
        args.source,
        args.output,
        model=args.model,
        batch_size=args.batch_size,
        normalize=args.normalize,
    )
    print(result)
    for warning in result.warnings:
        print(f"thl: {warning}", file=sys.stderr)
    return 0


def _run_index(args: argparse.Namespace) -> int:
    result = index(
        args.vectors,
        args.chunks,
        args.dest,
        store=args.store,
        collection=args.collection,
        overwrite=args.overwrite,
        model=args.model,
    )
    print(result)
    print(f"  query it with: python {result.path / 'query.py'}")
    for warning in result.warnings:
        print(f"thl: {warning}", file=sys.stderr)
    return 0


def _run_ask(text: str) -> int:
    """Parse a sentence, find the file it mentions, run the tool."""
    intent = parse_intent(text)
    if not intent["tool"]:
        print(f"I could not tell which tool {text!r} means.", file=sys.stderr)
        print("Try `thl tools` to see what exists.", file=sys.stderr)
        return 2

    if intent["missing"]:
        print(f"Missing: {', '.join(intent['missing'])}.", file=sys.stderr)
        return 2

    source = _find_path(text)
    if source is None:
        print("Name a file that exists, for example: thl \"convert photo.jpg to png\"",
              file=sys.stderr)
        return 2

    runners = {
        "convert": convert, "extract": extract, "chunk": chunk, "tokenize": tokenize,
    }
    runner = runners.get(intent["tool"])
    if runner is None:
        print(f"{intent['tool']} has no command-line form yet.", file=sys.stderr)
        return 2

    result = runner(source, **intent["args"])
    print(result)
    return 0


def _find_path(text: str) -> Path | None:
    """The first whitespace-separated token that is a real file.

    Deliberately not clever: guessing at filenames that do not exist
    produces worse errors than asking for one that does.
    """
    for token in text.split():
        candidate = Path(token.strip("\"'"))
        if candidate.is_file():
            return candidate
    return None


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="thl",
        description="The Hallucinated Lab toolkit.",
        epilog='Plain english also works: thl "convert photo.jpg to png"',
    )
    parser.add_argument("--version", action="version", version=f"thl {__version__}")
    subparsers = parser.add_subparsers(dest="command")

    subparsers.add_parser("tools", help="list every tool and its arguments")

    # Named `sub` rather than `convert` so it cannot shadow the imported
    # convert() in this scope.
    sub = subparsers.add_parser(
        "convert", aliases=["converter"], help="convert an image between formats"
    )
    sub.add_argument("source", help="path to the image")
    sub.add_argument("-o", "--output", default=None, help="where to write (default: alongside)")
    sub.add_argument("-f", "--format", required=True, help="png, jpeg, webp or avif")
    sub.add_argument("-q", "--quality", type=int, default=None, help="1-100, lossy formats")
    sub.add_argument("--background", default=None, help="hex fill for transparency, e.g. #ffffff")

    # --no-x for every boolean: argparse has no native way to say "this
    # flag defaults to on", and BooleanOptionalAction is 3.9+ but prints
    # awkwardly. Explicit pairs read better in --help.
    ext = subparsers.add_parser("extract", help="turn a document into markdown")
    ext.add_argument("source", help="path to the document")
    ext.add_argument("-o", "--output", default=None, help="where to write (default: alongside)")
    ext.add_argument("-f", "--format", default=None, help="markdown or text")
    ext.add_argument("--no-frontmatter", dest="frontmatter", action="store_false", default=None,
                     help="omit the YAML metadata block")
    ext.add_argument("--no-page-markers", dest="page_markers", action="store_false", default=None,
                     help="omit page boundary comments")
    ext.add_argument("--no-tables", dest="tables", action="store_false", default=None,
                     help="flatten tables instead of rendering them")

    chk = subparsers.add_parser("chunk", help="split markdown into jsonl chunks")
    chk.add_argument("source", help="path to the markdown document")
    chk.add_argument("-o", "--output", default=None, help="where to write (default: alongside)")
    chk.add_argument("--max-tokens", type=int, default=None, help="largest chunk, default 512")
    chk.add_argument("--overlap", type=int, default=None, help="repeated tokens, default 64")
    chk.add_argument("-t", "--tokenizer", default=None, help="bge, openai or estimate")
    chk.add_argument("--no-heading-context", dest="heading_context", action="store_false",
                     default=None, help="do not prepend the heading path to each chunk")

    tok = subparsers.add_parser("tokenize", help="count tokens and report the distribution")
    tok.add_argument("source", help="a document, or a .jsonl of chunks")
    tok.add_argument("-t", "--tokenizer", default=None, help="bge, openai or estimate")
    tok.add_argument("--limit", type=int, default=None, help="context window, default 8192")

    emb = subparsers.add_parser("embed", help="turn chunks into vectors")
    emb.add_argument("source", help="the .jsonl of chunks")
    emb.add_argument("-o", "--output", default=None, help="where to write the .npy")
    emb.add_argument("-m", "--model", default=None, help="bge or minilm")
    emb.add_argument("--batch-size", type=int, default=None, help="default 16")
    emb.add_argument("--no-normalize", dest="normalize", action="store_false", default=None,
                     help="keep raw magnitudes instead of unit vectors")

    idx = subparsers.add_parser("index", help="build a portable vector database")
    idx.add_argument("vectors", help="the .npy that embed produced")
    idx.add_argument("chunks", help="the .jsonl those vectors came from")
    idx.add_argument("dest", nargs="?", default=None, help="directory to build")
    idx.add_argument("-s", "--store", default=None, help="chroma or numpy")
    idx.add_argument("-c", "--collection", default=None, help="name inside the store")
    idx.add_argument("-m", "--model", default=None, help="which model made the vectors")
    idx.add_argument("--overwrite", action="store_true", default=None,
                     help="replace an existing index")

    srv = subparsers.add_parser("serve", help="let the website use this install")
    srv.add_argument("-p", "--port", type=int, default=None, help="default 8787")
    srv.add_argument("--allow-origin", action="append", default=[],
                     help="an extra origin to answer, repeatable")
    srv.add_argument("--verbose", action="store_true", help="log every request")

    ask = subparsers.add_parser("ask", help="describe what you want in plain english")
    ask.add_argument("text", nargs="+", help='e.g. "convert photo.jpg to png"')

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args: list[str] = list(sys.argv[1:] if argv is None else argv)

    if not args:
        _build_parser().print_help()
        return 0

    # `thl "convert photo.jpg to png"` with no subcommand at all.
    if args[0] not in _SUBCOMMANDS and not args[0].startswith("-"):
        return _guard(lambda: _run_ask(" ".join(args)))

    parsed = _build_parser().parse_args(args)

    # argparse reports whichever spelling was typed, so fold aliases onto the
    # canonical name before dispatching rather than testing both everywhere.
    command = _ALIASES.get(parsed.command, parsed.command)

    if command == "tools":
        return _guard(_print_tools)
    if command == "convert":
        return _guard(lambda: _run_convert(parsed))
    if command == "extract":
        return _guard(lambda: _run_extract(parsed))
    if command == "chunk":
        return _guard(lambda: _run_chunk(parsed))
    if command == "tokenize":
        return _guard(lambda: _run_tokenize(parsed))
    if command == "embed":
        return _guard(lambda: _run_embed(parsed))
    if command == "index":
        return _guard(lambda: _run_index(parsed))
    if command == "serve":
        from .serve import DEFAULT_PORT, serve
        return _guard(lambda: serve(
            parsed.port or DEFAULT_PORT,
            tuple(parsed.allow_origin),
            quiet=not parsed.verbose,
        ))
    if command == "ask":
        return _guard(lambda: _run_ask(" ".join(parsed.text)))

    _build_parser().print_help()
    return 0


def _guard(fn) -> int:
    """Turn a library error into a one-line message and an exit code.

    A traceback is the right output for a bug and the wrong output for
    "quality must be between 1 and 100".

    A missing extra is the one error worth trying to fix rather than
    report. It is the predictable consequence of keeping the base install
    small, the fix is a single known command, and the person who hit it
    is sitting right there. So it is offered first and only reported if
    the offer is declined or impossible -- see autoinstall, which asks
    nothing when there is no tty to ask.
    """
    try:
        return fn()
    except DependencyMissing as err:
        print(f"thl: {err}", file=sys.stderr)
        from .autoinstall import offer

        if not offer(err):
            return 1
        # A package installed after this process started is invisible to
        # the import system until the path finders drop their cached
        # directory listings.
        importlib.invalidate_caches()
        try:
            return fn()
        except THLError as retry_err:
            print(f"thl: {retry_err}", file=sys.stderr)
            return 1
    except THLError as err:
        print(f"thl: {err}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:  # pragma: no cover
        return 130


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
