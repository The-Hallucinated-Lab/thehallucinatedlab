"""Formats other than CSV: Parquet, JSON, and multi-sheet workbooks.

These paths ship but depend on extras within the extra, so they are
skipped rather than failed where the dependency is absent. They are worth
testing precisely because they are easy to leave unexercised: the CSV
path gets used constantly and these get used the day somebody points the
tool at a workbook.

The multi-sheet case is the important one. Profiling sheet 1 of 9 without
saying so is the spreadsheet version of silent sampling -- the report is
not wrong about what it read, it is wrong about what it is a report *of*.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pandas as pd
import pytest

from thehallucinatedlab.tools.eda import describe_dataset, eda, loading
from thehallucinatedlab.tools.eda.errors import UnreadableSource
from thehallucinatedlab.tools.eda.loading import LoadOptions, SourceRef

openpyxl = pytest.importorskip("openpyxl", reason="the [eda-excel] extra is not installed")

#: Applied per test rather than to the module: pyarrow gates three cases,
#: and skipping the file for it would take the workbook cases with it.
needs_parquet = pytest.mark.skipif(
    importlib.util.find_spec("pyarrow") is None,
    reason="the [eda-parquet] extra is not installed",
)


@pytest.fixture
def workbook(tmp_path: Path) -> Path:
    """Three sheets with deliberately different shapes."""
    from conftest import simple_frame

    path = tmp_path / "book.xlsx"
    with pd.ExcelWriter(path) as writer:
        simple_frame(150).to_excel(writer, sheet_name="orders", index=False)
        simple_frame(80).to_excel(writer, sheet_name="returns", index=False)
        pd.DataFrame({"metric": ["a", "b"], "value": [1, 2]}).to_excel(
            writer, sheet_name="notes", index=False
        )
    return path


# -- Parquet ----------------------------------------------------------------


@needs_parquet
def test_parquet_is_read_with_its_own_dtypes(tmp_path: Path) -> None:
    """Parquet carries a schema, so nothing here has to be sniffed."""
    from conftest import simple_frame

    path = tmp_path / "data.parquet"
    frame = simple_frame(200)
    frame["signup"] = pd.to_datetime(frame["signup"])
    frame.to_parquet(path, index=False)

    description = describe_dataset(path)
    assert description.rows == 200
    assert description.types()["signup"] == "datetime"
    assert description.types()["revenue"] == "numeric_continuous"


@needs_parquet
def test_parquet_runs_end_to_end(tmp_path: Path) -> None:
    from conftest import simple_frame

    path = tmp_path / "data.parquet"
    simple_frame(150).to_parquet(path, index=False)
    result = eda(path, out=tmp_path / "out")
    assert result.ok
    assert result.report.exists()
    assert result.figures


@needs_parquet
def test_a_parquet_recipe_records_the_reader(tmp_path: Path) -> None:
    """The kind is written down, not re-derived from the extension."""
    from conftest import simple_frame

    from thehallucinatedlab.tools.eda.recipe import Recipe

    path = tmp_path / "data.parquet"
    simple_frame(120).to_parquet(path, index=False)
    result = eda(path, out=tmp_path / "out")
    assert Recipe.from_file(result.recipe).load["kind"] == "parquet"


# -- JSON -------------------------------------------------------------------


def test_json_records_are_read(tmp_path: Path) -> None:
    path = tmp_path / "data.json"
    path.write_text(
        json.dumps([{"a": i, "b": f"v{i % 4}"} for i in range(80)]), encoding="utf-8"
    )
    description = describe_dataset(path)
    assert description.rows == 80
    assert set(description.types()) == {"a", "b"}


# -- Workbooks --------------------------------------------------------------


def test_a_workbook_reads_its_first_sheet_by_default(workbook: Path) -> None:
    refs = loading.discover(workbook)
    assert len(refs) == 1
    assert refs[0].sheet == "orders"
    assert describe_dataset(workbook).rows == 150


def test_a_named_sheet_is_read(workbook: Path) -> None:
    assert describe_dataset(workbook, sheet="returns").rows == 80
    assert describe_dataset(workbook, sheet="notes").rows == 2


def test_sheet_all_makes_each_sheet_its_own_dataset(workbook: Path, tmp_path: Path) -> None:
    """The idea document's recommendation: a workbook is N datasets."""
    refs = loading.discover(workbook, sheet="all")
    assert [ref.sheet for ref in refs] == ["orders", "returns", "notes"]

    result = eda(workbook, sheet="all", out=tmp_path / "out")
    assert len(result.datasets) == 3
    assert result.report.name == "index.md"
    directories = {dataset.out_dir.name for dataset in result.datasets}
    assert directories == {"book.orders", "book.returns", "book.notes"}


def test_the_unread_sheets_are_named(workbook: Path, tmp_path: Path) -> None:
    """Profiling sheet 1 of 3 without saying so is silent data loss."""
    result = eda(workbook, out=tmp_path / "out")
    joined = " ".join(result.warnings)
    assert "3 sheets" in joined
    assert "returns" in joined and "notes" in joined
    assert "--sheet all" in joined
    assert joined in result.report.read_text(encoding="utf-8") or "sheets" in (
        result.report.read_text(encoding="utf-8")
    )


def test_a_single_sheet_workbook_says_nothing(tmp_path: Path) -> None:
    """The warning has to be about a real choice, or it is noise."""
    from conftest import simple_frame

    path = tmp_path / "one.xlsx"
    simple_frame(60).to_excel(path, sheet_name="only", index=False)
    loaded = loading.load(SourceRef(path, "only"), LoadOptions())
    assert not [w for w in loaded.warnings if "sheet" in w]


def test_sheet_all_warns_about_nothing(workbook: Path, tmp_path: Path) -> None:
    """Every sheet was read, so there is nothing left to mention."""
    result = eda(workbook, sheet="all", out=tmp_path / "out")
    assert not [w for w in result.warnings if "Not read" in w]


def test_the_output_directory_names_the_sheet(workbook: Path) -> None:
    refs = loading.discover(workbook, sheet="all")
    assert [ref.stem for ref in refs] == ["book.orders", "book.returns", "book.notes"]


def test_the_generated_script_reads_the_same_sheet(workbook: Path, tmp_path: Path) -> None:
    """A script that reopens the workbook at sheet 1 reproduces nothing."""
    import subprocess
    import sys

    result = eda(workbook, sheet="returns", out=tmp_path / "out")
    original = json.loads(result.summary.read_text(encoding="utf-8"))
    assert original["source"]["rows"] == 80

    rerun = tmp_path / "rerun"
    finished = subprocess.run(
        [sys.executable, str(result.script), "--out", str(rerun)],
        capture_output=True, text=True, timeout=600,
    )
    assert finished.returncode == 0, finished.stderr
    assert json.loads((rerun / "summary.json").read_text(encoding="utf-8")) == original


def test_an_unopenable_workbook_is_named(tmp_path: Path) -> None:
    path = tmp_path / "not-really.xlsx"
    path.write_bytes(b"PK\x03\x04 this is not a workbook")
    with pytest.raises(UnreadableSource, match="workbook"):
        loading.sheet_names(path)
