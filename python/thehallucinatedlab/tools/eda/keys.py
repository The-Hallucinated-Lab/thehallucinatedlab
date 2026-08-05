"""Reading one keypress, and drawing over what was there before.

No TUI library. The extra already pulls in pandas, numpy, matplotlib and
scipy; a fifth dependency for nine multi-select screens is not a trade
worth making, and the parent package's rule on new dependencies is to
assume the answer is no.

What that costs is this file: about a hundred lines of terminal handling
that a library would have supplied. What it buys is that ``[eda]``
installs four well-known packages and nothing else, and that the session
works the same on a Windows console and over SSH.

There is no Tk here and no native dialog anywhere in the package. A file
picker fails over SSH, in Docker, in CI and inside a notebook, and the
parent package is classified OS Independent, which a Tk dependency would
make untrue.
"""

from __future__ import annotations

import os
import sys
from typing import Any  # noqa: F401 - used by the annotations below

# Key names the screens match on. Spelled out rather than raw escape
# codes so a screen's key handling reads as intent.
UP = "up"
DOWN = "down"
LEFT = "left"
RIGHT = "right"
ENTER = "enter"
ESCAPE = "escape"
SPACE = "space"
BACKSPACE = "backspace"
TAB = "tab"
HOME = "home"
END = "end"
PAGE_UP = "pageup"
PAGE_DOWN = "pagedown"

_WINDOWS_SPECIAL = {
    "H": UP, "P": DOWN, "K": LEFT, "M": RIGHT,
    "G": HOME, "O": END, "I": PAGE_UP, "Q": PAGE_DOWN,
}

_VT_SPECIAL = {
    "A": UP, "B": DOWN, "C": RIGHT, "D": LEFT,
    "H": HOME, "F": END, "5~": PAGE_UP, "6~": PAGE_DOWN,
}


#: Decorative characters, and what to use where the console cannot encode
#: them. A Windows console defaults to cp1252, where printing a star
#: raises UnicodeEncodeError -- crashing ``--list`` on the platform the
#: package claims to support. The fallback is checked once and cached.
_GLYPHS = {
    "star": ("★", "*"),
    "dot": ("·", "-"),
    "bullet": ("•", "*"),
    "arrow": ("→", "->"),
    "warn": ("⚠", "!"),
    "ellipsis": ("…", "..."),
}

#: Typography that appears in screen text but is not in :data:`_GLYPHS`,
#: because no screen picks it deliberately -- it arrives inside a message
#: somebody wrote in prose.
_PUNCTUATION = {
    "—": "--",  # em dash
    "–": "-",   # en dash
    "‘": "'",   # left single quote
    "’": "'",   # right single quote
    "“": '"',   # left double quote
    "”": '"',   # right double quote
}

#: Every non-ASCII character the package can print, mapped to a stand-in.
#: Derived from the table above rather than restated, so adding a glyph in
#: one place cannot leave the repair table one entry behind.
_DOWNGRADE = str.maketrans({**dict(_GLYPHS.values()), **_PUNCTUATION})

_unicode: bool | None = None


def unicode_ok(stream: Any = None) -> bool:
    """Whether the output stream can encode the decorative characters."""
    global _unicode
    if stream is None and _unicode is not None:
        return _unicode
    target = stream or sys.stdout
    encoding = getattr(target, "encoding", None) or "ascii"
    try:
        "".join(glyph for glyph, _ in _GLYPHS.values()).encode(encoding)
        answer = True
    except (LookupError, UnicodeEncodeError):
        answer = False
    if stream is None:
        _unicode = answer
    return answer


def glyph(name: str) -> str:
    """One decorative character, or its ASCII stand-in."""
    fancy, plain = _GLYPHS[name]
    return fancy if unicode_ok() else plain


def interactive() -> bool:
    """True when there is a real terminal on both ends.

    ``-i`` requires this. A session that prompts into a pipe hangs
    forever, which is a worse failure than refusing up front.
    """
    try:
        return bool(sys.stdin.isatty() and sys.stdout.isatty())
    except (AttributeError, ValueError):  # pragma: no cover - closed streams
        return False


def enable_ansi() -> bool:
    """Turn on virtual-terminal processing where it is not on already.

    Returns whether escape sequences can be expected to work. Windows
    consoles need the flag set explicitly; everything else already has
    it, and a terminal that refuses just gets the plain redraw path.
    """
    if os.environ.get("NO_COLOR") or os.environ.get("TERM") == "dumb":
        return False
    if os.name != "nt":
        return True
    try:  # pragma: no cover - exercised only on Windows
        import ctypes

        kernel32 = ctypes.windll.kernel32
        handle = kernel32.GetStdHandle(-11)
        mode = ctypes.c_uint32()
        if not kernel32.GetConsoleMode(handle, ctypes.byref(mode)):
            return False
        return bool(kernel32.SetConsoleMode(handle, mode.value | 0x0004))
    except Exception:  # noqa: BLE001 - any failure here means "no ANSI", not a crash
        return False


def read_key() -> str:
    """Block until one key is pressed; return its name or its character."""
    if os.name == "nt":  # pragma: no cover - platform specific
        return _read_windows()
    return _read_posix()


def _classify(char: str) -> str:
    if char in ("\r", "\n"):
        return ENTER
    if char == " ":
        return SPACE
    if char in ("\x7f", "\b"):
        return BACKSPACE
    if char == "\t":
        return TAB
    if char == "\x03":
        raise KeyboardInterrupt
    return char


def _read_windows() -> str:  # pragma: no cover - platform specific
    import msvcrt

    char = msvcrt.getwch()
    if char in ("\x00", "\xe0"):
        return _WINDOWS_SPECIAL.get(msvcrt.getwch(), "")
    if char == "\x1b":
        return ESCAPE
    return _classify(char)


def _read_posix() -> str:  # pragma: no cover - platform specific
    import termios
    import tty

    fd = sys.stdin.fileno()
    saved = termios.tcgetattr(fd)
    try:
        tty.setcbreak(fd)
        char = sys.stdin.read(1)
        if char != "\x1b":
            return _classify(char)

        # An escape sequence and a bare Escape key start identically. The
        # difference is whether anything follows immediately, so ask with
        # a zero timeout rather than blocking on a key that is not coming.
        import select

        if not select.select([fd], [], [], 0.05)[0]:
            return ESCAPE
        rest = sys.stdin.read(1)
        if rest != "[":
            return ESCAPE
        body = ""
        while True:
            if not select.select([fd], [], [], 0.05)[0]:
                break
            body += sys.stdin.read(1)
            if body[-1].isalpha() or body[-1] == "~":
                break
        return _VT_SPECIAL.get(body, "")
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, saved)


def read_line(prompt: str, default: str = "") -> str:
    """A whole line, with tab completion on paths where the platform has it.

    ``readline`` is standard-library and present on most POSIX builds and
    absent on Windows. Where it is missing the prompt still works, just
    without completion -- which is a smaller loss than a native dialog
    that cannot open at all.
    """
    try:  # pragma: no cover - depends on the build
        import readline

        readline.set_completer_delims(" \t\n")
        readline.parse_and_bind("tab: complete")
        readline.set_completer(_path_completer)
    except ImportError:
        # readline is absent on Windows and on some minimal builds. The
        # prompt still works there, just without completion -- a smaller
        # loss than a native dialog that cannot open at all.
        pass
    suffix = f" [{default}]" if default else ""
    try:
        value = input(f"{prompt}{suffix}: ").strip()
    except EOFError:
        return default
    return value or default


def _path_completer(text: str, state: int) -> str | None:  # pragma: no cover - readline only
    import glob

    matches = [p + ("/" if os.path.isdir(p) else "") for p in glob.glob(text + "*")]
    return matches[state] if state < len(matches) else None


class Screen:
    """Draw the whole screen each time rather than patching parts of it.

    Partial redraws need cursor arithmetic that goes wrong the moment a
    line wraps, and these screens are small enough that redrawing costs
    nothing. When ANSI is unavailable the clear degrades to blank lines,
    which scrolls rather than clears but stays readable.
    """

    def __init__(self, stream: Any = None) -> None:
        self.stream = stream or sys.stdout
        self.ansi = enable_ansi()
        self._plain: bool | None = None

    @property
    def width(self) -> int:
        try:
            return max(60, min(os.get_terminal_size().columns, 140))
        except OSError:
            return 100

    @property
    def height(self) -> int:
        try:
            return max(16, os.get_terminal_size().lines)
        except OSError:
            return 30

    def clear(self) -> None:
        if self.ansi:
            self.stream.write("\x1b[2J\x1b[H")
        else:
            self.stream.write("\n" * 3)

    def write(self, text: str = "") -> None:
        self.stream.write(self.downgrade(text) + "\n")

    def downgrade(self, text: str) -> str:
        """Swap decorative characters the console cannot encode.

        Applied at the one place everything is written rather than at each
        string. A Windows console defaults to cp1252, where a single
        typographic dash raises ``UnicodeEncodeError`` mid-screen and takes
        the session with it -- and hunting literals through nine screens is
        the kind of fix that holds until somebody adds a tenth.
        """
        if self._plain is None:
            self._plain = not unicode_ok(self.stream)
        if not self._plain:
            return text
        return text.translate(_DOWNGRADE)

    def flush(self) -> None:
        self.stream.flush()

    # -- styling --------------------------------------------------------

    def dim(self, text: str) -> str:
        return f"\x1b[2m{text}\x1b[0m" if self.ansi else text

    def bold(self, text: str) -> str:
        return f"\x1b[1m{text}\x1b[0m" if self.ansi else text

    def accent(self, text: str) -> str:
        return f"\x1b[36m{text}\x1b[0m" if self.ansi else text

    def warn(self, text: str) -> str:
        return f"\x1b[33m{text}\x1b[0m" if self.ansi else text

    def invert(self, text: str) -> str:
        return f"\x1b[7m{text}\x1b[0m" if self.ansi else f"> {text}"
