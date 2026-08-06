"""The recipe: every decision a run made, written down.

This is the seam the whole design turns on. The interactive session's
only job is to produce one of these; ``eda_report`` consumes one; the
generated ``analysis.py`` embeds one. A future browser front-end, a CI
job and the auto-analytics pipeline all reach the same code path because
they all reach it through here.

Two properties are worth defending:

**A recipe is complete.** Nothing is left to be re-inferred at replay
time. Column types, the datetime format each was read with, the sampling
seed, the top-N cutoff -- all of it is written down, because a replay
that re-infers is a replay that can disagree with the report it is
supposed to reproduce.

**A recipe is readable.** It is JSON a person can edit in a text editor
and check into a repository, which is what makes "a team standard is a
recipe in a repo" a real workflow rather than a slogan.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import registry
from .errors import InvalidRecipe
from .types import INERT_TYPES, DatasetDescription, is_valid_type

#: Bumped only when an old recipe would replay differently under the new
#: code. That is the only question the number answers.
RECIPE_VERSION = "1.0"

#: Hashing a 4 GB source to record a fingerprint costs a full read for no
#: analytical benefit. Past this, the digest covers the first slice plus
#: the file size and says so, which still catches "somebody swapped the
#: file" without reading the file twice.
DIGEST_LIMIT = 64 * 1024 * 1024


@dataclass
class ColumnPlan:
    """What to do with one column."""

    name: str
    type: str
    confidence: float = 1.0
    overridden: bool = False
    inferred: str | None = None
    selected: bool = True
    reason: str = ""
    charts: list[str] = field(default_factory=list)
    summaries: list[str] = field(default_factory=list)
    meta: dict[str, Any] = field(default_factory=dict)

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "type": self.type,
            "confidence": round(float(self.confidence), 4),
            "overridden": bool(self.overridden),
            "selected": bool(self.selected),
            "charts": list(self.charts),
            "summaries": list(self.summaries),
        }
        if self.inferred and self.inferred != self.type:
            out["inferred"] = self.inferred
        if self.reason:
            out["reason"] = self.reason
        if self.meta:
            out["meta"] = dict(self.meta)
        return out

    @classmethod
    def from_json(cls, name: str, data: dict[str, Any]) -> ColumnPlan:
        if not isinstance(data, dict):
            raise InvalidRecipe(f"columns.{name} must be an object, not {type(data).__name__}.")
        kind = data.get("type")
        if not is_valid_type(str(kind)):
            raise InvalidRecipe(f"columns.{name}.type is {kind!r}, which is not a column type.")
        return cls(
            name=name,
            type=str(kind),
            confidence=float(data.get("confidence", 1.0)),
            overridden=bool(data.get("overridden", False)),
            inferred=data.get("inferred"),
            selected=bool(data.get("selected", True)),
            reason=str(data.get("reason", "")),
            charts=[str(c) for c in data.get("charts") or []],
            summaries=[str(s) for s in data.get("summaries") or []],
            meta=dict(data.get("meta") or {}),
        )


@dataclass
class Recipe:
    """One run, fully specified."""

    source: dict[str, Any] = field(default_factory=dict)
    load: dict[str, Any] = field(default_factory=dict)
    sampling: dict[str, Any] = field(default_factory=lambda: {"applied": False})
    columns: dict[str, ColumnPlan] = field(default_factory=dict)
    tier2: dict[str, Any] = field(default_factory=lambda: {"kinds": [], "target": None})
    output: dict[str, Any] = field(default_factory=dict)
    options: dict[str, Any] = field(default_factory=lambda: dict(registry.DEFAULT_OPTIONS))
    version: str = RECIPE_VERSION
    tool_version: str = ""

    # -- accessors ------------------------------------------------------

    @property
    def target(self) -> str | None:
        value = self.tier2.get("target")
        return str(value) if value else None

    @property
    def tier2_kinds(self) -> list[str]:
        return [str(k) for k in self.tier2.get("kinds") or []]

    def selected(self) -> list[ColumnPlan]:
        """Columns that will be profiled, in file order."""
        return [plan for plan in self.columns.values() if plan.selected]

    def types(self) -> dict[str, str]:
        return {name: plan.type for name, plan in self.columns.items()}

    def figure_count(self) -> int:
        """How many figures this recipe will produce. Used by the plan screen."""
        total = sum(len(plan.charts) for plan in self.selected())
        for kind in self.tier2_kinds:
            total += _TIER2_FIGURES.get(kind, 0)
        return total

    def summary_count(self) -> int:
        return sum(len(plan.summaries) for plan in self.selected())

    # -- serialisation --------------------------------------------------

    def to_json(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "tool_version": self.tool_version,
            "source": dict(self.source),
            "load": dict(self.load),
            "sampling": dict(self.sampling),
            "options": dict(self.options),
            "columns": {name: plan.to_json() for name, plan in self.columns.items()},
            "tier2": dict(self.tier2),
            "output": dict(self.output),
        }

    def dumps(self) -> str:
        return json.dumps(self.to_json(), indent=2, ensure_ascii=False, default=str) + "\n"

    def save(self, path: str | Path) -> Path:
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(self.dumps(), encoding="utf-8")
        return target

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> Recipe:
        if not isinstance(data, dict):
            raise InvalidRecipe("A recipe must be a JSON object.")
        version = str(data.get("version", RECIPE_VERSION))
        if version.split(".")[0] != RECIPE_VERSION.split(".")[0]:
            raise InvalidRecipe(
                f"This recipe is version {version}; this build reads {RECIPE_VERSION}."
            )
        columns_raw = data.get("columns") or {}
        if not isinstance(columns_raw, dict):
            raise InvalidRecipe("recipe.columns must be an object keyed by column name.")

        recipe = cls(
            source=dict(data.get("source") or {}),
            load=dict(data.get("load") or {}),
            sampling=dict(data.get("sampling") or {"applied": False}),
            columns={
                str(name): ColumnPlan.from_json(str(name), value)
                for name, value in columns_raw.items()
            },
            tier2=_read_tier2(data.get("tier2")),
            output=dict(data.get("output") or {}),
            options={**registry.DEFAULT_OPTIONS, **(data.get("options") or {})},
            version=version,
            tool_version=str(data.get("tool_version", "")),
        )
        recipe.validate()
        return recipe

    @classmethod
    def from_file(cls, path: str | Path) -> Recipe:
        """Read a recipe from disk.

        Named ``from_file`` and not ``load`` because ``load`` is already a
        *field* on this dataclass -- the read options. Defining both meant
        the classmethod overwrote the field's default factory in the class
        body, so ``Recipe()`` came back with a bound method where a dict
        belonged. It survived every test because every construction path
        happened to pass ``load=``; ruff's F811 is what actually caught it.
        """
        source = Path(path)
        try:
            text = source.read_text(encoding="utf-8")
        except OSError as err:
            raise InvalidRecipe(f"Could not read the recipe at {source}: {err}") from err
        try:
            data = json.loads(text)
        except json.JSONDecodeError as err:
            raise InvalidRecipe(f"{source} is not valid JSON: {err}") from err
        return cls.from_json(data)

    # -- validation -----------------------------------------------------

    def validate(self) -> Recipe:
        """Check the whole recipe and report every problem at once.

        Same posture as the parent package's argument validator: someone
        fixing a hand-edited recipe should not have to discover its
        mistakes one run at a time.
        """
        problems: list[str] = []

        for name, plan in self.columns.items():
            for chart in plan.charts:
                try:
                    registry.chart(chart, plan.type)
                except Exception as err:  # noqa: BLE001 - collected, then raised together
                    problems.append(f"{name}: {err}")
            for summary in plan.summaries:
                try:
                    registry.summary(summary, plan.type)
                except Exception as err:  # noqa: BLE001 - collected, then raised together
                    problems.append(f"{name}: {err}")

        for kind in self.tier2_kinds:
            try:
                registry.relation(kind)
            except Exception as err:  # noqa: BLE001 - collected, then raised together
                problems.append(str(err))

        rule = self.options.get("outlier_rule", "iqr")
        if rule not in registry.OUTLIER_RULES:
            problems.append(
                f"options.outlier_rule is {rule!r}; one of {', '.join(registry.OUTLIER_RULES)}."
            )

        top_n = self.options.get("top_n", 15)
        if not isinstance(top_n, int) or isinstance(top_n, bool) or top_n < 1:
            problems.append(f"options.top_n must be a positive whole number; got {top_n!r}.")

        fmt = self.output.get("format", "md")
        if fmt not in ("md", "html"):
            problems.append(f"output.format is {fmt!r}; expected md or html.")

        target = self.target
        if target and target not in self.columns:
            problems.append(f"tier2.target is {target!r}, which is not one of the columns.")

        if problems:
            raise InvalidRecipe(" ".join(problems))
        return self


def _read_tier2(value: Any) -> dict[str, Any]:
    """Accept the shipped shape and the PRD's illustrative one.

    The document sketches ``{"correlation": [...], "missingness": true}``;
    what the CLI actually selects is a list of kinds, matching
    ``--tier2 corr,missing``. Reading both costs six lines and means a
    recipe hand-written from the PRD still loads.
    """
    if not value:
        return {"kinds": [], "target": None}
    if not isinstance(value, dict):
        raise InvalidRecipe("recipe.tier2 must be an object.")
    if "kinds" in value:
        kinds = [str(k) for k in value.get("kinds") or []]
    else:
        kinds = [
            name
            for name in registry.relation_names()
            if value.get(name) or (name == "target" and value.get("target"))
        ]
    target = value.get("target")
    return {"kinds": kinds, "target": str(target) if target else None}


#: Figures each Tier 2 kind produces, for the pre-run plan. Approximate
#: for ``target`` -- it draws one panel per ranked feature, up to six --
#: and the plan screen says "up to" for that reason.
_TIER2_FIGURES = {"correlation": 3, "missingness": 2, "duplicates": 0, "target": 7}


# --------------------------------------------------------------------------
# Building one from a description
# --------------------------------------------------------------------------


def build(
    description: DatasetDescription,
    *,
    columns: list[str] | None = None,
    exclude: list[str] | None = None,
    charts: dict[str, list[str]] | None = None,
    summaries: dict[str, list[str]] | None = None,
    all_charts: bool = False,
    no_charts: bool = False,
    tier2: list[str] | None = None,
    target: str | None = None,
    options: dict[str, Any] | None = None,
    output: dict[str, Any] | None = None,
    tool_version: str = "",
    source_path: Path | None = None,
) -> Recipe:
    """Turn an inferred description plus a set of choices into a recipe.

    The choices are the CLI's flags and the session's screens, which is
    why they are the same arguments in both: every screen has a flag
    equivalent because both call this.
    """
    known = {column.name for column in description.columns}
    if target and target not in known:
        # Caught here rather than by validate() below, which would report
        # it as a malformed recipe. The recipe is fine; the column is not
        # in the file, and that is what the message should say.
        from .errors import ColumnNotFound

        near = ", ".join(sorted(known)[:12])
        raise ColumnNotFound(f"Target column {target!r} is not in the dataset. Columns: {near}")

    wanted = set(columns) if columns else None
    dropped = set(exclude or ())
    charts = charts or {}
    summaries = summaries or {}
    opts = {**registry.DEFAULT_OPTIONS, **(options or {})}
    has_target = bool(target)

    plans: dict[str, ColumnPlan] = {}
    for column in description.columns:
        kind = column.verdict.type
        selected = True
        reason = ""

        if wanted is not None and column.name not in wanted:
            selected, reason = False, "not in --columns"
        elif column.name in dropped:
            selected, reason = False, "in --exclude"
        elif kind in INERT_TYPES:
            # Kept, with the reason stated, and no charts.
            #
            # The PRD's column screen deselects these outright. That
            # conflicts with its own registry, which gives an identifier
            # four summaries -- uniqueness, duplicate count, nulls, format
            # consistency -- that a deselected column can never produce.
            # Those four are exactly what you want to know about a key, so
            # the substance of the rule is honoured instead of its letter:
            # one line of text, no chart. The registry offers these types
            # no charts at all, so this costs nothing but the text.
            reason = {
                "identifier": "identifier: summarised, not charted",
                "constant": "constant: one value in every row",
                "empty": "empty: every value is null",
                "unsupported": "unsupported content: reported, not charted",
            }.get(kind, kind)

        if no_charts:
            picked_charts: list[str] = []
        elif all_charts:
            picked_charts = [
                spec.name for spec in registry.charts_for(kind, has_target=has_target)
            ]
        elif kind in charts:
            picked_charts = [
                name for name in charts[kind]
                if _applies(registry.chart, name, kind, has_target)
            ]
        else:
            picked_charts = registry.default_charts(kind, has_target=has_target)

        if kind in summaries:
            picked_summaries = [
                name for name in summaries[kind]
                if _applies(registry.summary, name, kind, has_target)
            ]
        else:
            picked_summaries = registry.default_summaries(kind)

        # The target column is not plotted against itself.
        if target == column.name:
            picked_charts = [name for name in picked_charts if name != "stacked_vs_target"]

        plans[column.name] = ColumnPlan(
            name=column.name,
            type=kind,
            confidence=column.verdict.confidence,
            overridden=column.verdict.overridden,
            inferred=column.verdict.inferred,
            selected=selected,
            reason=reason,
            charts=picked_charts,
            summaries=picked_summaries,
            meta=dict(column.verdict.meta),
        )

    kinds = registry.expand_tier2(tier2 or [])
    if target and "target" not in kinds:
        kinds.append("target")

    path = source_path or description.path
    recipe = Recipe(
        source={
            "path": str(path),
            "sha256": digest(path),
            "rows": description.rows,
            "columns": description.n_columns,
        },
        load=dict(description.load),
        sampling=description.sampling.to_json(),
        columns=plans,
        tier2={"kinds": kinds, "target": target},
        output={
            "format": "md",
            "figure_format": "png",
            "self_contained": False,
            "dpi": 110,
            "script": True,
            **(output or {}),
        },
        options=opts,
        tool_version=tool_version,
    )
    return recipe.validate()


def _applies(lookup: Any, name: str, kind: str, has_target: bool) -> bool:
    """True when a named chart or summary can run on this column type.

    A selection that names something inapplicable -- ``--charts
    numeric_continuous:hbar`` -- is a mistake worth an error, but a
    *type-keyed* selection applied across a mixed dataset legitimately
    names things some columns cannot do. This is the filter for the
    second case; ``Recipe.validate`` still raises for the first.
    """
    try:
        spec = lookup(name, kind)
    except Exception:  # noqa: BLE001 - a mismatch here is a filter, not an error
        return False
    return has_target or not getattr(spec, "needs_target", False)


def digest(path: Path | str, limit: int = DIGEST_LIMIT) -> str:
    """A fingerprint of the source file.

    Prefixed ``partial:`` when only the head was read, so nobody compares
    it against a full-file hash and concludes the data changed.
    """
    target = Path(path)
    if not target.is_file():
        return ""
    size = target.stat().st_size
    hasher = hashlib.sha256()
    read = 0
    try:
        with target.open("rb") as handle:
            while read < limit:
                block = handle.read(min(1024 * 1024, limit - read))
                if not block:
                    break
                hasher.update(block)
                read += len(block)
    except OSError:
        return ""
    if size > limit:
        return f"partial:{size}:{hasher.hexdigest()}"
    return hasher.hexdigest()
