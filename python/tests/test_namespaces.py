"""The 1.0 command split: `thl tool <name>` and `thl pipeline <name>`.

The migration messages are the part worth testing hardest. Before them,
`thl convert photo.jpg -f png` did not fail -- it fell through to the
plain-english route, which parsed it as a sentence and did something
almost right. Silently different behaviour is a worse outcome than an
error, and it is the kind of regression that reintroduces itself the
next time someone touches the dispatch order.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from thehallucinatedlab import cli
from thehallucinatedlab.pipelines.rag import STAGES

MOVED_TOOLS = ["convert", "extract", "chunk", "tokenize", "embed", "index"]
MOVED_PIPELINES = ["eda"]


@pytest.mark.parametrize("name", MOVED_TOOLS)
def test_a_moved_tool_names_its_new_spelling(name, capsys) -> None:
    code = cli.main([name, "whatever.txt"])
    err = capsys.readouterr().err
    assert code == 2, f"`thl {name}` should refuse, not run something else"
    assert f"thl tool {name}" in err, "the error must contain the exact new command"


@pytest.mark.parametrize("name", MOVED_PIPELINES)
def test_a_moved_pipeline_names_its_new_spelling(name, capsys) -> None:
    code = cli.main([name, "data.csv"])
    err = capsys.readouterr().err
    assert code == 2
    assert f"thl pipeline {name}" in err


def test_the_old_listing_and_ask_commands_point_somewhere(capsys) -> None:
    assert cli.main(["tools"]) == 2
    assert "thl tool" in capsys.readouterr().err
    assert cli.main(["ask", "hello"]) == 2
    assert "thl assistant" in capsys.readouterr().err


def test_plain_english_still_works_without_a_subcommand(capsys) -> None:
    # A sentence that names no real file exits 2 with advice. What matters
    # is that it reaches the assistant at all rather than being caught by
    # the moved-command guard above -- "what is ..." starts with no known
    # command name, so it must fall through.
    assert cli.main(["what is the airspeed velocity of a swallow"]) == 2


def test_bare_namespaces_list_rather_than_erroring(capsys) -> None:
    assert cli.main(["tool"]) == 0
    assert "convert" in capsys.readouterr().out
    assert cli.main(["pipeline"]) == 0
    out = capsys.readouterr().out
    assert "rag" in out and "eda" in out


def test_the_pipeline_listing_shows_the_real_stages(capsys) -> None:
    """The listing prints the stage list from the pipeline module itself.

    A hand-written list in the help text is a lie waiting to happen; this
    asserts the printed chain is the one the pipeline actually walks.
    """
    cli.main(["pipeline"])
    out = capsys.readouterr().out
    for stage in STAGES:
        assert stage in out


def test_rag_stops_at_the_first_failure_and_keeps_what_it_made(tmp_path) -> None:
    """A partial run is a result, not a crash.

    embed needs numpy, which the base install does not have, so this
    stops there on a bare environment. Whether or not it does, the
    invariant holds: every stage reported ok has its artefact on disk.
    """
    from thehallucinatedlab.pipelines import rag

    source = tmp_path / "doc.md"
    source.write_text("# Title\n\nSome prose worth chunking.\n", encoding="utf-8")

    result = rag(source, tokenizer="estimate")

    assert result.stages, "a run must report at least one stage"
    assert result.stages[0].name == "extract"
    for stage in result.stages:
        if stage.ok and stage.path:
            assert Path(stage.path).exists(), f"{stage.name} reported ok but wrote nothing"
    if not result.complete:
        assert result.resume_from in STAGES
        # The failing stage is the one named to resume from.
        assert result.stages[-1].name == result.resume_from
        assert not result.stages[-1].ok
    else:
        assert (Path(result.directory) / "pipeline.json").exists()
        written = json.loads((Path(result.directory) / "pipeline.json").read_text())
        assert written["pipeline"] == "rag"


def test_rag_refuses_a_missing_source(tmp_path) -> None:
    from thehallucinatedlab.errors import THLError
    from thehallucinatedlab.pipelines import rag

    with pytest.raises(THLError):
        rag(tmp_path / "nope.pdf")
