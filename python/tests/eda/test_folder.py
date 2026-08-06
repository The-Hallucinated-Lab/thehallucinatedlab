"""Folder mode, and the corrupt file in the middle of it.

Definition of done, item 7. A folder with thirty CSVs has a broken one,
and a run that aborts on file nineteen has wasted the other
twenty-nine -- so failure is isolated per file, recorded, and reported
through the exit code rather than through a traceback.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from thehallucinatedlab.tools.eda import eda
from thehallucinatedlab.tools.eda.errors import UnreadableSource


def test_a_folder_is_n_independent_datasets(folder: Path, tmp_path: Path) -> None:
    result = eda(folder, out=tmp_path / "out")
    assert result.report.name == "index.md"
    assert len(result.datasets) == 2, "the two good files should both have produced a report"
    for dataset in result.datasets:
        assert dataset.report.exists()
        assert (dataset.out_dir / "summary.json").exists()


def test_one_broken_file_does_not_abort_the_run(folder: Path, tmp_path: Path) -> None:
    """Definition of done, item 7."""
    result = eda(folder, out=tmp_path / "out")
    assert "broken.csv" in result.failures
    assert "empty.csv" in result.failures
    assert not result.ok
    assert (tmp_path / "out" / "a" / "report.md").exists()
    assert (tmp_path / "out" / "b" / "report.md").exists()


def test_the_index_names_the_failure_and_does_not_link_it(folder: Path, tmp_path: Path) -> None:
    result = eda(folder, out=tmp_path / "out")
    index = result.report.read_text(encoding="utf-8")
    assert "broken.csv" in index
    assert "failed" in index
    assert "[a.csv](a/report.md)" in index
    assert "[broken.csv]" not in index, "a dead link where a diagnosis belongs"


def test_stop_on_error_stops(folder: Path, tmp_path: Path) -> None:
    with pytest.raises(UnreadableSource):
        eda(folder, out=tmp_path / "out", continue_on_error=False)


def test_a_pattern_narrows_what_is_picked_up(folder: Path, tmp_path: Path) -> None:
    result = eda(folder, pattern="a.csv", out=tmp_path / "out")
    assert result.ok
    assert len(result.datasets) == 1
    # Pointing at a directory always produces an index, even when one file
    # matched. "Directory in, index out" is a contract a person can hold in
    # their head; "index out unless exactly one matched" is a special case
    # that only shows up when they are already confused about the glob.
    assert result.report.name == "index.md"


def test_a_file_produces_a_report_not_an_index(folder: Path, tmp_path: Path) -> None:
    result = eda(folder / "a.csv", out=tmp_path / "out")
    assert result.report.name == "report.md"
    assert result.datasets == []


def test_max_files_is_a_limit_and_says_so(folder: Path, tmp_path: Path) -> None:
    result = eda(folder, max_files=1, out=tmp_path / "out")
    assert any("max-files" in warning for warning in result.warnings)


def test_each_dataset_gets_its_own_directory(folder: Path, tmp_path: Path) -> None:
    result = eda(folder, out=tmp_path / "out")
    directories = {dataset.out_dir.name for dataset in result.datasets}
    assert directories == {"a", "b"}
    a = json.loads((tmp_path / "out" / "a" / "summary.json").read_text(encoding="utf-8"))
    b = json.loads((tmp_path / "out" / "b" / "summary.json").read_text(encoding="utf-8"))
    assert a["source"]["rows"] != b["source"]["rows"]


def test_an_empty_directory_says_what_it_looked_for(tmp_path: Path) -> None:
    empty = tmp_path / "nothing"
    empty.mkdir()
    with pytest.raises(UnreadableSource, match="No readable data files"):
        eda(empty, out=tmp_path / "out")


def test_a_missing_path_is_named(tmp_path: Path) -> None:
    with pytest.raises(UnreadableSource, match="No such file"):
        eda(tmp_path / "absent.csv")


def test_recursive_finds_nested_files(folder: Path, tmp_path: Path) -> None:
    nested = folder / "deeper"
    nested.mkdir()
    (folder / "a.csv").replace(nested / "moved.csv")
    result = eda(folder, recursive=True, pattern="**/*.csv", out=tmp_path / "out")
    labels = {dataset.out_dir.name for dataset in result.datasets}
    assert "moved" in labels
