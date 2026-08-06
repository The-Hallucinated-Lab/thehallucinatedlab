"""The command line: zero flags, every flag, and the right exit codes.

Definition of done, items 1 and 2. Item 2 asks that every session screen
have a working flag equivalent -- the session's footers promise those
flags, so a footer that names a flag the parser rejects would be the tool
teaching people something untrue.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from thehallucinatedlab.tools.eda import cli
from thehallucinatedlab.tools.eda.errors import THLError


def run(args: list[str], capsys) -> tuple[int, str, str]:
    code = cli.main(args)
    captured = capsys.readouterr()
    return code, captured.out, captured.err


def test_zero_flags_produces_a_complete_report(simple_csv: Path, capsys) -> None:
    """Definition of done, item 1."""
    code, out, _ = run([str(simple_csv)], capsys)
    assert code == cli.EXIT_OK

    directory = simple_csv.parent / "sales.eda"
    assert (directory / "report.md").exists()
    assert (directory / "recipe.json").exists()
    assert (directory / "analysis.py").exists()
    assert (directory / "summary.json").exists()
    assert list((directory / "figures").glob("*.png"))
    assert "report" in out


def test_the_default_output_is_one_directory_beside_the_source(
    simple_csv: Path, capsys
) -> None:
    """Never mixed in with the data, and trivially deletable."""
    before = set(simple_csv.parent.iterdir())
    run([str(simple_csv)], capsys)
    added = set(simple_csv.parent.iterdir()) - before
    assert added == {simple_csv.parent / "sales.eda"}


@pytest.mark.parametrize(
    "flags",
    [
        ["--columns", "revenue,region"],
        ["--exclude", "city,note"],
        ["--types", "quantity=categorical_low"],
        ["--charts", "numeric_continuous:histogram,kde"],
        ["--summaries", "numeric_continuous:mean,median"],
        ["--all-charts"],
        ["--no-charts"],
        ["--tier2", "corr,missing"],
        ["--tier2", "all", "--target", "churn"],
        ["--target", "churn"],
        ["--top-n", "5"],
        ["--outlier-rule", "zscore"],
        ["--format", "html"],
        ["--format", "html", "--self-contained"],
        ["--figure-format", "svg"],
        ["--dpi", "80"],
        ["--no-script"],
        ["--delimiter", ","],
        ["--encoding", "utf-8"],
        ["--header", "0"],
        ["--na-values", "NA,-"],
        ["--nrows", "50"],
        ["--sample", "40"],
        ["--seed", "7"],
        ["--quiet"],
    ],
    ids=lambda f: " ".join(f).replace("--", ""),
)
def test_every_selection_flag_runs(simple_csv: Path, tmp_path: Path, flags, capsys) -> None:
    """Definition of done, item 2: every screen has a working flag."""
    code, _, err = run([str(simple_csv), "--out", str(tmp_path / "out"), *flags], capsys)
    assert code == cli.EXIT_OK, err
    assert list((tmp_path / "out").glob("report.*"))


def test_no_charts_writes_no_figures(simple_csv: Path, tmp_path: Path, capsys) -> None:
    run([str(simple_csv), "--out", str(tmp_path / "out"), "--no-charts"], capsys)
    assert not list((tmp_path / "out").glob("figures/*"))


def test_all_charts_writes_more_than_the_default(
    simple_csv: Path, tmp_path: Path, capsys
) -> None:
    run([str(simple_csv), "--out", str(tmp_path / "a")], capsys)
    run([str(simple_csv), "--out", str(tmp_path / "b"), "--all-charts"], capsys)
    assert len(list((tmp_path / "b").glob("figures/*"))) > len(
        list((tmp_path / "a").glob("figures/*"))
    )


def test_dry_run_writes_nothing(simple_csv: Path, tmp_path: Path, capsys) -> None:
    code, out, _ = run([str(simple_csv), "--out", str(tmp_path / "out"), "--dry-run"], capsys)
    assert code == cli.EXIT_OK
    assert not (tmp_path / "out").exists()
    assert "nothing was written" in out
    assert "revenue" in out


def test_save_recipe_writes_only_the_recipe(
    simple_csv: Path, tmp_path: Path, capsys
) -> None:
    target = tmp_path / "team.json"
    code, _, _ = run([str(simple_csv), "--save-recipe", str(target)], capsys)
    assert code == cli.EXIT_OK
    assert json.loads(target.read_text(encoding="utf-8"))["columns"]
    assert not (simple_csv.parent / "sales.eda").exists()


def test_a_saved_recipe_replays_from_the_command_line(
    simple_csv: Path, tmp_path: Path, capsys
) -> None:
    target = tmp_path / "team.json"
    run([str(simple_csv), "--save-recipe", str(target), "--target", "churn"], capsys)
    code, _, err = run(
        [str(simple_csv), "--recipe", str(target), "--out", str(tmp_path / "out")], capsys
    )
    assert code == cli.EXIT_OK, err
    assert (tmp_path / "out" / "report.md").exists()


def test_list_needs_no_data_and_marks_the_defaults(capsys) -> None:
    code, out, _ = run(["--list"], capsys)
    assert code == cli.EXIT_OK
    assert "numeric_continuous" in out
    assert "histogram" in out
    assert "--tier2" in out


def test_a_corrupt_file_in_a_folder_exits_partial(folder: Path, tmp_path: Path, capsys) -> None:
    code, _, err = run([str(folder), "--out", str(tmp_path / "out")], capsys)
    assert code == cli.EXIT_PARTIAL
    assert "broken.csv" in err


def test_an_unreadable_source_exits_one_with_one_line(tmp_path: Path, capsys) -> None:
    code, _, err = run([str(tmp_path / "absent.csv")], capsys)
    assert code == cli.EXIT_ERROR
    assert err.startswith("thl eda:")
    assert "\n" not in err.strip(), "a traceback is the wrong output for a missing file"


def test_no_source_without_a_terminal_is_an_error(capsys) -> None:
    code, _, err = run([], capsys)
    assert code == cli.EXIT_ERROR
    assert "Name a file" in err


def test_interactive_without_a_terminal_refuses(simple_csv: Path, capsys) -> None:
    code, _, err = run([str(simple_csv), "-i"], capsys)
    assert code == cli.EXIT_ERROR
    assert "terminal" in err


def test_a_malformed_per_type_flag_says_what_it_wanted() -> None:
    with pytest.raises(THLError, match="type:name"):
        cli.parse_per_type("histogram,box", "charts")
    with pytest.raises(THLError, match="col=value"):
        cli.parse_mapping("quantity", "types")


def test_per_type_parsing_handles_several_groups() -> None:
    parsed = cli.parse_per_type("numeric_continuous:histogram,box;categorical_low:hbar", "charts")
    assert parsed == {"numeric_continuous": ["histogram", "box"], "categorical_low": ["hbar"]}


def test_overwrite_guards_a_directory_we_did_not_write(
    simple_csv: Path, tmp_path: Path, capsys
) -> None:
    occupied = tmp_path / "occupied"
    occupied.mkdir()
    (occupied / "important.txt").write_text("do not clobber", encoding="utf-8")

    code, _, err = run([str(simple_csv), "--out", str(occupied)], capsys)
    assert code == cli.EXIT_ERROR
    assert "--overwrite" in err
    assert (occupied / "important.txt").exists()

    code, _, _ = run([str(simple_csv), "--out", str(occupied), "--overwrite"], capsys)
    assert code == cli.EXIT_OK
    assert (occupied / "important.txt").exists(), "overwrite must not mean delete"


def test_rerunning_clears_stale_figures(simple_csv: Path, tmp_path: Path, capsys) -> None:
    out = tmp_path / "out"
    run([str(simple_csv), "--out", str(out), "--all-charts"], capsys)
    many = len(list((out / "figures").glob("*")))
    run([str(simple_csv), "--out", str(out)], capsys)
    few = len(list((out / "figures").glob("*")))
    assert few < many, "figures from the previous run are still in the directory"


def test_the_parser_accepts_being_mounted_on_another_command() -> None:
    """The parent package wires this in as `thl eda` with three lines."""
    import argparse

    parent = argparse.ArgumentParser(prog="thl")
    subparsers = parent.add_subparsers(dest="command")
    cli.add_subparser(subparsers)
    args = parent.parse_args(["eda", "data.csv", "--tier2", "all"])
    assert args.command == "eda"
    assert args.source == "data.csv"
    assert args.tier2 == "all"
