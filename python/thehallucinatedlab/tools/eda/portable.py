"""Functions that are run here *and* shipped into the generated script.

Every run emits an ``analysis.py`` that has to reproduce the report it
came from. There are three ways to get that guarantee and only one of
them is honest:

1. Make the script import this library and call back into it. Cheap, but
   it hands the user a wrapper, not their analysis -- and the whole
   reason the script exists is that it is meant to be edited.
2. Keep a code template beside every implementation and ``eval`` the
   template at runtime. Then there are two definitions to keep in step,
   and the day they drift the report and the script disagree silently.
3. Write the implementation once, as a self-contained function, and
   ship its own source into the script.

This module is option three. A function decorated with :func:`portable`
promises to use nothing but the preamble in :data:`PREAMBLE` and other
portable functions it names in ``helpers``. ``script.py`` reads the
source back with :func:`inspect.getsource`, so the code that produced
``summary.json`` and the code in ``analysis.py`` are the same characters
by construction, not by discipline.

The promise is checked, not assumed: ``tests/test_portable.py`` walks
every portable function's AST and fails on a free name that the preamble
does not define.
"""

from __future__ import annotations

import inspect
from collections.abc import Callable, Iterable
from typing import Any, TypeVar

F = TypeVar("F", bound=Callable[..., Any])

#: The import block the generated script opens with. Portable functions
#: may use these names and the Python builtins, and nothing else.
PREAMBLE: tuple[str, ...] = (
    "import json",
    "import math",
    "import re",
    "from collections import Counter",
    "from pathlib import Path",
    "",
    "import numpy as np",
    "import pandas as pd",
    "import matplotlib",
    "matplotlib.use(\"Agg\")",
    "import matplotlib.pyplot as plt",
    "from scipy import stats",
)

#: Names the preamble binds. Kept beside it so the checker cannot drift
#: from the block it is checking.
PREAMBLE_NAMES: frozenset[str] = frozenset(
    {"json", "math", "re", "Counter", "Path", "np", "pd", "matplotlib", "plt", "stats"}
)

_REGISTRY: dict[str, Callable[..., Any]] = {}


def portable(*, helpers: Iterable[str] = ()) -> Callable[[F], F]:
    """Mark a function as safe to embed in the generated script.

    Args:
        helpers: Names of other portable functions this one calls. They
            are emitted ahead of it, so order in the generated file is
            derived rather than maintained by hand.
    """

    def decorate(fn: F) -> F:
        fn.__portable__ = True  # type: ignore[attr-defined]
        fn.__portable_helpers__ = tuple(helpers)  # type: ignore[attr-defined]
        _REGISTRY[fn.__name__] = fn
        return fn

    return decorate


def is_portable(fn: Any) -> bool:
    return bool(getattr(fn, "__portable__", False))


def registry() -> dict[str, Callable[..., Any]]:
    """Every portable function, by name. Read-only view for tests and codegen."""
    return dict(_REGISTRY)


def source_of(fn: Callable[..., Any]) -> str:
    """The function's own source, with its decorator lines removed.

    The decorator is a fact about this library, not about the analysis,
    and leaving ``@portable(...)`` in the emitted file would make the
    script depend on the thing it is supposed to replace.
    """
    lines = inspect.getsource(fn).splitlines()
    start = 0
    depth = 0
    for index, line in enumerate(lines):
        stripped = line.strip()
        if depth == 0 and not stripped.startswith("@"):
            start = index
            break
        depth += line.count("(") - line.count(")")
    else:  # pragma: no cover - a decorator with no function under it cannot happen
        start = len(lines)
    return "\n".join(lines[start:]).rstrip() + "\n"


def _walk(name: str, seen: list[str], guard: frozenset[str] = frozenset()) -> None:
    if name in seen:
        return
    if name in guard:
        raise ValueError(f"Portable helpers form a cycle through {name!r}.")
    fn = _REGISTRY.get(name)
    if fn is None:
        raise KeyError(f"No portable function named {name!r}.")
    for helper in getattr(fn, "__portable_helpers__", ()):
        _walk(helper, seen, guard | {name})
    seen.append(name)


def collect(names: Iterable[str]) -> list[str]:
    """Resolve ``names`` and their helpers into emission order.

    Dependencies come first, each name appears once, and the order is
    stable for a given input so two runs of the same recipe produce
    byte-identical scripts.
    """
    ordered: list[str] = []
    for name in names:
        _walk(name, ordered)
    return ordered


def sources(names: Iterable[str]) -> str:
    """The source of ``names`` plus every helper, ready to paste into a file."""
    return "\n\n".join(source_of(_REGISTRY[name]) for name in collect(names))
