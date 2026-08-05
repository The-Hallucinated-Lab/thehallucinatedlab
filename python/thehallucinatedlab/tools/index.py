"""Build a portable vector database — stage 5.

The output is the deliverable: a directory the user owns and can query
with their own code. Which means it has to be *openable*, and that is
mostly about the sidecar.

A folder of vectors with no record of which model produced them is not a
database, it is a puzzle. Chroma's default embedding function is
all-MiniLM-L6-v2 at 384 dimensions; point it at 1024-dimension BGE-M3
vectors and it either raises a dimension error or, if the widths happen
to line up, silently returns nonsense that looks like results. So every
index written here carries ``thl-index.json`` recording the model, its
id, the dimensions, whether vectors were normalised, and the count --
plus a runnable query snippet, so the first thing you can do with the
output is use it.

FAISS is deliberately not offered. LangChain's FAISS wrapper pickles its
docstore and now requires ``allow_dangerous_deserialization=True`` to
load it back, which is the wrong thing to hand someone whose whole
purpose is opening this folder later.
"""

from __future__ import annotations

import json
import os
import shutil
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Union

from ..deps import require
from ..errors import InvalidArgument
from ..registry import registry
from .embed import _model_spec, default_model, read_chunks

Source = Union[str, "os.PathLike[str]", Any]

SIDECAR = "thl-index.json"
SNIPPET = "query.py"
VECTORS = "vectors.npy"
CHUNKS = "chunks.jsonl"

# How close a row's L2 norm must be to 1 before the index is described as
# normalised. Generous enough to survive float32 accumulation, tight
# enough that genuinely raw vectors are never mislabelled.
_UNIT_TOLERANCE = 1e-3


@dataclass
class IndexResult:
    """What an index build produced."""

    store: str
    collection: str
    path: Path
    sidecar: Path
    count: int
    dimensions: int
    model: str
    model_id: str
    snippet: str = ""
    warnings: list[str] = field(default_factory=list)

    def __str__(self) -> str:
        return (
            f"{self.store} index '{self.collection}': {self.count} vector(s) "
            f"x {self.dimensions} dims [{self.model_id}] -> {self.path}"
        )


def query_snippet(store: str, collection: str, model_id: str, dimensions: int) -> str:
    """The few lines that open this index and search it.

    Written into the output directory. It names ``model_id`` explicitly
    because querying with a different model is exactly the failure the
    sidecar exists to prevent -- and a snippet that left the model
    implicit would invite it, since every library has a default that is
    not this one.
    """
    if store == "chroma":
        body = f'''"""Query this index.

Built by The Hallucinated Lab. The embedding model is not a detail:
searching with a different one returns nonsense rather than an error.
"""
import chromadb
from sentence_transformers import SentenceTransformer

MODEL_ID = "{model_id}"          # {dimensions} dimensions, do not substitute
model = SentenceTransformer(MODEL_ID)

client = chromadb.PersistentClient(path=".")
collection = client.get_collection("{collection}")

query = model.encode(["your question here"], normalize_embeddings=True)
hits = collection.query(query_embeddings=query.tolist(), n_results=5)

for document, distance in zip(hits["documents"][0], hits["distances"][0]):
    print(round(distance, 4), document[:120])
'''
    else:
        body = f'''"""Query this index.

Built by The Hallucinated Lab. The embedding model is not a detail:
searching with a different one returns nonsense rather than an error.
"""
import json

import numpy as np
from sentence_transformers import SentenceTransformer

MODEL_ID = "{model_id}"          # {dimensions} dimensions, do not substitute
model = SentenceTransformer(MODEL_ID)

vectors = np.load("{VECTORS}")
chunks = [json.loads(line) for line in open("{CHUNKS}", encoding="utf-8")]

query = model.encode(["your question here"], normalize_embeddings=True)[0]
scores = vectors @ query                     # normalised, so this is cosine

for position in np.argsort(-scores)[:5]:
    print(round(float(scores[position]), 4), chunks[position]["text"][:120])
'''
    return body


def _looks_normalised(vectors: Any, numpy: Any) -> bool:
    """Whether every row is unit length.

    Inferred rather than asked for: this tool is handed an .npy and has
    no way to know how it was made, and recording a guess would be worse
    than recording what the data actually shows.
    """
    if vectors.shape[0] == 0:
        return False
    norms = numpy.linalg.norm(vectors, axis=1)
    return bool(numpy.all(numpy.abs(norms - 1.0) < _UNIT_TOLERANCE))


def index(
    vectors: Source,
    chunks: Source,
    dest: str | os.PathLike[str] | None = None,
    *,
    store: str | None = None,
    collection: str | None = None,
    overwrite: bool | None = None,
    model: str | None = None,
) -> IndexResult:
    """Write ``vectors`` and ``chunks`` into a queryable directory.

    Args:
        vectors: Path to the .npy that ``embed`` produced.
        chunks: Path to the JSONL those vectors came from.
        dest: Directory to build. Defaults to a sibling of ``vectors``.
        store: ``"chroma"`` (default) or ``"numpy"``.
        collection: Name inside the store. Default "thl".
        overwrite: Replace an existing index of the same name.
        model: Which model produced the vectors, used to check the width
            is what that model emits. Defaults to the manifest default.

    Returns:
        An :class:`IndexResult`.

    Raises:
        InvalidArgument: an argument is outside what the manifest allows;
            the vector count does not match the chunk count; the vector
            width does not match the named model; or the destination
            exists and ``overwrite`` was not set.
        DependencyMissing: the chosen store is not installed.

    Note:
        ``model`` is a Python-level argument, not a manifest param -- the
        index entry declares only store, collection and overwrite. The
        registry rejects and omits anything it does not declare, so
        passing model through ``validate`` would raise on every call.
    """
    args = registry.validate("index", store=store, collection=collection, overwrite=overwrite)

    chosen = model or default_model()
    try:
        spec = _model_spec(chosen)
    except KeyError as err:
        raise InvalidArgument(f"Unknown model {chosen!r}.") from err
    model_id = str(spec["id"])
    expected = int(spec["dimensions"])

    numpy = require("numpy", extra="index", purpose="reading vectors")
    vectors_path = Path(os.fspath(vectors))
    if not vectors_path.is_file():
        raise InvalidArgument(f"No such vector file: {vectors_path}")
    array = numpy.load(vectors_path)
    records = read_chunks(chunks)

    # Everything that can refuse this call happens before a single
    # directory is created. A half-built index left behind by a failed
    # run would be reported as pre-existing by the next one, which turns
    # one clear error into two confusing ones.
    if array.ndim != 2:
        raise InvalidArgument(f"Expected a 2-D array of vectors; got shape {array.shape}.")

    if array.shape[0] != len(records):
        raise InvalidArgument(
            f"{array.shape[0]} vector(s) but {len(records)} chunk(s). They must correspond "
            "one to one, or every search result would cite the wrong text."
        )

    if int(array.shape[1]) != expected:
        raise InvalidArgument(
            f"These vectors are {int(array.shape[1])} wide, but {chosen} ({model_id}) "
            f"produces {expected}. Either the wrong .npy or the wrong model was named."
        )

    target = Path(os.fspath(dest)) if dest is not None else vectors_path.with_suffix("")
    if target.exists() and any(target.iterdir()):
        if not args["overwrite"]:
            raise InvalidArgument(
                f"{target} already holds an index. Pass overwrite=True to replace it. "
                "Adding vectors from a different model to an existing index does not "
                "fail, it just makes half of it unsearchable."
            )
        shutil.rmtree(target)
    target.mkdir(parents=True, exist_ok=True)

    normalised = _looks_normalised(array, numpy)
    snippet = query_snippet(args["store"], args["collection"], model_id, expected)

    if args["store"] == "numpy":
        numpy.save(target / VECTORS, array)
    else:
        chromadb = require("chromadb", extra="index", purpose="building a Chroma collection")
        client = chromadb.PersistentClient(path=str(target))
        collection_handle = client.get_or_create_collection(name=args["collection"])
        collection_handle.add(
            ids=[
                f"{r.get('source') or 'chunk'}:{r.get('chunk_index', i)}#{i}"
                for i, r in enumerate(records)
            ],
            embeddings=array.tolist(),
            documents=[str(r["text"]) for r in records],
            metadatas=[
                # Chroma accepts only scalars, so heading_path (a list)
                # is flattened rather than dropped -- it is what makes a
                # hit citable.
                {
                    "source": str(r.get("source", "")),
                    "page": int(r["page"]) if isinstance(r.get("page"), int) else -1,
                    "heading_path": " > ".join(r.get("heading_path") or []),
                    "chunk_index": int(r.get("chunk_index", i)),
                }
                for i, r in enumerate(records)
            ],
        )

    # The chunks travel with the vectors in both stores. A vector without
    # its text is a row number, not a search result.
    (target / CHUNKS).write_text(
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in records),
        encoding="utf-8",
        newline="",
    )

    sidecar_path = target / SIDECAR
    sidecar_path.write_text(
        json.dumps(
            {
                "model": chosen,
                "model_id": model_id,
                "dimensions": expected,
                "normalized": normalised,
                "count": int(array.shape[0]),
                "store": args["store"],
                "collection": args["collection"],
                "created": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
        newline="",
    )
    (target / SNIPPET).write_text(snippet, encoding="utf-8", newline="")

    return IndexResult(
        store=args["store"],
        collection=args["collection"],
        path=target,
        sidecar=sidecar_path,
        count=int(array.shape[0]),
        dimensions=expected,
        model=chosen,
        model_id=model_id,
        snippet=snippet,
        warnings=[]
        if normalised
        else [
            "These vectors are not unit length, so dot product is not cosine similarity. "
            "Recorded as normalized: false -- whatever queries this index must match."
        ],
    )


registry.register("index", index)
