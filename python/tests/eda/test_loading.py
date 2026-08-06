"""Discovery, sniffing and the streaming path.

Sniffing is guesswork, so the tests are about the guesses being right on
the shapes people actually have, and about an explicit argument never
being treated as a hint. The streaming tests are about the promise that
makes sampling acceptable at all: counts stay exact, and the same seed
draws the same sample.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from thehallucinatedlab.tools.eda import loading
from thehallucinatedlab.tools.eda.errors import EmptyDataset, UnreadableSource
from thehallucinatedlab.tools.eda.loading import LoadOptions, SourceRef


def write(path: Path, text: str, encoding: str = "utf-8") -> Path:
    path.write_text(text, encoding=encoding)
    return path


# -- discovery --------------------------------------------------------------


def test_a_file_is_one_dataset(simple_csv: Path) -> None:
    refs = loading.discover(simple_csv)
    assert len(refs) == 1
    assert refs[0].path == simple_csv
    assert refs[0].stem == "sales"


def test_a_directory_is_sorted_so_two_runs_agree(folder: Path) -> None:
    """Figure numbering follows discovery order, so order has to be stable."""
    first = [ref.label for ref in loading.discover(folder)]
    second = [ref.label for ref in loading.discover(folder)]
    assert first == second == sorted(first)


def test_unreadable_extensions_are_skipped_in_a_directory(folder: Path) -> None:
    (folder / "notes.md").write_text("not data", encoding="utf-8")
    labels = [ref.label for ref in loading.discover(folder)]
    assert "notes.md" not in labels


def test_a_pattern_overrides_the_extension_filter(folder: Path) -> None:
    (folder / "weird.data").write_text("a,b\n1,2\n", encoding="utf-8")
    labels = [ref.label for ref in loading.discover(folder, pattern="*.data")]
    assert labels == ["weird.data"]


def test_a_directory_with_nothing_readable_says_what_it_wanted(tmp_path: Path) -> None:
    (tmp_path / "readme.md").write_text("x", encoding="utf-8")
    with pytest.raises(UnreadableSource, match="No readable data files"):
        loading.discover(tmp_path)


# -- sniffing ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("delimiter", "suffix"),
    [(",", ".csv"), (";", ".csv"), ("\t", ".tsv"), ("|", ".psv"), ("\t", ".csv")],
)
def test_the_delimiter_is_found(tmp_path: Path, delimiter: str, suffix: str) -> None:
    rows = "\n".join(delimiter.join(["a", "b", "c"]) for _ in range(6))
    path = write(tmp_path / f"data{suffix}", f"one{delimiter}two{delimiter}three\n{rows}\n")
    assert loading.sniff(SourceRef(path)).delimiter == delimiter


def test_an_explicit_delimiter_is_an_instruction_not_a_hint(tmp_path: Path) -> None:
    path = write(tmp_path / "data.csv", "a,b\n1,2\n1,2\n1,2\n")
    options = loading.sniff(SourceRef(path), LoadOptions(delimiter=";"))
    assert options.delimiter == ";"
    assert "delimiter" not in options.sniffed


@pytest.mark.parametrize("encoding", ["utf-8", "utf-8-sig", "cp1252"])
def test_the_encoding_is_found(tmp_path: Path, encoding: str) -> None:
    path = tmp_path / "data.csv"
    path.write_text("name,city\nJosé,Zürich\nJosé,Zürich\n", encoding=encoding)
    detected = loading.sniff(SourceRef(path)).encoding
    frame = loading.load(SourceRef(path), LoadOptions(encoding=detected)).frame
    assert "José" in frame["name"].tolist()


def test_a_headerless_file_is_noticed(tmp_path: Path) -> None:
    path = write(tmp_path / "data.csv", "1,2,3\n4,5,6\n7,8,9\n10,11,12\n")
    assert loading.sniff(SourceRef(path)).header is None


def test_a_headed_file_keeps_its_header(tmp_path: Path) -> None:
    path = write(tmp_path / "data.csv", "alpha,beta\n1,2\n3,4\n5,6\n7,8\n")
    assert loading.sniff(SourceRef(path)).header == 0


def test_an_empty_file_is_named_as_empty(tmp_path: Path) -> None:
    path = write(tmp_path / "data.csv", "")
    with pytest.raises(EmptyDataset):
        loading.sniff(SourceRef(path))


def test_duplicate_column_names_are_renamed_loudly(tmp_path: Path) -> None:
    path = write(tmp_path / "data.csv", "a,a,b\n1,2,3\n4,5,6\n7,8,9\n")
    frame = loading.load(SourceRef(path)).frame
    assert list(frame.columns) == ["a", "a.1", "b"]


def test_extra_na_tokens_are_honoured(tmp_path: Path) -> None:
    path = write(tmp_path / "data.csv", "a,b\n1,MISSING\n2,3\n4,MISSING\n6,7\n")
    frame = loading.load(SourceRef(path), LoadOptions(na_values=["MISSING"])).frame
    assert frame["b"].isna().sum() == 2


def test_nrows_reads_a_prefix(simple_csv: Path) -> None:
    loaded = loading.load(SourceRef(simple_csv), LoadOptions(nrows=25))
    assert loaded.rows == 25


# -- sampling and streaming -------------------------------------------------


def test_an_explicit_sample_is_recorded_and_reproducible(simple_csv: Path) -> None:
    first = loading.load(SourceRef(simple_csv), LoadOptions(sample=50, seed=9))
    second = loading.load(SourceRef(simple_csv), LoadOptions(sample=50, seed=9))
    assert first.sampling.applied
    assert first.sampling.n == 50
    assert first.sampling.of == 300
    assert first.frame.equals(second.frame)


def test_a_different_seed_draws_a_different_sample(simple_csv: Path) -> None:
    a = loading.load(SourceRef(simple_csv), LoadOptions(sample=50, seed=1))
    b = loading.load(SourceRef(simple_csv), LoadOptions(sample=50, seed=2))
    assert not a.frame.equals(b.frame)


def test_the_sampling_caption_says_everything_needed_to_reproduce_it(
    simple_csv: Path
) -> None:
    loaded = loading.load(SourceRef(simple_csv), LoadOptions(sample=40, seed=5))
    caption = loaded.sampling.caption
    assert "40" in caption and "300" in caption and "seed 5" in caption


def test_streaming_keeps_exact_statistics(tmp_path: Path, monkeypatch) -> None:
    """The promise that makes sampling acceptable: counts stay exact.

    The size threshold is lowered rather than writing a 200 MB fixture --
    the code path is identical and the test finishes this decade.
    """
    from conftest import simple_frame

    frame = simple_frame(4000)
    path = tmp_path / "big.csv"
    frame.to_csv(path, index=False)

    monkeypatch.setattr(loading, "FULL_LOAD_BYTES", 1024)
    monkeypatch.setattr(loading, "CHUNK_ROWS", 500)
    loaded = loading.load(SourceRef(path), LoadOptions(sample=300, seed=4))

    assert loaded.rows == 4000
    assert loaded.sampling.applied
    assert len(loaded.frame) == 300
    assert loaded.exact_for("revenue", "nulls") == int(frame["revenue"].isna().sum())
    assert loaded.exact_for("revenue", "count") == int(frame["revenue"].notna().sum())
    assert loaded.exact_for("region", "n_unique") == int(frame["region"].nunique())


def test_streaming_is_reproducible(tmp_path: Path, monkeypatch) -> None:
    from conftest import simple_frame

    path = tmp_path / "big.csv"
    simple_frame(3000).to_csv(path, index=False)
    monkeypatch.setattr(loading, "FULL_LOAD_BYTES", 1024)
    monkeypatch.setattr(loading, "CHUNK_ROWS", 400)

    first = loading.load(SourceRef(path), LoadOptions(sample=250, seed=11))
    second = loading.load(SourceRef(path), LoadOptions(sample=250, seed=11))
    assert first.frame.equals(second.frame)


def test_a_streamed_report_prints_exact_counts_beside_sampled_figures(
    tmp_path: Path, monkeypatch
) -> None:
    """Definition of done: exact statistics wherever affordable."""
    import json

    from conftest import simple_frame

    from thehallucinatedlab.tools.eda import eda

    frame = simple_frame(3000)
    path = tmp_path / "big.csv"
    frame.to_csv(path, index=False)
    monkeypatch.setattr(loading, "FULL_LOAD_BYTES", 1024)
    monkeypatch.setattr(loading, "CHUNK_ROWS", 500)

    result = eda(path, sample=400, seed=2, out=tmp_path / "out")
    summary = json.loads(result.summary.read_text(encoding="utf-8"))
    nulls = summary["columns"]["revenue"]["summaries"]["nulls"]
    assert nulls["count"] == int(frame["revenue"].isna().sum())
    assert summary["source"]["rows"] == 3000


def test_sampling_can_be_refused_rather_than_applied(tmp_path: Path, monkeypatch) -> None:
    """The CLI asks before spending the time, not after."""
    from conftest import simple_frame

    from thehallucinatedlab.tools.eda.errors import SamplingRequired

    path = tmp_path / "big.csv"
    simple_frame(2000).to_csv(path, index=False)
    monkeypatch.setattr(loading, "FULL_LOAD_BYTES", 1024)

    with pytest.raises(SamplingRequired, match="streaming"):
        loading.load(SourceRef(path), allow_sampling=False)


def test_a_wide_frame_is_flagged(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(loading, "WIDE_COLUMNS", 5)
    path = tmp_path / "wide.csv"
    pd.DataFrame({f"c{i}": [1, 2, 3] for i in range(10)}).to_csv(path, index=False)
    loaded = loading.load(SourceRef(path))
    assert any("wide" in warning for warning in loaded.warnings)


# -- other formats ----------------------------------------------------------


def test_jsonl_is_read(tmp_path: Path) -> None:
    path = tmp_path / "data.jsonl"
    path.write_text('{"a": 1, "b": "x"}\n{"a": 2, "b": "y"}\n', encoding="utf-8")
    frame = loading.load(SourceRef(path)).frame
    assert list(frame.columns) == ["a", "b"]
    assert len(frame) == 2


def test_an_unknown_extension_lists_what_is_readable(tmp_path: Path) -> None:
    path = tmp_path / "data.bin"
    path.write_bytes(b"\x00\x01")
    with pytest.raises(UnreadableSource, match="Readable"):
        loading.load(SourceRef(path))


def test_a_row_estimate_is_close_enough_for_a_picker(simple_csv: Path) -> None:
    estimate = loading.estimate_rows(SourceRef(simple_csv))
    assert estimate is not None
    assert 0.5 * 300 <= estimate <= 1.5 * 300
