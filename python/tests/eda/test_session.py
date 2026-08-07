"""The interactive session, driven by scripted keystrokes.

Definition of done, item 2: nine screens, and every screen has a working
flag equivalent. The screens are tested by replacing the key reader and
the terminal with fakes, which is the only way to exercise a TUI in CI
and also the reason ``keys.py`` keeps input and output behind two small
seams.

The footers matter as much as the navigation. Every screen prints the
flag that would have produced the same choice, so a footer naming a flag
the parser rejects would be the tool teaching people something untrue.
"""

from __future__ import annotations

import io
from pathlib import Path

import pytest

from thehallucinatedlab.tools.eda import cli, keys, loading, registry, session
from thehallucinatedlab.tools.eda.keys import Screen
from thehallucinatedlab.tools.eda.runner import RunOptions
from thehallucinatedlab.tools.eda.session import Item, SessionState


class FakeKeys:
    """Feeds a scripted list of keypresses, then fails loudly.

    Running out of keys means the screen asked a question the test did
    not anticipate, which is worth an error rather than a hang.
    """

    def __init__(self, script: list[str]) -> None:
        self.script = list(script)
        self.pressed: list[str] = []

    def __call__(self) -> str:
        if not self.script:
            raise AssertionError(f"the session asked for more keys after {self.pressed}")
        key = self.script.pop(0)
        self.pressed.append(key)
        return key


@pytest.fixture
def screen() -> Screen:
    return Screen(stream=io.StringIO())


def drive(monkeypatch, script: list[str], lines: list[str] | None = None) -> FakeKeys:
    fake = FakeKeys(script)
    monkeypatch.setattr(keys, "read_key", fake)
    monkeypatch.setattr(session.keys, "read_key", fake)
    supplied = list(lines or [])
    monkeypatch.setattr(
        session.keys, "read_line",
        lambda prompt, default="": supplied.pop(0) if supplied else default,
    )
    return fake


# -- the multi-select widget ------------------------------------------------


def test_space_toggles_and_enter_confirms(screen: Screen, monkeypatch) -> None:
    drive(monkeypatch, [keys.SPACE, keys.DOWN, keys.SPACE, keys.ENTER])
    items = [Item("a", "A"), Item("b", "B"), Item("c", "C")]
    assert session.multi_select(screen, "t", "", items, footer=lambda c: "") == "ok"
    assert [item.key for item in items if item.selected] == ["a", "b"]


def test_a_selects_all_and_n_selects_none(screen: Screen, monkeypatch) -> None:
    drive(monkeypatch, ["a", keys.ENTER])
    items = [Item("a", "A"), Item("b", "B")]
    session.multi_select(screen, "t", "", items, footer=lambda c: "")
    assert all(item.selected for item in items)

    drive(monkeypatch, ["n", keys.ENTER])
    session.multi_select(screen, "t", "", items, footer=lambda c: "")
    assert not any(item.selected for item in items)


def test_escape_goes_back_and_q_quits(screen: Screen, monkeypatch) -> None:
    drive(monkeypatch, [keys.ESCAPE])
    assert session.multi_select(screen, "t", "", [Item("a", "A")], footer=lambda c: "") \
        == session.BACK

    drive(monkeypatch, ["q"])
    assert session.multi_select(screen, "t", "", [Item("a", "A")], footer=lambda c: "") \
        == session.QUIT


def test_filter_narrows_and_escape_clears_it(screen: Screen, monkeypatch) -> None:
    drive(monkeypatch, ["/", keys.SPACE, keys.ESCAPE, keys.ENTER], lines=["beta"])
    items = [Item("a", "alpha"), Item("b", "beta")]
    session.multi_select(screen, "t", "", items, footer=lambda c: "")
    assert [item.key for item in items if item.selected] == ["b"]


def test_a_screen_that_needs_a_choice_will_not_accept_none(
    screen: Screen, monkeypatch
) -> None:
    drive(monkeypatch, [keys.ENTER, keys.SPACE, keys.ENTER])
    items = [Item("a", "A")]
    session.multi_select(screen, "t", "", items, footer=lambda c: "", allow_empty=False)
    assert items[0].selected


def test_the_footer_sees_the_live_selection(screen: Screen, monkeypatch) -> None:
    seen: list[int] = []
    drive(monkeypatch, [keys.SPACE, keys.ENTER])
    items = [Item("a", "A"), Item("b", "B")]
    session.multi_select(
        screen, "t", "", items, footer=lambda chosen: seen.append(len(chosen)) or ""
    )
    assert seen[-1] == 1


# -- individual screens -----------------------------------------------------


def test_the_type_screen_sorts_low_confidence_first(
    adversarial_csv: Path, screen: Screen, monkeypatch
) -> None:
    """S2 is the screen that decides whether the tool feels trustworthy."""
    state = _state(adversarial_csv)
    drive(monkeypatch, [keys.TAB])
    session.screen_types(screen, state)

    written = screen.stream.getvalue()
    flagged = {c.name for c in state.description.columns if c.verdict.low_confidence}
    assert flagged, "the adversarial fixture should have flagged something"

    # The list scrolls, so the assertion is about the first rows rendered,
    # not about the whole buffer.
    # The highlighted row is prefixed, so match on the checkbox itself.
    rows = [line for line in written.splitlines() if "[x]" in line or "[ ]" in line]
    leading = [row.split("]", 1)[1].split()[0] for row in rows[: len(flagged)]]
    assert set(leading) <= flagged, f"unflagged columns above flagged ones: {leading}"
    assert "low confidence" in written


def test_the_type_screen_records_an_override(
    simple_csv: Path, screen: Screen, monkeypatch
) -> None:
    state = _state(simple_csv)
    order = sorted(state.description.columns, key=lambda c: (not c.verdict.low_confidence, c.name))
    index = [c.name for c in order].index("quantity")

    from thehallucinatedlab.tools.eda.types import COLUMN_TYPES

    # The type picker opens with the cursor on the column's current type,
    # so the walk is relative to that, not to the top of the list.
    current = COLUMN_TYPES.index(state.description.column("quantity").verdict.type)
    wanted = COLUMN_TYPES.index("categorical_low")

    steps = [keys.DOWN] * index + [keys.ENTER]
    steps += [keys.DOWN] * (wanted - current) + [keys.ENTER]
    steps += [keys.TAB]
    drive(monkeypatch, steps)

    session.screen_types(screen, state)
    assert state.overrides.get("quantity") == "categorical_low"


def test_the_column_screen_deselects_and_reports_the_flag(
    simple_csv: Path, screen: Screen, monkeypatch
) -> None:
    state = _state(simple_csv)
    drive(monkeypatch, [keys.SPACE, keys.ENTER])
    assert session.screen_columns(screen, state) == "ok"
    assert sum(1 for keep in state.columns.values() if not keep) == 1
    assert "--exclude" in screen.stream.getvalue()


def test_the_chart_screen_counts_the_figures_it_will_produce(
    simple_csv: Path, screen: Screen, monkeypatch
) -> None:
    state = _state(simple_csv)
    state.columns = {column.name: True for column in state.description.columns}
    drive(monkeypatch, [keys.ENTER])
    session.screen_charts(screen, state)
    written = screen.stream.getvalue()
    assert "--charts" in written
    assert "figures" in written


def test_the_relationship_screen_asks_for_a_target(
    simple_csv: Path, screen: Screen, monkeypatch
) -> None:
    state = _state(simple_csv)
    index = [spec.name for spec in registry.RELATIONS].index("target")
    candidates = [
        column.name for column in state.description.columns
        if column.verdict.type not in {"identifier", "empty", "unsupported"}
    ]
    steps = [keys.DOWN] * index + [keys.SPACE, keys.ENTER]
    steps += [keys.DOWN] * candidates.index("churn") + [keys.ENTER]
    drive(monkeypatch, steps)

    assert session.screen_relationships(screen, state) == "ok"
    assert "target" in state.tier2
    assert state.target == "churn"


def test_escaping_the_target_picker_unticks_target_analysis(
    simple_csv: Path, screen: Screen, monkeypatch
) -> None:
    """Target analysis cannot run without one, so the tick has to go."""
    state = _state(simple_csv)
    index = [spec.name for spec in registry.RELATIONS].index("target")
    steps = [keys.DOWN] * index + [keys.SPACE, keys.ENTER, keys.ESCAPE, keys.ENTER]
    drive(monkeypatch, steps)

    assert session.screen_relationships(screen, state) == "ok"
    assert "target" not in state.tier2
    assert state.target is None


def test_the_output_screen_toggles_and_shows_its_flags(
    simple_csv: Path, screen: Screen, monkeypatch
) -> None:
    state = _state(simple_csv)
    state.out = Path("somewhere")
    drive(monkeypatch, ["f", "s", "p", keys.ENTER])
    assert session.screen_output(screen, state, loading.SourceRef(simple_csv)) == "ok"
    assert state.format == "html"
    assert state.self_contained is True
    assert state.emit_script is False
    assert "--format html" in screen.stream.getvalue()
    assert "--self-contained" in screen.stream.getvalue()
    assert "--no-script" in screen.stream.getvalue()


def test_the_load_screen_shows_a_preview_and_its_flags(
    simple_csv: Path, screen: Screen, monkeypatch
) -> None:
    state = _state(simple_csv, describe=False)
    drive(monkeypatch, [keys.ENTER])
    assert session.screen_load(screen, state, loading.SourceRef(simple_csv)) == "ok"
    written = screen.stream.getvalue()
    assert "preview" in written
    assert "revenue" in written
    assert state.load.delimiter == ","


# -- the whole walk ---------------------------------------------------------


def test_the_session_walks_every_screen_and_produces_a_recipe(
    simple_csv: Path, monkeypatch
) -> None:
    monkeypatch.setattr(keys, "interactive", lambda: True)
    monkeypatch.setattr(session.keys, "interactive", lambda: True)
    monkeypatch.setattr(Screen, "__init__", lambda self, stream=None: _fake_screen(self))

    # S1 load, S2 types, S3 columns, S4 charts, S5 summaries, S6 tier 2,
    # S7 output, S8 confirm. S0 is skipped for a single file.
    drive(monkeypatch, [keys.ENTER, keys.TAB, *[keys.ENTER] * 6])

    refs, state, recipe = session.run(
        loading.discover(simple_csv), options=RunOptions(), tool_version="0.2.0"
    )
    assert refs[0].path == simple_csv
    assert recipe.columns
    assert recipe.validate() is recipe
    assert isinstance(state, SessionState)


def test_escape_walks_back_and_q_cancels(simple_csv: Path, monkeypatch) -> None:
    monkeypatch.setattr(keys, "interactive", lambda: True)
    monkeypatch.setattr(session.keys, "interactive", lambda: True)
    monkeypatch.setattr(Screen, "__init__", lambda self, stream=None: _fake_screen(self))

    # S1 forward, S2 forward, S3 back to S2, S2 forward again, then quit.
    drive(monkeypatch, [keys.ENTER, keys.TAB, keys.ESCAPE, keys.TAB, "q"])
    with pytest.raises(session.Cancelled):
        session.run(loading.discover(simple_csv), options=RunOptions(), tool_version="0.2.0")


def test_the_session_refuses_without_a_terminal(simple_csv: Path, monkeypatch) -> None:
    monkeypatch.setattr(session.keys, "interactive", lambda: False)
    with pytest.raises(Exception, match="terminal"):
        session.run(loading.discover(simple_csv), options=RunOptions(), tool_version="0.2.0")


def test_a_recipe_pre_fills_the_session(simple_csv: Path, monkeypatch, tmp_path) -> None:
    """``--recipe -i`` opens the session with the recipe's answers in it."""
    from thehallucinatedlab.tools.eda import eda
    from thehallucinatedlab.tools.eda.recipe import Recipe

    saved = Recipe.from_file(eda(simple_csv, target="churn", tier2=True,
                            out=tmp_path / "out").recipe)

    monkeypatch.setattr(keys, "interactive", lambda: True)
    monkeypatch.setattr(session.keys, "interactive", lambda: True)
    monkeypatch.setattr(Screen, "__init__", lambda self, stream=None: _fake_screen(self))
    # One extra key: the recipe pre-ticks target analysis, so S6 also opens
    # the target picker.
    drive(monkeypatch, [keys.ENTER, keys.TAB, *[keys.ENTER] * 7])

    _, state, recipe = session.run(
        loading.discover(simple_csv), options=RunOptions(), tool_version="0.2.0",
        prefilled=saved,
    )
    assert state.target == "churn"
    assert set(recipe.tier2_kinds) == set(saved.tier2_kinds)


# -- every footer names a flag the parser accepts ---------------------------


def test_every_flag_a_footer_prints_is_a_flag_the_parser_takes() -> None:
    """The session teaches the CLI, so it must not teach a flag that
    does not exist."""
    import re

    source = Path(session.__file__).read_text(encoding="utf-8")
    parser = cli.build_parser()
    known = set()
    for action in parser._actions:  # noqa: SLF001 - argparse exposes no public list
        known.update(action.option_strings)

    printed = set(re.findall(r'"(--[a-z0-9-]+)', source)) | set(
        re.findall(r"'(--[a-z0-9-]+)", source)
    )
    unknown = printed - known
    assert not unknown, f"the session prints flags the CLI does not accept: {sorted(unknown)}"


# -- a console that cannot encode the decoration ----------------------------


def test_screen_text_survives_a_cp1252_console(monkeypatch) -> None:
    """A Windows console is cp1252, where one dash ends the session.

    Every screen prints separators, arrows and a warning sign. The repair
    happens at ``Screen.write`` rather than in each string, so this checks
    the seam and not a sample of the literals.
    """
    stream = io.StringIO()
    screen = Screen(stream=stream)
    screen.ansi = False
    screen._plain = True

    screen.write("S2 · Type review — read as… ★ ⚠ →")
    written = stream.getvalue()
    written.encode("cp1252")
    written.encode("ascii")
    assert "Type review" in written


def test_every_glyph_has_an_ascii_stand_in() -> None:
    """A repair table that is itself unprintable repairs nothing."""
    originals = "".join(chr(point) for point in keys._DOWNGRADE)
    screen = Screen(stream=io.StringIO())
    screen._plain = True
    screen.downgrade(originals).encode("ascii")


def test_a_capable_console_keeps_the_typography() -> None:
    stream = io.StringIO()
    screen = Screen(stream=stream)
    screen.ansi = False
    screen._plain = False
    screen.write("kept · exactly")
    assert "·" in stream.getvalue()


def test_the_cli_hardens_its_streams_against_unprintable_data(
    tmp_path: Path, monkeypatch, capsys
) -> None:
    """A column name from the user's file must not be able to kill a run."""
    import pandas as pd

    from thehallucinatedlab.tools.eda import cli

    source = tmp_path / "wide.csv"
    pd.DataFrame({"名前": ["a", "b"] * 30, "値": list(range(60))}).to_csv(
        source, index=False, encoding="utf-8"
    )
    code = cli.main([str(source), "--out", str(tmp_path / "out"), "--dry-run"])
    assert code == cli.EXIT_OK


# -- helpers ----------------------------------------------------------------


def _state(source: Path, describe: bool = True) -> SessionState:
    from thehallucinatedlab.tools.eda import inference

    refs = loading.discover(source)
    state = SessionState(refs=refs, chosen_refs=refs)
    if describe:
        state.loaded = loading.load(refs[0], state.load)
        state.description = inference.describe(state.loaded, {})
        state.columns = {column.name: True for column in state.description.columns}
    return state


def _fake_screen(instance: Screen) -> None:
    """Stand in for ``Screen.__init__``. Must set every attribute it does."""
    instance.stream = io.StringIO()
    instance.ansi = False
    instance._plain = False
