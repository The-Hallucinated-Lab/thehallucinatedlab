"""The Python half of the shared extract contract.

test/extract.test.js runs the same fixture file against extract.js. That
is the only thing stopping the two implementations from drifting, and
drift here is expensive: a document that assembles differently depending
on which runtime read it chunks differently, embeds differently and
retrieves differently.

Formats needing an optional dependency are skipped rather than failed
when it is absent, so the suite stays fast and green on a bare install.
"""

from __future__ import annotations

import pytest

from thehallucinatedlab import (
    DependencyMissing,
    InvalidArgument,
    UnsupportedFormat,
    extract,
)
from thehallucinatedlab.tools.extract import (
    Block,
    _assemble,
    _csv_blocks,
    _markdown_to_text,
    extensions,
)

ALL_ON = {"format": "markdown", "frontmatter": True, "page_markers": True, "tables": True}


# -- shared fixtures ------------------------------------------------


def test_every_shared_assembly_fixture_produces_the_documented_output(extract_fixtures):
    for case in extract_fixtures["assembly"]:
        blocks = [Block(b["text"], b.get("page")) for b in case["blocks"]]
        got = _assemble(blocks, case["meta"], case["args"])
        assert got == case["expected"], f"assembly mismatch for {case['name']!r}"


def test_every_shared_csv_fixture_produces_the_documented_table(extract_fixtures):
    for case in extract_fixtures["csv"]:
        got = _csv_blocks(case["input"].encode("utf-8"), ALL_ON)[0].text
        assert got == case["expected"], f"csv mismatch for {case['name']!r}"


# -- native formats -------------------------------------------------


def test_plain_text_splits_on_blank_lines(tmp_path):
    source = tmp_path / "notes.txt"
    source.write_text("First para.\n\nSecond para.\n", encoding="utf-8")

    result = extract(source)

    assert result.path == tmp_path / "notes.md"
    assert "First para." in result.text
    assert "Second para." in result.text
    # One block for the whole file would leave the chunker nothing to
    # split on but character count.
    assert result.text.count("\n\n") >= 2


def test_markdown_passes_through_with_its_headings_intact(tmp_path):
    source = tmp_path / "doc.md"
    source.write_text("# Title\n\nBody.\n", encoding="utf-8")

    result = extract(source, dest=tmp_path / "out.md")

    assert "# Title" in result.text
    assert result.headings == 1
    assert (tmp_path / "out.md").read_text("utf-8") == result.text


def test_csv_becomes_a_table(tmp_path):
    source = tmp_path / "rows.csv"
    source.write_text("a,b\n1,2\n", encoding="utf-8")

    result = extract(source)

    assert "| a | b |" in result.text
    assert "| --- | --- |" in result.text


def test_tables_off_flattens_the_csv_instead(tmp_path):
    source = tmp_path / "rows.csv"
    source.write_text("a,b\n1,2\n", encoding="utf-8")

    result = extract(source, tables=False)

    assert "| --- |" not in result.text
    assert "a, b" in result.text


def test_an_email_keeps_its_subject_as_the_heading(tmp_path):
    source = tmp_path / "mail.eml"
    source.write_bytes(
        b"From: a@example.com\r\nTo: b@example.com\r\nSubject: Hello there\r\n\r\nBody line.\r\n"
    )

    result = extract(source)

    assert "# Hello there" in result.text
    assert "a@example.com" in result.text
    assert "Body line." in result.text


def test_an_email_body_is_normalised_even_though_mail_is_crlf(tmp_path):
    r"""get_content() bypasses _decode(), and mail is CRLF by spec.

    Left alone, `\n{2,}` matches nothing in a mail body and the whole
    thing becomes a single block -- with literal \r\n inside the text
    that gets embedded later.
    """
    source = tmp_path / "mail.eml"
    source.write_bytes(
        b"Subject: Numbers\r\n\r\nFirst para.\r\n\r\nSecond para.\r\n"
    )

    result = extract(source, frontmatter=False)

    assert "\r" not in result.text
    assert "First para.\n\nSecond para." in result.text


# -- arguments ------------------------------------------------------


def test_frontmatter_records_where_the_document_came_from(tmp_path):
    source = tmp_path / "notes.txt"
    source.write_text("Body.", encoding="utf-8")

    result = extract(source)

    assert result.text.startswith("---\n")
    assert 'source: "notes.txt"' in result.text
    assert "extractor:" in result.text


def test_frontmatter_can_be_turned_off(tmp_path):
    source = tmp_path / "notes.txt"
    source.write_text("Body.", encoding="utf-8")

    assert not extract(source, frontmatter=False).text.startswith("---")


def test_text_format_writes_a_txt_file_and_warns(tmp_path):
    source = tmp_path / "notes.md"
    source.write_text("# Title\n\nBody.\n", encoding="utf-8")

    result = extract(source, format="text")

    assert result.path == tmp_path / "notes.txt"
    assert "#" not in result.text
    # Choosing text is legal but breaks the next stage, so it must say so
    # rather than letting the chunker discover it.
    assert any("structure" in w for w in result.warnings)


def test_an_out_of_range_argument_is_rejected_before_any_parsing(tmp_path):
    source = tmp_path / "notes.txt"
    source.write_text("Body.", encoding="utf-8")

    with pytest.raises(InvalidArgument):
        extract(source, format="pdf")


# -- sources --------------------------------------------------------


def test_bytes_need_a_filename_because_the_extension_picks_the_parser():
    with pytest.raises(InvalidArgument) as err:
        extract(b"some text")
    assert "filename" in str(err.value)


def test_bytes_with_a_filename_come_back_in_memory():
    result = extract(b"a,b\n1,2\n", filename="rows.csv")

    assert result.path is None
    assert "| a | b |" in result.text


def test_a_missing_file_says_so(tmp_path):
    with pytest.raises(InvalidArgument) as err:
        extract(tmp_path / "nope.txt")
    assert "No such document" in str(err.value)


def test_an_unreadable_extension_lists_the_readable_ones(tmp_path):
    source = tmp_path / "archive.zip"
    source.write_bytes(b"PK\x03\x04")

    with pytest.raises(UnsupportedFormat) as err:
        extract(source)
    assert ".pdf" in str(err.value)
    assert ".docx" in str(err.value)


def test_extensions_reports_what_this_runtime_reads():
    listed = extensions()
    assert ".pdf" in listed
    assert ".epub" in listed
    assert listed == sorted(listed)


# -- optional dependencies ------------------------------------------


def test_a_format_needing_an_extra_names_the_extra(tmp_path):
    """The failure mode that matters most: a clear install line.

    Skipped when the extra happens to be installed, since then there is
    no missing dependency to report.
    """
    try:
        import pypdf  # noqa: F401
    except ImportError:
        pass
    else:
        pytest.skip("pypdf is installed, so there is no missing dependency here")

    source = tmp_path / "doc.pdf"
    source.write_bytes(b"%PDF-1.4\n")

    with pytest.raises(DependencyMissing) as err:
        extract(source)
    assert "extract" in str(err.value)
    assert "pip install" in str(err.value)
    assert err.value.extra == "extract"


# -- parity details -------------------------------------------------


def test_a_crlf_document_still_splits_into_paragraphs(tmp_path):
    r"""Windows line endings must not collapse the document to one block.

    `\n{2,}` never matches `\r\n\r\n` -- there is a \r between the two
    newlines -- so without normalisation a CRLF file arrives at the
    chunker as a single unit the size of the whole document.
    """
    source = tmp_path / "crlf.txt"
    source.write_bytes(b"First para.\r\n\r\nSecond para.\r\n")

    result = extract(source, frontmatter=False)

    assert result.text == "First para.\n\nSecond para.\n"


def test_the_written_file_matches_the_returned_text_byte_for_byte(tmp_path):
    """Path.write_text would otherwise translate \\n to \\r\\n on Windows."""
    source = tmp_path / "notes.txt"
    source.write_bytes(b"One.\n\nTwo.\n")

    result = extract(source)

    assert result.path is not None
    assert result.path.read_bytes().decode("utf-8") == result.text
    assert b"\r\n" not in result.path.read_bytes()


def test_markdown_to_text_does_not_weld_paragraphs_together():
    """The \\s-under-MULTILINE trap, asserted in both runtimes.

    `^\\s*[-*+]\\s+` eats the preceding blank line as well as the bullet,
    silently joining two paragraphs into one. Both implementations use
    horizontal-whitespace classes to avoid it.
    """
    got = _markdown_to_text('---\nsource: "a.pdf"\n---\n\n# Title\n\n- one\n- two\n')
    assert got == "Title\n\none\ntwo"
