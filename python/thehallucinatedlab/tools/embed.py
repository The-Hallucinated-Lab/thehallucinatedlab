"""Turn chunks into vectors — stage 4.

Reads the JSONL chunk produced and writes one vector per record: a single
.npy of shape (count, dimensions), not one file per chunk. A corpus of
40,000 chunks is 40,000 files nobody wants to move around.

Vectors are L2-normalised by default, which makes cosine similarity and
dot product the same operation and is what most vector stores assume.

BGE-M3 needs no instruction prefix, unlike bge-large-en. Adding one would
quietly shift every vector away from where the model was trained to put
it.

``_build_encoder`` is a module-level seam on purpose: tests replace it
with a deterministic fake so the whole path around the model runs in CI
without downloading 2.3GB of weights.
"""

from __future__ import annotations

import json
import os
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Union

from ..deps import require
from ..errors import InvalidArgument
from ..registry import registry

Source = Union[str, "os.PathLike[str]", Any]


@dataclass
class EmbedResult:
    """What an embedding run produced."""

    model: str
    model_id: str
    dimensions: int
    normalized: bool
    count: int
    ids: list[str]
    path: Path | None = None
    vectors: Any = None
    warnings: list[str] = field(default_factory=list)

    def __str__(self) -> str:
        where = str(self.path) if self.path else "in memory"
        norm = "normalised" if self.normalized else "raw"
        return (
            f"{self.count} vector(s) x {self.dimensions} dims "
            f"[{self.model_id}, {norm}] -> {where}"
        )


def _model_spec(model: str) -> dict[str, Any]:
    """The manifest's record for one model: id, dimensions, context."""
    return registry.describe("embed")["meta"]["models"][model]


def default_model() -> str:
    """The manifest's default model.

    Read rather than restated, and exposed because ``index`` needs the
    same answer to check a vector width against the model that supposedly
    produced it.
    """
    for param in registry.describe("embed")["params"]:
        if param["name"] == "model":
            return str(param["default"])
    raise InvalidArgument("The embed tool declares no model parameter.")


def read_chunks(source: Source) -> list[dict[str, Any]]:
    """Load chunk records from a JSONL file.

    Names the offending line number rather than the file: a corpus of
    40,000 chunks with one bad line is not usefully described by "this
    file is invalid".
    """
    path = Path(os.fspath(source))
    if not path.is_file():
        raise InvalidArgument(f"No such chunk file: {path}")

    text = re.sub(r"\r\n?", "\n", path.read_text(encoding="utf-8", errors="replace"))
    records: list[dict[str, Any]] = []

    for number, line in enumerate(text.split("\n"), start=1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as err:
            raise InvalidArgument(f"{path.name} line {number} is not valid JSON: {err}") from err
        if not isinstance(record, dict) or "text" not in record:
            raise InvalidArgument(f"{path.name} line {number} has no 'text' field.")
        records.append(record)

    if not records:
        raise InvalidArgument(
            f"{path.name} contains no chunks. Embedding nothing would write an empty "
            "index that only fails later, when someone tries to search it."
        )
    return records


def chunk_ids(records: list[dict[str, Any]]) -> list[str]:
    """A stable, unique id per chunk.

    Uniqueness is not cosmetic. Every vector store treats ids as primary
    keys, so a duplicate silently overwrites the earlier row and the
    corpus quietly loses a chunk -- with no error, and no way to notice
    except by counting. The positional suffix guarantees uniqueness even
    when source and chunk_index are missing or repeated.
    """
    return [
        f"{record.get('source') or 'chunk'}:{record.get('chunk_index', position)}#{position}"
        for position, record in enumerate(records)
    ]


def _build_encoder(model_id: str, dimensions: int, batch_size: int) -> Callable[[list[str]], Any]:
    """Build the real encoder. Replaced wholesale in tests.

    Loads sentence-transformers lazily through deps.require so importing
    this module never pulls in torch.
    """
    sentence_transformers = require(
        "sentence_transformers", extra="embed", purpose="embedding chunks"
    )
    encoder = sentence_transformers.SentenceTransformer(model_id)

    def encode(texts: list[str]) -> Any:
        return encoder.encode(texts, batch_size=batch_size, convert_to_numpy=True)

    return encode


def embed(
    source: Source,
    dest: str | os.PathLike[str] | None = None,
    *,
    model: str | None = None,
    batch_size: int | None = None,
    normalize: bool | None = None,
) -> EmbedResult:
    """Embed the chunks in ``source``.

    Args:
        source: Path to the JSONL that ``chunk`` produced.
        dest: Where to write the .npy. Defaults to the source path with a
            .npy extension.
        model: ``"bge"`` (default, 1024 dims) or ``"minilm"`` (384 dims).
        batch_size: How many chunks to encode at once. Default 16.
        normalize: L2-normalise each vector. Default True.

    Returns:
        An :class:`EmbedResult`.

    Raises:
        InvalidArgument: an argument is outside what the manifest allows,
            or the chunk file is empty or malformed.
        DependencyMissing: sentence-transformers is not installed.
    """
    # First, and before anything reaches the model: a typo in an argument
    # should not cost a 2.3GB download before it is reported.
    args = registry.validate("embed", model=model, batch_size=batch_size, normalize=normalize)

    spec = _model_spec(args["model"])
    model_id = str(spec["id"])
    dimensions = int(spec["dimensions"])

    records = read_chunks(source)
    ids = chunk_ids(records)

    numpy = require("numpy", extra="embed", purpose="holding vectors")
    encoder = _build_encoder(model_id, dimensions, args["batch_size"])
    vectors = numpy.asarray(encoder([str(r["text"]) for r in records]), dtype=numpy.float32)

    if vectors.ndim != 2 or vectors.shape[0] != len(records):
        raise InvalidArgument(
            f"The encoder returned shape {vectors.shape} for {len(records)} chunk(s); "
            "expected exactly one row per chunk."
        )

    if args["normalize"]:
        norms = numpy.linalg.norm(vectors, axis=1, keepdims=True)
        # An all-zero row has no direction to preserve, and dividing by
        # its norm produces NaN -- which poisons every later similarity
        # rather than failing anywhere visible.
        vectors = vectors / numpy.where(norms == 0, 1.0, norms)

    vectors = vectors.astype(numpy.float32, copy=False)

    target = (
        Path(os.fspath(dest))
        if dest is not None
        else Path(os.fspath(source)).with_suffix(".npy")
    )
    target.parent.mkdir(parents=True, exist_ok=True)
    numpy.save(target, vectors)

    return EmbedResult(
        model=args["model"],
        model_id=model_id,
        dimensions=int(vectors.shape[1]),
        normalized=bool(args["normalize"]),
        count=len(records),
        ids=ids,
        path=target,
        vectors=vectors,
    )


registry.register("embed", embed)
