"""Turning a finished run into something a person reads.

The report is built as a small document model first and rendered second.
That indirection earns its keep twice: Markdown and HTML come from the
same structure rather than one being a conversion of the other, and the
structure itself is testable without parsing prose.

Two decisions worth stating, both from the idea document:

**The prose is deterministic.** Every sentence comes from a template
filled with numbers this run computed. An LLM in the profiling layer
would make the output non-reproducible, which contradicts the whole
point of shipping a recipe and a script.

**Markdown is the default, not HTML.** Markdown plus separate figures
goes into git and reviews in a pull request. A self-contained HTML blob
does not diff.
"""

from __future__ import annotations

import base64
import html
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .types import (
    CONFIDENCE_FLOOR,
    TYPE_LABELS,
    ColumnProfile,
    DatasetDescription,
    PlotResult,
    RelationResult,
)

# --------------------------------------------------------------------------
# Document model
# --------------------------------------------------------------------------


@dataclass
class Heading:
    level: int
    text: str
    anchor: str = ""


@dataclass
class Para:
    text: str


@dataclass
class Bullets:
    items: list[str]


@dataclass
class Table:
    headers: list[str]
    rows: list[list[str]]
    caption: str = ""


@dataclass
class Figure:
    path: Path
    alt: str
    caption: str = ""


@dataclass
class Callout:
    kind: str  # "warning" | "note"
    title: str
    lines: list[str]


@dataclass
class Code:
    text: str
    lang: str = ""


@dataclass
class Divider:
    pass


Block = Heading | Para | Bullets | Table | Figure | Callout | Code | Divider


@dataclass
class Document:
    title: str
    blocks: list[Block] = field(default_factory=list)

    def add(self, block: Block) -> None:
        self.blocks.append(block)


# --------------------------------------------------------------------------
# Formatting
# --------------------------------------------------------------------------

_EM_DASH = "\u2014"

#: Keys whose value is a proportion. Printed as a percentage everywhere,
#: because 0.0734 and 7.34% are the same number and only one of them gets
#: read correctly at a glance.
_SHARE_KEYS = frozenset(
    {"share", "rate", "uniqueness", "null_rate", "dominant_share", "modal_share",
     "exact_share", "near_share", "imbalance", "normalised"}
)


def number(value: Any) -> str:
    """A number a human can read, without lying about precision."""
    if value is None:
        return _EM_DASH
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, int):
        return f"{value:,}"
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            return _EM_DASH
        if value == int(value) and abs(value) < 1e15:
            return f"{int(value):,}"
        magnitude = abs(value)
        if magnitude >= 1000:
            return f"{value:,.2f}"
        if magnitude >= 1:
            return f"{value:,.3f}"
        if magnitude >= 0.001:
            return f"{value:.4f}"
        return f"{value:.3g}"
    return str(value)


def share(value: Any) -> str:
    if value is None or not isinstance(value, int | float) or isinstance(value, bool):
        return _EM_DASH
    return f"{float(value):.2%}"


def _scalar(key: str, value: Any) -> str:
    if key in _SHARE_KEYS:
        return share(value)
    return number(value)


def _inline(value: Any) -> str:
    """A dict or list rendered onto one line of a two-column table."""
    if value is None:
        return _EM_DASH
    if isinstance(value, dict):
        return ", ".join(f"{key} {_scalar(key, item)}" for key, item in value.items())
    if isinstance(value, list):
        return ", ".join(str(item) for item in value[:8])
    return number(value)


def summary_blocks(label: str, name: str, value: Any) -> tuple[list[str] | None, list[Block]]:
    """One summary, as a table row and any extra blocks it needs.

    Returns ``(row, extra)``. ``row`` is None for summaries whose whole
    content is a table of its own -- level breakdowns and token counts,
    which do not fit in a cell.
    """
    if value is None:
        return [label, _EM_DASH], []

    # ``levels`` is a list of {value, count} for the breakdown summaries and
    # a plain count for the tail and singleton ones. The type is the
    # discriminator; keying on the name alone would silently mis-render the
    # day someone adds a third meaning.
    if isinstance(value, dict) and isinstance(value.get("levels"), list):
        rows = [
            [str(level.get("value")), number(level.get("count")), share(level.get("share"))]
            if "share" in level
            else [str(level.get("value")), number(level.get("count")), ""]
            for level in value["levels"]
        ]
        total = value.get("total_levels")
        caption = f"{label}: showing {value.get('shown', len(rows))} of {number(total)} levels" \
            if total else label
        return None, [Table(["Value", "Rows", "Share"], rows, caption=caption)]

    # ``the_value`` carries its own explanation, which the narration above
    # the table already prints. Repeating it in a cell says the same thing
    # twice in six lines.
    if name == "the_value" and isinstance(value, dict):
        held = value.get("value")
        if held is None:
            return [label, _EM_DASH], []
        rows = value.get("rows")
        text = f"`{held}`" + (f" in {number(rows)} rows" if rows else "")
        return [label, text], []

    if isinstance(value, dict) and isinstance(value.get("tokens"), list):
        rows = [[str(item["token"]), number(item["count"])] for item in value["tokens"]]
        caption = f"{label}: {number(value.get('distinct'))} distinct tokens"
        return None, [Table(["Token", "Occurrences"], rows, caption=caption)]

    if isinstance(value, dict):
        return [label, _inline(value)], []

    return [label, _scalar(name, value)], []


# --------------------------------------------------------------------------
# Prose
# --------------------------------------------------------------------------


def _sentence(text: str) -> str:
    """Capitalise the first letter and nothing else.

    ``str.capitalize`` lowercases the remainder, which turns "Pearson and
    Spearman … Cramer's V" into "Pearson and spearman … cramer's v" —
    every proper noun in the registry's notes, quietly wrong.
    """
    text = text.strip()
    if not text:
        return ""
    text = text[0].upper() + text[1:]
    return text if text.endswith((".", "!", "?")) else text + "."


def narrate(column: Any, profile: ColumnProfile) -> str:
    """One or two sentences about a column, from its own numbers.

    Templates, not generation. The sentences say only what was measured;
    nothing here concludes anything about cause, and that restraint is
    the product decision, not a limitation.
    """
    kind = profile.type
    s = profile.summaries
    parts: list[str] = []
    nulls = s.get("nulls") or {}
    null_share = nulls.get("share", 0.0) if isinstance(nulls, dict) else 0.0

    if kind == "numeric_continuous":
        mean, median = s.get("mean"), s.get("median")
        if mean is not None and median is not None:
            parts.append(f"Values centre on {number(median)} (mean {number(mean)}).")
        skew = s.get("skew")
        if isinstance(skew, dict) and skew.get("verdict"):
            parts.append(f"The distribution is {skew['verdict']}.")
        outliers = s.get("outliers")
        if isinstance(outliers, dict) and outliers.get("count"):
            parts.append(
                f"{number(outliers['count'])} values ({share(outliers['share'])}) fall outside "
                f"the {outliers['rule']}."
            )
    elif kind == "numeric_discrete":
        card = s.get("cardinality")
        if isinstance(card, dict):
            parts.append(f"{number(card.get('distinct'))} distinct whole-number levels.")
        parts.append("Treated as codes rather than a quantity, so no mean is reported.")
    elif kind == "boolean":
        rate = s.get("true_rate")
        if rate is not None:
            parts.append(f"True in {share(rate)} of non-null rows.")
    elif kind in {"categorical_low", "categorical_high"}:
        card = s.get("cardinality")
        if isinstance(card, dict):
            parts.append(f"{number(card.get('distinct'))} levels.")
        coverage = s.get("top_coverage")
        if isinstance(coverage, dict):
            parts.append(
                f"The top {number(coverage.get('top_n'))} cover {share(coverage.get('share'))} "
                "of rows."
            )
        tail = s.get("tail_size")
        if isinstance(tail, dict) and tail.get("levels"):
            parts.append(
                f"The tail holds {number(tail['levels'])} further levels "
                f"({share(tail.get('share'))} of rows)."
            )
    elif kind == "datetime":
        span = s.get("time_range")
        if isinstance(span, dict):
            parts.append(f"Runs from {span.get('min')} to {span.get('max')}.")
        freq = s.get("frequency")
        if isinstance(freq, dict):
            parts.append(
                f"The typical step is one {freq.get('modal_step')} and the series is "
                f"{freq.get('verdict')}."
            )
        gaps = s.get("gaps")
        if isinstance(gaps, dict) and gaps.get("count"):
            parts.append(f"{number(gaps['count'])} gaps of more than three typical steps.")
    elif kind == "free_text":
        lengths = s.get("length_stats")
        if isinstance(lengths, dict):
            parts.append(
                f"Values run {number(lengths.get('min'))} to {number(lengths.get('max'))} "
                f"characters, median {number(lengths.get('median'))}."
            )
        unique = s.get("uniqueness")
        if unique is not None:
            parts.append(f"{share(unique)} of values are distinct.")
    elif kind == "identifier":
        dupes = s.get("duplicates")
        if isinstance(dupes, dict):
            parts.append(
                "Every value is distinct." if not dupes.get("rows")
                else f"{number(dupes['rows'])} rows repeat a value that appears elsewhere."
            )
        shape = s.get("format_consistency")
        if isinstance(shape, dict):
            parts.append(
                f"Format is {shape.get('verdict')} ({number(shape.get('patterns'))} pattern(s), "
                f"dominant `{shape.get('dominant')}`)."
            )
    elif kind in {"constant", "empty", "unsupported"}:
        value = s.get("the_value")
        if isinstance(value, dict) and value.get("note"):
            parts.append(_sentence(str(value["note"])))

    if null_share:
        parts.append(f"{share(null_share)} of rows are null.")

    if column is not None and getattr(column, "verdict", None) is not None:
        verdict = column.verdict
        if verdict.overridden:
            parts.append(f"Type set by the user ({TYPE_LABELS.get(verdict.type, verdict.type)}).")
        elif verdict.confidence < CONFIDENCE_FLOOR:
            parts.append(
                f"Read as {TYPE_LABELS.get(kind, kind)} with low confidence "
                f"({verdict.confidence:.2f}) {_EM_DASH} {verdict.reason}."
            )
    return " ".join(part for part in parts if part).strip()


# --------------------------------------------------------------------------
# Building
# --------------------------------------------------------------------------


@dataclass
class ReportInput:
    """Everything a report is made of. One object so the signature does
    not grow a new positional argument every time the report learns a
    section."""

    description: DatasetDescription
    recipe: Any
    profiles: dict[str, ColumnProfile]
    figures: dict[str, list[PlotResult]]
    relations: list[RelationResult] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    failures: dict[str, str] = field(default_factory=dict)
    tool_version: str = ""
    dependency_versions: dict[str, str] = field(default_factory=dict)
    generated_at: str = ""
    duration_seconds: float | None = None


def build(data: ReportInput) -> Document:
    """The whole report, as blocks."""
    description = data.description
    recipe = data.recipe
    stamp = data.generated_at or datetime.now(timezone.utc).astimezone().isoformat(
        timespec="seconds"
    )

    doc = Document(title=f"Profile of {description.path.name}")
    doc.add(Heading(1, doc.title))

    facts = [
        ["Source", f"`{description.path}`"],
        ["Rows", number(description.rows)],
        ["Columns", number(description.n_columns)],
        ["Generated", stamp],
        ["Tool", f"thl eda {data.tool_version}"],
    ]
    if data.dependency_versions:
        facts.append(
            ["Dependencies",
             ", ".join(f"{k} {v}" for k, v in sorted(data.dependency_versions.items()))]
        )
    if data.duration_seconds is not None:
        facts.append(["Run time", f"{data.duration_seconds:.1f}s"])
    if recipe is not None and recipe.target:
        facts.append(["Target", f"`{recipe.target}`"])
    doc.add(Table(["", ""], facts))

    # -- sampling banner ------------------------------------------------
    if description.sampling.applied:
        doc.add(
            Callout(
                "warning",
                "This report was built from a sample",
                [
                    f"Figures use {number(description.sampling.n)} of "
                    f"{number(description.sampling.of)} rows, drawn with seed "
                    f"{description.sampling.seed}.",
                    f"Reason: {description.sampling.reason}.",
                    "Counts, null counts, minimum, maximum and cardinality were computed "
                    "over every row and are exact. Everything else is a sample statistic.",
                ],
            )
        )

    # -- caveats --------------------------------------------------------
    caveats = _caveats(data)
    if caveats:
        doc.add(Heading(2, "Caveats", anchor="caveats"))
        doc.add(
            Para(
                "Read these before quoting anything below. They are the places where the "
                "tool is least sure of itself."
            )
        )
        doc.add(Bullets(caveats))

    # -- overview -------------------------------------------------------
    doc.add(Heading(2, "Dataset overview", anchor="overview"))
    doc.add(Table(*_overview_table(data)))

    grouped = description.by_type()
    if grouped:
        doc.add(
            Para(
                "Columns by inferred type: "
                + ", ".join(
                    f"{TYPE_LABELS.get(kind, kind)} ({len(names)})"
                    for kind, names in grouped.items()
                )
                + "."
            )
        )

    # -- per column -----------------------------------------------------
    doc.add(Heading(2, "Columns", anchor="columns"))
    for column in description.columns:
        _column_section(doc, data, column)

    # -- tier 2 ---------------------------------------------------------
    if data.relations:
        doc.add(Heading(2, "Relationships", anchor="relationships"))
        for relation in data.relations:
            _relation_section(doc, relation, recipe)

    # -- appendix -------------------------------------------------------
    doc.add(Heading(2, "Appendix: the recipe", anchor="recipe"))
    doc.add(
        Para(
            "Every decision above, as JSON. Save it and pass `--recipe` to reproduce this "
            "report on new data, or edit it and rerun."
        )
    )
    if recipe is not None:
        doc.add(Code(recipe.dumps().rstrip(), lang="json"))
    return doc


def _caveats(data: ReportInput) -> list[str]:
    items: list[str] = []
    for column in data.description.columns:
        verdict = column.verdict
        if verdict.low_confidence:
            items.append(
                f"**{column.name}** was read as *{TYPE_LABELS.get(verdict.type, verdict.type)}* "
                f"with confidence {verdict.confidence:.2f} {_EM_DASH} {verdict.reason}. "
                f"Override with `--types {column.name}=<type>`."
            )
    for column, message in data.failures.items():
        items.append(f"**{column}** failed and was skipped: {message}")
    unsupported = [c.name for c in data.description.columns if c.verdict.type == "unsupported"]
    if unsupported:
        items.append(
            "Reported but not charted (unsupported content): "
            + ", ".join(f"`{name}`" for name in unsupported)
            + "."
        )
    seen = set(items)
    for warning in data.warnings:
        line = str(warning)
        # Low-confidence warnings are already above in a fuller form.
        if "low confidence" in line or line in seen:
            continue
        seen.add(line)
        items.append(line)
    return items


def _overview_table(data: ReportInput) -> tuple[list[str], list[list[str]]]:
    headers = ["Column", "Type", "Confidence", "Non-null", "Null", "Distinct", "Example values"]
    rows: list[list[str]] = []
    for column in data.description.columns:
        verdict = column.verdict
        mark = "" if verdict.overridden or verdict.confidence >= CONFIDENCE_FLOOR else " ⚠"
        rows.append(
            [
                f"`{column.name}`",
                TYPE_LABELS.get(verdict.type, verdict.type),
                f"{verdict.confidence:.2f}{mark}" + (" (set)" if verdict.overridden else ""),
                number(column.count),
                f"{number(column.nulls)} ({share(column.null_rate)})",
                number(column.n_unique),
                ", ".join(f"`{v}`" for v in column.preview) or _EM_DASH,
            ]
        )
    return headers, rows


def _column_section(doc: Document, data: ReportInput, column: Any) -> None:
    from . import registry  # noqa: PLC0415 - only needed for labels

    name = column.name
    profile = data.profiles.get(name)
    doc.add(Heading(3, name, anchor=f"col-{name}"))

    verdict = column.verdict
    meta = [
        f"`{TYPE_LABELS.get(verdict.type, verdict.type)}`",
        f"confidence {verdict.confidence:.2f}"
        + (" (set by the user)" if verdict.overridden else ""),
        f"{number(column.count)} non-null",
        f"{number(column.nulls)} null ({share(column.null_rate)})",
        f"{number(column.n_unique)} distinct",
    ]
    doc.add(Para(" · ".join(meta)))

    if name in data.failures:
        doc.add(Callout("warning", "This column failed", [data.failures[name]]))
        return

    if profile is None:
        doc.add(Para("_Not selected for profiling._"))
        return

    story = narrate(column, profile)
    if story:
        doc.add(Para(story))

    rows: list[list[str]] = []
    extras: list[Block] = []
    for summary_name, value in profile.summaries.items():
        try:
            label = registry.summary(summary_name).label
        except Exception:  # noqa: BLE001 - a recipe may name a summary this build renamed
            label = summary_name
        row, extra = summary_blocks(label, summary_name, value)
        if row is not None:
            rows.append(row)
        extras.extend(extra)

    if rows:
        doc.add(Table(["Statistic", "Value"], rows))
    for block in extras:
        doc.add(block)

    for failed_name, message in profile.failed.items():
        doc.add(Callout("warning", f"{failed_name} could not be computed", [message]))

    for figure in data.figures.get(name, []):
        doc.add(
            Figure(
                path=figure.path,
                alt=figure.title or f"{name} {figure.chart}",
                caption=figure.caption,
            )
        )


def _relation_section(doc: Document, relation: RelationResult, recipe: Any) -> None:
    from . import registry  # noqa: PLC0415 - only needed for labels

    try:
        spec = registry.relation(relation.kind)
        title, note = spec.label, spec.note
    except Exception:  # noqa: BLE001 - unknown kinds still render, just unlabelled
        title, note = relation.kind, ""

    doc.add(Heading(3, title, anchor=f"rel-{relation.kind}"))
    if note:
        doc.add(Para(_sentence(note)))

    handler = {
        "correlation": _correlation_body,
        "missingness": _missingness_body,
        "duplicates": _duplicates_body,
        "target": _target_body,
    }.get(relation.kind)
    if handler:
        handler(doc, relation, recipe)

    for warning in relation.warnings:
        doc.add(Callout("note", "Not computed", [warning]))
    for figure in relation.figures:
        doc.add(Figure(path=figure.path, alt=figure.title or relation.kind,
                       caption=figure.caption))


def _correlation_body(doc: Document, relation: RelationResult, recipe: Any) -> None:
    for key, label in (
        ("pearson_top", "Pearson (linear)"),
        ("spearman_top", "Spearman (monotonic)"),
        ("cramers_v_top", "Cramer's V (categorical)"),
    ):
        pairs = relation.data.get(key) or []
        if not pairs:
            continue
        doc.add(
            Table(
                ["Column", "Column", label],
                [[f"`{p['a']}`", f"`{p['b']}`", number(p["value"])] for p in pairs],
                caption=f"Strongest {label} associations",
            )
        )
    if not any(relation.data.get(key) for key in
               ("pearson_top", "spearman_top", "cramers_v_top")):
        doc.add(Para("No pair passed the reporting threshold. The full matrices are in "
                     "`summary.json` and in the figures below."))


def _missingness_body(doc: Document, relation: RelationResult, recipe: Any) -> None:
    data = relation.data
    rows = [row for row in data.get("per_column", []) if row["nulls"]]
    complete = data.get("complete_rows", 0)
    total = data.get("rows", 0)
    doc.add(
        Para(
            f"{number(complete)} of {number(total)} rows "
            f"({share(complete / total if total else 0)}) "
            f"have no missing value anywhere. {number(len(rows))} column(s) have at least one null."
        )
    )
    if rows:
        doc.add(
            Table(
                ["Column", "Nulls", "Share"],
                [[f"`{r['column']}`", number(r["nulls"]), share(r["share"])] for r in rows[:40]],
                caption="Columns with missing values, worst first",
            )
        )


def _duplicates_body(doc: Document, relation: RelationResult, recipe: Any) -> None:
    data = relation.data
    doc.add(
        Table(
            ["Statistic", "Value"],
            [
                ["Rows compared", number(data.get("rows"))],
                ["Exact duplicate rows", f"{number(data.get('exact'))} "
                                        f"({share(data.get('exact_share'))})"],
                ["Near-duplicate rows", f"{number(data.get('near'))} "
                                        f"({share(data.get('near_share'))})"],
                ["Near rule", str(data.get("near_rule", ""))],
            ],
        )
    )
    if data.get("exact"):
        doc.add(
            Para(
                "Exact duplicates are rows identical in every compared column. Whether that is "
                "a defect depends on whether the table is supposed to have a key."
            )
        )


def _target_body(doc: Document, relation: RelationResult, recipe: Any) -> None:
    data = relation.data
    overview = data.get("overview") or {}
    if overview.get("kind") == "categorical":
        doc.add(
            Table(
                ["Level", "Rows", "Share"],
                [[str(level["value"]), number(level["count"]), share(level["share"])]
                 for level in overview.get("levels", [])],
                caption=f"Target `{overview.get('column')}` distribution",
            )
        )
        imbalance = overview.get("imbalance", 0.0)
        if imbalance >= 0.9:
            doc.add(
                Callout(
                    "warning",
                    "The target is heavily imbalanced",
                    [f"The largest class covers {share(imbalance)} of rows. Accuracy on a "
                     "target like this is not a useful measure."],
                )
            )
    elif overview.get("kind") == "numeric":
        doc.add(
            Table(
                ["Statistic", "Value"],
                [[key.title(), number(overview.get(key))]
                 for key in ("mean", "median", "min", "max", "nulls")],
                caption=f"Target `{overview.get('column')}`",
            )
        )

    ranked = data.get("mutual_information") or []
    if ranked:
        doc.add(
            Table(
                ["Feature", "Mutual information (bits)", "Normalised"],
                [[f"`{row['column']}`", number(row["bits"]), share(row["normalised"])]
                 for row in ranked[:25]],
                caption="Features ranked against the target",
            )
        )
        doc.add(Para(str(data.get("mutual_information_note", ""))))


# --------------------------------------------------------------------------
# Markdown
# --------------------------------------------------------------------------


def render_markdown(doc: Document, base: Path) -> str:
    out: list[str] = []
    for block in doc.blocks:
        out.append(_md_block(block, base))
    return "\n\n".join(part for part in out if part).rstrip() + "\n"


def _md_block(block: Block, base: Path) -> str:
    if isinstance(block, Heading):
        return f"{'#' * block.level} {block.text}"
    if isinstance(block, Para):
        return block.text
    if isinstance(block, Bullets):
        return "\n".join(f"- {item}" for item in block.items)
    if isinstance(block, Table):
        return _md_table(block)
    if isinstance(block, Figure):
        rel = _relative(block.path, base)
        line = f"![{_md_escape(block.alt)}]({rel})"
        if block.caption:
            line += f"\n\n*{block.caption}*"
        return line
    if isinstance(block, Callout):
        marker = "⚠️" if block.kind == "warning" else "ℹ️"
        body = "\n".join(f"> {line}" for line in block.lines)
        return f"> {marker} **{block.title}**\n>\n{body}"
    if isinstance(block, Code):
        return f"```{block.lang}\n{block.text}\n```"
    if isinstance(block, Divider):
        return "---"
    return ""  # pragma: no cover - the union above is closed


def _md_table(block: Table) -> str:
    headers = [_md_escape(h) for h in block.headers]
    lines = ["| " + " | ".join(headers) + " |"]
    lines.append("|" + "|".join(["---"] * len(headers)) + "|")
    for row in block.rows:
        cells = [_md_escape(str(cell)) for cell in row]
        cells += [""] * (len(headers) - len(cells))
        lines.append("| " + " | ".join(cells) + " |")
    table = "\n".join(lines)
    return f"{table}\n\n*{block.caption}*" if block.caption else table


def _md_escape(text: str) -> str:
    """Escape only what breaks a table cell.

    A pipe inside a value ends the cell and shifts every column after it,
    which turns one odd category name into a table that reads wrong all
    the way down.
    """
    return str(text).replace("|", "\\|").replace("\n", " ")


def _relative(path: Path, base: Path) -> str:
    try:
        return path.relative_to(base).as_posix()
    except ValueError:
        return path.as_posix()


# --------------------------------------------------------------------------
# HTML
# --------------------------------------------------------------------------

_CSS = """
:root { color-scheme: light dark; --fg:#1f2933; --muted:#6b7280; --bg:#ffffff;
        --line:#e5e7eb; --accent:#3d5a80; --warn-bg:#fff7ed; --warn-line:#ee6c4d;
        --note-bg:#f1f5f9; --code-bg:#f8fafc; }
@media (prefers-color-scheme: dark) {
  :root { --fg:#e5e7eb; --muted:#9ca3af; --bg:#111827; --line:#374151;
          --accent:#98c1d9; --warn-bg:#2b1c12; --warn-line:#ee6c4d;
          --note-bg:#1f2937; --code-bg:#0b1220; }
}
* { box-sizing: border-box; }
body { margin:0; padding:2rem 1.25rem 4rem; background:var(--bg); color:var(--fg);
       font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,
            Helvetica,Arial,sans-serif; }
main { max-width: 60rem; margin: 0 auto; }
h1 { font-size:1.9rem; margin:0 0 1.5rem; letter-spacing:-0.01em; }
h2 { font-size:1.35rem; margin:2.75rem 0 0.9rem; padding-bottom:.4rem;
     border-bottom:1px solid var(--line); }
h3 { font-size:1.08rem; margin:2rem 0 .5rem;
     font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
p { margin:.65rem 0; }
code { background:var(--code-bg); padding:.1rem .32rem; border-radius:3px;
       font:0.88em ui-monospace,SFMono-Regular,Menlo,monospace; }
pre { background:var(--code-bg); border:1px solid var(--line); border-radius:6px;
      padding:1rem; overflow-x:auto; }
pre code { background:none; padding:0; }
.table-wrap { overflow-x:auto; margin:.9rem 0; }
table { border-collapse:collapse; width:100%; font-size:.9rem; }
th,td { text-align:left; padding:.45rem .7rem; border-bottom:1px solid var(--line);
        vertical-align:top; white-space:nowrap; }
th { font-weight:600; color:var(--muted); font-size:.8rem; text-transform:uppercase;
     letter-spacing:.04em; }
figure { margin:1.2rem 0; }
figure img { max-width:100%; height:auto; border:1px solid var(--line); border-radius:6px;
             background:#fff; }
figcaption { color:var(--muted); font-size:.8rem; margin-top:.4rem; }
.callout { border-left:3px solid var(--warn-line); background:var(--warn-bg);
           padding:.8rem 1rem; border-radius:0 6px 6px 0; margin:1rem 0; }
.callout.note { border-left-color:var(--accent); background:var(--note-bg); }
.callout p { margin:.3rem 0; }
.callout strong { display:block; margin-bottom:.25rem; }
.caption { color:var(--muted); font-size:.82rem; margin:.3rem 0 1rem; }
ul { padding-left:1.2rem; }
li { margin:.3rem 0; }
"""


def render_html(doc: Document, base: Path, *, self_contained: bool = False) -> str:
    body = "\n".join(_html_block(block, base, self_contained) for block in doc.blocks)
    return (
        "<!doctype html>\n"
        '<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        f"<title>{html.escape(doc.title)}</title>\n"
        f"<style>{_CSS}</style>\n</head>\n<body>\n<main>\n{body}\n</main>\n</body>\n</html>\n"
    )


def _html_block(block: Block, base: Path, inline_images: bool) -> str:
    if isinstance(block, Heading):
        anchor = f' id="{html.escape(block.anchor)}"' if block.anchor else ""
        return f"<h{block.level}{anchor}>{_html_inline(block.text)}</h{block.level}>"
    if isinstance(block, Para):
        return f"<p>{_html_inline(block.text)}</p>"
    if isinstance(block, Bullets):
        items = "".join(f"<li>{_html_inline(item)}</li>" for item in block.items)
        return f"<ul>{items}</ul>"
    if isinstance(block, Table):
        head = "".join(f"<th>{_html_inline(h)}</th>" for h in block.headers)
        rows = "".join(
            "<tr>" + "".join(f"<td>{_html_inline(str(cell))}</td>" for cell in row) + "</tr>"
            for row in block.rows
        )
        caption = f'<p class="caption">{_html_inline(block.caption)}</p>' if block.caption else ""
        head_html = f"<thead><tr>{head}</tr></thead>" if any(block.headers) else ""
        return (
            f'<div class="table-wrap"><table>{head_html}<tbody>{rows}</tbody></table>'
            f'</div>{caption}'
        )
    if isinstance(block, Figure):
        src = _data_uri(block.path) if inline_images else _relative(block.path, base)
        caption = f"<figcaption>{html.escape(block.caption)}</figcaption>" if block.caption else ""
        return (
            f'<figure><img src="{src}" alt="{html.escape(block.alt)}" loading="lazy">'
            f"{caption}</figure>"
        )
    if isinstance(block, Callout):
        lines = "".join(f"<p>{_html_inline(line)}</p>" for line in block.lines)
        css = "callout" if block.kind == "warning" else "callout note"
        return f'<div class="{css}"><strong>{html.escape(block.title)}</strong>{lines}</div>'
    if isinstance(block, Code):
        return f'<pre><code>{html.escape(block.text)}</code></pre>'
    if isinstance(block, Divider):
        return "<hr>"
    return ""  # pragma: no cover - the union above is closed


def _html_inline(text: str) -> str:
    """Escape, then honour the two bits of Markdown the builders emit.

    The document model carries `code` and **bold** in its strings because
    Markdown is the primary target. Rather than a second string per
    renderer, the HTML side converts those two after escaping -- which is
    safe precisely because escaping already happened.
    """
    escaped = html.escape(str(text))
    out: list[str] = []
    for index, part in enumerate(escaped.split("`")):
        out.append(f"<code>{part}</code>" if index % 2 else part)
    joined = "".join(out)
    pieces = joined.split("**")
    if len(pieces) > 2:
        joined = "".join(
            f"<strong>{part}</strong>" if index % 2 else part for index, part in enumerate(pieces)
        )
    return joined


def _data_uri(path: Path) -> str:
    suffix = path.suffix.lower().lstrip(".")
    mime = {"png": "image/png", "svg": "image/svg+xml", "jpg": "image/jpeg",
            "jpeg": "image/jpeg", "webp": "image/webp"}.get(suffix, "application/octet-stream")
    try:
        payload = base64.b64encode(path.read_bytes()).decode("ascii")
    except OSError:
        return ""
    return f"data:{mime};base64,{payload}"


# --------------------------------------------------------------------------
# summary.json
# --------------------------------------------------------------------------


def summary_json(data: ReportInput) -> dict[str, Any]:
    """The machine-readable twin of the report.

    This is the artefact ``analysis.py`` has to reproduce byte for byte,
    so it holds numbers and nothing else -- no timestamps, no paths that
    move, no durations. Everything here is a function of the data and the
    recipe, which is the only way the comparison can be meaningful.
    """
    description = data.description
    return {
        "tool": "thl eda",
        "version": data.tool_version,
        "source": {
            "name": description.path.name,
            "rows": description.rows,
            "columns": description.n_columns,
        },
        "sampling": description.sampling.to_json(),
        "columns": {
            name: {
                "type": profile.type,
                "confidence": round(profile.confidence, 4),
                "summaries": profile.summaries,
            }
            for name, profile in data.profiles.items()
        },
        "tier2": {relation.kind: relation.data for relation in data.relations},
    }


def dump_summary(data: ReportInput, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(summary_json(data), indent=2, ensure_ascii=False, sort_keys=False,
                   default=str) + "\n",
        encoding="utf-8",
    )
    return path


def index_document(
    entries: list[tuple[str, Path, int, int, list[str]]],
    *,
    root: Path,
    tool_version: str = "",
    generated_at: str = "",
) -> Document:
    """The folder-mode index: one row per dataset, linking its report."""
    doc = Document(title=f"Profiles in {root.name or root}")
    doc.add(Heading(1, doc.title))
    doc.add(
        Table(
            ["", ""],
            [
                ["Datasets", number(len(entries))],
                ["Generated", generated_at or datetime.now(timezone.utc).astimezone().isoformat(
                    timespec="seconds")],
                ["Tool", f"thl eda {tool_version}"],
            ],
        )
    )
    rows = []
    for label, report_path, rows_count, columns_count, notes in entries:
        # A file that failed has no report to link to. Linking it anyway
        # gives the reader a dead link where they expected a diagnosis.
        failed = any(note.startswith("failed") for note in notes)
        name = label if failed else f"[{label}]({_relative(report_path, root)})"
        rows.append(
            [
                name,
                number(rows_count) if not failed else _EM_DASH,
                number(columns_count) if not failed else _EM_DASH,
                "; ".join(notes) if notes else "ok",
            ]
        )
    doc.add(Table(["Dataset", "Rows", "Columns", "Notes"], rows))
    return doc
