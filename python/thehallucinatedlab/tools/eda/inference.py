"""What kind of column is this, and how sure are we.

Every failure a user will actually notice is a misclassification: a zip
code histogrammed as a continuous quantity, a 0/1/2 label encoding given
a mean, dates in three formats silently coerced, a 99%-null float
described as though it had a distribution. So this module is the product,
and everything downstream is presentation.

Two consequences shape the code:

**Nothing is asserted without a confidence.** Each rule returns a score
in [0, 1] and the sentence it would print. Below
:data:`~.types.CONFIDENCE_FLOOR` the classification is flagged on the
review screen, listed in the report's caveats and repeated in
``result.warnings`` -- three places, because a quiet guess is the failure
mode this is guarding against.

**Every verdict is overridable.** An override is recorded as a user
decision in the recipe, so a replay uses it rather than re-inferring and
possibly disagreeing with the report it is meant to reproduce.

The rules run in the order of PRD 8.2 with one structural exception,
marked at :func:`_rule_unreadable`: columns holding lists, dicts, bytes
or a mix of scalar types are caught before any rule that counts distinct
values, because counting distinct values on unhashable objects raises
rather than returning an answer.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from .deps import require
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
    ColumnDescription,
    DatasetDescription,
    TypeVerdict,
)

#: Names that mean "this is a key, not a measurement".
ID_NAME = re.compile(r"^(id|uuid|guid|.*_id|.*id|.*_key|.*_uuid|index|idx|pk)$", re.IGNORECASE)

#: Integer columns whose name says the number is a label. A zip code has
#: no mean; neither does a year of birth, however happily numpy computes one.
CODE_NAME = re.compile(
    r"^(zip|zipcode|zip_code|postcode|postal_code|post_code|code|.*_code|"
    r"year|yr|.*_year|month|day|quarter|week|.*_id|.*_key|pin|pincode)$",
    re.IGNORECASE,
)

#: Two-value vocabularies that mean true and false. Compared case-folded.
BOOLEAN_VOCABULARY: tuple[frozenset[str], ...] = (
    frozenset({"true", "false"}),
    frozenset({"yes", "no"}),
    frozenset({"y", "n"}),
    frozenset({"t", "f"}),
    frozenset({"0", "1"}),
    frozenset({"on", "off"}),
)

#: Which member of each pair counts as true, for the true-rate summary.
BOOLEAN_TRUE = frozenset({"true", "yes", "y", "t", "1", "on"})

#: Datetime formats tried in order. A bare ``%Y`` is deliberately absent:
#: it would turn every year column into a timestamp, and a year is a
#: number you group by, not an instant.
DATE_FORMATS: tuple[str, ...] = (
    "ISO8601",
    "%Y-%m-%d",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%Y/%m/%d",
    "%d/%m/%Y",
    "%m/%d/%Y",
    "%d-%m-%Y",
    "%m-%d-%Y",
    "%d.%m.%Y",
    "%d/%m/%Y %H:%M:%S",
    "%m/%d/%Y %H:%M:%S",
    "%d %b %Y",
    "%d %B %Y",
    "%b %d, %Y",
    "%B %d, %Y",
    "%Y%m%d",
    "%H:%M:%S",
    "%Y-%m",
)

#: Values sampled per column when a rule needs to try parsing.
PARSE_SAMPLE = 1000

#: Distinct values at or below which a numeric column is a set of codes
#: rather than a measurement.
DISCRETE_MAX_LEVELS = 20

#: Above this null rate, whatever the rule concluded is a conclusion about
#: very little data, and the score says so.
SPARSE_NULL_RATE = 0.9


@dataclass
class ColumnFacts:
    """The cheap facts every rule needs, computed once per column.

    Computing these once matters: ``nunique`` on a million-row object
    column is not free, and eleven rules each asking for it separately is
    how a profiler ends up slower than the analysis it replaces.
    """

    name: str
    series: Any
    n_rows: int
    count: int
    nulls: int
    n_unique: int
    dtype: str
    kind: str  # "numeric" | "integer" | "bool" | "datetime" | "string" | "other"
    top_value: Any = None
    top_count: int = 0
    container: bool = False
    mixed: bool = False

    @property
    def null_rate(self) -> float:
        return self.nulls / self.n_rows if self.n_rows else 0.0

    @property
    def uniqueness(self) -> float:
        return self.n_unique / self.count if self.count else 0.0

    @property
    def dominance(self) -> float:
        return self.top_count / self.count if self.count else 0.0


def _pd() -> Any:
    require()
    import pandas  # noqa: PLC0415 - deferred with the rest of the extra

    return pandas


def facts(name: str, series: Any, n_rows: int | None = None) -> ColumnFacts:
    """Measure a column once, so the rules can be pure functions of the result."""
    pd = _pd()
    total = int(len(series)) if n_rows is None else int(n_rows)
    nonnull = series.dropna()
    count = int(len(nonnull))

    dtype = str(series.dtype)
    kind = _kind(pd, series)

    container = False
    mixed = False
    n_unique = 0
    top_value: Any = None
    top_count = 0

    if count:
        if kind in {"string", "other"}:
            container, mixed = _inspect_objects(nonnull)
        if container:
            # Unhashable payloads: value_counts and nunique both raise.
            n_unique = count
        else:
            try:
                counts = nonnull.value_counts(dropna=True)
                n_unique = int(len(counts))
                if n_unique:
                    top_value = counts.index[0]
                    top_count = int(counts.iloc[0])
            except TypeError:
                container = True
                n_unique = count

    return ColumnFacts(
        name=name,
        series=series,
        n_rows=total,
        count=count,
        nulls=total - count,
        n_unique=n_unique,
        dtype=dtype,
        kind=kind,
        top_value=top_value,
        top_count=top_count,
        container=container,
        mixed=mixed,
    )


def _kind(pd: Any, series: Any) -> str:
    types = pd.api.types
    dtype = series.dtype
    if types.is_bool_dtype(dtype):
        return "bool"
    if types.is_datetime64_any_dtype(dtype) or str(dtype).startswith("period"):
        return "datetime"
    if types.is_integer_dtype(dtype):
        return "integer"
    if types.is_numeric_dtype(dtype) and not types.is_complex_dtype(dtype):
        return "numeric"
    if types.is_string_dtype(dtype) or types.is_object_dtype(dtype):
        return "string"
    return "other"


def _inspect_objects(nonnull: Any) -> tuple[bool, bool]:
    """(holds containers, holds more than one scalar type).

    Sampled rather than exhaustive. A column that is mixed at all is
    almost always mixed near the top -- and a full scan of a million
    Python objects costs more than the answer is worth.
    """
    sample = nonnull.head(PARSE_SAMPLE)
    seen: set[str] = set()
    for value in sample:
        if isinstance(value, list | dict | set | tuple | bytes | bytearray):
            return True, False
        if isinstance(value, str):
            seen.add("str")
        elif isinstance(value, bool):
            seen.add("bool")
        elif isinstance(value, int | float):
            seen.add("number")
        else:
            seen.add("other")
    return False, len(seen) > 1


# --------------------------------------------------------------------------
# Rules
# --------------------------------------------------------------------------


def _rule_unreadable(f: ColumnFacts) -> TypeVerdict | None:
    """Lists, dicts, blobs, and columns holding more than one scalar type.

    Out of PRD order on purpose -- twice, for two different reasons, and
    both were found by a fixture rather than by reasoning:

    * **Containers.** Every rule between 2 and 10 counts distinct values,
      and counting distinct values on a column of lists raises
      ``TypeError`` rather than answering. Catching the shape first is the
      difference between "unsupported, reported" and a traceback.
    * **Mixed scalars.** A column of alternating integers and strings is
      almost entirely distinct, so rule 3 claims it as an identifier and
      rule 11 never gets a turn. It is not a key; it is two columns that
      were concatenated, and nothing downstream can summarise it -- ``min``
      alone raises on it.
    """
    if f.container:
        return TypeVerdict(
            column=f.name,
            type=UNSUPPORTED,
            confidence=1.0,
            reason="holds lists, dicts or binary data, which have no univariate summary",
        )
    if f.mixed:
        return TypeVerdict(
            column=f.name,
            type=UNSUPPORTED,
            confidence=1.0,
            reason="more than one scalar type in the column; reported but not charted",
        )
    return None


def _rule_empty(f: ColumnFacts) -> TypeVerdict | None:
    if f.count == 0:
        return TypeVerdict(
            column=f.name,
            type=EMPTY,
            confidence=1.0,
            reason="every value is null" if f.n_rows else "no rows",
        )
    return None


def _rule_constant(f: ColumnFacts) -> TypeVerdict | None:
    if f.n_unique <= 1:
        return TypeVerdict(
            column=f.name,
            type=CONSTANT,
            confidence=1.0,
            reason=f"one distinct value ({_short(f.top_value)}) in every non-null row",
        )
    if f.dominance >= 0.995:
        # Scaled across the last half percent so 99.5% is a borderline
        # call the review screen flags and 99.9% is not.
        share = (f.dominance - 0.995) / 0.005
        return TypeVerdict(
            column=f.name,
            type=CONSTANT,
            confidence=round(0.7 + 0.3 * min(share, 1.0), 4),
            reason=(
                f"{_short(f.top_value)} covers {f.dominance:.2%} of non-null rows "
                f"({f.n_unique} distinct values in total)"
            ),
        )
    return None


def _rule_identifier(f: ColumnFacts) -> TypeVerdict | None:
    """Keys, not measurements.

    The written rule is "uniqueness >= 0.95 on >= 100 rows", and taken
    literally it swallows three kinds of column that are not keys at all.
    Each exclusion below is there because a real column hit it:

    * **Floats.** A continuous measurement is naturally almost
      all-distinct -- every revenue figure in a thousand rows differs.
      Calling it an identifier suppresses the histogram that is the whole
      point of the column.
    * **Dates.** A daily timestamp column is exactly as unique as a
      primary key and is not one. The parse is checked here rather than
      waiting for rule 5, which never gets a turn.
    * **Names that say "code".** A zip column with no repeats in this
      extract is still a zip code. Rule 6 owns those; an explicit key
      name (``*_id``) still wins over a code name.
    * **Prose.** Free-form comments are close to all-distinct too, and a
      free-text column deserves a length distribution and a token count
      rather than one line saying it has no duplicates. This is the
      idea document's "split on uniqueness ratio *and* token count";
      uniqueness alone puts both halves in the same bucket.

    The name path keeps the written rule unchanged.
    """
    if f.kind == "datetime":
        return None

    named = bool(ID_NAME.match(f.name))
    coded = bool(CODE_NAME.match(f.name)) and not named
    prose = f.kind == "string" and _mean_tokens(f.series) > 2.0

    if (
        f.kind in {"integer", "string"}
        and not coded
        and not prose
        and f.count >= 100
        and f.uniqueness >= 0.95
        and not _parses_as_datetime(f)
    ):
        return TypeVerdict(
            column=f.name,
            type=IDENTIFIER,
            confidence=round(min(1.0, 0.55 + 0.45 * f.uniqueness), 4),
            reason=f"{f.uniqueness:.1%} of {f.count:,} non-null values are distinct",
        )

    if named and f.uniqueness >= 0.8:
        return TypeVerdict(
            column=f.name,
            type=IDENTIFIER,
            confidence=round(min(1.0, 0.5 + 0.5 * f.uniqueness), 4),
            reason=f"name looks like a key and {f.uniqueness:.1%} of values are distinct",
        )
    return None


def _parses_as_datetime(f: ColumnFacts) -> bool:
    """Cheap pre-check so the identifier rule does not claim a date column."""
    if f.kind != "string":
        return False
    verdict = _rule_datetime(f)
    return verdict is not None


def _rule_boolean(f: ColumnFacts) -> TypeVerdict | None:
    if f.kind == "bool":
        return TypeVerdict(
            column=f.name, type=BOOLEAN, confidence=1.0, reason="stored as a boolean dtype"
        )
    if f.n_unique != 2 or f.container:
        return None

    values = {str(v).strip().casefold() for v in f.series.dropna().unique()[:8]}
    for vocabulary in BOOLEAN_VOCABULARY:
        if values == vocabulary:
            numeric = vocabulary == frozenset({"0", "1"})
            return TypeVerdict(
                column=f.name,
                type=BOOLEAN,
                # 0/1 is genuinely ambiguous -- it is as likely to be a two
                # level code as a flag -- so it scores lower than a column
                # that spells the words out.
                confidence=0.85 if numeric else 0.95,
                reason=f"exactly two values, {' and '.join(sorted(values))}",
            )
    return None


def _rule_datetime(f: ColumnFacts) -> TypeVerdict | None:
    if f.kind == "datetime":
        return TypeVerdict(
            column=f.name, type=DATETIME, confidence=1.0, reason="stored as a datetime dtype"
        )
    if f.kind != "string" or f.mixed:
        return None

    sample = f.series.dropna().head(PARSE_SAMPLE).astype(str)
    if not len(sample):
        return None

    # A column of short digit strings is a year, a code or a quantity. Any
    # date format that accepts it is accepting it by accident.
    if all(len(v.strip()) <= 4 and v.strip().isdigit() for v in sample.head(50)):
        return None

    rates = _parse_rates(sample)
    if not rates:
        return None

    best_format, best_rate = rates[0]
    if best_rate < 0.95:
        return None

    rivals = [name for name, rate in rates[1:] if rate >= 0.95]
    competing = _disagreeing(sample, best_format, rivals)
    verdict = TypeVerdict(
        column=f.name,
        type=DATETIME,
        confidence=round(best_rate, 4),
        reason=f"{best_rate:.1%} of sampled values parse as {best_format}",
        meta={"format": best_format},
    )
    if competing:
        # Day-first and month-first both accepting the sample is not a
        # detail: it decides whether 03/04 is March or April. Say so
        # rather than picking one and moving on. The score drops below the
        # flag threshold deliberately -- this is exactly the case the
        # review screen exists for.
        verdict.confidence = round(best_rate * 0.6, 4)
        verdict.warnings.append(
            f"{f.name}: {', '.join([best_format, *competing[:2]])} all parse this column "
            f"and disagree about the dates. Read as {best_format}; "
            "pass --types or the review screen to force another reading."
        )
    return verdict


def _disagreeing(sample: Any, best: str, others: list[str]) -> list[str]:
    """Of ``others``, the formats that produce different dates from ``best``.

    Two format strings accepting the same column is not ambiguity --
    ``ISO8601`` and ``%Y-%m-%d`` describe the same reading and always
    agree. What matters is whether the *values* come out different, so
    that is what gets compared. Anything else warns on every ISO column
    in existence and trains the user to ignore the warning.
    """
    if not others:
        return []
    pd = _pd()
    reference = pd.to_datetime(sample, format=best, errors="coerce")
    disagree: list[str] = []
    for name in others:
        try:
            candidate = pd.to_datetime(sample, format=name, errors="coerce")
        except (ValueError, TypeError):  # pragma: no cover - it parsed once already
            continue
        both = reference.notna() & candidate.notna()
        if bool(both.any()) and bool((reference[both] != candidate[both]).any()):
            disagree.append(name)
    return disagree


def _parse_rates(sample: Any) -> list[tuple[str, float]]:
    """Parse rate per candidate format, best first, ties broken by order.

    Formats are tried explicitly rather than letting pandas guess, because
    pandas guesses per value and will happily read half a column one way
    and half the other.
    """
    pd = _pd()
    total = len(sample)
    scored: list[tuple[float, int, str]] = []
    for index, fmt in enumerate(DATE_FORMATS):
        try:
            parsed = pd.to_datetime(sample, format=fmt, errors="coerce")
        except (ValueError, TypeError):
            continue
        rate = float(parsed.notna().sum()) / total
        if rate > 0:
            # Rank on rate, then on the order above, so a tie resolves to
            # the more common format rather than to dictionary order.
            scored.append((-rate, index, fmt))
    scored.sort()
    return [(fmt, -rate) for rate, _, fmt in scored]


def _rule_numeric_discrete(f: ColumnFacts) -> TypeVerdict | None:
    integral = f.kind == "integer" or (f.kind == "numeric" and _all_integral(f.series))

    if not integral:
        return None

    if CODE_NAME.match(f.name):
        return TypeVerdict(
            column=f.name,
            type=NUMERIC_DISCRETE,
            confidence=0.85,
            reason=f"whole numbers and the name {f.name!r} reads as a code, not a quantity",
        )
    if f.n_unique <= DISCRETE_MAX_LEVELS:
        # Two distinct integers are almost a flag; twenty are almost a
        # measurement. The score tracks that instead of pretending the
        # cut-off is sharp.
        crowding = 1.0 - (f.n_unique / (DISCRETE_MAX_LEVELS * 2))
        note = "" if f.kind == "integer" else " (whole numbers stored as floats)"
        return TypeVerdict(
            column=f.name,
            type=NUMERIC_DISCRETE,
            confidence=round(0.6 + 0.35 * crowding, 4),
            reason=f"whole numbers with only {f.n_unique} distinct values{note}",
        )
    return None


def _all_integral(series: Any) -> bool:
    """True for a float column whose non-null values are all whole numbers.

    This is what an integer column with a missing value looks like after
    pandas reads it, and it is extremely common. Treating it as continuous
    puts a mean on a set of codes.
    """
    import numpy as np  # noqa: PLC0415 - deferred with the rest of the extra

    nonnull = series.dropna()
    if not len(nonnull):
        return False
    try:
        values = nonnull.to_numpy(dtype="float64")
    except (TypeError, ValueError):
        return False
    finite = values[np.isfinite(values)]
    if not finite.size:
        return False
    return bool(np.all(np.equal(np.mod(finite, 1), 0)))


def _rule_numeric_continuous(f: ColumnFacts) -> TypeVerdict | None:
    if f.kind in {"numeric", "integer"}:
        return TypeVerdict(
            column=f.name,
            type=NUMERIC_CONTINUOUS,
            confidence=0.95,
            reason=f"numeric with {f.n_unique:,} distinct values",
        )
    return None


def _rule_categorical_low(f: ColumnFacts) -> TypeVerdict | None:
    if f.kind not in {"string", "other"} or f.mixed:
        return None
    if f.n_unique <= 12 and f.n_unique <= 0.05 * f.n_rows:
        return TypeVerdict(
            column=f.name,
            type=CATEGORICAL_LOW,
            confidence=0.95,
            reason=f"{f.n_unique} levels across {f.n_rows:,} rows",
        )
    return None


def _rule_categorical_high(f: ColumnFacts) -> TypeVerdict | None:
    if f.kind not in {"string", "other"} or f.mixed:
        return None
    tokens = _mean_tokens(f.series)
    if tokens <= 3 and f.uniqueness < 0.95:
        return TypeVerdict(
            column=f.name,
            type=CATEGORICAL_HIGH,
            confidence=round(0.75 + 0.2 * (1.0 - f.uniqueness), 4),
            reason=(
                f"{f.n_unique:,} short values ({tokens:.1f} words on average), "
                f"{f.uniqueness:.1%} distinct"
            ),
        )
    return None


def _rule_free_text(f: ColumnFacts) -> TypeVerdict | None:
    if f.kind not in {"string", "other"} or f.mixed:
        return None
    tokens = _mean_tokens(f.series)
    # Capped below 1.0: free text is where every other rule gave up, so
    # it is never a positive identification and should not read like one.
    return TypeVerdict(
        column=f.name,
        type=FREE_TEXT,
        confidence=round(min(0.9, 0.7 + 0.04 * min(tokens, 6.0)), 4),
        reason=f"prose-shaped: {tokens:.1f} words per value on average",
    )


def _rule_unsupported(f: ColumnFacts) -> TypeVerdict | None:
    reason = "more than one scalar type in the column" if f.mixed else f"dtype {f.dtype}"
    return TypeVerdict(
        column=f.name,
        type=UNSUPPORTED,
        confidence=1.0,
        reason=f"{reason}; reported but not charted",
    )


def _mean_tokens(series: Any) -> float:
    sample = series.dropna().head(PARSE_SAMPLE).astype(str)
    if not len(sample):
        return 0.0
    return float(sample.str.split().str.len().fillna(0).mean())


#: The rules, in the order they are tried. First non-None wins.
RULES = (
    _rule_unreadable,
    _rule_empty,
    _rule_constant,
    _rule_identifier,
    _rule_boolean,
    _rule_datetime,
    _rule_numeric_discrete,
    _rule_numeric_continuous,
    _rule_categorical_low,
    _rule_categorical_high,
    _rule_free_text,
    _rule_unsupported,
)


# --------------------------------------------------------------------------
# Entry points
# --------------------------------------------------------------------------


def infer(name: str, series: Any, *, n_rows: int | None = None) -> TypeVerdict:
    """Classify one column."""
    return infer_from(facts(name, series, n_rows))


def infer_from(f: ColumnFacts) -> TypeVerdict:
    for rule in RULES:
        verdict = rule(f)
        if verdict is not None:
            return _temper(verdict, f)
    raise AssertionError("the last rule matches everything")  # pragma: no cover


def _temper(verdict: TypeVerdict, f: ColumnFacts) -> TypeVerdict:
    """Discount a verdict reached from very little data.

    A float column that is 99% null still has a dtype and still infers as
    continuous, and the inference is still nearly worthless. The score has
    to reflect the evidence, not just the rule that fired.

    ``constant`` is discounted too, for the same reason: two surviving
    rows that happen to agree is not evidence that the column never
    varies. Only ``empty`` is exempt, because "all null" over any number
    of rows is a fact rather than an inference.
    """
    if verdict.type == EMPTY:
        return verdict
    if f.null_rate >= SPARSE_NULL_RATE:
        verdict.confidence = round(verdict.confidence * 0.6, 4)
        verdict.warnings.append(
            f"{f.name}: {f.null_rate:.1%} null -- read as {verdict.type} from "
            f"{f.count:,} value(s)."
        )
    elif f.null_rate >= 0.5:
        verdict.confidence = round(verdict.confidence * 0.9, 4)
    return verdict


def apply_override(verdict: TypeVerdict, wanted: str) -> TypeVerdict:
    """Replace a verdict with the user's, keeping what was inferred.

    Confidence goes to 1.0 because the number is a statement about the
    *inference*, and there is no longer an inference -- there is a person
    who said so.
    """
    from .types import is_valid_type

    if not is_valid_type(wanted):
        from .errors import InvalidRecipe
        from .types import COLUMN_TYPES

        raise InvalidRecipe(
            f"{wanted!r} is not a column type. One of: {', '.join(COLUMN_TYPES)}."
        )
    if wanted == verdict.type and not verdict.overridden:
        verdict.overridden = True
        verdict.inferred = verdict.type
        verdict.confidence = 1.0
        verdict.reason = f"{verdict.reason}; confirmed by the user"
        return verdict
    return TypeVerdict(
        column=verdict.column,
        type=wanted,
        confidence=1.0,
        reason=f"set by the user (inference said {verdict.type})",
        overridden=True,
        inferred=verdict.inferred or verdict.type,
        warnings=list(verdict.warnings),
        # A forced datetime keeps whatever format was detected; a column
        # forced to anything else has no use for it.
        meta=dict(verdict.meta) if wanted == DATETIME else {},
    )


def _short(value: Any, width: int = 24) -> str:
    text = "null" if value is None else str(value)
    return text if len(text) <= width else text[: width - 1] + "…"


def preview_values(series: Any, n: int = 3) -> list[str]:
    """A few real values, for the type-review screen and the report.

    Non-null values are preferred: three blanks tell the reader nothing
    about the column and are exactly what a null-heavy column shows first.
    An all-null column returns nothing at all rather than three copies of
    ``nan``, which reads as data and is not.
    """
    nonnull = series.dropna()
    if not len(nonnull):
        return []
    return [_short(v, 32) for v in nonnull.head(n).tolist()]


def describe(loaded: Any, overrides: dict[str, str] | None = None) -> DatasetDescription:
    """Infer every column of a :class:`~.loading.LoadedFrame`.

    Exact statistics from a streamed read win over the sample's own
    numbers wherever they exist -- so a report can print an exact null
    count beside a sampled histogram without either being wrong.
    """
    require()
    frame = loaded.frame
    overrides = overrides or {}
    columns: list[ColumnDescription] = []
    warnings: list[str] = list(loaded.warnings)

    for name in frame.columns:
        series = frame[name]
        f = facts(str(name), series, n_rows=len(series))
        verdict = infer_from(f)

        wanted = overrides.get(str(name))
        if wanted:
            verdict = apply_override(verdict, wanted)

        warnings.extend(verdict.warnings)
        if verdict.low_confidence:
            warnings.append(
                f"{name}: read as {verdict.type} with low confidence "
                f"({verdict.confidence:.2f}) -- {verdict.reason}."
            )

        count = int(loaded.exact_for(str(name), "count", f.count))
        nulls = int(loaded.exact_for(str(name), "nulls", f.nulls))
        n_unique = int(loaded.exact_for(str(name), "n_unique", f.n_unique))

        columns.append(
            ColumnDescription(
                name=str(name),
                dtype=f.dtype,
                count=count,
                nulls=nulls,
                n_unique=n_unique,
                verdict=verdict,
                preview=preview_values(series),
            )
        )

    return DatasetDescription(
        path=loaded.ref.path,
        rows=loaded.rows,
        columns=columns,
        sampling=loaded.sampling,
        load=loaded.options.to_json(),
        warnings=warnings,
        memory_bytes=loaded.memory_bytes,
    )
