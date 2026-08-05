"""Writing the ``analysis.py`` that reproduces the report.

This is the differentiator the idea document leads with: the report is a
starting point, not an artefact, and the way you prove that is to hand
the user the code. Nothing else in this space does.

Two rules keep the promise real rather than decorative.

**The script does not import this package.** If it did, the user would
have a wrapper around a tool instead of their own analysis, and editing
it would mean reading our source anyway. It imports pandas, numpy,
matplotlib and scipy -- the four things they already have -- and nothing
else.

**The script contains the same code that ran.** Every statistic is
computed by a function whose source was copied out of this package by
:func:`~.portable.sources`, so the script cannot drift from the report.
``tests/test_script.py`` executes the generated file and diffs its
``summary.json`` against the original; that test is the reason to trust
the sentence in the header that says it reproduces the report.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import registry
from .portable import PREAMBLE, sources

#: What the generated script needs, and the loosest bound each is known
#: to work under. The exact versions this ran on go in the header beside
#: them, because "it worked here" and "it needs at least this" are
#: different facts and both matter when the script is run a year later.
DEPENDENCY_FLOORS = {
    "pandas": ">=2.0",
    "numpy": ">=1.24",
    "matplotlib": ">=3.7",
    "scipy": ">=1.10",
}


def build(
    recipe: Any,
    *,
    source: Path,
    source_kind: str = "csv",
    tool_version: str = "",
    dependency_versions: dict[str, str] | None = None,
    generated_at: str = "",
    streaming: bool = False,
) -> str:
    """The full text of ``analysis.py`` for one recipe."""
    plans = recipe.selected()
    options = dict(recipe.options)
    target = recipe.target

    summary_plan = _summary_plan(plans, options)
    chart_plan = _chart_plan(plans, options, target)
    tier2_plan = list(recipe.tier2_kinds)

    needed = _needed_functions(summary_plan, chart_plan, tier2_plan, streaming, source_kind)
    stamp = generated_at or datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")

    parts = [
        _header(source, tool_version, dependency_versions or {}, stamp),
        "from __future__ import annotations\n\n" + "\n".join(PREAMBLE),
        _constants(recipe, source, source_kind, target, summary_plan, chart_plan, tier2_plan),
        _section("Helpers, copied from thl eda. Edit them; nothing here imports the toolkit."),
        sources(needed),
        _section("Loading"),
        _loader(recipe, streaming),
        _section("The run"),
        _driver(streaming, bool(tier2_plan), bool(target)),
        _MAIN,
    ]
    return "\n\n\n".join(part.rstrip() for part in parts if part).rstrip() + "\n"


def write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


# --------------------------------------------------------------------------
# Plans
# --------------------------------------------------------------------------


def _summary_plan(plans: list[Any], options: dict[str, Any]) -> list[dict[str, Any]]:
    """One entry per (column, summary) pair, with its arguments resolved.

    Resolved *here*, at generation time, by the same
    ``registry.option_values`` the runner calls. That is what makes the
    two paths compute identical numbers: not a shared convention, a
    shared function whose output is written into the file as a literal.
    """
    out: list[dict[str, Any]] = []
    for plan in plans:
        column_options = {**options, **_column_options(plan)}
        for name in plan.summaries:
            try:
                spec = registry.summary(name, plan.type)
            except Exception:  # noqa: BLE001 - validate() already rejected real mistakes
                continue
            out.append(
                {
                    "column": plan.name,
                    "type": plan.type,
                    "summary": name,
                    "fn": spec.fn,
                    "kwargs": registry.option_values(spec, column_options),
                }
            )
    return out


def _chart_plan(
    plans: list[Any], options: dict[str, Any], target: str | None
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for plan in plans:
        column_options = {**options, **_column_options(plan)}
        for name in plan.charts:
            try:
                spec = registry.chart(name, plan.type)
            except Exception:  # noqa: BLE001 - validate() already rejected real mistakes
                continue
            if spec.needs_target and not target:
                continue
            out.append(
                {
                    "column": plan.name,
                    "type": plan.type,
                    "chart": name,
                    "fn": spec.fn,
                    "label": spec.label,
                    "needs_target": spec.needs_target,
                    "kwargs": registry.option_values(spec, column_options),
                }
            )
    return out


def _column_options(plan: Any) -> dict[str, Any]:
    """Per-column options. Only the datetime format so far."""
    fmt = plan.meta.get("format")
    return {"date_format": fmt} if fmt else {}


def _needed_functions(
    summary_plan: list[dict[str, Any]],
    chart_plan: list[dict[str, Any]],
    tier2: list[str],
    streaming: bool,
    source_kind: str,
) -> list[str]:
    """Every portable function the generated file will call, in one list.

    ``portable.collect`` expands each one's helpers and orders them, so
    the file never references a function defined below it.
    """
    names: list[str] = ["jsonable", "coerce_column", "save_figure"]
    names.append("stream_source" if streaming else "read_source")
    if streaming:
        names.append("apply_exact")
    names.extend(entry["fn"] for entry in summary_plan)
    names.extend(entry["fn"] for entry in chart_plan)

    tier2_functions = {
        "correlation": ["correlation_data", "chart_heatmap"],
        "missingness": ["missingness_data", "chart_missing_bar", "chart_heatmap"],
        "duplicates": ["duplicates_data"],
        "target": [
            "target_data", "target_features", "chart_mi_bar",
            "chart_target_numeric", "chart_stacked_vs_target",
        ],
    }
    for kind in tier2:
        names.extend(tier2_functions.get(kind, []))

    seen: list[str] = []
    for name in names:
        if name not in seen:
            seen.append(name)
    del source_kind  # read_source dispatches on it at runtime, not at generation
    return seen


# --------------------------------------------------------------------------
# Text
# --------------------------------------------------------------------------


def _header(
    source: Path, tool_version: str, versions: dict[str, str], stamp: str
) -> str:
    pins = ", ".join(f"{name} {versions[name]}" for name in sorted(versions)) or "not recorded"
    install = " ".join(f'"{name}{bound}"' for name, bound in DEPENDENCY_FLOORS.items())
    return f'''#!/usr/bin/env python3
"""Profile of {source.name}, generated by thl eda {tool_version} on {stamp}.

Running this file reproduces the report it came from: the same figures,
and a summary.json identical to the original.

    python analysis.py                  # writes beside this file
    python analysis.py --out somewhere/ # or wherever you like

It is meant to be edited. Nothing here imports thl eda -- the statistics
and the plots are ordinary pandas and matplotlib, copied in so you can
change them without reading anyone else's library. Delete what you do not
need; the report was a starting point, not the analysis.

Generated against: {pins}
Known to need:     pip install {install}
"""'''


def _section(title: str) -> str:
    line = "-" * 74
    return f"# {line}\n# {title}\n# {line}"


def _constants(
    recipe: Any,
    source: Path,
    source_kind: str,
    target: str | None,
    summary_plan: list[dict[str, Any]],
    chart_plan: list[dict[str, Any]],
    tier2_plan: list[str],
) -> str:
    types = {name: plan.type for name, plan in recipe.columns.items()}

    # Absolute, and with forward slashes. Relative would only run from the
    # directory the report was generated in, and `r'...'` around a repr of
    # a Windows path doubles every backslash into the literal file name.
    # pathlib reads forward slashes on Windows, so one spelling works
    # everywhere and stays readable for the person editing it.
    try:
        location = Path(source).resolve().as_posix()
    except OSError:  # pragma: no cover - a path that cannot be resolved is still a path
        location = Path(source).as_posix()

    return "\n".join(
        [
            "# The file this was built from. Point it somewhere else and rerun.",
            f"SOURCE = Path({location!r})",
            f"SOURCE_KIND = {source_kind!r}",
            "OUT = Path(__file__).resolve().parent",
            'FIGURES = OUT / "figures"',
            f"FIGURE_FORMAT = {str(recipe.output.get('figure_format', 'png'))!r}",
            f"DPI = {int(recipe.output.get('dpi', 110))}",
            "",
            f"TARGET = {target!r}",
            f"TYPES = {_literal(types)}",
            "",
            "# The choices this report was built from. Change one and rerun.",
            f"LOAD = {_literal(recipe.load)}",
            f"OPTIONS = {_literal(recipe.options)}",
            f"SAMPLING = {_literal(recipe.sampling)}",
            "",
            f"SUMMARY_PLAN = {_literal(summary_plan)}",
            "",
            f"CHART_PLAN = {_literal(chart_plan)}",
            "",
            f"TIER2 = {_literal(tier2_plan)}",
            "",
            "COLUMN_CONFIDENCE = "
            + _literal({n: round(p.confidence, 4) for n, p in recipe.columns.items()}),
            "",
            f"TOOL_VERSION = {recipe.tool_version!r}",
            f"SOURCE_NAME = {source.name!r}",
            f"SOURCE_ROWS = {int(recipe.source.get('rows') or 0)}",
            f"SOURCE_COLUMNS = {int(recipe.source.get('columns') or 0)}",
        ]
    )


def _literal(value: Any) -> str:
    """A Python literal for the generated file.

    JSON first, so nested dicts come out with stable ordering and no
    repr surprises, then the three token swaps that make it Python.
    Values here are plain data by construction -- the recipe is JSON --
    so there is nothing else to translate.
    """
    text = json.dumps(value, indent=4, ensure_ascii=False, default=str)
    return (
        text.replace(": true", ": True")
        .replace(": false", ": False")
        .replace(": null", ": None")
        .replace("[true", "[True")
        .replace("[false", "[False")
        .replace("[null", "[None")
    )


def _loader(recipe: Any, streaming: bool) -> str:
    load = recipe.load
    if streaming:
        return f'''def load_frame():
    """Read the source the way the report did: one pass, exact statistics,
    and the same seeded sample. Change SAMPLING["n"] to trade time for detail."""
    sample, total, exact = stream_source(
        SOURCE,
        sep=LOAD.get("delimiter"),
        encoding=LOAD.get("encoding"),
        header=LOAD.get("header", 0),
        na_values=LOAD.get("na_values") or None,
        chunk_rows={int(load.get("chunk_rows", 100000))},
        sample_rows={int(recipe.sampling.get("n") or 200000)},
        seed={int(recipe.sampling.get("seed", 42))},
    )
    return sample, total, exact'''

    sample = recipe.sampling if recipe.sampling.get("applied") else None
    tail = ""
    if sample:
        tail = (
            f"\n    frame = frame.sample(n={int(sample['n'])}, "
            f"random_state={int(sample.get('seed', 42))}).sort_index()"
        )
    return f'''def load_frame():
    """Read the source exactly as the report did."""
    frame = read_source(
        SOURCE,
        kind=SOURCE_KIND,
        sep=LOAD.get("delimiter"),
        encoding=LOAD.get("encoding"),
        header=LOAD.get("header", 0),
        na_values=LOAD.get("na_values") or None,
        nrows=LOAD.get("nrows"),
        sheet=LOAD.get("sheet"),
    ){tail}
    return frame, len(frame), {{}}'''


def _driver(streaming: bool, with_tier2: bool, with_target: bool) -> str:
    # A streamed run knows the true count, nulls and cardinality for every
    # column even though the figures came from a sample. The report prints
    # those exact numbers, so the script has to as well or the diff fails
    # on precisely the columns sampling was supposed to be honest about.
    exact_line = (
        "    for column, bucket in out.items():\n"
        "        bucket['summaries'] = apply_exact(bucket['summaries'], exact.get(column, {}))\n"
        if streaming
        else ""
    )
    tier2_block = _TIER2_BLOCK if with_tier2 else _NO_TIER2
    del with_target  # TARGET is read from the constants block at run time
    return f'''def coerced(frame, column):
    """The column, read as the type the report used -- not as the dtype says.

    The two differ exactly where somebody overrode a type, which is the
    case this exists for.
    """
    kind = TYPES.get(column, "free_text")
    date_format = None
    for entry in SUMMARY_PLAN + CHART_PLAN:
        if entry["column"] == column and "date_format" in entry["kwargs"]:
            date_format = entry["kwargs"]["date_format"]
            break
    return coerce_column(frame[column], kind, date_format)


def compute_summaries(frame, exact):
    """Every statistic in the report, in report order."""
    out = {{}}
    for entry in SUMMARY_PLAN:
        column = entry["column"]
        bucket = out.setdefault(
            column,
            {{"type": entry["type"], "confidence": COLUMN_CONFIDENCE.get(column, 1.0),
              "summaries": {{}}}},
        )
        fn = globals()[entry["fn"]]
        try:
            bucket["summaries"][entry["summary"]] = jsonable(fn(frame[column], **entry["kwargs"]))
        except Exception as err:
            # One statistic failing must not cost the other forty.
            print(f"  ! {{column}}.{{entry['summary']}}: {{type(err).__name__}}: {{err}}")
            bucket["summaries"][entry["summary"]] = None
{exact_line}    return out


def draw_charts(frame):
    """Every figure in the report, numbered as the report numbers them."""
    FIGURES.mkdir(parents=True, exist_ok=True)
    caption = ""
    if SAMPLING.get("applied"):
        caption = (f"sample of {{SAMPLING['n']:,}} of {{SAMPLING['of']:,}} rows "
                   f"(seed {{SAMPLING['seed']}})")
    written = []
    for index, entry in enumerate(CHART_PLAN, start=1):
        column = entry["column"]
        fn = globals()[entry["fn"]]
        title = f"{{column}} {{entry['label']}}"
        try:
            if entry["needs_target"]:
                figure = fn(frame[column], frame[TARGET], title=title, caption=caption,
                            **entry["kwargs"])
            else:
                figure = fn(frame[column], title=title, caption=caption, **entry["kwargs"])
        except Exception as err:
            print(f"  ! figure {{column}} {{entry['chart']}}: {{type(err).__name__}}: {{err}}")
            continue
        slug = re.sub(r"[^a-z0-9]+", "_", column.casefold()).strip("_")[:40] or "column"
        name = f"{{index:02d}}_{{slug}}_{{entry['chart']}}.{{FIGURE_FORMAT}}"
        written.append(save_figure(figure, FIGURES / name, FIGURE_FORMAT, DPI))
    return written


{tier2_block}

def run(out_dir=None):
    global OUT, FIGURES
    if out_dir is not None:
        OUT = Path(out_dir)
        FIGURES = OUT / "figures"
    OUT.mkdir(parents=True, exist_ok=True)

    frame, rows, exact = load_frame()
    print(f"loaded {{len(frame):,}} rows x {{len(frame.columns)}} columns from {{SOURCE.name}}")

    columns = compute_summaries(frame, exact)
    figures = draw_charts(frame)
    tier2 = compute_tier2(frame)

    summary = {{
        "tool": "thl eda",
        "version": TOOL_VERSION,
        "source": {{"name": SOURCE_NAME, "rows": SOURCE_ROWS, "columns": SOURCE_COLUMNS}},
        "sampling": SAMPLING,
        "columns": columns,
        "tier2": tier2,
    }}
    path = OUT / "summary.json"
    path.write_text(
        json.dumps(summary, indent=2, ensure_ascii=False, sort_keys=False, default=str) + "\\n",
        encoding="utf-8",
    )
    drawn = len(list(FIGURES.glob("*"))) if FIGURES.is_dir() else len(figures)
    print(f"wrote {{path}} and {{drawn}} figures into {{FIGURES}}")
    return summary'''


_NO_TIER2 = '''def compute_tier2(frame):
    """No Tier 2 analysis was selected for this run."""
    return {}
'''


_TIER2_BLOCK = '''def compute_tier2(frame):
    """The dataset-level analyses the report ran."""
    if not TIER2:
        return {}
    numeric = [n for n, k in TYPES.items()
               if k in ("numeric_continuous", "numeric_discrete") and n in frame.columns]
    categorical = [n for n, k in TYPES.items()
                   if k in ("categorical_low", "boolean") and n in frame.columns]
    out = {}
    figure_index = len(CHART_PLAN)

    for kind in TIER2:
        if kind == "correlation":
            data = correlation_data(frame, numeric, categorical)
            for key, label in (("pearson", "Pearson"), ("spearman", "Spearman (rank)"),
                               ("cramers_v", "Cramer's V")):
                if key in data:
                    figure_index += 1
                    save_figure(
                        chart_heatmap(data[key], title=f"{label} correlation",
                                      diverging=key != "cramers_v"),
                        FIGURES / f"{figure_index:02d}_correlation_{key}.{FIGURE_FORMAT}",
                        FIGURE_FORMAT, DPI,
                    )
        elif kind == "missingness":
            data = missingness_data(frame)
            figure_index += 1
            save_figure(chart_missing_bar(data, title="Missing values by column"),
                        FIGURES / f"{figure_index:02d}_missingness_bar.{FIGURE_FORMAT}",
                        FIGURE_FORMAT, DPI)
            if len(data["cooccurrence"]["columns"]) >= 2:
                figure_index += 1
                save_figure(
                    chart_heatmap(data["cooccurrence"], title="Missing together",
                                  diverging=False),
                    FIGURES / f"{figure_index:02d}_missingness_cooccurrence.{FIGURE_FORMAT}",
                    FIGURE_FORMAT, DPI,
                )
        elif kind == "duplicates":
            data = duplicates_data(frame)
        elif kind == "target" and TARGET:
            data = target_data(frame, TARGET, target_features(frame, TYPES), numeric)
            figure_index += 1
            save_figure(
                chart_mi_bar(data["mutual_information"], TARGET,
                             title=f"Feature ranking against {TARGET}"),
                FIGURES / f"{figure_index:02d}_target_mutual_information.{FIGURE_FORMAT}",
                FIGURE_FORMAT, DPI,
            )
            for row in data["mutual_information"][:6]:
                name = row["column"]
                try:
                    if name in numeric:
                        figure = chart_target_numeric(frame[name], frame[TARGET],
                                                      title=f"{name} by {TARGET}")
                        label = "target_numeric"
                    elif name in categorical:
                        figure = chart_stacked_vs_target(frame[name], frame[TARGET],
                                                         title=f"{name} by {TARGET}")
                        label = "target_stacked"
                    else:
                        continue
                except Exception as err:
                    print(f"  ! {name} vs {TARGET}: {type(err).__name__}: {err}")
                    continue
                figure_index += 1
                slug = re.sub(r"[^a-z0-9]+", "_", str(name).casefold()).strip("_")[:40]
                save_figure(figure, FIGURES / f"{figure_index:02d}_{slug}_{label}.{FIGURE_FORMAT}",
                            FIGURE_FORMAT, DPI)
        else:
            continue
        out[kind] = jsonable(data)
    return out
'''


_MAIN = '''if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", default=None, help="where to write summary.json and figures")
    run(parser.parse_args().out)
'''
