"""Every number the report prints, computed once and shipped twice.

Each function here is :func:`~.portable.portable`: it uses only pandas,
numpy, scipy and the standard library, and ``script.py`` copies its
source verbatim into the generated ``analysis.py``. That is what makes
the promise in the PRD -- "``analysis.py`` reproduces ``summary.json``
exactly" -- true by construction rather than by a test that keeps two
implementations in step.

The consequence, and it is a real constraint: **nothing in this module
may import from this package.** No shared constants, no helpers from
``types.py``, no clever base classes. A duplicated boolean vocabulary
here is the price of the guarantee, and the duplicate is checked against
the original in ``tests/test_portable.py``.

Every function takes the column as its first argument and returns plain
Python -- ints, floats, strings, lists and dicts of the same. numpy
scalars are converted at the edge, because ``json.dump`` does not know
what an ``np.int64`` is and the failure appears three modules away.
"""

from __future__ import annotations

# These mirror the generated script's preamble exactly. A portable
# function's body resolves names against *this* module when it runs here
# and against the script's preamble when it runs there, so the two import
# blocks have to agree -- ``tests/test_portable.py`` checks that they do.
import math
import re
from collections import Counter

import pandas as pd

from .portable import portable

# --------------------------------------------------------------------------
# Shared helpers, also emitted into the generated script
# --------------------------------------------------------------------------


@portable()
def jsonable(value):
    """Convert numpy and pandas scalars into things ``json.dump`` accepts.

    Applied to whole summary structures rather than at each leaf, so a
    new summary cannot forget to do it.
    """
    if value is None or isinstance(value, bool | str):
        return value
    if isinstance(value, dict):
        return {str(k): jsonable(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [jsonable(v) for v in value]
    if isinstance(value, int | float):
        # NaN and infinity are not JSON. Null is the honest encoding of
        # "there is no number here", and every consumer already handles it.
        if isinstance(value, float) and not math.isfinite(value):
            return None
        return value
    if hasattr(value, "item"):
        try:
            return jsonable(value.item())
        except (ValueError, AttributeError):
            # Not every object with .item() is a numpy scalar -- a dict has
            # one too, and an array with more than one element raises. Both
            # fall through to the checks below rather than failing the run.
            pass
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if pd.isna(value):
        return None
    return str(value)


@portable()
def as_numeric(s):
    """The column as floats, nulls dropped. Empty in, empty out."""
    return pd.to_numeric(s, errors="coerce").dropna()


@portable()
def as_datetime(s, date_format=None):
    """The column as timestamps, nulls dropped.

    An explicit format is used when the recipe carries one, so a replay
    reads 03/04 the same way the original run did instead of guessing
    again on a different sample.
    """
    if pd.api.types.is_datetime64_any_dtype(s):
        return s.dropna()
    if date_format and date_format != "ISO8601":
        return pd.to_datetime(s, format=date_format, errors="coerce").dropna()
    return pd.to_datetime(s, errors="coerce").dropna()


@portable()
def as_boolean(s):
    """The column as True/False, nulls dropped.

    The vocabulary is spelled out rather than imported: this function has
    to run inside the generated script, which imports nothing from the
    toolkit. ``tests/test_portable.py`` checks it against the one in
    ``inference.py``.
    """
    if pd.api.types.is_bool_dtype(s):
        return s.dropna()
    truthy = {"true", "yes", "y", "t", "1", "on"}
    falsy = {"false", "no", "n", "f", "0", "off"}
    text = s.dropna().astype(str).str.strip().str.casefold()
    mapped = text.map(lambda v: True if v in truthy else (False if v in falsy else None))
    return mapped.dropna().astype(bool)


@portable()
def coerce_column(s, kind, date_format=None):
    """Read a column as the type the recipe says it is.

    Not as the dtype says it is -- the two differ exactly when the user
    overrode something, which is the case this whole path exists for.
    """
    if kind in ("numeric_continuous", "numeric_discrete"):
        return pd.to_numeric(s, errors="coerce")
    if kind == "datetime":
        if date_format and date_format != "ISO8601":
            return pd.to_datetime(s, format=date_format, errors="coerce")
        return pd.to_datetime(s, errors="coerce")
    if kind == "boolean":
        if pd.api.types.is_bool_dtype(s):
            return s
        truthy = {"true", "yes", "y", "t", "1", "on"}
        falsy = {"false", "no", "n", "f", "0", "off"}
        text = s.astype(str).str.strip().str.casefold()
        return text.map(lambda v: True if v in truthy else (False if v in falsy else None))
    return s


@portable()
def text_lengths(s):
    """Character length of every non-null value, as a numeric column."""
    return s.dropna().astype(str).str.len()


# --------------------------------------------------------------------------
# Universal
# --------------------------------------------------------------------------


@portable()
def summary_count(s):
    """Non-null values."""
    return int(s.notna().sum())


@portable()
def summary_nulls(s):
    """Null count and share."""
    nulls = int(s.isna().sum())
    total = int(len(s))
    return {"count": nulls, "share": (nulls / total) if total else 0.0}


@portable()
def summary_cardinality(s):
    """Distinct non-null values, and what share of the column that is."""
    nonnull = s.dropna()
    unique = int(nonnull.nunique())
    return {"distinct": unique, "uniqueness": (unique / len(nonnull)) if len(nonnull) else 0.0}


@portable()
def summary_mode(s):
    """The most common value and how often it occurs."""
    counts = s.dropna().value_counts()
    if not len(counts):
        return None
    return {"value": counts.index[0], "count": int(counts.iloc[0])}


# --------------------------------------------------------------------------
# Numeric - continuous
# --------------------------------------------------------------------------


@portable(helpers=["as_numeric"])
def summary_mean(s):
    values = as_numeric(s)
    return float(values.mean()) if len(values) else None


@portable(helpers=["as_numeric"])
def summary_median(s):
    values = as_numeric(s)
    return float(values.median()) if len(values) else None


@portable(helpers=["as_numeric"])
def summary_std(s):
    """Sample standard deviation. Undefined below two values, not zero."""
    values = as_numeric(s)
    return float(values.std(ddof=1)) if len(values) > 1 else None


@portable(helpers=["as_numeric"])
def summary_min_max(s):
    values = as_numeric(s)
    if not len(values):
        return None
    return {"min": float(values.min()), "max": float(values.max())}


@portable(helpers=["as_numeric"])
def summary_quartiles(s):
    values = as_numeric(s)
    if not len(values):
        return None
    q = values.quantile([0.25, 0.5, 0.75])
    return {
        "p25": float(q.loc[0.25]),
        "p50": float(q.loc[0.5]),
        "p75": float(q.loc[0.75]),
        "iqr": float(q.loc[0.75] - q.loc[0.25]),
    }


@portable(helpers=["as_numeric"])
def summary_skew(s):
    """Fisher-Pearson skewness, with the direction spelled out.

    A number on its own gets misread in both directions, so the verdict
    ships beside it in the same words the report prints.
    """
    values = as_numeric(s)
    if len(values) < 3:
        return None
    value = float(values.skew())
    if abs(value) < 0.5:
        verdict = "roughly symmetric"
    elif abs(value) < 1.0:
        verdict = "moderately skewed"
    else:
        verdict = "strongly skewed"
    direction = "right" if value > 0 else "left"
    return {"value": value, "verdict": f"{verdict} to the {direction}"}


@portable(helpers=["as_numeric"])
def summary_kurtosis(s):
    values = as_numeric(s)
    return float(values.kurt()) if len(values) > 3 else None


@portable(helpers=["as_numeric"])
def summary_zeros(s):
    values = as_numeric(s)
    return int((values == 0).sum())


@portable(helpers=["as_numeric"])
def summary_negatives(s):
    values = as_numeric(s)
    return int((values < 0).sum())


@portable(helpers=["as_numeric"])
def summary_outliers(s, outlier_rule="iqr"):
    """Outlier count, with the rule that produced it.

    A count with no rule attached is not a statistic -- 1.5x IQR and
    3-sigma disagree by a factor of several on the same column -- so the
    rule and its fences travel with the number everywhere it goes.
    """
    values = as_numeric(s)
    if len(values) < 4:
        return None
    if outlier_rule == "zscore":
        mean = float(values.mean())
        sd = float(values.std(ddof=1))
        if not sd or not math.isfinite(sd):
            return {"rule": "z-score (|z| > 3)", "count": 0, "share": 0.0,
                    "lower": mean, "upper": mean}
        low, high = mean - 3 * sd, mean + 3 * sd
        rule = "z-score (|z| > 3)"
    else:
        q1 = float(values.quantile(0.25))
        q3 = float(values.quantile(0.75))
        span = q3 - q1
        low, high = q1 - 1.5 * span, q3 + 1.5 * span
        rule = "IQR (1.5x fence)"
    count = int(((values < low) | (values > high)).sum())
    return {
        "rule": rule,
        "count": count,
        "share": count / len(values),
        "lower": float(low),
        "upper": float(high),
    }


# --------------------------------------------------------------------------
# Numeric - discrete
# --------------------------------------------------------------------------


@portable()
def summary_value_counts(s, top_n=15):
    """The levels and their counts, most common first."""
    counts = s.dropna().value_counts()
    head = counts.head(top_n)
    return {
        "levels": [{"value": index, "count": int(value)} for index, value in head.items()],
        "shown": int(len(head)),
        "total_levels": int(len(counts)),
    }


@portable(helpers=["as_numeric"])
def summary_range(s):
    values = as_numeric(s)
    if not len(values):
        return None
    return {"min": float(values.min()), "max": float(values.max()),
            "span": float(values.max() - values.min())}


# --------------------------------------------------------------------------
# Boolean
# --------------------------------------------------------------------------


@portable(helpers=["as_boolean"])
def summary_true_false(s):
    values = as_boolean(s)
    true = int(values.sum())
    return {"true": true, "false": int(len(values) - true)}


@portable(helpers=["as_boolean"])
def summary_true_rate(s):
    values = as_boolean(s)
    return float(values.mean()) if len(values) else None


# --------------------------------------------------------------------------
# Categorical
# --------------------------------------------------------------------------


@portable()
def summary_level_shares(s, top_n=15):
    counts = s.dropna().value_counts()
    total = int(counts.sum())
    head = counts.head(top_n)
    return {
        "levels": [
            {"value": index, "count": int(value), "share": (int(value) / total) if total else 0.0}
            for index, value in head.items()
        ],
        "shown": int(len(head)),
        "total_levels": int(len(counts)),
    }


@portable()
def summary_top_coverage(s, top_n=15):
    """What share of rows the top N levels account for.

    The number that decides whether a bar chart of the top 15 is a
    picture of the column or a picture of its first inch.
    """
    counts = s.dropna().value_counts()
    total = int(counts.sum())
    if not total:
        return None
    covered = int(counts.head(top_n).sum())
    return {"top_n": int(top_n), "covered": covered, "share": covered / total}


@portable()
def summary_tail_size(s, top_n=15):
    counts = s.dropna().value_counts()
    total = int(counts.sum())
    tail = counts.iloc[top_n:]
    return {
        "levels": int(len(tail)),
        "rows": int(tail.sum()),
        "share": (int(tail.sum()) / total) if total else 0.0,
    }


@portable()
def summary_singletons(s):
    """Levels that occur exactly once -- the sign of a near-identifier."""
    counts = s.dropna().value_counts()
    singles = int((counts == 1).sum())
    return {"levels": singles, "share": (singles / len(counts)) if len(counts) else 0.0}


# --------------------------------------------------------------------------
# Datetime
# --------------------------------------------------------------------------


@portable(helpers=["as_datetime"])
def summary_time_range(s, date_format=None):
    values = as_datetime(s, date_format)
    if not len(values):
        return None
    return {"min": values.min().isoformat(), "max": values.max().isoformat()}


@portable(helpers=["as_datetime"])
def summary_span(s, date_format=None):
    values = as_datetime(s, date_format)
    if len(values) < 2:
        return None
    delta = values.max() - values.min()
    return {"days": float(delta.total_seconds() / 86400.0), "text": str(delta)}


@portable(helpers=["as_datetime"])
def summary_gaps(s, date_format=None):
    """How many jumps in the series, and the largest one.

    A gap is an interval more than three times the typical one. Real
    calendars have weekends and holidays in them; three times the median
    step is the smallest multiple that ignores a weekend and still
    notices a missing month.
    """
    values = as_datetime(s, date_format).sort_values()
    if len(values) < 3:
        return None
    deltas = values.diff().dropna()
    seconds = deltas.dt.total_seconds()
    typical = float(seconds.median())
    if typical <= 0:
        return {"count": 0, "threshold_seconds": 0.0, "largest": None}
    threshold = typical * 3
    gaps = seconds[seconds > threshold]
    largest = deltas.loc[seconds.idxmax()] if len(seconds) else None
    return {
        "count": int(len(gaps)),
        "typical_seconds": typical,
        "threshold_seconds": float(threshold),
        "largest": str(largest) if largest is not None else None,
    }


@portable(helpers=["as_datetime"])
def summary_frequency(s, date_format=None):
    """The modal step between observations, and whether one dominates.

    Real datetime columns are irregular. Emitting ``D`` for a column that
    has weekends missing and a three-week hole in March is a confident
    answer to a question nobody asked, so the dispersion around the modal
    step ships with it and decides the verdict.
    """
    values = as_datetime(s, date_format).sort_values().drop_duplicates()
    if len(values) < 3:
        return None
    seconds = values.diff().dropna().dt.total_seconds()
    if not len(seconds):
        return None
    buckets = [
        (1.0, "second"), (60.0, "minute"), (3600.0, "hour"), (86400.0, "day"),
        (604800.0, "week"), (2629800.0, "month"), (31557600.0, "year"),
    ]
    labelled = []
    for value in seconds:
        best = buckets[0][1]
        for size, name in buckets:
            if value >= size * 0.75:
                best = name
        labelled.append(best)
    counts = Counter(labelled)
    modal, hits = counts.most_common(1)[0]
    share = hits / len(labelled)
    median = float(seconds.median())
    spread = float(seconds.quantile(0.9) - seconds.quantile(0.1))
    longest = float(seconds.max())

    # Three verdicts, not two. A column that is 99% daily with a
    # three-week hole in it is neither "regular" nor "irregular", and
    # printing "regular" one line above "13 gaps" reads as a contradiction
    # -- which is how a reader learns to stop trusting the verdict.
    if share < 0.9 or (median > 0 and spread > median):
        verdict = "irregular"
    elif median > 0 and longest > median * 3:
        verdict = "mostly regular, with gaps"
    else:
        verdict = "regular"
    return {
        "modal_step": modal,
        "modal_share": share,
        "median_seconds": median,
        "spread_seconds": spread,
        "longest_seconds": longest,
        "verdict": verdict,
    }


# --------------------------------------------------------------------------
# Free text and identifiers
# --------------------------------------------------------------------------


@portable(helpers=["text_lengths"])
def summary_length_stats(s):
    lengths = text_lengths(s)
    if not len(lengths):
        return None
    return {
        "mean": float(lengths.mean()),
        "median": float(lengths.median()),
        "min": int(lengths.min()),
        "max": int(lengths.max()),
    }


@portable()
def summary_uniqueness(s):
    nonnull = s.dropna()
    if not len(nonnull):
        return None
    return float(nonnull.nunique() / len(nonnull))


@portable()
def summary_null_rate(s):
    total = int(len(s))
    return (int(s.isna().sum()) / total) if total else 0.0


@portable()
def summary_empty_strings(s):
    """Blank-but-not-null values -- the nulls that got past the NA tokens."""
    text = s.dropna().astype(str)
    return int((text.str.strip() == "").sum())


@portable()
def summary_duplicates(s):
    nonnull = s.dropna()
    return {
        "rows": int(len(nonnull) - nonnull.nunique()),
        "values": int((nonnull.value_counts() > 1).sum()),
    }


@portable()
def summary_format_consistency(s):
    """Whether every key has the same shape.

    Digits collapse to ``9`` and letters to ``A``, so ``ORD-00417`` and
    ``ORD-91055`` are one pattern while a stray ``417`` is another. One
    dominant pattern means the column is machine-generated; several
    usually mean two systems wrote into it.
    """
    text = s.dropna().astype(str).head(5000)
    if not len(text):
        return None
    shapes = text.str.replace(r"[0-9]", "9", regex=True).str.replace(
        r"[A-Za-z]", "A", regex=True
    )
    counts = shapes.value_counts()
    top = counts.index[0]
    share = float(counts.iloc[0] / len(text))
    return {
        "patterns": int(len(counts)),
        "dominant": str(top),
        "dominant_share": share,
        "verdict": "consistent" if share >= 0.99 else "mixed",
    }


@portable()
def summary_top_tokens(s, top_n=15):
    """The most common words, lower-cased, punctuation stripped."""
    text = s.dropna().astype(str).head(20000)
    counter = Counter()
    for value in text:
        for token in re.findall(r"[A-Za-z0-9']+", value.casefold()):
            counter[token] += 1
    return {
        "tokens": [
            {"token": word, "count": int(hits)} for word, hits in counter.most_common(top_n)
        ],
        "distinct": int(len(counter)),
    }


@portable()
def summary_the_value(s):
    """For a constant or empty column: what it holds, or that it holds nothing."""
    nonnull = s.dropna()
    if not len(nonnull):
        return {"value": None, "note": "every row is null"}
    counts = nonnull.value_counts()
    return {
        "value": counts.index[0],
        "rows": int(counts.iloc[0]),
        "note": (
            "the only value in the column"
            if len(counts) == 1
            else f"{counts.iloc[0] / len(nonnull):.2%} of non-null rows, {len(counts)} distinct"
        ),
    }
