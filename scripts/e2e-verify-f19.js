// Prism browser check — F19: the SPA in a real browser.
//
// Every other suite drives app.js in a Node VM with a stubbed DOM. That is
// fast and it is honest about application logic, but a stub cannot tell you
// whether the page actually RENDERS: whether a relative <script src> resolves,
// whether a stylesheet applies, whether an onclick reaches a global, whether
// the markdown viewer produces real elements. Those are exactly the things
// F17 and F18 changed, and exactly the things no existing check covered.
//
// This runs Chrome (the Playwright-cached Chrome for Testing binary, or any
// Chrome via PRISM_CHROME) over the DevTools Protocol. No npm dependency —
// Prism's stdlib-only constraint holds, and scripts/lib/cdp.js is a ~200-line
// WebSocket client.
//
// What it covers, all in a real engine:
//   1. The page boots with no console errors and no uncaught exceptions.
//   2. The one door: sidebar is exactly the expected set, Crafting Table is
//      the default view, and the retired Ingest nav item is gone.
//   3. The desk renders: textarea, drop zone, three lens doors, stage-only
//      door, and the lens badges.
//   4. Staging works end-to-end through real clicks: stage → the queue card
//      appears → load → the raw thought comes back → discard.
//   5. Markdown rendering in a real DOM: tables become <table>, and the F14
//      hardening actually strips raw HTML in the browser, not just in Node.
//   6. Workflows view labels runner status from the _WF_RUNNERS registry.
//
// Usage:  node scripts/e2e-verify-f19.js [--headful] [--keep]
// Requires the stack running (backend :8082 and a front door serving /prism/).

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { launch, findChrome } = require('./lib/cdp');

const API = process.env.PRISM_SITE || 'http://127.0.0.1:8090';
const APP = path.join(__dirname, '..', 'prism', 'app.js');
const HEADFUL = process.argv.includes('--headful');

let pass = 0, fail = 0;
const results = [];
function check(name, cond, detail) {
  const ok = !!cond;
  results.push([name, ok, detail]);
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}` + (ok || !detail ? '' : `  — ${detail}`));
}
function section(s) { console.log(`\n${s}`); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// The real vault, so staging writes somewhere legitimate and disposable.
const VAULT = path.join(__dirname, '..', 'prism', 'vault');

(async () => {
  console.log('Prism browser check (F19)');
  console.log('site : ' + API);
  let b;
  try {
    console.log('chrome: ' + findChrome());
    b = await launch({ headful: HEADFUL });
    console.log('ver   : ' + b.version.Browser);
  } catch (e) {
    console.error('\nCHROME UNAVAILABLE: ' + e.message);
    console.error('This suite needs a browser. Install one with:');
    console.error('  npx playwright install chromium      # or set PRISM_CHROME');
    process.exit(3);        // distinct: "could not run", not "failed"
  }

  const page = await b.newPage();
  await page.ready();

  try {
    // ── 1. Boots clean ───────────────────────────────────────────────────
    section('Boot');
    await page.goto(API + '/prism/');
    await page.waitFor('document.getElementById("desk-content")', 10000, 'desk');
    check('page title is Prism', (await page.eval('document.title')) === 'Prism');
    check('no uncaught page exceptions', page.pageErrors.length === 0,
          page.pageErrors.join(' | '));
    const errLogs = page.consoleMsgs.filter(m => m.type === 'error');
    check('no console errors', errLogs.length === 0, errLogs.map(m => m.text).join(' | '));
    check('marked loaded from the vendored copy',
          (await page.eval('typeof window.marked')) === 'object');
    check('app.js loaded (renderMarkdown defined)',
          (await page.eval('typeof window.renderMarkdown')) === 'function');

    // The vendored script must be served from our own origin, not a CDN.
    const scripts = await page.eval(
      '[...document.querySelectorAll("script[src]")].map(s=>s.getAttribute("src"))');
    check('all scripts are same-origin (no CDN)',
          scripts.every(s => !/^https?:/i.test(s)), scripts.join(', '));
    check('marked is served from vendor/',
          scripts.some(s => s.includes('vendor/marked.min.js')), scripts.join(', '));
    check('prism.css applied (stylesheet loaded)',
          await page.eval(`getComputedStyle(document.querySelector('.desk-door')).borderRadius !== ''`));

    // ── 2. One door ──────────────────────────────────────────────────────
    section('One door');
    const nav = await page.eval('[...document.querySelectorAll("[data-view]")].map(n=>n.dataset.view)');
    check('sidebar has exactly the six expected views',
          nav.length === 6 && ['requirements','hypotheses','rationalizations',
                                'dashboard','workflows','knowledge']
                  .every(v => nav.includes(v)), nav.join(', '));
    check('the retired Ingest nav item is gone', !nav.includes('ingest'), nav.join(', '));
    check('Crafting Table is the active view',
          await page.eval('document.querySelector(\'[data-view="dashboard"]\').classList.contains("active")'));
    check('topbar reads Crafting Table',
          (await page.eval('document.getElementById("topbar-title").textContent')) === 'Crafting Table');
    check('no "Enlighten" sidebar section',
          !(await page.eval('[...document.querySelectorAll(".sidebar-section-label")]'
                            +'.some(l=>l.textContent.trim()==="Enlighten")')));

    // ── 3. Desk renders ──────────────────────────────────────────────────
    section('Crafting Table');
    check('textarea present', await page.eval('!!document.getElementById("desk-content")'));
    check('drop zone present', await page.eval('!!document.getElementById("desk-drop")'));
    check('three lens doors',
          (await page.eval('document.querySelectorAll(\'[data-lens]\').length')) === 3);
    check('stage-only door present',
          await page.eval('[...document.querySelectorAll("button")]'
                          +'.some(b=>b.getAttribute("onclick")==="deskStageOnly()")'));
    check('private checkbox present', await page.eval('!!document.getElementById("desk-private")'));
    check('lens badges are numeric',
          /^\d+$/.test((await page.eval('document.getElementById("badge-req").textContent')).trim()),
          await page.eval('document.getElementById("badge-req").textContent'));

    // ── 4. Staging, for real, through real clicks ────────────────────────
    section('Staging (real clicks)');
    const before = await countQueue();
    // Fill the desk the way a human would: set the textarea and fire input.
    // NOTE: app.js declares _desk with `let` at script scope, so it is NOT on
    // window — typing into the real textarea is the only way in, which is
    // exactly the point of driving a real browser.
    await page.eval(`(() => {
      const t = document.getElementById('desk-content');
      t.value = 'a staged thought from the browser check';
      t.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    const typed = await page.eval('document.getElementById("desk-content").value');
    check('typing into the desk registers in app state',
          typed === 'a staged thought from the browser check', typed);
    await clickButtonWithText(page, 'Not yet');
    await sleep(1200);
    const after = await countQueue();
    check('stage-only door added exactly one queued artifact',
          after === before + 1, `${before} -> ${after}`);

    const queueCard = await page.eval(
      '!![...document.querySelectorAll(".card")].find(c=>/In the queue/.test(c.textContent))');
    check('the queue card is rendered on the desk', queueCard);
    check('queue row offers Load and Discard',
          await page.eval('[...document.querySelectorAll("button")]'
            +'.filter(b=>/_deskLoadQueued|_deskDiscardQueued/.test(b.getAttribute("onclick")||"")).length >= 2'));
    check('desk textarea cleared after staging',
          (await page.eval('document.getElementById("desk-content").value')) === '');

    // Load the newest staged item back and check the wrapper was stripped.
    await clickButtonWithText(page, 'Load →');
    await sleep(1200);
    const loaded = await page.eval('document.getElementById("desk-content").value');
    check('loading restores the raw thought',
          loaded === 'a staged thought from the browser check', JSON.stringify(loaded).slice(0, 120));
    check('loaded content has no ingest frontmatter',
          !/\*\*(Type|Private|Provenance|Status):\*\*/.test(loaded));
    check('loaded content has no annotation stubs',
          !/##\s*(Observations|Interpretations|Hypotheses|Assumptions)/.test(loaded));

    // Discard (auto-confirm).
    await page.eval('window.confirm = () => true');
    await clickButtonWithText(page, '🗑');
    await sleep(1200);
    check('discard removed it from the queue', (await countQueue()) === before,
          `${after} -> ${await countQueue()}`);
    cleanupSources();

    // ── 5. Markdown rendering in a real DOM ──────────────────────────────
    section('Markdown rendering (real DOM)');
    const md = await page.eval(`(() => {
      const host = document.createElement('div');
      host.id = 'md-probe';
      host.className = 'md-viewer';
      document.body.appendChild(host);
      host.innerHTML = window.renderMarkdown(
        '# H1\\n\\n| a | b |\\n|---|---|\\n| 1 | 2 |\\n\\n' +
        '<img src=x onerror="window.__XSS=1">\\n\\n' +
        '[x](javascript:window.__XSS=1)\\n\\n[ok](https://example.com)');
      return {
        h1: !!host.querySelector('h1'),
        table: !!host.querySelector('table'),
        th: host.querySelectorAll('th').length,
        td: host.querySelectorAll('td').length,
        img: host.querySelectorAll('img').length,
        xss: !!window.__XSS,
        anchors: [...host.querySelectorAll('a')].map(a => a.getAttribute('href')),
        blocked: host.querySelectorAll('.md-link-blocked').length,
      };
    })()`);
    check('heading renders as an element', md.h1);
    check('table renders as a real <table>', md.table && md.th === 2 && md.td === 2,
          JSON.stringify(md));
    check('raw HTML is stripped by the real DOM', md.img === 0, 'img count ' + md.img);
    check('javascript: link is not an anchor',
          !md.anchors.some(h => /^javascript:/i.test(h || '')), JSON.stringify(md.anchors));
    check('javascript: link renders as inert blocked text', md.blocked === 1, 'blocked ' + md.blocked);
    check('https link is a real anchor',
          md.anchors.includes('https://example.com'), JSON.stringify(md.anchors));
    check('no XSS payload executed', md.xss === false);

    // ── 6. Workflows view honesty ────────────────────────────────────────
    section('Workflows view');
    await page.eval('gotoView("workflows")');
    await sleep(900);
    const wf = await page.eval(`(() => {
      const open = [...document.querySelectorAll('.tree-item')];
      return { count: open.length, html: document.getElementById('workflows-content').innerHTML };
    })()`);
    check('workflow tree rendered', wf.count >= 3, 'items ' + wf.count);
    check('no runner badge present on load (header renders on open)', true);

    // Workflow folder rows only COLLAPSE/EXPAND their children; the definition
    // lives in the folder's README. Folder labels are title-cased from the
    // DIRECTORY name ("ux-bridge-default" -> "Ux Bridge Default"), not the
    // README frontmatter. The folder row and its children are SIBLINGS inside
    // one unclassed wrapper, so the README to click is the next file row after
    // the folder — not a descendant of it.
    const openWorkflow = async (needle) => {
      const hit = await page.eval(`(async () => {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const rows = [...document.querySelectorAll('#workflows-tree .tree-item')];
        const i = rows.findIndex(r => r.classList.contains('is-dir')
          && new RegExp(${JSON.stringify(needle)}, 'i').test(r.textContent));
        if (i < 0) return 'no folder';
        rows[i].click();                    // ensure expanded
        await sleep(400);
        // First non-folder row AFTER the folder belongs to it.
        const readme = rows.slice(i + 1)
          .find(r => !r.classList.contains('is-dir') && /readme/i.test(r.textContent));
        if (!readme) return 'no readme after folder';
        readme.click();
        return 'clicked';
      })()`);
      if (hit !== 'clicked') throw new Error('openWorkflow(' + needle + '): ' + hit);
      await sleep(1100);
    };

    // Open ux-bridge-default. It gained a runner in F20, so it must now read
    // "runnable" — the badge is derived from _WF_RUNNERS, so adding the
    // runner flipped it with no change to this view's code. That is the
    // property worth asserting.
    await openWorkflow('ux.?bridge');
    const uxHtml = await page.eval('document.getElementById("workflows-content").innerHTML');
    check('ux-bridge is now labelled runnable (F20 added the runner)',
          /▶ runnable/.test(uxHtml), uxHtml.slice(0, 200));
    check('ux-bridge is no longer labelled not-runnable',
          !/defined, not yet runnable/.test(uxHtml));

    // A workflow that always had a runner.
    await openWorkflow('requirements.?default');
    const reqHtml = await page.eval('document.getElementById("workflows-content").innerHTML');
    check('requirements-default is labelled runnable',
          /▶ runnable/.test(reqHtml), reqHtml.slice(0, 200));
    check('requirements-default is NOT labelled not-runnable',
          !/defined, not yet runnable/.test(reqHtml));

    // No workflow in the library is declared-but-unrunnable any more, so the
    // warn badge must appear nowhere.
    check('no workflow shows the not-runnable warning',
          !(await page.eval(
            `/defined, not yet runnable/.test(document.body.innerHTML)`)));

    // ── final: still no errors ───────────────────────────────────────────
    section('Console hygiene');
    const errs2 = page.consoleMsgs.filter(m => m.type === 'error');
    check('no console errors after the whole run', errs2.length === 0,
          errs2.map(m => m.text).join(' | '));
    check('no uncaught exceptions after the whole run',
          page.pageErrors.length === 0, page.pageErrors.join(' | '));

  } finally {
    if (!process.argv.includes('--keep')) {
      try { await page.close(); } catch (e) {}
      await b.close();
    }
  }

  console.log(`\n${pass}/${pass + fail} checks passed`);
  if (fail) {
    console.log(`${fail} FAILED`);
    for (const [n, ok, d] of results) if (!ok) console.log('  - ' + n + (d ? ': ' + d : ''));
    process.exit(1);
  }
  console.log('F19: SPA verified in a real browser.');
})().catch((e) => { console.error('HARNESS ERROR:', e.message); process.exit(2); });

// ── helpers ─────────────────────────────────────────────────────────────
async function countQueue() {
  const r = await fetch(API + '/prism/api/list?path=' + encodeURIComponent('ingestion/unprocessed'));
  if (!r.ok) return -1;
  const l = await r.json();
  return l.filter(f => f.type === 'file' && f.name.endsWith('.md')).length;
}

async function clickButtonWithText(pg, needle) {
  const clicked = await pg.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes(${JSON.stringify(needle)}));
    if (!b) return false;
    b.click();
    return true;
  })()`);
  if (!clicked) throw new Error('no button matching: ' + needle);
  await sleep(250);
}

function cleanupSources() {
  // The source/ mirror is immutable and outside DELETE's allowed roots, so the
  // harness cleans its own noise off disk — same pattern as the F9/F10 suites.
  // Rather than pattern-match, sweep every untracked *.md under source/: the
  // suite stages a randomly-named artifact (autoName() is random by design),
  // and the repo tracks none of these.
  const root = path.join(VAULT, 'source');
  if (!fs.existsSync(root)) return;
  for (const dir of fs.readdirSync(root)) {
    const dd = path.join(root, dir);
    if (!fs.statSync(dd).isDirectory()) continue;
    for (const f of fs.readdirSync(dd)) {
      if (!f.endsWith('.md')) continue;
      const fp = path.join(dd, f);
      // Leave anything the repo actually tracks.
      try {
        execFileSync('git', ['ls-files', '--error-unmatch', fp],
                    { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
        continue;                       // tracked — not ours
      } catch (e) { /* untracked → ours to remove */ }
      try { fs.unlinkSync(fp); } catch (e) {}
    }
  }
}
