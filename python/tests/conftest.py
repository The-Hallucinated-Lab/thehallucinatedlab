"""Shared fixtures.

The NLP cases live at the repository root rather than inside the package
because the JavaScript suite runs the identical file. Tests that need
them are skipped rather than failed when the package is being tested
from an installed wheel, where the repository is not around.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from PIL import Image


def _find_repo_file(relative: str) -> Path | None:
    for parent in Path(__file__).resolve().parents:
        candidate = parent / relative
        if candidate.is_file():
            return candidate
    return None


@pytest.fixture(scope="session")
def nlp_fixtures() -> dict[str, Any]:
    path = _find_repo_file("spec/nlp-fixtures.json")
    if path is None:
        pytest.skip("spec/nlp-fixtures.json is only present in a source checkout")
    return json.loads(path.read_text("utf-8"))


@pytest.fixture(scope="session")
def extract_fixtures() -> dict[str, Any]:
    path = _find_repo_file("spec/extract-fixtures.json")
    if path is None:
        pytest.skip("spec/extract-fixtures.json is only present in a source checkout")
    return json.loads(path.read_text("utf-8"))


@pytest.fixture(scope="session")
def chunk_fixtures() -> dict[str, Any]:
    path = _find_repo_file("spec/chunk-fixtures.json")
    if path is None:
        pytest.skip("spec/chunk-fixtures.json is only present in a source checkout")
    return json.loads(path.read_text("utf-8"))


@pytest.fixture(scope="session")
def repo_manifest() -> dict[str, Any]:
    path = _find_repo_file("spec/manifest.json")
    if path is None:
        pytest.skip("spec/manifest.json is only present in a source checkout")
    return json.loads(path.read_text("utf-8"))


@pytest.fixture
def opaque_image(tmp_path: Path) -> Path:
    path = tmp_path / "opaque.png"
    Image.new("RGB", (24, 16), (12, 200, 90)).save(path)
    return path


@pytest.fixture
def transparent_image(tmp_path: Path) -> Path:
    """Fully transparent, so a bad flatten is unmistakable in the output."""
    path = tmp_path / "transparent.png"
    Image.new("RGBA", (10, 10), (255, 0, 0, 0)).save(path)
    return path
