"""Reading a source, in code both the library and the script can run.

``loading.py`` owns discovery, sniffing and error classification. What it
does *not* own is the actual read, because the generated ``analysis.py``
has to perform the identical read and a script that calls back into this
package is not the deliverable the idea document promised.

So the read itself lives here, portable, and both sides call it. That
matters most on the streaming path: a report built from a 200,000-row
reservoir sample and a script that re-samples differently would agree on
nothing, and the recipe's seed would be decoration.
"""

from __future__ import annotations

# Mirrors the generated script's preamble; see the note in summaries.py.
from pathlib import Path

import numpy as np
import pandas as pd

from .portable import portable


@portable()
def normalise_columns(frame):
    """String column names, made unique.

    Duplicate names are legal in a CSV and illegal in every lookup that
    follows. Renaming the second ``price`` to ``price.1`` loudly beats a
    KeyError two screens later.
    """
    names = [str(c) for c in frame.columns]
    seen = {}
    out = []
    for name in names:
        if name in seen:
            seen[name] += 1
            out.append(name + "." + str(seen[name]))
        else:
            seen[name] = 0
            out.append(name)
    frame = frame.copy()
    frame.columns = out
    return frame


@portable(helpers=["normalise_columns"])
def read_source(path, kind="csv", sep=None, encoding=None, header=0,
                na_values=None, nrows=None, sheet=None):
    """One dataset, read whole.

    ``kind`` is decided from the extension by the caller rather than
    re-derived here, so a recipe that says "this .dat is a CSV" is obeyed
    on replay instead of being second-guessed.
    """
    path = Path(path)
    if kind == "csv":
        kwargs = {"header": header}
        if sep:
            kwargs["sep"] = sep
        if encoding:
            kwargs["encoding"] = encoding
        if na_values:
            kwargs["na_values"] = list(na_values)
        if nrows:
            kwargs["nrows"] = int(nrows)
        frame = pd.read_csv(path, **kwargs)
    elif kind == "jsonl":
        frame = pd.read_json(path, lines=True, nrows=int(nrows) if nrows else None)
    elif kind == "json":
        frame = pd.read_json(path)
        if nrows:
            frame = frame.head(int(nrows))
    elif kind == "parquet":
        frame = pd.read_parquet(path)
        if nrows:
            frame = frame.head(int(nrows))
    elif kind == "excel":
        frame = pd.read_excel(
            path,
            sheet_name=sheet if sheet is not None else 0,
            header=header,
            na_values=list(na_values) if na_values else None,
            nrows=int(nrows) if nrows else None,
        )
    else:
        raise ValueError("unsupported source kind: " + str(kind))
    return normalise_columns(frame)


@portable(helpers=["normalise_columns"])
def stream_source(path, sep=None, encoding=None, header=0, na_values=None,
                  chunk_rows=100000, sample_rows=200000, seed=42, distinct_cap=1000000):
    """One large CSV, read once: exact statistics plus a fair sample.

    The sample is reservoir sampling in its smallest-random-key form.
    Every row gets one uniform key and the k smallest keys win, which is
    exactly uniform over the whole file in a single pass. Because the
    keys come from a seeded generator advanced chunk by chunk, the same
    seed and chunk size give the same sample every time -- which is what
    makes the recipe replayable rather than merely descriptive.

    Returns ``(sample, total_rows, exact)`` where ``exact`` holds the
    per-column count, nulls, min, max and cardinality computed over every
    row, not over the sample.
    """
    path = Path(path)
    kwargs = {"header": header, "chunksize": int(chunk_rows)}
    if sep:
        kwargs["sep"] = sep
    if encoding:
        kwargs["encoding"] = encoding
    if na_values:
        kwargs["na_values"] = list(na_values)

    rng = np.random.default_rng(seed)
    target = int(sample_rows)
    reservoir = []
    keys = np.empty(0, dtype=float)
    total = 0
    accum = {}

    for chunk in pd.read_csv(path, **kwargs):
        chunk = normalise_columns(chunk)
        total += len(chunk)
        for name in chunk.columns:
            series = chunk[name]
            state = accum.setdefault(
                name,
                {"count": 0, "nulls": 0, "min": None, "max": None,
                 "distinct": set(), "capped": False},
            )
            nonnull = series.dropna()
            state["count"] += int(len(nonnull))
            state["nulls"] += int(len(series) - len(nonnull))
            if not len(nonnull):
                continue
            try:
                low, high = nonnull.min(), nonnull.max()
                state["min"] = low if state["min"] is None else min(state["min"], low)
                state["max"] = high if state["max"] is None else max(state["max"], high)
            except TypeError:
                # Mixed types in one column: a range is meaningless for it.
                state["min"] = None
                state["max"] = None
            if not state["capped"]:
                state["distinct"].update(nonnull.unique().tolist())
                if len(state["distinct"]) > distinct_cap:
                    state["capped"] = True
                    state["distinct"] = set()

        keys = np.concatenate([keys, rng.random(len(chunk))])
        reservoir.append(chunk)
        if len(keys) > target * 2:
            merged = pd.concat(reservoir, ignore_index=True)
            keep = np.sort(np.argsort(keys, kind="stable")[:target])
            reservoir = [merged.iloc[keep].reset_index(drop=True)]
            keys = keys[keep]

    if not reservoir:
        return pd.DataFrame(), 0, {}

    sample = pd.concat(reservoir, ignore_index=True)
    if len(sample) > target:
        keep = np.sort(np.argsort(keys, kind="stable")[:target])
        sample = sample.iloc[keep].reset_index(drop=True)

    exact = {}
    for name, state in accum.items():
        entry = {"count": state["count"], "nulls": state["nulls"],
                 "min": state["min"], "max": state["max"]}
        if state["capped"]:
            entry["n_unique"] = int(distinct_cap)
            entry["n_unique_is_floor"] = True
        else:
            entry["n_unique"] = int(len(state["distinct"]))
            entry["n_unique_is_floor"] = False
        exact[name] = entry
    return sample, int(total), exact


@portable()
def apply_exact(summaries, exact_for_column):
    """Replace sample statistics with exact ones where the stream has them.

    A sampled run still knows the true row count, null count, cardinality
    and range for every column, so the report prints those rather than the
    sample's approximations. Only the statistics that genuinely need every
    row -- mean, quantiles, skew -- stay sampled, and the report says so.
    """
    if not exact_for_column:
        return summaries
    out = dict(summaries)
    count = exact_for_column.get("count")
    nulls = exact_for_column.get("nulls")
    if "count" in out and count is not None:
        out["count"] = int(count)
    if "nulls" in out and nulls is not None and count is not None:
        total = int(count) + int(nulls)
        out["nulls"] = {"count": int(nulls), "share": (int(nulls) / total) if total else 0.0}
    if "null_rate" in out and nulls is not None and count is not None:
        total = int(count) + int(nulls)
        out["null_rate"] = (int(nulls) / total) if total else 0.0
    if "cardinality" in out and isinstance(out["cardinality"], dict):
        distinct = exact_for_column.get("n_unique")
        if distinct is not None and not exact_for_column.get("n_unique_is_floor"):
            out["cardinality"] = {
                "distinct": int(distinct),
                "uniqueness": (int(distinct) / int(count)) if count else 0.0,
            }
    return out
