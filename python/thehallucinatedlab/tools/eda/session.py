"""The interactive session: nine screens that build a recipe.

The session is not a tool and holds no analysis logic. Its only job is
to produce a :class:`~.recipe.Recipe`; ``eda_report`` consumes one. That
is what makes a future browser front-end a client rather than a rewrite.

Every screen prints the flag that would have produced the same choice, in
a footer. The session is therefore also how somebody learns the CLI: walk
it once with ``-i``, read the footers, and the next run is one line with
no session at all.

Universal keys, on every screen::

    space   toggle        a  all         n  none      /  filter
    up/down move          enter confirm  esc back     q  quit

Screen S2 -- type review -- is the one that decides whether the tool
feels trustworthy, so it sorts low-confidence columns to the top and
shows the sentence behind every verdict rather than only the number.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

from . import inference, keys, loading, registry
from . import recipe as recipe_mod
from .errors import THLError
from .keys import Screen
from .loading import LoadOptions, SourceRef
from .types import COLUMN_TYPES, TYPE_LABELS

BACK = "__back__"
QUIT = "__quit__"


class Cancelled(THLError):
    """The user pressed q. Not an error, but it does end the run."""


@dataclass
class SessionState:
    """Everything the nine screens collect, in the order they collect it."""

    refs: list[SourceRef]
    chosen_refs: list[SourceRef] = field(default_factory=list)
    load: LoadOptions = field(default_factory=LoadOptions)
    description: Any = None
    loaded: Any = None
    overrides: dict[str, str] = field(default_factory=dict)
    columns: dict[str, bool] = field(default_factory=dict)
    charts: dict[str, list[str]] = field(default_factory=dict)
    summaries: dict[str, list[str]] = field(default_factory=dict)
    tier2: list[str] = field(default_factory=list)
    target: str | None = None
    out: Path | None = None
    format: str = "md"
    figure_format: str = "png"
    self_contained: bool = False
    emit_script: bool = True
    options: dict[str, Any] = field(default_factory=lambda: dict(registry.DEFAULT_OPTIONS))


# --------------------------------------------------------------------------
# Widgets
# --------------------------------------------------------------------------


@dataclass
class Item:
    key: str
    label: str
    detail: str = ""
    group: str = ""
    selected: bool = False
    enabled: bool = True
    note: str = ""


def multi_select(
    screen: Screen,
    title: str,
    subtitle: str,
    items: list[Item],
    *,
    footer: Any,
    allow_empty: bool = True,
    on_enter: Any = None,
) -> str:
    """One multi-select screen. Returns "ok", ``BACK`` or ``QUIT``.

    ``footer`` is called with the current selection and returns the
    equivalent CLI flag, so the line under the list is always the command
    that would skip this screen entirely.

    ``on_enter`` gives the highlighted row an action -- the type screen
    uses it to open the override list. The PRD asks for both "enter
    confirms" universally and "enter on a row opens the type list" on S2,
    which cannot both be true on that screen. Enter does the row action
    where there is one, tab always moves on, and the key hint under the
    list says which is which rather than leaving the user to find out.
    """
    cursor = 0
    filter_text = ""

    while True:
        visible = [
            index
            for index, item in enumerate(items)
            if not filter_text or filter_text.lower() in (item.label + item.detail).lower()
        ]
        if not visible:
            visible = list(range(len(items)))
        cursor = max(0, min(cursor, len(visible) - 1))

        screen.clear()
        screen.write(screen.bold(title))
        if subtitle:
            screen.write(screen.dim(subtitle))
        screen.write()

        window = max(6, screen.height - 12)
        start = max(0, min(cursor - window // 2, max(0, len(visible) - window)))
        shown = visible[start : start + window]

        group = None
        for position, index in enumerate(shown, start=start):
            item = items[index]
            if item.group and item.group != group:
                group = item.group
                screen.write(screen.dim(f"  {group}"))
            box = "[x]" if item.selected else "[ ]"
            if not item.enabled:
                box = " - "
            line = f"  {box} {item.label}"
            if item.detail:
                line = f"{line}  {screen.dim(item.detail)}"
            if item.note:
                line = f"{line}  {screen.warn(item.note)}"
            screen.write(screen.invert(line) if position == cursor else line)

        if len(visible) > len(shown):
            screen.write(screen.dim(f"  ... {len(visible) - len(shown)} more"))

        screen.write()
        chosen = [item for item in items if item.selected and item.enabled]
        screen.write(screen.accent(footer(chosen)))
        if filter_text:
            screen.write(screen.dim(f"filter: {filter_text}  (esc clears)"))
        confirm = "tab continue" if on_enter is not None else "enter continue"
        action = "enter change type " + _dot() + " " if on_enter is not None else ""
        screen.write(
            screen.dim(
                "space toggle " + _dot() + " a all " + _dot() + " n none " + _dot()
                + " / filter " + _dot() + " " + action + confirm + " " + _dot()
                + " esc back " + _dot() + " q quit"
            )
        )
        screen.flush()

        key = keys.read_key()
        if key == "q":
            return QUIT
        if key == keys.ESCAPE:
            if filter_text:
                filter_text = ""
                continue
            return BACK
        if key == keys.UP:
            cursor -= 1
        elif key == keys.DOWN:
            cursor += 1
        elif key == keys.PAGE_UP:
            cursor -= window
        elif key == keys.PAGE_DOWN:
            cursor += window
        elif key == keys.HOME:
            cursor = 0
        elif key == keys.END:
            cursor = len(visible) - 1
        elif key == keys.SPACE:
            item = items[visible[cursor]]
            if item.enabled:
                item.selected = not item.selected
        elif key == "a":
            for item in items:
                if item.enabled:
                    item.selected = True
        elif key == "n":
            for item in items:
                item.selected = False
        elif key == "/":
            screen.write()
            filter_text = keys.read_line("filter")
        elif key == keys.ENTER and on_enter is not None:
            on_enter(items[visible[cursor]])
        elif key in (keys.ENTER, keys.TAB):
            if not allow_empty and not any(i.selected for i in items):
                continue
            return "ok"
        cursor = max(0, min(cursor, len(visible) - 1))


def choose_one(screen: Screen, title: str, options: list[tuple[str, str]],
               current: str | None) -> str | None:
    """A single-choice list. Returns the chosen key, or None on escape."""
    cursor = next((i for i, (key, _) in enumerate(options) if key == current), 0)
    while True:
        screen.clear()
        screen.write(screen.bold(title))
        screen.write()
        for index, (key, label) in enumerate(options):
            mark = keys.glyph("bullet") if key == current else " "
            line = f"  {mark} {label}"
            screen.write(screen.invert(line) if index == cursor else line)
        screen.write()
        screen.write(screen.dim("enter choose " + _dot() + " esc cancel"))
        screen.flush()

        key = keys.read_key()
        if key in (keys.ESCAPE, "q"):
            return None
        if key == keys.UP:
            cursor = (cursor - 1) % len(options)
        elif key == keys.DOWN:
            cursor = (cursor + 1) % len(options)
        elif key == keys.ENTER:
            return options[cursor][0]


# --------------------------------------------------------------------------
# Screens
# --------------------------------------------------------------------------


def screen_source(screen: Screen, state: SessionState, max_files: int) -> str:
    """S0 -- which files. Only shown when the source is a directory."""
    items = [
        Item(
            key=str(index),
            label=ref.label,
            detail=_source_detail(ref),
            selected=index < max_files,
        )
        for index, ref in enumerate(state.refs)
    ]

    def footer(chosen: list[Item]) -> str:
        return f"{len(chosen)} of {len(items)} files selected"

    outcome = multi_select(
        screen,
        "S0 · Source",
        f"{len(items)} datasets found. Above {max_files} the run gets long "
        "-- narrow with --pattern.",
        items,
        footer=footer,
        allow_empty=False,
    )
    if outcome == "ok":
        state.chosen_refs = [state.refs[int(item.key)] for item in items if item.selected]
    return outcome


def _source_detail(ref: SourceRef) -> str:
    facts = loading.describe_source(ref)
    rows = facts["rows_estimate"]
    estimate = f"~{rows:,} rows" if rows else ""
    return f"{facts['size']:>10}  {estimate}"


def screen_load(screen: Screen, state: SessionState, ref: SourceRef) -> str:
    """S1 -- delimiter, encoding, header and NA tokens, over a live preview."""
    options = loading.sniff(ref, state.load)
    while True:
        screen.clear()
        screen.write(screen.bold("S1 · Load options"))
        screen.write(screen.dim(f"{ref.label} — each value is a guess you can correct."))
        screen.write()
        rows = [
            ("d", "delimiter", _visible(options.delimiter)),
            ("e", "encoding", str(options.encoding)),
            ("h", "header row", "none" if options.header is None else str(options.header)),
            ("v", "extra NA tokens", ", ".join(options.na_values) or "(pandas defaults)"),
            ("r", "read only first N rows", str(options.nrows) if options.nrows else "all"),
        ]
        for key, label, value in rows:
            guess = " (sniffed)" if label.split()[0] in options.sniffed else ""
            screen.write(f"  {screen.accent(key)}  {label:<24} {value}{screen.dim(guess)}")

        screen.write()
        screen.write(screen.dim("  preview"))
        _write_preview(screen, ref, options)

        screen.write()
        screen.write(screen.accent(_load_flags(options)))
        screen.write(screen.dim("press a letter to change it " + _dot() + " enter accept "
                       + _dot() + " esc back " + _dot() + " q quit"))
        screen.flush()

        key = keys.read_key()
        if key == "q":
            return QUIT
        if key == keys.ESCAPE:
            return BACK
        if key == keys.ENTER:
            state.load = options
            return "ok"
        if key == "d":
            value = keys.read_line("delimiter (\\t for tab)", options.delimiter or ",")
            options = replace(options, delimiter=value.replace("\\t", "\t") or None)
        elif key == "e":
            options = replace(options, encoding=keys.read_line("encoding", options.encoding or ""))
        elif key == "h":
            value = keys.read_line("header row, or 'none'", str(options.header))
            options = replace(options, header=None if value.lower() == "none" else _int(value, 0))
        elif key == "v":
            value = keys.read_line("extra NA tokens, comma separated",
                                   ",".join(options.na_values))
            options = replace(
                options, na_values=[v.strip() for v in value.split(",") if v.strip()]
            )
        elif key == "r":
            value = keys.read_line("read first N rows, blank for all",
                                   str(options.nrows or ""))
            options = replace(options, nrows=_int(value, 0) or None)


def _write_preview(screen: Screen, ref: SourceRef, options: LoadOptions) -> None:
    frame = loading.preview(ref, options, rows=6)
    if not len(frame.columns):
        screen.write(screen.warn("    nothing parsed with these options"))
        return
    names = [str(c)[:14] for c in frame.columns][:8]
    screen.write("    " + " | ".join(f"{n:<14}" for n in names))
    for _, row in frame.head(5).iterrows():
        cells = [str(row[c])[:14] for c in frame.columns][:8]
        screen.write("    " + screen.dim(" | ".join(f"{c:<14}" for c in cells)))


def screen_types(screen: Screen, state: SessionState) -> str:
    """S2 -- the screen that decides whether the tool feels trustworthy."""
    description = state.description
    order = sorted(
        description.columns,
        key=lambda c: (not c.verdict.low_confidence, c.name),
    )
    items = [
        Item(
            key=column.name,
            label=f"{column.name:<24}",
            detail=(
                f"{TYPE_LABELS.get(state.overrides.get(column.name, column.verdict.type), '')} "
                f"{_dot()} {column.verdict.confidence:.2f} {_dot()} {column.null_rate:.0%} null "
                f"{_dot()} {', '.join(column.preview[:3]) or 'no values'}"
            ),
            note="low confidence" if column.verdict.low_confidence else "",
            selected=True,
        )
        for column in order
    ]
    lookup = {column.name: column for column in description.columns}

    def on_enter(item: Item) -> str:
        column = lookup[item.key]
        current = state.overrides.get(column.name, column.verdict.type)
        picked = choose_one(
            screen,
            f"Read {column.name} as… (inference said "
            f"{TYPE_LABELS.get(column.verdict.type, column.verdict.type)}, "
            f"{column.verdict.confidence:.2f} — {column.verdict.reason})",
            [(kind, TYPE_LABELS.get(kind, kind)) for kind in COLUMN_TYPES],
            current,
        )
        if picked:
            if picked == column.verdict.type:
                state.overrides.pop(column.name, None)
            else:
                state.overrides[column.name] = picked
            item.detail = (
                f"{TYPE_LABELS.get(picked, picked)} {_dot()} set by you "
                f"{_dot()} {column.null_rate:.0%} null "
                f"{_dot()} {', '.join(column.preview[:3]) or 'no values'}"
            )
            item.note = ""
        return "handled"

    def footer(_: list[Item]) -> str:
        if not state.overrides:
            return "no overrides — inference accepted as is"
        return "--types " + ",".join(f"{k}={v}" for k, v in state.overrides.items())

    low = sum(1 for column in description.columns if column.verdict.low_confidence)
    return multi_select(
        screen,
        "S2 · Type review",
        f"{len(items)} columns; {low} flagged. Enter on a row to change how it is read. "
        "Low-confidence rows are first.",
        items,
        footer=footer,
        on_enter=on_enter,
    )


def screen_columns(screen: Screen, state: SessionState) -> str:
    """S3 -- which columns to profile, grouped by type."""
    description = state.description
    items: list[Item] = []
    for column in description.columns:
        kind = state.overrides.get(column.name, column.verdict.type)
        inert = kind in {"identifier", "constant", "empty", "unsupported"}
        items.append(
            Item(
                key=column.name,
                label=column.name,
                detail=f"{column.n_unique:,} distinct {_dot()} {column.null_rate:.0%} null",
                group=TYPE_LABELS.get(kind, kind),
                selected=state.columns.get(column.name, True),
                note="summarised, no charts" if inert else "",
            )
        )
    items.sort(key=lambda item: item.group)

    def footer(chosen: list[Item]) -> str:
        if len(chosen) == len(items):
            return "all columns"
        dropped = [item.key for item in items if not item.selected]
        if len(dropped) <= len(chosen):
            return "--exclude " + ",".join(dropped)
        return "--columns " + ",".join(item.key for item in chosen)

    outcome = multi_select(
        screen,
        "S3 · Columns",
        "Identifiers, constants and empty columns get one line of text and no chart.",
        items,
        footer=footer,
        allow_empty=False,
    )
    if outcome == "ok":
        state.columns = {item.key: item.selected for item in items}
    return outcome


def screen_charts(screen: Screen, state: SessionState) -> str:
    """S4 -- charts per column type, with a live figure count."""
    return _per_type_screen(
        screen,
        state,
        title="S4 · Charts",
        subtitle="Only the types actually present in this dataset are listed.",
        flag="--charts",
        catalogue=lambda kind: registry.charts_for(kind, has_target=bool(state.target)),
        defaults=lambda kind: registry.default_charts(kind, has_target=bool(state.target)),
        store=state.charts,
        count_label="figures",
    )


def screen_summaries(screen: Screen, state: SessionState) -> str:
    """S5 -- summaries per column type."""
    return _per_type_screen(
        screen,
        state,
        title="S5 · Summaries",
        subtitle="Every statistic the report will print, per type.",
        flag="--summaries",
        catalogue=registry.summaries_for,
        defaults=registry.default_summaries,
        store=state.summaries,
        count_label="statistics",
    )


def _per_type_screen(
    screen: Screen,
    state: SessionState,
    *,
    title: str,
    subtitle: str,
    flag: str,
    catalogue: Any,
    defaults: Any,
    store: dict[str, list[str]],
    count_label: str,
) -> str:
    present = _present_types(state)
    items: list[Item] = []
    for kind, columns in present.items():
        chosen = store.get(kind, defaults(kind))
        for spec in catalogue(kind):
            items.append(
                Item(
                    key=f"{kind}:{spec.name}",
                    label=spec.label,
                    detail=spec.note,
                    group=f"{TYPE_LABELS.get(kind, kind).upper()}  ({len(columns)} columns)",
                    selected=spec.name in chosen,
                )
            )
    if not items:
        return "ok"

    def footer(chosen: list[Item]) -> str:
        total = 0
        parts = []
        for kind, columns in present.items():
            names = [i.key.split(":", 1)[1] for i in chosen if i.key.startswith(kind + ":")]
            if names:
                parts.append(f"{kind}:{','.join(names)}")
                total += len(names) * len(columns)
        spec = f"{flag} {';'.join(parts)}" if parts else f"{flag} (none)"
        return f"{spec}    {keys.glyph('arrow')} {total} {count_label}"

    outcome = multi_select(screen, title, subtitle, items, footer=footer)
    if outcome == "ok":
        for kind in present:
            store[kind] = [
                item.key.split(":", 1)[1]
                for item in items
                if item.selected and item.key.startswith(kind + ":")
            ]
    return outcome


def _present_types(state: SessionState) -> dict[str, list[str]]:
    """Types actually in this dataset, honouring overrides and selection."""
    grouped: dict[str, list[str]] = {}
    for column in state.description.columns:
        if not state.columns.get(column.name, True):
            continue
        kind = state.overrides.get(column.name, column.verdict.type)
        grouped.setdefault(kind, []).append(column.name)
    return grouped


def screen_relationships(screen: Screen, state: SessionState) -> str:
    """S6 -- Tier 2, and the target picker when target analysis is ticked."""
    items = [
        Item(
            key=spec.name,
            label=spec.label,
            detail=spec.note,
            selected=spec.name in state.tier2,
        )
        for spec in registry.RELATIONS
    ]

    def footer(chosen: list[Item]) -> str:
        names = [item.key for item in chosen]
        if not names:
            return "no relationship analysis (Tier 1 only)"
        line = "--tier2 " + ",".join(names)
        if "target" in names:
            line += f" --target {state.target}" if state.target else "   (needs a target)"
        return line

    while True:
        outcome = multi_select(
            screen,
            "S6 · Relationships (Tier 2)",
            "This is where the tool stops being a describe() wrapper.",
            items,
            footer=footer,
        )
        if outcome != "ok":
            return outcome
        state.tier2 = [item.key for item in items if item.selected]
        if "target" not in state.tier2:
            state.target = None
            return "ok"

        candidates = [
            (column.name, f"{column.name}  ({TYPE_LABELS.get(column.verdict.type, '')})")
            for column in state.description.columns
            if column.verdict.type not in {"identifier", "empty", "unsupported"}
        ]
        picked = choose_one(screen, "Target column", candidates, state.target)
        if picked:
            state.target = picked
            return "ok"
        # Escaped out of the picker: target analysis cannot run without one.
        for item in items:
            if item.key == "target":
                item.selected = False


def screen_output(screen: Screen, state: SessionState, ref: SourceRef) -> str:
    """S7 -- format, figures, script, and where it all goes. No native dialog."""
    from .runner import default_out_dir  # noqa: PLC0415 - avoids a cycle at import time

    if state.out is None:
        state.out = default_out_dir(ref)

    while True:
        screen.clear()
        screen.write(screen.bold("S7 · Output"))
        screen.write(screen.dim("Markdown plus separate figures diffs in a pull request; "
                                "a self-contained HTML blob does not."))
        screen.write()
        rows = [
            ("f", "report format", state.format),
            ("g", "figure format", state.figure_format),
            ("s", "self-contained (inline figures)",
             "yes" if state.self_contained else "no"),
            ("p", "emit analysis.py", "yes" if state.emit_script else "no"),
            ("t", "top-N cutoff", str(state.options.get("top_n"))),
            ("r", "outlier rule", str(state.options.get("outlier_rule"))),
            ("o", "output directory", str(state.out)),
        ]
        for key, label, value in rows:
            screen.write(f"  {screen.accent(key)}  {label:<34} {value}")
        screen.write()
        screen.write(screen.accent(_output_flags(state)))
        screen.write(screen.dim("press a letter to change it " + _dot() + " enter accept "
                       + _dot() + " esc back " + _dot() + " q quit"))
        screen.flush()

        key = keys.read_key()
        if key == "q":
            return QUIT
        if key == keys.ESCAPE:
            return BACK
        if key == keys.ENTER:
            return "ok"
        if key == "f":
            state.format = "html" if state.format == "md" else "md"
        elif key == "g":
            state.figure_format = "svg" if state.figure_format == "png" else "png"
        elif key == "s":
            state.self_contained = not state.self_contained
        elif key == "p":
            state.emit_script = not state.emit_script
        elif key == "t":
            state.options["top_n"] = max(
                1, _int(keys.read_line("top N", str(state.options["top_n"])), 15)
            )
        elif key == "r":
            current = str(state.options.get("outlier_rule", "iqr"))
            state.options["outlier_rule"] = "zscore" if current == "iqr" else "iqr"
        elif key == "o":
            screen.write()
            value = keys.read_line("output directory", str(state.out))
            state.out = Path(value).expanduser()


def screen_confirm(screen: Screen, state: SessionState, plan: Any) -> str:
    """S8 -- the whole plan, including any sampling, before anything runs."""
    screen.clear()
    screen.write(screen.bold("S8 · Confirm"))
    screen.write()

    selected = plan.selected()
    figures = plan.figure_count()
    summaries = plan.summary_count()
    rows = [
        ("files", str(len(state.chosen_refs) or 1)),
        ("rows x columns", f"{plan.source.get('rows', 0):,} x {plan.source.get('columns', 0)}"),
        ("columns profiled", f"{len(selected)} of {len(plan.columns)}"),
        ("figures", f"{figures} (up to)"),
        ("statistics", str(summaries)),
        ("relationships", ", ".join(plan.tier2_kinds) or "none"),
        ("target", plan.target or "none"),
        ("output", f"{state.out}  ({state.format})"),
        ("analysis.py", "yes" if state.emit_script else "no"),
    ]
    for label, value in rows:
        screen.write(f"  {label:<20} {value}")

    if plan.sampling.get("applied"):
        screen.write()
        screen.write(screen.warn("  This run will sample."))
        screen.write(
            f"  Figures use {plan.sampling.get('n'):,} of {plan.sampling.get('of'):,} rows "
            f"(seed {plan.sampling.get('seed')}). Counts and nulls stay exact."
        )

    screen.write()
    screen.write(screen.dim("  the same run, without the session:"))
    screen.write("  " + screen.accent(_full_command(state, plan)))
    screen.write()
    screen.write(screen.dim("enter run " + _dot() + " esc back " + _dot() + " q quit"))
    screen.flush()

    while True:
        key = keys.read_key()
        if key == "q":
            return QUIT
        if key == keys.ESCAPE:
            return BACK
        if key == keys.ENTER:
            return "ok"


# --------------------------------------------------------------------------
# Flag rendering
# --------------------------------------------------------------------------


def _visible(value: str | None) -> str:
    if value is None:
        return "(sniffing)"
    return {"\t": "\\t", " ": "(space)"}.get(value, value)


def _load_flags(options: LoadOptions) -> str:
    parts = []
    if options.delimiter and options.delimiter != ",":
        parts.append(f'--delimiter "{_visible(options.delimiter)}"')
    if options.encoding and options.encoding != "utf-8":
        parts.append(f"--encoding {options.encoding}")
    if options.header != 0:
        parts.append(f"--header {options.header}")
    if options.na_values:
        parts.append("--na-values " + ",".join(options.na_values))
    if options.nrows:
        parts.append(f"--nrows {options.nrows}")
    return " ".join(parts) or "defaults — no load flags needed"


def _output_flags(state: SessionState) -> str:
    parts = [f"--out {state.out}"]
    if state.format != "md":
        parts.append(f"--format {state.format}")
    if state.figure_format != "png":
        parts.append(f"--figure-format {state.figure_format}")
    if state.self_contained:
        parts.append("--self-contained")
    if not state.emit_script:
        parts.append("--no-script")
    if state.options.get("top_n") != registry.DEFAULT_OPTIONS["top_n"]:
        parts.append(f"--top-n {state.options['top_n']}")
    if state.options.get("outlier_rule") != registry.DEFAULT_OPTIONS["outlier_rule"]:
        parts.append(f"--outlier-rule {state.options['outlier_rule']}")
    return " ".join(parts)


def _full_command(state: SessionState, plan: Any) -> str:
    source = state.chosen_refs[0].path if state.chosen_refs else Path(".")
    parts = [f"thl eda {source}"]
    if state.overrides:
        parts.append("--types " + ",".join(f"{k}={v}" for k, v in state.overrides.items()))
    dropped = [name for name, keep in state.columns.items() if not keep]
    if dropped:
        parts.append("--exclude " + ",".join(dropped))
    if plan.tier2_kinds:
        parts.append("--tier2 " + ",".join(plan.tier2_kinds))
    if plan.target:
        parts.append(f"--target {plan.target}")
    parts.append(_output_flags(state))
    return " ".join(part for part in parts if part)


def _dot() -> str:
    """The separator, or a hyphen where the console cannot encode it."""
    return keys.glyph("dot")


def _int(text: str, fallback: int) -> int:
    try:
        return int(str(text).strip())
    except (TypeError, ValueError):
        return fallback


# --------------------------------------------------------------------------
# The walk
# --------------------------------------------------------------------------


def run(
    refs: list[SourceRef],
    *,
    options: Any,
    tool_version: str,
    prefilled: Any = None,
    directory_source: bool = False,
) -> tuple[list[SourceRef], SessionState, Any]:
    """Walk the screens and return what to run.

    Raises :class:`Cancelled` when the user quits, which the CLI turns
    into exit code 130 rather than a traceback.
    """
    if not keys.interactive():
        raise THLError("The interactive session needs a terminal. Drop -i, or pass flags.")

    screen = Screen()
    state = SessionState(refs=list(refs), chosen_refs=list(refs))
    state.load = replace(options.load)
    state.out = Path(options.out) if options.out else None
    state.format = options.format
    state.figure_format = options.figure_format
    state.self_contained = options.self_contained
    state.emit_script = options.emit_script
    state.options = {**registry.DEFAULT_OPTIONS, **options.options}
    state.tier2 = registry.expand_tier2(options.tier2 or [])
    state.target = options.target
    state.overrides = dict(options.types)

    if prefilled is not None:
        _apply_recipe(state, prefilled)

    step = 0 if directory_source else 1
    plan = None

    while True:
        if step < 0:
            raise Cancelled("cancelled at the first screen")

        if step == 0:
            outcome = screen_source(screen, state, options.max_files)
        elif step == 1:
            outcome = screen_load(screen, state, state.chosen_refs[0])
        elif step == 2:
            _describe(state, options)
            outcome = screen_types(screen, state)
        elif step == 3:
            outcome = screen_columns(screen, state)
        elif step == 4:
            outcome = screen_charts(screen, state)
        elif step == 5:
            outcome = screen_summaries(screen, state)
        elif step == 6:
            outcome = screen_relationships(screen, state)
        elif step == 7:
            outcome = screen_output(screen, state, state.chosen_refs[0])
        else:
            plan = _build(state, options, tool_version)
            outcome = screen_confirm(screen, state, plan)
            if outcome == "ok":
                screen.clear()
                return state.chosen_refs, state, plan

        if outcome == QUIT:
            raise Cancelled("cancelled by the user")
        step += -1 if outcome == BACK else 1
        if step == 0 and not directory_source:
            step = -1


def _describe(state: SessionState, options: Any) -> None:
    """Load and classify, once, when the type screen first needs it."""
    if state.description is not None and state.loaded is not None:
        return
    ref = state.chosen_refs[0]
    state.loaded = loading.load(ref, state.load, allow_sampling=options.allow_sampling)
    state.description = inference.describe(state.loaded, {})
    if not state.columns:
        state.columns = {column.name: True for column in state.description.columns}


def _apply_recipe(state: SessionState, supplied: Any) -> None:
    """Open the session pre-filled from a recipe, as ``--recipe -i`` promises."""
    state.overrides = {
        name: plan.type for name, plan in supplied.columns.items() if plan.overridden
    }
    state.columns = {name: plan.selected for name, plan in supplied.columns.items()}
    state.tier2 = list(supplied.tier2_kinds)
    state.target = supplied.target
    state.options = {**state.options, **supplied.options}
    state.format = str(supplied.output.get("format", state.format))
    state.figure_format = str(supplied.output.get("figure_format", state.figure_format))
    state.self_contained = bool(supplied.output.get("self_contained", state.self_contained))
    state.emit_script = bool(supplied.output.get("script", state.emit_script))
    for plan in supplied.columns.values():
        state.charts.setdefault(plan.type, list(plan.charts))
        state.summaries.setdefault(plan.type, list(plan.summaries))


def _build(state: SessionState, options: Any, tool_version: str) -> Any:
    """The session's only real output."""
    if state.overrides:
        state.description = inference.describe(state.loaded, state.overrides)
    excluded = [name for name, keep in state.columns.items() if not keep]
    return recipe_mod.build(
        state.description,
        exclude=excluded,
        charts=state.charts,
        summaries=state.summaries,
        tier2=state.tier2,
        target=state.target,
        options=state.options,
        output={
            "format": state.format,
            "figure_format": state.figure_format,
            "self_contained": state.self_contained,
            "dpi": options.dpi,
            "script": state.emit_script,
        },
        tool_version=tool_version,
        source_path=state.chosen_refs[0].path,
    )


__all__ = ["run", "SessionState", "Cancelled", "BACK", "QUIT"]
