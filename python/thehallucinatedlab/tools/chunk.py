"""Split a Markdown document into retrieval-sized pieces.

Structure first, size second. A chunk is a section of the document --
identified by the headings above it and the page it started on -- rather
than an arbitrary window of characters that happens to be 512 tokens
long. That distinction is the whole reason ``extract`` goes to the
trouble of preserving headings.

Size is the constraint, not the organising principle. Within a section,
blocks are packed until the next one would not fit; only a single block
that is itself too large gets cut, and then on the largest boundary that
works: paragraphs, then sentences, then words.

Every chunk records where it came from -- ``heading_path``, ``page``,
``source`` -- because that metadata is what turns a retrieved fragment
into a citation. Output is JSONL, one record per line, which is the same
shape a LangChain ``Document`` carries and stays greppable besides.

One honest limitation. The browser cannot run BGE-M3's tokenizer without
a 17MB download, so it chunks against a heuristic that deliberately
over-counts and records ``tokenizer: "estimate"`` on every record.
``embed`` re-checks rather than trusting it. Under-counting would be the
expensive direction: an oversized chunk is not rejected at embed time,
it is silently truncated, and the tail never reaches the vector.
"""

from __future__ import annotations

import json
import os
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Union

from ..errors import InvalidArgument
from ..registry import registry
from .tokenize import counter_for, is_exact

Source = Union[str, "os.PathLike[str]", bytes, bytearray, Any]

_FRONTMATTER = re.compile(r"\A---\n(.*?)\n---\n?", re.DOTALL)
_PAGE_MARKER = re.compile(r"<!--\s*page:\s*(\d+)\s*-->")
_HEADING = re.compile(r"^(#{1,6})\s+(.*)$")
_FENCE = re.compile(r"^\s*```")
# Split after . ! ? that are followed by whitespace. Deliberately simple:
# a full abbreviation list would be a lot of machinery for a boundary
# that only matters when one paragraph is already oversized.
_SENTENCE = re.compile(r"(?<=[.!?])\s+")


@dataclass
class Chunk:
    """One piece, and everything needed to cite it."""

    text: str
    source: str
    heading_path: list[str]
    page: int | None
    chunk_index: int
    token_count: int
    tokenizer: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "text": self.text,
            "source": self.source,
            "heading_path": self.heading_path,
            "page": self.page,
            "chunk_index": self.chunk_index,
            "token_count": self.token_count,
            "tokenizer": self.tokenizer,
        }


@dataclass
class ChunkResult:
    """What a chunking produced."""

    chunks: list[Chunk]
    tokenizer: str
    exact: bool
    max_tokens: int
    path: Path | None = None
    warnings: list[str] = field(default_factory=list)

    @property
    def total_tokens(self) -> int:
        return sum(c.token_count for c in self.chunks)

    def as_jsonl(self) -> str:
        # ensure_ascii=False so non-Latin text stays readable in the file
        # rather than becoming \uXXXX soup nobody can grep.
        return "".join(
            json.dumps(c.as_dict(), ensure_ascii=False) + "\n" for c in self.chunks
        )

    def __str__(self) -> str:
        if self.exact:
            how = "exact"
        elif self.tokenizer == "estimate":
            how = "estimated"
        else:
            how = f"{self.tokenizer}, approximate for bge"
        where = str(self.path) if self.path else "in memory"
        return (
            f"{len(self.chunks)} chunk(s), {self.total_tokens:,} tokens "
            f"[{how}] -> {where}"
        )


def parse_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    """Split extract's YAML block off the front.

    Only handles what ``extract`` writes -- quoted strings and bare
    numbers, one per line. A general YAML parser would be a dependency
    for the sake of a header this package produced itself.
    """
    match = _FRONTMATTER.match(text)
    if not match:
        return {}, text

    meta: dict[str, Any] = {}
    for line in match.group(1).split("\n"):
        if ":" not in line:
            continue
        key, _, raw = line.partition(":")
        value = raw.strip()
        if len(value) >= 2 and value[0] == '"' and value[-1] == '"':
            meta[key.strip()] = value[1:-1].replace('\\"', '"').replace("\\\\", "\\")
        elif re.fullmatch(r"-?\d+", value):
            meta[key.strip()] = int(value)
        elif value:
            meta[key.strip()] = value
    return meta, text[match.end():]


def parse_blocks(body: str) -> list[dict[str, Any]]:
    """Walk the document into blocks, each knowing its heading path.

    Headings are not emitted as blocks. They become the path attached to
    everything beneath them, so the text is not duplicated -- once as a
    heading and again inside the chunk that follows it.
    """
    blocks: list[dict[str, Any]] = []
    stack: list[tuple[int, str]] = []
    page: int | None = None
    buffer: list[str] = []
    fenced = False

    def flush() -> None:
        text = "\n".join(buffer).strip()
        buffer.clear()
        if text:
            blocks.append({
                "text": text,
                "page": page,
                "path": [title for _, title in stack],
            })

    for line in body.split("\n"):
        if _FENCE.match(line):
            # Inside a fence, blank lines and #-lines are code, not
            # structure. Splitting there would cut a snippet in half.
            fenced = not fenced
            buffer.append(line)
            continue

        if fenced:
            buffer.append(line)
            continue

        marker = _PAGE_MARKER.search(line)
        if marker and not line.strip().replace(marker.group(0), "").strip():
            flush()
            page = int(marker.group(1))
            continue

        heading = _HEADING.match(line)
        if heading:
            flush()
            level = len(heading.group(1))
            while stack and stack[-1][0] >= level:
                stack.pop()
            stack.append((level, heading.group(2).strip()))
            continue

        if not line.strip():
            flush()
            continue

        buffer.append(line)

    flush()
    return blocks


def _greedy(
    parts: list[str], joiner: str, budget: int, count: Callable[[str], int]
) -> list[str]:
    """Fill each piece until the next part would not fit."""
    out: list[str] = []
    current = ""
    for part in parts:
        candidate = f"{current}{joiner}{part}" if current else part
        if current and count(candidate) > budget:
            out.append(current)
            current = part
        else:
            current = candidate
    if current:
        out.append(current)
    return out


def _split_text(text: str, budget: int, count: Callable[[str], int]) -> list[str]:
    """Cut one oversized block on the largest boundary that still fits.

    Tried in order, coarsest first, so a paragraph is only broken into
    sentences when the paragraph alone is too big, and only into words
    when a single sentence is.
    """
    if count(text) <= budget:
        return [text]

    for parts, joiner in (
        (text.split("\n\n"), "\n\n"),
        (_SENTENCE.split(text), " "),
        (text.split(" "), " "),
    ):
        usable = [p for p in parts if p.strip()]
        if len(usable) < 2:
            continue
        out = _greedy(usable, joiner, budget, count)
        if all(count(piece) <= budget for piece in out):
            return out

    # Nothing divides small enough -- one enormous unbroken run. Cut on
    # characters rather than emit something that would be truncated
    # invisibly at embed time, taking its tail out of the vector.
    approx = max(1, budget * 3)
    return [text[i:i + approx] for i in range(0, len(text), approx)]


def _tail(text: str, budget: int, count: Callable[[str], int]) -> str:
    """The last ``budget`` tokens' worth of ``text``, on a word boundary."""
    if budget <= 0:
        return ""
    words = text.split()
    kept: list[str] = []
    for word in reversed(words):
        kept.insert(0, word)
        if count(" ".join(kept)) >= budget:
            break
    return " ".join(kept)


def pack(
    blocks: list[dict[str, Any]],
    *,
    max_tokens: int,
    overlap: int,
    heading_context: bool,
    count: Callable[[str], int],
    source: str,
) -> list[Chunk]:
    """Group blocks into chunks that respect both structure and size."""
    chunks: list[Chunk] = []

    def prefix_for(path: list[str]) -> str:
        return " > ".join(path) + "\n\n" if (heading_context and path) else ""

    # Consecutive blocks sharing a heading path form a section. A chunk
    # never spans two sections, so a piece is always answerable by one
    # heading path rather than an ambiguous pair.
    sections: list[tuple[list[str], list[dict[str, Any]]]] = []
    for block in blocks:
        if sections and sections[-1][0] == block["path"]:
            sections[-1][1].append(block)
        else:
            sections.append((list(block["path"]), [block]))

    def emit(prefix: str, path: list[str], body: str, page: int | None) -> None:
        body = body.strip()
        if not body:
            return
        text = prefix + body
        chunks.append(Chunk(
            text=text,
            source=source,
            heading_path=list(path),
            page=page,
            chunk_index=len(chunks),
            token_count=count(text),
            tokenizer="",     # filled in by the caller, which knows it
        ))

    for path, members in sections:
        prefix = prefix_for(path)
        budget = max_tokens - count(prefix) if prefix else max_tokens
        if budget < 1:
            # A heading path so long it leaves no room for text. Drop the
            # prefix for this section rather than emit empty chunks.
            prefix, budget = "", max_tokens

        # Flatten first: every piece here already fits the budget, so the
        # packing loop below only has to decide where boundaries fall.
        pieces = [
            (piece, block["page"])
            for block in members
            for piece in _split_text(block["text"], budget, count)
        ]

        current = ""
        current_page: int | None = None

        for piece, page in pieces:
            candidate = f"{current}\n\n{piece}" if current else piece
            if current and count(candidate) > budget:
                emit(prefix, path, current, current_page)
                carry = _tail(current, overlap, count)
                current = f"{carry}\n\n{piece}" if carry else piece
                # The carry is sized in tokens, and the piece was only
                # checked on its own. Together they can exceed the
                # budget, which would hand embed an oversized chunk --
                # so drop the overlap rather than the guarantee.
                if count(current) > budget:
                    current = piece
                current_page = page
            else:
                current = candidate
                if current_page is None:
                    current_page = page

        emit(prefix, path, current, current_page)

    return chunks


def chunk(
    source: Source,
    dest: str | os.PathLike[str] | None = None,
    *,
    max_tokens: int | None = None,
    overlap: int | None = None,
    tokenizer: str | None = None,
    heading_context: bool | None = None,
    filename: str | None = None,
) -> ChunkResult:
    """Split a Markdown document into JSONL chunks.

    Args:
        source: Path to a Markdown file, raw bytes, a binary file object,
            or the document as a string.
        dest: Where to write the JSONL. Defaults to the source path with
            a .jsonl extension.
        max_tokens: Largest chunk, in tokens. Default 512.
        overlap: Tokens repeated across a boundary. Default 64. Must be
            smaller than ``max_tokens``.
        tokenizer: ``"bge"`` (default), ``"openai"`` or ``"estimate"``.
        heading_context: Prepend the heading path to each chunk.
        filename: Name to attribute bytes to.

    Returns:
        A :class:`ChunkResult`.

    Raises:
        InvalidArgument: an argument is outside what the manifest allows,
            or overlap is not smaller than max_tokens.
        DependencyMissing: the chosen tokenizer needs the ``chunk`` extra.
    """
    args = registry.validate(
        "chunk",
        max_tokens=max_tokens,
        overlap=overlap,
        tokenizer=tokenizer,
        heading_context=heading_context,
    )

    # The manifest can express each bound but not the relationship. An
    # overlap at least as large as the chunk means every chunk begins
    # with the whole of the one before it, and the packer never advances.
    if args["overlap"] >= args["max_tokens"]:
        raise InvalidArgument(
            f"overlap ({args['overlap']}) must be smaller than max_tokens "
            f"({args['max_tokens']}); otherwise each chunk would repeat the whole "
            "of the previous one and chunking would not terminate."
        )

    source_path: Path | None = None
    if isinstance(source, str) and "\n" in source:
        text = source                      # the document itself
    elif isinstance(source, bytes | bytearray):
        text = bytes(source).decode("utf-8", errors="replace")
    elif hasattr(source, "read"):
        raw = source.read()
        if not isinstance(raw, bytes):
            raise InvalidArgument("A file object must be opened in binary mode.")
        text = raw.decode("utf-8", errors="replace")
    else:
        source_path = Path(os.fspath(source))
        if not source_path.is_file():
            raise InvalidArgument(f"No such document: {source_path}")
        text = source_path.read_bytes().decode("utf-8", errors="replace")

    text = re.sub(r"\r\n?", "\n", text)
    meta, body = parse_frontmatter(text)
    name = (
        filename
        or (str(meta.get("source")) if meta.get("source") else None)
        or (source_path.name if source_path else "")
    )

    count = counter_for(args["tokenizer"])
    blocks = parse_blocks(body)
    chunks = pack(
        blocks,
        max_tokens=args["max_tokens"],
        overlap=args["overlap"],
        heading_context=args["heading_context"],
        count=count,
        source=name,
    )
    for piece in chunks:
        piece.tokenizer = args["tokenizer"]

    warnings: list[str] = []
    if not is_exact(args["tokenizer"]):
        warnings.append(
            f"Counted with {args['tokenizer']}, which does not match the embedding "
            "model. Sizes are approximate; embed will re-check."
        )
    if not blocks:
        warnings.append("Nothing to chunk -- the document had no body text.")
    if blocks and not any(b["path"] for b in blocks):
        warnings.append(
            "No headings found, so chunking fell back to size alone. If this came "
            "from a PDF without an outline, that is expected."
        )

    target: Path | None = None
    if dest is not None:
        target = Path(os.fspath(dest))
    elif source_path is not None:
        target = source_path.with_suffix(".jsonl")

    result = ChunkResult(
        chunks=chunks,
        tokenizer=args["tokenizer"],
        exact=is_exact(args["tokenizer"]),
        max_tokens=args["max_tokens"],
        path=target,
        warnings=warnings,
    )

    if target is not None:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(result.as_jsonl(), encoding="utf-8", newline="")

    return result


registry.register("chunk", chunk)
