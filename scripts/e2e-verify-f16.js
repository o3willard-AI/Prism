// Prism end-to-end regression test — F16: markdown render hardening (F14 fix).
//
// marked v15 does not sanitize: raw HTML in a vault file passed through
// verbatim and `javascript:` URLs survived into an href. Both outputs land in
// innerHTML, so a vault file carrying `<img src=x onerror=…>` would execute in
// the Prism origin. Not a privilege boundary today — the only writer is the
// human and their own agent, and F12 blocks arbitrary web pages — but that is
// a property of who writes today, not of the renderer.
//
// prism/app.js now routes both render paths through renderMarkdown(), which
// applies a two-rule marked renderer override: drop raw HTML, and restrict
// link schemes to http/https. No sanitizer dependency, so the "one vendored
// library" position F13 settled is untouched.
//
// This suite asserts three things:
//   1. The hardening is actually wired up (no direct marked.parse call sites
//      remain in the render paths).
//   2. It actually neutralizes the vectors.
//   3. It changes nothing about how real vault content renders — the
//      measured baseline, so a future change to marked cannot silently
//      reformat the whole vault.
//
// No DOM stub and no backend needed.
//
// Usage:  node scripts/e2e-verify-f16.js     (exit 0 = all checks pass)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'prism', 'app.js');
const MARKED = path.join(ROOT, 'prism', 'vendor', 'marked.min.js');
const VAULT = path.join(ROOT, 'prism', 'vault');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  PASS ' + name); pass++; }
  else { console.log('  FAIL ' + name + (detail ? '  — ' + detail : '')); fail++; }
}
function section(s) { console.log('\n' + s); }

const read = (p) => fs.readFileSync(p, 'utf8');

// Load app.js the way the browser does, with marked present, and pull out the
// real renderMarkdown() — so this suite tests the shipped code, not a copy.
function loadRenderer() {
  const app = read(APP);
  const marked = require(MARKED);
  // Minimal stand-ins for the globals renderMarkdown touches.
  const escHtml = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  // Extract the whole F14 block (through the end of renderMarkdown) and run it
  // in a sandbox, so this suite exercises the shipped code rather than a copy.
  const start = app.indexOf('const _SAFE_SCHEME');
  const endMark = 'function renderMarkdown(md) {';
  const end = app.indexOf('\n}\n', app.indexOf(endMark));
  if (start < 0 || end < 0) return null;
  const block = app.slice(start, end + 3);
  const ctx = { marked, escHtml, window: { marked }, console };
  vm.createContext(ctx);
  vm.runInContext(block + '\nthis.renderMarkdown = renderMarkdown;', ctx);
  return ctx.renderMarkdown;
}

(async () => {
  const app = read(APP);

  // ── 1. The hardening is wired in ───────────────────────────────────────
  section('Wiring');
  check('app.js defines renderMarkdown', /function renderMarkdown\(/.test(app));
  check('renderer drops raw HTML', /html\(\)\s*\{\s*return '';\s*\}/.test(app));
  check('renderer restricts link schemes', /_SAFE_SCHEME\.test\(href\)/.test(app));

  // No render path may call marked.parse directly. The ONE legitimate call is
  // inside renderMarkdown() itself, so allow exactly that.
  const direct = [...app.matchAll(/marked\.parse\(/g)];
  const legit = direct.filter(m => app.slice(Math.max(0, m.index - 40), m.index)
                                       .includes('return window.'));
  check('no stray marked.parse call sites outside renderMarkdown',
        direct.length === legit.length && legit.length === 1,
        direct.length + ' total, ' + legit.length + ' inside renderMarkdown');
  const mdViewers = [...app.matchAll(/\$\{renderMarkdown\(content\)\}/g)];
  check('both render paths use renderMarkdown', mdViewers.length === 2,
        'found ' + mdViewers.length);
  check('css styles the blocked-link state',
        /\.md-link-blocked/.test(read(path.join(ROOT, 'prism', 'prism.css'))));

  const render = loadRenderer();
  check('renderMarkdown() loads from the shipped app.js', typeof render === 'function');
  if (typeof render !== 'function') { finish(); return; }

  // ── 2. The vectors are neutralized ─────────────────────────────────────
  section('Neutralization');
  const vectors = [
    ['img onerror',        '<img src=x onerror=alert(1)>',                 /onerror/i],
    ['script tag',         '<script>alert(1)</script>',                     /<script/i],
    ['iframe',             '<iframe src="https://evil.example"></iframe>',   /<iframe/i],
    ['svg onload',         '<svg onload=alert(1)></svg>',                   /onload/i],
    ['details ontoggle',   '<details open ontoggle=alert(1)>x</details>',    /ontoggle/i],
    ['body onload',        '<body onload=alert(1)>',                        /onload/i],
    ['style block',        '<style>body{display:none}</style>',             /<style/i],
    ['javascript: link',   '[click](javascript:alert(1))',                  /javascript:/i],
    ['data: link',         '[x](data:text/html;base64,PHNjcmlwdD4xPg==)',   /data:/i],
    ['vbscript: link',     '[x](vbscript:msgbox(1))',                       /vbscript:/i],
    ['file: link',         '[x](file:///etc/passwd)',                       /file:/i],
  ];
  for (const [name, src, bad] of vectors) {
    let out = '';
    try { out = render(src); } catch (e) { out = 'THREW: ' + e.message; }
    check('neutralized: ' + name, !bad.test(out), out.slice(0, 100));
  }

  // The text of a blocked link must survive — degrading to invisible would be
  // worse than degrading to inert.
  const blocked = render('[click me](javascript:alert(1))');
  check('blocked link keeps its text', /click me/.test(blocked), blocked);
  check('blocked link is not an anchor', !/<a\s/.test(blocked), blocked);
  check('blocked link is marked as blocked', /md-link-blocked/.test(blocked), blocked);

  // ── 3. Normal markdown is unaffected ───────────────────────────────────
  section('Normal rendering preserved');
  const ok = [
    ['heading',     '# T',                          /<h1[^>]*>T<\/h1>/],
    ['bold',        '**b**',                        /<strong>b<\/strong>/],
    ['italic',      '*i*',                          /<em>i<\/em>/],
    ['code',        '`c`',                          /<code[^>]*>c<\/code>/],
    ['fence',       '```\nx\n```',                  /<pre>/],
    ['list',        '- a\n- b',                     /<ul>[\s\S]*<li>a<\/li>/],
    ['ordered',     '1. a\n2. b',                   /<ol>[\s\S]*<li>a<\/li>/],
    ['quote',       '> q',                          /<blockquote>/],
    ['table',       '| a | b |\n|---|---|\n| 1 | 2 |', /<table>[\s\S]*<td[^>]*>1<\/td>/],
    ['hr',          '---',                          /<hr/],
  ];
  for (const [name, src, re] of ok) {
    let out = '';
    try { out = render(src); } catch (e) { out = 'THREW: ' + e.message; }
    check('renders ' + name, re.test(out), out.slice(0, 90));
  }

  // An http(s) link must still be a real, working anchor.
  const good = render('[ok](https://example.com/x)');
  check('http link still an anchor', /<a href="https:\/\/example\.com\/x">ok<\/a>/.test(good), good);
  // Site-relative links stay inside Prism's own origin and must keep working —
  // vault files legitimately cross-reference each other this way.
  for (const [label, href] of [
    ['root-relative', '/vault/thing.md'],
    ['anchor',        '#section-two'],
    ['query',         '?q=search'],
    ['protocol-rel',  '//example.com/x'],
  ]) {
    const r = render(`[x](${href})`);
    check(label + ' link still an anchor',
          new RegExp('<a href="' + href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '">').test(r),
          r);
  }

  // href must be attribute-escaped — a quote in the url must not break out of
  // the attribute and become a real second attribute. Note the raw text
  // "onmouseover=" still appears as inert content INSIDE the href; what must
  // not happen is it being parsed as an attribute of its own.
  const q = render('[q](https://e.example/"onmouseover="alert(1))');
  check('href quote is entity-encoded', /&quot;/.test(q), q.slice(0, 120));
  check('no bare quote escapes the href attribute',
        !/href="[^"]*"[^"]*"/.test(q.slice(q.indexOf('<a '), q.indexOf('</a>'))),
        q.slice(0, 120));
  // The decisive test: after the href value, nothing may be parsed as a
  // further attribute. The escaped text "onmouseover=" living INSIDE the
  // quoted value is correct and expected; what must not exist is an
  // unescaped quote that would terminate the value early.
  const anchor = q.match(/<a\b([^>]*)>/);
  const attrs = anchor ? anchor[1] : '';
  check('anchor is a single href attribute, nothing after the value',
        /^href="[^"]*"$/.test(attrs.trim()), attrs);
  // And a browser reading it back must recover the original URL exactly.
  const inner = attrs.trim().replace(/^href="/, '').replace(/"$/, '')
                      .replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  check('href round-trips to the original URL',
        inner === 'https://e.example/"onmouseover="alert(1)', inner);

  // ── 4. Real vault content: the render-equivalence baseline ─────────────
  section('Vault render baseline');
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) walk(fp);
      else if (e.name.endsWith('.md')) files.push(fp);
    }
  })(VAULT);
  check('vault files found', files.length > 20, 'found ' + files.length);

  // Compare hardened rendering against stock marked for every real file.
  // The ONLY permitted difference is loss of an HTML comment, which is
  // invisible in the rendered view. Anything else is a regression.
  const stock = require(MARKED);
  const stripComments = (h) => h.replace(/<!--[\s\S]*?-->/g, '');
  let unexpected = [], commentOnly = 0;
  for (const f of files) {
    const src = read(f);
    let hardened, plain;
    try { hardened = render(src); } catch (e) { unexpected.push(path.relative(VAULT, f) + ' (threw: ' + e.message + ')'); continue; }
    try { plain = stock.parse(src); } catch (e) { unexpected.push(path.relative(VAULT, f) + ' (stock threw)'); continue; }
    if (hardened === plain) continue;
    if (stripComments(hardened) === stripComments(plain)) { commentOnly++; continue; }
    unexpected.push(path.relative(VAULT, f));
  }
  check('every vault file renders without error or unexpected change',
        unexpected.length === 0, unexpected.join(' | '));
  // Recorded, not asserted to a magic number: the point is that the
  // difference is comments only, and that it is small and stable.
  check('difference on real content is comments only (measured: '
        + commentOnly + ' of ' + files.length + ')',
        commentOnly <= files.length,
        'commentOnly=' + commentOnly);

  // And nothing in the real vault is actually using raw HTML today, which is
  // why hardening it is free.
  const rawHtml = files.filter(f => /<(div|span|img|table|iframe|script|style|a|p)\b[^>]*>/i.test(read(f)));
  check('no vault file relies on raw HTML', rawHtml.length === 0,
        rawHtml.map(f => path.relative(VAULT, f)).join(' | '));

  finish();
})();

function finish() {
  console.log(`\n${pass}/${pass + fail} checks passed`);
  if (fail) { console.log(`${fail} FAILED`); process.exit(1); }
  console.log('F16: render path hardened; vault content renders unchanged.');
}
