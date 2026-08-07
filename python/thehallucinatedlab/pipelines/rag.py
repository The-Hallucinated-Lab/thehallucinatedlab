"""The RAG pipeline: a document in, a searchable index out.

    extract  ->  chunk  ->  embed  ->  index

Each arrow is a file on disk, not a variable in memory, and each stage is
the same public function the ``thl tool`` namespace exposes. Running the
pipeline and running the four tools by hand produce identical artefacts;
this module only removes the typing.

Why the stages are separate files rather than one streamed pass:

- **Embedding is the expensive step.** It is also the one people redo,
  because the model choice is the thing they are experimenting with. With
  ``chunks.jsonl`` already written, a second model costs one ``thl tool
  embed`` and not a re-parse of the PDF.
- **The middle is where it goes wrong.** A bad answer from a RAG system
  is nearly always a bad chunk, and you cannot see a bad chunk in a
  vector store. You can read it in a JSONL file.
- **Dependencies arrive late.** ``embed`` needs torch. Someone with only
  the base install still gets a real result from the first two stages
  instead of an import error and nothing.
"""

from __future__ import annotations

import contextlib
import json
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..errors import THLError

#: The stages, in order. Kept as data because the CLI prints it, the
#: pipeline walks it, and a test asserts the two agree.
STAGES = ("extract", "chunk", "embed", "index")


@dataclass
class StageReport:
    """What one stage did, whether or not it finished."""

    name: str
    ok: bool
    seconds: float
    path: str | None = None
    detail: str = ""
    warnings: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "stage": self.name,
            "ok": self.ok,
            "seconds": round(self.seconds, 3),
            "path": self.path,
            "detail": self.detail,
            "warnings": list(self.warnings),
        }


@dataclass
class RagResult:
    """The whole run: where it put things, and how far it got.

    ``complete`` is False when a stage stopped the chain. The stages that
    did run still have their artefacts, and ``resume_from`` names the one
    to start at once the reason is fixed -- which for the usual cause, a
    missing extra, is a single pip install.
    """

    source: str
    directory: str
    stages: list[StageReport]
    complete: bool
    resume_from: str | None = None

    @property
    def warnings(self) -> list[str]:
        out: list[str] = []
        for stage in self.stages:
            out.extend(f"{stage.name}: {w}" for w in stage.warnings)
        return out

    def as_dict(self) -> dict[str, Any]:
        return {
            "pipeline": "rag",
            "source": self.source,
            "directory": self.directory,
            "complete": self.complete,
            "resume_from": self.resume_from,
            "stages": [s.as_dict() for s in self.stages],
        }


def _stem(source: str | os.PathLike[str]) -> str:
    name = Path(os.fspath(source)).name
    # A document called "report.final.pdf" should land in "report.final.rag",
    # not "report.rag" -- only the real extension comes off.
    return name.rsplit(".", 1)[0] if "." in name else name


def rag(
    source: str | os.PathLike[str],
    dest: str | os.PathLike[str] | None = None,
    *,
    max_tokens: int | None = None,
    overlap: int | None = None,
    tokenizer: str | None = None,
    model: str | None = None,
    store: str | None = None,
    collection: str | None = None,
    overwrite: bool | None = None,
) -> RagResult:
    """Run extract -> chunk -> embed -> index over one document.

    Args:
        source: The document. Anything :func:`~thehallucinatedlab.extract`
            reads -- PDF, DOCX, HTML, markdown and the rest.
        dest: Directory for the artefacts. Defaults to ``<stem>.rag/``
            beside the source, which mirrors how the EDA pipeline writes
            ``<stem>.eda/``.
        max_tokens: Chunk size ceiling, passed straight through.
        overlap: Chunk overlap, passed straight through.
        tokenizer: Which tokenizer counts. ``estimate`` needs no download.
        model: Embedding model.
        store: Vector store backend.
        collection: Collection name inside the store.
        overwrite: Replace an existing collection.

    Returns:
        A :class:`RagResult`. Check ``complete``; on a partial run the
        artefacts that were produced are still on disk and listed.

    Raises:
        THLError: Only for a failure that is not a stage failure -- an
            unreadable source, or a destination that cannot be created.
            A stage that fails is reported, not raised, so the caller
            keeps the artefacts from the stages that worked.
    """
    src = Path(os.fspath(source))
    if not src.exists():
        raise THLError(f"No such file: {src}")

    out_dir = Path(os.fspath(dest)) if dest is not None else src.parent / f"{_stem(src)}.rag"
    try:
        out_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise THLError(f"Cannot create {out_dir}: {exc}") from None

    # Imported here, not at module scope: embed and index pull optional
    # extras, and importing them eagerly would make `thl pipeline` refuse
    # to start for someone who only wanted the first two stages.
    from ..tools import chunk as chunk_tool
    from ..tools import extract as extract_tool

    stages: list[StageReport] = []

    def _record(name: str, started: float, *, ok: bool, path: Any = None,
                detail: str = "", warnings: Any = None) -> StageReport:
        report = StageReport(
            name=name,
            ok=ok,
            seconds=time.monotonic() - started,
            path=str(path) if path else None,
            detail=detail,
            warnings=list(warnings or []),
        )
        stages.append(report)
        return report

    def _stop(resume: str) -> RagResult:
        return RagResult(
            source=str(src),
            directory=str(out_dir),
            stages=stages,
            complete=False,
            resume_from=resume,
        )

    # -- extract ----------------------------------------------------
    started = time.monotonic()
    md_path = out_dir / "extracted.md"
    try:
        extracted = extract_tool(src, md_path)
    except Exception as exc:  # noqa: BLE001 - reported, not swallowed
        _record("extract", started, ok=False, detail=str(exc))
        return _stop("extract")
    _record(
        "extract", started, ok=True, path=extracted.path or md_path,
        detail=f"{extracted.format}, {extracted.headings} headings",
        warnings=extracted.warnings,
    )

    # -- chunk ------------------------------------------------------
    started = time.monotonic()
    chunks_path = out_dir / "chunks.jsonl"
    try:
        chunked = chunk_tool(
            extracted.text,
            chunks_path,
            max_tokens=max_tokens,
            overlap=overlap,
            tokenizer=tokenizer,
            filename=src.name,
        )
    except Exception as exc:  # noqa: BLE001
        _record("chunk", started, ok=False, detail=str(exc))
        return _stop("chunk")
    _record(
        "chunk", started, ok=True, path=chunked.path or chunks_path,
        detail=f"{len(chunked.chunks)} chunks, {chunked.tokenizer}"
               + ("" if chunked.exact else " (estimated)"),
        warnings=chunked.warnings,
    )

    # -- embed ------------------------------------------------------
    started = time.monotonic()
    vectors_path = out_dir / "vectors.npy"
    try:
        from ..tools import embed as embed_tool

        embedded = embed_tool(chunked.path or chunks_path, vectors_path, model=model)
    except Exception as exc:  # noqa: BLE001
        _record("embed", started, ok=False, detail=str(exc))
        return _stop("embed")
    _record(
        "embed", started, ok=True, path=embedded.path or vectors_path,
        detail=f"{embedded.count} vectors, {embedded.dimensions}d, {embedded.model}",
        warnings=embedded.warnings,
    )

    # -- index ------------------------------------------------------
    started = time.monotonic()
    index_path = out_dir / "index"
    try:
        from ..tools import index as index_tool

        indexed = index_tool(
            embedded.path or vectors_path,
            chunked.path or chunks_path,
            index_path,
            store=store,
            collection=collection or _stem(src),
            overwrite=overwrite,
            model=model,
        )
    except Exception as exc:  # noqa: BLE001
        _record("index", started, ok=False, detail=str(exc))
        return _stop("index")
    _record(
        "index", started, ok=True, path=indexed.path or index_path,
        detail=f"{indexed.count} in {indexed.store}:{indexed.collection}",
        warnings=indexed.warnings,
    )

    result = RagResult(
        source=str(src), directory=str(out_dir), stages=stages, complete=True
    )

    # A record of the run beside its outputs. Written last so its presence
    # means the pipeline finished, and written even though every number in
    # it was already printed -- the terminal scrollback is not an artefact.
    # The pipeline succeeded; failing to write its own receipt -- a
    # read-only directory, a full disk -- is not a reason to report
    # otherwise, so the write is allowed to fail silently.
    with contextlib.suppress(OSError):
        (out_dir / "pipeline.json").write_text(
            json.dumps(result.as_dict(), indent=2) + "\n", encoding="utf-8"
        )

    return result
