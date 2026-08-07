"""Pipelines: the tools, run in the order that gets you somewhere.

A tool does one thing and hands back a result. A pipeline is the chain
people actually want -- "turn this document into something I can search"
-- expressed as the tools it is made of rather than as a second
implementation of them.

That distinction is the whole point, and it is worth stating plainly:

**A pipeline owns no logic.** ``rag`` calls :func:`~thehallucinatedlab.extract`,
:func:`~thehallucinatedlab.chunk`, :func:`~thehallucinatedlab.embed` and
:func:`~thehallucinatedlab.index` in order. If chunking is wrong, it is
wrong in one place and both the tool and the pipeline are fixed at once.
The moment a pipeline starts doing its own parsing it has become a
fourteenth tool wearing a hat, and the two drift.

**Every stage writes its artefact.** The intermediate files are not
debris to be cleaned up; they are the output. Someone who wants to see
what the chunker did opens ``chunks.jsonl``. Someone who wants to
re-embed with a different model already has the chunks and skips
straight there. A pipeline that only surfaces its final answer forces a
re-run to learn anything about the middle.

**A pipeline is resumable because of that.** Nothing here caches or
guesses; it simply does not delete what it made.
"""

from __future__ import annotations

from .rag import RagResult, StageReport, rag

__all__ = ["rag", "RagResult", "StageReport"]
