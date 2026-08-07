"""The loopback bridge.

Driven against a real server on a real ephemeral port rather than a
mocked handler, because most of what could go wrong here -- CORS
headers, preflight, status codes, multipart framing -- lives in the parts
a mock would replace.

The origin tests are the important ones. Loopback binding stops the
network reaching this server; it does not stop another website the
visitor happens to have open, since their browser runs on this machine
too. The Origin check is the only thing standing between a stray tab and
someone's file system.
"""

from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from thehallucinatedlab.serve import (
    MAX_BODY_BYTES,
    capabilities,
    create_server,
    host_allowed,
    is_running,
    origin_allowed,
    parse_multipart,
    run_tool,
)

SITE = "https://thehallucinatedlab.space"


@pytest.fixture(scope="module")
def bridge():
    """A running bridge on an OS-assigned port."""
    server = create_server(port=0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    server.server_close()


def request(url, *, method="GET", origin=SITE, data=None, headers=None):
    """Returns (status, headers, body-as-text), never raising on 4xx/5xx."""
    req = urllib.request.Request(url, method=method, data=data)
    if origin is not None:
        req.add_header("Origin", origin)
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.status, dict(response.headers), response.read().decode("utf-8")
    except urllib.error.HTTPError as err:
        return err.code, dict(err.headers), err.read().decode("utf-8")


def multipart(fields: dict[str, str], filename: str, content: bytes) -> tuple[bytes, str]:
    boundary = f"----thl{uuid.uuid4().hex}"
    parts = []
    for name, value in fields.items():
        parts.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n"
            f"{value}\r\n".encode()
        )
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; '
        f'filename="{filename}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode()
        + content
        + b"\r\n"
    )
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


# -- the origin boundary --------------------------------------------


@pytest.mark.parametrize(
    "origin",
    [SITE, "http://localhost:4173", "http://127.0.0.1:8080", "http://localhost", None],
)
def test_origins_that_may_use_the_bridge(origin):
    assert origin_allowed(origin) is True


@pytest.mark.parametrize(
    "origin",
    [
        "https://evil.example",
        "http://thehallucinatedlab.space",          # http, not https
        "https://thehallucinatedlab.space.evil.co",  # suffix attack
        "https://notthehallucinatedlab.space",
        "http://localhost.evil.co",
        "null",
    ],
)
def test_origins_that_may_not(origin):
    assert origin_allowed(origin) is False


def test_a_disallowed_origin_is_refused_without_cors_headers(bridge):
    status, headers, _ = request(f"{bridge}/thl/v1/capabilities", origin="https://evil.example")

    assert status == 403
    # Echoing CORS back would let the calling page read the refusal, and
    # so confirm a bridge is here and what it is.
    assert "Access-Control-Allow-Origin" not in headers


def test_an_extra_origin_can_be_allowed_explicitly():
    assert origin_allowed("https://staging.example", ("https://staging.example",)) is True
    assert origin_allowed("https://staging.example") is False


# -- the host boundary ----------------------------------------------
#
# The Origin check cannot see a DNS rebinding attack: the attacker's page
# becomes same-origin with this server, and a same-origin GET carries no
# Origin header for it to inspect. Host is what still tells the truth.


@pytest.mark.parametrize(
    "host",
    ["127.0.0.1", "127.0.0.1:8787", "localhost", "localhost:8787", "[::1]:8787", None],
)
def test_hosts_that_may_use_the_bridge(host):
    assert host_allowed(host) is True


@pytest.mark.parametrize(
    "host",
    [
        "evil.example",
        "evil.example:8787",
        "127.0.0.1.evil.co",   # prefix attack
        "localhost.evil.co",   # suffix attack
        "thehallucinatedlab.space",
    ],
)
def test_hosts_that_may_not(host):
    assert host_allowed(host) is False


def test_a_rebound_host_is_refused_even_with_no_origin(bridge):
    """The rebinding shape, end to end: truthful Host, absent Origin.

    Checking Origin alone answers this request with a document listing
    the version and every format this machine can read.
    """
    status, headers, _ = request(
        f"{bridge}/thl/v1/capabilities", origin=None, headers={"Host": "evil.example"}
    )

    assert status == 403
    assert "Access-Control-Allow-Origin" not in headers


def test_a_rebound_host_cannot_reach_a_tool_either(bridge):
    body, ctype = multipart({}, "note.md", b"# Title\n\ntext\n")
    status, _, _ = request(
        f"{bridge}/thl/v1/run/extract",
        method="POST",
        origin=None,
        data=body,
        headers={"Content-Type": ctype, "Host": "evil.example"},
    )

    assert status == 403


# -- knowing whether the bridge is up -------------------------------


def test_is_running_recognises_the_bridge(bridge):
    assert is_running(int(bridge.rsplit(":", 1)[1])) is True


def test_is_running_is_not_fooled_by_an_unrelated_server():
    """8787 is not reserved, so "something answered" is not "the bridge".

    A bare connect() calls any listener on the port a running bridge, and
    sends the caller into a request that fails far more confusingly than
    "not running" would have.
    """

    class Decoy(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            self.send_response(200)
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"hi")

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Decoy)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        assert is_running(server.server_address[1]) is False
    finally:
        server.shutdown()
        server.server_close()


def test_is_running_on_a_port_with_nothing_on_it():
    assert is_running(9) is False


# -- capabilities ---------------------------------------------------


def test_capabilities_reports_what_this_install_can_read(bridge):
    status, headers, body = request(f"{bridge}/thl/v1/capabilities")
    payload = json.loads(body)

    assert status == 200
    assert headers["Access-Control-Allow-Origin"] == SITE
    assert headers["Vary"] == "Origin"
    assert "extract" in payload["tools"]
    assert ".txt" in payload["formats"]
    assert payload["name"] == "thehallucinatedlab"


def test_capabilities_reports_only_formats_whose_parser_is_installed():
    from thehallucinatedlab.tools.extract import extensions, readable_extensions

    reported = capabilities()["formats"]
    assert reported == readable_extensions()
    # Never advertise a format this install cannot actually parse: the
    # visitor has already chosen the file by the time it fails.
    assert set(reported) <= set(extensions())
    # The stdlib-only formats are always readable, whatever is installed.
    assert {".txt", ".md", ".csv", ".eml"} <= set(reported)


def test_an_unknown_endpoint_is_a_404_not_a_crash(bridge):
    status, _, _ = request(f"{bridge}/thl/v1/nope")
    assert status == 404


# -- preflight ------------------------------------------------------


def test_the_preflight_grants_private_network_access(bridge):
    status, headers, _ = request(f"{bridge}/thl/v1/run/extract", method="OPTIONS")

    assert status == 204
    assert headers["Access-Control-Allow-Origin"] == SITE
    assert "POST" in headers["Access-Control-Allow-Methods"]
    # Chromium refuses public -> private without this.
    assert headers["Access-Control-Allow-Private-Network"] == "true"


def test_a_disallowed_origin_gets_no_preflight_either(bridge):
    status, headers, _ = request(
        f"{bridge}/thl/v1/run/extract", method="OPTIONS", origin="https://evil.example"
    )
    assert status == 403
    assert "Access-Control-Allow-Private-Network" not in headers


# -- running a tool -------------------------------------------------


def test_a_document_goes_through_and_comes_back_as_markdown(bridge):
    body, content_type = multipart({}, "rows.csv", b"a,b\r\n1,2\r\n")
    status, _, response = request(
        f"{bridge}/thl/v1/run/extract",
        method="POST",
        data=body,
        headers={"Content-Type": content_type},
    )
    payload = json.loads(response)

    assert status == 200
    assert payload["tool"] == "extract"
    assert "| a | b |" in payload["text"]
    # The CRLF in the upload must not survive into the output.
    assert "\r" not in payload["text"]


def test_a_crlf_email_comes_back_normalised(bridge):
    """The path the browser actually takes for .eml, end to end."""
    body, content_type = multipart(
        {"frontmatter": "false"},
        "note.eml",
        b"Subject: Numbers\r\n\r\nFirst para.\r\n\r\nSecond para.\r\n",
    )
    status, _, response = request(
        f"{bridge}/thl/v1/run/extract",
        method="POST",
        data=body,
        headers={"Content-Type": content_type},
    )
    text = json.loads(response)["text"]

    assert status == 200
    assert "\r" not in text
    assert "First para.\n\nSecond para." in text


def test_arguments_ride_along_as_form_fields(bridge):
    body, content_type = multipart({"frontmatter": "false"}, "rows.csv", b"a,b\n1,2\n")
    status, _, response = request(
        f"{bridge}/thl/v1/run/extract",
        method="POST",
        data=body,
        headers={"Content-Type": content_type},
    )

    assert status == 200
    assert not json.loads(response)["text"].startswith("---")


def test_a_bad_argument_is_a_400_with_the_librarys_own_message(bridge):
    body, content_type = multipart({"format": "pdf"}, "rows.csv", b"a,b\n1,2\n")
    status, _, response = request(
        f"{bridge}/thl/v1/run/extract",
        method="POST",
        data=body,
        headers={"Content-Type": content_type},
    )

    # A caller's mistake is not a server error, and should not print a
    # traceback in the terminal of whoever is running the bridge.
    assert status == 400
    assert "format" in json.loads(response)["error"]


@pytest.mark.parametrize("tool,field", [("chunk", "max_tokens"), ("chunk", "overlap"),
                                        ("tokenize", "limit")])
def test_a_non_numeric_argument_is_a_400_not_a_500(bridge, tool, field):
    """The same rule, one layer earlier.

    A form can only carry strings, so `max_tokens=abc` is a well-formed
    field that int() then rejects. Letting that ValueError escape reports
    a caller's typo as a crashed bridge.
    """
    body, content_type = multipart({field: "abc"}, "note.md", b"# Title\n\ntext\n")
    status, _, response = request(
        f"{bridge}/thl/v1/run/{tool}",
        method="POST",
        data=body,
        headers={"Content-Type": content_type},
    )

    assert status == 400
    assert field in json.loads(response)["error"]


def test_an_unreadable_format_is_reported_rather_than_crashing(bridge):
    body, content_type = multipart({}, "thing.zip", b"PK\x03\x04")
    status, _, response = request(
        f"{bridge}/thl/v1/run/extract",
        method="POST",
        data=body,
        headers={"Content-Type": content_type},
    )

    assert status == 400
    assert ".zip" in json.loads(response)["error"]


def test_an_empty_body_is_rejected(bridge):
    status, _, _ = request(
        f"{bridge}/thl/v1/run/extract",
        method="POST",
        data=b"",
        headers={"Content-Type": "multipart/form-data; boundary=x"},
    )
    assert status == 400


def test_an_unknown_tool_cannot_be_dispatched():
    """The path segment is matched, never used to look something up."""
    from thehallucinatedlab.errors import THLError

    with pytest.raises(THLError) as err:
        run_tool("__class__", {}, {"file": {"filename": "a.txt", "content": b"x"}})
    assert "No tool named" in str(err.value)


def test_a_request_with_no_file_says_so():
    from thehallucinatedlab.errors import THLError

    with pytest.raises(THLError) as err:
        run_tool("extract", {}, {})
    assert "No file" in str(err.value)


# -- multipart ------------------------------------------------------


def test_multipart_parsing_survives_cgi_being_gone():
    """cgi.FieldStorage was removed in 3.13; this is the replacement."""
    body, content_type = multipart({"format": "text"}, "a b.txt", b"hello\nthere")
    fields, files = parse_multipart(body, content_type)

    assert fields == {"format": "text"}
    assert files["file"]["filename"] == "a b.txt"
    assert files["file"]["content"] == b"hello\nthere"


def test_binary_content_survives_the_round_trip():
    """A PDF is not text, and must not be decoded on the way through."""
    blob = bytes(range(256))
    body, content_type = multipart({}, "x.pdf", blob)
    _, files = parse_multipart(body, content_type)

    assert files["file"]["content"] == blob


def test_the_body_cap_matches_the_manifest():
    from thehallucinatedlab import registry

    declared = registry.describe("extract")["input"]["maxBytes"]
    # A bridge that accepts more than the page offers, or less, means one
    # of the two is lying about the limit.
    assert declared == MAX_BODY_BYTES
