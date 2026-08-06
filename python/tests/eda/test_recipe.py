"""Recipes: complete, valid, and replayable.

Definition of done, item 6 -- a saved recipe replays identically. The
recipe is the seam the design turns on, so the tests here are about the
two properties that make it one: it holds every decision, and loading a
broken one says everything that is wrong with it at once.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from thehallucinatedlab.tools.eda import describe_dataset, eda, eda_report
from thehallucinatedlab.tools.eda.errors import InvalidRecipe
from thehallucinatedlab.tools.eda.recipe import Recipe, build


@pytest.fixture
def recipe(simple_csv: Path) -> Recipe:
    return build(describe_dataset(simple_csv), target="churn", tier2=["all"],
                 tool_version="0.2.0")


def test_a_recipe_holds_a_decision_for_every_column(recipe: Recipe, simple_csv: Path) -> None:
    description = describe_dataset(simple_csv)
    assert set(recipe.columns) == {column.name for column in description.columns}
    for plan in recipe.columns.values():
        assert plan.type
        assert 0.0 <= plan.confidence <= 1.0


def test_a_recipe_records_the_datetime_format_it_read_with(recipe: Recipe) -> None:
    """Otherwise a replay re-guesses and can pick the other reading."""
    assert recipe.columns["signup"].meta.get("format")


def test_a_recipe_round_trips_through_json(recipe: Recipe, tmp_path: Path) -> None:
    path = recipe.save(tmp_path / "r.json")
    again = Recipe.from_file(path)
    assert again.to_json() == recipe.to_json()


def test_a_recipe_is_readable_json(recipe: Recipe, tmp_path: Path) -> None:
    """A team standard is a file in a repository, so a person has to be
    able to open it and change one line."""
    text = recipe.save(tmp_path / "r.json").read_text(encoding="utf-8")
    data = json.loads(text)
    assert "\n" in text and text.startswith("{")
    assert set(data) >= {"version", "source", "load", "sampling", "columns", "tier2", "output"}


def test_replaying_a_recipe_reproduces_the_report(simple_csv: Path, tmp_path: Path) -> None:
    """Definition of done, item 6."""
    first = eda(simple_csv, target="churn", tier2=True, out=tmp_path / "one")
    second = eda_report(simple_csv, recipe=first.recipe, out=tmp_path / "two")

    left = json.loads((first.out_dir / "summary.json").read_text(encoding="utf-8"))
    right = json.loads((second.out_dir / "summary.json").read_text(encoding="utf-8"))
    assert left == right

    assert [p.name for p in sorted(first.out_dir.glob("figures/*"))] == [
        p.name for p in sorted(second.out_dir.glob("figures/*"))
    ]


def test_a_replay_uses_the_recipe_type_not_a_fresh_guess(
    simple_csv: Path, tmp_path: Path
) -> None:
    """An override is a decision. Re-inferring would let the tool argue
    with the report it is meant to reproduce."""
    first = eda(simple_csv, types={"quantity": "categorical_low"}, out=tmp_path / "one")
    saved = Recipe.from_file(first.recipe)
    assert saved.columns["quantity"].type == "categorical_low"
    assert saved.columns["quantity"].overridden

    second = eda_report(simple_csv, recipe=first.recipe, out=tmp_path / "two")
    replayed = Recipe.from_file(second.recipe)
    assert replayed.columns["quantity"].type == "categorical_low"


def test_a_recipe_from_last_month_still_profiles_a_new_column(
    simple_csv: Path, tmp_path: Path
) -> None:
    """A new column gets defaults rather than being silently dropped."""
    import pandas as pd

    first = eda(simple_csv, out=tmp_path / "one")
    frame = pd.read_csv(simple_csv)
    frame["margin"] = frame["revenue"] * 0.2
    changed = tmp_path / "next_month.csv"
    frame.to_csv(changed, index=False)

    second = eda_report(changed, recipe=first.recipe, out=tmp_path / "two")
    replayed = Recipe.from_file(second.recipe)
    assert "margin" in replayed.columns
    assert replayed.columns["margin"].charts


def test_a_recipe_naming_a_missing_column_says_so(simple_csv: Path, tmp_path: Path) -> None:
    import pandas as pd

    first = eda(simple_csv, out=tmp_path / "one")
    frame = pd.read_csv(simple_csv).drop(columns=["city"])
    trimmed = tmp_path / "trimmed.csv"
    frame.to_csv(trimmed, index=False)

    second = eda_report(trimmed, recipe=first.recipe, out=tmp_path / "two")
    assert any("city" in warning for warning in second.warnings)
    assert second.report.exists()


def test_every_problem_is_reported_at_once(recipe: Recipe, tmp_path: Path) -> None:
    """Same posture as the parent package's argument validator."""
    data = recipe.to_json()
    data["columns"]["revenue"]["charts"] = ["hbar"]
    data["options"]["outlier_rule"] = "madness"
    data["output"]["format"] = "pdf"

    with pytest.raises(InvalidRecipe) as caught:
        Recipe.from_json(data)
    message = str(caught.value)
    assert "hbar" in message
    assert "madness" in message
    assert "pdf" in message


def test_an_unknown_column_type_is_refused(recipe: Recipe) -> None:
    data = recipe.to_json()
    data["columns"]["revenue"]["type"] = "continuous"
    with pytest.raises(InvalidRecipe, match="not a column type"):
        Recipe.from_json(data)


def test_a_future_recipe_version_is_refused(recipe: Recipe) -> None:
    data = recipe.to_json()
    data["version"] = "2.0"
    with pytest.raises(InvalidRecipe, match="version"):
        Recipe.from_json(data)


def test_the_prd_illustrative_tier2_shape_still_loads(recipe: Recipe) -> None:
    """The document sketches one shape and the CLI selects another.

    Reading both costs six lines and means a recipe hand-written from the
    PRD is not rejected by the tool the PRD describes.
    """
    data = recipe.to_json()
    data["tier2"] = {"correlation": ["pearson"], "missingness": True, "target": "churn"}
    loaded = Recipe.from_json(data)
    assert "correlation" in loaded.tier2_kinds
    assert "missingness" in loaded.tier2_kinds
    assert loaded.target == "churn"


def test_a_bad_path_and_bad_json_both_say_which(tmp_path: Path) -> None:
    with pytest.raises(InvalidRecipe, match="Could not read"):
        Recipe.from_file(tmp_path / "nope.json")
    broken = tmp_path / "broken.json"
    broken.write_text("{not json", encoding="utf-8")
    with pytest.raises(InvalidRecipe, match="not valid JSON"):
        Recipe.from_file(broken)


def test_the_plan_counts_match_what_runs(simple_csv: Path, tmp_path: Path) -> None:
    """The confirm screen promises a number; the run has to keep it."""
    result = eda(simple_csv, out=tmp_path / "out")
    saved = Recipe.from_file(result.recipe)
    assert len(result.figures) == saved.figure_count()


def test_the_source_fingerprint_is_recorded(recipe: Recipe) -> None:
    assert len(recipe.source["sha256"]) == 64
    assert recipe.source["rows"] > 0
