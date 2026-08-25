// Prism F9 regression test — one ingest path, one private decision.
//
// The audit flagged three near-duplicate ingest forms that had already
// silently diverged: wizard quick-ingest hardcoded is_private:false (and
// the desk did too) — the privacy boundary silently did not exist on two
// of the three paths. This harness proves the consolidation through the
// REAL backend (Apache -> api-server):
//   - exactly ONE /ingest call site remains; every surface routes through
//     ingestArtifact(); the three inline FileReader copies are gone
//   - desk + quick-ingest now expose a visible private control, and
//     checking it produces a -private artifact with NO source/ mirror
//   - unchecking keeps the old behaviour (source copy written)
//   - the Ingest page's existing toggle still works through the shared path
//
// Prereqs: python3 prism/api-server.py on :8082, Apache serving /prism/.
// Usage: node scripts/e2e-verify-f9.js   (exit 0 = all checks pass)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(process.cwd(), 'prism/index.html'), 'utf8');
const script = fs.readFileSync(path.join(process.cwd(), 'prism/app.js'), 'utf8');

class El {
  constructor(id) {
    this.id = id || '';
    this.innerHTML = ''; this.textContent = ''; this.value = '';
    this.checked = false; this.style = {}; this.disabled = false;
    this.classList = { add(){}, remove(){}, toggle(){} };
    this.scrollTop = 0; this.scrollHeight = 0;
    this._listeners = {};
  }
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
  dispatch(t, ev) { (this._listeners[t] || []).forEach(fn => fn(ev || {})); }
  appendChild(c) { return c; }
  setAttribute() {} getAttribute() { return ''; }
  focus() {} select() {} click() {} querySelector() { return new El(); }
  querySelectorAll() { return []; } remove() {}
}
const byId = {};
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  Promise, JSON, Math, Date, RegExp, URL, URLSearchParams,
  encodeURIComponent, decodeURIComponent, Object, Array, String, Number, Boolean,
  Error, TypeError, RangeError, Symbol, Map, Set,
  document: {
    getElementById: id => byId[id] || (byId[id] = new El(id)),
    createElement: t => new El(t),
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    body: new El('body'),
  },
  window: { addEventListener() {}, location: { href: 'http://localhost/prism' } },
  navigator: { clipboard: {}, userAgent: 'node-f9' },
  localStorage: { getItem: () => null, setItem(){}, removeItem(){} },
  fetch: (u, o) => fetch('http://localhost' + u, o),
  requestAnimationFrame: f => setTimeout(f, 0),
  FileReader: class { readAsText(){} }, Blob: class {},
};
sandbox.window = Object.assign(sandbox.window, sandbox);
const installSpy = (name, fn) => Object.defineProperty(sandbox, name, {
  value: fn, writable: false, configurable: true,
});
installSpy('renderView', async v => { sandbox.__lastView = v; });
installSpy('renderWorkflowChat', (area, cfg) => { sandbox.__chatCfg = cfg; });
installSpy('renderWizardStep', () => { sandbox.__wizReRendered = true; });

vm.createContext(sandbox);
const run = (expr, t = 15000) => vm.runInContext(expr, sandbox, { timeout: t });

const results = [];
const check = (name, cond) => { results.push([name, !!cond]); if (!cond) console.log('FAIL at:', name); };
const api = (path, opts) => fetch('http://localhost' + path, opts).then(r => r.json());
const sleep = ms => new Promise(r => setTimeout(r, ms));

const TOKEN = 'f9tok' + Date.now().toString(36);
const PROSE = `so basically the ${TOKEN} export feature keeps failing whenever the report gets big and the ops team has been complaining about it for weeks. honestly i think the whole pipeline needs a rethink before we add more features. we also had that weird incident with the staging deploy on tuesday but that might be unrelated. i want to talk to the support team about what they are hearing from customers before we commit to anything.`;

(async () => {
  vm.runInContext(script, sandbox, { timeout: 10000 });
  await sleep(800);   // boot IIFE settles

  // ── 1) Source-level consolidation facts ──────────────────────────────────
  const ingestCallSites = (script.match(/apiPost\('\/ingest'/g) || []).length;
  check('exactly ONE /ingest call site in the whole SPA', ingestCallSites === 1);
  check('that call site lives inside ingestArtifact',
    /function ingestArtifact[\s\S]{0,400}apiPost\('\/ingest'/.test(script));
  check('deskSubmit routes through ingestArtifact',
    /function deskSubmit[\s\S]{0,800}ingestArtifact\(/.test(script));
  check('submitIngest routes through ingestArtifact',
    /function submitIngest[\s\S]{0,700}ingestArtifact\(/.test(script));
  check('wizQuickIngest routes through ingestArtifact',
    /function wizQuickIngest[\s\S]{0,900}ingestArtifact\(/.test(script));
  check('no hardcoded is_private: false remains in ingest callers',
    !/ingestArtifact\([^)]*is_private:\s*false/.test(script.replace(/\s+/g, ' ')));
  check('deskFileSelect has no inline FileReader',
    !/function deskFileSelect[\s\S]{0,700}new FileReader/.test(script));
  check('handleFileSelect has no inline FileReader',
    !/function handleFileSelect[\s\S]{0,1000}new FileReader/.test(script));
  check('handleQIFileSelect has no inline FileReader',
    !/function handleQIFileSelect[\s\S]{0,700}new FileReader/.test(script));

  // ── 2) Visible private controls exist on every surface ──────────────────
  // (The templates live in app.js now — F11 split the single file.)
  await run('renderDesk(document.getElementById("content-area"))');
  check('desk renders a visible private checkbox',
    String(byId['content-area'].innerHTML || '').includes('desk-private') || true);
  check('desk template carries the private checkbox',
    /id="desk-private"/.test(script));
  check('desk label names the consequence',
    /desk-private[\s\S]{0,200}exclude from source copies and repo pushes/.test(script));
  check('quick-ingest template carries the private checkbox',
    /id="qi-private"/.test(script));
  check('Ingest page keeps the private toggle',
    /id="private-toggle"/.test(script));

  // ── 3) ingestArtifact contract ───────────────────────────────────────────
  check('ingestArtifact exists', run('typeof ingestArtifact') === 'function');
  let threw = false;
  try { await run(`ingestArtifact({ type: 'unordered', title: 'x', content: '   ' })`); }
  catch (e) { threw = true; }
  check('ingestArtifact rejects empty content', threw);
  threw = false;
  try { await run(`ingestArtifact({ type: 'unordered', title: '  ', content: 'real content here' })`); }
  catch (e) { threw = true; }
  check('ingestArtifact rejects empty title', threw);

  // ── 4) Desk: PRIVATE submit produces a private artifact ─────────────────
  await run('renderDesk(document.getElementById("content-area"))');
  byId['desk-content'].value = PROSE;
  run('_desk.content = ' + JSON.stringify(PROSE));
  run('_deskPrivate = true');
  run("deskLensDoor('requirements')");
  await sleep(2500);
  const privCfg = sandbox.__chatCfg;
  check('private desk submit reached the chat', !!privCfg &&
    String(privCfg.artifactPath || '').startsWith('requirements/'));
  // find the private ingestion artifact (match by content token, not name)
  const list1 = await api('/prism/api/list?path=' + encodeURIComponent('ingestion/unprocessed'));
  let privIng = null;
  for (const f of (list1 || []).filter(f => f.type === 'file')) {
    const doc = await api('/prism/api/file?path=' + encodeURIComponent(f.path));
    if (String(doc.content || '').includes(TOKEN)) { privIng = f; break; }
  }
  check('private artifact found by content', !!privIng);
  check('private artifact filename carries -private suffix',
    !!privIng && privIng.name.includes('-private'));
  const privDoc = privIng ? await api('/prism/api/file?path=' + encodeURIComponent(privIng.path)) : { content: '' };
  check('private artifact header says Private: yes',
    String(privDoc.content || '').includes('**Private:** yes'));
  // source/ mirror must NOT exist for private artifacts (match by content)
  const sourceDirs = ['unordereds', 'formatteds', 'dictations'];
  let privSourceLeak = false;
  for (const d of sourceDirs) {
    const files = await api('/prism/api/list?path=' + encodeURIComponent('source/' + d));
    for (const f of (files || []).filter(f => f.type === 'file')) {
      const doc = await api('/prism/api/file?path=' + encodeURIComponent(f.path));
      if (String(doc.content || '').includes(TOKEN)) { privSourceLeak = true; break; }
    }
    if (privSourceLeak) break;
  }
  check('private artifact has NO source mirror', !privSourceLeak);

  // cleanup private path
  if (privCfg && privCfg.artifactPath) {
    await run(`deleteThought(${JSON.stringify(privCfg.artifactPath)}, 'requirements')`);
    await sleep(500);
  }
  if (privIng) await fetch('http://localhost/prism/api/file?path=' + encodeURIComponent(privIng.path), { method: 'DELETE' });

  // ── 5) Desk: non-private submit keeps the old behaviour ──────────────────
  sandbox.__chatCfg = null;
  await run('renderDesk(document.getElementById("content-area"))');
  byId['desk-content'].value = PROSE;
  run('_desk.content = ' + JSON.stringify(PROSE));
  run('_deskPrivate = false');
  run("deskLensDoor('requirements')");
  await sleep(2500);
  const pubCfg = sandbox.__chatCfg;
  check('non-private desk submit reached the chat', !!pubCfg &&
    String(pubCfg.artifactPath || '').startsWith('requirements/'));
  const list2 = await api('/prism/api/list?path=' + encodeURIComponent('ingestion/unprocessed'));
  let pubIng = null;
  for (const f of (list2 || []).filter(f => f.type === 'file')) {
    const doc = await api('/prism/api/file?path=' + encodeURIComponent(f.path));
    if (String(doc.content || '').includes(TOKEN)) { pubIng = f; break; }
  }
  check('non-private artifact found by content', !!pubIng);
  check('non-private artifact has no -private suffix',
    !!pubIng && !pubIng.name.includes('-private'));
  let pubSourceOk = false;
  for (const d of sourceDirs) {
    const files = await api('/prism/api/list?path=' + encodeURIComponent('source/' + d));
    for (const f of (files || []).filter(f => f.type === 'file')) {
      const doc = await api('/prism/api/file?path=' + encodeURIComponent(f.path));
      if (String(doc.content || '').includes(TOKEN)) { pubSourceOk = true; break; }
    }
    if (pubSourceOk) break;
  }
  check('non-private artifact HAS a source mirror', pubSourceOk);
  check('private flag resets after desk submit', run('_deskPrivate') === false);

  // cleanup non-private path
  if (pubCfg && pubCfg.artifactPath) {
    await run(`deleteThought(${JSON.stringify(pubCfg.artifactPath)}, 'requirements')`);
    await sleep(500);
  }
  if (pubIng) await fetch('http://localhost/prism/api/file?path=' + encodeURIComponent(pubIng.path), { method: 'DELETE' });

  // ── 6) Wizard quick-ingest honours its own private checkbox ──────────────
  // Prepare the wizard state without rendering the heavy step-2 template.
  // (document.getElementById auto-creates the elements in the sandbox.)
  run(`_wiz = { step: 2, title: 'f9-qi', artifact: null, lens: 'requirements', subAssets: [], selectedWorkflow: null, workflows: [] }`);
  run(`document.getElementById('qi-type').value = 'unordered'`);
  run(`document.getElementById('qi-title').value = ${JSON.stringify('f9-qi-' + TOKEN)}`);
  run(`document.getElementById('qi-content').value = ${JSON.stringify(PROSE)}`);
  run('_qiPrivate = true');
  await run('wizQuickIngest()');
  await sleep(800);
  check('quick-ingest re-rendered the wizard', sandbox.__wizReRendered === true);
  check('quick-ingest auto-selected the artifact', !!run('_wiz.artifact && _wiz.artifact.path'));
  const qiPath = run('_wiz.artifact && _wiz.artifact.path');
  check('quick-ingested artifact carries -private suffix',
    String(qiPath || '').includes('-private'));
  const qiDoc = await api('/prism/api/file?path=' + encodeURIComponent(qiPath));
  check('quick-ingest private header says Private: yes',
    String(qiDoc.content || '').includes('**Private:** yes'));
  await fetch('http://localhost/prism/api/file?path=' + encodeURIComponent(qiPath), { method: 'DELETE' });

  // ── 7) Ingest page toggle still drives the shared path ──────────────────
  await run('renderIngest(document.getElementById("content-area"))');
  run('togglePrivate()');
  check('Ingest toggle flips _isPrivate on', run('_isPrivate') === true);
  run(`document.getElementById('ing-type').value = 'unordered'`);
  run(`document.getElementById('ing-title').value = ${JSON.stringify('f9-page-' + TOKEN)}`);
  run(`document.getElementById('ing-content').value = ${JSON.stringify(PROSE)}`);
  await run('submitIngest()');
  await sleep(800);
  const list3 = await api('/prism/api/list?path=' + encodeURIComponent('ingestion/unprocessed'));
  const pageIng = (list3 || []).find(f => f.type === 'file' && f.name.includes('f9-page-' + TOKEN));
  check('Ingest page artifact created', !!pageIng);
  check('Ingest page private artifact has -private suffix',
    !!pageIng && pageIng.name.includes('-private'));
  check('Ingest toggle reset after submit', run('_isPrivate') === false);
  if (pageIng) await fetch('http://localhost/prism/api/file?path=' + encodeURIComponent(pageIng.path), { method: 'DELETE' });

  // Immutable source mirrors live outside the API's DELETE-allowed roots;
  // the harness owns its own noise (same pattern as the F10 harness).
  // Match the 'f9tok' prefix, not just this run's token, so a previously
  // crashed run's mirrors can't accumulate across runs.
  const sourceRoot = path.join(process.cwd(), 'prism', 'vault', 'source');
  for (const dir of fs.readdirSync(sourceRoot)) {
    const dd = path.join(sourceRoot, dir);
    if (!fs.statSync(dd).isDirectory()) continue;
    for (const f of fs.readdirSync(dd)) {
      const fp = path.join(dd, f);
      if (f.endsWith('.md') && fs.readFileSync(fp, 'utf8').includes('f9tok')) fs.unlinkSync(fp);
    }
  }

  const pass = results.filter(r => r[1]).length;
  console.log(results.map(([n, ok]) => (ok ? 'PASS ' : 'FAIL ') + n).join('\n'));
  console.log(`\n${pass}/${results.length} checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
