"""Document text extraction for the ingest surface — stdlib only.

Prism's rule is no runtime dependencies (F13 settled it: one vendored JS
library, zero Python packages). That shapes what this module can do:

  DOCX / XLSX / PPTX  — a zip of XML; zipfile + xml.etree, exact
  HTML / HTM          — html.parser, exact for text content
  RTF                 — control-word stripping, exact for text content
  TXT / MD / CSV / JSON — already text, identity
  PDF                 — best effort, and LOUD about it (see below)

PDF is the honest exception. A PDF is a layout language with font
subsetting, encodings and cross-reference streams; there is no stdlib
parser for it and no external tool on the box. So this module attempts the
part that is mechanical — pull text-showing operators out of uncompressed
and Flate-compressed content streams — and when that does not yield
credible text it REFUSES, with a message telling the human to paste the
text instead.

Refusing is the whole point. The alternative — returning whatever bytes we
managed to scrape, possibly empty, possibly mojibake — would let garbage
into the vault as though a human had written it. A loud failure costs one
paste; silent corruption costs a lens refracted from noise. Given that this
vault accumulates human thought for years, the trade is obvious.
"""

from __future__ import annotations

import html
import json
import re
import zlib
import zipfile
from html.parser import HTMLParser
from io import BytesIO
from xml.etree import ElementTree

# RTF destinations: metadata and embedded objects, never document text.
_RTF_DESTINATIONS = {
    # Tables and metadata: content runs to the closing brace or \par.
    "fonttbl", "colortbl", "stylesheet", "listtable", "rsidtbl", "generator",
    "filetbl", "xmlnstbl", "info", "pntext", "datastore", "latentstyles",
    "themedata", "colorschememapping", "listoverridetable", "revtbl",
    # Embedded objects: binary, never text.
    "pict", "object", "objdata", "result", "blipuid", "shpinst", "nonshppict",
    "shppict", "shpbxpage", "field", "fldinst", "annotation", "atnid",
    "atnauthor", "atnref", "atndate", "footer", "footerl", "footerr",
    "footerf", "header", "headerl", "headerr", "headerf", "footnote",
    "ftnsep", "ftnsepc", "ftncn", "aftnsep", "aftnsepc", "aftncn",
}
_HTML_SKIP = {
    "script", "style", "noscript", "svg", "head", "title", "meta",
    "link", "template",
}

# Block-level elements that imply a line break in the output.
_HTML_BLOCK = {
    "p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6",
    "section", "article", "blockquote", "pre", "table", "ul", "ol", "hr",
}

_W_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_A_NS = "{http://schemas.openxmlformats.org/drawingml/2006/main}"


class UnsupportedDocument(Exception):
    """Raised when a document cannot be extracted. The message is shown
    to the human, so it must be actionable rather than diagnostic."""


# ── plain text ──────────────────────────────────────────────────────────────

def _extract_text(data: bytes) -> str:
    """Decode a plain-text file, tolerating whatever encoding it claims."""
    for encoding in ("utf-8", "utf-8-sig", "utf-16", "latin-1"):
        try:
            return data.decode(encoding)
        except (UnicodeDecodeError, UnicodeError):
            continue
    # latin-1 cannot fail, so this is unreachable in practice; kept so the
    # function is total rather than accidentally raising.
    return data.decode("utf-8", errors="replace")


# ── OOXML (docx / xlsx / pptx) ──────────────────────────────────────────────

def _ooxml_paragraphs(root: ElementTree.Element, tag: str) -> list[str]:
    """Every <tag> element's concatenated text, in document order."""
    out: list[str] = []
    for el in root.iter(tag):
        text = "".join(t.text or "" for t in el.iter() if t.tag.endswith("}t"))
        if text.strip():
            out.append(text)
    return out


def _open_zip(data: bytes, what: str) -> zipfile.ZipFile:
    """Open a zip, converting a bad archive into an actionable refusal.

    A truncated or corrupt download is a common real-world case, and it must
    never surface as a traceback — the human needs to be told the file is
    damaged, not shown a stack trace.
    """
    try:
        return zipfile.ZipFile(BytesIO(data))
    except zipfile.BadZipFile:
        raise UnsupportedDocument(
            f"That {what} is damaged or incomplete — it is not a readable Office "
            "file. Try re-downloading or re-saving it, or paste the text in."
        )
    except (OSError, ValueError) as exc:
        raise UnsupportedDocument(f"That {what} could not be opened ({exc}).")


def _extract_docx(data: bytes) -> str:
    with _open_zip(data, ".docx") as zf:
        names = set(zf.namelist())
        # The main document part is the one that matters; headers, footers
        # and footnotes are boilerplate that would pollute the ingest.
        part = "word/document.xml"
        if part not in names:
            candidates = sorted(n for n in names if n.startswith("word/") and n.endswith(".xml"))
            if not candidates:
                raise UnsupportedDocument(
                    "That .docx has no readable document part — it may be a template "
                    "or a renamed file. Try opening it in Word and copying the text."
                )
            part = candidates[0]
        try:
            xml = zf.read(part)
        except (zipfile.BadZipFile, OSError, KeyError) as exc:
            raise UnsupportedDocument(f"That .docx could not be opened ({exc}).")
    try:
        root = ElementTree.fromstring(xml)
    except ElementTree.ParseError:
        raise UnsupportedDocument(
            "That .docx has a malformed document part. Try re-saving it from Word, "
            "or copy the text in directly."
        )
    paras = _ooxml_paragraphs(root, f"{_W_NS}p")
    if not paras:
        raise UnsupportedDocument(
            "That .docx contained no text paragraphs — it may be images only. "
            "Prism does not do OCR; paste the text in instead."
        )
    return "\n\n".join(paras)


def _extract_xlsx(data: bytes) -> str:
    """Sheets as `## SheetName` sections with tab-separated cells."""
    with _open_zip(data, ".xlsx") as zf:
        names = zf.namelist()
        shared: list[str] = []
        if "xl/sharedStrings.xml" in names:
            try:
                root = ElementTree.fromstring(zf.read("xl/sharedStrings.xml"))
                shared = [
                    "".join(t.text or "" for t in si.iter() if t.tag.endswith("}t"))
                    for si in root
                ]
            except ElementTree.ParseError:
                shared = []

        # Sheet NAMES live in workbook.xml, but they are keyed by relationship
        # id (r:id), not by part filename — so the rels file is required to
        # map rId1 -> worksheets/sheet1.xml. Without this every sheet is
        # labelled "SheetN" and the human loses the only meaningful label in
        # the output. An unresolved mapping falls back to the part name, which
        # is worse but not wrong.
        rel_target: dict[str, str] = {}
        if "xl/_rels/workbook.xml.rels" in names:
            try:
                rels = ElementTree.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
                for rel in rels:
                    rid = rel.get("Id") or ""
                    target = rel.get("Target") or ""
                    if rid and target:
                        # Targets are relative to xl/, e.g. "worksheets/sheet1.xml".
                        rel_target[rid] = "xl/" + target.lstrip("/").removeprefix("xl/")
            except ElementTree.ParseError:
                rel_target = {}

        sheet_names: dict[str, str] = {}
        if "xl/workbook.xml" in names:
            try:
                wb = ElementTree.fromstring(zf.read("xl/workbook.xml"))
                for i, sh in enumerate(wb.iter()):
                    if sh.tag.endswith("}sheet"):
                        rid = sh.get(
                            "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id", ""
                        )
                        name = sh.get("name") or f"Sheet{i + 1}"
                        if rid and rid in rel_target:
                            sheet_names[rel_target[rid]] = name
                        elif rid:
                            # No rels: fall back to positional, which is right
                            # for the common single-sheet workbook.
                            sheet_names[f"xl/worksheets/sheet{i + 1}.xml"] = name
            except ElementTree.ParseError:
                sheet_names = {}

        sheets = sorted(n for n in names if n.startswith("xl/worksheets/sheet") and n.endswith(".xml"))
        if not sheets:
            raise UnsupportedDocument("That .xlsx has no readable worksheets.")

        out: list[str] = []
        for idx, name in enumerate(sheets, start=1):
            try:
                ws = ElementTree.fromstring(zf.read(name))
            except (ElementTree.ParseError, KeyError):
                continue
            title = sheet_names.get(name, f"Sheet{idx}")
            rows: list[str] = []
            for row in ws.iter():
                if not row.tag.endswith("}row"):
                    continue
                cells: list[str] = []
                for cell in row:
                    if not cell.tag.endswith("}c"):
                        continue
                    ctype = cell.get("t", "")
                    v = None
                    for child in cell:
                        if child.tag.endswith("}v"):
                            v = child.text
                        elif child.tag.endswith("}is"):
                            v = "".join(t.text or "" for t in child.iter() if t.tag.endswith("}t"))
                    if v is None:
                        cells.append("")
                    elif ctype == "s":
                        try:
                            cells.append(shared[int(v)])
                        except (ValueError, IndexError):
                            cells.append("")
                    else:
                        cells.append(v)
                if any(c.strip() for c in cells):
                    rows.append("\t".join(cells))
            if rows:
                out.append(f"## {title}\n" + "\n".join(rows))
        if not out:
            raise UnsupportedDocument("That .xlsx contained no readable cell values.")
        return "\n\n".join(out)


def _extract_pptx(data: bytes) -> str:
    with zipfile.ZipFile(BytesIO(data)) as zf:
        slides = sorted(
            n for n in zf.namelist()
            if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)
        )
        if not slides:
            raise UnsupportedDocument("That .pptx has no slides — it may be a template.")

        def slide_num(name: str) -> int:
            m = re.search(r"slide(\d+)\.xml", name)
            return int(m.group(1)) if m else 0

        out: list[str] = []
        for name in sorted(slides, key=slide_num):
            try:
                root = ElementTree.fromstring(zf.read(name))
            except ElementTree.ParseError:
                continue
            paras = _ooxml_paragraphs(root, f"{_A_NS}p")
            if paras:
                out.append(f"## Slide {slide_num(name)}\n" + "\n".join(paras))
        if not out:
            raise UnsupportedDocument(
                "That .pptx contained no text — the slides are images. Prism does "
                "not do OCR; paste the text in instead."
            )
        return "\n\n".join(out)


# ── HTML ────────────────────────────────────────────────────────────────────

class _HTMLText(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip_depth = 0
        self._href: str | None = None
        self._in_link = False

    def handle_starttag(self, tag, attrs):
        if tag in _HTML_SKIP:
            self._skip_depth += 1
            return
        if tag in _HTML_BLOCK:
            self.parts.append("\n")
        if tag == "a":
            # An href attribute can be present with no value, so coerce.
            href = dict(attrs).get("href") or ""
            # Only keep the link target if it is a real web link; F14
            # downgrades non-http(s) schemes at render time, and a
            # javascript: href has no business surviving into the vault.
            if href.startswith(("http://", "https://")):
                self._in_link = True
                self._href = href

    def handle_endtag(self, tag):
        if tag in _HTML_SKIP:
            self._skip_depth = max(0, self._skip_depth - 1)
            return
        if tag in _HTML_BLOCK:
            self.parts.append("\n")
        if tag == "a" and self._in_link:
            if self._href:
                self.parts.append(f" <{self._href}>")
            self._in_link = False
            self._href = None

    def handle_data(self, data):
        if self._skip_depth:
            return
        if data.strip():
            self.parts.append(data)

    def text(self) -> str:
        raw = "".join(self.parts)
        raw = re.sub(r"[ \t]+", " ", raw)
        raw = re.sub(r" *\n *", "\n", raw)
        raw = re.sub(r"\n{3,}", "\n\n", raw)
        return raw.strip()


def _extract_html(data: bytes) -> str:
    try:
        src = data.decode("utf-8")
    except UnicodeDecodeError:
        src = data.decode("latin-1")
    parser = _HTMLText()
    try:
        parser.feed(src)
        parser.close()
    except Exception as exc:  # malformed markup must not 500
        raise UnsupportedDocument(f"That HTML could not be parsed ({exc}).")
    out = parser.text()
    if not out:
        raise UnsupportedDocument(
            "That HTML had no readable text — it may be an empty page or all "
            "scripts. Paste the text in instead."
        )
    return out


# ── RTF ─────────────────────────────────────────────────────────────────────

# RTF escapes: \ followed by a non-letter is that literal character.
_RTF_ESCAPES = {"\\": "\\", "{": "{", "}": "}"}
_RTF_HEX = re.compile(r"\\'([0-9a-fA-F]{2})")
# Control words: \word optionally followed by a numeric parameter.
_RTF_CONTROL = re.compile(r"\\([a-zA-Z]+)(-?\d+)?[ ]?")


def _extract_rtf(data: bytes) -> str:
    try:
        src = data.decode("latin-1")
    except Exception:
        raise UnsupportedDocument("That RTF could not be decoded.")

    # The group nesting is meaningful: a destination like \pict or \fonttbl
    # contains metadata that must be skipped, and that content ends at the
    # matching closing brace.
    #
    # The subtlety is that RTF does NOT wrap every destination in its own
    # group. `{\fonttbl {\f0\fnil Calibri;}}` opens a group first, but many
    # writers emit tables without a dedicated enclosing brace, and several
    # tables commonly share ONE enclosing group. So "push a frame when I see
    # a destination" is wrong in both directions:
    #
    #   - with a frame: the frame is popped by the NEXT brace, which belongs
    #     to something else, and the stack desynchronises permanently.
    #   - marking the enclosing group: the mark is never cleared, so the rest
    #     of the document is skipped and the file comes back EMPTY.
    #
    # The rule that actually holds: a destination's content runs until the
    # next \par/\line or the closing brace, whichever comes first. So track a
    # "destination active" counter that is ended by a paragraph break rather
    # than by brace balance, and keep the group stack purely for nesting.
    out: list[str] = []
    stack: list[bool] = []          # True == this group is ignorable
    in_destination = False          # inside \fonttbl / \pict / ... content
    i = 0
    n = len(src)
    skipping = lambda: any(stack) or in_destination   # noqa: E731

    while i < n:
        ch = src[i]
        if ch == "\\":
            if i + 1 < n and src[i + 1] in _RTF_ESCAPES:
                if not skipping():
                    out.append(_RTF_ESCAPES[src[i + 1]])
                i += 2
                continue
            m = _RTF_CONTROL.match(src, i)
            if m:
                word = m.group(1)
                if word in _RTF_DESTINATIONS:
                    in_destination = True
                elif word in ("par", "line", "pard", "sect", "row", "cell"):
                    in_destination = False
                if not skipping():
                    if word in ("par", "line", "pard"):
                        out.append("\n")
                    elif word in ("cell", "row"):
                        out.append("\t")
                    elif word == "tab":
                        out.append("\t")
                    elif word in ("emdash", "endash"):
                        out.append("-")
                    elif word in ("lquote", "rquote"):
                        out.append("'")
                    elif word in ("ldblquote", "rdblquote"):
                        out.append('"')
                    elif word == "bullet":
                        out.append("* ")
                i = m.end()
                continue
            h = _RTF_HEX.match(src, i)
            if h:
                if not skipping():
                    try:
                        out.append(bytes([int(h.group(1), 16)]).decode("cp1252", "replace"))
                    except ValueError:
                        pass
                i = h.end()
                continue
            i += 2
            continue
        if ch == "{":
            # A new group inherits "skipped" status; {\* additionally marks
            # the group itself ignorable.
            stack.append(skipping())
            i += 1
            continue
        if ch == "}":
            if stack:
                stack.pop()
            # A closing brace also ends an unbraced destination.
            in_destination = False
            i += 1
            continue
        if not skipping() and ch not in ("\r", "\n"):
            out.append(ch)
        i += 1

    text = re.sub(r"[ \t]+", " ", "".join(out))
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = text.strip()
    if not text:
        raise UnsupportedDocument("That RTF contained no readable text.")
    return text


# ── PDF (best effort, refuses loudly) ──────────────────────────────────────

_PDF_STREAM = re.compile(rb"stream\r?\n(.*?)endstream", re.DOTALL)
# Text-showing operators inside a content stream.
_PDF_SHOW = re.compile(rb"\((?:\\.|[^\\()])*\)\s*Tj|\[(?:[^\[\]]|\\.)*\]\s*TJ")
_PDF_LITERAL = re.compile(rb"\((?:\\.|[^\\()])*\)", re.DOTALL)
_PDF_ESCAPES = {
    b"n": b"\n", b"r": b"\r", b"t": b"\t", b"b": b"\b",
    b"f": b"\f", b"\\": b"\\", b"(": b"(", b")": b")",
}


def _pdf_unescape(raw: bytes) -> str:
    """Turn a PDF literal string's bytes into text, dropping octal escapes.

    Non-ASCII bytes are kept as latin-1. PDF font encodings can remap these
    into arbitrary glyphs; decoding is a best guess by definition, which is
    exactly why a low-yield result is refused rather than returned.
    """
    out = bytearray()
    i = 0
    n = len(raw)
    while i < n:
        c = raw[i:i + 1]
        if c == b"\\" and i + 1 < n:
            nxt = raw[i + 1:i + 2]
            if nxt in _PDF_ESCAPES:
                out += _PDF_ESCAPES[nxt]
                i += 2
                continue
            if nxt.isdigit():
                octal = raw[i + 1:i + 4]
                digits = bytes(ch for ch in octal if 0x30 <= ch <= 0x37)
                if digits:
                    out.append(int(digits, 8) & 0xFF)
                    i += 1 + len(digits)
                    continue
            # Line continuation: backslash + newline.
            if nxt in (b"\n", b"\r"):
                i += 2
                continue
            out += nxt
            i += 2
            continue
        out += c
        i += 1
    return out.decode("latin-1", "replace")


def _extract_pdf(data: bytes) -> str:
    if not data.startswith(b"%PDF"):
        raise UnsupportedDocument("That file is not a PDF (missing the %PDF header).")

    chunks: list[str] = []
    for m in _PDF_STREAM.finditer(data):
        blob = m.group(1)
        # Content streams are usually Flate-compressed; try that first,
        # then fall back to the raw bytes (uncompressed PDFs).
        payloads = []
        try:
            payloads.append(zlib.decompress(blob))
        except zlib.error:
            try:
                payloads.append(zlib.decompressobj().decompress(blob))
            except zlib.error:
                payloads.append(blob)

        for payload in payloads:
            if b"Tj" not in payload and b"TJ" not in payload:
                continue
            for lit in _PDF_LITERAL.findall(payload):
                text = _pdf_unescape(lit[1:-1])
                if text.strip():
                    chunks.append(text)
            break  # one interpretation per stream is enough

    text = " ".join(chunks)
    text = re.sub(r"[ \t]+", " ", text).strip()

    # The credibility check, and the reason this function can refuse at all.
    #
    # A scanned or image-only PDF yields no text operators, so we get nothing.
    # A font-subset PDF yields bytes that decode to replacement characters
    # and control codes — technically "text", useless in practice. Both must
    # be refused rather than returned, because a fragment in the ingest queue
    # looks like content to a human skimming it, and would be refracted from
    # as though a person had written it.
    #
    # The test is therefore not just length but legibility: a real extraction
    # is dominated by ordinary printable characters. This must not be a bare
    # length floor, or a legitimate three-line memo is rejected for being
    # short — which is a real failure mode, and one that punishes exactly the
    # small notes a person is most likely to drop in.
    if text:
        printable = sum(1 for c in text if c.isprintable() or c in " \n")
        ratio = printable / len(text)
    else:
        ratio = 0.0

    if len(text) < 20 or ratio < 0.85:
        raise UnsupportedDocument(
            "Prism could not read text out of that PDF — most likely a scan, an "
            "image-based document, or a font encoding Prism does not handle. Prism "
            "does not do OCR. Open it, select the text, and paste it in here."
        )
    return text


# ── dispatch ────────────────────────────────────────────────────────────────

_PLAIN = {".md", ".markdown", ".txt", ".text", ".csv", ".tsv", ".json", ".log", ".yaml", ".yml"}


def extract_document(data: bytes, filename: str) -> tuple[str, str]:
    """Return (text, extractor_name) for a document.

    Raises UnsupportedDocument with a human-facing message when the document
    cannot be read. Never returns empty text and never returns a guess
    without saying which extractor produced it, so callers can record the
    provenance honestly.
    """
    if not data:
        raise UnsupportedDocument("That file is empty.")

    name = (filename or "").lower()
    ext = "." + name.rsplit(".", 1)[-1] if "." in name else ""

    if ext in _PLAIN:
        return _extract_text(data), "plain text"

    if ext in (".docx", ".docm"):
        return _extract_docx(data), "docx"
    if ext in (".xlsx", ".xlsm"):
        return _extract_xlsx(data), "xlsx"
    if ext in (".pptx", ".pptm"):
        return _extract_pptx(data), "pptx"
    if ext in (".html", ".htm", ".xhtml"):
        return _extract_html(data), "html"
    if ext == ".rtf":
        return _extract_rtf(data), "rtf"
    if ext == ".pdf":
        return _extract_pdf(data), "pdf (best effort)"

    # Unknown extension: sniff. OOXML and RTF and PDF have magic bytes.
    if data[:2] == b"PK":
        try:
            return _extract_docx(data), "docx (sniffed)"
        except UnsupportedDocument:
            for fn, label in ((_extract_xlsx, "xlsx (sniffed)"),
                              (_extract_pptx, "pptx (sniffed)")):
                try:
                    return fn(data), label
                except (UnsupportedDocument, zipfile.BadZipFile):
                    continue
            raise UnsupportedDocument(
                f"Prism recognised {ext or 'that file'} as a zip archive but could not "
                "find readable text in it."
            )
    if data[:5] == b"{\\rtf":
        return _extract_rtf(data), "rtf (sniffed)"
    if data[:4] == b"%PDF":
        return _extract_pdf(data), "pdf (best effort, sniffed)"
    if b"<html" in data[:2048].lower() or data[:1] == b"<":
        return _extract_html(data), "html (sniffed)"

    # A JSON file with an odd extension is still worth a try.
    stripped = data.lstrip()
    if stripped[:1] in (b"{", b"["):
        try:
            json.loads(stripped.decode("utf-8"))
            return _extract_text(data), "json (sniffed)"
        except (ValueError, UnicodeDecodeError):
            pass

    raise UnsupportedDocument(
        f"Prism cannot read {ext or 'that file type'} — it reads plain text, Markdown, "
        "CSV, JSON, HTML, RTF, PDF, and the Office formats (docx, xlsx, pptx). "
        "Open the file and paste the text in instead."
    )
