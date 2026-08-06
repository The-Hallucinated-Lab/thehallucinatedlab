"""The door onto the ``[eda]`` extra.

Four packages three orders of magnitude larger than the base install, so
they live behind an extra. This module does not open the door itself: the
package already has one, in ``thehallucinatedlab.deps``, and a second
would mean two ways to phrase the same failure and two extras registries
to keep in step.

What this adds on top is the part specific to EDA -- that four modules
are needed rather than one, and that matplotlib has to pick a backend
before pyplot is first imported.

    >>> from thehallucinatedlab.tools.eda.deps import available
    >>> available()
    True
"""

from __future__ import annotations

import importlib
from typing import Any

from ... import deps as house

#: The extra these tools need, as registered in ``deps.EXTRAS``.
EXTRA = "eda"

#: Import name -> what it is needed for, quoted back at the user when it
#: is the one that is missing. Ordered cheapest-to-import first, so the
#: common case -- nothing installed at all -- fails on the first line.
_REQUIRED = {
    "numpy": "numeric statistics",
    "pandas": "reading and describing tabular data",
    "matplotlib": "drawing figures",
    "scipy": "correlation and distribution statistics",
}


def available() -> bool:
    """True when every dependency the EDA tools need can be imported.

    Branch on this when EDA is an optional part of your own program.
    Catching the exception works too, but this reads better in an ``if``
    and is what ``thl tools`` uses to say whether the extra is present.
    """
    return all(house.have(module) for module in _REQUIRED)


def require() -> None:
    """Raise ``DependencyMissing`` unless the whole extra is present.

    Called at the top of every public entry point rather than at import
    time, so ``from thehallucinatedlab import eda`` stays cheap and the
    error names the *first* thing that is actually missing.
    """
    for module, purpose in _REQUIRED.items():
        house.require(module, extra=EXTRA, purpose=f"exploratory data analysis ({purpose})")


def versions() -> dict[str, str]:
    """Installed version of each dependency.

    Printed in the report header and in the generated script's pin
    comment. A missing entry is reported as ``unknown`` rather than
    omitted, so a report never implies a dependency was absent when it
    was merely unversioned.
    """
    require()
    out: dict[str, str] = {}
    for name in _REQUIRED:
        module: Any = importlib.import_module(name)
        out[name] = str(getattr(module, "__version__", "unknown"))
    return out


def use_headless_backend() -> None:
    """Select matplotlib's Agg backend before pyplot is first imported.

    Without this, importing pyplot on a machine with a display picks an
    interactive backend, which on some builds pulls in Tk -- a dependency
    this package does not have and whose absence is a stated invariant.
    Calling it after pyplot is already imported is a no-op by design, so
    it is safe from every entry point.
    """
    require()
    matplotlib = importlib.import_module("matplotlib")
    matplotlib.use("Agg", force=False)
