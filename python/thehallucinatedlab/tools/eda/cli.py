"""``thl eda`` on the command line.

Two entry points, one implementation:

* :func:`main` backs the standalone ``thl-eda`` command in this checkout.
* :func:`add_subparser` and :func:`run_parsed` are what the parent
  package's ``thl`` calls, so wiring EDA into the existing CLI is three
  lines there and no duplication here.

Exit codes follow the house convention plus one addition the PRD asks
for::

    0   clean
    1   the run could not start -- bad argument, unreadable source
    2   partial success -- the report was written, something in it failed
    130 cancelled

Exit code 2 is the interesting one. A folder with a corrupt file in it
produces twenty-nine good reports and one recorded failure, and calling
that either "fine" or "failed" would be a lie in one direction or the
other.
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from . import __version__
from .errors import DependencyMissing, THLError

EXIT_OK = 0
EXIT_ERROR = 1
EXIT_PARTIAL = 2
EXIT_CANCELLED = 130

DESCRIPTION = "Profile a data file, or a folder of them, without writing any code."

_EXAMPLES = """examples:
  {cmd} sales.csv                                  defaults, no questions
  {cmd} sales.csv -i                               the full session
  {cmd} data/ --pattern "*.csv" --out reports/
  {cmd} sales.csv --charts numeric_continuous:histogram,kde --tier2 corr,missing
  {cmd} sales.csv --target churn --tier2 all --format html --self-contained
  {cmd} sales.csv -i --save-recipe team.json       design once
  {cmd} new_month.csv --recipe team.json           replay forever
"""


def epilog(command: str) -> str:
    """The examples, spelled the way this install is actually invoked.

    Standalone it is ``thl-eda``; inside the parent package it is ``thl
    eda``. Printing the other one is a small lie that costs somebody a
    minute of typing a command that does not exist.
    """
    return _EXAMPLES.format(cmd=command)


# --------------------------------------------------------------------------
# Parsing
# --------------------------------------------------------------------------


def add_arguments(parser: argparse.ArgumentParser) -> argparse.ArgumentParser:
    """Every flag in PRD section 6. Each session screen has one here."""
    parser.add_argument(
        "source", nargs="?", default=None,
        help="a data file or a directory of them; omitted, the session opens on the picker",
    )

    mode = parser.add_argument_group("mode")
    mode.add_argument("-i", "--interactive", action="store_true",
                      help="open the multi-select session (needs a terminal)")
    mode.add_argument("--recipe", default=None, metavar="PATH",
                      help="replay a saved recipe; with -i, opens the session pre-filled")
    mode.add_argument("--save-recipe", default=None, metavar="PATH",
                      help="write the recipe and stop without running")
    mode.add_argument("--dry-run", action="store_true",
                      help="print the execution plan and exit")
    mode.add_argument("--yes", action="store_true",
                      help="skip confirmations, including the one for very large files")
    mode.add_argument("--list", action="store_true", dest="list_registry",
                      help="print every chart and summary, per column type, and exit")

    load = parser.add_argument_group("loading")
    load.add_argument("--delimiter", default=None, help="field separator; sniffed if omitted")
    load.add_argument("--encoding", default=None, help="text encoding; sniffed if omitted")
    load.add_argument("--header", type=int, default=0, metavar="N",
                      help="header row index, or -1 for no header")
    load.add_argument("--na-values", default=None, metavar="LIST",
                      help="extra tokens to read as null, comma separated")
    load.add_argument("--sheet", default=None, metavar="NAME",
                      help="worksheet name, or 'all' to treat each sheet as its own dataset")
    load.add_argument("--nrows", type=int, default=None, metavar="N",
                      help="read only the first N rows")
    load.add_argument("--sample", type=int, default=None, metavar="N",
                      help="draw figures from a random sample of N rows")
    load.add_argument("--seed", type=int, default=42, help="sampling seed (default 42)")

    select = parser.add_argument_group("selection")
    select.add_argument("--columns", default=None, metavar="a,b,c",
                        help="restrict to these columns")
    select.add_argument("--exclude", default=None, metavar="a,b", help="drop these columns")
    select.add_argument("--types", default=None, metavar="col=type,...",
                        help="override inferred types")
    select.add_argument("--charts", default=None, metavar="type:chart,chart;...",
                        help="per-type chart selection, e.g. numeric_continuous:histogram,box")
    select.add_argument("--summaries", default=None, metavar="type:name,...",
                        help="per-type summary selection")
    select.add_argument("--all-charts", action="store_true",
                        help="every chart the registry offers for each type")
    select.add_argument("--no-charts", action="store_true", help="statistics only, no figures")
    select.add_argument("--tier2", default=None, metavar="KIND,...",
                        help="corr, missing, duplicates, target, or all")
    select.add_argument("--target", default=None, metavar="COL",
                        help="enables target-versus-feature views and the feature ranking")
    select.add_argument("--top-n", type=int, default=15, metavar="N",
                        help="cut-off for high-cardinality listings (default 15)")
    select.add_argument("--outlier-rule", choices=("iqr", "zscore"), default="iqr",
                        help="how outliers are counted (default iqr)")

    output = parser.add_argument_group("output")
    output.add_argument("-o", "--out", default=None, metavar="PATH",
                        help="output directory (default <input>.eda/ beside the source)")
    output.add_argument("--format", choices=("md", "html"), default="md",
                        help="report format (default md, which diffs)")
    output.add_argument("--self-contained", action="store_true",
                        help="inline figures as base64; HTML only")
    output.add_argument("--figure-format", choices=("png", "svg"), default="png")
    output.add_argument("--dpi", type=int, default=110)
    output.add_argument("--no-script", action="store_true",
                        help="do not emit analysis.py")
    output.add_argument("--overwrite", action="store_true",
                        help="write into a directory this tool did not create")

    folder = parser.add_argument_group("folder mode")
    folder.add_argument("--max-files", type=int, default=25, metavar="N")
    folder.add_argument("--pattern", default=None, metavar="GLOB",
                        help='which files to pick up, e.g. "*.csv"')
    folder.add_argument("--recursive", action="store_true")
    folder.add_argument("--stop-on-error", action="store_true",
                        help="abort the folder run on the first failure (default: continue)")

    parser.add_argument("-q", "--quiet", action="store_true", help="print only the report path")
    return parser


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="thl-eda",
        description=DESCRIPTION,
        epilog=epilog("thl-eda"),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--version", action="version", version=f"thl eda {__version__}")
    return add_arguments(parser)


def add_subparser(subparsers: Any) -> argparse.ArgumentParser:
    """Register ``eda`` on the parent package's ``thl`` command."""
    parser = subparsers.add_parser(
        "eda",
        help="profile a data file and write a report",
        description=DESCRIPTION,
        epilog=epilog("thl eda"),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    return add_arguments(parser)


# --------------------------------------------------------------------------
# Flag parsing helpers
# --------------------------------------------------------------------------


def split_list(value: str | None) -> list[str]:
    if not value:
        return []
    return [part.strip() for part in value.split(",") if part.strip()]


def parse_mapping(value: str | None, what: str) -> dict[str, str]:
    """``col=type,col=type`` into a dict, naming the offender on failure."""
    out: dict[str, str] = {}
    for part in split_list(value):
        if "=" not in part:
            raise THLError(f"--{what} takes col=value pairs; {part!r} has no '='.")
        key, _, item = part.partition("=")
        out[key.strip()] = item.strip()
    return out


def parse_per_type(value: str | None, what: str) -> dict[str, list[str]]:
    """``type:a,b;type:c`` into a dict of lists.

    Semicolons separate types and commas separate names, which reads
    badly for about one second and then never again -- and it means the
    whole selection is one shell word.
    """
    out: dict[str, list[str]] = {}
    if not value:
        return out
    for group in value.split(";"):
        group = group.strip()
        if not group:
            continue
        if ":" not in group:
            raise THLError(
                f"--{what} takes type:name,name groups; {group!r} has no ':'. "
                "Example: numeric_continuous:histogram,box"
            )
        kind, _, names = group.partition(":")
        out[kind.strip()] = split_list(names)
    return out


def options_from(args: argparse.Namespace) -> Any:
    """Turn the parsed namespace into the object the runner takes."""
    from .loading import LoadOptions  # noqa: PLC0415 - deferred with the rest of the extra
    from .runner import RunOptions  # noqa: PLC0415

    return RunOptions(
        out=Path(args.out) if args.out else None,
        load=LoadOptions(
            delimiter=args.delimiter,
            encoding=args.encoding,
            header=None if args.header is not None and args.header < 0 else args.header,
            na_values=split_list(args.na_values),
            sheet=args.sheet,
            nrows=args.nrows,
            sample=args.sample,
            seed=args.seed,
        ),
        types=parse_mapping(args.types, "types"),
        columns=split_list(args.columns) or None,
        exclude=split_list(args.exclude),
        charts=parse_per_type(args.charts, "charts"),
        summaries=parse_per_type(args.summaries, "summaries"),
        all_charts=args.all_charts,
        no_charts=args.no_charts,
        tier2=split_list(args.tier2),
        target=args.target,
        options={"top_n": args.top_n, "outlier_rule": args.outlier_rule},
        format=args.format,
        figure_format=args.figure_format,
        self_contained=args.self_contained,
        dpi=args.dpi,
        emit_script=not args.no_script,
        overwrite=args.overwrite,
        max_files=args.max_files,
        pattern=args.pattern,
        recursive=args.recursive,
        continue_on_error=not args.stop_on_error,
        allow_sampling=True,
        quiet=args.quiet,
    )


# --------------------------------------------------------------------------
# Running
# --------------------------------------------------------------------------


def run_parsed(args: argparse.Namespace) -> int:
    """Everything after argument parsing. Shared by both entry points."""
    if args.list_registry:
        return print_registry()

    from . import deps  # noqa: PLC0415 - the import itself must not need the extra

    deps.require()

    from . import loading, runner  # noqa: PLC0415
    from . import session as session_mod
    from .recipe import Recipe  # noqa: PLC0415

    options = options_from(args)
    supplied = Recipe.from_file(args.recipe) if args.recipe else None

    if args.source is None:
        if not args.interactive:
            raise THLError(
                "Name a file or a directory. With -i and a terminal, the session "
                "opens on the source picker instead."
            )
        args.source = "."

    root = Path(args.source)
    refs = loading.discover(
        root, pattern=options.pattern, recursive=options.recursive, sheet=options.load.sheet
    )
    directory_source = root.is_dir() or len(refs) > 1

    _confirm_scale(args, refs, options)

    if args.interactive:
        chosen, state, plan = session_mod.run(
            refs,
            options=options,
            tool_version=__version__,
            prefilled=supplied,
            directory_source=directory_source,
        )
        options = _apply_session(options, state)
        # The picker is allowed to narrow the list, so what it returns is
        # what runs -- passing the directory back would quietly restore
        # every file the user just unticked.
        refs, supplied = chosen, plan

    if args.save_recipe:
        return save_recipe(args, options, refs, supplied, quiet=args.quiet)

    if args.dry_run:
        return print_plan(options, refs, supplied)

    result = runner.run(
        root,
        refs=refs,
        options=options,
        recipe=supplied,
        tool_version=__version__,
        on_progress=None if args.quiet else (lambda message: print(f"  {message}")),
    )
    return report_result(result, quiet=args.quiet)


def _apply_session(options: Any, state: Any) -> Any:
    """Fold the session's answers back onto the run options."""
    options.out = state.out
    options.load = state.load
    options.format = state.format
    options.figure_format = state.figure_format
    options.self_contained = state.self_contained
    options.emit_script = state.emit_script
    options.options = dict(state.options)
    options.target = state.target
    return options


def _confirm_scale(args: argparse.Namespace, refs: list[Any], options: Any) -> None:
    """Ask before spending a long time, not after.

    Three situations warrant it: a very large file, a folder with more
    datasets than anyone reads, and -- checked later, once the columns
    are known -- an unusually wide frame.
    """
    from .errors import SamplingRequired  # noqa: PLC0415
    from .loading import CONFIRM_BYTES  # noqa: PLC0415

    if args.yes:
        return
    huge = [ref for ref in refs if ref.size > CONFIRM_BYTES]
    if huge and not _ask(
        f"{huge[0].label} is {huge[0].size / (1024 ** 3):.1f} GB. "
        "It will be streamed and figures will be sampled. Continue?"
    ):
        raise SamplingRequired("cancelled before reading a very large file")
    if len(refs) > 10 and not _ask(f"{len(refs)} datasets will be profiled. Continue?"):
        raise THLError("cancelled before a large folder run")


def _ask(question: str) -> bool:
    """Yes/no on a terminal; assume yes when there is nobody to ask.

    A confirmation prompt in a pipeline hangs forever. Non-interactive
    callers get the documented default -- and they can still be explicit
    with ``--yes``.
    """
    from . import keys  # noqa: PLC0415

    if not keys.interactive():
        return True
    answer = input(f"{question} [y/N] ").strip().lower()
    return answer in ("y", "yes")


def save_recipe(
    args: argparse.Namespace, options: Any, refs: list[Any], supplied: Any, *, quiet: bool
) -> int:
    from . import runner  # noqa: PLC0415

    plan = supplied
    if plan is None:
        _, _, plan = runner.plan(refs[0], options, tool_version=__version__)
    path = plan.save(Path(args.save_recipe))
    if not quiet:
        print(f"recipe written to {path}")
        print("replay it with:  thl eda <source> --recipe " + str(path))
    else:
        print(path)
    return EXIT_OK


def print_plan(options: Any, refs: list[Any], supplied: Any) -> int:
    """``--dry-run``: what would happen, and nothing happening."""
    from . import runner  # noqa: PLC0415

    total_figures = 0
    for ref in refs:
        plan = supplied
        if plan is None:
            _, description, plan = runner.plan(ref, options, tool_version=__version__)
        else:
            _, description, plan = runner.prepare(ref, options, plan, __version__)

        print(f"\n{ref.label}")
        print(f"  {description.rows:,} rows x {description.n_columns} columns")
        if description.sampling.applied:
            print(f"  sampling: {description.sampling.caption}")
        print(f"  output:   {options.out or runner.default_out_dir(ref)}")
        for name, column_plan in plan.columns.items():
            state = "" if column_plan.selected else "  (not profiled)"
            charts = ", ".join(column_plan.charts) or "no charts"
            print(
                f"    {name:<24} {column_plan.type:<20} "
                f"conf {column_plan.confidence:.2f}  {charts}{state}"
            )
            total_figures += len(column_plan.charts) if column_plan.selected else 0
        if plan.tier2_kinds:
            print(f"    tier 2: {', '.join(plan.tier2_kinds)}"
                  + (f" (target {plan.target})" if plan.target else ""))
        print(f"  {plan.summary_count()} statistics, up to {plan.figure_count()} figures")

    print(f"\nnothing was written. {total_figures} column figures across {len(refs)} dataset(s).")
    return EXIT_OK


def print_registry() -> int:
    """``--list``: the whole catalogue, per type. No data needed."""
    from . import keys, registry  # noqa: PLC0415
    from .types import COLUMN_TYPES, TYPE_LABELS  # noqa: PLC0415

    star = keys.glyph("star")
    print(f"thl eda {__version__} - charts and summaries by column type")
    print(f"{star} marks what a default run produces.\n")
    for kind in COLUMN_TYPES:
        charts = registry.charts_for(kind)
        summaries = registry.summaries_for(kind)
        if not charts and not summaries:
            continue
        print(f"{TYPE_LABELS.get(kind, kind)}  ({kind})")
        print("  charts:    " + (_mark(charts, kind, star) or "none"))
        print("  summaries: " + (_mark(summaries, kind, star) or "none"))
        print()
    print("relationships (--tier2):")
    for spec in registry.RELATIONS:
        mark = star if spec.default else " "
        print(f"  {mark} {spec.name:<14} {spec.note or spec.label}")
    return EXIT_OK


def _mark(specs: list[Any], kind: str, star: str) -> str:
    return ", ".join(
        (star if spec.is_default_for(kind) else "") + spec.name for spec in specs
    )


def report_result(result: Any, *, quiet: bool) -> int:
    if quiet:
        print(result.report)
    else:
        print(f"\nreport   {result.report}")
        if result.datasets:
            print(f"datasets {len(result.datasets)}")
        print(f"figures  {len(result.figures)}")
        if result.recipe:
            print(f"recipe   {result.recipe}")
        if result.script:
            print(f"script   {result.script}")
        for warning in result.warnings[:10]:
            print(f"  note: {warning}")
        for name, message in result.failures.items():
            print(f"  failed: {name}: {message}", file=sys.stderr)
    return EXIT_OK if result.ok else EXIT_PARTIAL


# --------------------------------------------------------------------------
# Entry points
# --------------------------------------------------------------------------


def main(argv: Sequence[str] | None = None) -> int:
    """The standalone ``thl-eda`` command."""
    _survive_the_console()
    args = build_parser().parse_args(list(sys.argv[1:] if argv is None else argv))
    return guard(lambda: run_parsed(args))


def _survive_the_console() -> None:
    """Never let an unprintable character be the reason a run fails.

    Column names and category values come out of the user's file and end
    up on stdout in ``--dry-run`` and in every warning. A Windows console
    is cp1252, and one Japanese column heading in an export otherwise
    profiles perfectly and then dies printing the plan. Replacing the
    character costs a question mark; raising costs the whole run.
    """
    import contextlib  # noqa: PLC0415 - only needed here

    for stream in (sys.stdout, sys.stderr):
        # Not every stream is reconfigurable -- a StringIO under test, or a
        # redirect someone else owns. Nothing to harden, nothing broken.
        with contextlib.suppress(AttributeError, ValueError, OSError):
            stream.reconfigure(errors="replace")  # type: ignore[union-attr]


def guard(fn: Any) -> int:
    """One line and an exit code, not a traceback.

    A traceback is the right output for a bug and the wrong output for
    "that column is not in the file".
    """
    from .session import Cancelled  # noqa: PLC0415 - importing it must not need the extra

    try:
        return fn()
    except Cancelled as err:
        print(f"thl eda: {err}", file=sys.stderr)
        return EXIT_CANCELLED
    except DependencyMissing as err:
        print(f"thl eda: {err}", file=sys.stderr)
        return EXIT_ERROR
    except THLError as err:
        print(f"thl eda: {err}", file=sys.stderr)
        return EXIT_ERROR
    except KeyboardInterrupt:  # pragma: no cover - depends on a human
        print("\ncancelled", file=sys.stderr)
        return EXIT_CANCELLED
    except BrokenPipeError:  # pragma: no cover - `thl eda ... | head`
        return EXIT_OK


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
