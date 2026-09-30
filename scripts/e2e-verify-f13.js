// Prism end-to-end regression test — F13: no CDN dependency (vendored marked).
//
// prism/index.html used to load marked from an UNPINNED jsDelivr URL:
//   https://cdn.jsdelivr.net/npm/marked/marked.min.js
// That contradicted the local-first constraint in the README ("no cloud
// dependency"), silently drifted the version (it served 15.0.12 while latest
// was 18.0.14), and broke the markdown viewer entirely with no network.
// marked is now vendored at prism/vendor/marked.min.js.
//
// This suite asserts the offline guarantee three ways:
//   1. No external script/style reference survives anywhere in the app.
//   2. The vendored file is the exact, verified bytes we recorded.
//   3. The vendored copy actually renders the markdown Prism shows — the
//      render path (app.js marked.parse) had NO coverage at all before this.
//
// No DOM stub and no backend needed: this reads the shipped files and runs
// the vendored library directly.
//
// Usage:  node scripts/e2e-verify-f13.js     (exit 0 = all checks pass)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
// One definition of the environment, shared by every suite.
const { ROOT } = require('./lib/env.js');

const PRISM = path.join(ROOT, 'prism');
const VENDOR = path.join(PRISM, 'vendor', 'marked.min.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  PASS ' + name); pass++; }
  else { console.log('  FAIL ' + name + (detail ? '  — ' + detail : '')); fail++; }
}
function section(s) { console.log('\n' + s); }

// Recorded in prism/vendor/README.md. An upgrade MUST change this, which is
// the point: an unpinned dependency could not be diffed.
const EXPECTED_SHA = '3e7e7d7feb3e5d58cb6c804f68ab5c24cc7e5eb6270fd6e5cbb9124739217d0c';
const EXPECTED_VERSION = '15.0.12';

(async () => {
  // ── 1. No external references anywhere in the app ───────────────────────
  section('No CDN references');
  const shipped = [
    'index.html', 'app.js', 'prism.css',
    path.join('layout', 'default.css'), path.join('theme', 'default.css'),
  ];
  let external = [];
  for (const rel of shipped) {
    const text = fs.readFileSync(path.join(PRISM, rel), 'utf8');
    // Match any absolute http(s) URL that is not loopback.
    const hits = text.match(/https?:\/\/[^\s"'`)\]]+/g) || [];
    for (const u of hits) {
      if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(u)) external.push(rel + ': ' + u);
    }
  }
  check('no external URL in any shipped app file', external.length === 0,
        external.join(' | '));

  const html = fs.readFileSync(path.join(PRISM, 'index.html'), 'utf8');
  check('index.html loads marked locally',
        /<script src="vendor\/marked\.min\.js"><\/script>/.test(html),
        'no local marked script tag found');
  check('index.html references no cdn.jsdelivr.net', !/jsdelivr/.test(html));
  check('index.html references no unpkg / cdnjs',
        !/unpkg\.com|cdnjs\.cloudflare/.test(html));

  // A <script src> or <link href> pointing off-box is the specific failure.
  const remoteTags = (html.match(/(?:src|href)="https?:\/\/[^"]+"/g) || []);
  check('index.html has no remote src/href tag', remoteTags.length === 0,
        remoteTags.join(' | '));

  // ── 2. The vendored file is the verified bytes ──────────────────────────
  section('Vendored file integrity');
  check('vendor/marked.min.js exists', fs.existsSync(VENDOR));
  if (!fs.existsSync(VENDOR)) { finish(); return; }

  const bytes = fs.readFileSync(VENDOR);
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  check('vendored marked matches the recorded sha256', sha === EXPECTED_SHA,
        'got ' + sha);
  check('vendored marked is the recorded version',
        bytes.toString('utf8', 0, 400).includes('v' + EXPECTED_VERSION),
        'header does not name v' + EXPECTED_VERSION);
  check('vendor licence file present',
        fs.existsSync(path.join(PRISM, 'vendor', 'marked.LICENSE.md')));
  check('vendor provenance documented',
        fs.existsSync(path.join(PRISM, 'vendor', 'README.md')));
  check('vendor README records the same sha256',
        fs.readFileSync(path.join(PRISM, 'vendor', 'README.md'), 'utf8')
          .includes(EXPECTED_SHA));

  // ── 3. The render path still works (it had no coverage before) ─────────
  section('Markdown rendering via the vendored copy');
  const marked = require(VENDOR);

  const cases = [
    ['heading',      '# Title',                    /<h1[^>]*>Title<\/h1>/],
    ['bold',         '**bold**',                   /<strong>bold<\/strong>/],
    ['inline code',  '`code`',                     /<code[^>]*>code<\/code>/],
    ['list',         '- one\n- two',               /<ul>[\s\S]*<li>one<\/li>/],
    ['ordered list', '1. one\n2. two',             /<ol>[\s\S]*<li>one<\/li>/],
    ['link',         '[t](https://example.com)',  /<a href="https:\/\/example\.com"/],
    ['blockquote',   '> quoted',                   /<blockquote>/],
    // Tables matter: vault files use them heavily (Evidence Log, deps).
    ['table',        '| a | b |\n|---|---|\n| 1 | 2 |',
                    /<table>[\s\S]*<th[^>]*>a<\/th>[\s\S]*<td[^>]*>1<\/td>/],
  ];
  for (const [name, src, re] of cases) {
    let out = '';
    try { out = marked.marked.parse(src); } catch (e) { out = 'THREW: ' + e.message; }
    check('renders ' + name, re.test(out), out.slice(0, 90));
  }

  // app.js calls marked.parse (the global), not the module form. Confirm the
  // browser global is actually exposed by this file, or the app breaks.
  section('Browser global');
  const src = bytes.toString('utf8');
  check('file is a UMD/global build (exposes window.marked)',
        /typeof exports|define\.amd|globalThis/.test(src.slice(0, 4000)));
  // Render a REAL vault file end-to-end, not a synthetic string.
  const vaultFile = path.join(PRISM, 'vault', 'knowledge', 'README.md');
  if (fs.existsSync(vaultFile)) {
    const real = fs.readFileSync(vaultFile, 'utf8');
    let ok = true, why = '';
    try {
      const html2 = marked.marked.parse(real);
      ok = /<table>|<h[1-6]/i.test(html2);
      if (!ok) why = html2.slice(0, 80);
    } catch (e) { ok = false; why = e.message; }
    check('renders a real vault file to HTML', ok, why);
  }

  finish();
})();

function finish() {
  const total = pass + fail;
  console.log(`\n${pass}/${total} checks passed`);
  if (fail) { console.log(`${fail} FAILED`); process.exit(1); }
  console.log('F13: no CDN dependency; vendored marked verified and rendering.');
}
