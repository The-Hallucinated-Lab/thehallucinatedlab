"""Embedding and indexing — stages 4 and 5.

Never downloads a model. `_build_encoder` is a module-level seam that
these tests monkeypatch with a deterministic fake, so the whole path
around the model -- argument handling, normalisation, id assignment,
the sidecar, the dimension guard -- runs in CI without 2.3GB of weights.

The chroma store is skipped when chromadb is absent; the numpy store is
always exercised, and it is the one that proves the recorded metadata is
sufficient to reopen the output later.
"""

from __future__ import annotations

import importlib
import json
from typing import Any

import numpy as np
import pytest

from thehallucinatedlab import InvalidArgument, embed, index

# tools/__init__.py re-exports the embed *function*, which shadows the
# submodule of the same name. Neither `from ...tools import embed` nor
# `import ...tools.embed as m` gets the module back -- both resolve the
# attribute and hand over the function, and monkeypatching an attribute
# on a function fails with a confusing AttributeError. import_module
# goes to sys.modules and is the only form that is not fooled.
embed_module = importlib.import_module("thehallucinatedlab.tools.embed")

CHUNKS = [
    {"text": "First chunk about badgers.", "source": "a.pdf",
     "heading_path": ["Ch 1"], "page": 1, "chunk_index": 0,
     "token_count": 7, "tokenizer": "estimate"},
    {"text": "Second chunk about otters.", "source": "a.pdf",
     "heading_path": ["Ch 1"], "page": 2, "chunk_index": 1,
     "token_count": 7, "tokenizer": "estimate"},
    {"text": "Third chunk about herons.", "source": "a.pdf",
     "heading_path": ["Ch 2"], "page": 3, "chunk_index": 2,
     "token_count": 7, "tokenizer": "estimate"},
]


@pytest.fixture
def chunks_file(tmp_path):
    path = tmp_path / "chunks.jsonl"
    path.write_text(
        "".join(json.dumps(c) + "\n" for c in CHUNKS), encoding="utf-8", newline=""
    )
    return path


@pytest.fixture(autouse=True)
def never_download(monkeypatch):
    """No test may load a real model. Ever.

    This exists because the obvious version of the "arguments are
    validated before the model loads" test did not guard the seam: a
    wrong implementation did not fail, it downloaded 2.3GB of BGE-M3 and
    hung for half an hour. A stall is the worst possible failure here --
    a red test teaches, a hang teaches nothing and blocks CI.

    A test asserting that X happens before Y has to make Y impossible.
    Autouse fixtures are set up before the explicitly requested ones, so
    ``fake_encoder`` overrides this where a real encode is wanted.

    Blocked at the DEPENDENCY boundary, not at our own seam. Patching
    only ``_build_encoder`` guards one named function, and an
    implementation that reaches SentenceTransformer by any other route
    walks straight past it -- which is exactly what happened, twice,
    each time costing a multi-gigabyte download and a stalled test run.
    Patching the constructor itself covers every possible arrangement of
    the code under test.
    """
    def refuse(*args: Any, **kwargs: Any) -> Any:
        raise AssertionError(
            "A real embedding model was about to load. Tests must never download "
            "weights -- if this fired, something reached the model before its "
            "arguments were validated, or bypassed the _build_encoder seam."
        )

    monkeypatch.setattr(embed_module, "_build_encoder", refuse)

    # The backstop. Absent in a bare install, in which case nothing can
    # download anyway and there is nothing to patch.
    try:
        import sentence_transformers
    except ImportError:
        return
    monkeypatch.setattr(sentence_transformers, "SentenceTransformer", refuse)


@pytest.fixture
def fake_encoder(monkeypatch):
    """A deterministic stand-in for the real model.

    Returns unnormalised vectors of the right width, varying per text so
    a mix-up between rows is visible rather than silently plausible.
    """
    def build(model_id, dimensions, batch_size):
        def encode(texts):
            out = np.zeros((len(texts), dimensions), dtype=np.float32)
            for row, text in enumerate(texts):
                out[row, 0] = float(len(text))
                out[row, 1] = float(row + 1)
                out[row, 2] = 3.0
            return out
        return encode

    monkeypatch.setattr(embed_module, "_build_encoder", build)
    return build


# -- embed ----------------------------------------------------------


def test_embedding_writes_one_npy_not_one_file_per_chunk(chunks_file, fake_encoder):
    result = embed(chunks_file, model="bge")

    assert result.path == chunks_file.with_suffix(".npy")
    assert result.path.is_file()
    assert result.count == 3


def test_the_array_has_one_row_per_chunk_at_the_model_width(chunks_file, fake_encoder):
    result = embed(chunks_file, model="bge")
    loaded = np.load(result.path)

    assert loaded.shape == (3, 1024)
    # float32, not float64: doubling the size of every index for precision
    # no similarity search benefits from.
    assert loaded.dtype == np.float32


def test_the_two_models_have_genuinely_different_widths(chunks_file, fake_encoder):
    assert embed(chunks_file, model="bge").dimensions == 1024
    assert embed(chunks_file, model="minilm").dimensions == 384


def test_the_model_id_is_recorded_not_just_the_short_name(chunks_file, fake_encoder):
    result = embed(chunks_file, model="bge")

    assert result.model == "bge"
    assert result.model_id == "BAAI/bge-m3"


def test_normalising_makes_every_vector_unit_length(chunks_file, fake_encoder):
    """So cosine similarity and dot product are the same operation."""
    result = embed(chunks_file, model="bge", normalize=True)
    norms = np.linalg.norm(np.load(result.path), axis=1)

    assert np.allclose(norms, 1.0, atol=1e-5)
    assert result.normalized is True


def test_normalising_can_be_turned_off(chunks_file, fake_encoder):
    result = embed(chunks_file, model="bge", normalize=False)
    norms = np.linalg.norm(np.load(result.path), axis=1)

    assert not np.allclose(norms, 1.0, atol=1e-5)
    assert result.normalized is False


def test_ids_line_up_with_the_chunks_they_came_from(chunks_file, fake_encoder):
    result = embed(chunks_file, model="bge")

    assert len(result.ids) == 3
    assert len(set(result.ids)) == 3        # unique, or the store overwrites rows
    assert all(isinstance(i, str) for i in result.ids)


def test_a_jsonl_line_without_text_is_refused(tmp_path, fake_encoder):
    bad = tmp_path / "bad.jsonl"
    bad.write_text('{"source": "a.pdf"}\n', encoding="utf-8")

    with pytest.raises(InvalidArgument) as err:
        embed(bad)
    assert "text" in str(err.value)


def test_an_empty_chunk_file_is_refused_rather_than_writing_an_empty_index(tmp_path, fake_encoder):
    empty = tmp_path / "empty.jsonl"
    empty.write_text("", encoding="utf-8")

    with pytest.raises(InvalidArgument):
        embed(empty)


def test_an_out_of_range_argument_is_rejected_before_the_model_loads(chunks_file):
    """Before, so a typo does not cost a 2.3GB download first.

    Deliberately does NOT request fake_encoder: the autouse guard makes
    any call to _build_encoder an immediate AssertionError, so validating
    too late fails loudly instead of quietly fetching a model.
    """
    with pytest.raises(InvalidArgument):
        embed(chunks_file, batch_size=0)
    with pytest.raises(InvalidArgument):
        embed(chunks_file, model="ada")


# -- index ----------------------------------------------------------


def make_index(tmp_path, chunks_file, fake_encoder, **kwargs):
    result = embed(chunks_file, model="bge")
    return index(result.path, chunks_file, tmp_path / "db", **kwargs)


def test_the_numpy_store_needs_no_database_at_all(tmp_path, chunks_file, fake_encoder):
    built = make_index(tmp_path, chunks_file, fake_encoder, store="numpy")

    assert built.path.is_dir()
    assert built.count == 3
    assert built.store == "numpy"


def test_the_sidecar_records_what_is_needed_to_reopen_it(tmp_path, chunks_file, fake_encoder):
    """Without this the folder is not usable.

    Chroma's default embedder is all-MiniLM-L6-v2 at 384 dimensions.
    Pointed at 1024-dimension vectors it either raises or, if the widths
    happen to line up, silently returns nonsense.
    """
    built = make_index(tmp_path, chunks_file, fake_encoder, store="numpy")
    sidecar = json.loads(built.sidecar.read_text("utf-8"))

    assert sidecar["model"] == "bge"
    assert sidecar["model_id"] == "BAAI/bge-m3"
    assert sidecar["dimensions"] == 1024
    assert sidecar["normalized"] is True
    assert sidecar["count"] == 3
    assert sidecar["store"] == "numpy"
    assert sidecar["created"]


def test_a_query_snippet_is_written_so_the_output_can_actually_be_used(
    tmp_path, chunks_file, fake_encoder
):
    built = make_index(tmp_path, chunks_file, fake_encoder, store="numpy")

    assert built.snippet
    # It must name the exact model, since querying with a different one
    # is the failure this whole sidecar exists to prevent.
    assert "BAAI/bge-m3" in built.snippet
    assert any(p.name.endswith(".py") for p in built.path.iterdir())


def test_the_chunks_travel_with_the_vectors(tmp_path, chunks_file, fake_encoder):
    """A vector with no text is a row number, not a search result."""
    built = make_index(tmp_path, chunks_file, fake_encoder, store="numpy")
    files = {p.name for p in built.path.iterdir()}

    assert any(f.endswith(".jsonl") for f in files)
    assert any(f.endswith(".npy") for f in files)


def test_a_vector_and_chunk_count_mismatch_is_refused(tmp_path, chunks_file, fake_encoder):
    result = embed(chunks_file, model="bge")
    short = tmp_path / "short.jsonl"
    short.write_text(json.dumps(CHUNKS[0]) + "\n", encoding="utf-8")

    with pytest.raises(InvalidArgument) as err:
        index(result.path, short, tmp_path / "db2", store="numpy")
    assert "3" in str(err.value) and "1" in str(err.value)


def test_writing_over_an_existing_index_needs_saying_so(tmp_path, chunks_file, fake_encoder):
    make_index(tmp_path, chunks_file, fake_encoder, store="numpy")

    with pytest.raises(InvalidArgument) as err:
        make_index(tmp_path, chunks_file, fake_encoder, store="numpy")
    assert "overwrite" in str(err.value)


def test_overwrite_replaces_rather_than_appends(tmp_path, chunks_file, fake_encoder):
    """Appending vectors from a different model is the worst failure here.

    It does not error, it just quietly makes half the index unsearchable.
    """
    make_index(tmp_path, chunks_file, fake_encoder, store="numpy")
    built = make_index(tmp_path, chunks_file, fake_encoder, store="numpy", overwrite=True)

    assert built.count == 3
    assert np.load(built.path / "vectors.npy").shape == (3, 1024)


def test_vectors_whose_width_contradicts_the_model_are_refused(tmp_path, chunks_file, fake_encoder):
    """The guard against pointing index at the wrong .npy."""
    wrong = tmp_path / "wrong.npy"
    np.save(wrong, np.zeros((3, 64), dtype=np.float32))

    with pytest.raises(InvalidArgument) as err:
        index(wrong, chunks_file, tmp_path / "db3", store="numpy", model="bge")
    assert "64" in str(err.value)


def test_an_invalid_collection_name_is_rejected(tmp_path, chunks_file, fake_encoder):
    with pytest.raises(InvalidArgument):
        make_index(tmp_path, chunks_file, fake_encoder, store="numpy", collection="a")


def test_the_chroma_store_builds_a_real_collection(tmp_path, chunks_file, fake_encoder):
    pytest.importorskip("chromadb")
    built = make_index(tmp_path, chunks_file, fake_encoder, store="chroma")

    assert built.store == "chroma"
    assert built.count == 3
    assert built.sidecar.is_file()


# -- the seam -------------------------------------------------------


def test_embed_output_feeds_index_without_conversion(tmp_path, chunks_file, fake_encoder):
    """Stage 4 to stage 5, the way the pipeline actually runs."""
    vectors = embed(chunks_file, model="bge")
    built = index(vectors.path, chunks_file, tmp_path / "db", store="numpy")
    sidecar = json.loads(built.sidecar.read_text("utf-8"))

    assert sidecar["count"] == vectors.count
    assert sidecar["dimensions"] == vectors.dimensions
    assert sidecar["model_id"] == vectors.model_id
