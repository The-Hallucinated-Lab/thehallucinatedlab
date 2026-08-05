"""Turn a document into Markdown that keeps its structure.

The Python twin of the browser implementation in extract.js, and the
first stage of the RAG pipeline. Same argument names, same bounds, same
output format -- all read from the shared manifest rather than restated.

The point of this tool is what it refuses to throw away. Chunking is
structure-aware, which means it splits on headings and page boundaries;
if this stage flattened everything to plain text there would be nothing
left to split on and the next tool would fall back to counting
characters. So headings become headings, pages stay marked, and tables
stay tables.

Structure is *read*, never invented. A PDF with no outline gets page
markers and no headings, because guessing from font sizes produces an
outline that looks right and is wrong -- and a wrong heading path is
worse than none, since it ends up in the metadata of every chunk beneath
it and then in a citation.

Every parser is an optional dependency imported at the point of use, so
``import thehallucinatedlab`` stays free for anyone who only wanted to
convert an image. See deps.py.
"""

from __future__ import annotations

import contextlib
import csv
import email
import io
import os
import re
import tempfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email import policy
from pathlib import Path
from typing import Any, Union

from ..deps import require
from ..errors import InvalidArgument, UnsupportedFormat
from ..registry import registry

Source = Union[str, "os.PathLike[str]", bytes, bytearray, Any]

# Which extensions this runtime reads, and what each one needs. Kept
# beside the loaders rather than in the manifest because the manifest
# describes the tool across runtimes; this is what *Python* can do.
_NATIVE = {".txt", ".md", ".markdown", ".csv", ".eml"}


@dataclass
class Block:
    """One piece of the document, with the page it came from.

    Blocks exist so every parser can hand back the same shape and the
    assembly rules -- markers, frontmatter, format -- are applied in one
    place instead of once per format.
    """

    text: str
    page: int | None = None


@dataclass
class ExtractResult:
    """What an extraction produced.

    ``path`` is set when a file was written; ``text`` always holds the
    document, so a caller working in memory never has to read back what
    they just wrote.
    """

    format: str
    text: str
    pages: int
    headings: int
    path: Path | None = None
    source_bytes: int | None = None
    warnings: list[str] = field(default_factory=list)

    def __str__(self) -> str:
        where = str(self.path) if self.path else f"{len(self.text)} characters in memory"
        return f"{self.format} {self.pages} page(s), {self.headings} heading(s) -> {where}"


# -- assembly (mirrors extract.js exactly) --------------------------


def _yaml_scalar(value: Any) -> str:
    """Quote everything that is not a number.

    Rather than reasoning about which characters YAML would read as
    structure, quote every string and escape the two that can close a
    double-quoted scalar early. A filename containing a quote would
    otherwise end the frontmatter block and spill into the body.
    """
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int | float):
        return str(value)
    text = str(value)
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _frontmatter(meta: dict[str, Any]) -> str:
    lines = ["---"]
    for key in ("source", "format", "pages", "extracted", "extractor"):
        value = meta.get(key)
        if value is None or value == "":
            continue
        lines.append(f"{key}: {_yaml_scalar(value)}")
    lines.append("---")
    return "\n".join(lines)


def _page_marker(n: int) -> str:
    """An HTML comment: renderers drop it, the chunk tool reads it.

    A visible "Page 12" line would end up inside a chunk and then inside
    an embedding, where it is noise that every similarity search has to
    see past.
    """
    return f"<!-- page: {n} -->"


def _escape_cell(value: Any) -> str:
    """A pipe inside a cell would end the cell."""
    return str("" if value is None else value).replace("|", r"\|").replace("\n", " ").strip()


def _rows_to_markdown(rows: list[list[Any]]) -> str:
    rows = [r for r in rows if r is not None]
    if not rows:
        return ""
    width = max((len(r) for r in rows), default=0)
    if not width:
        return ""

    lines = []
    for index, row in enumerate(rows):
        cells = [_escape_cell(row[c] if c < len(row) else "") for c in range(width)]
        lines.append("| " + " | ".join(cells) + " |")
        if index == 0:
            lines.append("| " + " | ".join(["---"] * width) + " |")
    return "\n".join(lines)


def _markdown_to_text(markdown: str) -> str:
    """Strip the structure Markdown carries.

    Deliberately lossy and only used for ``format="text"``. Horizontal
    whitespace classes throughout -- ``\\s`` under MULTILINE matches the
    newline too, which welds paragraphs together.
    """
    out = re.sub(r"\A---\n.*?\n---\n?", "", markdown, flags=re.DOTALL)
    out = re.sub(r"<!--.*?-->", "", out, flags=re.DOTALL)
    out = re.sub(r"^#{1,6}[ \t]+", "", out, flags=re.MULTILINE)
    out = re.sub(
        r"^[ \t]*\|.*\|[ \t]*$",
        lambda m: re.sub(r"[ \t]*\|[ \t]*", "\t", m.group(0)).strip("\t"),
        out,
        flags=re.MULTILINE,
    )
    out = re.sub(r"^[ \t]*[-*+][ \t]+", "", out, flags=re.MULTILINE)
    out = re.sub(r"\*\*|__|`", "", out)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip()


def _assemble(blocks: list[Block], meta: dict[str, Any], args: dict[str, Any]) -> str:
    body: list[str] = []
    last_page: int | None = None
    for block in blocks:
        if block is None or not str(block.text or "").strip():
            continue
        # Only on change. A page of twenty paragraphs would otherwise
        # carry twenty identical markers, which is noise in the file and
        # twenty more things for the chunker to step over.
        if args["page_markers"] and block.page and block.page != last_page:
            body.append(_page_marker(block.page))
            last_page = block.page
        body.append(str(block.text).strip())

    markdown = "\n\n".join(body)
    if args["format"] == "text":
        return _markdown_to_text(markdown)
    if args["frontmatter"]:
        return _frontmatter(meta) + "\n\n" + markdown + "\n"
    return markdown + "\n"


# -- parsers --------------------------------------------------------


def _decode(payload: bytes) -> str:
    r"""Decode and normalise line endings to \n.

    Every split in this module keys on \n. A CRLF document would sail
    past `\n{2,}` -- there is a \r between the two newlines -- and come
    out as one block the size of the whole file, which is precisely the
    input the chunker cannot do anything structural with. Normalising
    once here also means the output is byte-identical whichever platform
    produced it.
    """
    return re.sub(r"\r\n?", "\n", payload.decode("utf-8", errors="replace"))


def _text_blocks(payload: bytes) -> list[Block]:
    """Plain text: paragraphs on blank lines.

    Not one block for the whole file, because the chunker would then have
    a single unit the size of the document and nothing to split on but
    character count.
    """
    return [Block(part.strip()) for part in re.split(r"\n{2,}", _decode(payload))]


def _markdown_blocks(payload: bytes) -> list[Block]:
    return [Block(_decode(payload))]


def _csv_blocks(payload: bytes, args: dict[str, Any]) -> list[Block]:
    text = payload.decode("utf-8-sig", errors="replace")
    rows = [list(r) for r in csv.reader(io.StringIO(text))]
    if not args["tables"]:
        return [Block("\n".join(", ".join(str(c) for c in row) for row in rows))]
    return [Block(_rows_to_markdown(rows))]


def _soup_blocks(soup: Any, args: dict[str, Any]) -> list[Block]:
    """HTML -> blocks. Shared by the .html and .epub paths."""
    blocks: list[Block] = []
    selector = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "pre", "blockquote"]
    if args["tables"]:
        selector.append("table")

    for node in soup.find_all(selector):
        # An element nested inside another match would be emitted twice.
        if node.find_parent(["li", "blockquote", "pre", "table"]) is not None:
            continue
        text = node.get_text(" ", strip=True)
        if not text:
            continue
        name = node.name.lower()
        if re.fullmatch(r"h[1-6]", name):
            blocks.append(Block("#" * int(name[1]) + " " + text))
        elif name == "li":
            blocks.append(Block("- " + text))
        elif name == "pre":
            blocks.append(Block("```\n" + node.get_text("\n", strip=False).strip() + "\n```"))
        elif name == "blockquote":
            blocks.append(Block("> " + text.replace("\n", "\n> ")))
        elif name == "table":
            rows = [
                [cell.get_text(" ", strip=True) for cell in tr.find_all(["th", "td"])]
                for tr in node.find_all("tr")
            ]
            blocks.append(Block(_rows_to_markdown([r for r in rows if r])))
        else:
            blocks.append(Block(text))
    return blocks


def _html_blocks(payload: bytes, args: dict[str, Any]) -> list[Block]:
    bs4 = require("bs4", extra="extract", purpose="reading HTML")
    soup = bs4.BeautifulSoup(_decode(payload), "html.parser")
    for tag in soup(["script", "style"]):
        tag.decompose()
    return _soup_blocks(soup, args)


def _pdf_outline(reader: Any) -> dict[int, list[tuple[int, str]]]:
    """Page index -> [(level, title)] from the PDF's own outline.

    Returns empty when the PDF has no outline, which is common. That is
    the honest answer: the alternative is inferring headings from font
    size, which invents an outline the author never wrote.
    """
    found: dict[int, list[tuple[int, str]]] = {}

    def walk(entries: Any, level: int) -> None:
        for entry in entries:
            if isinstance(entry, list):
                walk(entry, level + 1)
                continue
            title = str(getattr(entry, "title", "") or "").strip()
            if not title:
                continue
            try:
                page = reader.get_destination_page_number(entry)
            except Exception:  # noqa: BLE001 - a broken destination is not fatal
                continue
            found.setdefault(page, []).append((min(level, 6), title))

    try:
        walk(reader.outline, 1)
    except Exception:  # noqa: BLE001 - some PDFs have an unreadable outline
        return {}
    return found


def _pdf_blocks(payload: bytes, args: dict[str, Any]) -> list[Block]:
    pypdf = require("pypdf", extra="extract", purpose="reading PDF")
    try:
        reader = pypdf.PdfReader(io.BytesIO(payload))
    except Exception as err:  # noqa: BLE001 - pypdf raises several unrelated types
        raise InvalidArgument(f"That file could not be read as a PDF: {err}") from err

    if getattr(reader, "is_encrypted", False):
        # An empty-password decrypt covers PDFs that are "encrypted" only
        # to set permissions, which is most of them.
        try:
            reader.decrypt("")
        except Exception as err:  # noqa: BLE001
            raise InvalidArgument(
                "That PDF is password protected. Decrypt it first."
            ) from err

    outline = _pdf_outline(reader)
    blocks: list[Block] = []
    for index, page in enumerate(reader.pages):
        for level, title in outline.get(index, []):
            blocks.append(Block("#" * level + " " + title, page=index + 1))
        try:
            text = page.extract_text() or ""
        except Exception:  # noqa: BLE001 - one unreadable page is not a dead document
            text = ""
        if text.strip():
            blocks.append(Block(text.strip(), page=index + 1))
    return blocks


def _docx_blocks(payload: bytes, args: dict[str, Any]) -> list[Block]:
    docx = require("docx", extra="extract", purpose="reading Word documents")
    document = docx.Document(io.BytesIO(payload))
    blocks: list[Block] = []

    for paragraph in document.paragraphs:
        text = paragraph.text.strip()
        if not text:
            continue
        style = (paragraph.style.name if paragraph.style else "") or ""
        heading = re.fullmatch(r"Heading (\d)", style)
        if heading:
            blocks.append(Block("#" * min(int(heading.group(1)), 6) + " " + text))
        elif style == "Title":
            blocks.append(Block("# " + text))
        elif style.startswith("List"):
            blocks.append(Block("- " + text))
        else:
            blocks.append(Block(text))

    if args["tables"]:
        for table in document.tables:
            rows = [[cell.text for cell in row.cells] for row in table.rows]
            blocks.append(Block(_rows_to_markdown(rows)))
    return blocks


def _pptx_blocks(payload: bytes, args: dict[str, Any]) -> list[Block]:
    pptx = require("pptx", extra="extract", purpose="reading presentations")
    deck = pptx.Presentation(io.BytesIO(payload))
    blocks: list[Block] = []

    for number, slide in enumerate(deck.slides, start=1):
        title = ""
        if slide.shapes.title is not None:
            title = (slide.shapes.title.text or "").strip()
        blocks.append(Block("## " + (title or f"Slide {number}"), page=number))

        for shape in slide.shapes:
            if shape is slide.shapes.title or not shape.has_text_frame:
                continue
            text = shape.text_frame.text.strip()
            if text:
                blocks.append(Block(text, page=number))

        if slide.has_notes_slide:
            notes = (slide.notes_slide.notes_text_frame.text or "").strip()
            if notes:
                blocks.append(Block("> " + notes.replace("\n", "\n> "), page=number))
    return blocks


def _xlsx_blocks(payload: bytes, args: dict[str, Any]) -> list[Block]:
    openpyxl = require("openpyxl", extra="extract", purpose="reading spreadsheets")
    book = openpyxl.load_workbook(io.BytesIO(payload), data_only=True, read_only=True)
    blocks: list[Block] = []

    for number, sheet in enumerate(book.worksheets, start=1):
        blocks.append(Block("## " + str(sheet.title), page=number))
        rows = [
            ["" if cell is None else cell for cell in row]
            for row in sheet.iter_rows(values_only=True)
        ]
        rows = [r for r in rows if any(str(c).strip() for c in r)]
        if not rows:
            continue
        if args["tables"]:
            blocks.append(Block(_rows_to_markdown(rows), page=number))
        else:
            joined = "\n".join(", ".join(str(c) for c in row) for row in rows)
            blocks.append(Block(joined, page=number))
    book.close()
    return blocks


def _epub_blocks(payload: bytes, args: dict[str, Any]) -> list[Block]:
    ebooklib = require("ebooklib", extra="extract", purpose="reading e-books")
    bs4 = require("bs4", extra="extract", purpose="reading e-books")
    epub = require("ebooklib.epub", extra="extract", purpose="reading e-books")

    # ebooklib reads from a path, so the bytes go to a temp file. Deleted
    # in a finally, and suppressed on the way out: failing to unlink a
    # temp file should not lose an extraction that already succeeded.
    with tempfile.NamedTemporaryFile(suffix=".epub", delete=False) as handle:
        handle.write(payload)
        temp = handle.name
    try:
        book = epub.read_epub(temp)
    finally:
        with contextlib.suppress(OSError):
            os.unlink(temp)

    blocks: list[Block] = []
    for number, item in enumerate(book.get_items_of_type(ebooklib.ITEM_DOCUMENT), start=1):
        soup = bs4.BeautifulSoup(item.get_content(), "html.parser")
        for block in _soup_blocks(soup, args):
            block.page = number
            blocks.append(block)
    return blocks


def _odt_blocks(payload: bytes, args: dict[str, Any]) -> list[Block]:
    teletype = require("odf.teletype", extra="extract", purpose="reading OpenDocument text")
    text = require("odf.text", extra="extract", purpose="reading OpenDocument text")
    opendocument = require("odf.opendocument", extra="extract", purpose="reading OpenDocument text")

    document = opendocument.load(io.BytesIO(payload))
    blocks: list[Block] = []

    for node in document.getElementsByType(text.H) + document.getElementsByType(text.P):
        body = teletype.extractText(node).strip()
        if not body:
            continue
        level = node.getAttribute("outlinelevel")
        if level:
            blocks.append(Block("#" * min(int(level), 6) + " " + body))
        else:
            blocks.append(Block(body))
    return blocks


def _rtf_blocks(payload: bytes, args: dict[str, Any]) -> list[Block]:
    striprtf = require("striprtf.striprtf", extra="extract", purpose="reading RTF")
    # striprtf turns \par into its own newline convention, so normalise
    # again on the way out rather than trusting the input pass alone.
    text = re.sub(r"\r\n?", "\n", striprtf.rtf_to_text(_decode(payload)))
    return [Block(part.strip()) for part in re.split(r"\n{2,}", text)]


def _eml_blocks(payload: bytes, args: dict[str, Any]) -> list[Block]:
    """Email. Headers become a heading and a table, body becomes body."""
    message = email.message_from_bytes(payload, policy=policy.default)
    blocks: list[Block] = []

    subject = str(message.get("subject", "") or "").strip()
    blocks.append(Block("# " + (subject or "(no subject)")))

    rows: list[list[Any]] = [["header", "value"]]
    for header in ("from", "to", "cc", "date"):
        value = message.get(header)
        if value:
            rows.append([header, str(value)])
    if len(rows) > 1 and args["tables"]:
        blocks.append(Block(_rows_to_markdown(rows)))

    body = message.get_body(preferencelist=("plain", "html"))
    if body is not None:
        # get_content() bypasses _decode(), so the mail body arrives with
        # whatever line endings the sender used -- and mail is CRLF by
        # specification. Without normalising, `\n{2,}` matches nothing and
        # the entire body becomes one block.
        content = re.sub(r"\r\n?", "\n", body.get_content())
        if body.get_content_type() == "text/html":
            blocks.extend(_html_blocks(content.encode("utf-8"), args))
        else:
            blocks.extend(Block(p.strip()) for p in re.split(r"\n{2,}", content))
    return blocks


_PARSERS = {
    ".txt": lambda payload, args: _text_blocks(payload),
    ".md": lambda payload, args: _markdown_blocks(payload),
    ".markdown": lambda payload, args: _markdown_blocks(payload),
    ".csv": _csv_blocks,
    ".html": _html_blocks,
    ".htm": _html_blocks,
    ".pdf": _pdf_blocks,
    ".docx": _docx_blocks,
    ".pptx": _pptx_blocks,
    ".xlsx": _xlsx_blocks,
    ".epub": _epub_blocks,
    ".odt": _odt_blocks,
    ".rtf": _rtf_blocks,
    ".eml": _eml_blocks,
}


# -- entry point ----------------------------------------------------


def _read_source(source: Source) -> tuple[Path | None, bytes]:
    if isinstance(source, bytes | bytearray):
        return None, bytes(source)
    if hasattr(source, "read"):
        payload = source.read()
        if not isinstance(payload, bytes):
            raise InvalidArgument("A file object must be opened in binary mode.")
        return None, payload

    path = Path(os.fspath(source))
    if not path.is_file():
        raise InvalidArgument(f"No such document: {path}")
    return path, path.read_bytes()


# What each format needs importable before it can actually be read.
# Formats absent from this map need nothing beyond the standard library.
_REQUIRES: dict[str, tuple[str, ...]] = {
    ".html": ("bs4",),
    ".htm": ("bs4",),
    ".pdf": ("pypdf",),
    ".docx": ("docx",),
    ".pptx": ("pptx",),
    ".xlsx": ("openpyxl",),
    ".epub": ("ebooklib", "bs4"),
    ".odt": ("odf",),
    ".rtf": ("striprtf.striprtf",),
}


def extensions() -> list[str]:
    """Every extension this tool knows how to read, sorted.

    Knows how to, not can right now -- see :func:`readable_extensions`
    for the ones whose parser is actually installed.
    """
    return sorted(_PARSERS)


def readable_extensions() -> list[str]:
    """Every extension this install can read *right now*, sorted.

    Filtered by whether the parser is importable, because this is what
    ``thl serve`` reports to the website. A page told it can send a PDF
    that then fails on arrival is worse than a page that was never
    offered the option -- the visitor has already picked the file by
    then.
    """
    from ..deps import have

    return sorted(
        ext for ext in _PARSERS if all(have(module) for module in _REQUIRES.get(ext, ()))
    )


def extract(
    source: Source,
    dest: str | os.PathLike[str] | None = None,
    *,
    format: str | None = None,
    frontmatter: bool | None = None,
    page_markers: bool | None = None,
    tables: bool | None = None,
    filename: str | None = None,
) -> ExtractResult:
    """Extract ``source`` into Markdown.

    Args:
        source: Path to a document, raw bytes, or a binary file object.
        dest: Where to write. Defaults to the source path with a .md (or
            .txt) extension. Ignored when ``source`` is not a path, in
            which case the text comes back on the result instead.
        format: ``"markdown"`` (default) or ``"text"``. Text flattens the
            structure, which means the chunk tool has nothing to split
            on -- choose it only when the output is going elsewhere.
        frontmatter: Write a YAML metadata block. Default True.
        page_markers: Mark page boundaries as HTML comments. Default True.
        tables: Render tables as Markdown tables. Default True.
        filename: Name to attribute the content to when ``source`` is
            bytes. Required in that case, since the extension is what
            selects the parser.

    Returns:
        An :class:`ExtractResult`.

    Raises:
        InvalidArgument: an argument is outside what the manifest allows,
            or the document cannot be read.
        UnsupportedFormat: no parser in this runtime reads that
            extension.
        DependencyMissing: the parser for that format needs the
            ``extract`` extra.

    Example:
        >>> result = extract("report.pdf")           # doctest: +SKIP
        >>> result.path.name                         # doctest: +SKIP
        'report.md'
    """
    args = registry.validate(
        "extract",
        format=format,
        frontmatter=frontmatter,
        page_markers=page_markers,
        tables=tables,
    )

    source_path, payload = _read_source(source)
    name = filename or (source_path.name if source_path else "")
    if not name:
        raise InvalidArgument(
            "Reading from bytes needs filename= as well -- the extension is "
            "what selects the parser."
        )

    extension = Path(name).suffix.lower()
    parser = _PARSERS.get(extension)
    if parser is None:
        raise UnsupportedFormat(
            f"Nothing here reads {extension or 'a file with no extension'}. "
            f"Readable: {', '.join(extensions())}."
        )

    blocks = parser(payload, args)
    pages = max((b.page or 0 for b in blocks), default=0)
    headings = sum(1 for b in blocks if str(b.text or "").lstrip().startswith("#"))

    text = _assemble(
        blocks,
        {
            "source": name,
            "format": args["format"],
            "pages": pages or None,
            "extracted": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "extractor": f"thehallucinatedlab/{registry.version}",
        },
        args,
    )

    warnings: list[str] = []
    if extension == ".pdf" and not headings:
        warnings.append(
            "This PDF has no outline, so the output has page markers but no headings. "
            "The chunk tool will fall back to splitting on size."
        )
    if args["format"] == "text":
        warnings.append(
            "format=text discards the structure the chunk tool splits on."
        )

    target: Path | None = None
    suffix = ".txt" if args["format"] == "text" else ".md"
    if dest is not None:
        target = Path(os.fspath(dest))
    elif source_path is not None:
        target = source_path.with_suffix(suffix)

    if target is not None:
        target.parent.mkdir(parents=True, exist_ok=True)
        # newline="" writes the string's own line endings untranslated.
        # The default rewrites \n to \r\n on Windows, so the file on disk
        # would stop matching result.text and the same document would
        # hash differently depending on the platform that produced it.
        target.write_text(text, encoding="utf-8", newline="")

    return ExtractResult(
        format=args["format"],
        text=text,
        pages=pages,
        headings=headings,
        path=target,
        source_bytes=len(payload),
        warnings=warnings,
    )


registry.register("extract", extract)
