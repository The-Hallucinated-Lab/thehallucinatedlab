"""The param types the RAG toolchain added.

The Python twin of test/param-types.test.js. Both files assert the same
behaviours against the same synthetic tool, because the manifest is one
file: a type the browser accepts and Python rejects is a tool that works
on the website and fails in a script.

Synthetic rather than the real manifest on purpose -- the subject is the
type system, not whichever tool currently happens to declare a boolean.
"""

from __future__ import annotations

import pytest

from thehallucinatedlab import InvalidArgument, MissingArgument, Registry

MANIFEST = {
    "version": "test",
    "tools": [
        {
            "name": "synthetic",
            "title": "Synthetic",
            "page": "tools.html",
            "params": [
                {"name": "title", "type": "string", "required": True},
                {
                    "name": "slug",
                    "type": "string",
                    "required": False,
                    "default": "notes",
                    "pattern": "[a-z0-9-]+",
                    "maxLength": 12,
                },
                {"name": "source", "type": "path", "required": True},
                {"name": "tables", "type": "boolean", "required": False, "default": True},
                {
                    "name": "overlap",
                    "type": "number",
                    "required": False,
                    "default": 0.25,
                    "min": 0,
                    "max": 1,
                },
            ],
        }
    ],
}

registry = Registry(MANIFEST)


def check(**extra):
    """Validate with the two required arguments already supplied."""
    args = {"title": "Report", "source": "a.pdf"}
    args.update(extra)
    return registry.validate("synthetic", **args)


# -- string ---------------------------------------------------------


def test_a_string_is_accepted_and_trimmed():
    assert check(title="  Report  ")["title"] == "Report"


def test_a_required_string_cannot_be_whitespace_only():
    # "   " is not blank, so it reaches the type branch -- the only thing
    # standing between it and a document titled with three spaces.
    with pytest.raises(InvalidArgument) as err:
        registry.validate("synthetic", title="   ", source="a.pdf")
    assert "title" in str(err.value)


def test_a_string_pattern_is_anchored():
    assert check(slug="my-notes")["slug"] == "my-notes"
    for rejected in ("My Notes", "NOT_ok!"):
        with pytest.raises(InvalidArgument):
            check(slug=rejected)


def test_max_length_is_enforced():
    assert check(slug="a" * 12)["slug"] == "a" * 12
    with pytest.raises(InvalidArgument):
        check(slug="a" * 13)


# -- path -----------------------------------------------------------


def test_a_missing_path_is_reported_as_missing():
    with pytest.raises(MissingArgument) as err:
        registry.validate("synthetic", title="Report")
    assert "source" in str(err.value)


# -- boolean --------------------------------------------------------


@pytest.mark.parametrize("supplied", [True, "true", "TRUE", "yes", "on", "1"])
def test_truthy_spellings(supplied):
    assert check(tables=supplied)["tables"] is True


@pytest.mark.parametrize("supplied", [False, "false", "FALSE", "no", "off", "0"])
def test_falsy_spellings(supplied):
    assert check(tables=supplied)["tables"] is False


def test_an_explicit_false_is_kept_not_overwritten_by_the_default():
    # If False were read as "not supplied", a boolean defaulting to True
    # could never be turned off.
    assert check(tables=False)["tables"] is False


def test_a_boolean_that_is_neither_is_an_error_not_a_silent_false():
    with pytest.raises(InvalidArgument) as err:
        check(tables="maybe")
    assert "true or false" in str(err.value)


# -- number ---------------------------------------------------------


def test_a_number_accepts_fractions_unlike_integer():
    assert check(overlap=0.15)["overlap"] == 0.15


@pytest.mark.parametrize("supplied", [0, 1, 0.5])
def test_numbers_inside_the_bounds_are_accepted(supplied):
    assert check(overlap=supplied)["overlap"] == float(supplied)


@pytest.mark.parametrize("supplied", [-0.1, 1.1])
def test_number_bounds_are_enforced_at_both_ends(supplied):
    with pytest.raises(InvalidArgument):
        check(overlap=supplied)


def test_a_non_numeric_value_is_rejected():
    with pytest.raises(InvalidArgument) as err:
        check(overlap="loads")
    assert "must be a number" in str(err.value)


def test_a_bool_is_not_a_number():
    # bool subclasses int in Python, so True would otherwise validate as
    # 1.0 and sail through the bounds check.
    with pytest.raises(InvalidArgument):
        check(overlap=True)


# -- unknown --------------------------------------------------------


def test_an_unrecognised_type_is_an_error_not_an_unchecked_passthrough():
    # Before this, the final `else` assigned the value unvalidated, so a
    # typo like "boolena" produced an argument nothing checked.
    typo = Registry(
        {
            "version": "test",
            "tools": [
                {
                    "name": "typo",
                    "title": "Typo",
                    "page": "tools.html",
                    "params": [{"name": "n", "type": "boolena", "required": True}],
                }
            ],
        }
    )
    with pytest.raises(InvalidArgument) as err:
        typo.validate("typo", n="anything")
    assert "unknown type" in str(err.value)


# -- defaults -------------------------------------------------------


def test_defaults_are_filled_in_for_every_new_type():
    cleaned = check()
    assert cleaned["slug"] == "notes"
    assert cleaned["tables"] is True
    assert cleaned["overlap"] == 0.25


# -- schema ---------------------------------------------------------


def test_the_json_schema_carries_the_new_types_and_their_constraints():
    schema = registry.json_schema("synthetic")
    props = schema["properties"]
    assert props["title"]["type"] == "string"
    assert props["source"]["type"] == "string"
    assert props["tables"]["type"] == "boolean"
    assert props["overlap"]["type"] == "number"
    assert props["overlap"]["minimum"] == 0
    assert props["overlap"]["maximum"] == 1
    assert props["slug"]["pattern"] == "[a-z0-9-]+"
    assert props["slug"]["maxLength"] == 12
    assert sorted(schema["required"]) == ["source", "title"]
