"""Finding sources, guessing how to read them, and reading them honestly.

Three jobs, in the order they happen:

**Discovery.** A path is a file, a directory, or a workbook with several
sheets. All three become a list of :class:`SourceRef` -- one per dataset
-- because a folder is N independent datasets, not one wide table, and a
multi-sheet workbook is the same situation wearing a different extension.

**Sniffing.** Delimiter, encoding and header row are *guesses*, and the
session shows them as guesses the user can correct. Every guess is
recorded in :class:`LoadOptions` so replaying a recipe never re-sniffs
and never quietly reads the file differently the second time.

**Reading.** Under 200 MB the file is read whole and every statistic is
exact. Above that the file is streamed: counts, nulls, min, max and
cardinality come from the stream and stay exact, while figures are drawn
from a seeded sample. The sample is never silent -- it is carried on
:class:`SamplingInfo` from here all the way to the caption under each
figure.
"""

from __future__ import annotations

import csv
import io
import os
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

from .deps import require
from .errors import EmptyDataset, UnreadableSource
from .types import SamplingInfo

#: Read whole below this; stream above it. 200 MB of CSV is roughly 2 M
#: rows x 30 columns, which pandas holds in about 1.5 GB -- comfortable
#: on the 16 GB baseline and not comfortable at ten times the size.
FULL_LOAD_BYTES = 200 * 1024 * 1024

#: Above this the run stops and asks, because the wait is long enough
#: that starting one by accident is a real cost.
CONFIRM_BYTES = 2 * 1024 * 1024 * 1024

#: A frame wider than this is almost always a pivot someone meant to
#: subset. Charting all of it produces thousands of figures nobody reads.
WIDE_COLUMNS = 500

#: Rows kept for figures when streaming.
DEFAULT_SAMPLE_ROWS = 200_000

#: Rows read per chunk when streaming.
CHUNK_ROWS = 100_000

#: Distinct values tracked per column while streaming. Past this the
#: cardinality is reported as a floor rather than a number, which is
#: honest; an unbounded set is how a profiler runs a machine out of RAM.
DISTINCT_CAP = 1_000_000

_CSV_SUFFIXES = {".csv", ".tsv", ".txt", ".psv", ".dat"}
_EXCEL_SUFFIXES = {".xlsx", ".xlsm", ".xltx", ".xls"}
_JSON_SUFFIXES = {".json"}
_JSONL_SUFFIXES = {".jsonl", ".ndjson"}
_PARQUET_SUFFIXES = {".parquet", ".pq"}

#: Everything discovery will pick up from a directory when no pattern is
#: given. Ordered so the common case is first.
READABLE_SUFFIXES = (
    _CSV_SUFFIXES | _EXCEL_SUFFIXES | _JSON_SUFFIXES | _JSONL_SUFFIXES | _PARQUET_SUFFIXES
)

_DELIMITER_CANDIDATES = (",", ";", "\t", "|")

_ENCODING_CANDIDATES = ("utf-8", "utf-8-sig", "cp1252", "latin-1")

_BOMS = (
    (b"\xef\xbb\xbf", "utf-8-sig"),
    (b"\xff\xfe\x00\x00", "utf-32"),
    (b"\x00\x00\xfe\xff", "utf-32"),
    (b"\xff\xfe", "utf-16"),
    (b"\xfe\xff", "utf-16"),
)


# --------------------------------------------------------------------------
# Discovery
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class SourceRef:
    """One dataset: a path, and for a workbook, which sheet inside it."""

    path: Path
    sheet: str | None = None
    #: True when this ref is one of a set covering every sheet in the
    #: workbook. Without it, ``--sheet all`` warns three times that three
    #: sheets exist -- each dataset complaining about the two being
    #: profiled beside it, which trains the reader to skip the warning.
    covers_workbook: bool = False

    @property
    def label(self) -> str:
        return f"{self.path.name}#{self.sheet}" if self.sheet else self.path.name

    @property
    def stem(self) -> str:
        """The name its output directory is built from."""
        if self.sheet:
            return f"{self.path.stem}.{_slug(self.sheet)}"
        return self.path.stem

    @property
    def size(self) -> int:
        try:
            return self.path.stat().st_size
        except OSError:  # pragma: no cover - the caller reports the real error
            return 0

    def __str__(self) -> str:
        return self.label


def _slug(text: str) -> str:
    keep = [c if c.isalnum() or c in "-_" else "_" for c in text.strip()]
    return "".join(keep).strip("_").lower() or "sheet"


def discover(
    source: str | os.PathLike[str],
    *,
    pattern: str | None = None,
    recursive: bool = False,
    sheet: str | None = None,
) -> list[SourceRef]:
    """Every dataset reachable from ``source``.

    A file yields one entry, except a workbook with ``sheet="all"``,
    which yields one per sheet. A directory yields one per matching file,
    sorted by name so two runs over the same folder agree on order and
    therefore on figure numbering.
    """
    path = Path(os.fspath(source)).expanduser()

    if path.is_dir():
        globber = path.rglob if recursive else path.glob
        found = sorted(
            p
            for p in globber(pattern or "*")
            if p.is_file() and (pattern is not None or p.suffix.lower() in READABLE_SUFFIXES)
        )
        if not found:
            where = f"{pattern!r} in " if pattern else ""
            raise UnreadableSource(f"No readable data files matched {where}{path}.")
        refs: list[SourceRef] = []
        for item in found:
            refs.extend(_expand(item, sheet))
        return refs

    if not path.exists():
        raise UnreadableSource(f"No such file or directory: {path}")
    if not path.is_file():
        raise UnreadableSource(f"Not a file this tool can read: {path}")

    return _expand(path, sheet)


def _expand(path: Path, sheet: str | None) -> list[SourceRef]:
    if path.suffix.lower() not in _EXCEL_SUFFIXES:
        return [SourceRef(path)]
    if sheet and sheet != "all":
        return [SourceRef(path, sheet)]
    names = sheet_names(path)
    if sheet == "all":
        return [SourceRef(path, name, covers_workbook=True) for name in names]
    # A workbook with one sheet is unambiguous. With several, the first is
    # used and :func:`load` warns -- silently profiling sheet 1 of 9 is the
    # kind of thing that gets noticed after the meeting.
    return [SourceRef(path, names[0] if names else None)]


def sheet_names(path: Path) -> list[str]:
    """Sheet names in a workbook, in file order."""
    pandas = _pandas()
    try:
        with pandas.ExcelFile(path) as book:
            return [str(name) for name in book.sheet_names]
    except ImportError as err:
        raise UnreadableSource(
            f"Reading {path.name} needs the Excel extra. "
            "Install with: pip install thehallucinatedlab[eda-excel]"
        ) from err
    except Exception as err:  # noqa: BLE001 - pandas raises many unrelated types here
        raise UnreadableSource(f"{path.name} could not be opened as a workbook: {err}") from err


def estimate_rows(ref: SourceRef, options: LoadOptions | None = None) -> int | None:
    """Roughly how many rows, without reading the file.

    Used only by the source-picker screen, where a wrong number costs
    nothing and waiting to read every file costs the whole screen. Returns
    None for formats where a guess would be meaningless.
    """
    if ref.path.suffix.lower() not in _CSV_SUFFIXES:
        return None
    size = ref.size
    if not size:
        return 0
    encoding = (options.encoding if options else None) or "utf-8"
    try:
        with ref.path.open("rb") as handle:
            head = handle.read(256 * 1024)
    except OSError:
        return None
    text = head.decode(encoding, errors="replace")
    lines = text.splitlines()
    if len(lines) < 2:
        return None
    # Drop the last line: it is probably truncated by the read window.
    sample = lines[:-1]
    average = len(head[: len(text)]) / max(len(sample), 1)
    if average <= 0:
        return None
    return max(int(size / average) - 1, 0)


# --------------------------------------------------------------------------
# Load options
# --------------------------------------------------------------------------


@dataclass
class LoadOptions:
    """How to read one source. Every field is either given or sniffed,
    and ``sniffed`` names which were guessed so the session can show them
    as guesses and the report can say what it assumed."""

    delimiter: str | None = None
    encoding: str | None = None
    header: int | None = 0
    na_values: list[str] = field(default_factory=list)
    sheet: str | None = None
    nrows: int | None = None
    sample: int | None = None
    seed: int = 42
    sniffed: list[str] = field(default_factory=list)

    def to_json(self) -> dict[str, Any]:
        return {
            "delimiter": self.delimiter,
            "encoding": self.encoding,
            "header": self.header,
            "na_values": list(self.na_values),
            "sheet": self.sheet,
            "nrows": self.nrows,
            "sample": self.sample,
            "seed": self.seed,
        }

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> LoadOptions:
        return cls(
            delimiter=data.get("delimiter"),
            encoding=data.get("encoding"),
            header=data.get("header", 0),
            na_values=list(data.get("na_values") or []),
            sheet=data.get("sheet"),
            nrows=data.get("nrows"),
            sample=data.get("sample"),
            seed=int(data.get("seed", 42)),
        )


def sniff(ref: SourceRef, options: LoadOptions | None = None) -> LoadOptions:
    """Fill in whatever the caller did not specify.

    Only CSV-family files are sniffed; the other formats carry their own
    schema and there is nothing to guess. Anything the caller did supply
    is left exactly as given -- an explicit ``--delimiter ;`` is not a
    hint, it is an instruction.
    """
    opts = replace(options) if options else LoadOptions()

    # The ref wins over the option. ``--sheet all`` is an instruction to
    # *discovery* -- expand the workbook into one dataset per sheet -- and
    # by the time a ref exists that expansion has already happened. Letting
    # the option through here asked pandas for a worksheet named "all".
    if ref.sheet:
        opts.sheet = ref.sheet
    elif opts.sheet == "all":
        opts.sheet = None

    if ref.path.suffix.lower() not in _CSV_SUFFIXES:
        return opts

    guessed: list[str] = list(opts.sniffed)

    if opts.encoding is None:
        opts.encoding = _sniff_encoding(ref.path)
        guessed.append("encoding")

    try:
        with ref.path.open("rb") as handle:
            raw = handle.read(128 * 1024)
    except OSError as err:
        raise UnreadableSource(f"{ref.path} could not be read: {err}") from err

    sample = raw.decode(opts.encoding, errors="replace")
    # A truncated final line confuses both sniffers below.
    if len(raw) == 128 * 1024 and "\n" in sample:
        sample = sample[: sample.rindex("\n")]

    if not sample.strip():
        raise EmptyDataset(f"{ref.path.name} is empty.")

    if opts.delimiter is None:
        opts.delimiter = _sniff_delimiter(sample, ref.path.suffix.lower())
        guessed.append("delimiter")

    if opts.header == 0 and "header" not in guessed and not _has_header(sample, opts.delimiter):
        opts.header = None
        guessed.append("header")

    opts.sniffed = guessed
    return opts


def _sniff_encoding(path: Path) -> str:
    try:
        with path.open("rb") as handle:
            head = handle.read(64 * 1024)
    except OSError as err:
        raise UnreadableSource(f"{path} could not be read: {err}") from err

    for bom, name in _BOMS:
        if head.startswith(bom):
            return name

    for candidate in _ENCODING_CANDIDATES:
        try:
            head.decode(candidate)
        except UnicodeDecodeError:
            continue
        return candidate
    return "latin-1"  # decodes any byte sequence; the last resort by definition


def _sniff_delimiter(sample: str, suffix: str) -> str:
    if suffix == ".tsv":
        return "\t"
    if suffix == ".psv":
        return "|"
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters="".join(_DELIMITER_CANDIDATES))
        return str(dialect.delimiter)
    except csv.Error:
        # The sniffer raises rather than guessing on short or ragged
        # samples, which is a normal outcome here, not a failure. The
        # frequency fallback below handles exactly that case.
        pass

    # The sniffer gives up on short or ragged samples. Fall back to the
    # candidate whose per-line count is both non-zero and most consistent,
    # which is what "this is the delimiter" actually means.
    lines = [line for line in sample.splitlines() if line.strip()][:50]
    best, best_score = ",", -1.0
    for candidate in _DELIMITER_CANDIDATES:
        counts = [line.count(candidate) for line in lines]
        if not counts or min(counts) == 0:
            continue
        spread = max(counts) - min(counts)
        score = min(counts) - spread
        if score > best_score:
            best, best_score = candidate, score
    return best


def _has_header(sample: str, delimiter: str) -> bool:
    """True when row one looks like names rather than values.

    ``csv.Sniffer.has_header`` is asked last, not first. It compares row
    one against the body by type and length, which makes it answer *no*
    for an all-text file -- ``name,city`` over rows of names and cities
    is the single most ordinary CSV there is, and the sniffer calls it
    headerless because every row is a string of roughly the same size.

    So three structural tests run first, in order of how much they know:

    1. A first row that is entirely numbers is data. Nobody names a
       column ``1``.
    2. A non-numeric first row over numeric data is a header.
    3. Otherwise, if row one appears again in the body it is data;
       column names do not repeat as rows.

    Only a genuinely undecidable file reaches the sniffer, and an
    undecidable file gets a header: a header read as data costs one row
    of nonsense, while data read as a header costs every column its name.
    """
    rows = [row for row in csv.reader(io.StringIO(sample), delimiter=delimiter) if row]
    if len(rows) >= 2:
        first, rest = rows[0], rows[1:]
        filled = [cell for cell in first if cell.strip()]
        if filled and all(_looks_numeric(cell) for cell in filled):
            return False
        if not any(_looks_numeric(cell) for cell in first):
            if any(_looks_numeric(cell) for row in rest[:5] for cell in row):
                return True
            return tuple(first) not in {tuple(row) for row in rest}
    try:
        return bool(csv.Sniffer().has_header(sample))
    except csv.Error:
        return True


def _looks_numeric(cell: str) -> bool:
    text = cell.strip().replace(",", "")
    if not text:
        return False
    try:
        float(text)
    except ValueError:
        return False
    return True


# --------------------------------------------------------------------------
# Reading
# --------------------------------------------------------------------------


@dataclass
class LoadedFrame:
    """A frame plus what is true about the rows that are not in it.

    When nothing was sampled, ``frame`` is the whole dataset and
    ``exact`` is empty -- every statistic can be computed from the frame
    directly. When sampling happened, ``frame`` holds the sample and
    ``exact`` holds the per-column facts that were computed over the full
    stream, so the report can print an exact null count beside a sampled
    histogram and label each correctly.
    """

    frame: Any
    ref: SourceRef
    options: LoadOptions
    rows: int
    sampling: SamplingInfo = field(default_factory=SamplingInfo)
    exact: dict[str, dict[str, Any]] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    @property
    def columns(self) -> list[str]:
        return [str(c) for c in self.frame.columns]

    @property
    def memory_bytes(self) -> int:
        try:
            return int(self.frame.memory_usage(deep=True).sum())
        except Exception:  # noqa: BLE001 - a memory estimate is never worth an exception
            return 0

    def exact_for(self, column: str, key: str, fallback: Any = None) -> Any:
        """An exact statistic if the stream produced one, else ``fallback``."""
        return self.exact.get(column, {}).get(key, fallback)


def _pandas() -> Any:
    require()
    import pandas  # noqa: PLC0415 - deliberately deferred; see deps.py

    return pandas


def load(
    ref: SourceRef,
    options: LoadOptions | None = None,
    *,
    allow_sampling: bool = True,
) -> LoadedFrame:
    """Read one source into a :class:`LoadedFrame`.

    Args:
        ref: What to read.
        options: How to read it. Sniffed where not supplied.
        allow_sampling: When false, a file over the streaming threshold
            raises :class:`SamplingRequired` instead of sampling. The CLI
            uses this to ask before spending the time, not after.
    """
    require()
    opts = sniff(ref, options)
    suffix = ref.path.suffix.lower()
    size = ref.size

    if suffix in _CSV_SUFFIXES and size > FULL_LOAD_BYTES and opts.nrows is None:
        if not allow_sampling:
            from .errors import SamplingRequired

            raise SamplingRequired(
                f"{ref.label} is {_human(size)}; reading it exactly needs streaming. "
                "Pass --yes to proceed, or --nrows to read a prefix."
            )
        return _load_streaming(ref, opts)

    frame = _read_whole(ref, opts)
    frame = _normalise(frame)
    rows = int(len(frame))
    if rows == 0:
        raise EmptyDataset(f"{ref.label} parsed but has no rows.")
    if not len(frame.columns):
        raise EmptyDataset(f"{ref.label} parsed but has no columns.")

    warnings: list[str] = []
    sampling = SamplingInfo()

    if opts.sample and opts.sample < rows:
        frame = frame.sample(n=opts.sample, random_state=opts.seed).sort_index()
        sampling = SamplingInfo(
            applied=True,
            n=int(opts.sample),
            of=rows,
            seed=opts.seed,
            reason="requested with --sample",
        )
        warnings.append(
            f"Figures use a random sample of {opts.sample:,} of {rows:,} rows "
            f"(seed {opts.seed}); counts and nulls are exact."
        )

    if len(frame.columns) > WIDE_COLUMNS:
        warnings.append(
            f"{len(frame.columns)} columns is unusually wide; consider --columns to narrow it."
        )

    warnings.extend(_unread_sheets(ref))

    return LoadedFrame(
        frame=frame,
        ref=ref,
        options=opts,
        rows=rows,
        sampling=sampling,
        warnings=warnings,
    )


def _unread_sheets(ref: SourceRef) -> list[str]:
    """Name the sheets this run did *not* read.

    A nine-sheet workbook profiled as though it were one table is the
    spreadsheet version of silent sampling: the report is not wrong about
    what it read, it is wrong about what it is a report *of*. Reading the
    sheet names again costs one cheap open and buys a line that says so.
    """
    if ref.path.suffix.lower() not in _EXCEL_SUFFIXES or ref.covers_workbook:
        return []
    try:
        names = sheet_names(ref.path)
    except UnreadableSource:  # pragma: no cover - the read above already succeeded
        return []
    others = [name for name in names if name != ref.sheet]
    if not others:
        return []
    shown = ", ".join(others[:5]) + (", …" if len(others) > 5 else "")
    return [
        f"{ref.path.name} has {len(names)} sheets; this report covers "
        f"{ref.sheet!r} only. Not read: {shown}. Use --sheet NAME, or "
        "--sheet all to profile each as its own dataset."
    ]


def _human(size: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{size:.0f} {unit}" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024.0
    return f"{size:.1f} GB"  # pragma: no cover - unreachable, the loop returns


def source_kind(ref: SourceRef) -> str:
    """Which reader handles this file. Recorded in the recipe, not re-derived."""
    suffix = ref.path.suffix.lower()
    if suffix in _CSV_SUFFIXES:
        return "csv"
    if suffix in _JSONL_SUFFIXES:
        return "jsonl"
    if suffix in _JSON_SUFFIXES:
        return "json"
    if suffix in _PARQUET_SUFFIXES:
        return "parquet"
    if suffix in _EXCEL_SUFFIXES:
        return "excel"
    raise UnreadableSource(
        f"{ref.path.name}: {suffix or 'no extension'} is not a format this tool reads. "
        f"Readable: {', '.join(sorted(READABLE_SUFFIXES))}."
    )


def _read_whole(ref: SourceRef, opts: LoadOptions) -> Any:
    """Delegate to the portable reader, and classify whatever it raises.

    The read itself is in ``readers.py`` because the generated script has
    to perform the same one. This wrapper is the part that cannot be
    portable: turning pandas' wide, unstable exception surface into a
    ``THLError`` with a sentence in it.
    """
    from . import readers  # noqa: PLC0415 - deferred with the rest of the extra

    kind = source_kind(ref)
    try:
        return readers.read_source(
            ref.path,
            kind=kind,
            sep=opts.delimiter,
            encoding=opts.encoding,
            header=opts.header,
            na_values=list(opts.na_values) or None,
            nrows=opts.nrows,
            # Already resolved by sniff(), which is the one place that
            # decides between the ref's sheet and the caller's option.
            sheet=opts.sheet,
        )
    except ImportError as err:
        extra = "eda-parquet" if kind == "parquet" else "eda-excel"
        raise UnreadableSource(
            f"Reading {ref.path.name} needs an extra dependency. "
            f"Install with: pip install thehallucinatedlab[{extra}]"
        ) from err
    except (EmptyDataset, UnreadableSource):
        raise
    except Exception as err:  # noqa: BLE001 - pandas raises a wide, unstable set here
        raise UnreadableSource(
            f"{ref.label} could not be parsed: {type(err).__name__}: {err}"
        ) from err


def _normalise(frame: Any) -> Any:
    from . import readers  # noqa: PLC0415 - deferred with the rest of the extra

    return readers.normalise_columns(frame)


# --------------------------------------------------------------------------
# Streaming path
# --------------------------------------------------------------------------


def _load_streaming(ref: SourceRef, opts: LoadOptions) -> LoadedFrame:
    """Read a large CSV once, keeping exact statistics and a fair sample.

    The pass itself is :func:`~.readers.stream_source`, shared with the
    generated script so a replay draws the same sample. This wrapper adds
    the error classification and the sampling banner.
    """
    from . import readers  # noqa: PLC0415 - deferred with the rest of the extra

    target = int(opts.sample or DEFAULT_SAMPLE_ROWS)
    try:
        frame, total, exact = readers.stream_source(
            ref.path,
            sep=opts.delimiter,
            encoding=opts.encoding,
            header=opts.header,
            na_values=list(opts.na_values) or None,
            chunk_rows=CHUNK_ROWS,
            sample_rows=target,
            seed=opts.seed,
            distinct_cap=DISTINCT_CAP,
        )
    except (EmptyDataset, UnreadableSource):
        raise
    except Exception as err:  # noqa: BLE001 - pandas raises a wide, unstable set here
        raise UnreadableSource(
            f"{ref.label} could not be parsed: {type(err).__name__}: {err}"
        ) from err

    if not total:
        raise EmptyDataset(f"{ref.label} parsed but has no rows.")

    sampling = SamplingInfo(
        applied=len(frame) < total,
        n=int(len(frame)),
        of=total,
        seed=opts.seed,
        reason=f"source is {_human(ref.size)}, over the {_human(FULL_LOAD_BYTES)} full-load limit",
    )
    warnings = []
    if sampling.applied:
        warnings.append(
            f"{ref.label} was streamed: counts, nulls, min/max and cardinality are exact; "
            f"figures use {sampling.n:,} of {total:,} rows (seed {opts.seed})."
        )
    return LoadedFrame(
        frame=frame,
        ref=ref,
        options=opts,
        rows=total,
        sampling=sampling,
        exact=exact,
        warnings=warnings,
    )


def preview(ref: SourceRef, opts: LoadOptions, rows: int = 10) -> Any:
    """The first ``rows`` rows, for the load-options screen's live preview.

    Errors are swallowed into an empty frame on purpose: the screen exists
    so the user can fix a wrong delimiter, and a traceback every keystroke
    while they do that is worse than an empty table.
    """
    pandas = _pandas()
    try:
        limited = replace(opts, nrows=rows)
        return _normalise(_read_whole(ref, limited))
    except Exception:  # noqa: BLE001 - see docstring
        return pandas.DataFrame()


def describe_source(ref: SourceRef) -> dict[str, Any]:
    """Size and shape facts that need no parse. Used by the picker screen."""
    return {
        "path": str(ref.path),
        "label": ref.label,
        "bytes": ref.size,
        "size": _human(ref.size),
        "rows_estimate": estimate_rows(ref),
        "format": ref.path.suffix.lower().lstrip(".") or "unknown",
    }


def read_text_head(path: Path, encoding: str, lines: int = 12) -> list[str]:
    """First ``lines`` physical lines, for the load screen's raw view."""
    try:
        with path.open("r", encoding=encoding, errors="replace", newline="") as handle:
            return [next(handle).rstrip("\r\n") for _ in range(lines)]
    except (OSError, StopIteration):
        try:
            with path.open("r", encoding=encoding, errors="replace") as handle:
                return handle.read(8192).splitlines()[:lines]
        except OSError:
            return []


def as_buffer(text: str) -> io.StringIO:
    """A file-like over ``text``. Used by tests and by the session preview."""
    return io.StringIO(text)
