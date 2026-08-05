"""The orchestrator: source discovery, scheduling, failure isolation.

``thl eda`` is an application over the primitives, not a primitive
itself. This module is that application. It holds no analysis logic --
every number comes from ``summaries.py``, every figure from
``charts.py``, every relationship from ``relate.py`` -- and owns only the
things none of those can: where output goes, what order things happen
in, and what to do when one column or one file blows up.

That last one is the point. A folder with thirty CSVs in it has a broken
one, and a run that aborts on file nineteen has wasted the other
twenty-nine. Failures are caught per column and per file, recorded in the
report's caveats with the exception type, and turned into exit code 2 --
partial success -- rather than being allowed to look like either a clean
run or a total failure.
"""

from __future__ import annotations

import os
import shutil
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import deps, inference, loading, registry, report, script
from . import recipe as recipe_mod
from .errors import ColumnNotFound, OutputNotWritable, THLError
from .figures import FigureSink
from .loading import LoadOptions, SourceRef
from .recipe import Recipe
from .types import EDAResult, ReportResult

#: Above this, the folder-mode run asks first. Twenty-five reports is
#: already more than anyone reads in a sitting.
DEFAULT_MAX_FILES = 25


@dataclass
class RunOptions:
    """Everything ``eda()`` accepts, in one object.

    A dataclass rather than twenty keyword arguments threaded through
    five functions: the CLI builds one of these, the session builds one
    of these, and adding an option is one line rather than five.
    """

    out: Path | None = None
    load: LoadOptions = field(default_factory=LoadOptions)
    types: dict[str, str] = field(default_factory=dict)
    columns: list[str] | None = None
    exclude: list[str] = field(default_factory=list)
    charts: dict[str, list[str]] = field(default_factory=dict)
    summaries: dict[str, list[str]] = field(default_factory=dict)
    all_charts: bool = False
    no_charts: bool = False
    tier2: list[str] = field(default_factory=list)
    target: str | None = None
    options: dict[str, Any] = field(default_factory=dict)
    format: str = "md"
    figure_format: str = "png"
    self_contained: bool = False
    dpi: int = 110
    emit_script: bool = True
    overwrite: bool = False
    max_files: int = DEFAULT_MAX_FILES
    pattern: str | None = None
    recursive: bool = False
    continue_on_error: bool = True
    allow_sampling: bool = True
    quiet: bool = True

    def output_spec(self) -> dict[str, Any]:
        return {
            "format": self.format,
            "figure_format": self.figure_format,
            "self_contained": self.self_contained,
            "dpi": self.dpi,
            "script": self.emit_script,
        }


# --------------------------------------------------------------------------
# Output location
# --------------------------------------------------------------------------


def default_out_dir(ref: SourceRef) -> Path:
    """``<input_dir>/<input_stem>.eda/``.

    One directory, obviously generated, trivially deletable, never mixed
    in with the data. Writing PNGs beside somebody's dataset is how a
    profiler ends up in a diff nobody asked for.
    """
    return ref.path.parent / f"{ref.stem}.eda"


def resolve_out_dir(
    ref: SourceRef, requested: Path | None, *, overwrite: bool, warnings: list[str]
) -> Path:
    """Pick a directory and make sure it can actually be written to."""
    target = Path(requested) if requested else default_out_dir(ref)
    try:
        target.mkdir(parents=True, exist_ok=True)
        probe = target / ".thl-eda-write-test"
        probe.write_text("", encoding="utf-8")
        probe.unlink()
    except OSError:
        if requested is not None:
            raise OutputNotWritable(f"Cannot write to {target}.") from None
        fallback = Path.cwd() / f"{ref.stem}.eda"
        warnings.append(
            f"{target} is not writable; writing to {fallback} instead."
        )
        try:
            fallback.mkdir(parents=True, exist_ok=True)
        except OSError as err:
            raise OutputNotWritable(
                f"Neither {target} nor {fallback} can be written to: {err}"
            ) from err
        target = fallback

    existing = [p for p in target.iterdir() if not p.name.startswith(".")]
    ours = (target / "recipe.json").exists() or (target / "report.md").exists()
    if existing and not ours and not overwrite:
        raise OutputNotWritable(
            f"{target} already exists and was not written by this tool. "
            "Pass --overwrite to use it anyway, or --out to write somewhere else."
        )

    # Stale figures from a wider previous run would sit in the directory
    # looking like part of this report. Clearing the figure directory is
    # the smallest thing that prevents that; nothing outside it is touched.
    figures = target / "figures"
    if figures.is_dir():
        shutil.rmtree(figures, ignore_errors=True)
    return target


# --------------------------------------------------------------------------
# One dataset
# --------------------------------------------------------------------------


def describe(ref: SourceRef, options: RunOptions) -> Any:
    """Load and classify one source. The first half of every entry point."""
    deps.require()
    loaded = loading.load(ref, options.load, allow_sampling=options.allow_sampling)
    return loaded, inference.describe(loaded, options.types)


def plan(ref: SourceRef, options: RunOptions, *, tool_version: str) -> tuple[Any, Any, Recipe]:
    """Load, classify, and turn the choices into a recipe."""
    loaded, description = describe(ref, options)
    built = recipe_mod.build(
        description,
        columns=options.columns,
        exclude=options.exclude,
        charts=options.charts,
        summaries=options.summaries,
        all_charts=options.all_charts,
        no_charts=options.no_charts,
        tier2=options.tier2,
        target=options.target,
        options=options.options,
        output=options.output_spec(),
        tool_version=tool_version,
        source_path=ref.path,
    )
    built.load["kind"] = loading.source_kind(ref)
    return loaded, description, built


def execute(
    ref: SourceRef,
    loaded: Any,
    description: Any,
    plan_recipe: Recipe,
    options: RunOptions,
    *,
    tool_version: str,
) -> ReportResult:
    """Run a recipe against a loaded frame and write everything out."""
    deps.use_headless_backend()
    started = time.perf_counter()
    warnings: list[str] = list(description.warnings)
    failures: dict[str, str] = {}

    out_dir = resolve_out_dir(
        ref, options.out, overwrite=options.overwrite, warnings=warnings
    )
    sink = FigureSink(
        out_dir / "figures",
        figure_format=plan_recipe.output.get("figure_format", "png"),
        dpi=int(plan_recipe.output.get("dpi", 110)),
        caption=description.sampling.caption,
    )

    frame = loaded.frame
    target = plan_recipe.target
    if target and target not in frame.columns:
        raise ColumnNotFound(f"Target column {target!r} is not in {ref.label}.")

    profiles: dict[str, Any] = {}
    figures: dict[str, list[Any]] = {}

    for column_plan in plan_recipe.selected():
        name = column_plan.name
        if name not in frame.columns:
            failures[name] = "column disappeared between description and run"
            continue
        try:
            profiles[name] = profile_one(frame, column_plan, plan_recipe.options, loaded)
        except Exception as err:  # noqa: BLE001 - one column must not lose the report
            failures[name] = f"{type(err).__name__}: {err}"
            continue
        try:
            figures[name] = draw_one(
                frame, column_plan, plan_recipe.options, sink,
                frame[target] if target else None,
            )
        except Exception as err:  # noqa: BLE001 - see above
            failures[name] = f"figures failed: {type(err).__name__}: {err}"

    relations = []
    types = plan_recipe.types()
    from . import relate  # noqa: PLC0415 - deferred with the rest of the extra

    for kind in plan_recipe.tier2_kinds:
        spec = registry.relation(kind)
        try:
            fn = getattr(relate, spec.fn)
            relations.append(fn(frame, types, sink, plan_recipe.options, target))
        except Exception as err:  # noqa: BLE001 - Tier 2 is optional; Tier 1 already ran
            failures[f"tier2:{kind}"] = f"{type(err).__name__}: {err}"

    for relation in relations:
        warnings.extend(relation.warnings)

    data = report.ReportInput(
        description=description,
        recipe=plan_recipe,
        profiles=profiles,
        figures=figures,
        relations=relations,
        warnings=warnings,
        failures=failures,
        tool_version=tool_version,
        dependency_versions=deps.versions(),
        generated_at=_stamp(),
        duration_seconds=time.perf_counter() - started,
    )

    document = report.build(data)
    fmt = plan_recipe.output.get("format", "md")
    if fmt == "html":
        report_path = out_dir / "report.html"
        text = report.render_html(
            document, out_dir,
            self_contained=bool(plan_recipe.output.get("self_contained", False)),
        )
    else:
        report_path = out_dir / "report.md"
        text = report.render_markdown(document, out_dir)
    report_path.write_text(text, encoding="utf-8")

    summary_path = report.dump_summary(data, out_dir / "summary.json")
    recipe_path = plan_recipe.save(out_dir / "recipe.json")

    script_path = None
    if plan_recipe.output.get("script", True):
        try:
            script_path = script.write(
                out_dir / "analysis.py",
                script.build(
                    plan_recipe,
                    source=ref.path,
                    source_kind=plan_recipe.load.get("kind", "csv"),
                    tool_version=tool_version,
                    dependency_versions=data.dependency_versions,
                    generated_at=data.generated_at,
                    # Exact per-column statistics only exist when the file
                    # was streamed, so their presence is the signal -- not
                    # a string match on the sampling reason.
                    streaming=bool(loaded.exact),
                ),
            )
        except Exception as err:  # noqa: BLE001 - the report is written; say so and continue
            failures["analysis.py"] = f"{type(err).__name__}: {err}"

    return ReportResult(
        report=report_path,
        out_dir=out_dir,
        figures=sink.paths,
        recipe=recipe_path,
        script=script_path,
        summary=summary_path,
        warnings=warnings,
        failures=failures,
    )


def profile_one(frame: Any, column_plan: Any, options: dict[str, Any], loaded: Any) -> Any:
    """Every selected summary for one column."""
    from .readers import apply_exact  # noqa: PLC0415 - deferred with the rest of the extra
    from .summaries import jsonable  # noqa: PLC0415
    from .types import ColumnProfile  # noqa: PLC0415

    series = frame[column_plan.name]
    merged = {**options, **_column_options(column_plan)}
    result = ColumnProfile(
        column=column_plan.name,
        type=column_plan.type,
        confidence=column_plan.confidence,
    )
    for name in column_plan.summaries:
        spec = registry.summary(name, column_plan.type)
        fn = registry.implementation(spec)
        try:
            value = fn(series, **registry.option_values(spec, merged))
        except Exception as err:  # noqa: BLE001 - one statistic must not lose the other forty
            result.failed[name] = f"{type(err).__name__}: {err}"
            result.summaries[name] = None
            continue
        result.summaries[name] = jsonable(value)

    exact = loaded.exact.get(column_plan.name) if loaded is not None else None
    if exact:
        result.summaries = apply_exact(result.summaries, exact)
    return result


def draw_one(
    frame: Any, column_plan: Any, options: dict[str, Any], sink: FigureSink, target: Any
) -> list[Any]:
    """Every selected figure for one column."""
    merged = {**options, **_column_options(column_plan)}
    written = []
    for name in column_plan.charts:
        spec = registry.chart(name, column_plan.type)
        if spec.needs_target and target is None:
            continue
        fn = registry.implementation(spec)
        kwargs = registry.option_values(spec, merged)
        title = f"{column_plan.name} {spec.label}"
        series = frame[column_plan.name]
        if spec.needs_target:
            figure = fn(series, target, title=title, caption=sink.caption, **kwargs)
        else:
            figure = fn(series, title=title, caption=sink.caption, **kwargs)
        written.append(sink.save(figure, chart=name, column=column_plan.name, title=title))
    return written


def _column_options(column_plan: Any) -> dict[str, Any]:
    fmt = column_plan.meta.get("format")
    return {"date_format": fmt} if fmt else {}


def _stamp() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


# --------------------------------------------------------------------------
# The public entry point
# --------------------------------------------------------------------------


def run(
    source: str | os.PathLike[str] | None = None,
    *,
    refs: list[SourceRef] | None = None,
    options: RunOptions | None = None,
    recipe: Recipe | None = None,
    tool_version: str = "",
    on_progress: Any = None,
) -> EDAResult:
    """Profile one file or a folder of them.

    A folder is treated as N independent datasets, each into its own
    subdirectory, plus an index linking them. Cross-file relationships --
    shared keys, joinability, schema drift -- are deliberately not here;
    they are a v2 feature and half-building them would be worse than
    naming them.

    Args:
        source: What to profile. A file or a directory.
        refs: Already-discovered datasets, used instead of ``source``
            when the caller has narrowed the list -- the session's file
            picker does exactly that, and re-discovering would silently
            put the unticked files back.
    """
    deps.require()
    opts = options or RunOptions()
    warnings: list[str] = []

    if refs is None:
        if source is None:
            from .errors import UnreadableSource

            raise UnreadableSource("Name a file or a directory to profile.")
        root = Path(os.fspath(source))
        found = loading.discover(
            root, pattern=opts.pattern, recursive=opts.recursive, sheet=opts.load.sheet
        )
        folder = root.is_dir()
    else:
        found = list(refs)
        if not found:
            from .errors import UnreadableSource

            raise UnreadableSource("No datasets selected.")
        root = Path(os.fspath(source)) if source is not None else found[0].path.parent
        folder = len(found) > 1

    if len(found) > opts.max_files:
        warnings.append(
            f"{len(found)} datasets found; profiling the first {opts.max_files}. "
            "Raise --max-files or narrow --pattern to change that."
        )
        found = found[: opts.max_files]

    if len(found) == 1 and not folder:
        return _run_single(found[0], opts, recipe, tool_version, warnings, on_progress)
    return _run_folder(root, found, opts, recipe, tool_version, warnings, on_progress)


def _run_single(
    ref: SourceRef,
    opts: RunOptions,
    supplied: Recipe | None,
    tool_version: str,
    warnings: list[str],
    on_progress: Any,
) -> EDAResult:
    _say(on_progress, f"profiling {ref.label}")
    loaded, description, built = prepare(ref, opts, supplied, tool_version)
    result = execute(ref, loaded, description, built, opts, tool_version=tool_version)
    result.warnings = warnings + result.warnings
    return EDAResult(
        report=result.report,
        out_dir=result.out_dir,
        figures=result.figures,
        recipe=result.recipe,
        script=result.script,
        summary=result.summary,
        warnings=result.warnings,
        failures=result.failures,
    )


def _run_folder(
    root: Path,
    refs: list[SourceRef],
    opts: RunOptions,
    supplied: Recipe | None,
    tool_version: str,
    warnings: list[str],
    on_progress: Any,
) -> EDAResult:
    base = Path(opts.out) if opts.out else root / f"{root.name or 'data'}.eda"
    try:
        base.mkdir(parents=True, exist_ok=True)
    except OSError as err:
        raise OutputNotWritable(f"Cannot create {base}: {err}") from err

    entries: list[tuple[str, Path, int, int, list[str]]] = []
    results: list[ReportResult] = []
    failures: dict[str, str] = {}
    figures: list[Path] = []

    for index, ref in enumerate(refs, start=1):
        _say(on_progress, f"[{index}/{len(refs)}] {ref.label}")
        per_file = RunOptions(**{**opts.__dict__, "out": base / ref.stem})
        try:
            loaded, description, built = prepare(ref, per_file, supplied, tool_version)
            result = execute(
                ref, loaded, description, built, per_file, tool_version=tool_version
            )
        except THLError as err:
            # One unreadable file in a folder of thirty must not cost the
            # other twenty-nine. It is recorded, and the exit code says so.
            failures[ref.label] = f"{type(err).__name__}: {err}"
            entries.append((ref.label, base, 0, 0, [f"failed: {err}"]))
            if not opts.continue_on_error:
                raise
            continue
        except Exception as err:  # noqa: BLE001 - same, for anything unexpected
            failures[ref.label] = f"{type(err).__name__}: {err}"
            entries.append((ref.label, base, 0, 0, [f"failed: {err}"]))
            if not opts.continue_on_error:
                raise
            continue

        results.append(result)
        figures.extend(result.figures)
        notes = [] if result.ok else [f"{len(result.failures)} column(s) failed"]
        if description.sampling.applied:
            notes.append("sampled")
        entries.append(
            (ref.label, result.report, description.rows, description.n_columns, notes)
        )

    index_doc = report.index_document(
        entries, root=base, tool_version=tool_version, generated_at=_stamp()
    )
    index_path = base / ("index.html" if opts.format == "html" else "index.md")
    index_path.write_text(
        report.render_html(index_doc, base) if opts.format == "html"
        else report.render_markdown(index_doc, base),
        encoding="utf-8",
    )

    return EDAResult(
        report=index_path,
        out_dir=base,
        figures=figures,
        warnings=warnings + [w for r in results for w in r.warnings],
        failures=failures,
        datasets=results,
    )


def prepare(
    ref: SourceRef, opts: RunOptions, supplied: Recipe | None, tool_version: str
) -> tuple[Any, Any, Recipe]:
    """Either replay a supplied recipe or build one from inference."""
    if supplied is None:
        return plan(ref, opts, tool_version=tool_version)

    # Replaying: the recipe's types are decisions, not guesses, so they go
    # in as overrides and inference does not get to disagree with them.
    replay = RunOptions(**{**opts.__dict__})
    replay.load = _load_from_recipe(supplied, opts.load)
    replay.types = {**supplied.types(), **opts.types}
    loaded, description = describe(ref, replay)

    rebuilt = Recipe(
        source={
            "path": str(ref.path),
            "sha256": recipe_mod.digest(ref.path),
            "rows": description.rows,
            "columns": description.n_columns,
        },
        load={**supplied.load, "kind": loading.source_kind(ref)},
        sampling=description.sampling.to_json(),
        columns=dict(supplied.columns),
        tier2=dict(supplied.tier2),
        output={**supplied.output, **opts.output_spec()} if opts.out is not None
        else dict(supplied.output),
        options=dict(supplied.options),
        tool_version=tool_version,
    )

    # Columns the recipe knows nothing about get the defaults rather than
    # being dropped -- a recipe written for last month's export should
    # still say something about this month's new column.
    for column in description.columns:
        if column.name in rebuilt.columns:
            continue
        kind = column.verdict.type
        rebuilt.columns[column.name] = recipe_mod.ColumnPlan(
            name=column.name,
            type=kind,
            confidence=column.verdict.confidence,
            selected=kind not in {"identifier", "constant", "empty", "unsupported"},
            reason="not in the recipe; profiled with defaults",
            charts=registry.default_charts(kind, has_target=bool(supplied.target)),
            summaries=registry.default_summaries(kind),
            meta=dict(column.verdict.meta),
        )
    missing = [name for name in supplied.columns if name not in description.types()]
    for name in missing:
        rebuilt.columns.pop(name, None)
    if missing:
        description.warnings.append(
            "The recipe names columns this file does not have: " + ", ".join(missing) + "."
        )
    return loaded, description, rebuilt.validate()


def _load_from_recipe(supplied: Recipe, given: LoadOptions) -> LoadOptions:
    """Recipe load options, unless the caller overrode them on this run."""
    base = LoadOptions.from_json(supplied.load)
    for field_name in ("delimiter", "encoding", "na_values", "nrows", "sample", "sheet"):
        value = getattr(given, field_name)
        if value:
            setattr(base, field_name, value)
    if given.header != 0:
        base.header = given.header
    return base


def _say(on_progress: Any, message: str) -> None:
    if on_progress:
        on_progress(message)
