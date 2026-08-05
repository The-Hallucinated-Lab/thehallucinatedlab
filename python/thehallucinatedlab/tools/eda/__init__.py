"""``thl eda`` -- profile a data file without writing any code.

Point it at a file, get back a report you can read, the figures behind
it, a recipe that replays every choice, and the Python script that
produced all of it. Nothing uploads; nothing leaves the machine.

    >>> from thehallucinatedlab import eda
    >>> result = eda("sales.csv")
    >>> result.report
    PosixPath('sales.eda/report.md')

The primitives underneath are ordinary functions and are meant to be
used directly when the report is not what you wanted:

    >>> from thehallucinatedlab import describe_dataset, plot_column
    >>> description = describe_dataset("sales.csv")
    >>> description.types()["revenue"]
    'numeric_continuous'

Everything here needs the optional extra::

    pip install "thehallucinatedlab[eda]"

Without it, the first call raises ``DependencyMissing`` naming that line.
Imports stay cheap either way: pandas is not touched until something is
actually asked for.
"""

from __future__ import annotations

import importlib

from .errors import (
    ColumnNotFound,
    DependencyMissing,
    EmptyDataset,
    InvalidRecipe,
    OutputNotWritable,
    SamplingRequired,
    THLError,
    UnreadableSource,
    UnsupportedColumnType,
)
from .types import (
    COLUMN_TYPES,
    ColumnDescription,
    ColumnProfile,
    DatasetDescription,
    EDAResult,
    PlotResult,
    RelationResult,
    ReportResult,
    SamplingInfo,
    TypeVerdict,
)

__version__ = "0.2.0"

#: Recipe schema version. Bumped only when an old recipe would replay
#: differently, which is the only thing the number is for.
RECIPE_VERSION = "1.0"


#: Public names that live in ``tools`` and are loaded on first use.
_LAZY = frozenset(
    {
        "eda",
        "describe_dataset",
        "profile_column",
        "plot_column",
        "relate_columns",
        "eda_report",
        "TOOLS",
    }
)

#: Submodules reachable as attributes. Listed rather than guessed so a
#: typo raises ``AttributeError`` instead of importing something odd.
_SUBMODULES = frozenset(
    {
        "charts", "cli", "deps", "errors", "figures", "inference", "keys",
        "loading", "portable", "readers", "recipe", "registry", "relate",
        "report", "runner", "script", "session", "summaries", "tools", "types",
    }
)


def __getattr__(name: str):
    """Load the heavy half of the package on first use.

    ``from thehallucinatedlab import eda`` must not cost a pandas import for someone
    who only wanted to catch ``DependencyMissing``. PEP 562 keeps the public
    names where the documentation says they are while deferring the cost
    to the first call -- the same trick ``nexuslink`` uses next door.

    The import goes through ``importlib`` rather than ``from . import x``.
    The statement form asks the package for the attribute first, which
    lands back in this function: ``thehallucinatedlab.tools.eda.session`` recursed until the
    stack ran out, and the traceback said nothing about why.
    """
    if name in _LAZY:
        module = importlib.import_module(".tools", __name__)
        value = getattr(module, name)
    elif name in _SUBMODULES:
        value = importlib.import_module("." + name, __name__)
    else:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    globals()[name] = value
    return value


def __dir__() -> list[str]:
    return sorted(set(globals()) | _LAZY | _SUBMODULES)


__all__ = [
    # the orchestrator
    "eda",
    # the primitives
    "describe_dataset",
    "profile_column",
    "plot_column",
    "relate_columns",
    "eda_report",
    # results
    "EDAResult",
    "ReportResult",
    "DatasetDescription",
    "ColumnDescription",
    "ColumnProfile",
    "PlotResult",
    "RelationResult",
    "SamplingInfo",
    "TypeVerdict",
    "COLUMN_TYPES",
    # errors
    "THLError",
    "DependencyMissing",
    "UnreadableSource",
    "EmptyDataset",
    "ColumnNotFound",
    "UnsupportedColumnType",
    "InvalidRecipe",
    "OutputNotWritable",
    "SamplingRequired",
    "__version__",
    "RECIPE_VERSION",
]
