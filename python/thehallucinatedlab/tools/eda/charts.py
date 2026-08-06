"""Every figure the report can draw.

Same contract as ``summaries.py``: each function is
:func:`~.portable.portable`, uses nothing from this package, and has its
source copied into the generated ``analysis.py`` so the script draws the
figures with the code that drew them the first time.

Matplotlib directly, no seaborn. Two reasons, and the second is the one
that decided it: seaborn would be a fifth heavy dependency in an extra
that already has four, and every seaborn call in the generated script
would be a line the reader has to install something to edit. A bar chart
is eight lines of matplotlib.

**Bar over pie, by default.** People compare lengths well and angles
badly. Pie and donut stay in the registry because share-of-whole is
sometimes exactly the point, but the pre-ticked box for a low-cardinality
categorical is a horizontal bar.
"""

from __future__ import annotations

# Mirrors the generated script's preamble; see the note in summaries.py.
import re
from collections import Counter
from pathlib import Path

import matplotlib
import numpy as np
import pandas as pd
from scipy import stats

from .portable import portable

matplotlib.use("Agg", force=False)

import matplotlib.pyplot as plt  # noqa: E402 - must follow the backend selection

# --------------------------------------------------------------------------
# Shared drawing helpers
# --------------------------------------------------------------------------


@portable()
def palette():
    """One ordered colour set, used by every figure.

    Chosen for contrast against both a white page and a dark one, since
    a Markdown report gets read in whichever the reader's viewer uses.
    """
    return [
        "#3d5a80", "#ee6c4d", "#98c1d9", "#293241", "#e0a458",
        "#7a9e7e", "#b95f89", "#5c6b73", "#c44536", "#8d99ae",
    ]


@portable()
def box_kwargs(horizontal=True, labels=None):
    """Arguments for boxplot and violinplot that work across matplotlib.

    Two renames sit inside the version range the generated script claims
    to support: ``labels`` became ``tick_labels`` in 3.9, and ``vert``
    became ``orientation`` in 3.10 -- deprecated in 3.11 and gone in 3.13.
    Picking at run time is what lets one emitted script run on a machine
    with 3.8 and on one with 3.13, which a pinned spelling cannot.
    """
    try:
        parts = str(matplotlib.__version__).split(".")
        version = (int(parts[0]), int(parts[1]))
    except (ValueError, IndexError):
        version = (3, 10)
    out = {}
    if version >= (3, 10):
        out["orientation"] = "horizontal" if horizontal else "vertical"
    else:
        out["vert"] = not horizontal
    if labels is not None:
        out["tick_labels" if version >= (3, 9) else "labels"] = list(labels)
    return out


@portable()
def new_figure(width=7.2, height=4.2):
    """A figure with the chrome removed. Every chart starts here."""
    fig, ax = plt.subplots(figsize=(width, height), dpi=110)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis="y", alpha=0.25, linewidth=0.6)
    ax.set_axisbelow(True)
    return fig, ax


@portable()
def finish_figure(fig, ax, title="", caption=""):
    """Title, caption and layout, applied identically to every figure.

    The caption is where a sampling note lands. It is drawn on the figure
    itself rather than only in the report, because figures get copied out
    of reports and the note has to travel with the picture.
    """
    if title:
        ax.set_title(title, fontsize=11, loc="left", pad=10)
    fig.tight_layout()
    if caption:
        fig.subplots_adjust(bottom=0.18)
        fig.text(0.01, 0.01, caption, fontsize=7, color="#6b7280", ha="left", va="bottom")
    return fig


@portable()
def label_bars(ax, bars, values, horizontal=False):
    """Print the count on each bar.

    A bar chart without numbers makes the reader estimate; the numbers
    are the reason they opened the report.
    """
    for bar, value in zip(bars, values, strict=False):
        text = f"{int(value):,}" if float(value).is_integer() else f"{value:,.2f}"
        if horizontal:
            ax.annotate(
                text,
                (bar.get_width(), bar.get_y() + bar.get_height() / 2),
                xytext=(4, 0), textcoords="offset points",
                va="center", fontsize=8, color="#4b5563",
            )
        else:
            ax.annotate(
                text,
                (bar.get_x() + bar.get_width() / 2, bar.get_height()),
                xytext=(0, 3), textcoords="offset points",
                ha="center", fontsize=8, color="#4b5563",
            )


@portable()
def shorten(value, width=28):
    text = str(value)
    return text if len(text) <= width else text[: width - 1] + "…"


@portable()
def empty_figure(message, title="", caption=""):
    """A figure that says why there is no figure.

    Returning None here would leave a hole in a numbered figure list and
    a reader wondering whether the tool crashed. Saying "no non-null
    values" costs one file and answers the question.
    """
    fig, ax = plt.subplots(figsize=(7.2, 2.2), dpi=110)
    ax.axis("off")
    ax.text(0.5, 0.5, message, ha="center", va="center", fontsize=10, color="#6b7280")
    if title:
        ax.set_title(title, fontsize=11, loc="left")
    if caption:
        fig.text(0.01, 0.02, caption, fontsize=7, color="#6b7280")
    fig.tight_layout()
    return fig


# --------------------------------------------------------------------------
# Numeric - continuous
# --------------------------------------------------------------------------


@portable(helpers=["new_figure", "finish_figure", "empty_figure", "palette"])
def chart_histogram(s, title="", caption="", bins=0):
    values = pd.to_numeric(s, errors="coerce").dropna()
    if not len(values):
        return empty_figure("no numeric values to plot", title, caption)
    if bins and bins > 0:
        edges = int(bins)
    else:
        # "auto" is the max of Sturges and Freedman-Diaconis. Capped
        # because a near-unique integer column asks for one bin per value
        # and produces a barcode.
        edges = np.histogram_bin_edges(values, bins="auto")
        if len(edges) > 101:
            edges = np.histogram_bin_edges(values, bins=100)
    fig, ax = new_figure()
    ax.hist(values, bins=edges, color=palette()[0], edgecolor="white", linewidth=0.5)
    ax.set_xlabel(s.name if s.name is not None else "")
    ax.set_ylabel("rows")
    return finish_figure(fig, ax, title, caption)


@portable(helpers=["new_figure", "finish_figure", "empty_figure", "palette", "box_kwargs"])
def chart_box(s, title="", caption="", outlier_rule="iqr"):
    values = pd.to_numeric(s, errors="coerce").dropna()
    if not len(values):
        return empty_figure("no numeric values to plot", title, caption)
    fig, ax = new_figure(height=2.8)
    parts = ax.boxplot(
        values, widths=0.5, patch_artist=True, **box_kwargs(),
        whis=3.0 if outlier_rule == "zscore" else 1.5,
        flierprops={"marker": "o", "markersize": 3, "alpha": 0.35,
                    "markerfacecolor": palette()[1], "markeredgecolor": "none"},
        medianprops={"color": "#111827", "linewidth": 1.4},
    )
    for patch in parts["boxes"]:
        patch.set_facecolor(palette()[2])
        patch.set_edgecolor(palette()[3])
    ax.set_yticks([])
    ax.grid(axis="y", visible=False)
    ax.grid(axis="x", alpha=0.25, linewidth=0.6)
    ax.set_xlabel(s.name if s.name is not None else "")
    return finish_figure(fig, ax, title, caption)


@portable(helpers=["new_figure", "finish_figure", "empty_figure", "palette"])
def chart_kde(s, title="", caption=""):
    values = pd.to_numeric(s, errors="coerce").dropna()
    if values.nunique() < 2:
        return empty_figure("a density needs at least two distinct values", title, caption)
    try:
        density = stats.gaussian_kde(values)
    except (ValueError, np.linalg.LinAlgError):
        return empty_figure("the values are too degenerate for a density estimate",
                            title, caption)
    grid = np.linspace(float(values.min()), float(values.max()), 512)
    fig, ax = new_figure()
    ax.plot(grid, density(grid), color=palette()[0], linewidth=1.6)
    ax.fill_between(grid, density(grid), color=palette()[2], alpha=0.45)
    ax.set_xlabel(s.name if s.name is not None else "")
    ax.set_ylabel("density")
    return finish_figure(fig, ax, title, caption)


@portable(helpers=["new_figure", "finish_figure", "empty_figure", "palette", "box_kwargs"])
def chart_violin(s, title="", caption=""):
    values = pd.to_numeric(s, errors="coerce").dropna()
    if values.nunique() < 2:
        return empty_figure("a violin needs at least two distinct values", title, caption)
    fig, ax = new_figure(height=3.4)
    parts = ax.violinplot(values, showmedians=True, widths=0.7, **box_kwargs())
    for body in parts["bodies"]:
        body.set_facecolor(palette()[2])
        body.set_edgecolor(palette()[3])
        body.set_alpha(0.8)
    for key in ("cbars", "cmins", "cmaxes", "cmedians"):
        if key in parts:
            parts[key].set_color(palette()[3])
    ax.set_yticks([])
    ax.grid(axis="y", visible=False)
    ax.grid(axis="x", alpha=0.25, linewidth=0.6)
    ax.set_xlabel(s.name if s.name is not None else "")
    return finish_figure(fig, ax, title, caption)


@portable(helpers=["new_figure", "finish_figure", "empty_figure", "palette"])
def chart_ecdf(s, title="", caption=""):
    values = pd.to_numeric(s, errors="coerce").dropna().sort_values()
    if not len(values):
        return empty_figure("no numeric values to plot", title, caption)
    y = np.arange(1, len(values) + 1) / len(values)
    fig, ax = new_figure()
    ax.step(values, y, where="post", color=palette()[0], linewidth=1.5)
    ax.set_ylim(0, 1.02)
    ax.set_xlabel(s.name if s.name is not None else "")
    ax.set_ylabel("cumulative share")
    return finish_figure(fig, ax, title, caption)


# --------------------------------------------------------------------------
# Numeric - discrete and boolean
# --------------------------------------------------------------------------


@portable(helpers=["new_figure", "finish_figure", "empty_figure", "palette", "label_bars"])
def chart_count_bar(s, title="", caption="", top_n=25):
    counts = s.dropna().value_counts().sort_index()
    if not len(counts):
        return empty_figure("no values to count", title, caption)
    if len(counts) > top_n:
        counts = s.dropna().value_counts().head(top_n).sort_index()
        caption = (caption + " " if caption else "") + f"showing the {top_n} most common values"
    fig, ax = new_figure()
    bars = ax.bar([str(i) for i in counts.index], counts.to_numpy(), color=palette()[0])
    label_bars(ax, bars, counts.to_numpy())
    ax.set_xlabel(s.name if s.name is not None else "")
    ax.set_ylabel("rows")
    if len(counts) > 12:
        plt.setp(ax.get_xticklabels(), rotation=45, ha="right", fontsize=8)
    return finish_figure(fig, ax, title, caption)


@portable(helpers=["new_figure", "finish_figure", "empty_figure", "palette", "label_bars"])
def chart_bar(s, title="", caption=""):
    counts = s.dropna().astype(str).value_counts()
    if not len(counts):
        return empty_figure("no values to count", title, caption)
    fig, ax = new_figure(height=3.4)
    colors = palette()
    bars = ax.bar(
        [str(i) for i in counts.index],
        counts.to_numpy(),
        color=[colors[i % len(colors)] for i in range(len(counts))],
        width=0.55,
    )
    label_bars(ax, bars, counts.to_numpy())
    ax.set_ylabel("rows")
    return finish_figure(fig, ax, title, caption)


@portable(helpers=["finish_figure", "empty_figure", "palette", "shorten"])
def chart_pie(s, title="", caption="", top_n=8):
    counts = s.dropna().astype(str).value_counts().head(top_n)
    if not len(counts):
        return empty_figure("no values to count", title, caption)
    fig, ax = plt.subplots(figsize=(5.6, 4.4), dpi=110)
    colors = palette()
    ax.pie(
        counts.to_numpy(),
        labels=[shorten(i, 18) for i in counts.index],
        autopct="%1.1f%%",
        colors=[colors[i % len(colors)] for i in range(len(counts))],
        textprops={"fontsize": 9},
        wedgeprops={"edgecolor": "white", "linewidth": 1},
    )
    ax.set_aspect("equal")
    return finish_figure(fig, ax, title, caption)


@portable(helpers=["finish_figure", "empty_figure", "palette", "shorten"])
def chart_donut(s, title="", caption="", top_n=8):
    counts = s.dropna().astype(str).value_counts().head(top_n)
    if not len(counts):
        return empty_figure("no values to count", title, caption)
    fig, ax = plt.subplots(figsize=(5.6, 4.4), dpi=110)
    colors = palette()
    ax.pie(
        counts.to_numpy(),
        labels=[shorten(i, 18) for i in counts.index],
        autopct="%1.1f%%",
        colors=[colors[i % len(colors)] for i in range(len(counts))],
        textprops={"fontsize": 9},
        wedgeprops={"width": 0.42, "edgecolor": "white", "linewidth": 1},
    )
    ax.set_aspect("equal")
    ax.text(0, 0, f"{int(counts.sum()):,}", ha="center", va="center", fontsize=12)
    return finish_figure(fig, ax, title, caption)


# --------------------------------------------------------------------------
# Categorical
# --------------------------------------------------------------------------


@portable(helpers=["new_figure", "finish_figure", "empty_figure", "palette",
                   "label_bars", "shorten"])
def chart_hbar(s, title="", caption="", top_n=15):
    counts = s.dropna().astype(str).value_counts().head(top_n)
    if not len(counts):
        return empty_figure("no values to count", title, caption)
    height = max(2.4, 0.34 * len(counts) + 1.2)
    fig, ax = new_figure(height=height)
    labels = [shorten(i) for i in counts.index][::-1]
    values = counts.to_numpy()[::-1]
    bars = ax.barh(labels, values, color=palette()[0], height=0.68)
    label_bars(ax, bars, values, horizontal=True)
    ax.grid(axis="y", visible=False)
    ax.grid(axis="x", alpha=0.25, linewidth=0.6)
    ax.set_xlabel("rows")
    ax.margins(x=0.12)
    return finish_figure(fig, ax, title, caption)


@portable(helpers=["new_figure", "finish_figure", "empty_figure", "palette",
                   "label_bars", "shorten"])
def chart_top_bar(s, title="", caption="", top_n=15):
    counts = s.dropna().astype(str).value_counts()
    if not len(counts):
        return empty_figure("no values to count", title, caption)
    head = counts.head(top_n)
    covered = float(head.sum() / counts.sum())
    note = f"top {len(head)} of {len(counts):,} levels, covering {covered:.1%} of rows"
    height = max(2.4, 0.34 * len(head) + 1.2)
    fig, ax = new_figure(height=height)
    labels = [shorten(i) for i in head.index][::-1]
    values = head.to_numpy()[::-1]
    bars = ax.barh(labels, values, color=palette()[0], height=0.68)
    label_bars(ax, bars, values, horizontal=True)
    ax.grid(axis="y", visible=False)
    ax.grid(axis="x", alpha=0.25, linewidth=0.6)
    ax.set_xlabel("rows")
    ax.margins(x=0.12)
    return finish_figure(fig, ax, title, (caption + " " if caption else "") + note)


@portable(helpers=["new_figure", "finish_figure", "empty_figure", "palette"])
def chart_coverage_curve(s, title="", caption=""):
    """How many levels it takes to cover the column.

    The answer to "is the long tail worth keeping". A curve that reaches
    90% in twelve levels is a categorical variable; one that climbs in a
    straight line is a near-identifier wearing a category's clothes.
    """
    counts = s.dropna().value_counts()
    if not len(counts):
        return empty_figure("no values to count", title, caption)
    cumulative = counts.cumsum() / counts.sum()
    fig, ax = new_figure()
    ax.plot(np.arange(1, len(cumulative) + 1), cumulative.to_numpy(),
            color=palette()[0], linewidth=1.6)
    for mark in (0.5, 0.8, 0.95):
        if float(cumulative.iloc[-1]) >= mark:
            reached = int(np.searchsorted(cumulative.to_numpy(), mark) + 1)
            ax.axhline(mark, color=palette()[1], linewidth=0.8, linestyle=":", alpha=0.8)
            ax.annotate(f"{mark:.0%} at {reached:,}", (reached, mark), xytext=(4, -10),
                        textcoords="offset points", fontsize=8, color="#4b5563")
    ax.set_xlabel("levels, most common first")
    ax.set_ylabel("cumulative share of rows")
    ax.set_ylim(0, 1.02)
    return finish_figure(fig, ax, title, caption)


@portable(helpers=["new_figure", "finish_figure", "empty_figure", "palette", "shorten"])
def chart_stacked_vs_target(s, target, title="", caption="", top_n=12):
    """Each level of the column, split by the target.

    Shares rather than counts: a level with forty rows and one with four
    thousand are equally readable, and the question the chart answers is
    "does the target rate differ by level", not "which level is big".
    """
    frame = pd.DataFrame({"level": s.astype(str), "target": target.astype(str)}).dropna()
    if not len(frame):
        return empty_figure("no rows where both columns are present", title, caption)
    keep = frame["level"].value_counts().head(top_n).index
    frame = frame[frame["level"].isin(keep)]
    table = pd.crosstab(frame["level"], frame["target"], normalize="index")
    table = table.loc[[level for level in keep if level in table.index]]
    height = max(2.6, 0.36 * len(table) + 1.4)
    fig, ax = new_figure(height=height)
    colors = palette()
    left = np.zeros(len(table))
    labels = [shorten(i) for i in table.index]
    for index, column in enumerate(table.columns):
        values = table[column].to_numpy()
        ax.barh(labels, values, left=left, color=colors[index % len(colors)],
                label=shorten(column, 18), height=0.68)
        left = left + values
    ax.set_xlim(0, 1)
    ax.grid(axis="y", visible=False)
    ax.grid(axis="x", alpha=0.25, linewidth=0.6)
    ax.set_xlabel(f"share of rows by {target.name}")
    ax.legend(fontsize=8, frameon=False, ncol=min(len(table.columns), 4),
              loc="lower center", bbox_to_anchor=(0.5, 1.0))
    return finish_figure(fig, ax, title, caption)


# --------------------------------------------------------------------------
# Datetime
# --------------------------------------------------------------------------


@portable()
def pick_resample(span_days, wanted="auto"):
    """A period that puts a readable number of points on the axis.

    Fixed at daily, a five-year column becomes 1,800 points of noise and
    a two-hour column becomes one bar.
    """
    if wanted and wanted != "auto":
        return wanted
    if span_days <= 2:
        return "h"
    if span_days <= 90:
        return "D"
    if span_days <= 730:
        return "W"
    if span_days <= 3650:
        return "ME"
    return "YE"


@portable(helpers=["new_figure", "finish_figure", "empty_figure", "palette", "pick_resample"])
def chart_line(s, title="", caption="", resample="auto", date_format=None):
    values = (
        s.dropna()
        if pd.api.types.is_datetime64_any_dtype(s)
        else pd.to_datetime(
            s, errors="coerce",
            **({"format": date_format} if date_format and date_format != "ISO8601" else {}),
        ).dropna()
    )
    if len(values) < 2:
        return empty_figure("fewer than two timestamps to plot", title, caption)
    span = (values.max() - values.min()).total_seconds() / 86400.0
    rule = pick_resample(span, resample)
    counts = pd.Series(1, index=pd.DatetimeIndex(values)).resample(rule).sum()
    names = {"h": "hour", "D": "day", "W": "week", "ME": "month", "YE": "year"}
    fig, ax = new_figure()
    ax.plot(counts.index, counts.to_numpy(), color=palette()[0], linewidth=1.4)
    ax.fill_between(counts.index, counts.to_numpy(), color=palette()[2], alpha=0.35)
    ax.set_ylabel("rows per " + names.get(rule, rule))
    fig.autofmt_xdate(rotation=30, ha="right")
    return finish_figure(fig, ax, title, caption)


@portable(helpers=["new_figure", "finish_figure", "empty_figure", "palette"])
def chart_gap_plot(s, title="", caption="", date_format=None):
    """Time between consecutive observations, in order.

    Spikes are the missing weeks. A flat line is a regular series, and a
    staircase is a series someone backfilled.
    """
    values = (
        s.dropna()
        if pd.api.types.is_datetime64_any_dtype(s)
        else pd.to_datetime(
            s, errors="coerce",
            **({"format": date_format} if date_format and date_format != "ISO8601" else {}),
        ).dropna()
    )
    values = values.sort_values()
    if len(values) < 3:
        return empty_figure("fewer than three timestamps to compare", title, caption)
    deltas = values.diff().dropna().dt.total_seconds() / 86400.0
    fig, ax = new_figure()
    ax.plot(values.to_numpy()[1:], deltas.to_numpy(), color=palette()[0],
            linewidth=0.9, marker="o", markersize=2, alpha=0.8)
    median = float(deltas.median())
    ax.axhline(median, color=palette()[1], linestyle="--", linewidth=0.9)
    ax.annotate(f"median {median:.2f} d", (0.99, median), xycoords=("axes fraction", "data"),
                ha="right", va="bottom", fontsize=8, color="#4b5563")
    ax.set_ylabel("days since previous row")
    fig.autofmt_xdate(rotation=30, ha="right")
    return finish_figure(fig, ax, title, caption)


@portable(helpers=["new_figure", "finish_figure", "empty_figure", "palette", "label_bars"])
def chart_period_hist(s, title="", caption="", date_format=None):
    """Rows by month of year -- the seasonal shape, if there is one."""
    values = (
        s.dropna()
        if pd.api.types.is_datetime64_any_dtype(s)
        else pd.to_datetime(
            s, errors="coerce",
            **({"format": date_format} if date_format and date_format != "ISO8601" else {}),
        ).dropna()
    )
    if not len(values):
        return empty_figure("no timestamps to plot", title, caption)
    names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
             "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    counts = pd.DatetimeIndex(values).month.value_counts().reindex(range(1, 13), fill_value=0)
    fig, ax = new_figure()
    bars = ax.bar(names, counts.to_numpy(), color=palette()[0], width=0.6)
    label_bars(ax, bars, counts.to_numpy())
    ax.set_ylabel("rows")
    return finish_figure(fig, ax, title, caption)


# --------------------------------------------------------------------------
# Free text
# --------------------------------------------------------------------------


@portable(helpers=["new_figure", "finish_figure", "empty_figure", "palette"])
def chart_length_hist(s, title="", caption=""):
    lengths = s.dropna().astype(str).str.len()
    if not len(lengths):
        return empty_figure("no text to measure", title, caption)
    fig, ax = new_figure()
    bins = int(min(60, max(10, lengths.nunique())))
    ax.hist(lengths, bins=bins, color=palette()[0], edgecolor="white", linewidth=0.5)
    ax.set_xlabel("characters")
    ax.set_ylabel("rows")
    return finish_figure(fig, ax, title, caption)


@portable(helpers=["new_figure", "finish_figure", "empty_figure", "palette",
                   "label_bars", "shorten"])
def chart_top_tokens(s, title="", caption="", top_n=20):
    text = s.dropna().astype(str).head(20000)
    counter = Counter()
    for value in text:
        for token in re.findall(r"[A-Za-z0-9']+", value.casefold()):
            counter[token] += 1
    common = counter.most_common(top_n)
    if not common:
        return empty_figure("no words to count", title, caption)
    height = max(2.4, 0.32 * len(common) + 1.2)
    fig, ax = new_figure(height=height)
    labels = [shorten(word, 20) for word, _ in common][::-1]
    values = np.array([hits for _, hits in common])[::-1]
    bars = ax.barh(labels, values, color=palette()[0], height=0.68)
    label_bars(ax, bars, values, horizontal=True)
    ax.grid(axis="y", visible=False)
    ax.grid(axis="x", alpha=0.25, linewidth=0.6)
    ax.set_xlabel("occurrences")
    ax.margins(x=0.12)
    return finish_figure(fig, ax, title, caption)


# --------------------------------------------------------------------------
# Saving
# --------------------------------------------------------------------------


@portable()
def save_figure(fig, path, figure_format="png", dpi=110):
    """Write a figure and close it.

    Closing matters more than it looks: matplotlib keeps every unclosed
    figure alive, and a 200-column dataset with four charts each will
    exhaust memory long before it exhausts the column list.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, format=figure_format, dpi=dpi, bbox_inches="tight",
                facecolor="white", edgecolor="none")
    plt.close(fig)
    return path
