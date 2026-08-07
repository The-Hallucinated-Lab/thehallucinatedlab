"""Optional dependencies, imported at the moment they are needed.

``import thehallucinatedlab`` must stay cheap. Someone who installed this
to convert an image should not pay for torch, and on a cold cache torch
is a multi-second import before it is a multi-gigabyte download. So the
document, chunking, embedding and indexing tools import nothing at module
scope: they call :func:`require` inside the function that needs it.

This generalises the door ``nexuslink.py`` already opens onto its own
binding. The difference is that these dependencies *are* on PyPI, so the
error can name the exact extra rather than pointing at a repository:

    >>> from thehallucinatedlab.deps import require
    >>> require("torch", extra="embed")          # doctest: +SKIP
    DependencyMissing: embed needs torch, which is not installed.
        pip install "thehallucinatedlab[embed]"

Checking availability without triggering the error is :func:`have`, which
is what the CLI uses to print a capability table and what ``thl serve``
uses to answer /capabilities honestly.
"""

from __future__ import annotations

import importlib
from typing import Any

from .errors import DependencyMissing

# Extra -> what installing it actually gets you. Kept here rather than in
# pyproject.toml because the error message needs it at runtime, and a
# wheel cannot read its own project metadata reliably.
EXTRAS: dict[str, str] = {
    "extract": "document loaders for PDF, DOCX, PPTX, XLSX, EPUB and friends",
    "chunk": "structure-aware splitters and the BGE-M3 tokenizer",
    "embed": "BGE-M3 through sentence-transformers (pulls in torch)",
    "index": "the Chroma vector store",
    "rag": "everything above, the whole pipeline",
    "eda": "pandas, matplotlib and scipy, for profiling tabular data",
}

_cache: dict[str, Any] = {}


def _install_line(extra: str) -> str:
    # Quoted because zsh treats bare square brackets as a glob and would
    # otherwise report "no matches found".
    return f'pip install "thehallucinatedlab[{extra}]"'


def require(module: str, *, extra: str, purpose: str | None = None) -> Any:
    """Import ``module``, or explain which extra provides it.

    Args:
        module: The importable name, e.g. ``"pypdf"``.
        extra: The extra that installs it, e.g. ``"extract"``.
        purpose: Optional phrase naming what needed it, used to make the
            message specific when one extra covers several modules.

    Returns:
        The imported module.

    Raises:
        DependencyMissing: ``module`` is not importable.
    """
    if module in _cache:
        return _cache[module]
    try:
        loaded = importlib.import_module(module)
    except ImportError as err:
        need = purpose or extra
        raise DependencyMissing(
            f"{need} needs {module}, which is not installed. {_install_line(extra)}",
            extra=extra,
        ) from err
    _cache[module] = loaded
    return loaded


def have(module: str) -> bool:
    """True when ``module`` can be imported.

    Branch on this when a dependency is genuinely optional to the caller.
    Do not use it to pre-check before ``require`` -- that imports twice
    and turns one clear error into two code paths.
    """
    try:
        require(module, extra="rag")
    except DependencyMissing:
        return False
    return True


def missing(modules: dict[str, str]) -> dict[str, str]:
    """Which of ``{module: extra}`` are not installed.

    Used to report capability in one pass, rather than discovering the
    second missing package only after installing the first.
    """
    return {name: extra for name, extra in modules.items() if not have(name)}
