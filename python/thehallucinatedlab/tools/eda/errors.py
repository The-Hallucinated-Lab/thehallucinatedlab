"""Exception hierarchy for the EDA tools.

Everything here descends from ``THLError`` so a caller can still catch
the whole toolkit with one ``except``, and each subclass exists so nobody
has to parse a message string to tell a missing column from an
unreadable file.

There is deliberately no ``DependencyMissing``. The package has one way of
saying a dependency is absent -- ``DependencyMissing``, raised through
``thehallucinatedlab.deps`` and carrying the extra that provides it --
and a second class meaning the same thing would split every caller's
``except`` in two. It is re-exported here so this module is still the one
place to look for what these tools raise.

This module imports nothing heavy on purpose: the errors have to be
reachable on a machine where the extra was never installed, which is
exactly the machine that needs to raise one.
"""

from __future__ import annotations

from ...errors import DependencyMissing, THLError


class UnreadableSource(THLError):
    """The path does not exist, is not a file we handle, or will not parse."""


class EmptyDataset(THLError):
    """The source parsed, but there are no rows or no columns to profile."""


class ColumnNotFound(THLError):
    """A named column is not in the dataset."""


class UnsupportedColumnType(THLError):
    """A chart or summary was asked for on a type it does not apply to."""


class InvalidRecipe(THLError):
    """A recipe is malformed, or describes something this version cannot run."""


class OutputNotWritable(THLError):
    """The output directory cannot be created or written to."""


class SamplingRequired(THLError):
    """The source is large enough to need sampling and sampling was refused."""


__all__ = [
    "THLError",
    "DependencyMissing",
    "UnreadableSource",
    "EmptyDataset",
    "ColumnNotFound",
    "UnsupportedColumnType",
    "InvalidRecipe",
    "OutputNotWritable",
    "SamplingRequired",
]
