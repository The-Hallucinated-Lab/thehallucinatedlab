"""The generated script runs, and reproduces the report it came from.

Definition of done, item 5. This is the test the whole ``portable``
mechanism exists to make passable, and the one that lets the generated
file's header say "running this reproduces the report" without lying.

It runs ``analysis.py`` in a subprocess with a clean interpreter, so a
name the script forgot to define is a failure here rather than something
that happens to work because the test process already imported it.
"""

from __future__ import annotations

import ast
import json
import subprocess
import sys
from pathlib import Path

import pytest

from thehallucinatedlab.tools.eda import eda


def run_script(script: Path, out: Path) -> dict:
    result = subprocess.run(
        [sys.executable, str(script), "--out", str(out)],
        capture_output=True,
        text=True,
        timeout=600,
    )
    assert result.returncode == 0, (
        f"analysis.py exited {result.returncode}\n"
        f"--- stdout ---\n{result.stdout}\n--- stderr ---\n{result.stderr}"
    )
    assert "!" not in result.stdout, f"a statistic or figure failed:\n{result.stdout}"
    return json.loads((out / "summary.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def run(tmp_path_factory) -> dict:
    """One full run, reused by every assertion in this module."""
    from conftest import simple_frame

    base = tmp_path_factory.mktemp("script")
    source = base / "sales.csv"
    simple_frame().to_csv(source, index=False)
    result = eda(source, target="churn", tier2=True, out=base / "report")
    return {
        "result": result,
        "original": json.loads((result.out_dir / "summary.json").read_text(encoding="utf-8")),
        "base": base,
    }


def test_a_script_is_emitted_by_default(run: dict) -> None:
    script = run["result"].script
    assert script is not None and script.exists()
    assert script.name == "analysis.py"


def test_the_script_is_valid_python(run: dict) -> None:
    ast.parse(run["result"].script.read_text(encoding="utf-8"))


def test_the_script_does_not_import_the_toolkit(run: dict) -> None:
    """A wrapper around this library is not the deliverable.

    The point of the script is that it can be edited without reading
    anyone else's source, which stops being true the moment it imports
    the thing it replaces.
    """
    tree = ast.parse(run["result"].script.read_text(encoding="utf-8"))
    imported: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.append(node.module)
    toolkit = [name for name in imported if name.split(".")[0] == "thehallucinatedlab"]
    assert not toolkit, f"the generated script imports the toolkit: {toolkit}"


def test_the_script_names_its_dependencies(run: dict) -> None:
    header = run["result"].script.read_text(encoding="utf-8")[:2000]
    for package in ("pandas", "numpy", "matplotlib", "scipy"):
        assert package in header, f"the header does not mention {package}"
    assert "pip install" in header


def test_the_script_reproduces_summary_json_exactly(run: dict, tmp_path: Path) -> None:
    """Definition of done, item 5, verbatim."""
    produced = run_script(run["result"].script, tmp_path / "rerun")
    assert produced == run["original"]


def test_the_script_redraws_every_figure(run: dict, tmp_path: Path) -> None:
    out = tmp_path / "rerun-figures"
    run_script(run["result"].script, out)
    original = sorted(p.name for p in (run["result"].out_dir / "figures").glob("*.png"))
    redrawn = sorted(p.name for p in (out / "figures").glob("*.png"))
    assert redrawn == original


def test_a_second_generation_is_byte_identical(run: dict) -> None:
    """Same recipe, same script. Otherwise the output is not diffable."""
    from thehallucinatedlab.tools.eda import script as codegen
    from thehallucinatedlab.tools.eda.recipe import Recipe

    recipe = Recipe.from_file(run["result"].recipe)
    source = Path(recipe.source["path"])
    first = codegen.build(recipe, source=source, tool_version="0.2.0", generated_at="fixed")
    second = codegen.build(recipe, source=source, tool_version="0.2.0", generated_at="fixed")
    assert first == second


def test_no_script_when_asked(tmp_path: Path) -> None:
    from conftest import simple_frame

    source = tmp_path / "s.csv"
    simple_frame(60).to_csv(source, index=False)
    result = eda(source, script=False, out=tmp_path / "out")
    assert result.script is None
    assert not (result.out_dir / "analysis.py").exists()


def test_the_script_runs_from_any_directory(run: dict, tmp_path: Path) -> None:
    """The source path has to be absolute and correctly escaped.

    A relative path only works from the directory the report was made in,
    and a Windows path wrapped in ``r'...'`` doubles every backslash into
    the file name. Running the script from an unrelated cwd catches both.
    """
    out = tmp_path / "elsewhere"
    result = subprocess.run(
        [sys.executable, str(run["result"].script), "--out", str(out)],
        capture_output=True, text=True, cwd=str(tmp_path), timeout=600,
    )
    assert result.returncode == 0, result.stderr
    assert json.loads((out / "summary.json").read_text(encoding="utf-8")) == run["original"]


def test_the_script_honours_the_figure_format(tmp_path: Path) -> None:
    """The script wrote .png whatever the report used, until this caught it."""
    from conftest import simple_frame

    source = tmp_path / "svg.csv"
    simple_frame(120).to_csv(source, index=False)
    result = eda(source, figure_format="svg", tier2=["missingness"], out=tmp_path / "out")
    assert all(path.suffix == ".svg" for path in result.figures)

    out = tmp_path / "rerun"
    run_script(result.script, out)
    redrawn = sorted(p.name for p in (out / "figures").glob("*"))
    assert redrawn, "the script drew nothing"
    assert all(name.endswith(".svg") for name in redrawn), redrawn
    assert redrawn == sorted(p.name for p in (result.out_dir / "figures").glob("*"))


def test_the_script_reproduces_a_sampled_run(tmp_path: Path) -> None:
    """The seed in the recipe has to mean something.

    A sampled report and a script that re-samples differently would agree
    on nothing, so the reservoir draw is shared code and the seed is
    written into the script.
    """
    from conftest import simple_frame

    source = tmp_path / "sampled.csv"
    simple_frame(400).to_csv(source, index=False)
    result = eda(source, sample=120, seed=7, out=tmp_path / "out")

    original = json.loads((result.out_dir / "summary.json").read_text(encoding="utf-8"))
    assert original["sampling"]["applied"] is True

    produced = run_script(result.script, tmp_path / "rerun")
    assert produced == original
