"""The catalogue: which charts and summaries exist, and for what.

This is PRD section 9 as data. It is the single place that decides what
appears on the chart screen, what ``--charts`` accepts, what a default
run produces, and what the generated script contains -- so those four
cannot disagree with each other, which is the same reason the parent
package keeps its argument bounds in ``spec/manifest.json`` and nowhere
else.

Adding a chart is two things: a portable function in ``charts.py``, and a
row here. Nothing else needs editing, and ``tests/test_registry.py``
fails if a row names a function that does not exist or a function exists
that no row offers.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .errors import UnsupportedColumnType
from .types import (
    BOOLEAN,
    CATEGORICAL_HIGH,
    CATEGORICAL_LOW,
    CONSTANT,
    DATETIME,
    EMPTY,
    FREE_TEXT,
    IDENTIFIER,
    NUMERIC_CONTINUOUS,
    NUMERIC_DISCRETE,
    UNSUPPORTED,
)


@dataclass(frozen=True)
class Spec:
    """One selectable thing.

    ``options`` names run options -- ``top_n``, ``outlier_rule``,
    ``date_format`` -- that are forwarded to the implementation as keyword
    arguments of the same name. Naming them here rather than passing every
    option to every function is what lets the generated script call each
    one with exactly the arguments it takes.

    ``default_for`` exists because being default is a property of the
    *pair*, not of the chart. A histogram is the right first look at a
    continuous column and the wrong one for a set of twelve codes, and
    both are ``numeric``. Empty means "default for every type it applies
    to"; non-empty narrows it.
    """

    name: str
    label: str
    fn: str
    types: tuple[str, ...]
    default: bool = False
    default_for: tuple[str, ...] = ()
    options: tuple[str, ...] = ()
    needs_target: bool = False
    note: str = ""

    def is_default_for(self, column_type: str) -> bool:
        if not self.default:
            return False
        return not self.default_for or column_type in self.default_for


# --------------------------------------------------------------------------
# Charts
# --------------------------------------------------------------------------

CHARTS: tuple[Spec, ...] = (
    Spec("histogram", "Histogram", "chart_histogram", (NUMERIC_CONTINUOUS, NUMERIC_DISCRETE),
         default=True, default_for=(NUMERIC_CONTINUOUS,), options=("bins",),
         note="offered for discrete columns, but a count bar is the default there"),
    Spec("box", "Box plot", "chart_box", (NUMERIC_CONTINUOUS,),
         default=True, options=("outlier_rule",)),
    Spec("kde", "Density (KDE)", "chart_kde", (NUMERIC_CONTINUOUS,)),
    Spec("violin", "Violin", "chart_violin", (NUMERIC_CONTINUOUS,)),
    Spec("ecdf", "ECDF", "chart_ecdf", (NUMERIC_CONTINUOUS,)),

    Spec("count_bar", "Count bar", "chart_count_bar", (NUMERIC_DISCRETE,),
         default=True, options=("top_n",)),

    Spec("bar", "Bar", "chart_bar", (BOOLEAN,), default=True),
    Spec("pie", "Pie", "chart_pie", (BOOLEAN, CATEGORICAL_LOW), options=("top_n",)),
    Spec("donut", "Donut", "chart_donut", (CATEGORICAL_LOW,), options=("top_n",)),

    Spec("hbar", "Horizontal bar", "chart_hbar", (CATEGORICAL_LOW,),
         default=True, options=("top_n",),
         note="the default for categories: lengths compare better than angles"),
    Spec("stacked_vs_target", "Stacked bar vs target", "chart_stacked_vs_target",
         (CATEGORICAL_LOW, BOOLEAN), default=True, default_for=(CATEGORICAL_LOW,),
         options=("top_n",), needs_target=True,
         note="boolean is a two-level category, so the same chart applies there too"),

    Spec("top_bar", "Top-N horizontal bar", "chart_top_bar", (CATEGORICAL_HIGH,),
         default=True, options=("top_n",)),
    Spec("coverage_curve", "Cumulative coverage", "chart_coverage_curve", (CATEGORICAL_HIGH,)),

    Spec("line", "Rows over time", "chart_line", (DATETIME,),
         default=True, options=("resample", "date_format")),
    Spec("gap_plot", "Gap plot", "chart_gap_plot", (DATETIME,),
         default=True, options=("date_format",)),
    Spec("period_hist", "Rows by month", "chart_period_hist", (DATETIME,),
         options=("date_format",)),

    Spec("length_hist", "Length distribution", "chart_length_hist", (FREE_TEXT,), default=True),
    Spec("top_tokens", "Top tokens", "chart_top_tokens", (FREE_TEXT,), options=("top_n",)),
)


# --------------------------------------------------------------------------
# Summaries
# --------------------------------------------------------------------------

_ALL_TYPES = (
    NUMERIC_CONTINUOUS, NUMERIC_DISCRETE, BOOLEAN, CATEGORICAL_LOW,
    CATEGORICAL_HIGH, DATETIME, FREE_TEXT, IDENTIFIER, CONSTANT, EMPTY, UNSUPPORTED,
)

#: Types whose default set includes a null count. Free text reports a
#: null *rate* instead, and constant/empty columns say it in their one
#: line of text -- printing all three would be the same fact three times.
_NULLS_DEFAULT = (
    NUMERIC_CONTINUOUS, NUMERIC_DISCRETE, BOOLEAN, CATEGORICAL_LOW,
    CATEGORICAL_HIGH, DATETIME, IDENTIFIER,
)

SUMMARIES: tuple[Spec, ...] = (
    Spec("count", "Non-null count", "summary_count", _ALL_TYPES,
         default=True, default_for=(NUMERIC_CONTINUOUS, IDENTIFIER)),
    Spec("nulls", "Nulls", "summary_nulls", _ALL_TYPES,
         default=True, default_for=_NULLS_DEFAULT),

    Spec("mean", "Mean", "summary_mean", (NUMERIC_CONTINUOUS,), default=True),
    Spec("median", "Median", "summary_median", (NUMERIC_CONTINUOUS,), default=True),
    Spec("std", "Standard deviation", "summary_std", (NUMERIC_CONTINUOUS,), default=True),
    Spec("min_max", "Minimum and maximum", "summary_min_max", (NUMERIC_CONTINUOUS,), default=True),
    Spec("quartiles", "Quartiles", "summary_quartiles", (NUMERIC_CONTINUOUS,), default=True),
    Spec("skew", "Skew", "summary_skew", (NUMERIC_CONTINUOUS,), default=True),
    Spec("outliers", "Outlier count", "summary_outliers", (NUMERIC_CONTINUOUS,),
         default=True, options=("outlier_rule",),
         note="the rule is reported with the count; a count alone is not a statistic"),
    Spec("kurtosis", "Kurtosis", "summary_kurtosis", (NUMERIC_CONTINUOUS,)),
    Spec("zeros", "Zero count", "summary_zeros", (NUMERIC_CONTINUOUS, NUMERIC_DISCRETE)),
    Spec("negatives", "Negative count", "summary_negatives",
         (NUMERIC_CONTINUOUS, NUMERIC_DISCRETE)),

    Spec("value_counts", "Value counts", "summary_value_counts", (NUMERIC_DISCRETE,),
         default=True, options=("top_n",)),
    Spec("cardinality", "Cardinality", "summary_cardinality",
         (NUMERIC_DISCRETE, CATEGORICAL_LOW, CATEGORICAL_HIGH), default=True),
    Spec("mode", "Mode", "summary_mode", (NUMERIC_DISCRETE, CATEGORICAL_LOW),
         default=True, default_for=(CATEGORICAL_LOW,)),
    Spec("range", "Range", "summary_range", (NUMERIC_DISCRETE,)),

    Spec("true_false", "True / false counts", "summary_true_false", (BOOLEAN,), default=True),
    Spec("true_rate", "True rate", "summary_true_rate", (BOOLEAN,), default=True),

    Spec("level_shares", "Share per level", "summary_level_shares",
         (CATEGORICAL_LOW,), default=True, options=("top_n",)),
    Spec("top_coverage", "Coverage of top N", "summary_top_coverage",
         (CATEGORICAL_HIGH,), default=True, options=("top_n",)),
    Spec("tail_size", "Tail size", "summary_tail_size",
         (CATEGORICAL_HIGH,), default=True, options=("top_n",)),
    Spec("singletons", "Singleton levels", "summary_singletons", (CATEGORICAL_HIGH,)),

    Spec("time_range", "First and last", "summary_time_range", (DATETIME,),
         default=True, options=("date_format",)),
    Spec("gaps", "Gaps", "summary_gaps", (DATETIME,), default=True, options=("date_format",)),
    Spec("frequency", "Modal frequency", "summary_frequency", (DATETIME,),
         default=True, options=("date_format",),
         note="reports irregularity rather than asserting a frequency that is not there"),
    Spec("span", "Span", "summary_span", (DATETIME,), default=True, options=("date_format",)),

    Spec("uniqueness", "Uniqueness ratio", "summary_uniqueness",
         (FREE_TEXT, IDENTIFIER), default=True),
    Spec("null_rate", "Null rate", "summary_null_rate", (FREE_TEXT,), default=True),
    Spec("length_stats", "Length statistics", "summary_length_stats",
         (FREE_TEXT,), default=True),
    Spec("empty_strings", "Empty strings", "summary_empty_strings", (FREE_TEXT,)),
    Spec("top_tokens", "Top tokens", "summary_top_tokens", (FREE_TEXT,), options=("top_n",)),

    Spec("duplicates", "Duplicate count", "summary_duplicates", (IDENTIFIER,), default=True),
    Spec("format_consistency", "Format consistency", "summary_format_consistency",
         (IDENTIFIER,), default=True),

    Spec("the_value", "The value", "summary_the_value",
         (CONSTANT, EMPTY, UNSUPPORTED), default=True),
)


# --------------------------------------------------------------------------
# Tier 2
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class RelationSpec:
    """One Tier 2 computation."""

    name: str
    label: str
    fn: str
    default: bool = False
    needs_target: bool = False
    note: str = ""


RELATIONS: tuple[RelationSpec, ...] = (
    RelationSpec("correlation", "Correlation matrix", "relate_correlation", default=True,
                 note="Pearson and Spearman for numeric pairs, Cramer's V for categorical"),
    RelationSpec("missingness", "Missingness structure", "relate_missingness", default=True,
                 note="which columns go missing together"),
    RelationSpec("duplicates", "Duplicate rows", "relate_duplicates", default=True),
    RelationSpec("target", "Target versus features", "relate_target", needs_target=True,
                 note="grouped distributions, stacked shares, and a mutual-information ranking"),
)

#: What ``--tier2 all`` means, and what the session pre-ticks.
TIER2_ALIASES = {
    "all": tuple(spec.name for spec in RELATIONS),
    "corr": ("correlation",),
    "missing": ("missingness",),
    "dupes": ("duplicates",),
}


# --------------------------------------------------------------------------
# Lookup
# --------------------------------------------------------------------------


def charts_for(column_type: str, *, has_target: bool = True) -> list[Spec]:
    """Every chart offered for a type, in registry order."""
    return [
        spec
        for spec in CHARTS
        if column_type in spec.types and (has_target or not spec.needs_target)
    ]


def summaries_for(column_type: str) -> list[Spec]:
    return [spec for spec in SUMMARIES if column_type in spec.types]


def default_charts(column_type: str, *, has_target: bool = False) -> list[str]:
    """The pre-ticked charts for a type.

    Target-dependent charts are only default when there *is* a target;
    offering "stacked bar vs target" with no target selected would put an
    unbuildable figure in the plan and a failure in the caveats.
    """
    return [
        spec.name
        for spec in charts_for(column_type, has_target=has_target)
        if spec.is_default_for(column_type) and (has_target or not spec.needs_target)
    ]


def default_summaries(column_type: str) -> list[str]:
    return [spec.name for spec in summaries_for(column_type) if spec.is_default_for(column_type)]


def chart(name: str, column_type: str | None = None) -> Spec:
    """One chart spec, checked against the column type when given."""
    return _lookup(CHARTS, name, column_type, "chart")


def summary(name: str, column_type: str | None = None) -> Spec:
    return _lookup(SUMMARIES, name, column_type, "summary")


def relation(name: str) -> RelationSpec:
    for spec in RELATIONS:
        if spec.name == name:
            return spec
    known = ", ".join(s.name for s in RELATIONS)
    raise UnsupportedColumnType(f"No Tier 2 analysis named {name!r}. One of: {known}.")


def _lookup(table: tuple[Spec, ...], name: str, column_type: str | None, kind: str) -> Spec:
    matches = [spec for spec in table if spec.name == name]
    if not matches:
        known = ", ".join(sorted({spec.name for spec in table}))
        raise UnsupportedColumnType(f"No {kind} named {name!r}. Available: {known}.")
    spec = matches[0]
    if column_type is not None and column_type not in spec.types:
        applies = ", ".join(spec.types)
        raise UnsupportedColumnType(
            f"The {name!r} {kind} does not apply to a {column_type} column. "
            f"It applies to: {applies}."
        )
    return spec


def chart_names() -> list[str]:
    return sorted({spec.name for spec in CHARTS})


def summary_names() -> list[str]:
    return sorted({spec.name for spec in SUMMARIES})


def relation_names() -> list[str]:
    return [spec.name for spec in RELATIONS]


def expand_tier2(values: list[str]) -> list[str]:
    """Turn ``--tier2 corr,missing`` or ``--tier2 all`` into relation names."""
    out: list[str] = []
    for value in values:
        key = value.strip().lower()
        if not key:
            continue
        for name in TIER2_ALIASES.get(key, (key,)):
            relation(name)  # raises on an unknown name, with the list
            if name not in out:
                out.append(name)
    return out


# --------------------------------------------------------------------------
# Run options
# --------------------------------------------------------------------------

#: Defaults for every option a spec can ask for. The CLI, the session and
#: the recipe all read from this, so "the default top-N" is one number.
DEFAULT_OPTIONS: dict[str, Any] = {
    "top_n": 15,
    "outlier_rule": "iqr",
    "bins": 0,
    "resample": "auto",
    "date_format": None,
}

OUTLIER_RULES = ("iqr", "zscore")


def option_values(spec: Spec, options: dict[str, Any]) -> dict[str, Any]:
    """The keyword arguments this spec's implementation takes.

    Options the spec did not declare are dropped rather than passed, so
    adding a new run option never breaks an existing implementation's
    signature.
    """
    merged = {**DEFAULT_OPTIONS, **options}
    return {name: merged[name] for name in spec.options if name in merged}


def implementation(spec: Spec | RelationSpec) -> Any:
    """The callable behind a spec.

    Imported here rather than at module load so the registry itself stays
    free of pandas -- ``thl eda --help`` and the chart screen both need
    the table and neither needs numpy.
    """
    from . import charts, relate, summaries  # noqa: PLC0415 - see docstring

    for module in (summaries, charts, relate):
        fn = getattr(module, spec.fn, None)
        if fn is not None:
            return fn
    raise UnsupportedColumnType(  # pragma: no cover - the registry test prevents this
        f"{spec.name!r} names {spec.fn!r}, which is not implemented."
    )
