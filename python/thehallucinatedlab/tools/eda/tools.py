"""The primitives, and the orchestrator over them.

The parent package's tools are pure single-shot transforms: a few scalar
arguments in, one artefact out, no questions asked. EDA is stateful,
multi-step and emits a directory, so it does not fit that contract -- and
rather than bending the contract, it is decomposed until it does:

    describe_dataset(source, ...)          -> DatasetDescription
    profile_column(source, column, ...)    -> ColumnProfile
    plot_column(source, column, chart=...) -> PlotResult
    relate_columns(source, kind=...)       -> RelationResult
    eda_report(source, recipe=...)         -> ReportResult

Each is independently callable, independently testable, and usable from
the auto-analytics pipeline without going near a report. ``eda()`` is the
application on top: it is not a tool, it is a program that calls tools.

Everything here is non-interactive by definition. ``eda()`` called from
Python never prompts and never opens a window -- there is no native
dialog anywhere in this package, which is what keeps it working over
SSH, in Docker, in CI and in a notebook.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from . import deps, inference, loading, registry, runner
from .errors import ColumnNotFound, InvalidRecipe
from .figures import FigureSink
from .loading import LoadOptions, SourceRef
from .recipe import Recipe
from .runner import RunOptions
from .types import ColumnProfile, DatasetDescription, PlotResult, RelationResult, ReportResult

__all__ = [
    "describe_dataset",
    "profile_column",
    "plot_column",
    "relate_columns",
    "eda_report",
    "eda",
    "TOOLS",
]

#: The names this module registers with the parent package's tool spec.
#: ``thl tools`` reads it to list the EDA primitives once the extra is
#: installed, and to list them as available-with-install when it is not.
TOOLS = (
    "describe_dataset",
    "profile_column",
    "plot_column",
    "relate_columns",
    "eda_report",
)


def _version() -> str:
    from . import __version__  # noqa: PLC0415 - avoids a circular import at module load

    return __version__


def _load_options(
    *,
    delimiter: str | None = None,
    encoding: str | None = None,
    header: int | None = 0,
    na_values: list[str] | None = None,
    sheet: str | None = None,
    nrows: int | None = None,
    sample: int | None = None,
    seed: int = 42,
) -> LoadOptions:
    return LoadOptions(
        delimiter=delimiter,
        encoding=encoding,
        header=header,
        na_values=list(na_values or []),
        sheet=sheet,
        nrows=nrows,
        sample=sample,
        seed=seed,
    )


def _single(source: str | os.PathLike[str], sheet: str | None = None) -> SourceRef:
    """One :class:`SourceRef`, refusing to guess when a path means several."""
    refs = loading.discover(source, sheet=sheet)
    if len(refs) != 1:
        raise InvalidRecipe(
            f"{source} is {len(refs)} datasets. The primitives take one; use eda() for a folder."
        )
    return refs[0]


# --------------------------------------------------------------------------
# describe_dataset
# --------------------------------------------------------------------------


def describe_dataset(
    source: str | os.PathLike[str],
    *,
    sample: int | None = None,
    encoding: str | None = None,
    delimiter: str | None = None,
    header: int | None = 0,
    na_values: list[str] | None = None,
    sheet: str | None = None,
    nrows: int | None = None,
    types: dict[str, str] | None = None,
    seed: int = 42,
) -> DatasetDescription:
    """Dataset-level facts and an inferred type for every column.

    The cheap pass. Nothing is charted and nothing is written; this is
    what the type-review screen shows and what a pipeline calls when it
    wants to know what it is holding.

    Args:
        source: Path to a data file.
        sample: Rows to sample. Omitted, the file is read whole unless it
            is large enough to need streaming.
        encoding, delimiter, header, na_values: Read options. Sniffed
            where not supplied; whatever you pass is obeyed, not treated
            as a hint.
        sheet: Worksheet name, for spreadsheets.
        nrows: Read only the first N rows.
        types: Column-to-type overrides, applied after inference.
        seed: Sampling seed, recorded so a rerun matches.

    Returns:
        A :class:`~.types.DatasetDescription`. Every column carries an
        inferred type *and* a confidence; anything under 0.7 is in
        ``.warnings`` as well.

    Raises:
        DependencyMissing: the ``[eda]`` extra is missing.
        UnreadableSource: the path does not exist or will not parse.
        EmptyDataset: it parsed but has no rows or no columns.

    Example:
        >>> description = describe_dataset("sales.csv")
        >>> description.types()["zip"]
        'numeric_discrete'
    """
    deps.require()
    ref = _single(source, sheet)
    options = _load_options(
        delimiter=delimiter, encoding=encoding, header=header, na_values=na_values,
        sheet=sheet, nrows=nrows, sample=sample, seed=seed,
    )
    loaded = loading.load(ref, options)
    return inference.describe(loaded, types or {})


# --------------------------------------------------------------------------
# profile_column
# --------------------------------------------------------------------------


def profile_column(
    source: str | os.PathLike[str],
    column: str,
    *,
    summaries: list[str] | None = None,
    type_override: str | None = None,
    top_n: int = 15,
    outlier_rule: str = "iqr",
    encoding: str | None = None,
    delimiter: str | None = None,
    header: int | None = 0,
    na_values: list[str] | None = None,
    sheet: str | None = None,
    nrows: int | None = None,
    sample: int | None = None,
    seed: int = 42,
) -> ColumnProfile:
    """Summaries for one column.

    Args:
        source: Path to a data file.
        column: Which column.
        summaries: Which summaries to run. Defaults to the ones marked
            default for the column's type in the registry.
        type_override: Read the column as this type instead of the
            inferred one.
        top_n: Cut-off for level and token listings.
        outlier_rule: ``iqr`` or ``zscore``. Reported with the count.

    Returns:
        A :class:`~.types.ColumnProfile`. A summary that raised appears in
        ``.failed`` with the exception, and the rest still ran.

    Raises:
        ColumnNotFound: no such column.
        UnsupportedColumnType: a named summary does not apply to the type.

    Example:
        >>> profile = profile_column("sales.csv", "revenue")
        >>> round(profile.summaries["median"])
        412
    """
    deps.require()
    ref = _single(source, sheet)
    options = _load_options(
        delimiter=delimiter, encoding=encoding, header=header, na_values=na_values,
        sheet=sheet, nrows=nrows, sample=sample, seed=seed,
    )
    loaded = loading.load(ref, options)
    if column not in loaded.frame.columns:
        raise ColumnNotFound(
            f"No column named {column!r} in {ref.label}. "
            f"Columns: {', '.join(loaded.columns[:12])}"
        )

    overrides = {column: type_override} if type_override else {}
    description = inference.describe(loaded, overrides)
    verdict = description.column(column).verdict

    from .recipe import ColumnPlan  # noqa: PLC0415 - avoids a cycle at module load

    plan = ColumnPlan(
        name=column,
        type=verdict.type,
        confidence=verdict.confidence,
        overridden=verdict.overridden,
        summaries=list(summaries) if summaries else registry.default_summaries(verdict.type),
        meta=dict(verdict.meta),
    )
    for name in plan.summaries:
        registry.summary(name, plan.type)  # raises with the applicable types

    profile = runner.profile_one(
        loaded.frame, plan, {"top_n": top_n, "outlier_rule": outlier_rule}, loaded
    )
    profile.warnings = list(verdict.warnings)
    return profile


# --------------------------------------------------------------------------
# plot_column
# --------------------------------------------------------------------------


def plot_column(
    source: str | os.PathLike[str],
    column: str,
    *,
    chart: str,
    out: str | os.PathLike[str] | None = None,
    target: str | None = None,
    type_override: str | None = None,
    top_n: int = 15,
    outlier_rule: str = "iqr",
    bins: int = 0,
    resample: str = "auto",
    figure_format: str = "png",
    dpi: int = 110,
    encoding: str | None = None,
    delimiter: str | None = None,
    header: int | None = 0,
    na_values: list[str] | None = None,
    sheet: str | None = None,
    nrows: int | None = None,
    sample: int | None = None,
    seed: int = 42,
) -> PlotResult:
    """One figure, written to one file.

    Args:
        source: Path to a data file.
        column: Which column to plot.
        chart: A chart name from the registry -- ``histogram``, ``box``,
            ``hbar`` and so on. ``thl eda --list`` prints the full set.
        out: Where to write. Defaults to
            ``<input_dir>/<input_stem>.eda/figures/``.
        target: Required by ``stacked_vs_target``, ignored otherwise.

    Returns:
        A :class:`~.types.PlotResult` with ``.path`` set.

    Raises:
        UnsupportedColumnType: the chart does not apply to this column's
            type. Override the type if the inference is what is wrong.

    Example:
        >>> result = plot_column("sales.csv", "revenue", chart="histogram")
        >>> result.path.suffix
        '.png'
    """
    deps.require()
    deps.use_headless_backend()
    ref = _single(source, sheet)
    options = _load_options(
        delimiter=delimiter, encoding=encoding, header=header, na_values=na_values,
        sheet=sheet, nrows=nrows, sample=sample, seed=seed,
    )
    loaded = loading.load(ref, options)
    if column not in loaded.frame.columns:
        raise ColumnNotFound(
            f"No column named {column!r} in {ref.label}. "
            f"Columns: {', '.join(loaded.columns[:12])}"
        )

    overrides = {column: type_override} if type_override else {}
    description = inference.describe(loaded, overrides)
    verdict = description.column(column).verdict
    spec = registry.chart(chart, verdict.type)

    if spec.needs_target and not target:
        raise InvalidRecipe(f"The {chart!r} chart needs a target column; pass target=.")
    if target and target not in loaded.frame.columns:
        raise ColumnNotFound(f"Target column {target!r} is not in {ref.label}.")

    directory = Path(out) if out else runner.default_out_dir(ref) / "figures"
    sink = FigureSink(
        directory, figure_format=figure_format, dpi=dpi,
        caption=loaded.sampling.caption,
    )
    merged = {
        "top_n": top_n, "outlier_rule": outlier_rule, "bins": bins,
        "resample": resample, "date_format": verdict.meta.get("format"),
    }
    fn = registry.implementation(spec)
    kwargs = registry.option_values(spec, merged)
    title = f"{column} {spec.label}"
    series = loaded.frame[column]
    figure = (
        fn(series, loaded.frame[target], title=title, caption=sink.caption, **kwargs)
        if spec.needs_target
        else fn(series, title=title, caption=sink.caption, **kwargs)
    )
    return sink.save(figure, chart=chart, column=column, title=title)


# --------------------------------------------------------------------------
# relate_columns
# --------------------------------------------------------------------------


def relate_columns(
    source: str | os.PathLike[str],
    *,
    kind: str,
    columns: list[str] | None = None,
    target: str | None = None,
    out: str | os.PathLike[str] | None = None,
    top_n: int = 15,
    figure_format: str = "png",
    dpi: int = 110,
    types: dict[str, str] | None = None,
    encoding: str | None = None,
    delimiter: str | None = None,
    header: int | None = 0,
    na_values: list[str] | None = None,
    sheet: str | None = None,
    nrows: int | None = None,
    sample: int | None = None,
    seed: int = 42,
) -> RelationResult:
    """One Tier 2 analysis: how the columns relate to each other.

    Args:
        source: Path to a data file.
        kind: ``correlation``, ``missingness``, ``duplicates`` or
            ``target``.
        columns: Restrict to these columns.
        target: Required by ``target``; enables target-versus-feature
            views elsewhere.
        out: Where figures go. Defaults to the standard figures directory.

    Returns:
        A :class:`~.types.RelationResult` -- the numbers in ``.data`` and
        any figures in ``.figures``.

    Example:
        >>> result = relate_columns("sales.csv", kind="duplicates")
        >>> result.data["exact"]
        0
    """
    deps.require()
    deps.use_headless_backend()
    ref = _single(source, sheet)
    spec = registry.relation(kind)
    options = _load_options(
        delimiter=delimiter, encoding=encoding, header=header, na_values=na_values,
        sheet=sheet, nrows=nrows, sample=sample, seed=seed,
    )
    loaded = loading.load(ref, options)
    description = inference.describe(loaded, types or {})

    frame = loaded.frame
    if columns:
        missing = [name for name in columns if name not in frame.columns]
        if missing:
            raise ColumnNotFound(f"Not in {ref.label}: {', '.join(missing)}")
        keep = list(columns)
        if target and target not in keep:
            keep.append(target)
        frame = frame[keep]
    if target and target not in frame.columns:
        raise ColumnNotFound(f"Target column {target!r} is not in {ref.label}.")

    directory = Path(out) if out else runner.default_out_dir(ref) / "figures"
    sink = FigureSink(
        directory, figure_format=figure_format, dpi=dpi, caption=loaded.sampling.caption
    )

    from . import relate  # noqa: PLC0415 - deferred with the rest of the extra

    fn = getattr(relate, spec.fn)
    return fn(frame, description.types(), sink, {"top_n": top_n}, target)


# --------------------------------------------------------------------------
# eda_report
# --------------------------------------------------------------------------


def eda_report(
    source: str | os.PathLike[str],
    *,
    recipe: str | os.PathLike[str] | Recipe,
    out: str | os.PathLike[str] | None = None,
    format: str = "md",  # noqa: A002 - the PRD names this argument; matching it matters more
    self_contained: bool = False,
    overwrite: bool = False,
) -> ReportResult:
    """Render one report from a fully-specified recipe.

    This is the seam. The interactive session's only job is to produce a
    recipe; a browser front-end would do the same; CI checks one into a
    repository. All three arrive here.

    Args:
        source: Path to a data file.
        recipe: A :class:`~.recipe.Recipe`, or a path to one.
        out: Output directory. Defaults to
            ``<input_dir>/<input_stem>.eda/``.
        format: ``md`` or ``html``.
        self_contained: Inline the figures as base64. HTML only.

    Returns:
        A :class:`~.types.ReportResult`. ``.ok`` is false when the run
        finished but something inside it did not.

    Raises:
        InvalidRecipe: the recipe is malformed or describes something
            this version cannot run.

    Example:
        >>> result = eda_report("sales.csv", recipe="team.json")
        >>> result.report.name
        'report.md'
    """
    deps.require()
    loaded_recipe = recipe if isinstance(recipe, Recipe) else Recipe.from_file(recipe)
    ref = _single(source, loaded_recipe.load.get("sheet"))

    options = RunOptions(
        out=Path(out) if out else None,
        load=LoadOptions.from_json(loaded_recipe.load),
        format=format,
        figure_format=str(loaded_recipe.output.get("figure_format", "png")),
        self_contained=self_contained or bool(loaded_recipe.output.get("self_contained")),
        dpi=int(loaded_recipe.output.get("dpi", 110)),
        emit_script=bool(loaded_recipe.output.get("script", True)),
        overwrite=overwrite,
        options=dict(loaded_recipe.options),
        target=loaded_recipe.target,
    )
    loaded, description, rebuilt = runner.prepare(ref, options, loaded_recipe, _version())
    rebuilt.output["format"] = format
    rebuilt.output["self_contained"] = options.self_contained
    return runner.execute(
        ref, loaded, description, rebuilt, options, tool_version=_version()
    )


# --------------------------------------------------------------------------
# eda
# --------------------------------------------------------------------------


def eda(
    source: str | os.PathLike[str],
    *,
    out: str | os.PathLike[str] | None = None,
    recipe: str | os.PathLike[str] | Recipe | None = None,
    target: str | None = None,
    tier2: bool | list[str] | None = None,
    columns: list[str] | None = None,
    exclude: list[str] | None = None,
    types: dict[str, str] | None = None,
    charts: dict[str, list[str]] | None = None,
    summaries: dict[str, list[str]] | None = None,
    all_charts: bool = False,
    no_charts: bool = False,
    top_n: int = 15,
    outlier_rule: str = "iqr",
    format: str = "md",  # noqa: A002 - matches the documented keyword
    figure_format: str = "png",
    self_contained: bool = False,
    dpi: int = 110,
    script: bool = True,
    overwrite: bool = False,
    pattern: str | None = None,
    recursive: bool = False,
    max_files: int = runner.DEFAULT_MAX_FILES,
    continue_on_error: bool = True,
    delimiter: str | None = None,
    encoding: str | None = None,
    header: int | None = 0,
    na_values: list[str] | None = None,
    sheet: str | None = None,
    nrows: int | None = None,
    sample: int | None = None,
    seed: int = 42,
    on_progress: Any = None,
) -> Any:
    """Profile a file, or a folder of files, and write a report.

    Non-interactive by definition: it never prompts, never opens a
    window, and never blocks on input. The interactive session is the
    ``thl eda -i`` command, which builds a recipe and calls this.

    Args:
        source: A file or a directory. A directory is treated as N
            independent datasets, each profiled into its own
            subdirectory, plus an index linking them.
        out: Output directory. Defaults to
            ``<input_dir>/<input_stem>.eda/``.
        recipe: Replay a saved recipe instead of inferring choices.
        target: Enables target-versus-feature views and the
            mutual-information ranking.
        tier2: ``True`` for everything, or a list of
            ``correlation``/``missingness``/``duplicates``/``target``.
        columns, exclude, types, charts, summaries: The same selections
            the session's screens collect.
        format: ``md`` (default, diffable) or ``html``.
        script: Emit ``analysis.py``. On by default; it is the point.

    Returns:
        An :class:`~.types.EDAResult`. ``.report`` is always the file to
        open -- the report for one file, the index for a folder.

    Example:
        >>> result = eda("sales.csv", target="churn", tier2=True)
        >>> result.report.name
        'report.md'
    """
    deps.require()

    if tier2 is True:
        kinds = ["all"]
    elif tier2 in (None, False):
        kinds = []
    else:
        kinds = list(tier2)  # type: ignore[arg-type]

    options = RunOptions(
        out=Path(out) if out else None,
        load=_load_options(
            delimiter=delimiter, encoding=encoding, header=header, na_values=na_values,
            sheet=sheet, nrows=nrows, sample=sample, seed=seed,
        ),
        types=dict(types or {}),
        columns=list(columns) if columns else None,
        exclude=list(exclude or []),
        charts=dict(charts or {}),
        summaries=dict(summaries or {}),
        all_charts=all_charts,
        no_charts=no_charts,
        tier2=kinds,
        target=target,
        options={"top_n": top_n, "outlier_rule": outlier_rule},
        format=format,
        figure_format=figure_format,
        self_contained=self_contained,
        dpi=dpi,
        emit_script=script,
        overwrite=overwrite,
        max_files=max_files,
        pattern=pattern,
        recursive=recursive,
        continue_on_error=continue_on_error,
    )

    supplied = None
    if recipe is not None:
        supplied = recipe if isinstance(recipe, Recipe) else Recipe.from_file(recipe)

    return runner.run(
        source, options=options, recipe=supplied, tool_version=_version(),
        on_progress=on_progress,
    )
