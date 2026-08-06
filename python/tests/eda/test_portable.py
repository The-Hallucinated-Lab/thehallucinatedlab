"""The portability promise, checked rather than assumed.

``analysis.py`` reproduces the report because it contains the same code
that produced it. That only holds while every portable function really is
self-contained -- one import from this package, or one reference to a
module-level constant, and the generated file stops running the moment it
leaves this directory.

So the promise is enforced here: every portable function's AST is walked
and every free name it uses must come from the generated script's
preamble, the builtins, or another portable function.
"""

from __future__ import annotations

import ast
import builtins

import pytest

from thehallucinatedlab.tools.eda import (
    charts,
    inference,
    portable,
    readers,
    registry,
    relate,
    summaries,
)

# Importing the modules is what registers their functions.
_MODULES = (summaries, charts, relate, readers)

_BUILTINS = set(dir(builtins))


def _free_names(fn) -> set[str]:
    """Names a function body reads without binding first.

    Deliberately conservative: parameters, locals, comprehension targets
    and nested-function arguments are all treated as bound, so anything
    left really is resolved from module globals at call time.
    """
    tree = ast.parse(portable.source_of(fn))
    bound: set[str] = set()
    used: set[str] = set()

    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef | ast.Lambda):
            args = node.args
            for group in (args.posonlyargs, args.args, args.kwonlyargs):
                bound.update(arg.arg for arg in group)
            if args.vararg:
                bound.add(args.vararg.arg)
            if args.kwarg:
                bound.add(args.kwarg.arg)
            if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
                bound.add(node.name)
        elif isinstance(node, ast.Name):
            (bound if isinstance(node.ctx, ast.Store) else used).add(node.id)
        elif isinstance(node, ast.ExceptHandler) and node.name:
            bound.add(node.name)
        elif isinstance(node, ast.alias):
            bound.add((node.asname or node.name).split(".")[0])

    return used - bound


@pytest.mark.parametrize("name", sorted(portable.registry()))
def test_portable_functions_only_use_the_generated_preamble(name: str) -> None:
    fn = portable.registry()[name]
    allowed = portable.PREAMBLE_NAMES | _BUILTINS | set(portable.registry())
    leaked = _free_names(fn) - allowed
    assert not leaked, (
        f"{name} refers to {sorted(leaked)}, which the generated script will not define. "
        "Portable functions may use only the preamble, the builtins and other "
        "portable functions."
    )


@pytest.mark.parametrize("name", sorted(portable.registry()))
def test_portable_sources_carry_no_decorator(name: str) -> None:
    source = portable.source_of(portable.registry()[name])
    assert source.lstrip().startswith("def "), f"{name} still carries its decorator"
    assert "@portable" not in source


@pytest.mark.parametrize("name", sorted(portable.registry()))
def test_declared_helpers_are_the_ones_actually_called(name: str) -> None:
    """A missing helper is a NameError in the generated file, not here."""
    fn = portable.registry()[name]
    declared = set(getattr(fn, "__portable_helpers__", ()))
    called = _free_names(fn) & set(portable.registry())
    missing = called - declared - {name}
    assert not missing, f"{name} calls {sorted(missing)} without declaring them as helpers"


def test_collect_orders_dependencies_first() -> None:
    order = portable.collect(["summary_outliers"])
    assert order.index("as_numeric") < order.index("summary_outliers")


def test_collect_is_stable() -> None:
    """Two runs of the same recipe must produce byte-identical scripts."""
    names = ["chart_hbar", "summary_skew", "chart_histogram"]
    assert portable.collect(names) == portable.collect(names)


def test_every_registry_entry_names_a_portable_function() -> None:
    known = set(portable.registry())
    for spec in registry.CHARTS + registry.SUMMARIES:
        assert spec.fn in known, f"{spec.name} names {spec.fn}, which is not portable"


def test_the_boolean_vocabulary_is_duplicated_faithfully() -> None:
    """``as_boolean`` cannot import the real vocabulary, so it repeats it.

    A duplicate is the price of portability; a duplicate that drifts is a
    column read as boolean here and as text in the generated script.
    """
    source = portable.source_of(summaries.as_boolean)
    truthy = {word for word in inference.BOOLEAN_TRUE}
    for word in truthy:
        assert f'"{word}"' in source, f"as_boolean has lost {word!r}"

    every = set()
    for vocabulary in inference.BOOLEAN_VOCABULARY:
        every |= set(vocabulary)
    for word in every:
        assert f'"{word}"' in source, f"as_boolean has lost {word!r}"


def test_the_preamble_and_the_modules_import_the_same_names() -> None:
    """A portable function resolves against this module here and the
    preamble there. If the two disagree, one of the two crashes."""
    for module in _MODULES:
        available = set(vars(module))
        for name in portable.registry():
            fn = portable.registry()[name]
            if fn.__module__ != module.__name__:
                continue
            for free in _free_names(fn):
                if free in _BUILTINS or free in portable.registry():
                    continue
                assert free in available, (
                    f"{module.__name__}.{name} uses {free!r}, which the preamble defines "
                    "but this module does not import"
                )
