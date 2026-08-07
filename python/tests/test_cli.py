"""The ``thl`` command."""

from __future__ import annotations

from pathlib import Path

from thehallucinatedlab.cli import main


def test_tools_lists_every_tool_and_its_arguments(capsys):
    assert main(["tool"]) == 0
    out = capsys.readouterr().out
    assert "convert" in out
    assert "--format" in out
    assert "png | jpeg | webp | avif" in out
    assert "thehallucinatedlab.space" in out


def test_convert_writes_the_file(opaque_image: Path, tmp_path: Path, capsys):
    dest = tmp_path / "out.webp"
    assert main(["tool", "convert", str(opaque_image), "-o", str(dest), "--format", "webp"]) == 0
    assert dest.is_file()
    assert "webp 24x16" in capsys.readouterr().out


def test_plain_english_without_a_subcommand(opaque_image: Path, capsys):
    assert main([f"convert {opaque_image} to jpeg at 70"]) == 0
    assert opaque_image.with_suffix(".jpg").is_file()
    assert "jpeg" in capsys.readouterr().out


def test_the_ask_subcommand_takes_loose_words(opaque_image: Path):
    assert main(["assistant", "convert", str(opaque_image), "to", "webp"]) == 0
    assert opaque_image.with_suffix(".webp").is_file()


def test_an_unrecognised_request_points_at_the_tool_list(capsys):
    assert main(["what is the airspeed velocity of a swallow"]) == 2
    assert "thl tools" in capsys.readouterr().err


def test_a_request_with_no_file_says_so(capsys):
    assert main(["convert something.jpg to png"]) == 2
    assert "Name a file that exists" in capsys.readouterr().err


def test_a_request_missing_an_argument_says_which(capsys):
    assert main(["convert this image"]) == 2
    assert "format" in capsys.readouterr().err


def test_a_library_error_is_a_message_not_a_traceback(opaque_image: Path, capsys):
    """Exit 1 and one line, rather than a stack trace, for a bad argument."""
    assert main(["tool", "convert", str(opaque_image), "--format", "png", "--quality", "500"]) == 1
    assert "thl: " in capsys.readouterr().err


def test_no_arguments_prints_help(capsys):
    assert main([]) == 0
    assert "usage" in capsys.readouterr().out.lower()
