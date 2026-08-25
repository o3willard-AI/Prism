// Prism LCM-provenance regression test — Crafting Methods.
//
// Proves the five settled forks through the REAL backend (Apache -> api):
//   fork 1: methods live in knowledge/resources/crafting-methods/
//   fork 2: pointer frontmatter attaches to the lens file
//   fork 3: write-once — the method is a historical asset (409 on rewrite)
//   fork 4b: emit never moves the method; the pointer stays absolute and
//            resolves from the archive (learning from the past as it happened)
//   fork 5: supersession markers — metadata only, content immutable
// Plus: pre-LCM lenses get no method button (GN-006), /methods lists the
// library, and the UI pointer extraction is correct.
//
// Prereqs: python3 prism/api-server.py on :8082, Apache serving /prism/.
// Usage: node scripts/e2e-verify-lcm.js   (exit 0 = all checks pass)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(process.cwd(), 'prism/index.html'), 'utf8');
const script = fs.readFileSync(path.join(process.cwd(), 'prism/app.js'), 'utf8');

class El {
  constructor(id) {
    this.id = id || '';
    this.innerHTML = ''; this.textContent = ''; this.value = '';
    this.style = {}; this.disabled = false;
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
  navigator: { clipboard: {}, userAgent: 'node-lcm' },
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

vm.createContext(sandbox);
const run = (expr, t = 15000) => vm.runInContext(expr, sandbox, { timeout: t });

const results = [];
const check = (name, cond) => { results.push([name, !!cond]); if (!cond) console.log('FAIL at:', name); };
const api = (p, opts) => fetch('http://localhost' + p, opts).then(r => r.json());
const apiPost = (p, body) => api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const apiPostRaw = async (p, body) => {
  const r = await fetch('http://localhost' + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json() };
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

const TOKEN = 'lcmtok' + Date.now().toString(36);
const PROSE = `so basically the ${TOKEN} export feature keeps failing whenever the report gets big and the ops team has been complaining about it for weeks. honestly i think the whole pipeline needs a rethink before we add more features. we also had that weird incident with the staging deploy on tuesday but that might be unrelated. i want to talk to the support team about what they are hearing from customers before we commit to anything.`;

(async () => {
  vm.runInContext(script, sandbox, { timeout: 10000 });
  await sleep(800);   // boot IIFE settles

  // ── Fork 1: the location ───────────────────────────────────────────────
  const methodsDir = path.join(process.cwd(), 'prism', 'vault', 'knowledge', 'resources', 'crafting-methods');
  check('fork1: crafting-methods dir exists in the vault', fs.existsSync(methodsDir));
  check('fork1: README documents the contract', fs.existsSync(path.join(methodsDir, 'README.md')));

  // ── Create a real lens through the desk pipeline ───────────────────────
  await run('renderDesk(document.getElementById("content-area"))');
  byId['desk-content'].value = PROSE;
  run('_desk.content = ' + JSON.stringify(PROSE));
  run("deskLensDoor('requirements')");
  await sleep(2500);
  const chatCfg = sandbox.__chatCfg;
  check('test lens created through the desk', !!chatCfg &&
    String(chatCfg.artifactPath || '').startsWith('requirements/'));
  const lensPath = chatCfg.artifactPath;

  // ── Fork 3: write-once, historical asset ───────────────────────────────
  const CONVO = [
    { role: 'agent', text: `What light does the ${TOKEN} lens accept?` },
    { role: 'human', text: 'Raw ops complaints about failing exports.' },
    { role: 'agent', text: 'What must be true of the emission for someone to act without asking?' },
    { role: 'human', text: 'It must carry the failure conditions verbatim.' },
  ];
  let r = await apiPostRaw('/prism/api/method', {
    lens: 'lcm-' + TOKEN, conversation: CONVO, lens_path: lensPath,
    crafted_by: 'e2e-lcm', outcome: `test lens for ${TOKEN}`,
    decisions: 'chose requirements lens because the thought carries capability language',
  });
  check('fork3: first write succeeds', r.status === 200 && r.data.ok === true);
  const methodPath = r.data.path;
  check('fork1: method lives in knowledge/resources/crafting-methods/',
    String(methodPath).startsWith('knowledge/resources/crafting-methods/'));
  check('fork2: pointer attached to the lens frontmatter', r.data.pointer_attached === true);

  r = await apiPostRaw('/prism/api/method', { lens: 'lcm-' + TOKEN, conversation: 'rewrite attempt' });
  check('fork3: second write refused (409 — historical asset)', r.status === 409);

  // pointer actually present and resolvable in the lens file
  const lensDoc = await api('/prism/api/file?path=' + encodeURIComponent(lensPath));
  check('fork2: lens frontmatter carries the pointer line',
    String(lensDoc.content).includes('**Crafting method:**') &&
    String(lensDoc.content).includes(methodPath));
  const methodDoc = await api('/prism/api/method?path=' + encodeURIComponent(methodPath));
  check('method content readable via /method',
    String(methodDoc.content || '').includes('Conversation record'));
  check('conversation record contains the crafting dialogue',
    String(methodDoc.content || '').includes(TOKEN));

  // ── UI: pointer extraction + affordance rules ──────────────────────────
  const ptr = run(`_extractMethodPointer(${JSON.stringify(lensDoc.content)})`);
  check('UI extracts the method pointer', !!ptr && ptr.path === methodPath);
  const preMark = run(`_extractMethodPointer('**Crafting method:** not recorded (pre-LCM)')`);
  check('UI recognises the pre-LCM mark (no dead button)', !!preMark && preMark.pre === true && !preMark.path);

  // ── Fork 4b: emit — method stays, pointer resolves from the archive ────
  const em = await apiPost('/prism/api/emit', { lens: 'requirements', path: lensPath });
  check('emit succeeds', em.ok === true && !!em.emission_path);
  check('fork4: the method file did NOT travel with the emission',
    !(em.moved || []).some(p => String(p).includes('crafting-methods')));
  const archivedLens = (em.moved || [])[0];
  check('lens moved into archive', String(archivedLens || '').startsWith('archive/'));

  const archDoc = await api('/prism/api/file?path=' + encodeURIComponent(archivedLens));
  check('fork4: pointer survived the move into the archive',
    String(archDoc.content).includes(methodPath));
  const methodStillThere = await api('/prism/api/method?path=' + encodeURIComponent(methodPath));
  check('fork4: method still readable from the library after emit',
    !!methodStillThere.content && String(methodStillThere.content).includes('Conversation record'));

  // ── Fork 5: supersession markers — metadata only ───────────────────────
  const beforeStatus = methodDoc.content;
  r = await apiPostRaw('/prism/api/method/status', {
    path: methodPath, status: 'superseded', marker: `superseded by lcm-v2-${TOKEN} rationalization` });
  check('fork5: supersession marked', r.status === 200 && r.data.status === 'superseded');
  const afterDoc = await api('/prism/api/method?path=' + encodeURIComponent(methodPath));
  check('fork5: Status field now superseded', String(afterDoc.content).includes('**Status:** superseded'));
  check('fork5: Deprecation marker carries date + rationale',
    /\*\*Deprecation marker:\*\* \d{4}-\d{2}-\d{2} — superseded by lcm-v2/.test(String(afterDoc.content)));
  const stripMeta = s => String(s).split('---').slice(1).join('---');
  check('fork5: conversation content untouched', stripMeta(beforeStatus) === stripMeta(afterDoc.content));

  r = await apiPostRaw('/prism/api/method/status', { path: methodPath, status: 'bogus' });
  check('fork5: invalid status refused', r.status === 400);

  // ── /methods lists the library ─────────────────────────────────────────
  const lib = await api('/prism/api/methods');
  const mine = (lib.methods || []).find(m => m.path === methodPath);
  check('library lists the method', !!mine);
  check('library reports superseded status', mine && mine.status === 'superseded');

  // ── Pre-LCM honesty: reference lenses carry the mark ───────────────────
  const skill = await api('/prism/api/file?path=' + encodeURIComponent('knowledge/resources/skills/intent-synth.md'));
  check('reference lens carries the honest pre-LCM mark',
    String(skill.content).includes('not recorded (pre-LCM)'));

  // ── Cleanup: this is a harness fixture, not real light — remove both the
  //    method and the archived emission so the vault stays clean (the emit
  //    behaviour itself is already proven by the fork4 checks above).
  //    Match the 'lcmtok' PREFIX (not just this run's token) and sweep
  //    source/ mirrors too, so a previously crashed run can't leave residue.
  fs.unlinkSync(path.join(process.cwd(), 'prism', 'vault', methodPath));
  if (archivedLens) {
    const emissionDir = path.join(process.cwd(), 'prism', 'vault', path.dirname(archivedLens));
    fs.rmSync(emissionDir, { recursive: true, force: true });
  }
  // sweep any fixture archive dirs / source mirrors carrying the prefix
  const vaultRoot = path.join(process.cwd(), 'prism', 'vault');
  const sweepDir = (rel) => {
    const dir = path.join(vaultRoot, rel);
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir)) {
      const p = path.join(dir, entry);
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        try { if (fs.readdirSync(p).some(f => fs.readFileSync(path.join(p, f), 'utf8').includes('lcmtok'))) fs.rmSync(p, { recursive: true, force: true }); } catch (e) {}
      } else if (entry.endsWith('.md')) {
        try { if (fs.readFileSync(p, 'utf8').includes('lcmtok')) fs.unlinkSync(p); } catch (e) {}
      }
    }
  };
  sweepDir('archive/requirements');
  sweepDir('source/unordereds');
  const leftover = fs.existsSync(path.join(process.cwd(), 'prism', 'vault', methodPath));
  check('cleanup: method file removed', !leftover);

  const pass = results.filter(x => x[1]).length;
  console.log(results.map(([n, ok]) => (ok ? 'PASS ' : 'FAIL ') + n).join('\n'));
  console.log(`\n${pass}/${results.length} checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
