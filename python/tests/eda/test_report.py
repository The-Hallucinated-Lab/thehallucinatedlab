"""The report: honest about sampling, honest about what it is unsure of.

Two things are load-bearing and are tested as such. A sampled report has
to say so in every place a number can be lifted from -- the idea document
is explicit that a report which does not say it sampled ends up
screenshotted into somebody's deliverable with the wrong figures on it.
And a low-confidence type has to reach the reader, not just the log.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from thehallucinatedlab.tools.eda import eda, report
from thehallucinatedlab.tools.eda.report import number, share


@pytest.fixture(scope="module")
def rendered(tmp_path_factory) -> dict:
    from conftest import simple_frame

    base = tmp_path_factory.mktemp("report")
    source = base / "sales.csv"
    simple_frame().to_csv(source, index=False)
    result = eda(source, target="churn", tier2=True, out=base / "out")
    return {"result": result, "text": result.report.read_text(encoding="utf-8")}


def test_the_report_has_the_sections_the_prd_specifies(rendered: dict) -> None:
    text = rendered["text"]
    for heading in ("# Profile of", "## Dataset overview", "## Columns",
                    "## Relationships", "## Appendix: the recipe"):
        assert heading in text, f"missing {heading!r}"


def test_the_header_names_the_source_and_the_versions(rendered: dict) -> None:
    text = rendered["text"]
    assert "| Rows |" in text and "| Columns |" in text
    assert "| Generated |" in text
    # Against the package version, not a literal. This line used to
    # read "thl eda 0.2.0" and so asserted the drift it should have
    # caught: the package was 1.0.0 and the report said otherwise.
    from thehallucinatedlab import __version__
    assert f"thl eda {__version__}" in text
    assert "pandas" in text, "the report should say what it was computed with"


def test_columns_appear_in_file_order(rendered: dict) -> None:
    text = rendered["text"]
    positions = [text.index(f"### {name}") for name in
                 ("order_id", "revenue", "quantity", "region")]
    assert positions == sorted(positions)


def test_every_figure_referenced_by_the_report_exists(rendered: dict) -> None:
    import re

    out = rendered["result"].out_dir
    for match in re.findall(r"!\[[^\]]*\]\(([^)]+)\)", rendered["text"]):
        assert (out / match).exists(), f"{match} is referenced but was not written"


def test_the_appendix_holds_a_recipe_that_parses(rendered: dict) -> None:
    text = rendered["text"]
    block = text.split("## Appendix: the recipe", 1)[1]
    body = block.split("```json", 1)[1].split("```", 1)[0]
    assert json.loads(body)["columns"]


def test_prose_is_deterministic(rendered: dict) -> None:
    """An LLM in the profiling layer would make the output
    non-reproducible, which contradicts shipping a recipe and a script."""
    from conftest import simple_frame

    # Same file name in a different directory: the report prints the name
    # in its title, and a differing title is not evidence of non-determinism.
    base = rendered["result"].out_dir.parent / "again"
    base.mkdir(exist_ok=True)
    source = base / "sales.csv"
    simple_frame().to_csv(source, index=False)
    again = eda(source, target="churn", tier2=True, out=base / "out")

    def body(path: Path) -> list[str]:
        # The prose and the numbers, which must match exactly. The header
        # carries a timestamp and a duration and the appendix carries the
        # absolute source path; all three are meant to differ.
        text = path.read_text(encoding="utf-8").split("## Appendix")[0]
        return [
            line
            for line in text.splitlines()
            if not line.startswith(("| Generated", "| Run time", "| Source"))
        ]

    assert body(again.report) == body(rendered["result"].report)


# -- sampling honesty -------------------------------------------------------


@pytest.fixture(scope="module")
def sampled(tmp_path_factory) -> dict:
    from conftest import simple_frame

    base = tmp_path_factory.mktemp("sampled")
    source = base / "big.csv"
    simple_frame(500).to_csv(source, index=False)
    result = eda(source, sample=100, seed=3, out=base / "out")
    return {"result": result, "text": result.report.read_text(encoding="utf-8")}


def test_a_sampled_report_says_so_at_the_top(sampled: dict) -> None:
    text = sampled["text"]
    banner = text.split("## Dataset overview")[0]
    assert "sample" in banner.lower()
    assert "seed 3" in banner


def test_a_sampled_report_marks_every_affected_figure(sampled: dict) -> None:
    """The note has to travel with the picture, because figures get
    copied out of reports."""
    from thehallucinatedlab.tools.eda.recipe import Recipe

    recipe = Recipe.from_file(sampled["result"].recipe)
    assert recipe.sampling["applied"] is True
    assert "sample of 100 of 500 rows" in sampled["text"]


def test_sampling_reaches_the_warnings_and_the_recipe(sampled: dict) -> None:
    assert any("sample" in warning for warning in sampled["result"].warnings)
    summary = json.loads(sampled["result"].summary.read_text(encoding="utf-8"))
    assert summary["sampling"]["applied"] is True
    assert summary["sampling"]["seed"] == 3


def test_an_unsampled_report_carries_no_banner(rendered: dict) -> None:
    assert "was built from a sample" not in rendered["text"]


# -- caveats ----------------------------------------------------------------


def test_low_confidence_types_reach_the_reader(tmp_path: Path) -> None:
    from conftest import adversarial_frame

    source = tmp_path / "adversarial.csv"
    adversarial_frame().drop(columns=["listy", "dicty"]).to_csv(source, index=False)
    result = eda(source, out=tmp_path / "out")
    text = result.report.read_text(encoding="utf-8")

    assert "## Caveats" in text
    assert "ambiguous_date" in text.split("## Dataset overview")[0]
    assert any("ambiguous_date" in warning for warning in result.warnings)
    assert "--types" in text, "the caveat should say how to fix it"


def test_a_failed_column_is_recorded_not_hidden(simple_csv: Path, tmp_path: Path) -> None:
    """A column that raises must leave a note, not a gap."""
    from thehallucinatedlab.tools.eda import runner
    from thehallucinatedlab.tools.eda.recipe import Recipe

    result = eda(simple_csv, out=tmp_path / "out")
    recipe = Recipe.from_file(result.recipe)
    plan = recipe.columns["revenue"]

    original = runner.profile_one

    def explode(frame, column_plan, options, loaded):
        if column_plan.name == "revenue":
            raise ValueError("deliberate")
        return original(frame, column_plan, options, loaded)

    runner.profile_one = explode
    try:
        broken = eda(simple_csv, out=tmp_path / "broken")
    finally:
        runner.profile_one = original

    assert "revenue" in broken.failures
    assert not broken.ok
    text = broken.report.read_text(encoding="utf-8")
    assert "deliberate" in text
    assert plan.type


# -- HTML -------------------------------------------------------------------


def test_html_is_one_file_when_self_contained(simple_csv: Path, tmp_path: Path) -> None:
    result = eda(simple_csv, format="html", self_contained=True, out=tmp_path / "out")
    text = result.report.read_text(encoding="utf-8")
    assert result.report.name == "report.html"
    assert "data:image/png;base64" in text
    assert "figures/" not in text


def test_html_links_figures_when_not_self_contained(simple_csv: Path, tmp_path: Path) -> None:
    result = eda(simple_csv, format="html", out=tmp_path / "out")
    text = result.report.read_text(encoding="utf-8")
    assert "figures/" in text
    assert "data:image/png;base64" not in text


def test_html_escapes_values_it_did_not_write(tmp_path: Path) -> None:
    """Column values come from the user's file and are not markup."""
    import pandas as pd

    source = tmp_path / "hostile.csv"
    pd.DataFrame({
        "label": ["<script>alert(1)</script>", "safe"] * 30,
        "value": list(range(60)),
    }).to_csv(source, index=False)

    result = eda(source, format="html", out=tmp_path / "out")
    text = result.report.read_text(encoding="utf-8")
    assert "<script>alert(1)</script>" not in text
    assert "&lt;script&gt;" in text


def test_markdown_escapes_a_pipe_in_a_value(tmp_path: Path) -> None:
    """One odd category name must not shift every column after it."""
    import pandas as pd

    source = tmp_path / "pipes.csv"
    pd.DataFrame({"label": ["a|b", "c"] * 30, "value": list(range(60))}).to_csv(
        source, index=False
    )
    result = eda(source, out=tmp_path / "out")
    text = result.report.read_text(encoding="utf-8")
    assert "a\\|b" in text


# -- formatting -------------------------------------------------------------


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, "—"),
        (1234, "1,234"),
        (1234.5678, "1,234.57"),
        (0.5, "0.5000"),
        (0.00012345, "0.000123"),
        (float("nan"), "—"),
        (True, "yes"),
    ],
)
def test_numbers_are_readable_without_lying_about_precision(value, expected) -> None:
    assert number(value) == expected


def test_shares_print_as_percentages() -> None:
    assert share(0.0734) == "7.34%"
    assert share(None) == "—"


def test_the_document_model_renders_to_both_formats(tmp_path: Path) -> None:
    doc = report.Document(title="t")
    doc.add(report.Heading(1, "Title"))
    doc.add(report.Para("Some `code` and **bold**."))
    doc.add(report.Table(["a", "b"], [["1", "2"]], caption="c"))
    doc.add(report.Callout("warning", "Careful", ["line one"]))
    doc.add(report.Bullets(["one", "two"]))
    doc.add(report.Code("{}", lang="json"))

    markdown = report.render_markdown(doc, tmp_path)
    assert "# Title" in markdown and "| a | b |" in markdown and "- one" in markdown

    html = report.render_html(doc, tmp_path)
    assert "<h1" in html and "<table>" in html and "<code>code</code>" in html
    assert "<strong>bold</strong>" in html
