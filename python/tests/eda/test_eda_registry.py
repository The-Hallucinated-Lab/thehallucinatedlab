"""The catalogue: implemented, selectable, and matching PRD section 9.

Definition of done, item 3. The registry is what the chart screen, the
``--charts`` flag, a default run and the generated script all read, so a
row that names a function nobody wrote breaks four things at once and is
worth a test that names it precisely.
"""

from __future__ import annotations

import pytest
from conftest import adversarial_frame

from thehallucinatedlab.tools.eda import inference, registry
from thehallucinatedlab.tools.eda.errors import UnsupportedColumnType
from thehallucinatedlab.tools.eda.figures import FigureSink
from thehallucinatedlab.tools.eda.types import COLUMN_TYPES

ALL_SPECS = registry.CHARTS + registry.SUMMARIES


@pytest.mark.parametrize("spec", ALL_SPECS, ids=lambda s: f"{s.fn}")
def test_every_entry_has_an_implementation(spec) -> None:
    assert callable(registry.implementation(spec))


@pytest.mark.parametrize("spec", registry.RELATIONS, ids=lambda s: s.name)
def test_every_relation_has_an_implementation(spec) -> None:
    assert callable(registry.implementation(spec))


@pytest.mark.parametrize("spec", ALL_SPECS, ids=lambda s: f"{s.name}-{s.fn}")
def test_every_entry_applies_to_real_types(spec) -> None:
    assert spec.types, f"{spec.name} applies to nothing"
    for kind in spec.types:
        assert kind in COLUMN_TYPES, f"{spec.name} claims unknown type {kind}"
    for kind in spec.default_for:
        assert kind in spec.types, f"{spec.name} is default for a type it does not apply to"


@pytest.mark.parametrize("spec", ALL_SPECS, ids=lambda s: f"{s.name}-{s.fn}")
def test_every_declared_option_exists(spec) -> None:
    for option in spec.options:
        assert option in registry.DEFAULT_OPTIONS, f"{spec.name} wants unknown option {option}"


@pytest.mark.parametrize("kind", COLUMN_TYPES)
def test_every_type_can_be_summarised(kind: str) -> None:
    """Even the degenerate ones. One line of text is still an answer."""
    assert registry.default_summaries(kind), f"{kind} has no default summary"


@pytest.mark.parametrize("kind", COLUMN_TYPES)
def test_inert_types_offer_no_charts(kind: str) -> None:
    """Identifiers, constants and empty columns get text, not figures."""
    if kind in ("identifier", "constant", "empty", "unsupported"):
        assert registry.charts_for(kind) == []
    else:
        assert registry.charts_for(kind), f"{kind} has nothing to plot"


def test_the_default_categorical_chart_is_a_bar_not_a_pie() -> None:
    """People compare lengths well and angles badly; both stay available."""
    defaults = registry.default_charts("categorical_low")
    assert "hbar" in defaults
    assert "pie" not in defaults
    assert "pie" in [spec.name for spec in registry.charts_for("categorical_low")]


def test_a_histogram_is_not_the_default_for_a_set_of_codes() -> None:
    assert "histogram" in registry.default_charts("numeric_continuous")
    assert "histogram" not in registry.default_charts("numeric_discrete")
    assert "count_bar" in registry.default_charts("numeric_discrete")


def test_target_charts_are_only_default_when_there_is_a_target() -> None:
    assert "stacked_vs_target" not in registry.default_charts("categorical_low")
    assert "stacked_vs_target" in registry.default_charts("categorical_low", has_target=True)


def test_a_chart_on_the_wrong_type_is_refused_by_name() -> None:
    with pytest.raises(UnsupportedColumnType, match="does not apply"):
        registry.chart("hbar", "numeric_continuous")
    with pytest.raises(UnsupportedColumnType, match="No chart named"):
        registry.chart("sunburst")


def test_tier2_aliases_match_the_documented_flag() -> None:
    assert registry.expand_tier2(["all"]) == registry.relation_names()
    assert registry.expand_tier2(["corr", "missing"]) == ["correlation", "missingness"]
    with pytest.raises(UnsupportedColumnType):
        registry.expand_tier2(["nonsense"])


def test_option_values_only_passes_what_a_spec_declared() -> None:
    """Adding a run option must not break an existing implementation."""
    spec = registry.summary("outliers")
    values = registry.option_values(spec, {"top_n": 3, "outlier_rule": "zscore", "extra": 1})
    assert values == {"outlier_rule": "zscore"}


def test_the_outlier_rule_travels_with_the_count() -> None:
    """A count with no rule attached is not a statistic."""
    from thehallucinatedlab.tools.eda.summaries import summary_outliers

    frame = adversarial_frame()
    for rule in registry.OUTLIER_RULES:
        result = summary_outliers(frame["revenue"], outlier_rule=rule)
        assert result["rule"], "the rule must ship with the number"
        assert {"count", "share", "lower", "upper"} <= set(result)


@pytest.mark.parametrize("spec", ALL_SPECS, ids=lambda s: f"{s.name}-{s.fn}")
def test_every_entry_runs_on_a_real_column(spec, tmp_path) -> None:
    """Independently selectable means independently runnable.

    Each entry is exercised against a column of a type it claims, drawn
    from the adversarial fixture rather than from something convenient.
    """
    frame = adversarial_frame()
    verdicts = {
        name: inference.infer(name, frame[name], n_rows=len(frame)) for name in frame.columns
    }

    for kind in spec.types:
        column = next((name for name, v in verdicts.items() if v.type == kind), None)
        if column is None:
            continue
        options = {**registry.DEFAULT_OPTIONS, "date_format": verdicts[column].meta.get("format")}
        fn = registry.implementation(spec)
        kwargs = registry.option_values(spec, options)

        if spec in registry.SUMMARIES:
            fn(frame[column], **kwargs)
            continue

        sink = FigureSink(tmp_path / kind)
        target = frame["region"]
        figure = (
            fn(frame[column], target, title="t", caption="c", **kwargs)
            if spec.needs_target
            else fn(frame[column], title="t", caption="c", **kwargs)
        )
        result = sink.save(figure, chart=spec.name, column=column)
        assert result.path.exists() and result.path.stat().st_size > 0
