"""The NexusLink door.

The binding is not on PyPI yet, so in CI it is always absent. These
tests pin the behaviour that matters either way: importing the toolkit
must not require it, and asking for it must fail with something a person
can act on.
"""

from __future__ import annotations

import sys
import types

import pytest

from thehallucinatedlab import NexusLinkNotInstalled, nexuslink


def test_importing_the_toolkit_does_not_require_nexuslink():
    """Lazy by design -- most people only wanted to convert an image."""
    assert "nexuslink" not in sys.modules or nexuslink.is_available()


@pytest.mark.skipif(nexuslink.is_available(), reason="the real binding is installed")
def test_the_missing_binding_error_points_somewhere_useful():
    with pytest.raises(NexusLinkNotInstalled) as err:
        nexuslink.connect  # noqa: B018
    message = str(err.value)
    assert "NexusLinkEngine" in message
    assert "separately" in message


@pytest.mark.skipif(nexuslink.is_available(), reason="the real binding is installed")
def test_is_available_is_false_without_it():
    assert nexuslink.is_available() is False


@pytest.mark.skipif(nexuslink.is_available(), reason="the real binding is installed")
def test_dunder_lookups_do_not_trigger_a_load():
    """copy, pickle and inspect probe for dunders; none should explode."""
    with pytest.raises(AttributeError):
        nexuslink.__wrapped__  # noqa: B018


def test_attributes_forward_to_the_binding_once_it_exists(monkeypatch):
    """Simulates the day NexusLink ships: this module needs no change."""
    stub = types.ModuleType("nexuslink")
    stub.connect = lambda peer: f"connected to {peer}"  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "nexuslink", stub)
    monkeypatch.setattr(nexuslink, "_binding", None)

    assert nexuslink.is_available() is True
    assert nexuslink.connect("peer-1") == "connected to peer-1"
    assert "connect" in dir(nexuslink)

    monkeypatch.setattr(nexuslink, "_binding", None)
