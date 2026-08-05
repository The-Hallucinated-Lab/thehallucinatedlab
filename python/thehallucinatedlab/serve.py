"""The loopback bridge the website talks to.

``thl serve`` runs a small HTTP server on 127.0.0.1 so a page on
thehallucinatedlab.space can hand a document to this package. The browser
reads text, Markdown, HTML and CSV unaided; everything heavier -- PDF,
Word, slides, spreadsheets, e-books -- needs a parser that has no
business being downloaded into a tab, so the page offers it only when
this is already running.

Nothing is uploaded in any meaningful sense. The file goes from the
visitor's disk to a process on the same machine and the text comes back.
There is no remote endpoint and no network hop.

Deliberately stdlib only. FastAPI and uvicorn would be a nicer
development experience and a worse trade: this exists so a static site
can reach a local process, and adding a web framework to a package whose
entire dependency list is Pillow would cost more than it returns.

**The bridge is never load-bearing.** Every browser tool works with it
absent. That is the property the Ollama integration lacked -- it met a
first-time visitor with install instructions before the page did
anything, and was removed for it.

Security model, in order of what actually does the work:

1.  **The Origin allowlist.** This is the real boundary. Binding to
    loopback stops the *network* reaching the server, but it does not
    stop *another website* the visitor has open: their browser is on
    this machine too, and can issue requests to 127.0.0.1 all day.
    Checking Origin server-side, and refusing to answer anything else,
    is what stops an unrelated page driving someone's file system.
2.  **Loopback binding.** 127.0.0.1 only, never 0.0.0.0, so nothing off
    the machine can connect at all.
3.  **A body cap.** An unbounded upload into a stdlib handler is a way
    to exhaust memory on the machine you are trying to help.
4.  **A tool allowlist.** The path segment after /run/ is matched
    against known tools rather than dispatched by name, so no request
    can reach an attribute that was never meant to be a tool.

Chromium additionally requires ``Access-Control-Allow-Private-Network``
on the preflight before it will let a public page talk to a private
address. Safari has historically been unreliable about https -> loopback
regardless; those visitors get the browser-only path, which is exactly
why it has to keep working.
"""

from __future__ import annotations

import json
import re
import socket
import threading
from email import policy
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from . import __version__
from .errors import THLError
from .registry import registry

DEFAULT_PORT = 8787

# The production site, plus any localhost port so the page can be tested
# from a local static server. Anything else is refused outright.
DEFAULT_ORIGINS = ("https://thehallucinatedlab.space",)
_LOCAL_ORIGIN = re.compile(r"^http://(?:localhost|127\.0\.0\.1)(?::\d+)?$")

# Matches the manifest's input.maxBytes for extract. A stdlib handler
# reads the body into memory, so this is the difference between a large
# document and an out-of-memory kill.
MAX_BODY_BYTES = 104_857_600

_TOOLS = ("extract", "chunk", "tokenize")


def origin_allowed(origin: str | None, extra: tuple[str, ...] = ()) -> bool:
    """Whether a browser Origin may use this bridge.

    A missing Origin is allowed: curl and the test suite do not send one,
    and a request without one did not come from a page. What must never
    be allowed is an Origin that is present and unrecognised.
    """
    if origin is None:
        return True
    if origin in DEFAULT_ORIGINS or origin in extra:
        return True
    return bool(_LOCAL_ORIGIN.match(origin))


def _formats() -> list[str]:
    """Which extensions this install can actually read right now.

    Reported rather than assumed: the extras may not be installed, and a
    page told about .pdf that then fails on .pdf is worse than a page
    that was never offered it.
    """
    # Imported by full path: `from .tools import extract` binds the
    # re-exported *function*, not the module.
    from .tools.extract import readable_extensions

    return readable_extensions()


def capabilities(extra_origins: tuple[str, ...] = ()) -> dict[str, Any]:
    """What the page needs to know to decide what to hand over."""
    return {
        "name": "thehallucinatedlab",
        "version": __version__,
        "spec": registry.version,
        "tools": list(_TOOLS),
        "formats": _formats(),
        "origins": list(DEFAULT_ORIGINS + extra_origins),
    }


def parse_multipart(body: bytes, content_type: str) -> tuple[dict[str, str], dict[str, Any]]:
    """Split a multipart/form-data body into fields and files.

    Written against ``email`` rather than ``cgi.FieldStorage`` because
    ``cgi`` was removed in Python 3.13, which this package supports and
    CI tests against. The trick is that multipart/form-data is MIME, so
    synthesising the header lets the stdlib parser do the work.

    Returns:
        ``(fields, files)`` where files maps a field name to
        ``{"filename": str, "content": bytes}``.
    """
    header = f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode()
    message = BytesParser(policy=policy.default).parsebytes(header + body)
    if not message.is_multipart():
        raise THLError("Expected a multipart/form-data body.")

    fields: dict[str, str] = {}
    files: dict[str, Any] = {}

    for part in message.iter_parts():
        name = part.get_param("name", header="content-disposition")
        if not name:
            continue
        filename = part.get_filename()
        payload = part.get_payload(decode=True)
        if filename:
            files[str(name)] = {"filename": filename, "content": payload or b""}
        else:
            fields[str(name)] = (payload or b"").decode("utf-8", errors="replace")

    return fields, files


def run_tool(name: str, fields: dict[str, str], files: dict[str, Any]) -> dict[str, Any]:
    """Dispatch one bridge request onto the real tool.

    Arguments arrive as strings because that is all a form can carry.
    They are handed to the tool untouched, so the registry does the
    coercion and the validation -- the bridge does not get its own,
    quietly divergent, idea of what an argument means.
    """
    if name not in _TOOLS:
        raise THLError(f"No tool named {name!r}. Available: {', '.join(_TOOLS)}.")

    upload = files.get("file")
    if upload is None:
        raise THLError("No file was sent.")

    if name == "extract":
        from .tools.extract import extract

        result = extract(
            upload["content"],
            filename=upload["filename"],
            format=fields.get("format") or None,
            frontmatter=fields.get("frontmatter") or None,
            page_markers=fields.get("page_markers") or None,
            tables=fields.get("tables") or None,
        )
        return {
            "tool": "extract",
            "text": result.text,
            "format": result.format,
            "pages": result.pages,
            "headings": result.headings,
            "warnings": result.warnings,
        }

    if name == "chunk":
        from .tools.chunk import chunk

        chunked = chunk(
            upload["content"],
            filename=upload["filename"],
            max_tokens=int(fields["max_tokens"]) if fields.get("max_tokens") else None,
            overlap=int(fields["overlap"]) if fields.get("overlap") else None,
            tokenizer=fields.get("tokenizer") or None,
            heading_context=fields.get("heading_context") or None,
        )
        return {
            "tool": "chunk",
            "jsonl": chunked.as_jsonl(),
            "chunks": len(chunked.chunks),
            "total_tokens": chunked.total_tokens,
            "tokenizer": chunked.tokenizer,
            "exact": chunked.exact,
            "warnings": chunked.warnings,
        }

    if name == "tokenize":
        from .tools.tokenize import tokenize

        report = tokenize(
            upload["content"],
            filename=upload["filename"],
            tokenizer=fields.get("tokenizer") or None,
            limit=int(fields["limit"]) if fields.get("limit") else None,
        )
        return {"tool": "tokenize", **report.as_dict()}

    raise THLError(f"{name} is listed but has no bridge handler.")


class BridgeHandler(BaseHTTPRequestHandler):
    """One request. Every response carries the CORS headers or none."""

    server_version = f"thl/{__version__}"
    extra_origins: tuple[str, ...] = ()
    quiet = True

    # -- plumbing ---------------------------------------------------

    def log_message(self, fmt: str, *args: Any) -> None:
        if not self.quiet:
            super().log_message(fmt, *args)

    def _origin(self) -> str | None:
        return self.headers.get("Origin")

    def _cors(self, origin: str | None) -> None:
        if origin is None:
            return
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Vary", "Origin")

    def _send(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self._cors(self._origin())
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _refuse(self) -> None:
        """No CORS headers on the way out.

        Sending them would let the calling page read the refusal, which
        tells an unrecognised origin that a bridge is here and what it
        is. Silence is the more useful answer.
        """
        body = b'{"error":"origin not allowed"}'
        self.send_response(403)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # -- verbs ------------------------------------------------------

    def do_OPTIONS(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler's naming
        origin = self._origin()
        if not origin_allowed(origin, self.extra_origins):
            self._refuse()
            return
        self.send_response(204)
        self._cors(origin)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        # Chromium will not let a public page reach a private address
        # without this on the preflight.
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        origin = self._origin()
        if not origin_allowed(origin, self.extra_origins):
            self._refuse()
            return
        if self.path.rstrip("/") == "/thl/v1/capabilities":
            self._send(200, capabilities(self.extra_origins))
            return
        self._send(404, {"error": "no such endpoint"})

    def do_POST(self) -> None:  # noqa: N802
        origin = self._origin()
        if not origin_allowed(origin, self.extra_origins):
            self._refuse()
            return

        match = re.fullmatch(r"/thl/v1/run/([a-z_]+)/?", self.path)
        if not match:
            self._send(404, {"error": "no such endpoint"})
            return

        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            self._send(400, {"error": "bad Content-Length"})
            return

        if length <= 0:
            self._send(400, {"error": "empty body"})
            return
        if length > MAX_BODY_BYTES:
            self._send(
                413,
                {"error": f"body larger than {MAX_BODY_BYTES // 1048576}MB"},
            )
            return

        body = self.rfile.read(length)
        content_type = self.headers.get("Content-Type", "")

        try:
            fields, files = parse_multipart(body, content_type)
            self._send(200, run_tool(match.group(1), fields, files))
        except THLError as err:
            # A tool refusing an argument is the caller's problem to fix,
            # so it comes back as 400 with the message the library wrote
            # rather than a 500 and a traceback in the terminal.
            self._send(400, {"error": str(err)})
        except Exception as err:  # noqa: BLE001 - the bridge must not die on one request
            self._send(500, {"error": f"{type(err).__name__}: {err}"})


def create_server(
    port: int = DEFAULT_PORT,
    extra_origins: tuple[str, ...] = (),
    quiet: bool = True,
) -> ThreadingHTTPServer:
    """Build the server without starting it. Bound to loopback only."""
    handler = type(
        "ConfiguredBridgeHandler",
        (BridgeHandler,),
        {"extra_origins": tuple(extra_origins), "quiet": quiet},
    )
    # Threading so a slow extraction does not block the capabilities
    # probe the page makes on load.
    return ThreadingHTTPServer(("127.0.0.1", port), handler)


def serve(
    port: int = DEFAULT_PORT,
    extra_origins: tuple[str, ...] = (),
    quiet: bool = True,
) -> int:
    """Run the bridge until interrupted."""
    try:
        server = create_server(port, extra_origins, quiet)
    except OSError as err:
        print(f"thl: cannot listen on 127.0.0.1:{port} -- {err}")
        return 1

    formats = _formats()
    print(f"thl serve {__version__} -- http://127.0.0.1:{port}")
    print(f"  reading {len(formats)} formats: {', '.join(formats)}")
    print(f"  answering: {', '.join(DEFAULT_ORIGINS + tuple(extra_origins))}")
    print("  loopback only, nothing leaves this machine. ctrl-c to stop.")

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        thread.join()
    except KeyboardInterrupt:
        print("\nstopping.")
        server.shutdown()
    finally:
        server.server_close()
    return 0


def is_running(port: int = DEFAULT_PORT) -> bool:
    """Whether something is already listening on the bridge port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.3)
        return probe.connect_ex(("127.0.0.1", port)) == 0
