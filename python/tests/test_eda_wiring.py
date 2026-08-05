"""The seams between the toolkit and the EDA subpackage.

The EDA tools have their own suite under ``tests/eda``. This file covers
only the joins — the things that are nobody's responsibility inside
either half and break silently when one of them moves:

  - ``thl eda`` reaching the subcommand at all
  - ``from thehallucinatedlab import eda`` resolving
  - the errors descending from the parent's THLError rather than a copy
  - the base install staying exactly as cheap as it was

That last one is the reason the extra exists. If importing the package
starts costing a pandas import, the person who wanted to convert a PNG
pays for a scientific stack and nothing in either suite notices.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

from thehallucinatedlab import __version__, cli, errors, registry

PACKAGE_ROOT = Path(__file__).resolve().parent.parent

#: What the spec says needs the extra. Read from the manifest rather than
#: restated, so a sixth primitive is covered the day it is declared.
EDA_TOOLS = [
    name for name in registry.names() if registry.describe(name).get("extra") == "eda"
]


def run_python(code: str) -> subprocess.CompletedProcess:
    """Run a snippet in a clean interpreter rooted at the package.

    A subprocess rather than an import: this process has already loaded
    half the toolkit, and a name that resolves only because of that would
    make the check pass for the wrong reason.
    """
    return subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        cwd=str(PACKAGE_ROOT),
        timeout=120,
    )


# -- the command line -------------------------------------------------------


def test_thl_eda_is_a_subcommand() -> None:
    parser = cli._build_parser()
    args = parser.parse_args(["eda", "data.csv", "--tier2", "all"])
    assert args.command == "eda"
    assert args.source == "data.csv"
    assert args.tier2 == "all"


def test_thl_help_lists_eda() -> None:
    assert "eda" in cli._build_parser().format_help()


def test_building_the_parser_costs_no_pandas() -> None:
    """`thl --help` builds every subparser, including this one."""
    result = run_python(
        "import sys\n"
        "from thehallucinatedlab.cli import _build_parser\n"
        "_build_parser().format_help()\n"
        "heavy = [m for m in ('pandas', 'numpy', 'matplotlib', 'scipy') if m in sys.modules]\n"
        "assert not heavy, heavy\n"
    )
    assert result.returncode == 0, result.stderr


def test_the_cli_runs_a_file_end_to_end(tmp_path: Path) -> None:
    """Definition of done: zero flags produce a complete report."""
    pytest.importorskip("pandas", reason="the [eda] extra is not installed")
    pytest.importorskip("matplotlib", reason="the [eda] extra is not installed")

    source = tmp_path / "sales.csv"
    source.write_text(
        "order_id,revenue,region\n"
        + "\n".join(f"ORD-{i:04d},{100 + i * 3}.5,{'ns'[i % 2]}" for i in range(120))
        + "\n",
        encoding="utf-8",
    )

    out = tmp_path / "out"
    assert cli.main(["eda", str(source), "--out", str(out), "--quiet"]) == 0
    for artefact in ("report.md", "recipe.json", "analysis.py", "summary.json"):
        assert (out / artefact).exists(), f"{artefact} was not written"
    assert list((out / "figures").glob("*.png"))


# -- the public names -------------------------------------------------------


def test_the_documented_names_resolve() -> None:
    import thehallucinatedlab as thl

    for name in ("eda", *EDA_TOOLS):
        assert callable(getattr(thl, name)), f"{name} is not reachable from the package"


def test_the_names_are_in_dir_so_completion_finds_them() -> None:
    import thehallucinatedlab as thl

    listed = dir(thl)
    for name in ("eda", "describe_dataset", "EDANotInstalled"):
        assert name in listed, f"{name} is missing from dir()"


def test_an_unknown_attribute_still_raises() -> None:
    """A catch-all __getattr__ that never raises hides every typo."""
    import thehallucinatedlab as thl

    with pytest.raises(AttributeError, match="no attribute"):
        _ = thl.definitely_not_a_tool

    with pytest.raises(AttributeError, match="no attribute"):
        _ = errors.NotAnErrorClass


# -- one error hierarchy ----------------------------------------------------


def test_the_eda_errors_descend_from_this_package_s_base_class() -> None:
    """Not a lookalike defined locally.

    The subpackage falls back to its own THLError when the parent is not
    importable, so it can be developed standalone. Inside a real install
    that fallback must never be what a caller catches, or one
    `except THLError` would stop covering half the toolkit.
    """
    from thehallucinatedlab.tools.eda import errors as eda_errors

    assert eda_errors.THLError is errors.THLError

    for name in (
        "EDANotInstalled", "UnreadableSource", "EmptyDataset", "ColumnNotFound",
        "UnsupportedColumnType", "InvalidRecipe", "OutputNotWritable", "SamplingRequired",
    ):
        cls = getattr(errors, name)
        assert issubclass(cls, errors.THLError), f"{name} escapes except THLError"


def test_the_errors_are_reachable_without_the_extra() -> None:
    """EDANotInstalled has to be raisable on the machine that lacks pandas."""
    result = run_python(
        "import sys\n"
        "from thehallucinatedlab import EDANotInstalled\n"
        "heavy = [m for m in ('pandas', 'numpy', 'matplotlib', 'scipy') if m in sys.modules]\n"
        "assert not heavy, heavy\n"
        "assert issubclass(EDANotInstalled, Exception)\n"
    )
    assert result.returncode == 0, result.stderr


# -- the base install -------------------------------------------------------


def test_importing_the_package_costs_no_scientific_stack() -> None:
    """The whole reason EDA is an extra rather than a dependency."""
    result = run_python(
        "import sys, thehallucinatedlab\n"
        "heavy = [m for m in ('pandas', 'numpy', 'matplotlib', 'scipy') if m in sys.modules]\n"
        "assert not heavy, f'importing the package pulled in {heavy}'\n"
        "assert thehallucinatedlab.converter is not None\n"
    )
    assert result.returncode == 0, result.stderr


def test_the_base_dependency_set_is_unchanged() -> None:
    """Definition of done: `pip install thehallucinatedlab` stays as cheap.

    pandas, numpy, matplotlib and scipy belong to the extra. One of them
    in `dependencies` would be invisible until somebody's install got
    three orders of magnitude larger.
    """
    import tomllib

    data = tomllib.loads((PACKAGE_ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    assert data["project"]["dependencies"] == ["pillow>=10.0"]

    extras = data["project"]["optional-dependencies"]
    assert "eda" in extras
    heavy = {"pandas", "numpy", "matplotlib", "scipy"}
    declared = {req.split(">")[0].split("<")[0].split("=")[0].strip() for req in extras["eda"]}
    assert heavy <= declared, f"the eda extra is missing {heavy - declared}"
    assert "seaborn" not in declared, "the generated analysis.py must stay installable from four"


def test_the_version_moved_with_the_feature() -> None:
    import tomllib

    data = tomllib.loads((PACKAGE_ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    assert data["project"]["version"] == __version__
    assert __version__ == registry.version


# -- thl tools --------------------------------------------------------------


def test_thl_tools_lists_the_primitives(capsys) -> None:
    assert cli._print_tools() == 0
    printed = capsys.readouterr().out
    for name in EDA_TOOLS:
        assert name in printed, f"thl tools does not mention {name}"


def test_thl_tools_names_the_install_line_when_the_extra_is_missing(
    capsys, monkeypatch
) -> None:
    """Listing a tool that cannot run is misleading; hiding it means
    nobody discovers it. Naming the command does neither."""
    from thehallucinatedlab.tools.eda import deps

    monkeypatch.setattr(deps, "_checked", True)
    monkeypatch.setattr(deps, "_missing", list(deps._REQUIRED))

    cli._print_tools()
    printed = capsys.readouterr().out
    assert "pip install thehallucinatedlab[eda]" in printed
    assert "converter" in printed, "the tools that do work must still be listed"
