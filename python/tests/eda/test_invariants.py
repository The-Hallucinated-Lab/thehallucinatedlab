"""The standing constraints. A red build here means one was broken.

These are the rules that do not change when a feature does, in the spirit
of the parent repository's STANDARDS.md. Most of them are about things
that rot quietly: a Tk import that only fails on a headless box, a
dependency that only shows up in someone else's install, an error class
that stops descending from ``THLError`` and escapes every caller's
``except``.
"""

from __future__ import annotations

import ast
import subprocess
import sys
from pathlib import Path

import pytest

import thehallucinatedlab.tools.eda
from thehallucinatedlab.tools.eda import errors as errors_mod

PACKAGE = Path(thehallucinatedlab.tools.eda.__file__).parent
SOURCES = sorted(PACKAGE.glob("*.py"))

#: Everything the package is allowed to import from outside the standard
#: library. Adding to this list is a dependency decision, not a detail.
ALLOWED_THIRD_PARTY = {"pandas", "numpy", "matplotlib", "scipy"}

#: Never. A native file picker fails over SSH, in Docker, in CI and inside
#: a notebook, and the parent package is classified OS Independent, which
#: a Tk dependency would make untrue.
FORBIDDEN = {"tkinter", "Tkinter", "tk", "PyQt5", "PyQt6", "PySide6", "wx", "seaborn"}


def imports_of(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    found: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            # level 0 is an absolute import. Relative ones are this
            # package talking to itself and are not a dependency.
            found.add(node.module.split(".")[0])
    return found


@pytest.mark.parametrize("path", SOURCES, ids=lambda p: p.name)
def test_no_gui_toolkit_is_imported_anywhere(path: Path) -> None:
    """Definition of done, item 8. No Tk import anywhere."""
    assert not (imports_of(path) & FORBIDDEN), f"{path.name} imports a GUI toolkit"


@pytest.mark.parametrize("path", SOURCES, ids=lambda p: p.name)
def test_no_unexpected_third_party_dependency(path: Path) -> None:
    stdlib = set(sys.stdlib_module_names)
    # imports_of() reports top-level names only, so the package this
    # subtree now lives inside is the one to exempt.
    outside = imports_of(path) - stdlib - ALLOWED_THIRD_PARTY - {"thehallucinatedlab"}
    assert not outside, f"{path.name} imports {sorted(outside)}"


@pytest.mark.parametrize("path", SOURCES, ids=lambda p: p.name)
def test_no_seaborn(path: Path) -> None:
    """Matplotlib directly, so the generated script stays installable
    from the same four packages the extra names.

    Checked as an import rather than as text: the modules explain in prose
    why seaborn is absent, and a grep would fail on the explanation.
    """
    assert "seaborn" not in imports_of(path)


def test_importing_the_package_costs_no_pandas() -> None:
    """``from thehallucinatedlab.tools.eda import eda`` must not pay for pandas.

    Someone who only wanted to catch ``DependencyMissing`` should not wait
    for numpy to load, and the parent package's base install must stay
    exactly as cheap as it was.
    """
    code = (
        "import sys; import thehallucinatedlab.tools.eda; "
        "assert 'pandas' not in sys.modules, sorted(m for m in sys.modules "
        "if m in ('pandas', 'numpy', 'matplotlib', 'scipy'))"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True, text=True, cwd=str(PACKAGE.parents[2]),
    )
    assert result.returncode == 0, result.stderr


def test_the_error_classes_the_prd_names_all_exist() -> None:
    for name in (
        "DependencyMissing", "UnreadableSource", "EmptyDataset", "ColumnNotFound",
        "UnsupportedColumnType", "InvalidRecipe", "OutputNotWritable", "SamplingRequired",
    ):
        assert hasattr(errors_mod, name), f"{name} is missing"
        assert issubclass(getattr(errors_mod, name), errors_mod.THLError)


def test_every_public_error_is_catchable_as_one_thing() -> None:
    """A caller should be able to catch the whole toolkit with one except."""
    for name in errors_mod.__all__:
        cls = getattr(errors_mod, name)
        assert issubclass(cls, Exception)
        if name != "THLError":
            assert issubclass(cls, errors_mod.THLError)


def test_the_dependency_door_is_the_package_s_own() -> None:
    """One door, one error, one extras registry.

    A second way to say "that dependency is missing" would split every
    caller's except in two and leave two lists of extras to keep in step.
    """
    from thehallucinatedlab import deps as house
    from thehallucinatedlab.tools.eda import deps

    assert deps.EXTRA in house.EXTRAS, "the eda extra is not registered in deps.EXTRAS"
    assert deps.available() is house.have("pandas")


def test_a_missing_dependency_names_the_extra_that_provides_it(monkeypatch) -> None:
    """The error has to be actionable on the machine that raises it."""
    from thehallucinatedlab import deps as house
    from thehallucinatedlab.errors import DependencyMissing
    from thehallucinatedlab.tools.eda import deps

    def absent(module, *, extra, purpose=None):
        raise DependencyMissing(
            f"{purpose or extra} needs {module}, which is not installed. "
            f'pip install "thehallucinatedlab[{extra}]"',
            extra=extra,
        )

    monkeypatch.setattr(house, "require", absent)
    with pytest.raises(DependencyMissing) as caught:
        deps.require()

    assert caught.value.extra == "eda"
    assert 'pip install "thehallucinatedlab[eda]"' in str(caught.value)
    # numpy is first in the table, so it is what the message names.
    assert "numpy" in str(caught.value)


def test_the_public_surface_matches_what_is_documented() -> None:
    for name in thehallucinatedlab.tools.eda.__all__:
        assert hasattr(thehallucinatedlab.tools.eda, name), (
            f"__all__ promises {name}, which does not exist"
        )


def test_the_lazy_names_resolve() -> None:
    for name in ("eda", "describe_dataset", "profile_column", "plot_column",
                 "relate_columns", "eda_report"):
        assert callable(getattr(thehallucinatedlab.tools.eda, name))


def test_matplotlib_uses_a_headless_backend() -> None:
    """Definition of done, item 8: the suite passes headless."""
    import matplotlib

    from thehallucinatedlab.tools.eda import deps

    deps.use_headless_backend()
    assert matplotlib.get_backend().lower() == "agg"


@pytest.mark.parametrize("path", SOURCES, ids=lambda p: p.name)
def test_every_module_has_a_docstring_explaining_why(path: Path) -> None:
    """The parent's rule: explain why, not what. A module with no
    docstring is one nobody has to justify."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    doc = ast.get_docstring(tree)
    assert doc and len(doc) > 80, f"{path.name} has no module docstring worth reading"


@pytest.mark.parametrize("path", SOURCES, ids=lambda p: p.name)
def test_no_bare_except_and_no_silent_pass(path: Path) -> None:
    """Never an empty catch. If something is absorbed deliberately, the
    block says what and why -- which also satisfies the linter."""
    tree = ast.parse(source := path.read_text(encoding="utf-8"))
    lines = source.splitlines()
    for node in ast.walk(tree):
        if not isinstance(node, ast.ExceptHandler):
            continue
        assert node.type is not None, f"{path.name}:{node.lineno} bare except"
        if len(node.body) == 1 and isinstance(node.body[0], ast.Pass):
            window = "\n".join(lines[max(0, node.lineno - 4) : node.body[0].lineno])
            assert "#" in window, (
                f"{path.name}:{node.lineno} swallows an exception with no explanation"
            )


def test_no_dataclass_field_is_shadowed_by_a_method() -> None:
    """A method and a field of the same name silently break the field.

    ``Recipe.load`` was both a read-options dict and a classmethod. The
    class body defined the method after the field, so ``@dataclass`` read
    the method as the field's default and ``Recipe()`` came back with a
    bound method where a dict belonged. Nine hundred tests passed anyway,
    because every construction path happened to pass ``load=``. This is
    the cheap general check for that shape.
    """
    import dataclasses
    import importlib
    import inspect

    for path in SOURCES:
        # `import thehallucinatedlab.tools.eda.__init__` builds a second, half-wired copy of the
        # package rather than reusing the real one. The package itself is
        # already imported at the top of this file.
        module = (
            thehallucinatedlab.tools.eda
            if path.stem == "__init__"
            else importlib.import_module(f"thehallucinatedlab.tools.eda.{path.stem}")
        )
        for _, cls in inspect.getmembers(module, inspect.isclass):
            if not dataclasses.is_dataclass(cls) or cls.__module__ != module.__name__:
                continue
            for field in dataclasses.fields(cls):
                default = field.default
                assert not callable(default) or isinstance(default, type), (
                    f"{cls.__name__}.{field.name} defaults to a callable -- a method "
                    "of the same name almost certainly overwrote the field."
                )


# -- the tool spec ----------------------------------------------------------
#
# These read the real manifest rather than a standalone fragment. Before
# this subtree moved into thehallucinatedlab the entries lived in their
# own file waiting to be merged; they are merged now, and a test still
# checking the fragment would be checking a file nobody ships.


def _spec() -> dict:
    """Only the EDA entries, from the manifest every consumer reads."""
    from thehallucinatedlab import registry

    names = ["describe_dataset", "profile_column", "plot_column",
             "relate_columns", "eda_report"]
    return {"tools": [registry.describe(name) for name in names]}


def test_the_spec_entries_are_in_the_manifest_shape() -> None:
    data = _spec()
    assert data["tools"], "no EDA tools are declared in spec/manifest.json"
    for tool in data["tools"]:
        assert {"name", "title", "summary", "runtimes", "params"} <= set(tool)
        assert tool["runtimes"] == ["python"], (
            f"{tool['name']} claims a browser runtime; profiling a 200 MB CSV on a "
            "canvas is not something the website should offer"
        )


def test_the_spec_declares_exactly_the_five_primitives() -> None:
    """The orchestrator is deliberately absent -- it is an application over
    the tools, not a tool, and registering it would make the docs generator
    describe an interactive session as a single-shot transform."""
    import thehallucinatedlab.tools.eda

    declared = [tool["name"] for tool in _spec()["tools"]]
    assert sorted(declared) == sorted(thehallucinatedlab.tools.eda.TOOLS)
    assert "eda" not in declared


def test_the_spec_and_the_signatures_cannot_disagree() -> None:
    """The house rule: bounds live in the manifest and nowhere else. A
    parameter the spec documents and the function rejects is the website
    describing an argument the package does not accept."""
    import inspect

    from thehallucinatedlab.tools.eda import tools as tools_module

    problems: list[str] = []
    for tool in _spec()["tools"]:
        fn = getattr(tools_module, tool["name"], None)
        if fn is None:
            problems.append(f"{tool['name']} is declared but not implemented")
            continue
        accepted = set(inspect.signature(fn).parameters)
        problems += [
            f"{tool['name']} declares {param['name']!r}, which the function does not accept"
            for param in tool["params"]
            if param["name"] not in accepted
        ]
    assert not problems, "; ".join(problems)


def test_every_spec_enum_matches_the_registry() -> None:
    """A chart named in the spec but absent from the registry would be a
    documented argument that always errors."""
    from thehallucinatedlab.tools.eda import registry
    from thehallucinatedlab.tools.eda.types import COLUMN_TYPES

    known = {"chart": set(registry.chart_names()), "kind": set(registry.relation_names()),
             "type_override": set(COLUMN_TYPES), "format": {"md", "html"},
             "figure_format": {"png", "svg"}, "outlier_rule": set(registry.OUTLIER_RULES)}
    for tool in _spec()["tools"]:
        for param in tool["params"]:
            if param.get("type") != "enum" or param["name"] not in known:
                continue
            declared = set(param["values"])
            expected = known[param["name"]]
            assert declared == expected, (
                f"{tool['name']}.{param['name']}: spec has {sorted(declared - expected)} "
                f"extra and {sorted(expected - declared)} missing"
            )


def test_no_nul_bytes_in_source() -> None:
    for path in SOURCES:
        assert b"\x00" not in path.read_bytes(), f"{path.name} contains a NUL byte"


def test_every_source_file_is_valid_python() -> None:
    for path in SOURCES:
        ast.parse(path.read_text(encoding="utf-8"))
