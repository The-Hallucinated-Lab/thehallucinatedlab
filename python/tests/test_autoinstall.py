"""The on-demand extra installer.

Nothing here may reach the real pip. Every test either stops before the
subprocess or passes an explicit runner, because a test suite that can
install packages into the machine running it is a test suite that will
eventually install packages into the machine running it.
"""

from __future__ import annotations

import io
import sys

import pytest

from thehallucinatedlab import autoinstall
from thehallucinatedlab.errors import DependencyMissing, InvalidArgument


class _Tty(io.StringIO):
    """A stdin that claims to be a terminal, with a queued answer."""

    def isatty(self) -> bool:
        return True


@pytest.fixture(autouse=True)
def _no_opt_out(monkeypatch):
    monkeypatch.delenv(autoinstall.OPT_OUT, raising=False)


def _err(extra="extract"):
    return DependencyMissing("extract needs pypdf. pip install ...", extra=extra)


def _tty(monkeypatch, answer: str):
    monkeypatch.setattr(sys, "stdin", _Tty(answer))
    monkeypatch.setattr("builtins.input", lambda _prompt="": answer.strip())


# -- refusing to ask -------------------------------------------------


def test_it_never_prompts_without_a_terminal(monkeypatch):
    """A prompt in CI is a hang, so no tty means decline immediately."""
    monkeypatch.setattr(sys, "stdin", io.StringIO("y\n"))  # isatty() is False
    called = []
    assert autoinstall.offer(_err(), _run=lambda e: called.append(e) or True) is False
    assert called == []


def test_the_opt_out_variable_is_honoured(monkeypatch):
    monkeypatch.setenv(autoinstall.OPT_OUT, "1")
    _tty(monkeypatch, "y")
    called = []
    assert autoinstall.offer(_err(), _run=lambda e: called.append(e) or True) is False
    assert called == []


def test_a_closed_stdin_declines_rather_than_raising(monkeypatch):
    class Closed:
        def isatty(self):
            raise ValueError("I/O operation on closed file")

    monkeypatch.setattr(sys, "stdin", Closed())
    assert autoinstall.offer(_err()) is False


def test_an_unrecognised_extra_is_not_offered(monkeypatch):
    """Only the extras this package actually declares are installable."""
    _tty(monkeypatch, "y")
    called = []
    err = DependencyMissing("something", extra="not-a-real-extra")
    assert autoinstall.offer(err, _run=lambda e: called.append(e) or True) is False
    assert called == []


def test_an_error_with_no_extra_is_not_offered(monkeypatch):
    _tty(monkeypatch, "y")
    assert autoinstall.offer(DependencyMissing("no extra named")) is False


# -- asking ----------------------------------------------------------


@pytest.mark.parametrize("answer", ["y", "Y", "yes", ""])
def test_yes_and_empty_install(monkeypatch, answer):
    """Empty means the capitalised default in [Y/n], not "no answer"."""
    _tty(monkeypatch, answer)
    seen = []
    assert autoinstall.offer(_err(), _run=lambda e: seen.append(e) or True) is True
    assert seen == ["extract"]


@pytest.mark.parametrize("answer", ["n", "N", "no", "nope"])
def test_no_declines_without_installing(monkeypatch, answer, capsys):
    _tty(monkeypatch, answer)
    seen = []
    assert autoinstall.offer(_err(), _run=lambda e: seen.append(e) or True) is False
    assert seen == []
    # Declining must still leave the command behind.
    assert 'pip install "thehallucinatedlab[extract]"' in capsys.readouterr().out


def test_eof_at_the_prompt_says_so_rather_than_trailing_off(monkeypatch, capsys):
    """isatty() is not conclusive: MSYS reports `< /dev/null` as a tty."""
    monkeypatch.setattr(sys, "stdin", _Tty(""))

    def eof(_prompt=""):
        raise EOFError

    monkeypatch.setattr("builtins.input", eof)
    assert autoinstall.offer(_err()) is False
    out = capsys.readouterr().out
    assert "No answer available" in out
    assert 'pip install "thehallucinatedlab[extract]"' in out


def test_ctrl_c_at_the_prompt_declines(monkeypatch):
    monkeypatch.setattr(sys, "stdin", _Tty("y"))

    def interrupt(_prompt=""):
        raise KeyboardInterrupt

    monkeypatch.setattr("builtins.input", interrupt)
    assert autoinstall.offer(_err()) is False


def test_a_failing_pip_reports_false(monkeypatch):
    _tty(monkeypatch, "y")
    assert autoinstall.offer(_err(), _run=lambda _e: False) is False


def test_the_prompt_names_where_files_will_land(monkeypatch, capsys):
    """The reader is the only one who knows which environment they meant."""
    _tty(monkeypatch, "n")
    autoinstall.offer(_err())
    out = capsys.readouterr().out
    assert sys.prefix in out
    assert "document loaders" in out  # the EXTRAS description, not just the name


# -- where it installs ------------------------------------------------


def test_target_reports_this_interpreter():
    """Not `pip` on PATH -- that mismatch is the bug this package hit."""
    assert sys.prefix in autoinstall.target()
    assert ".".join(str(n) for n in sys.version_info[:3]) in autoinstall.target()


def test_virtualenv_detection_matches_the_stdlib_rule(monkeypatch):
    monkeypatch.setattr(sys, "prefix", "/somewhere/.venv")
    monkeypatch.setattr(sys, "base_prefix", "/usr")
    assert autoinstall.in_virtualenv() is True
    assert "virtualenv" in autoinstall.target()

    monkeypatch.setattr(sys, "base_prefix", "/somewhere/.venv")
    assert autoinstall.in_virtualenv() is False
    assert "base Python" in autoinstall.target()


def test_the_pip_command_targets_sys_executable(monkeypatch):
    """The command itself, not just where we say it goes."""
    captured = {}

    def fake_run(cmd, check=False):
        captured["cmd"] = cmd

        class R:
            returncode = 0

        return R()

    monkeypatch.setattr(autoinstall.subprocess, "run", fake_run)
    assert autoinstall._pip_install("embed") is True
    assert captured["cmd"][:3] == [sys.executable, "-m", "pip"]
    assert captured["cmd"][-1] == "thehallucinatedlab[embed]"


def test_a_missing_pip_is_reported_not_raised(monkeypatch, capsys):
    def boom(cmd, check=False):
        raise OSError("No such file or directory")

    monkeypatch.setattr(autoinstall.subprocess, "run", boom)
    assert autoinstall._pip_install("index") is False
    assert "could not run pip" in capsys.readouterr().err


# -- the CLI seam -----------------------------------------------------


def test_guard_retries_the_command_after_a_successful_install(monkeypatch):
    from thehallucinatedlab import cli

    monkeypatch.setattr(cli, "DependencyMissing", DependencyMissing)
    monkeypatch.setattr("thehallucinatedlab.autoinstall.offer", lambda _err: True)

    calls = {"n": 0}

    def flaky():
        calls["n"] += 1
        if calls["n"] == 1:
            raise DependencyMissing("extract needs pypdf", extra="extract")
        return 0

    assert cli._guard(flaky) == 0
    assert calls["n"] == 2


def test_guard_reports_and_stops_when_the_offer_is_declined(monkeypatch, capsys):
    from thehallucinatedlab import cli

    monkeypatch.setattr("thehallucinatedlab.autoinstall.offer", lambda _err: False)

    def always():
        raise DependencyMissing("extract needs pypdf", extra="extract")

    assert cli._guard(always) == 1
    assert "extract needs pypdf" in capsys.readouterr().err


def test_guard_does_not_offer_for_other_errors(monkeypatch):
    """Only a missing extra is fixable this way."""
    from thehallucinatedlab import cli

    def offered(_err):
        raise AssertionError("offer() must not be reached for a non-dependency error")

    monkeypatch.setattr("thehallucinatedlab.autoinstall.offer", offered)

    def bad_arg():
        raise InvalidArgument("quality must be between 1 and 100")

    assert cli._guard(bad_arg) == 1


def test_the_library_path_never_prompts(monkeypatch):
    """Importing and calling a tool must raise, not install.

    The whole safety argument rests on this: nothing outside the CLI may
    reach autoinstall, or the package installs things from inside a
    caller's request handler.
    """
    _tty(monkeypatch, "y")

    def explode(*_a, **_k):
        raise AssertionError("library code reached the installer")

    monkeypatch.setattr(autoinstall, "offer", explode)

    from thehallucinatedlab.deps import require

    with pytest.raises(DependencyMissing):
        require("a_module_that_does_not_exist", extra="extract")
