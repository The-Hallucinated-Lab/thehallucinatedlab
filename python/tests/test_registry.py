"""Registry behaviour: what the manifest says, the package enforces."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from thehallucinatedlab import (
    InvalidArgument,
    MissingArgument,
    Registry,
    ToolNotFound,
    __version__,
    registry,
)


def test_the_toolkit_knows_its_tools():
    assert "convert" in registry.names()
    assert registry.describe("convert")["title"] == "Convert"


def test_an_unknown_tool_names_the_ones_that_exist():
    with pytest.raises(ToolNotFound) as err:
        registry.describe("image_resize")
    assert "convert" in str(err.value)


def test_defaults_come_from_the_manifest():
    cleaned = registry.validate("convert", format="png")
    assert cleaned == {"format": "png", "quality": 92, "background": "#ffffff"}


def test_a_missing_required_argument_points_at_the_docs():
    with pytest.raises(MissingArgument) as err:
        registry.validate("convert", quality=80)
    assert "format" in str(err.value)
    assert "thehallucinatedlab.space" in str(err.value)


@pytest.mark.parametrize(
    ("supplied", "expected"),
    [("jpg", "jpeg"), ("JPG", "jpeg"), (" jfif ", "jpeg"), ("PNG", "png")],
)
def test_enum_aliases_resolve_to_the_canonical_value(supplied, expected):
    assert registry.validate("convert", format=supplied)["format"] == expected


def test_an_unknown_format_lists_the_real_ones():
    with pytest.raises(InvalidArgument) as err:
        registry.validate("convert", format="tiff")
    assert "png, jpeg, webp, avif" in str(err.value)


@pytest.mark.parametrize("quality", [0, 101, 200, -5])
def test_quality_bounds_are_enforced(quality):
    with pytest.raises(InvalidArgument):
        registry.validate("convert", format="jpeg", quality=quality)


@pytest.mark.parametrize("quality", [1, 50, 100])
def test_quality_inside_the_bounds_is_accepted(quality):
    assert registry.validate("convert", format="jpeg", quality=quality)["quality"] == quality


def test_a_boolean_is_not_a_quality():
    """bool subclasses int in Python; True must not pass as quality 1."""
    with pytest.raises(InvalidArgument):
        registry.validate("convert", format="jpeg", quality=True)


@pytest.mark.parametrize(
    ("supplied", "expected"),
    [("#f00", "#ff0000"), ("#ABCDEF", "#abcdef"), ("#ffffff", "#ffffff")],
)
def test_colours_are_normalised(supplied, expected):
    got = registry.validate("convert", format="jpeg", background=supplied)
    assert got["background"] == expected


@pytest.mark.parametrize("colour", ["red", "ffffff", "#gg0000", "#ffff"])
def test_a_colour_that_is_not_hex_is_rejected(colour):
    with pytest.raises(InvalidArgument):
        registry.validate("convert", format="jpeg", background=colour)


def test_a_misspelled_argument_is_an_error_not_a_silent_no_op():
    with pytest.raises(InvalidArgument) as err:
        registry.validate("convert", format="png", qualty=80)
    assert "qualty" in str(err.value)


def test_every_problem_is_reported_at_once():
    with pytest.raises(InvalidArgument) as err:
        registry.validate("convert", quality=999, background="octarine")
    message = str(err.value)
    assert "quality" in message
    assert "background" in message
    assert "format" in message


def test_json_schema_mirrors_the_manifest():
    schema = registry.json_schema("convert")
    assert schema["required"] == ["format"]
    assert schema["properties"]["format"]["enum"] == ["png", "jpeg", "webp", "avif"]
    assert schema["properties"]["quality"]["minimum"] == 1
    assert schema["properties"]["quality"]["maximum"] == 100
    assert schema["properties"]["quality"]["default"] == 92
    assert schema["additionalProperties"] is False


def test_tool_definitions_are_function_calling_shaped():
    """For anyone wiring the toolkit into their own agent."""
    definitions = registry.tool_definitions()
    assert len(definitions) == len(registry.names())
    fn = definitions[0]["function"]
    assert definitions[0]["type"] == "function"
    assert fn["name"] == "convert"
    assert fn["parameters"]["properties"]["format"]["enum"]


def test_running_an_unimplemented_tool_says_so():
    lonely = Registry()
    with pytest.raises(ToolNotFound) as err:
        lonely.run("convert")
    assert "no implementation" in str(err.value)


def test_the_packaged_spec_matches_the_repository_spec(repo_manifest):
    """Same assertion as test/manifest.test.js, from the other side."""
    assert registry.manifest == repo_manifest


def test_the_version_is_declared_once(repo_manifest):
    pyproject = Path(__file__).resolve().parents[1] / "pyproject.toml"
    text = pyproject.read_text("utf-8")
    assert f'version = "{__version__}"' in text
    assert repo_manifest["version"] == __version__


def test_every_manifest_tool_documents_itself():
    """Guard for tool #2: the website renders these fields verbatim."""
    for name in registry.names():
        tool = registry.describe(name)
        for field in ("title", "summary", "description", "page", "aliases", "keywords"):
            assert tool.get(field), f"{name} is missing {field}"
        for param in tool["params"]:
            assert param.get("description"), f"{name}.{param['name']} has no description"
            # Mirrors the same gate in test/manifest.test.js. A type only
            # belongs here once toolkit.js and registry.py both enforce
            # it, or the website accepts an argument the package rejects.
            assert param.get("type") in {
                "enum",
                "integer",
                "color",
                "string",
                "path",
                "boolean",
                "number",
            }, f"{name}.{param['name']} is type {param.get('type')!r}"
        assert json.dumps(tool)  # nothing unserialisable leaked in
