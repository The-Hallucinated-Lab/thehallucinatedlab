"""Tier 2: what the columns do to each other.

Tier 1 is profiling -- forty ``df.info()`` calls done for you. This is
the part that makes the tool exploratory data analysis rather than a
``describe()`` wrapper, and it is the part the drafted catalogue was
missing: correlation, missingness structure, duplicate rows, and -- when
a target is named -- how each feature moves with it.

Same portability contract as the rest: every function here is copied into
the generated script, so no imports from this package and no shared
constants. Mutual information is computed from contingency tables rather
than pulled from scikit-learn, which keeps the extra at four dependencies
and the generated script installable from the same four.
"""

from __future__ import annotations

# Mirrors the generated script's preamble; see the note in summaries.py.
from pathlib import Path

import matplotlib
import numpy as np
import pandas as pd
from scipy import stats

from .charts import box_kwargs
from .portable import portable

matplotlib.use("Agg", force=False)

import matplotlib.pyplot as plt  # noqa: E402 - must follow the backend selection

# --------------------------------------------------------------------------
# Correlation
# --------------------------------------------------------------------------


@portable()
def cramers_v(a, b):
    """Association between two categorical columns, 0 to 1.

    Bias-corrected: the uncorrected statistic drifts upward as the number
    of levels grows, so a pair of high-cardinality columns scores high on
    nothing but its own cardinality.
    """
    table = pd.crosstab(a, b)
    if table.size == 0 or table.shape[0] < 2 or table.shape[1] < 2:
        return None
    chi2 = stats.chi2_contingency(table, correction=False)[0]
    n = int(table.to_numpy().sum())
    if n == 0:
        return None
    phi2 = chi2 / n
    rows, cols = table.shape
    phi2_corrected = max(0.0, phi2 - ((cols - 1) * (rows - 1)) / max(n - 1, 1))
    rows_corrected = rows - ((rows - 1) ** 2) / max(n - 1, 1)
    cols_corrected = cols - ((cols - 1) ** 2) / max(n - 1, 1)
    denominator = min(cols_corrected - 1, rows_corrected - 1)
    if denominator <= 0:
        return None
    return float(np.sqrt(phi2_corrected / denominator))


@portable()
def correlation_matrix(frame, columns, method="pearson"):
    """A square matrix as nested lists, ready for JSON and for a heatmap."""
    subset = frame[columns].apply(pd.to_numeric, errors="coerce")
    matrix = subset.corr(method=method, numeric_only=False)
    return {
        "columns": [str(c) for c in matrix.columns],
        "values": [[None if pd.isna(v) else float(v) for v in row] for row in matrix.to_numpy()],
    }


@portable(helpers=["cramers_v"])
def cramers_matrix(frame, columns):
    values = []
    for left in columns:
        row = []
        for right in columns:
            if left == right:
                row.append(1.0)
            else:
                result = cramers_v(frame[left], frame[right])
                row.append(None if result is None else float(result))
        values.append(row)
    return {"columns": [str(c) for c in columns], "values": values}


@portable()
def chart_heatmap(matrix, title="", caption="", diverging=True):
    """One square matrix, drawn.

    Numbers are printed in the cells whenever there is room. A heatmap
    with no numbers is a mood board -- the reader still has to know
    whether that blue square is 0.31 or 0.62.
    """
    labels = matrix["columns"]
    data = np.array(
        [[np.nan if v is None else float(v) for v in row] for row in matrix["values"]],
        dtype=float,
    )
    if not data.size:
        fig, ax = plt.subplots(figsize=(6, 2), dpi=110)
        ax.axis("off")
        ax.text(0.5, 0.5, "not enough columns to correlate", ha="center", va="center",
                fontsize=10, color="#6b7280")
        return fig

    size = max(4.0, min(0.55 * len(labels) + 2.2, 14.0))
    fig, ax = plt.subplots(figsize=(size, size * 0.86), dpi=110)
    limit = 1.0 if diverging else float(np.nanmax(np.abs(data)) or 1.0)
    image = ax.imshow(
        data,
        cmap="RdBu_r" if diverging else "Blues",
        vmin=-limit if diverging else 0.0,
        vmax=limit,
    )
    ax.set_xticks(range(len(labels)))
    ax.set_yticks(range(len(labels)))
    ax.set_xticklabels(labels, rotation=45, ha="right", fontsize=8)
    ax.set_yticklabels(labels, fontsize=8)
    ax.grid(visible=False)
    if len(labels) <= 16:
        for i in range(len(labels)):
            for j in range(len(labels)):
                value = data[i, j]
                if np.isnan(value):
                    continue
                shade = "white" if abs(value) > limit * 0.6 else "#111827"
                ax.text(j, i, f"{value:.2f}", ha="center", va="center",
                        fontsize=7, color=shade)
    fig.colorbar(image, ax=ax, fraction=0.045, pad=0.03)
    if title:
        ax.set_title(title, fontsize=11, loc="left", pad=10)
    fig.tight_layout()
    if caption:
        fig.text(0.01, 0.005, caption, fontsize=7, color="#6b7280")
    return fig


@portable()
def strongest_pairs(matrix, limit=10, floor=0.3):
    """The pairs worth reading, strongest first.

    A 30-column matrix has 435 pairs. Nobody reads 435 numbers, so the
    report leads with the ones above the floor and leaves the rest in the
    figure and in ``summary.json``.
    """
    labels = matrix["columns"]
    found = []
    for i in range(len(labels)):
        for j in range(i + 1, len(labels)):
            value = matrix["values"][i][j]
            if value is None or not np.isfinite(value):
                continue
            if abs(float(value)) >= floor:
                found.append({"a": labels[i], "b": labels[j], "value": float(value)})
    found.sort(key=lambda item: -abs(item["value"]))
    return found[:limit]


# --------------------------------------------------------------------------
# Missingness
# --------------------------------------------------------------------------


@portable()
def missingness_table(frame):
    """Null count per column, worst first, plus how often pairs go missing together.

    The pair number is the one that matters. Two columns that are always
    null on the same rows are usually one fact that was not collected,
    not two independent gaps, and that changes what you do about it.
    """
    mask = frame.isna()
    counts = mask.sum().sort_values(ascending=False)
    total = int(len(frame))
    columns = [str(c) for c in counts.index if int(counts[c]) > 0]
    per_column = [
        {"column": str(name), "nulls": int(counts[name]),
         "share": (int(counts[name]) / total) if total else 0.0}
        for name in counts.index
    ]
    values = []
    for left in columns:
        row = []
        for right in columns:
            both = int((mask[left] & mask[right]).sum())
            either = int((mask[left] | mask[right]).sum())
            row.append(float(both / either) if either else 0.0)
        values.append(row)
    return {
        "per_column": per_column,
        "columns_with_nulls": columns,
        "cooccurrence": {"columns": columns, "values": values},
        "complete_rows": int((~mask.any(axis=1)).sum()),
        "rows": total,
    }


@portable()
def chart_missing_bar(table, title="", caption=""):
    entries = [row for row in table["per_column"] if row["nulls"] > 0][:40]
    if not entries:
        fig, ax = plt.subplots(figsize=(7.2, 2.0), dpi=110)
        ax.axis("off")
        ax.text(0.5, 0.5, "no nulls anywhere in the dataset", ha="center", va="center",
                fontsize=10, color="#6b7280")
        return fig
    height = max(2.4, 0.32 * len(entries) + 1.2)
    fig, ax = plt.subplots(figsize=(7.2, height), dpi=110)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    names = [row["column"] for row in entries][::-1]
    shares = [row["share"] for row in entries][::-1]
    ax.barh(names, shares, color="#ee6c4d", height=0.68)
    for index, row in enumerate(entries[::-1]):
        ax.annotate(f"{row['share']:.1%}  ({row['nulls']:,})", (row["share"], index),
                    xytext=(4, 0), textcoords="offset points", va="center",
                    fontsize=8, color="#4b5563")
    ax.set_xlim(0, 1)
    ax.set_xlabel("share of rows that are null")
    ax.grid(axis="x", alpha=0.25, linewidth=0.6)
    ax.set_axisbelow(True)
    if title:
        ax.set_title(title, fontsize=11, loc="left", pad=10)
    ax.margins(x=0.16)
    fig.tight_layout()
    if caption:
        fig.text(0.01, 0.005, caption, fontsize=7, color="#6b7280")
    return fig


# --------------------------------------------------------------------------
# Duplicates
# --------------------------------------------------------------------------


@portable()
def duplicate_counts(frame, subset=None):
    """Exact duplicate rows, and near-duplicates.

    "Near" is defined and reported rather than left to the reader's
    imagination: text is case-folded and whitespace-collapsed, floats are
    rounded to six significant figures. That catches the same record
    entered twice by two people and does not catch two genuinely
    different measurements.
    """
    working = frame if subset is None else frame[subset]
    exact = int(working.duplicated().sum())

    normalised = working.copy()
    for name in normalised.columns:
        column = normalised[name]
        if pd.api.types.is_float_dtype(column):
            normalised[name] = column.round(6)
        elif not pd.api.types.is_numeric_dtype(column):
            normalised[name] = (
                column.astype(str).str.strip().str.casefold().str.replace(r"\s+", " ", regex=True)
            )
    near = int(normalised.duplicated().sum())
    total = int(len(working))
    return {
        "rows": total,
        "exact": exact,
        "exact_share": (exact / total) if total else 0.0,
        "near": near,
        "near_share": (near / total) if total else 0.0,
        "near_rule": "case-folded text, whitespace collapsed, floats rounded to 6 decimals",
        "columns_compared": [str(c) for c in working.columns],
    }


# --------------------------------------------------------------------------
# Target versus features
# --------------------------------------------------------------------------


@portable()
def bin_for_mi(series, bins=10, numeric=True):
    """Discretise a column so mutual information can be computed on it.

    Two different reductions, and both are about the same bias: mutual
    information grows with the number of distinct values whether or not
    the column knows anything about the target. A column with one level
    per row scores near-maximally against everything.

    * Numeric columns get quantile bins, not equal-width ones. An
      equal-width bin on a skewed column puts 98% of the rows in bin one
      and measures nothing.
    * Categorical columns are cut to their most common levels with the
      rest folded into one bucket. Without this, a customer id with
      thirteen hundred levels outranks the region that actually predicts
      the target -- which puts noise at the top of the list the reader is
      being asked to trust.
    """
    if numeric:
        values = pd.to_numeric(series, errors="coerce")
        if values.notna().sum() == 0:
            return series.astype(str)
        try:
            return pd.qcut(values, q=bins, duplicates="drop").astype(str)
        except (ValueError, TypeError):
            return values.astype(str)

    text = series.astype(str)
    counts = text.value_counts()
    if len(counts) <= bins * 2:
        return text
    keep = set(counts.head(bins * 2).index)
    return text.where(text.isin(keep), "(other)")


@portable(helpers=["bin_for_mi"])
def mutual_information(frame, target, columns, numeric_columns, bins=10):
    """Mutual information between each feature and the target, in bits.

    Computed from the contingency table directly. Numeric columns are
    quantile-binned first, which is why the number is a *ranking* device
    and not a physical quantity -- the report says so where it prints it.
    """
    target_values = bin_for_mi(frame[target], bins, numeric=target in numeric_columns)

    ranked = []
    for name in columns:
        if name == target:
            continue
        feature = bin_for_mi(frame[name], bins, numeric=name in numeric_columns)
        pair = pd.DataFrame({"f": feature, "t": target_values}).dropna()
        if len(pair) < 2:
            continue
        table = pd.crosstab(pair["f"], pair["t"]).to_numpy(dtype=float)
        total = table.sum()
        if total <= 0 or table.shape[0] < 2:
            continue
        joint = table / total
        rows = joint.sum(axis=1, keepdims=True)
        cols = joint.sum(axis=0, keepdims=True)
        with np.errstate(divide="ignore", invalid="ignore"):
            terms = joint * np.log2(joint / (rows * cols))
        score = float(np.nansum(np.where(joint > 0, terms, 0.0)))
        entropy = float(-np.nansum(np.where(rows > 0, rows * np.log2(rows), 0.0)))
        ranked.append({
            "column": str(name),
            "bits": max(score, 0.0),
            "normalised": (max(score, 0.0) / entropy) if entropy > 0 else 0.0,
        })
    ranked.sort(key=lambda item: -item["bits"])
    return ranked


@portable()
def chart_mi_bar(ranked, target, title="", caption="", top_n=20):
    entries = ranked[:top_n]
    if not entries:
        fig, ax = plt.subplots(figsize=(7.2, 2.0), dpi=110)
        ax.axis("off")
        ax.text(0.5, 0.5, "no features could be ranked against the target",
                ha="center", va="center", fontsize=10, color="#6b7280")
        return fig
    height = max(2.4, 0.32 * len(entries) + 1.2)
    fig, ax = plt.subplots(figsize=(7.2, height), dpi=110)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    names = [row["column"] for row in entries][::-1]
    scores = [row["bits"] for row in entries][::-1]
    ax.barh(names, scores, color="#3d5a80", height=0.68)
    for index, value in enumerate(scores):
        ax.annotate(f"{value:.3f}", (value, index), xytext=(4, 0),
                    textcoords="offset points", va="center", fontsize=8, color="#4b5563")
    ax.set_xlabel(f"mutual information with {target} (bits)")
    ax.grid(axis="x", alpha=0.25, linewidth=0.6)
    ax.set_axisbelow(True)
    ax.margins(x=0.14)
    if title:
        ax.set_title(title, fontsize=11, loc="left", pad=10)
    fig.tight_layout()
    if caption:
        fig.text(0.01, 0.005, caption, fontsize=7, color="#6b7280")
    return fig


@portable(helpers=["box_kwargs"])
def chart_target_numeric(s, target, title="", caption="", top_n=8):
    """One numeric feature, distributed within each target class.

    Box plots side by side rather than overlaid densities: overlaid
    densities look better and are harder to read past three classes.
    """
    frame = pd.DataFrame({
        "value": pd.to_numeric(s, errors="coerce"),
        "group": target.astype(str),
    }).dropna()
    if not len(frame):
        fig, ax = plt.subplots(figsize=(7.2, 2.0), dpi=110)
        ax.axis("off")
        ax.text(0.5, 0.5, "no rows where both columns are present", ha="center",
                va="center", fontsize=10, color="#6b7280")
        return fig
    keep = frame["group"].value_counts().head(top_n).index
    frame = frame[frame["group"].isin(keep)]
    groups = [frame.loc[frame["group"] == level, "value"].to_numpy() for level in keep]
    fig, ax = plt.subplots(figsize=(7.2, max(3.0, 0.4 * len(keep) + 2.0)), dpi=110)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    parts = ax.boxplot(groups, patch_artist=True, widths=0.6,
                       **box_kwargs(labels=[str(level) for level in keep]),
                       flierprops={"marker": "o", "markersize": 2.5, "alpha": 0.3,
                                   "markerfacecolor": "#ee6c4d", "markeredgecolor": "none"},
                       medianprops={"color": "#111827", "linewidth": 1.3})
    for patch in parts["boxes"]:
        patch.set_facecolor("#98c1d9")
        patch.set_edgecolor("#293241")
    ax.set_xlabel(s.name if s.name is not None else "value")
    ax.set_ylabel(target.name if target.name is not None else "target")
    ax.grid(axis="x", alpha=0.25, linewidth=0.6)
    ax.set_axisbelow(True)
    if title:
        ax.set_title(title, fontsize=11, loc="left", pad=10)
    fig.tight_layout()
    if caption:
        fig.text(0.01, 0.005, caption, fontsize=7, color="#6b7280")
    return fig


@portable()
def target_overview(frame, target):
    """What the target itself looks like -- the first thing to check.

    A 99/1 class split makes every downstream number mean something
    different, and it is worth knowing before reading the rankings.
    """
    values = frame[target].dropna()
    if not len(values):
        return {"column": str(target), "note": "the target column is entirely null"}
    if pd.api.types.is_numeric_dtype(values) and values.nunique() > 12:
        return {
            "column": str(target),
            "kind": "numeric",
            "mean": float(values.mean()),
            "median": float(values.median()),
            "min": float(values.min()),
            "max": float(values.max()),
            "nulls": int(frame[target].isna().sum()),
        }
    counts = values.astype(str).value_counts()
    total = int(counts.sum())
    return {
        "column": str(target),
        "kind": "categorical",
        "levels": [
            {"value": str(index), "count": int(value), "share": int(value) / total}
            for index, value in counts.head(20).items()
        ],
        "distinct": int(len(counts)),
        "nulls": int(frame[target].isna().sum()),
        "imbalance": float(counts.iloc[0] / total) if total else 0.0,
    }


# --------------------------------------------------------------------------
# The data half of each Tier 2 analysis
#
# Split out from the drivers below so the generated script can build the
# identical dictionary. Everything that ends up in summary.json comes from
# one of these four; the drivers add only figures, which are compared by
# eye rather than diffed.
# --------------------------------------------------------------------------


@portable(helpers=["correlation_matrix", "cramers_matrix", "strongest_pairs"])
def correlation_data(frame, numeric, categorical):
    data = {}
    if len(numeric) >= 2:
        for method in ("pearson", "spearman"):
            matrix = correlation_matrix(frame, numeric, method=method)
            data[method] = matrix
            data[method + "_top"] = strongest_pairs(matrix)
    if len(categorical) >= 2:
        matrix = cramers_matrix(frame, categorical)
        data["cramers_v"] = matrix
        data["cramers_v_top"] = strongest_pairs(matrix, floor=0.2)
    return data


@portable(helpers=["missingness_table"])
def missingness_data(frame):
    return missingness_table(frame)


@portable(helpers=["duplicate_counts"])
def duplicates_data(frame):
    return duplicate_counts(frame)


@portable()
def target_features(frame, types):
    """Columns worth ranking against a target.

    Keys, constants and empty columns are excluded rather than ranked and
    then ignored: a primary key scores high against everything, which puts
    noise at the top of the list the reader is meant to trust.

    Raw timestamps and free text are excluded for the same reason and one
    more. Both are near-unique, so they inherit the cardinality bias, and
    both only mean something against a target after feature engineering --
    a day-of-week column, a token count, a sentiment score. Feature
    engineering is a stated non-goal, so ranking them here would be
    offering an answer the tool cannot follow through on.
    """
    skip = ("identifier", "constant", "empty", "unsupported", "datetime", "free_text")
    return [str(name) for name in frame.columns if types.get(str(name)) not in skip]


@portable(helpers=["target_overview", "mutual_information"])
def target_data(frame, target, considered, numeric):
    ranked = mutual_information(frame, target, considered, numeric)
    return {
        "overview": target_overview(frame, target),
        "mutual_information": ranked,
        "mutual_information_note": (
            "Numeric features are quantile-binned into 10 buckets before the score is "
            "computed, so it ranks features against each other rather than measuring a "
            "physical quantity."
        ),
    }


@portable()
def save_relation_figure(fig, path, figure_format="png", dpi=110):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, format=figure_format, dpi=dpi, bbox_inches="tight",
                facecolor="white", edgecolor="none")
    plt.close(fig)
    return path


# --------------------------------------------------------------------------
# Drivers
#
# Below this line nothing is portable. These four are what the registry's
# RelationSpec entries name: they pick the columns, call the portable
# functions above, hand the figures to the sink, and return a result the
# report can render. The generated script emits its own equivalent driver
# inline, which is why these are allowed to know about paths and options
# and the portable half above is not.
# --------------------------------------------------------------------------


def _numeric_columns(types: dict[str, str]) -> list[str]:
    return [name for name, kind in types.items()
            if kind in ("numeric_continuous", "numeric_discrete")]


def _categorical_columns(types: dict[str, str]) -> list[str]:
    return [name for name, kind in types.items()
            if kind in ("categorical_low", "boolean")]


def relate_correlation(frame, types, sink, options=None, target=None):
    """Pearson, Spearman and Cramer's V, each only where it means something."""
    from .types import RelationResult  # noqa: PLC0415 - avoids a cycle at import time

    options = options or {}
    result = RelationResult(kind="correlation")
    numeric = [name for name in _numeric_columns(types) if name in frame.columns]
    categorical = [name for name in _categorical_columns(types) if name in frame.columns]
    result.data = correlation_data(frame, numeric, categorical)

    if len(numeric) >= 2:
        for method in ("pearson", "spearman"):
            label = "Pearson" if method == "pearson" else "Spearman (rank)"
            result.figures.append(
                sink.save(
                    chart_heatmap(result.data[method], title=f"{label} correlation"),
                    chart=f"correlation_{method}",
                    title=f"{label} correlation",
                )
            )
    else:
        result.warnings.append(
            "Correlation needs at least two numeric columns; this dataset has "
            f"{len(numeric)}."
        )

    if len(categorical) >= 2:
        result.figures.append(
            sink.save(
                chart_heatmap(result.data["cramers_v"],
                              title="Cramer's V (categorical association)", diverging=False),
                chart="correlation_cramers_v",
                title="Cramer's V",
            )
        )
    elif categorical:
        result.warnings.append(
            "Cramer's V needs at least two categorical columns; this dataset has "
            f"{len(categorical)}."
        )
    return result


def relate_missingness(frame, types, sink, options=None, target=None):
    """Which columns are missing, and which go missing together."""
    from .types import RelationResult  # noqa: PLC0415 - avoids a cycle at import time

    result = RelationResult(kind="missingness")
    table = missingness_data(frame)
    result.data = table
    result.figures.append(
        sink.save(
            chart_missing_bar(table, title="Missing values by column"),
            chart="missingness_bar",
            title="Missing values by column",
        )
    )
    columns = table["cooccurrence"]["columns"]
    if len(columns) >= 2:
        result.figures.append(
            sink.save(
                chart_heatmap(
                    table["cooccurrence"],
                    title="Missing together (Jaccard overlap of null rows)",
                    diverging=False,
                ),
                chart="missingness_cooccurrence",
                title="Missing together",
            )
        )
    elif not columns:
        result.warnings.append("No column in this dataset has a null value.")
    return result


def relate_duplicates(frame, types, sink, options=None, target=None):
    """Exact and near-duplicate row counts. No figure: it is two numbers."""
    from .types import RelationResult  # noqa: PLC0415 - avoids a cycle at import time

    result = RelationResult(kind="duplicates")
    result.data = duplicates_data(frame)
    return result


def relate_target(frame, types, sink, options=None, target=None):
    """Every feature against the named target."""
    from .errors import ColumnNotFound  # noqa: PLC0415 - avoids a cycle at import time
    from .types import RelationResult  # noqa: PLC0415

    options = options or {}
    result = RelationResult(kind="target")
    if not target:
        result.warnings.append("Target analysis was requested without --target; skipped.")
        return result
    if target not in frame.columns:
        raise ColumnNotFound(f"Target column {target!r} is not in the dataset.")

    top_n = int(options.get("top_n", 15))
    numeric = [name for name in _numeric_columns(types) if name in frame.columns]
    categorical = [name for name in _categorical_columns(types) if name in frame.columns]
    considered = target_features(frame, types)

    result.data = target_data(frame, target, considered, numeric)
    ranked = result.data["mutual_information"]
    result.figures.append(
        sink.save(
            chart_mi_bar(ranked, target, title=f"Feature ranking against {target}"),
            chart="target_mutual_information",
            title=f"Mutual information with {target}",
        )
    )

    # The strongest few features get a picture each. Drawing all of them
    # on a wide dataset produces a report nobody scrolls to the end of.
    shown = [row["column"] for row in ranked[:6]]
    for name in shown:
        try:
            if name in numeric:
                figure = chart_target_numeric(
                    frame[name], frame[target], title=f"{name} by {target}", top_n=top_n
                )
                chart_name = "target_numeric"
            elif name in categorical:
                from .charts import chart_stacked_vs_target  # noqa: PLC0415

                figure = chart_stacked_vs_target(
                    frame[name], frame[target], title=f"{name} by {target}", top_n=top_n
                )
                chart_name = "target_stacked"
            else:
                continue
        except Exception as err:  # noqa: BLE001 - one bad column must not lose the rest
            result.warnings.append(f"{name} vs {target}: {type(err).__name__}: {err}")
            continue
        result.figures.append(
            sink.save(figure, chart=chart_name, column=str(name), title=f"{name} by {target}")
        )
    return result
