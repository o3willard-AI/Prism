"""Build genuine fixture documents for the extract tests.

Real bytes, not mocks: a docx written by zipfile that Word would open, a
minimal but structurally correct PDF, genuine RTF with a font table and
group nesting, and HTML with script/style chrome that must not survive.
"""
import zipfile
import zlib
from io import BytesIO


def make_docx(paragraphs):
    body = "".join(
        f"<w:p><w:r><w:t xml:space=\"preserve\">{p}</w:t></w:r></w:p>"
        for p in paragraphs
    )
    doc = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{body}</w:body></w:document>"
    )
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("word/document.xml", doc)
        zf.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types/>')
    return buf.getvalue()


def make_xlsx(shared, rows):
    """rows: list of list of (cell_type, value) — ('s',idx) or ('n','42')."""
    strings = "".join(
        f"<si><t xml:space=\"preserve\">{s}</t></si>" for s in shared
    )
    sheet_rows = ""
    for r_i, row in enumerate(rows, start=1):
        cells = ""
        for c_i, (ctype, val) in enumerate(row):
            ref = f"{chr(ord('A') + c_i)}{r_i}"
            if ctype == "s":
                cells += f'<c r="{ref}" t="s"><v>{val}</v></c>'
            else:
                cells += f'<c r="{ref}"><v>{val}</v></c>'
        sheet_rows += f'<row r="{r_i}">{cells}</row>'
    sheet = (
        '<?xml version="1.0"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f"<sheetData>{sheet_rows}</sheetData></worksheet>"
    )
    workbook = (
        '<?xml version="1.0"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="Findings" sheetId="1" r:id="rId1"/></sheets></workbook>'
    )
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("xl/sharedStrings.xml",
                    '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                    f"{strings}</sst>")
        zf.writestr("xl/workbook.xml", workbook)
        zf.writestr("xl/_rels/workbook.xml.rels",
                    '<?xml version="1.0"?>'
                    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                    '<Relationship Id="rId1" '
                    'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
                    'Target="worksheets/sheet1.xml"/>'
                    '</Relationships>')
        zf.writestr("xl/worksheets/sheet1.xml", sheet)
    return buf.getvalue()


def make_pptx(slides):
    """slides: list of list of paragraph strings."""
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types/>')
        for i, paras in enumerate(slides, start=1):
            body = "".join(
                f'<a:p><a:r><a:t>{p}</a:t></a:r></a:p>' for p in paras
            )
            slide = (
                '<?xml version="1.0"?>'
                '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
                'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
                f"<p:cSld><p:spTree>{body}</p:spTree></p:cSld></p:sld>"
            )
            zf.writestr(f"ppt/slides/slide{i}.xml", slide)
    return buf.getvalue()


def make_rtf(text, with_table=True):
    header = r"{\rtf1\ansi\deff0"
    if with_table:
        header += (
            r"{\fonttbl{\f0\fnil Calibri;}"
            r"{\colortbl;\red0\green0\blue0;}"
            r"{\stylesheet{\s0 Normal;}}"
        )
    return (header + "\n" + text + "\n}").encode("latin-1")


def make_pdf(lines, compress=False, header=b"%PDF-1.4\n"):
    """A structurally valid single-page PDF carrying the given text lines."""
    ops = ["BT", "/F1 12 Tf", "72 720 Td"]
    for line in lines:
        safe = line.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")
        ops.append(f"({safe}) Tj")
        ops.append("0 -16 Td")
    ops.append("ET")
    content = ("\n".join(ops)).encode("latin-1")
    if compress:
        stream = zlib.compress(content)
        extra = b" /Filter /FlateDecode"
    else:
        stream = content
        extra = b""
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode() + extra + b" >>\nstream\n"
        + stream + b"\nendstream",
    ]
    out = bytearray(header)
    offsets = []
    for i, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
    xref_at = len(out)
    out += f"xref\n0 {len(objs) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += (f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n"
            f"{xref_at}\n%%EOF\n").encode()
    return bytes(out)


def make_scanned_pdf():
    """A valid PDF with no text operators at all — an image-only 'scan'."""
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << >> /Contents 4 0 R >>",
        b"<< /Length 24 >>\nstream\nq 100 0 0 100 0 0 cm Q\nendstream",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
    xref_at = len(out)
    out += f"xref\n0 {len(objs) + 1}\n".encode() + b"0000000000 65535 f \n"
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += (f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n"
            f"{xref_at}\n%%EOF\n").encode()
    return bytes(out)
