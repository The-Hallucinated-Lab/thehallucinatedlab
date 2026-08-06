"""Type inference against the columns that break profilers.

Definition of done, item 4: at least forty adversarial columns. The list
in ``conftest.EXPECTED_TYPES`` is the contract -- a change there is a
change to what the tool claims about people's data, and should be
argued for in the diff rather than made to get a build green.
"""

from __future__ import annotations

import pandas as pd
import pytest
from conftest import EXPECTED_TYPES, adversarial_frame

from thehallucinatedlab.tools.eda import inference
from thehallucinatedlab.tools.eda.errors import InvalidRecipe
from thehallucinatedlab.tools.eda.types import CONFIDENCE_FLOOR


@pytest.fixture(scope="module")
def verdicts() -> dict:
    frame = adversarial_frame()
    return {
        name: inference.infer(name, frame[name], n_rows=len(frame)) for name in frame.columns
    }


def test_fixture_is_actually_adversarial() -> None:
    assert len(EXPECTED_TYPES) >= 40, "the definition of done asks for at least forty"
    assert set(EXPECTED_TYPES) == set(adversarial_frame().columns)


@pytest.mark.parametrize("column", sorted(EXPECTED_TYPES))
def test_column_is_classified_as_expected(verdicts: dict, column: str) -> None:
    verdict = verdicts[column]
    assert verdict.type == EXPECTED_TYPES[column], (
        f"{column}: read as {verdict.type} ({verdict.confidence:.2f}) "
        f"-- {verdict.reason}"
    )


@pytest.mark.parametrize("column", sorted(EXPECTED_TYPES))
def test_every_verdict_carries_a_confidence_and_a_reason(verdicts: dict, column: str) -> None:
    verdict = verdicts[column]
    assert 0.0 <= verdict.confidence <= 1.0
    assert verdict.reason, "a verdict with no sentence behind it cannot be reviewed"


def test_a_zip_code_is_not_a_quantity(verdicts: dict) -> None:
    """The canonical misclassification: a code with a mean printed on it."""
    assert verdicts["zip"].type == "numeric_discrete"
    assert verdicts["postcode"].type == "numeric_discrete"
    assert verdicts["year"].type == "numeric_discrete"


def test_a_date_column_is_not_an_identifier(verdicts: dict) -> None:
    """Daily timestamps are as unique as a primary key and are not one."""
    assert verdicts["iso_date"].type == "datetime"
    assert verdicts["iso_stamp"].type == "datetime"


def test_free_text_is_not_an_identifier(verdicts: dict) -> None:
    """The idea document's split: uniqueness *and* token count."""
    assert verdicts["comment"].type == "free_text"
    assert verdicts["address"].type == "free_text"


def test_a_continuous_measurement_is_not_an_identifier(verdicts: dict) -> None:
    assert verdicts["revenue"].type == "numeric_continuous"
    assert verdicts["ratio"].type == "numeric_continuous"


def test_competing_date_formats_lower_confidence_and_warn(verdicts: dict) -> None:
    verdict = verdicts["ambiguous_date"]
    assert verdict.type == "datetime"
    assert verdict.confidence < CONFIDENCE_FLOOR
    assert any("disagree" in warning for warning in verdict.warnings)


def test_unambiguous_dates_do_not_warn(verdicts: dict) -> None:
    """ISO8601 and %Y-%m-%d describe the same reading and must not fight."""
    for name in ("iso_date", "iso_stamp", "us_date"):
        assert not verdicts[name].warnings, f"{name}: {verdicts[name].warnings}"
        assert verdicts[name].confidence >= CONFIDENCE_FLOOR


def test_a_sparse_column_is_flagged_rather_than_asserted(verdicts: dict) -> None:
    """A 99.5%-null float still infers as continuous and is still worthless."""
    verdict = verdicts["sparse_float"]
    assert verdict.type == "numeric_continuous"
    assert verdict.confidence < CONFIDENCE_FLOOR
    assert any("null" in warning for warning in verdict.warnings)


def test_a_datetime_verdict_records_the_format_it_used(verdicts: dict) -> None:
    """Replay must parse 03/04 the way the original run did."""
    assert verdicts["us_date"].meta.get("format")
    assert verdicts["ambiguous_date"].meta.get("format")


def test_containers_are_caught_before_anything_counts_distinct_values() -> None:
    """A column of lists must be reported, not raise."""
    frame = pd.DataFrame({"x": [[1, 2]] * 50, "y": [{"a": 1}] * 50})
    for name in frame.columns:
        assert inference.infer(name, frame[name]).type == "unsupported"


def test_an_override_replaces_the_verdict_and_remembers_the_guess() -> None:
    frame = adversarial_frame()
    verdict = inference.infer("zip", frame["zip"])
    forced = inference.apply_override(verdict, "categorical_high")
    assert forced.type == "categorical_high"
    assert forced.overridden
    assert forced.inferred == "numeric_discrete"
    assert forced.confidence == 1.0


def test_confirming_the_inference_still_counts_as_a_decision() -> None:
    frame = adversarial_frame()
    verdict = inference.infer("region", frame["region"])
    confirmed = inference.apply_override(verdict, "categorical_low")
    assert confirmed.overridden
    assert confirmed.type == "categorical_low"


def test_an_unknown_override_type_is_refused() -> None:
    frame = adversarial_frame()
    verdict = inference.infer("region", frame["region"])
    with pytest.raises(InvalidRecipe, match="not a column type"):
        inference.apply_override(verdict, "categorical")


def test_preview_never_shows_nan_for_an_all_null_column() -> None:
    frame = adversarial_frame()
    assert inference.preview_values(frame["all_null"]) == []


def test_low_cardinality_needs_both_conditions() -> None:
    """Ten levels across twelve rows is nearly an identifier, not a category."""
    tiny = pd.DataFrame({"x": [f"v{i}" for i in range(10)] + ["v0", "v1"]})
    assert inference.infer("x", tiny["x"]).type != "categorical_low"

    wide = pd.DataFrame({"x": [f"v{i % 10}" for i in range(1000)]})
    assert inference.infer("x", wide["x"]).type == "categorical_low"


def test_an_empty_column_is_certain_and_everything_else_is_discounted() -> None:
    """All-null over any number of rows is a fact; the rest are inferences."""
    frame = adversarial_frame()
    assert inference.infer("all_null", frame["all_null"]).confidence == 1.0
    assert inference.infer("sparse_text", frame["sparse_text"]).confidence < 1.0
