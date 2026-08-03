"""Intent parsing for THL tools.

A port of ``nlp.js`` from the website, rule for rule. Both sides run the
shared cases in ``spec/nlp-fixtures.json``, so if one learns a phrasing
the other does not, both test suites fail.

Not a language model, on purpose. Turning "make it a jpg at 80 quality"
into a call is intent classification plus slot filling: bounded, solved,
and far better served by rules that run instantly and can be tested than
by weights that cannot.

The parser reports what was *said*. Bounds are enforced afterwards by
:meth:`Registry.validate`, so "quality 200" parses to 200 and is
rejected at validation rather than silently clamped to 100.
"""

from __future__ import annotations

import math
import re
from typing import Any

from ..registry import registry

__all__ = ["parse", "merge_answer", "tokenize", "normalize"]

# A preposition here means the format that follows it is the target:
# "png to webp" wants webp, not png. Without one, the last format wins.
_DIRECTIONAL = ("to", "into", "as")

# Deliberately small. A full CSS colour table would be mostly dead weight
# for a flatten-the-alpha setting, and every extra name is a name the
# parser could misfire on.
_NAMED_COLORS = {
    "black": "#000000",
    "white": "#ffffff",
    "gray": "#808080",
    "grey": "#808080",
}

# Hex first so "#f00" survives as one token. Numbers keep a trailing % so
# "50%" reads as an explicit quality cue while a bare "50" does not.
_TOKEN_RE = re.compile(r"#[0-9a-f]{3,8}|[a-z]+|\d+%?")
_NUMBER_RE = re.compile(r"^(\d+)%?$")
_PERCENT_RE = re.compile(r"^\d+%$")
_SHORT_HEX_RE = re.compile(r"^#([0-9a-f]{3})$")
_LONG_HEX_RE = re.compile(r"^#([0-9a-f]{6})$")


def normalize(text: Any) -> str:
    if text is None:
        return ""
    return str(text).lower().strip()


def tokenize(text: Any) -> list[str]:
    return _TOKEN_RE.findall(normalize(text))


def expand_hex(token: str) -> str | None:
    short = _SHORT_HEX_RE.match(token)
    if short:
        return "#" + "".join(c * 2 for c in short.group(1))
    long = _LONG_HEX_RE.match(token)
    return "#" + long.group(1) if long else None


def _numeric(token: str) -> int | None:
    match = _NUMBER_RE.match(token)
    return int(match.group(1)) if match else None


def _enum_vocabulary(param: dict[str, Any]) -> dict[str, str]:
    vocab = {value: value for value in param.get("values", [])}
    vocab.update(param.get("aliases", {}))
    return vocab


def _enum_params(tool: dict[str, Any]) -> list[dict[str, Any]]:
    return [p for p in tool.get("params", []) if p.get("type") == "enum"]


def _score_tool(
    tool: dict[str, Any], norm: str, tokens: list[str], weights: dict[str, Any]
) -> float:
    """Additive weights, capped at 1.

    Tuned so a lone action word cannot match: "convert 100 usd to eur"
    scores 0.4 and falls through to chat, while "convert image" reaches
    0.6 and asks which format.
    """
    present = set(tokens)
    score = 0.0

    for param in _enum_params(tool):
        vocab = _enum_vocabulary(param)
        if any(token in vocab for token in tokens):
            score += weights.get("enumValue", 0)
            break

    if any(alias in norm for alias in tool.get("aliases", [])):
        score += weights.get("aliasPhrase", 0)

    keywords = tool.get("keywords", {})
    if present & set(keywords.get("action", [])):
        score += weights.get("actionKeyword", 0)
    if present & set(keywords.get("subject", [])):
        score += weights.get("subjectKeyword", 0)

    return min(1.0, score)


def _resolve_enum(param: dict[str, Any], tokens: list[str]) -> dict[str, Any] | None:
    vocab = _enum_vocabulary(param)
    hits = []
    last_directional = -1

    for index, token in enumerate(tokens):
        if token in vocab:
            hits.append({"index": index, "value": vocab[token]})
        if token in _DIRECTIONAL:
            last_directional = index

    if not hits:
        return None

    if last_directional != -1:
        for hit in hits:
            if hit["index"] > last_directional:
                return hit
    return hits[-1]


def _resolve_integer(
    param: dict[str, Any], tokens: list[str], format_index: int
) -> int | None:
    """Explicit cues beat position.

    The bare-number rule is last and only looks after the format token,
    which is what stops "convert 2 images to png" reading 2 as a quality.
    """
    keywords = param.get("keywords", [])

    for i in range(len(tokens) - 1):
        if tokens[i] in keywords:
            value = _numeric(tokens[i + 1])
            if value is not None:
                return value

    for i in range(1, len(tokens)):
        if tokens[i] in keywords:
            value = _numeric(tokens[i - 1])
            if value is not None:
                return value

    for i in range(len(tokens) - 1):
        if tokens[i] == "at":
            value = _numeric(tokens[i + 1])
            if value is not None:
                return value

    for token in tokens:
        if _PERCENT_RE.match(token):
            return _numeric(token)

    if format_index >= 0:
        for token in tokens[format_index + 1 :]:
            value = _numeric(token)
            if value is not None:
                return value

    return None


def _resolve_color(param: dict[str, Any], tokens: list[str]) -> str | None:
    """A hex code anywhere is unambiguous.

    A colour *name* only counts next to one of the parameter's own
    keywords, so "a black and white photo to png" does not quietly set a
    background.
    """
    for token in tokens:
        hex_value = expand_hex(token)
        if hex_value:
            return hex_value

    keywords = param.get("keywords", [])
    for index, token in enumerate(tokens):
        if token not in keywords:
            continue
        for neighbour in (index - 1, index + 1, index - 2):
            if 0 <= neighbour < len(tokens) and tokens[neighbour] in _NAMED_COLORS:
                return _NAMED_COLORS[tokens[neighbour]]
    return None


def _fill_slots(tool: dict[str, Any], tokens: list[str]) -> dict[str, Any]:
    args: dict[str, Any] = {}
    format_index = -1

    # Enums first: their position anchors the bare-number rule.
    for param in tool.get("params", []):
        if param.get("type") != "enum":
            continue
        hit = _resolve_enum(param, tokens)
        if hit:
            args[param["name"]] = hit["value"]
            if format_index < 0:
                format_index = hit["index"]

    for param in tool.get("params", []):
        ptype = param.get("type")
        if ptype == "integer":
            value = _resolve_integer(param, tokens, format_index)
            if value is not None:
                args[param["name"]] = value
        elif ptype == "color":
            colour = _resolve_color(param, tokens)
            if colour is not None:
                args[param["name"]] = colour

    return args


def _missing_for(tool: dict[str, Any], args: dict[str, Any]) -> list[str]:
    params = tool.get("params", [])
    return [p["name"] for p in params if p.get("required") and p["name"] not in args]


def _blank() -> dict[str, Any]:
    return {"tool": None, "args": {}, "missing": [], "confidence": 0}


def parse(text: Any, manifest: dict[str, Any] | None = None) -> dict[str, Any]:
    """Turn an utterance into ``{tool, args, missing, confidence}``.

    ``tool`` is None when nothing cleared the confidence threshold, which
    is the caller's signal to treat the message as ordinary conversation.

    Example:
        >>> parse("make it a jpg at 80 quality")["args"]
        {'format': 'jpeg', 'quality': 80}
    """
    spec = manifest if manifest is not None else registry.manifest
    tools = spec.get("tools", [])
    if not tools:
        return _blank()

    norm = normalize(text)
    tokens = tokenize(norm)
    if not tokens:
        return _blank()

    weights = spec.get("scoring", {})
    best = None
    best_score = 0.0

    for tool in tools:
        score = _score_tool(tool, norm, tokens, weights)
        if score > best_score:
            best_score = score
            best = tool

    if best is None or best_score < weights.get("threshold", 1):
        return _blank()

    args = _fill_slots(best, tokens)
    return {
        "tool": best["name"],
        "args": args,
        "missing": _missing_for(best, args),
        # Match JavaScript's half-up rounding rather than Python's
        # banker's rounding, so both ports report the same number.
        "confidence": math.floor(best_score * 100 + 0.5) / 100,
    }


def merge_answer(
    pending: dict[str, Any], text: Any, manifest: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Fold a follow-up reply into a parse that stalled on a missing slot.

    Lets "convert this" -> "which format?" -> "png" complete the original
    request instead of starting a new one.
    """
    spec = manifest if manifest is not None else registry.manifest
    if not pending or not pending.get("tool"):
        return parse(text, spec)

    tool = next((t for t in spec.get("tools", []) if t["name"] == pending["tool"]), None)
    if tool is None:
        return parse(text, spec)

    args = dict(pending.get("args", {}))
    args.update(_fill_slots(tool, tokenize(text)))

    return {
        "tool": tool["name"],
        "args": args,
        "missing": _missing_for(tool, args),
        "confidence": pending.get("confidence", 0),
    }
