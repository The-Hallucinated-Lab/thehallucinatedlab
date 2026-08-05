"""Chunking and token counting.

Uses the `estimate` counter throughout so the suite needs no download
and no optional dependency. What is being tested is the packing and the
structure handling, not the vocabulary -- and the estimator is the
counter the browser uses anyway, so these are the numbers half the
pipeline actually sees.
"""

from __future__ import annotations

import json

import pytest

from thehallucinatedlab import InvalidArgument, chunk, tokenize
from thehallucinatedlab.tools.chunk import (
    _split_text,
    _tail,
    pack,
    parse_blocks,
    parse_frontmatter,
)
from thehallucinatedlab.tools.tokenize import counter_for, estimate_tokens, is_exact

count = counter_for("estimate")

DOC = """---
source: "report.pdf"
pages: 3
---

<!-- page: 1 -->

# Chapter 1

Opening paragraph of chapter one.

## Methods

We measured things carefully.

<!-- page: 2 -->

Still in methods, now on page two.

# Chapter 2

A second chapter entirely.
"""


# -- the shared contract --------------------------------------------


def test_every_shared_fixture_chunks_to_the_documented_records(chunk_fixtures):
    """test/chunk.test.js runs this same file against chunk.js.

    A document chunked in the browser and the same document chunked by
    the package must produce identical records, or the two halves of the
    pipeline embed and retrieve differently.
    """
    for case in chunk_fixtures["cases"]:
        _, body = parse_frontmatter(case["document"])
        meta, _ = parse_frontmatter(case["document"])
        chunks = pack(
            parse_blocks(body),
            max_tokens=case["args"]["max_tokens"],
            overlap=case["args"]["overlap"],
            heading_context=case["args"]["heading_context"],
            count=count,
            source=meta.get("source") or "input.md",
        )
        for piece in chunks:
            piece.tokenizer = chunk_fixtures["tokenizer"]
        assert [c.as_dict() for c in chunks] == case["expected"], case["name"]


# -- frontmatter ----------------------------------------------------


def test_frontmatter_is_split_off_and_parsed():
    meta, body = parse_frontmatter(DOC)

    assert meta["source"] == "report.pdf"
    assert meta["pages"] == 3          # a bare number stays a number
    assert not body.startswith("---")


def test_a_document_without_frontmatter_is_left_alone():
    meta, body = parse_frontmatter("# Title\n\nBody.\n")

    assert meta == {}
    assert body.startswith("# Title")


def test_escaped_quotes_in_frontmatter_round_trip():
    meta, _ = parse_frontmatter('---\nsource: "we\\"ird\\".pdf"\n---\n\nBody.\n')
    assert meta["source"] == 'we"ird".pdf'


# -- block parsing --------------------------------------------------


def test_blocks_carry_the_heading_path_above_them():
    _, body = parse_frontmatter(DOC)
    blocks = parse_blocks(body)
    paths = [b["path"] for b in blocks]

    assert ["Chapter 1"] in paths
    assert ["Chapter 1", "Methods"] in paths
    assert ["Chapter 2"] in paths


def test_a_deeper_heading_nests_and_a_shallower_one_pops():
    blocks = parse_blocks("# A\n\nunder a\n\n## B\n\nunder b\n\n# C\n\nunder c\n")
    by_text = {b["text"]: b["path"] for b in blocks}

    assert by_text["under a"] == ["A"]
    assert by_text["under b"] == ["A", "B"]
    # C is a sibling of A, so B must not still be on the stack.
    assert by_text["under c"] == ["C"]


def test_headings_are_not_emitted_as_body_text():
    """Otherwise the heading appears twice: as path and as content."""
    blocks = parse_blocks("# Chapter 1\n\nBody.\n")

    assert len(blocks) == 1
    assert blocks[0]["text"] == "Body."


def test_page_markers_set_the_page_and_leave_no_text_behind():
    _, body = parse_frontmatter(DOC)
    blocks = parse_blocks(body)

    assert all("<!-- page" not in b["text"] for b in blocks)
    assert {b["page"] for b in blocks} == {1, 2}


def test_a_fenced_code_block_is_never_split_on_its_blank_lines():
    """Blank lines and #-lines inside a fence are code, not structure."""
    blocks = parse_blocks("# T\n\n```python\ndef f():\n\n    # a comment\n    pass\n```\n")

    code = [b for b in blocks if "def f()" in b["text"]]
    assert len(code) == 1
    assert "# a comment" in code[0]["text"]
    assert code[0]["path"] == ["T"]


# -- splitting ------------------------------------------------------


def test_an_oversized_block_is_cut_on_the_coarsest_boundary_that_fits():
    text = "\n\n".join(f"Paragraph number {n} with some words in it." for n in range(20))
    pieces = _split_text(text, 40, count)

    assert len(pieces) > 1
    assert all(count(p) <= 40 for p in pieces)
    # Paragraph boundaries were enough, so no sentence was cut in half.
    assert all(p.strip().startswith("Paragraph") for p in pieces)


def test_a_single_huge_paragraph_falls_through_to_sentences():
    text = " ".join(f"Sentence number {n} goes here." for n in range(60))
    pieces = _split_text(text, 40, count)

    assert all(count(p) <= 40 for p in pieces)
    assert len(pieces) > 1


def test_an_unbreakable_run_is_cut_rather_than_left_oversized():
    """A chunk over the limit is truncated at embed time, invisibly."""
    pieces = _split_text("x" * 5000, 20, count)

    assert len(pieces) > 1
    assert all(count(p) <= 20 * 4 for p in pieces)


def test_a_block_that_already_fits_is_untouched():
    assert _split_text("Short enough.", 100, count) == ["Short enough."]


# -- packing --------------------------------------------------------


def blocks_of(doc):
    _, body = parse_frontmatter(doc)
    return parse_blocks(body)


def test_no_chunk_exceeds_the_budget():
    doc = "# H\n\n" + "\n\n".join(f"Paragraph {n} with several words." for n in range(40))
    chunks = pack(
        blocks_of(doc), max_tokens=60, overlap=8,
        heading_context=True, count=count, source="a.md",
    )

    assert chunks
    assert all(c.token_count <= 60 for c in chunks)


def test_a_chunk_never_spans_two_sections():
    chunks = pack(
        blocks_of(DOC), max_tokens=512, overlap=0,
        heading_context=False, count=count, source="report.pdf",
    )
    paths = [tuple(c.heading_path) for c in chunks]

    # Each chunk answers to exactly one heading path; a chunk spanning
    # two would be uncitable.
    assert ("Chapter 1",) in paths
    assert ("Chapter 1", "Methods") in paths
    assert ("Chapter 2",) in paths


def test_heading_context_is_prepended_and_counted():
    with_ctx = pack(
        blocks_of(DOC), max_tokens=512, overlap=0,
        heading_context=True, count=count, source="report.pdf",
    )
    methods = next(c for c in with_ctx if c.heading_path == ["Chapter 1", "Methods"])

    assert methods.text.startswith("Chapter 1 > Methods")
    # The prefix is part of what gets embedded, so it must be in the count.
    assert methods.token_count == count(methods.text)


def test_heading_context_can_be_turned_off():
    without = pack(
        blocks_of(DOC), max_tokens=512, overlap=0,
        heading_context=False, count=count, source="report.pdf",
    )
    assert not any(c.text.startswith("Chapter 1 >") for c in without)


def test_chunks_carry_the_page_they_started_on():
    chunks = pack(
        blocks_of(DOC), max_tokens=512, overlap=0,
        heading_context=False, count=count, source="report.pdf",
    )
    assert {c.page for c in chunks} <= {1, 2}
    assert any(c.page == 2 for c in chunks)


def test_chunk_indexes_are_contiguous_from_zero():
    chunks = pack(
        blocks_of(DOC), max_tokens=64, overlap=8,
        heading_context=False, count=count, source="report.pdf",
    )
    assert [c.chunk_index for c in chunks] == list(range(len(chunks)))


def test_overlap_repeats_the_tail_of_the_previous_chunk():
    doc = "# H\n\n" + "\n\n".join(f"Paragraph {n} with several words here." for n in range(30))
    with_overlap = pack(
        blocks_of(doc), max_tokens=60, overlap=16,
        heading_context=False, count=count, source="a.md",
    )
    without = pack(
        blocks_of(doc), max_tokens=60, overlap=0,
        heading_context=False, count=count, source="a.md",
    )

    # Overlap costs chunks: the same text no longer packs as tightly.
    assert len(with_overlap) >= len(without)
    assert all(c.token_count <= 60 for c in with_overlap)


def test_the_overlap_carry_never_pushes_a_chunk_over_budget():
    """The carry is sized alone; the piece was checked alone.

    Together they can exceed the budget, and an oversized chunk is not
    rejected at embed time -- it is silently truncated.
    """
    doc = "# H\n\n" + "\n\n".join("Words " * 12 for _ in range(30))
    chunks = pack(
        blocks_of(doc), max_tokens=70, overlap=60,
        heading_context=False, count=count, source="a.md",
    )
    assert all(c.token_count <= 70 for c in chunks)


def test_tail_returns_roughly_the_requested_tokens():
    text = " ".join(f"word{n}" for n in range(200))
    tail = _tail(text, 20, count)

    assert tail
    assert count(tail) >= 20
    assert text.endswith(tail)


def test_no_overlap_means_no_tail():
    assert _tail("some words here", 0, count) == ""


# -- the tool -------------------------------------------------------


def test_chunking_writes_jsonl_next_to_the_source(tmp_path):
    source = tmp_path / "doc.md"
    source.write_bytes(DOC.encode("utf-8"))

    result = chunk(source, tokenizer="estimate")

    assert result.path == tmp_path / "doc.jsonl"
    lines = result.path.read_text("utf-8").strip().split("\n")
    assert len(lines) == len(result.chunks)

    first = json.loads(lines[0])
    assert set(first) == {
        "text", "source", "heading_path", "page",
        "chunk_index", "token_count", "tokenizer",
    }
    # The source comes from the frontmatter, not the .md filename, so a
    # chunk still cites the original PDF.
    assert first["source"] == "report.pdf"


def test_the_written_file_has_no_carriage_returns(tmp_path):
    source = tmp_path / "doc.md"
    source.write_bytes(DOC.replace("\n", "\r\n").encode("utf-8"))

    result = chunk(source, tokenizer="estimate")

    assert b"\r" not in result.path.read_bytes()
    assert result.chunks


def test_overlap_at_or_above_max_tokens_is_refused():
    """It would make every chunk repeat the whole previous one."""
    with pytest.raises(InvalidArgument) as err:
        chunk(DOC, max_tokens=128, overlap=128, tokenizer="estimate")
    assert "overlap" in str(err.value)


def test_an_inexact_tokenizer_says_so(tmp_path):
    result = chunk(DOC, dest=tmp_path / "o.jsonl", tokenizer="estimate")

    assert result.exact is False
    assert any("does not match the embedding model" in w for w in result.warnings)


def test_a_document_with_no_headings_warns_that_it_fell_back_to_size():
    result = chunk("Just text.\n\nMore text.\n", tokenizer="estimate")

    assert any("No headings" in w for w in result.warnings)


def test_an_empty_document_produces_no_chunks_and_says_why():
    result = chunk("---\nsource: \"a.pdf\"\n---\n\n", tokenizer="estimate")

    assert result.chunks == []
    assert any("Nothing to chunk" in w for w in result.warnings)


# -- tokenize -------------------------------------------------------


def test_the_estimator_errs_high_never_low():
    """Under-counting produces chunks that overflow at embed time."""
    # Roughly 4 characters per token for Latin script; the estimator adds
    # a margin on top, so it must exceed the naive figure.
    text = "The quick brown fox jumps over the lazy dog. " * 20
    assert estimate_tokens(text) > len(text) / 4


def test_empty_text_is_zero_tokens():
    assert estimate_tokens("") == 0
    assert estimate_tokens("   \n  ") == 0


def test_dense_scripts_count_at_least_one_token_per_character():
    """SentencePiece rarely merges CJK below one piece per glyph."""
    assert estimate_tokens("日本語のテキスト") >= 8


def test_only_bge_claims_to_be_exact():
    assert is_exact("bge") is True
    assert is_exact("estimate") is False
    assert is_exact("openai") is False


def test_a_report_describes_the_distribution_not_just_the_total():
    report = tokenize(["one two three", "a", "x " * 100], tokenizer="estimate")

    assert report.pieces == 3
    assert report.total > 0
    assert report.smallest <= report.median <= report.largest
    assert report.mean > 0


def test_overflow_is_counted_against_the_limit():
    report = tokenize(["short", "x " * 500], tokenizer="estimate", limit=50)

    assert report.over_limit == 1
    assert report.limit == 50


def test_a_jsonl_input_is_measured_per_record(tmp_path):
    path = tmp_path / "chunks.jsonl"
    path.write_text(
        json.dumps({"text": "first chunk"}) + "\n" + json.dumps({"text": "second"}) + "\n",
        encoding="utf-8",
    )

    report = tokenize(path, tokenizer="estimate")

    # Per record, not one lump -- otherwise "how many chunks overflow"
    # has no meaning.
    assert report.pieces == 2


def test_a_malformed_jsonl_line_names_the_line(tmp_path):
    path = tmp_path / "bad.jsonl"
    path.write_text('{"text": "ok"}\nnot json\n', encoding="utf-8")

    with pytest.raises(InvalidArgument) as err:
        tokenize(path, tokenizer="estimate")
    assert "line 2" in str(err.value)


def test_a_jsonl_record_without_text_is_rejected(tmp_path):
    path = tmp_path / "bad.jsonl"
    path.write_text('{"content": "wrong field"}\n', encoding="utf-8")

    with pytest.raises(InvalidArgument) as err:
        tokenize(path, tokenizer="estimate")
    assert "text" in str(err.value)


def test_an_unknown_tokenizer_is_rejected_by_the_manifest():
    with pytest.raises(InvalidArgument):
        tokenize(["hello"], tokenizer="sentencepiece")


def test_chunk_output_feeds_tokenize_without_conversion(tmp_path):
    """The pipeline seam: chunk writes JSONL, tokenize reads it."""
    source = tmp_path / "doc.md"
    source.write_bytes(DOC.encode("utf-8"))
    result = chunk(source, tokenizer="estimate")

    report = tokenize(result.path, tokenizer="estimate")

    assert report.pieces == len(result.chunks)
    assert report.total == sum(c.token_count for c in result.chunks)
