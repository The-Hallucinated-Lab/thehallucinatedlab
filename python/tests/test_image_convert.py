"""Real Pillow round-trips. No network, no fixtures on disk."""

from __future__ import annotations

import io
from pathlib import Path

import pytest
from PIL import Image

from thehallucinatedlab import InvalidArgument, MissingArgument, image_convert


def _sniff(data: bytes) -> str:
    with Image.open(io.BytesIO(data)) as img:
        return img.format


def test_png_to_jpeg_writes_alongside_the_source(opaque_image: Path):
    result = image_convert(opaque_image, format="jpeg")

    assert result.path == opaque_image.with_suffix(".jpg")
    assert result.path.is_file()
    assert result.format == "jpeg"
    assert (result.width, result.height) == (24, 16)
    assert _sniff(result.path.read_bytes()) == "JPEG"


def test_an_explicit_destination_wins(opaque_image: Path, tmp_path: Path):
    dest = tmp_path / "nested" / "out.webp"
    result = image_convert(opaque_image, dest, format="webp")

    assert result.path == dest
    assert dest.is_file()
    assert _sniff(dest.read_bytes()) == "WEBP"


def test_bytes_in_bytes_out_without_touching_the_disk(opaque_image: Path):
    result = image_convert(opaque_image.read_bytes(), format="png")

    assert result.path is None
    assert result.data is not None
    assert _sniff(result.data) == "PNG"


def test_a_binary_file_object_is_accepted(opaque_image: Path):
    with opaque_image.open("rb") as handle:
        result = image_convert(handle, format="png")
    assert _sniff(result.data) == "PNG"


def test_transparency_is_flattened_onto_the_background(transparent_image: Path, tmp_path: Path):
    """The whole point of the background argument.

    JPEG has no alpha channel; without an explicit flatten Pillow drops
    it and a transparent image comes out black.
    """
    dest = tmp_path / "flat.jpg"
    image_convert(transparent_image, dest, format="jpeg", background="#ffffff")

    with Image.open(dest) as img:
        assert img.convert("RGB").getpixel((5, 5)) == (255, 255, 255)


def test_the_background_colour_is_actually_used(transparent_image: Path, tmp_path: Path):
    dest = tmp_path / "black.jpg"
    image_convert(transparent_image, dest, format="jpeg", background="#000000")

    with Image.open(dest) as img:
        assert img.convert("RGB").getpixel((5, 5)) == (0, 0, 0)


def test_transparency_survives_a_format_that_has_an_alpha_channel(
    transparent_image: Path, tmp_path: Path
):
    dest = tmp_path / "kept.webp"
    image_convert(transparent_image, dest, format="webp")

    with Image.open(dest) as img:
        assert img.convert("RGBA").getpixel((5, 5))[3] == 0


def test_lower_quality_produces_a_smaller_file(tmp_path: Path):
    source = tmp_path / "noisy.png"
    # Gradient rather than flat colour, so quality actually has something to discard.
    image = Image.new("RGB", (128, 128))
    image.putdata(
        [(x * 2 % 256, y * 2 % 256, (x + y) % 256) for y in range(128) for x in range(128)]
    )
    image.save(source)

    high = image_convert(source, tmp_path / "high.jpg", format="jpeg", quality=95)
    low = image_convert(source, tmp_path / "low.jpg", format="jpeg", quality=20)

    assert low.bytes < high.bytes


def test_quality_is_ignored_for_png_rather_than_rejected(opaque_image: Path, tmp_path: Path):
    """PNG is lossless; the manifest says quality does not apply."""
    result = image_convert(opaque_image, tmp_path / "out.png", format="png", quality=10)
    assert _sniff(result.path.read_bytes()) == "PNG"


def test_aliases_work_all_the_way_through(opaque_image: Path, tmp_path: Path):
    result = image_convert(opaque_image, tmp_path / "out.jpg", format="jpg")
    assert result.format == "jpeg"


def test_format_is_required(opaque_image: Path):
    with pytest.raises(MissingArgument):
        image_convert(opaque_image)


def test_a_missing_file_says_which_one(tmp_path: Path):
    with pytest.raises(InvalidArgument) as err:
        image_convert(tmp_path / "nope.png", format="png")
    assert "nope.png" in str(err.value)


def test_a_file_that_is_not_an_image_is_rejected(tmp_path: Path):
    junk = tmp_path / "notes.txt"
    junk.write_text("this is not a picture")
    with pytest.raises(InvalidArgument):
        image_convert(junk, format="png")


def test_a_text_mode_file_object_is_rejected(opaque_image: Path):
    with (
        opaque_image.open("r", errors="ignore") as handle,
        pytest.raises(InvalidArgument),
    ):
        image_convert(handle, format="png")


def test_the_result_reports_whether_it_saved_space(opaque_image: Path, tmp_path: Path):
    result = image_convert(opaque_image, tmp_path / "out.jpg", format="jpeg")
    assert result.delta is not None
    assert result.source_bytes == opaque_image.stat().st_size
    assert str(result).startswith("jpeg 24x16 ->")
