"""The ``thl`` command.

Three ways in, all over the same registry::

    thl tools                                   what exists, and what it takes
    thl convert photo.jpg --format webp -q 80   explicit
    thl "convert photo.jpg to webp at 80"       plain english

The natural-language form exists because the parser is already there for
the website's assistant; wiring it to argv was nearly free.
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path

from . import __version__
from .errors import THLError
from .nlp import parse as parse_intent
from .registry import registry
from .tools.convert import convert

# The tool is called "convert" on the website, in the spec, and in the
# Python API, so the subcommand matches it exactly — one name everywhere.
# "converter" stays as a hidden alias: it was the name for one release and
# silently breaking a CLI someone already scripted against is worse than
# carrying one extra word.
_SUBCOMMANDS = ("tools", "convert", "converter", "ask")
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

    if intent["tool"] != "convert":
        print(f"{intent['tool']} has no command-line form yet.", file=sys.stderr)
        return 2

    result = convert(source, **intent["args"])
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
    if command == "ask":
        return _guard(lambda: _run_ask(" ".join(parsed.text)))

    _build_parser().print_help()
    return 0


def _guard(fn) -> int:
    """Turn a library error into a one-line message and an exit code.

    A traceback is the right output for a bug and the wrong output for
    "quality must be between 1 and 100".
    """
    try:
        return fn()
    except THLError as err:
        print(f"thl: {err}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:  # pragma: no cover
        return 130


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
