"""The vocabulary every other module agrees on.

Two things live here and nothing else: the column-type taxonomy, and the
result objects the public functions return. Both are deliberately free of
pandas imports so they can be read, tested and serialised on a machine
without the extra installed.

The result objects follow the house shape -- a dataclass with a ``path``
or structured fields and a ``__str__`` worth printing -- so a caller who
has used ``converter`` already knows how to read one.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# --------------------------------------------------------------------------
# Taxonomy
# --------------------------------------------------------------------------

NUMERIC_CONTINUOUS = "numeric_continuous"
NUMERIC_DISCRETE = "numeric_discrete"
BOOLEAN = "boolean"
CATEGORICAL_LOW = "categorical_low"
CATEGORICAL_HIGH = "categorical_high"
DATETIME = "datetime"
FREE_TEXT = "free_text"
IDENTIFIER = "identifier"
CONSTANT = "constant"
EMPTY = "empty"
UNSUPPORTED = "unsupported"

#: Every type the inference engine can emit, in the order the report
#: groups them. Order is presentation only; inference order is in
#: ``inference.py`` and is a different sequence on purpose.
COLUMN_TYPES: tuple[str, ...] = (
    NUMERIC_CONTINUOUS,
    NUMERIC_DISCRETE,
    BOOLEAN,
    CATEGORICAL_LOW,
    CATEGORICAL_HIGH,
    DATETIME,
    FREE_TEXT,
    IDENTIFIER,
    CONSTANT,
    EMPTY,
    UNSUPPORTED,
)

#: Human labels, used by the session screens and the report headings.
TYPE_LABELS: dict[str, str] = {
    NUMERIC_CONTINUOUS: "Numeric - continuous",
    NUMERIC_DISCRETE: "Numeric - discrete",
    BOOLEAN: "Boolean",
    CATEGORICAL_LOW: "Categorical - low cardinality",
    CATEGORICAL_HIGH: "Categorical - high cardinality",
    DATETIME: "Datetime",
    FREE_TEXT: "Free text",
    IDENTIFIER: "Identifier",
    CONSTANT: "Constant",
    EMPTY: "Empty",
    UNSUPPORTED: "Unsupported",
}

#: Types that carry no analysable variation. They are profiled (one line
#: of text) but never charted, and the session deselects them by default
#: with the reason shown rather than hiding them.
INERT_TYPES: frozenset[str] = frozenset({IDENTIFIER, CONSTANT, EMPTY, UNSUPPORTED})

#: Below this, a classification is called out in the report caveats, in
#: ``result.warnings``, and sorted to the top of the type-review screen.
CONFIDENCE_FLOOR = 0.7


def is_valid_type(name: str) -> bool:
    return name in COLUMN_TYPES


# --------------------------------------------------------------------------
# Results
# --------------------------------------------------------------------------


@dataclass
class TypeVerdict:
    """What inference concluded about one column, and how sure it is.

    ``reason`` is the rule that fired, in the same words the report
    prints. A verdict the user overrode keeps the original inference in
    ``inferred`` so a report can say what it would have guessed.
    """

    column: str
    type: str
    confidence: float
    reason: str = ""
    overridden: bool = False
    inferred: str | None = None
    warnings: list[str] = field(default_factory=list)
    #: Anything the rule learned that changes how the column must be
    #: *read* later -- currently only ``format`` for datetimes. It goes
    #: into the recipe so a replay parses the column the same way rather
    #: than re-guessing and possibly picking the other reading.
    meta: dict[str, Any] = field(default_factory=dict)

    @property
    def low_confidence(self) -> bool:
        return not self.overridden and self.confidence < CONFIDENCE_FLOOR

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "type": self.type,
            "confidence": round(self.confidence, 4),
            "overridden": self.overridden,
        }
        if self.reason:
            out["reason"] = self.reason
        if self.overridden and self.inferred:
            out["inferred"] = self.inferred
        if self.warnings:
            out["warnings"] = list(self.warnings)
        if self.meta:
            out["meta"] = dict(self.meta)
        return out


@dataclass
class ColumnDescription:
    """Cheap facts about one column -- the ones worth having before any
    chart is drawn, and the ones the type-review screen displays."""

    name: str
    dtype: str
    count: int
    nulls: int
    n_unique: int
    verdict: TypeVerdict
    preview: list[str] = field(default_factory=list)

    @property
    def null_rate(self) -> float:
        total = self.count + self.nulls
        return self.nulls / total if total else 0.0

    @property
    def uniqueness(self) -> float:
        return self.n_unique / self.count if self.count else 0.0

    def to_json(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "dtype": self.dtype,
            "count": self.count,
            "nulls": self.nulls,
            "null_rate": round(self.null_rate, 6),
            "n_unique": self.n_unique,
            "uniqueness": round(self.uniqueness, 6),
            "type": self.verdict.type,
            "confidence": round(self.verdict.confidence, 4),
            "preview": list(self.preview),
        }


@dataclass
class SamplingInfo:
    """Whether the numbers below came from all the rows or some of them.

    Carried on every result object and printed at the top of the report,
    because a sampled figure that does not say so is a figure that will
    end up in someone's deliverable with the wrong numbers on it.
    """

    applied: bool = False
    n: int | None = None
    of: int | None = None
    seed: int = 42
    reason: str = ""

    @property
    def caption(self) -> str:
        if not self.applied:
            return ""
        return f"sample of {self.n:,} of {self.of:,} rows (seed {self.seed})"

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {"applied": self.applied}
        if self.applied:
            out.update({"n": self.n, "of": self.of, "seed": self.seed, "reason": self.reason})
        return out


@dataclass
class DatasetDescription:
    """Dataset-level facts plus one :class:`ColumnDescription` per column."""

    path: Path
    rows: int
    columns: list[ColumnDescription]
    sampling: SamplingInfo = field(default_factory=SamplingInfo)
    load: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    memory_bytes: int = 0

    @property
    def n_columns(self) -> int:
        return len(self.columns)

    def column(self, name: str) -> ColumnDescription:
        for col in self.columns:
            if col.name == name:
                return col
        from .errors import ColumnNotFound

        known = ", ".join(c.name for c in self.columns[:12])
        raise ColumnNotFound(f"No column named {name!r}. Columns include: {known}")

    def types(self) -> dict[str, str]:
        return {col.name: col.verdict.type for col in self.columns}

    def by_type(self) -> dict[str, list[str]]:
        """Column names grouped by inferred type, in taxonomy order."""
        grouped: dict[str, list[str]] = {}
        for col in self.columns:
            grouped.setdefault(col.verdict.type, []).append(col.name)
        return {t: grouped[t] for t in COLUMN_TYPES if t in grouped}

    def to_json(self) -> dict[str, Any]:
        return {
            "path": str(self.path),
            "rows": self.rows,
            "columns": [col.to_json() for col in self.columns],
            "sampling": self.sampling.to_json(),
            "load": dict(self.load),
            "warnings": list(self.warnings),
        }

    def __str__(self) -> str:
        note = f" ({self.sampling.caption})" if self.sampling.applied else ""
        return f"{self.path.name}: {self.rows:,} rows x {self.n_columns} columns{note}"


@dataclass
class ColumnProfile:
    """Every requested summary for one column, plus the type it was read as."""

    column: str
    type: str
    confidence: float
    summaries: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    failed: dict[str, str] = field(default_factory=dict)

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "column": self.column,
            "type": self.type,
            "confidence": round(self.confidence, 4),
            "summaries": self.summaries,
        }
        if self.warnings:
            out["warnings"] = list(self.warnings)
        if self.failed:
            out["failed"] = dict(self.failed)
        return out

    def __str__(self) -> str:
        return f"{self.column} [{self.type}] {len(self.summaries)} summaries"


@dataclass
class PlotResult:
    """One figure on disk."""

    path: Path
    chart: str
    column: str | None
    title: str = ""
    caption: str = ""

    def to_json(self) -> dict[str, Any]:
        return {
            "path": str(self.path),
            "chart": self.chart,
            "column": self.column,
            "title": self.title,
            "caption": self.caption,
        }

    def __str__(self) -> str:
        return f"{self.chart} -> {self.path}"


@dataclass
class RelationResult:
    """One Tier 2 computation: the numbers, and any figure drawn from them."""

    kind: str
    data: dict[str, Any] = field(default_factory=dict)
    figures: list[PlotResult] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {"kind": self.kind, "data": self.data}
        if self.figures:
            out["figures"] = [f.to_json() for f in self.figures]
        if self.warnings:
            out["warnings"] = list(self.warnings)
        return out

    def __str__(self) -> str:
        return f"{self.kind} ({len(self.figures)} figures)"


@dataclass
class ReportResult:
    """What one run wrote.

    ``ok`` is false when the run finished but something inside it did
    not -- a column that raised, a file that would not parse. The CLI
    turns that into exit code 2 rather than pretending it was clean.
    """

    report: Path
    out_dir: Path
    figures: list[Path] = field(default_factory=list)
    recipe: Path | None = None
    script: Path | None = None
    summary: Path | None = None
    warnings: list[str] = field(default_factory=list)
    failures: dict[str, str] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return not self.failures

    def to_json(self) -> dict[str, Any]:
        return {
            "report": str(self.report),
            "out_dir": str(self.out_dir),
            "figures": [str(p) for p in self.figures],
            "recipe": str(self.recipe) if self.recipe else None,
            "script": str(self.script) if self.script else None,
            "summary": str(self.summary) if self.summary else None,
            "warnings": list(self.warnings),
            "failures": dict(self.failures),
        }

    def __str__(self) -> str:
        state = "" if self.ok else f" ({len(self.failures)} failed)"
        return f"{self.report} - {len(self.figures)} figures{state}"


@dataclass
class EDAResult:
    """What ``eda()`` returns.

    For a single file this wraps one report. For a folder it wraps the
    index plus one :class:`ReportResult` per file, and ``report`` points
    at the index -- so ``result.report`` is always the thing to open.
    """

    report: Path
    out_dir: Path
    figures: list[Path] = field(default_factory=list)
    recipe: Path | None = None
    script: Path | None = None
    summary: Path | None = None
    warnings: list[str] = field(default_factory=list)
    failures: dict[str, str] = field(default_factory=dict)
    datasets: list[ReportResult] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.failures and all(d.ok for d in self.datasets)

    def to_json(self) -> dict[str, Any]:
        return {
            "report": str(self.report),
            "out_dir": str(self.out_dir),
            "figures": [str(p) for p in self.figures],
            "recipe": str(self.recipe) if self.recipe else None,
            "script": str(self.script) if self.script else None,
            "summary": str(self.summary) if self.summary else None,
            "warnings": list(self.warnings),
            "failures": dict(self.failures),
            "datasets": [d.to_json() for d in self.datasets],
        }

    def __str__(self) -> str:
        if self.datasets:
            return f"{self.report} - {len(self.datasets)} datasets, {len(self.figures)} figures"
        state = "" if self.ok else f" ({len(self.failures)} failed)"
        return f"{self.report} - {len(self.figures)} figures{state}"
