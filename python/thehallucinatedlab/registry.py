"""The tool registry.

Everything the toolkit knows about its own tools -- names, arguments,
bounds, defaults, the vocabulary the parser matches on -- comes from
``data/manifest.json``. That file is a copy of ``spec/manifest.json`` at
the repository root, which is also what the website reads to build the
convert UI and the argument reference table. A Node test asserts the
two copies are byte-identical, so the documentation on the site cannot
describe arguments this package does not accept.

Practically: to add a tool, add a manifest entry and an implementation.
Nothing here needs editing.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from importlib import resources
from typing import Any

from .errors import InvalidArgument, MissingArgument, ToolNotFound

_JSON_TYPES = {
    "enum": "string",
    "integer": "integer",
    "color": "string",
}


def load_manifest() -> dict[str, Any]:
    """Read the bundled tool spec."""
    text = resources.files("thehallucinatedlab").joinpath("data/manifest.json").read_text("utf-8")
    return json.loads(text)


def _enum_vocabulary(param: dict[str, Any]) -> dict[str, str]:
    """Every accepted spelling mapped to the canonical value ('jpg' -> 'jpeg')."""
    vocab = {value: value for value in param.get("values", [])}
    vocab.update(param.get("aliases", {}))
    return vocab


def _normalize_hex(value: Any) -> str | None:
    text = str(value).strip().lower()
    if len(text) == 4 and text[0] == "#":
        digits = text[1:]
        if all(c in "0123456789abcdef" for c in digits):
            return "#" + "".join(c * 2 for c in digits)
    if len(text) == 7 and text[0] == "#":
        digits = text[1:]
        if all(c in "0123456789abcdef" for c in digits):
            return text
    return None


def _is_blank(value: Any) -> bool:
    return value is None or value == ""


class Registry:
    """Reads the manifest and enforces it.

    The same instance backs the public helpers, the CLI and the natural
    language parser, so all three agree on what an argument means.
    """

    def __init__(self, manifest: dict[str, Any] | None = None) -> None:
        self._manifest = manifest if manifest is not None else load_manifest()
        self._implementations: dict[str, Callable[..., Any]] = {}

    @property
    def manifest(self) -> dict[str, Any]:
        return self._manifest

    @property
    def version(self) -> str:
        return str(self._manifest.get("version", "0"))

    def names(self) -> list[str]:
        """Every tool in the toolkit."""
        return [tool["name"] for tool in self._manifest.get("tools", [])]

    def describe(self, name: str) -> dict[str, Any]:
        """The raw spec for one tool -- the same object the website renders."""
        for tool in self._manifest.get("tools", []):
            if tool["name"] == name:
                return tool
        raise ToolNotFound(
            f"No tool named {name!r}. Available: {', '.join(self.names()) or 'none'}."
        )

    def register(self, name: str, fn: Callable[..., Any]) -> None:
        """Attach an implementation to a manifest entry."""
        self.describe(name)  # raises if the manifest does not declare it
        self._implementations[name] = fn

    def run(self, name: str, *args: Any, **kwargs: Any) -> Any:
        impl = self._implementations.get(name)
        if impl is None:
            raise ToolNotFound(f"Tool {name!r} is declared but has no implementation installed.")
        return impl(*args, **kwargs)

    # -- validation -------------------------------------------------

    def validate(self, name: str, **args: Any) -> dict[str, Any]:
        """Check arguments against the manifest and fill in defaults.

        Collects every problem before raising rather than stopping at the
        first, so a caller fixing a call does not have to discover the
        mistakes one run at a time.
        """
        tool = self.describe(name)
        params = tool.get("params", [])
        cleaned: dict[str, Any] = {}
        errors: list[str] = []
        missing: list[str] = []
        known = set()

        for param in params:
            pname = param["name"]
            known.add(pname)
            value = args.get(pname)

            if _is_blank(value):
                if param.get("required"):
                    missing.append(pname)
                elif "default" in param:
                    cleaned[pname] = param["default"]
                continue

            ptype = param.get("type")

            if ptype == "enum":
                vocab = _enum_vocabulary(param)
                key = str(value).strip().lower()
                if key in vocab:
                    cleaned[pname] = vocab[key]
                else:
                    allowed = ", ".join(param.get("values", []))
                    errors.append(f"{pname} must be one of {allowed}; got {value!r}.")

            elif ptype == "integer":
                # bool is an int subclass in Python; True is not a quality.
                if isinstance(value, bool) or not isinstance(value, int):
                    errors.append(f"{pname} must be a whole number; got {value!r}.")
                elif ("min" in param and value < param["min"]) or (
                    "max" in param and value > param["max"]
                ):
                    bounds = f"{param['min']} and {param['max']}"
                    errors.append(f"{pname} must be between {bounds}.")
                else:
                    cleaned[pname] = value

            elif ptype == "color":
                normalized = _normalize_hex(value)
                if normalized is None:
                    errors.append(f"{pname} must be a hex colour such as #ffffff; got {value!r}.")
                else:
                    cleaned[pname] = normalized

            else:
                cleaned[pname] = value

        for supplied in args:
            if supplied not in known and not _is_blank(args[supplied]):
                errors.append(f"{name} has no argument {supplied!r}. Accepts: {', '.join(known)}.")

        if errors:
            if missing:
                errors.append(f"missing required argument(s): {', '.join(missing)}.")
            raise InvalidArgument(" ".join(errors))
        if missing:
            raise MissingArgument(
                f"{name} needs {', '.join(missing)}. See "
                f"https://thehallucinatedlab.space/{tool.get('page', '')}"
            )

        return cleaned

    # -- schema emission --------------------------------------------

    def json_schema(self, name: str) -> dict[str, Any]:
        """A JSON Schema for the tool's arguments."""
        tool = self.describe(name)
        properties: dict[str, Any] = {}
        required: list[str] = []

        for param in tool.get("params", []):
            entry: dict[str, Any] = {
                "type": _JSON_TYPES.get(param.get("type", ""), "string"),
                "description": param.get("description", ""),
            }
            if param.get("type") == "enum":
                entry["enum"] = list(param.get("values", []))
            if param.get("type") == "integer":
                if "min" in param:
                    entry["minimum"] = param["min"]
                if "max" in param:
                    entry["maximum"] = param["max"]
            if "default" in param:
                entry["default"] = param["default"]
            properties[param["name"]] = entry
            if param.get("required"):
                required.append(param["name"])

        return {
            "$schema": "https://json-schema.org/draft-07/schema#",
            "title": tool.get("title", name),
            "description": tool.get("description", tool.get("summary", "")),
            "type": "object",
            "properties": properties,
            "required": required,
            "additionalProperties": False,
        }

    def tool_definition(self, name: str) -> dict[str, Any]:
        """The OpenAI / Ollama function-calling shape for this tool.

        The site itself does not need this -- it parses intent directly --
        but anyone wiring the toolkit into their own agent does, and
        deriving it here keeps them from hand-writing a schema that drifts.
        """
        tool = self.describe(name)
        schema = self.json_schema(name)
        schema.pop("$schema", None)
        schema.pop("title", None)
        return {
            "type": "function",
            "function": {
                "name": name,
                "description": tool.get("summary", ""),
                "parameters": schema,
            },
        }

    def tool_definitions(self) -> list[dict[str, Any]]:
        return [self.tool_definition(name) for name in self.names()]


registry = Registry()
