"""Convert an image between formats.

The Python twin of the canvas implementation the website runs. Same
argument names, same bounds, same alias handling -- all of it read from
the shared manifest rather than restated here.

One deliberate difference: the manifest's ``input.maxPixels`` is a
browser constraint (the canvas encodes on the main thread and a huge
image locks the tab). Nothing here enforces it, because refusing a 60
megapixel scan in a batch script for a reason that only applies to a
browser tab would be silly. Pillow's own decompression-bomb guard still
applies.
"""

from __future__ import annotations

import io
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Union

from PIL import Image

from ..errors import InvalidArgument, UnsupportedFormat
from ..registry import registry

Source = Union[str, "os.PathLike[str]", bytes, bytearray, Any]

_PILLOW_NAMES = {"png": "PNG", "jpeg": "JPEG", "webp": "WEBP", "avif": "AVIF"}

_INSTALL_HINT = {
    "avif": "AVIF needs Pillow 11.3+ or the pillow-avif-plugin package.",
    "webp": "WebP needs a Pillow built with libwebp.",
}


@dataclass
class ConvertResult:
    """What a conversion produced.

    ``path`` is set when a file was written; ``data`` is set instead when
    the caller passed bytes or a file object and no destination, so
    nothing is written to disk behind their back.
    """

    format: str
    width: int
    height: int
    bytes: int
    path: Path | None = None
    data: bytes | None = None
    source_bytes: int | None = None

    @property
    def delta(self) -> int | None:
        """Size change as a percentage, negative when the output is smaller."""
        if not self.source_bytes:
            return None
        return round((self.bytes - self.source_bytes) / self.source_bytes * 100)

    def __str__(self) -> str:
        where = str(self.path) if self.path else f"{self.bytes} bytes in memory"
        return f"{self.format} {self.width}x{self.height} -> {where}"


def _ensure_encoder(fmt: str) -> str:
    """Fail before writing rather than after.

    Mirrors probeEncoders() in the browser: the point is that a file
    named .avif is always actually an AVIF.
    """
    name = _PILLOW_NAMES[fmt]
    Image.init()
    if name not in Image.SAVE:
        hint = _INSTALL_HINT.get(fmt, "")
        raise UnsupportedFormat(f"This Pillow install cannot write {fmt.upper()}. {hint}".strip())
    return name


def _hex_to_rgb(value: str) -> tuple[int, int, int]:
    digits = value.lstrip("#")
    return (int(digits[0:2], 16), int(digits[2:4], 16), int(digits[4:6], 16))


def _read_source(source: Source) -> tuple[Path | None, bytes]:
    if isinstance(source, (bytes, bytearray)):
        return None, bytes(source)
    if hasattr(source, "read"):
        payload = source.read()
        if not isinstance(payload, bytes):
            raise InvalidArgument("A file object must be opened in binary mode.")
        return None, payload

    path = Path(os.fspath(source))
    if not path.is_file():
        raise InvalidArgument(f"No such image: {path}")
    return path, path.read_bytes()


def _has_alpha(img: Image.Image) -> bool:
    return img.mode in ("RGBA", "LA", "PA") or "transparency" in img.info


def _prepare(img: Image.Image, spec: dict[str, Any], background: str) -> Image.Image:
    """Get the pixels into a mode the target format can actually store."""
    if spec["alpha"]:
        return img.convert("RGBA") if _has_alpha(img) else img.convert("RGB")

    # No alpha channel in the target. Without an explicit flatten, Pillow
    # drops the alpha and transparent regions come out black, which is
    # never what anyone wanted from a PNG -> JPEG conversion.
    if not _has_alpha(img):
        return img.convert("RGB")

    rgba = img.convert("RGBA")
    canvas = Image.new("RGB", rgba.size, _hex_to_rgb(background))
    canvas.paste(rgba, mask=rgba.split()[-1])
    return canvas


def converter(
    source: Source,
    dest: str | os.PathLike[str] | None = None,
    *,
    format: str | None = None,
    quality: int | None = None,
    background: str | None = None,
) -> ConvertResult:
    """Convert ``source`` into ``format``.

    Args:
        source: Path to an image, raw bytes, or a binary file object.
        dest: Where to write. Defaults to the source path with the new
            extension. Ignored when ``source`` is not a path, in which
            case the bytes come back on the result instead.
        format: Target format -- png, jpeg, webp or avif. Aliases such as
            "jpg" are accepted. Required.
        quality: Encoder quality 1-100. Ignored for PNG, which is
            lossless. Defaults to the manifest value (92).
        background: Hex colour used to flatten transparency when the
            target has no alpha channel. Defaults to white.

    Returns:
        A :class:`ConvertResult`.

    Raises:
        MissingArgument: ``format`` was not supplied.
        InvalidArgument: an argument is outside what the manifest allows,
            or the source cannot be read.
        UnsupportedFormat: this Pillow install cannot encode the target.

    Example:
        >>> result = converter("photo.jpg", format="png")
        >>> result.path.name
        'photo.png'
    """
    args = registry.validate(
        "converter", format=format, quality=quality, background=background
    )
    tool = registry.describe("converter")
    spec = tool["meta"]["formats"][args["format"]]
    pillow_name = _ensure_encoder(args["format"])

    source_path, payload = _read_source(source)

    try:
        with Image.open(io.BytesIO(payload)) as img:
            img.load()
            width, height = img.size
            prepared = _prepare(img, spec, args["background"])
    except UnsupportedFormat:
        raise
    except OSError as err:
        raise InvalidArgument(f"That file could not be read as an image: {err}") from err

    save_kwargs: dict[str, Any] = {}
    if spec["lossy"]:
        save_kwargs["quality"] = args["quality"]

    buffer = io.BytesIO()
    prepared.save(buffer, pillow_name, **save_kwargs)
    output = buffer.getvalue()

    target: Path | None = None
    if dest is not None:
        target = Path(os.fspath(dest))
    elif source_path is not None:
        target = source_path.with_suffix("." + spec["ext"])

    if target is not None:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(output)

    return ConvertResult(
        format=args["format"],
        width=width,
        height=height,
        bytes=len(output),
        path=target,
        data=None if target is not None else output,
        source_bytes=len(payload),
    )


registry.register("converter", converter)
