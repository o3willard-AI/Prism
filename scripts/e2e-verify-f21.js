// Prism end-to-end regression test — F21: external document ingest.
//
// The backlog item was "external documents (PDF/DOCX/HTML) can't be
// ingested". F21 closes it with a stdlib-only extractor, which makes two
// classes of regression worth guarding:
//
//   1. EXTRACTION. Real document bytes in, real text out. These tests build
//      genuine fixtures (a zip-based docx Word would open, a structurally
//      valid PDF, RTF with a font table) rather than mocking the parsers —
//      a mocked parser tests the mock.
//
//   2. REFUSAL. The design decision worth protecting is that an unreadable
//      document is REFUSED LOUDLY. A best-effort extractor that returns
//      mojibake instead of failing would be strictly worse than one that
//      says "this is a scan, paste the text in" — because the human cannot
//      tell the difference, and the vault ends up full of noise that a lens
//      later refracts as though a person had written it.
//
// It also asserts the security posture: the read-only path must not write to
// the vault, path traversal in the filename must be neutralised, and both
// size caps must refuse rather than truncate.

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 8082);
const API = `http://127.0.0.1:${PORT}`;
const VAULT_QUEUE = path.join(ROOT, 'prism', 'vault', 'ingestion', 'unprocessed');

let pass = 0, fail = 0;
const section = (s) => console.log('\n' + s);
const check = (name, cond, detail) => {
  if (cond) { console.log('  PASS ' + name); pass++; }
  else { console.log('  FAIL ' + name + (detail ? '  — ' + detail : '')); fail++; }
};

// The extractor is Python; drive it in-process rather than shelling out per
// case, so the suite is fast and the fixtures stay in one place.
const require = createRequire(import.meta.url);
const FIXTURES = path.join(__dirname, 'lib', 'fixtures.py');

function pyExtract() {
  // Writes a tiny driver, runs it once, and returns a JSON map of
  // case-name -> {text, extractor} or {error}.
  const { execFileSync } = require('node:child_process');
  const driver = `
import json, sys, base64
sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'prism'))})
sys.path.insert(0, ${JSON.stringify(path.join(__dirname, 'lib'))})
import extract, fixtures

CASES = {
  "docx":        (fixtures.make_docx(["Quarterly findings", "Revenue grew in EMEA"]), "findings.docx"),
  "docx_empty":  (fixtures.make_docx([]), "empty.docx"),
  "docx_corrupt":(b"PK\\x03\\x04garbage", "broken.docx"),
  "xlsx":        (fixtures.make_xlsx(["Region", "Revenue"], [[("s",0),("n","42")]]), "data.xlsx"),
  "pptx":        (fixtures.make_pptx([["Deck title"], ["slide two"]]), "deck.pptx"),
  "rtf":         (fixtures.make_rtf(r"RTF body.\\par second line"), "note.rtf"),
  "rtf_pict":    (fixtures.make_rtf(r"{\\pict junkbytes}real text here"), "p.rtf"),
  "rtf_twotbl":  (fixtures.make_rtf(r"{\\fonttbl{\\f0 X;}{\\colortbl;\\red0;}visible text"), "t.rtf"),
  "html":        (b"<html><head><title>NO</title><style>x{}</style><script>1</script></head><body><h1>Real</h1><p>Body</p><a href='https://e.com'>l</a><a href='javascript:bad()'>b</a></body></html>", "p.html"),
  "html_empty":  (b"<html><body><script>x</script></body></html>", "e.html"),
  "pdf_plain":   (fixtures.make_pdf(["PDF line one here", "PDF line two here", "PDF line three"]), "p.pdf"),
  "pdf_flate":   (fixtures.make_pdf([f"Compressed line {i} with text to extract" for i in range(12)], compress=True), "c.pdf"),
  "pdf_scan":    (fixtures.make_scanned_pdf(), "s.pdf"),
  "pdf_fake":    (b"not a pdf at all", "f.pdf"),
  "pdf_short":   (fixtures.make_pdf(["tiny"]), "tiny.pdf"),
  "txt":         (b"plain text body", "a.txt"),
  "md":          (b"# Heading\\n\\nbody", "a.md"),
  "csv":         (b"a,b\\n1,2", "a.csv"),
  "unknown":     (b"\\x00\\x01\\x02binary", "thing.xyz"),
  "empty_file":  (b"", "e.txt"),
  "sniff_docx":  (fixtures.make_docx(["Sniffed body"]), "mystery.dat"),
  "sniff_rtf":   (fixtures.make_rtf(r"sniffed rtf text"), "mystery.dat"),
  "sniff_pdf":   (fixtures.make_pdf(["Sniffed pdf line one", "sniffed pdf line two", "three"]), "mystery.dat"),
  "html_va":     (b'<html><body><p>title</p><a href="java\\nscript:alert(1)">x</a></body></html>', "x.html"),
}
out = {}
for k, (raw, name) in CASES.items():
    try:
        text, ext = extract.extract_document(raw, name)
        out[k] = {"text": text, "extractor": ext}
    except extract.UnsupportedDocument as e:
        out[k] = {"error": str(e)}
# Raw bytes for the HTTP tests, which need a genuine document on the wire
# rather than the text that came out of it.
out["docx_bytes_base64"] = base64.b64encode(
    fixtures.make_docx(["chat only text"])).decode()
print(json.dumps(out))
`;
  const driverPath = '/tmp/prism-f21-extract-driver.py';
  fs.writeFileSync(driverPath, driver);
  const stdout = execFileSync('python3', [driverPath], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

function postDocument(endpoint, raw, name, headers = {}) {
  return new Promise((resolve) => {
    const req = http.request(
      `${API}${endpoint}`,
      { method: 'POST', headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': raw.length,
        'X-File-Name': encodeURIComponent(name),
        ...headers,
      } },
      (res) => {
        let b = '';
        res.on('data', d => b += d);
        res.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(b); } catch { /* keep null */ }
          resolve({ status: res.statusCode, body: parsed });
        });
      },
    );
    req.on('error', () => resolve({ status: 0, body: null }));
    req.end(raw);
  });
}

const { execFileSync } = require('node:child_process');

(async () => {
  // Extraction runs first: the freshness probe needs real document bytes, and
  // so does everything else below.
  const X = pyExtract();

  // ── 0. The server under test must be the code on disk ────────────────────
  // This suite talks to a long-running process. A stale server makes every
  // HTTP check meaningless — the green run would be testing yesterday's
  // binary, which is exactly how "C: make extract-document stage anyway"
  // appeared to pass while the fix was already in the file. Verify the
  // running server actually has this suite's endpoints before trusting
  // anything below.
  section('Server freshness — a stale process makes every check below a lie');
  const apiSrcFresh = fs.readFileSync(path.join(ROOT, 'prism', 'api-server.py'), 'utf8');
  const live = await postDocument('/extract-document', Buffer.from('freshness probe'), 'f21fresh.txt');
  check('the running server answers /extract-document at all',
        live.status === 200 || live.status === 422, live.status);
  check('the server on disk defines the read-only path',
        /handle_ingest_document\(stage=False\)/.test(apiSrcFresh));
  {
    // A docx on the wire must be staged by /ingest-document and NOT by
    // /extract-document. If the running process disagrees, it is stale.
    const s = await postDocument('/ingest-document',
      Buffer.from(X.docx_bytes_base64, 'base64'), 'f21fresh2.docx');
    check('the running server stages via /ingest-document',
          s.status === 200 && !!s.body.path, `${s.status}`);
    const beforeF = new Set(fs.readdirSync(VAULT_QUEUE));
    const e = await postDocument('/extract-document',
      Buffer.from(X.docx_bytes_base64, 'base64'), 'f21fresh3.docx');
    const afterF = new Set(fs.readdirSync(VAULT_QUEUE));
    check('the running server does NOT stage via /extract-document',
          afterF.size === beforeF.size && !('path' in (e.body || {})),
          'restart the server if this fails');
  }

  // ── 1. Extraction against real document bytes ────────────────────────────
  section('Extraction — real bytes in, real text out');

  check('docx: paragraphs are extracted',
        /Quarterly findings/.test(X.docx.text) && /Revenue grew in EMEA/.test(X.docx.text),
        X.docx.text || X.docx.error);
  check('docx: named by the docx reader', X.docx.extractor === 'docx', X.docx.extractor);

  check('xlsx: sheet NAME is preserved, not "Sheet1"',
        /## Findings/.test(X.xlsx.text), X.xlsx.text);
  check('xlsx: shared strings and numbers both appear',
        /Region/.test(X.xlsx.text) && /42/.test(X.xlsx.text), X.xlsx.text);

  check('pptx: slides are separated and titled',
        /## Slide 1/.test(X.pptx.text) && /## Slide 2/.test(X.pptx.text), X.pptx.text);
  check('pptx: slide order is numeric, not lexical',
        X.pptx.text.indexOf('Deck title') < X.pptx.text.indexOf('slide two'));

  check('rtf: text survives and \\par becomes a newline',
        /RTF body\./.test(X.rtf.text) && /second line/.test(X.rtf.text), X.rtf.text);
  check('rtf: \\pict binary is dropped but following text is NOT',
        X.rtf_pict.text.trim() === 'real text here', JSON.stringify(X.rtf_pict.text));
  check('rtf: two tables in one group do not swallow the document',
        /visible text/.test(X.rtf_twotbl.text), JSON.stringify(X.rtf_twotbl.text));
  check('rtf: a font table is never emitted as body text',
        !/Calibri|fnil|fonttbl/.test(X.rtf.text + X.rtf_twotbl.text));

  check('html: <title>, <style> and <script> are stripped',
        !/NO|x\{\}|script/.test(X.html.text), X.html.text);
  check('html: real content survives',
        /Real/.test(X.html.text) && /Body/.test(X.html.text), X.html.text);
  check('html: http links are kept',
        /<https:\/\/e\.com>/.test(X.html.text), X.html.text);
  check('html: a javascript: href does not survive extraction',
        !/javascript:/i.test(X.html.text), X.html.text);
  check('html: newline-obfuscated javascript: is not resurrected',
        !/java\s*script\s*:/i.test(X.html_va.text), X.html_va.text);

  check('pdf: uncompressed text is extracted',
        /PDF line one here/.test(X.pdf_plain.text), X.pdf_plain.text);
  check('pdf: Flate-compressed text is extracted',
        /Compressed line 0/.test(X.pdf_flate.text), X.pdf_flate.text);
  check('pdf: the reader labels itself best-effort',
        /best effort/.test(X.pdf_plain.extractor), X.pdf_plain.extractor);

  check('txt/md/csv pass through as text',
        X.txt.text === 'plain text body' &&
        /# Heading/.test(X.md.text) && /a,b/.test(X.csv.text));

  // ── 2. Refusals must be loud and specific ───────────────────────────────
  section('Refusals — loud, specific, and actionable');
  const refused = (k) => !!X[k].error;
  const says = (k, re) => re.test(X[k].error || '');

  check('a scanned PDF is refused', refused('pdf_scan'));
  check('the refusal says it is likely a scan and names OCR',
        says('pdf_scan', /scan/i) && says('pdf_scan', /OCR/i), X.pdf_scan.error);
  check('the refusal tells the human what to do next',
        says('pdf_scan', /paste/i), X.pdf_scan.error);

  check('a too-short PDF is refused rather than half-ingested',
        refused('pdf_short'), JSON.stringify(X.pdf_short));
  check('a non-PDF with a .pdf name is refused',
        refused('pdf_fake') && says('pdf_fake', /%PDF/), X.pdf_fake.error);

  check('a corrupt docx is refused, not a traceback',
        refused('docx_corrupt') && says('docx_corrupt', /damaged|incomplete/i),
        X.docx_corrupt.error);
  check('a docx with no text paragraphs is refused',
        refused('docx_empty') && says('docx_empty', /no text|OCR/i), X.docx_empty.error);
  check('empty HTML is refused', refused('html_empty'), X.html_empty.error);
  check('an unknown binary type is refused and the list is named',
        refused('unknown') && says('unknown', /cannot read/i), X.unknown.error);
  check('an empty file is refused', refused('empty_file'), X.empty_file.error);

  check('no refusal message leaks a traceback or exception class',
        Object.entries(X).every(([k, v]) =>
          !v.error || !/Traceback|Error:|Exception|line \d+/.test(v.error)),
        Object.entries(X).filter(([, v]) =>
          v.error && /Traceback|Error:/.test(v.error)).map(([k]) => k).join(','));

  // ── 3. Format sniffing ───────────────────────────────────────────────────
  section('Format sniffing — a wrong extension must not lose the document');
  check('a docx named .dat is still read',
        /Sniffed body/.test(X.sniff_docx.text), X.sniff_docx.text);
  check('an RTF named .dat is still read',
        /sniffed rtf text/.test(X.sniff_rtf.text), X.sniff_rtf.text);
  check('a PDF named .dat is still read',
        /Sniffed pdf line one/.test(X.sniff_pdf.text), X.sniff_pdf.text);
  check('sniffing is disclosed, not silent',
        /sniffed/.test(X.sniff_docx.extractor), X.sniff_docx.extractor);

  // ── 4. HTTP surface ──────────────────────────────────────────────────────
  section('HTTP surface — staging, privacy, traversal, caps');
  const before = new Set(fs.readdirSync(VAULT_QUEUE));

  const staged = await postDocument('/ingest-document',
    X && Buffer.from('Quarterly findings\nRevenue grew in EMEA\n'),
    'f21probe.md', { 'X-Artifact-Type': 'application' });
  check('a readable document stages successfully',
        staged.status === 200 && !!staged.body.path,
        `${staged.status} ${JSON.stringify(staged.body)}`);
  check('the staged path is inside the unprocessed queue',
        (staged.body.path || '').startsWith('ingestion/unprocessed/'), staged.body.path);
  check('the response reports the extractor and size honestly',
        !!staged.body.extractor && staged.body.chars > 0,
        JSON.stringify({ e: staged.body.extractor, c: staged.body.chars }));

  const priv = await postDocument('/ingest-document',
    Buffer.from('confidential text here'), 'f21secret.md', { 'X-Private': 'true' });
  check('the privacy flag produces a -private artifact',
        /-private\.md$/.test(priv.body.path || ''), priv.body.path);

  const trav = await postDocument('/ingest-document',
    Buffer.from('traversal attempt'), '../../etc/passwd.txt');
  check('a traversing filename cannot escape the queue',
        (trav.body.path || '').startsWith('ingestion/unprocessed/'), trav.body.path);
  check('the traversal payload is flattened into a safe name',
        !/\.\./.test(trav.body.path || ''), trav.body.path);

  const noName = await postDocument('/ingest-document', Buffer.from('x'), '');
  check('a missing filename is refused', noName.status === 400, noName.status);

  const scan = await postDocument('/ingest-document',
    Buffer.from('%PDF-1.4\nno text operators here\n%%EOF'), 'f21scan.pdf');
  check('an unreadable PDF is 422, not 500',
        scan.status === 422, `${scan.status} ${JSON.stringify(scan.body)}`);
  check('the 422 body carries the actionable reason',
        /scan|OCR|paste/i.test(scan.body.error || ''), scan.body.error);
  check('a refused document stages nothing',
        !fs.readdirSync(VAULT_QUEUE).some(f => f.includes('f21scan')));

  const big = await postDocument('/ingest-document',
    Buffer.from('x'.repeat(2 * 1024 * 1024 + 5000)), 'f21big.txt');
  check('an oversized extraction is refused with 413', big.status === 413, big.status);
  check('the refusal says it did NOT stage, rather than truncating',
        /did not stage|truncat/i.test(big.body.error || ''), big.body.error);
  check('an oversized document stages nothing',
        !fs.readdirSync(VAULT_QUEUE).some(f => f.includes('f21big')));

  // ── 5. Read-only extraction must not touch the vault ────────────────────
  section('Read-only path — attaching a document must not create a file');
  const beforeReadOnly = new Set(fs.readdirSync(VAULT_QUEUE));
  // A REAL docx here, not text wearing a .docx name — a plain-text body under
  // that extension is correctly refused, so sending one would assert nothing
  // about the read-only path.
  const ro = await postDocument('/extract-document',
    Buffer.from(X.docx_bytes_base64, 'base64'), 'f21ro.docx');
  const afterReadOnly = new Set(fs.readdirSync(VAULT_QUEUE));
  check('extract-document returns the text', ro.status === 200 && /chat only text/.test(ro.body.text || ''),
        JSON.stringify(ro.body));
  check('extract-document creates NO vault file',
        afterReadOnly.size === beforeReadOnly.size,
        [...afterReadOnly].filter(f => !beforeReadOnly.has(f)).join(', '));
  check('the read-only response has no path field', !('path' in (ro.body || {})));
  // ── 6. Source posture ───────────────────────────────────────────────────
  section('Source posture — stdlib only');
  const apiSrc = fs.readFileSync(path.join(ROOT, 'prism', 'api-server.py'), 'utf8');
  const extractSrc = fs.readFileSync(path.join(ROOT, 'prism', 'extract.py'), 'utf8');
  const appSrc = fs.readFileSync(path.join(ROOT, 'prism', 'app.js'), 'utf8');

  check('the extractor imports nothing outside the stdlib',
        !/^\s*(import|from)\s+(?!__future__)/m.test(
          extractSrc.replace(/^from extract.*$/m, '')) ||
        (extractSrc.match(/^(?:import|from)\s+([a-z_.]+)/gm) || [])
          .every(l => /^(import|from)\s+(html|json|re|zlib|zipfile|io|xml|__future__)/.test(l)),
        (extractSrc.match(/^(?:import|from)\s+([a-z_.]+)/gm) || []).join(' | '));
  check('no third-party PDF/DOCX library is referenced',
        !/pypdf|PyPDF2|fitz|pdfminer|docx2txt|tika|beautifulsoup|bs4|lxml/i.test(
          apiSrc + extractSrc + appSrc));
  check('the server imports the extractor as a sibling module',
        /from extract import/.test(apiSrc));
  check('the server fixes sys.path so the import works from any cwd',
        /sys\.path\.insert\(0, str\(Path\(__file__\)/.test(apiSrc));

  check('the client never reads a binary document as text',
        /_isBinaryDocument/.test(appSrc) &&
        /readAsArrayBuffer/.test(appSrc) &&
        /_isBinaryDocument\(file\.name\)[\s\S]{0,200}?ingestDocument/.test(appSrc));
  check('the client shows the server\'s own refusal message',
        /body && body\.error/.test(appSrc) && /throw new Error\(\(body && body\.error\)/.test(appSrc));
  check('the desk file picker accepts the new formats',
        /\.pdf/.test(appSrc) && /\.docx/.test(appSrc) && /\.xlsx/.test(appSrc));
  check('the chat attachment path does not stage',
        /stage: false/.test(appSrc));

  check('both size caps are defined as named constants',
        /UPLOAD_MAX = /.test(apiSrc) && /EXTRACT_MAX = /.test(apiSrc));
  check('the upload cap is checked before reading the body',
        apiSrc.indexOf('UPLOAD_MAX') < apiSrc.indexOf('self.rfile.read(length)'));

  // ── cleanup ──────────────────────────────────────────────────────────────
  for (const f of fs.readdirSync(VAULT_QUEUE)) {
    if (/^2026-\d\d-\d\d-f21/.test(f)) fs.unlinkSync(path.join(VAULT_QUEUE, f));
  }
  const leftover = fs.readdirSync(VAULT_QUEUE).filter(f => /f21/.test(f));
  check('the suite leaves no vault residue', leftover.length === 0, leftover.join(', '));

  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
})();
