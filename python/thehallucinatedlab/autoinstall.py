"""Installing a missing extra on demand, from the CLI and only the CLI.

``pip install thehallucinatedlab`` deliberately gets you Pillow and
nothing else -- the whole point of the extras is that someone who came to
convert an image never downloads torch. The cost of that is a cliff the
first time they run ``thl extract report.pdf``: the loaders are not
there, and until now the answer was a message telling them to go and run
a second pip command themselves.

This offers to run it for them. Four constraints shape it, and each one
is the reason a line below looks the way it does.

**The CLI asks; the library never does.** ``from thehallucinatedlab
import extract`` keeps raising DependencyMissing exactly as before.
Nothing in this module is reachable from library code. A library that
installs packages as a side effect of being called is a supply-chain
problem wearing a convenience hat, and it would fire inside somebody's
web request at three in the morning.

**It installs into the interpreter that is running**, via
``sys.executable -m pip``, not whatever ``pip`` happens to be first on
PATH. Those two differ constantly -- that mismatch is the whole reason
this package looked missing on a machine that had it -- and resolving it
wrongly means installing into 3.9 while running 3.13. It also means a
virtualenv stays the boundary it is supposed to be: run ``thl`` from a
venv and the extra lands in that venv.

**It never blocks.** With no tty there is nobody to answer the prompt, so
it declines and lets the normal error print. A prompt that hangs a CI job
is worse than the error it replaced.

**It says where the files are going before it writes any.** Installing
into a system Python is a different act from installing into a venv, and
the person answering the prompt is the only one who knows which they
meant.
"""

from __future__ import annotations

import os
import subprocess
import sys

from .deps import EXTRAS, _install_line
from .errors import DependencyMissing

#: Set to any non-empty value to make this module decline every time.
OPT_OUT = "THL_NO_AUTO_INSTALL"


def in_virtualenv() -> bool:
    """Whether this interpreter is a venv rather than a base install.

    ``sys.base_prefix`` is the interpreter a venv was created from and is
    equal to ``sys.prefix`` outside one. This is the check ``venv``
    itself documents, and unlike looking for a VIRTUAL_ENV variable it
    stays correct when the venv is used without being activated -- which
    is exactly how ``.venv/bin/thl`` gets run.
    """
    return sys.prefix != sys.base_prefix


def target() -> str:
    """Where an install would land, phrased so the reader can check it."""
    version = ".".join(str(n) for n in sys.version_info[:3])
    kind = "the virtualenv" if in_virtualenv() else "your base Python"
    return f"{kind} at {sys.prefix} (Python {version})"


def _can_prompt() -> bool:
    if os.environ.get(OPT_OUT):
        return False
    stdin = sys.stdin
    if stdin is None:
        return False
    try:
        return bool(stdin.isatty())
    except (AttributeError, ValueError):
        # A closed or replaced stdin raises rather than answering.
        return False


def offer(err: DependencyMissing, *, _run=None) -> bool:
    """Offer to install the extra ``err`` names.

    Args:
        err: The failure that named a missing extra.
        _run: Seam for tests, standing in for :func:`_pip_install`.

    Returns:
        True only when an install ran and succeeded, meaning the caller
        should retry the command. False for every other outcome --
        declined, impossible to ask, unknown extra, pip failed -- so the
        caller can print the original error unchanged.
    """
    extra = err.extra
    if not extra or extra not in EXTRAS:
        return False
    if not _can_prompt():
        return False

    print()
    print(f"  The [{extra}] extra provides {EXTRAS[extra]}.")
    print(f"  Installing it writes to {target()}.")
    if not in_virtualenv():
        print("  That is not a virtualenv, so this changes your base Python.")
    print()

    try:
        answer = input("  Install it now? [Y/n] ").strip().lower()
    except EOFError:
        # isatty() is not conclusive everywhere: under MSYS, `< /dev/null`
        # reports as a terminal, so the only certain evidence that nobody
        # is there is asking and getting nothing back. Say so, or the
        # output ends on an unanswered prompt and looks like a hang.
        print()
        print(f"  No answer available. When you want it: {_install_line(extra)}")
        return False
    except KeyboardInterrupt:
        print()
        return False

    if answer and not answer.startswith("y"):
        print(f"  Left alone. When you want it: {_install_line(extra)}")
        return False

    runner = _run or _pip_install
    return runner(extra)


def _pip_install(extra: str) -> bool:
    """Run pip in this interpreter. True when it succeeded."""
    cmd = [sys.executable, "-m", "pip", "install", f"thehallucinatedlab[{extra}]"]
    print(f"  $ {' '.join(cmd)}")
    print()
    try:
        completed = subprocess.run(cmd, check=False)
    except OSError as exc:
        # pip is genuinely absent in some installs -- `uv tool install`
        # builds an environment without it, for one.
        print(f"thl: could not run pip ({exc}). Install it yourself:", file=sys.stderr)
        print(f"     {_install_line(extra)}", file=sys.stderr)
        return False

    if completed.returncode != 0:
        print(
            f"thl: pip exited {completed.returncode}; nothing was installed.",
            file=sys.stderr,
        )
        return False
    return True
