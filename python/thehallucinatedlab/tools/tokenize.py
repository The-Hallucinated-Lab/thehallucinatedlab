"""Count tokens, so a corpus can be budgeted before it is embedded.

This is a measuring instrument, not a stage of the pipeline. An
embedding model tokenizes internally with its own vocabulary -- BGE-M3
is XLM-RoBERTa, SentencePiece, roughly 250k pieces -- so there is no
such thing as handing it a pre-tokenized file. A tiktoken id stream fed
to BGE-M3 is not "already tokenized", it is a different alphabet.

What a tokenizer is genuinely for here is two questions:

    how big should a chunk be, so it fits the model's context?
    what will embedding this corpus cost?

``chunk`` imports :func:`counter_for` to answer the first. The tool
itself answers the second.

Three counters, and the difference matters:

    bge       exact for this pipeline. Downloads ~17MB -- the tokenizer,
              not the 2.3GB model.
    openai    tiktoken, for costing against a different model. Wrong
              for BGE-M3 by construction.
    estimate  no download, no dependency, deliberately high. A chunk
              sized by an under-count overflows the real tokenizer at
              embed time and the tail is silently dropped, so the
              heuristic errs the only safe direction.
"""

from __future__ import annotations

import json
import os
import re
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Union

from ..deps import require
from ..errors import InvalidArgument
from ..registry import registry

Source = Union[str, "os.PathLike[str]", bytes, bytearray, Any]

# One token per character for scripts that do not use spaces. Han, kana,
# Hangul: SentencePiece rarely merges these below one piece per glyph,
# and often produces more.
_DENSE = (
    "぀-ヿ"  # kana
    "㐀-䶿"  # CJK extension A
    "一-鿿"  # CJK unified
    "가-힯"  # Hangul
)
_LATIN = "A-Za-zÀ-ɏ"

_PIECE = re.compile(f"[{_DENSE}]|[{_LATIN}]+|\\d+|[^\\s{_LATIN}0-9{_DENSE}]")

# Applied to the heuristic's raw count: +15%. Under-counting is the
# expensive mistake -- it produces chunks that overflow at embed time and
# lose their tail silently -- so the estimate is biased high rather than
# centred. Kept as a fraction so both runtimes can do integer arithmetic.
_SAFETY_NUM = 115
_SAFETY_DEN = 100

_cache: dict[str, Callable[[str], int]] = {}


def estimate_tokens(text: str) -> int:
    """Count tokens without a tokenizer, erring high.

    Mirrors estimateTokens() in toolkit.js exactly. The browser has no
    way to run BGE-M3's tokenizer without a 17MB download, so it chunks
    against this and records that it did -- and ``embed`` re-checks with
    the real thing rather than trusting it.
    """
    body = str(text or "")
    if not body.strip():
        return 0

    total = 0
    for piece in _PIECE.findall(body):
        if re.fullmatch(f"[{_LATIN}]+", piece):
            # ~4 characters per piece for Latin script, rounded up.
            total += max(1, -(-len(piece) // 4))
        elif piece.isdigit():
            # Digits fragment far more than letters; most vocabularies
            # carry only short numeric pieces.
            total += max(1, -(-len(piece) // 2))
        else:
            total += 1
    # Integer arithmetic, not float: ceil(total * 1.15) computed through
    # a float rounds differently in JavaScript at some magnitudes, and
    # the two runtimes must agree exactly or the shared fixtures split.
    return (total * _SAFETY_NUM + _SAFETY_DEN - 1) // _SAFETY_DEN


def _bge_counter() -> Callable[[str], int]:
    tokenizers = require("tokenizers", extra="chunk", purpose="counting BGE-M3 tokens")
    encoder = tokenizers.Tokenizer.from_pretrained("BAAI/bge-m3")

    def count_bge(text: str) -> int:
        return len(encoder.encode(text, add_special_tokens=True).ids)

    return count_bge


def _openai_counter() -> Callable[[str], int]:
    tiktoken = require("tiktoken", extra="chunk", purpose="counting OpenAI tokens")
    encoding = tiktoken.get_encoding("cl100k_base")

    def count_openai(text: str) -> int:
        return len(encoding.encode(text))

    return count_openai


_BUILDERS: dict[str, Callable[[], Callable[[str], int]]] = {
    "bge": _bge_counter,
    "openai": _openai_counter,
    "estimate": lambda: estimate_tokens,
}


def counter_for(tokenizer: str = "bge") -> Callable[[str], int]:
    """A function that counts tokens the way ``tokenizer`` does.

    Cached, because building the BGE counter downloads and parses a
    17MB vocabulary and chunking calls it once per candidate boundary.
    """
    if tokenizer not in _BUILDERS:
        raise InvalidArgument(
            f"Unknown tokenizer {tokenizer!r}. Known: {', '.join(_BUILDERS)}."
        )
    if tokenizer not in _cache:
        _cache[tokenizer] = _BUILDERS[tokenizer]()
    return _cache[tokenizer]


def is_exact(tokenizer: str) -> bool:
    """Whether this counter matches what the embedding model will do."""
    return tokenizer == "bge"


@dataclass
class TokenReport:
    """What a corpus costs, and what will not fit.

    ``over_limit`` is the number that matters. A piece longer than the
    model's context is not an error at embed time -- it is silently
    truncated, and the tail simply never reaches the vector. Finding
    that here is the whole point of the tool.
    """

    tokenizer: str
    exact: bool
    limit: int
    pieces: int
    total: int
    smallest: int
    largest: int
    mean: float
    median: int
    p95: int
    over_limit: int
    empty: int

    def __str__(self) -> str:
        if self.exact:
            how = "exact"
        elif self.tokenizer == "estimate":
            how = "estimated"
        else:
            how = f"{self.tokenizer}, approximate for bge"
        tail = f", {self.over_limit} over {self.limit}" if self.over_limit else ""
        return (
            f"{self.total:,} tokens across {self.pieces:,} piece(s) "
            f"[{how}]; median {self.median}, largest {self.largest}{tail}"
        )

    def as_dict(self) -> dict[str, Any]:
        return {
            "tokenizer": self.tokenizer,
            "exact": self.exact,
            "limit": self.limit,
            "pieces": self.pieces,
            "total": self.total,
            "smallest": self.smallest,
            "largest": self.largest,
            "mean": self.mean,
            "median": self.median,
            "p95": self.p95,
            "over_limit": self.over_limit,
            "empty": self.empty,
        }


def _percentile(ordered: Sequence[int], fraction: float) -> int:
    """Nearest-rank percentile. No numpy for a one-line statistic."""
    if not ordered:
        return 0
    index = max(0, min(len(ordered) - 1, int(round(fraction * (len(ordered) - 1)))))
    return ordered[index]


def analyze(
    texts: Iterable[str],
    tokenizer: str = "bge",
    limit: int = 8192,
) -> TokenReport:
    """Measure an iterable of pieces."""
    count = counter_for(tokenizer)
    counts = [count(text) for text in texts]
    ordered = sorted(counts)
    non_empty = [c for c in counts if c]

    return TokenReport(
        tokenizer=tokenizer,
        exact=is_exact(tokenizer),
        limit=limit,
        pieces=len(counts),
        total=sum(counts),
        smallest=ordered[0] if ordered else 0,
        largest=ordered[-1] if ordered else 0,
        mean=round(sum(counts) / len(counts), 1) if counts else 0.0,
        median=_percentile(ordered, 0.5),
        p95=_percentile(ordered, 0.95),
        over_limit=sum(1 for c in counts if c > limit),
        empty=len(counts) - len(non_empty),
    )


def _pieces_from(payload: bytes, name: str) -> list[str]:
    """One piece per JSONL record, or the whole document otherwise.

    A .jsonl input is assumed to be chunk's output, so each record is
    measured separately -- which is the only way "how many chunks
    overflow" is a meaningful question.
    """
    text = re.sub(r"\r\n?", "\n", payload.decode("utf-8", errors="replace"))
    if not name.lower().endswith(".jsonl"):
        return [text]

    pieces: list[str] = []
    for number, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as err:
            raise InvalidArgument(f"{name} line {number} is not valid JSON: {err}") from err
        if not isinstance(record, dict) or "text" not in record:
            raise InvalidArgument(f"{name} line {number} has no 'text' field.")
        pieces.append(str(record["text"]))
    return pieces


def tokenize(
    source: Source,
    *,
    tokenizer: str | None = None,
    limit: int | None = None,
    filename: str | None = None,
) -> TokenReport:
    """Count the tokens in ``source``.

    Args:
        source: Path to a document, raw bytes, a binary file object, or
            a list of strings to measure directly.
        tokenizer: ``"bge"`` (default, exact for this pipeline),
            ``"openai"``, or ``"estimate"``.
        limit: Context window to measure against. Default 8192.
        filename: Name to attribute bytes to, so a .jsonl input is
            recognised and measured per record.

    Returns:
        A :class:`TokenReport`.

    Raises:
        InvalidArgument: an argument is outside what the manifest allows,
            or a JSONL line is malformed.
        DependencyMissing: the chosen tokenizer needs the ``chunk`` extra.

    Example:
        >>> report = tokenize(["hello there"], tokenizer="estimate")
        >>> report.pieces
        1
    """
    args = registry.validate("tokenize", tokenizer=tokenizer, limit=limit)

    if isinstance(source, list | tuple):
        pieces = [str(item) for item in source]
    else:
        if isinstance(source, bytes | bytearray):
            payload, name = bytes(source), filename or ""
        elif hasattr(source, "read"):
            raw = source.read()
            if not isinstance(raw, bytes):
                raise InvalidArgument("A file object must be opened in binary mode.")
            payload, name = raw, filename or ""
        else:
            path = Path(os.fspath(source))
            if not path.is_file():
                raise InvalidArgument(f"No such file: {path}")
            payload, name = path.read_bytes(), filename or path.name
        pieces = _pieces_from(payload, name)

    return analyze(pieces, args["tokenizer"], args["limit"])


registry.register("tokenize", tokenize)
