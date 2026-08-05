"""The five primitives, used the way a pipeline would use them.

The point of decomposing EDA into tools was that each one is usable on
its own -- from Python, from a notebook, and from the auto-analytics
pipeline that is meant to consume them rather than reimplement them. So
each is tested on its own here, not only through ``eda()``.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from thehallucinatedlab.tools.eda import (
    ColumnNotFound,
    UnsupportedColumnType,
    describe_dataset,
    eda,
    plot_column,
    profile_column,
    relate_columns,
)
from thehallucinatedlab.tools.eda.errors import InvalidRecipe

# -- describe_dataset -------------------------------------------------------


def test_describe_dataset_returns_types_and_confidences(simple_csv: Path) -> None:
    description = describe_dataset(simple_csv)
    assert description.rows == 300
    assert description.n_columns == 10
    assert description.types()["revenue"] == "numeric_continuous"
    for column in description.columns:
        assert 0.0 <= column.verdict.confidence <= 1.0


def test_describe_dataset_writes_nothing(simple_csv: Path) -> None:
    before = set(simple_csv.parent.iterdir())
    describe_dataset(simple_csv)
    assert set(simple_csv.parent.iterdir()) == before


def test_describe_dataset_honours_an_override(simple_csv: Path) -> None:
    description = describe_dataset(simple_csv, types={"quantity": "categorical_low"})
    verdict = description.column("quantity").verdict
    assert verdict.type == "categorical_low"
    assert verdict.overridden


def test_describe_dataset_groups_by_type(simple_csv: Path) -> None:
    grouped = describe_dataset(simple_csv).by_type()
    assert "numeric_continuous" in grouped
    assert "revenue" in grouped["numeric_continuous"]


def test_a_missing_column_lookup_lists_what_exists(simple_csv: Path) -> None:
    description = describe_dataset(simple_csv)
    with pytest.raises(ColumnNotFound, match="Columns include"):
        description.column("nope")


# -- profile_column ---------------------------------------------------------


def test_profile_column_runs_the_type_defaults(simple_csv: Path) -> None:
    profile = profile_column(simple_csv, "revenue")
    assert profile.type == "numeric_continuous"
    assert {"mean", "median", "quartiles", "outliers"} <= set(profile.summaries)
    assert profile.summaries["mean"] > 0


def test_profile_column_output_is_json_serialisable(simple_csv: Path) -> None:
    """numpy scalars two modules away are the usual cause of a broken dump."""
    profile = profile_column(simple_csv, "revenue")
    json.dumps(profile.to_json())


def test_profile_column_takes_an_explicit_list(simple_csv: Path) -> None:
    profile = profile_column(simple_csv, "revenue", summaries=["mean", "std"])
    assert list(profile.summaries) == ["mean", "std"]


def test_profile_column_refuses_a_summary_that_does_not_apply(simple_csv: Path) -> None:
    with pytest.raises(UnsupportedColumnType, match="does not apply"):
        profile_column(simple_csv, "revenue", summaries=["true_rate"])


def test_profile_column_respects_a_type_override(simple_csv: Path) -> None:
    profile = profile_column(simple_csv, "quantity", type_override="categorical_low")
    assert profile.type == "categorical_low"
    assert "level_shares" in profile.summaries


def test_profile_column_names_a_missing_column(simple_csv: Path) -> None:
    with pytest.raises(ColumnNotFound, match="No column named"):
        profile_column(simple_csv, "absent")


def test_the_outlier_rule_changes_the_answer(simple_csv: Path) -> None:
    iqr = profile_column(simple_csv, "revenue", outlier_rule="iqr").summaries["outliers"]
    z = profile_column(simple_csv, "revenue", outlier_rule="zscore").summaries["outliers"]
    assert iqr["rule"] != z["rule"]
    assert iqr["count"] != z["count"]


# -- plot_column ------------------------------------------------------------


def test_plot_column_writes_one_figure(simple_csv: Path, tmp_path: Path) -> None:
    result = plot_column(simple_csv, "revenue", chart="histogram", out=tmp_path)
    assert result.path.exists()
    assert result.path.stat().st_size > 1000
    assert result.chart == "histogram"


def test_plot_column_refuses_a_chart_for_another_type(simple_csv: Path, tmp_path: Path) -> None:
    with pytest.raises(UnsupportedColumnType, match="does not apply"):
        plot_column(simple_csv, "revenue", chart="hbar", out=tmp_path)


def test_plot_column_needs_a_target_when_the_chart_does(
    simple_csv: Path, tmp_path: Path
) -> None:
    with pytest.raises(InvalidRecipe, match="needs a target"):
        plot_column(simple_csv, "region", chart="stacked_vs_target", out=tmp_path)

    result = plot_column(
        simple_csv, "region", chart="stacked_vs_target", target="churn", out=tmp_path
    )
    assert result.path.exists()


def test_plot_column_can_be_told_the_type(simple_csv: Path, tmp_path: Path) -> None:
    result = plot_column(
        simple_csv, "quantity", chart="hbar", type_override="categorical_low", out=tmp_path
    )
    assert result.path.exists()


def test_a_figure_of_an_empty_column_says_so_rather_than_vanishing(
    simple_csv: Path, tmp_path: Path
) -> None:
    """A hole in a numbered figure list reads as a crash."""
    result = plot_column(
        simple_csv, "unused", chart="histogram",
        type_override="numeric_continuous", out=tmp_path,
    )
    assert result.path.exists()


# -- relate_columns ---------------------------------------------------------


def test_relate_duplicates_reports_both_counts_and_the_rule(simple_csv: Path) -> None:
    result = relate_columns(simple_csv, kind="duplicates")
    assert result.data["exact"] == 0
    assert "near_rule" in result.data, "a near-duplicate count needs its definition"


def test_relate_correlation_draws_and_measures(simple_csv: Path, tmp_path: Path) -> None:
    result = relate_columns(simple_csv, kind="correlation", out=tmp_path)
    assert "pearson" in result.data
    assert "spearman" in result.data
    assert all(figure.path.exists() for figure in result.figures)


def test_relate_correlation_says_when_there_is_nothing_to_correlate(
    tmp_path: Path
) -> None:
    import pandas as pd

    source = tmp_path / "one.csv"
    pd.DataFrame({"only": [1.5, 2.5, 3.5] * 40, "text": list("abc") * 40}).to_csv(
        source, index=False
    )
    result = relate_columns(source, kind="correlation", out=tmp_path / "f")
    assert any("at least two numeric" in warning for warning in result.warnings)


def test_relate_missingness_finds_the_gaps(simple_csv: Path, tmp_path: Path) -> None:
    result = relate_columns(simple_csv, kind="missingness", out=tmp_path)
    columns = {row["column"] for row in result.data["per_column"] if row["nulls"]}
    assert {"revenue", "region", "unused"} <= columns


def test_relate_target_ranks_features(simple_csv: Path, tmp_path: Path) -> None:
    result = relate_columns(simple_csv, kind="target", target="churn", out=tmp_path)
    ranked = result.data["mutual_information"]
    assert ranked
    assert all(row["bits"] >= 0 for row in ranked)
    assert "churn" not in [row["column"] for row in ranked], "the target ranked against itself"


def test_relate_target_excludes_keys_from_the_ranking(simple_csv: Path, tmp_path: Path) -> None:
    """A primary key scores high against everything and means nothing."""
    result = relate_columns(simple_csv, kind="target", target="churn", out=tmp_path)
    assert "order_id" not in [row["column"] for row in result.data["mutual_information"]]


def test_relate_target_without_a_target_says_so(simple_csv: Path, tmp_path: Path) -> None:
    result = relate_columns(simple_csv, kind="target", out=tmp_path)
    assert any("without --target" in warning for warning in result.warnings)


def test_relate_refuses_an_unknown_kind(simple_csv: Path) -> None:
    with pytest.raises(UnsupportedColumnType, match="No Tier 2 analysis"):
        relate_columns(simple_csv, kind="causation")


# -- eda --------------------------------------------------------------------


def test_eda_never_prompts_or_opens_a_window(simple_csv: Path, tmp_path: Path) -> None:
    """Non-interactive by definition -- that is what keeps it working over
    SSH, in Docker, in CI and inside a notebook."""
    import builtins

    def refuse(*_args, **_kwargs):
        raise AssertionError("eda() asked a question")

    original = builtins.input
    builtins.input = refuse
    try:
        result = eda(simple_csv, out=tmp_path / "out")
    finally:
        builtins.input = original
    assert result.report.exists()


def test_eda_result_points_at_everything_it_wrote(simple_csv: Path, tmp_path: Path) -> None:
    result = eda(simple_csv, out=tmp_path / "out", target="churn", tier2=True)
    assert result.report.exists()
    assert result.recipe.exists()
    assert result.script.exists()
    assert result.summary.exists()
    assert result.figures and all(path.exists() for path in result.figures)
    json.dumps(result.to_json())


def test_eda_accepts_a_tier2_subset(simple_csv: Path, tmp_path: Path) -> None:
    result = eda(simple_csv, out=tmp_path / "out", tier2=["duplicates"])
    summary = json.loads(result.summary.read_text(encoding="utf-8"))
    assert set(summary["tier2"]) == {"duplicates"}


def test_a_target_column_is_not_plotted_against_itself(
    simple_csv: Path, tmp_path: Path
) -> None:
    from thehallucinatedlab.tools.eda.recipe import Recipe

    result = eda(simple_csv, out=tmp_path / "out", target="churn")
    recipe = Recipe.from_file(result.recipe)
    assert "stacked_vs_target" not in recipe.columns["churn"].charts


def test_an_unknown_target_is_named(simple_csv: Path, tmp_path: Path) -> None:
    with pytest.raises(ColumnNotFound, match="not in"):
        eda(simple_csv, out=tmp_path / "out", target="nope", tier2=True)
