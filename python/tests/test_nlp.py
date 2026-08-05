"""The Python half of the shared parser contract.

test/nlp.test.js runs this same fixture file against nlp.js. That is the
only thing stopping the two implementations from drifting, so if you are
tempted to special-case a fixture here instead of fixing the parser,
don't -- the website would then behave differently from the package.
"""

from __future__ import annotations

from thehallucinatedlab import merge_answer, parse
from thehallucinatedlab.nlp import expand_hex, tokenize


def test_every_shared_fixture_parses_to_the_agreed_result(nlp_fixtures, repo_manifest):
    for case in nlp_fixtures["cases"]:
        got = parse(case["input"], repo_manifest)
        expected = case["expect"]
        assert got["tool"] == expected["tool"], f"tool mismatch for {case['input']!r}"
        assert got["args"] == expected["args"], f"args mismatch for {case['input']!r}"
        assert got["missing"] == expected["missing"], f"missing mismatch for {case['input']!r}"


def test_confidence_stays_in_range_and_clears_the_threshold(nlp_fixtures, repo_manifest):
    threshold = repo_manifest["scoring"]["threshold"]
    for case in nlp_fixtures["cases"]:
        got = parse(case["input"], repo_manifest)
        assert got["confidence"] <= 1
        if case["expect"]["tool"] is not None:
            assert got["confidence"] >= threshold


def test_the_bundled_manifest_parses_the_same_as_the_repository_one(nlp_fixtures):
    """The package defaults to its own copy of the spec; it must agree."""
    for case in nlp_fixtures["cases"]:
        got = parse(case["input"])
        assert got["tool"] == case["expect"]["tool"], case["input"]
        assert got["args"] == case["expect"]["args"], case["input"]


def test_tokenizer_keeps_hex_and_percentages_intact():
    assert tokenize("#f00 and #123456") == ["#f00", "and", "#123456"]
    assert tokenize("quality=60") == ["quality", "60"]
    assert tokenize("at 50%") == ["at", "50%"]


def test_short_hex_expands():
    assert expand_hex("#f00") == "#ff0000"
    assert expand_hex("#123456") == "#123456"
    assert expand_hex("png") is None


def test_a_follow_up_completes_a_stalled_parse():
    pending = parse("convert this image")
    assert pending["missing"] == ["format"]

    merged = merge_answer(pending, "png")
    assert merged["tool"] == "convert"
    assert merged["args"] == {"format": "png"}
    assert merged["missing"] == []


def test_a_follow_up_keeps_arguments_already_gathered():
    pending = parse("convert my photo at 70 quality")
    assert pending["args"] == {"quality": 70}

    merged = merge_answer(pending, "jpg")
    assert merged["args"] == {"format": "jpeg", "quality": 70}


def test_junk_input_is_not_a_tool_request():
    for junk in [None, "", "   ", 12345, {}, []]:
        got = parse(junk)
        assert got["tool"] is None
        assert got["args"] == {}


def test_the_parser_reports_what_was_said_not_what_is_legal():
    """Clamping here would silently ignore the request; validation rejects it later."""
    assert parse("convert to jpeg quality 200")["args"]["quality"] == 200
