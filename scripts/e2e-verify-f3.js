// Prism F3 regression test — resume fidelity.
//
// Exercises pause/resume through the REAL backend (Apache -> api-server):
//   - session sidecar written by auto-save and by Pause Here
//   - shared _wfResumeFromPause replays real messages (code blocks, verdict
//     cards with live doors), restores the paused step in every runner
//   - rationalizations respect the pause file (previously ignored)
//   - sidecars stay out of /tree and /lenses, and die with the lens
//
// Prereqs: python3 prism/api-server.py on :8082, Apache serving /prism/.
// Usage: node scripts/e2e-verify-f3.js   (exit 0 = all checks pass)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(process.cwd(), 'prism/index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

class El {
  constructor(id) {
    this.id = id || '';
    this.innerHTML = ''; this.textContent = ''; this.value = '';
    this.style = {}; this.classList = { add(){}, remove(){}, toggle(){} };
    this.scrollTop = 0; this.scrollHeight = 0;
  }
  addEventListener() {} appendChild(c) { return c; }
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
  document: { getElementById: id => byId[id] || (byId[id] = new El(id)), createElement: t => new El(t), addEventListener(){}, body: new El('body') },
  window: { addEventListener() {}, location: { href: 'http://localhost/prism' } },
  navigator: { clipboard: {}, userAgent: 'node-f3' },
  localStorage: { getItem: () => null, setItem(){}, removeItem(){} },
  fetch: (u, o) => fetch('http://localhost' + u, o),
  requestAnimationFrame: f => setTimeout(f, 0),
  FileReader: class { readAsText(){} }, Blob: class {},
};
sandbox.window = Object.assign(sandbox.window, sandbox);
sandbox.renderView = () => {};   // wfPauseHere's redirect goes nowhere in the test
vm.createContext(sandbox);
const run = (expr, t = 10000) => vm.runInContext(expr, sandbox, { timeout: t });

const results = [];
const check = (name, cond) => { results.push([name, !!cond]); if (!cond) console.log('FAIL at:', name); };
const api = (path, opts) => fetch('http://localhost' + path, opts).then(r => r.json());
const apiPost = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  vm.runInContext(script, sandbox, { timeout: 10000 });
  await sleep(800);

  // ── Setup: create a real requirement through the desk pipeline ─────────
  const ing = await apiPost('/prism/api/ingest', { type: 'unordered', title: 'f3-resume-test', content: 'we need export but it keeps failing on big reports', is_private: true });
  const req = await apiPost('/prism/api/requirements/from-genesis', { title: 'f3-resume-test', artifact_path: ing.path });
  check('test requirement created', req.ok && req.path);

  const chat = run('_chat');
  chat.workflowId = 'requirements-default';
  chat.lensKey = 'requirements';
  chat.artifactPath = req.path;
  chat.artifactTitle = 'f3-resume-test';
  chat.wfStep = 'awaiting-prd-gate';

  // Build a realistic session: greeting, skill prompt, user paste, verdict
  // card with a PENDING decision (must survive the pause).
  const PRD = 'ARTIFACT TYPE: formatted\nSEED CONTENT: ...';
  const JUNK = 'Sorry, I do not have enough context.';
  chat.messages = [
    { role: 'agent', text: 'Step 1 complete.', attachments: [], codeBlock: PRD },
    { role: 'user', text: JUNK, attachments: [] },
    { role: 'agent', text: '', attachments: [],
      verify: { ok: true, shape: 'prd-gate', verdict: 'unrecognized', kind: 'inquiry',
                kind_label: 'Inquiry (clarifying questions)', hits: 0, total: 2,
                missing: ['certainty statement', 'numbered question list'],
                advice: 'does not look like PRD Gate output', msgIdx: 1, accepted: false, done: false } },
  ];

  // 1) Auto-save writes the session sidecar
  await run('_chatDoSave()');
  await sleep(600);
  const sessPath = req.path.replace(/\.md$/, '-session.json');
  const sessBack = await api('/prism/api/file?path=' + encodeURIComponent(sessPath));
  check('auto-save wrote session sidecar', sessBack.content);
  let sess = null;
  try { sess = JSON.parse(sessBack.content); } catch (_) {}
  check('sidecar is valid JSON', !!sess && Array.isArray(sess.messages));
  check('sidecar captured 3 messages', sess && sess.messages.length === 3);
  check('sidecar kept codeBlock', sess && sess.messages[0].codeBlock === PRD);
  check('sidecar kept pending verdict', sess && sess.messages[2].verify && sess.messages[2].verify.done === false);

  // 2) Pause Here writes pause doc + transcript + sidecar
  await run('wfPauseHere()');
  await sleep(1500);   // includes the 800ms redirect delay
  const pausePath = req.path.replace(/\.md$/, '-pause.md');
  const pauseBack = await api('/prism/api/file?path=' + encodeURIComponent(pausePath));
  check('pause doc written', !!pauseBack.content);
  check('pause doc lens-aware (Requirement, not Requirements-hardcoded)', /\*\*Requirement\*\* lens/.test(pauseBack.content));
  check('pause doc step recorded', /\*\*Step:\*\* awaiting-prd-gate/.test(pauseBack.content));
  check('pause doc next-step guide present', /## How to Resume/.test(pauseBack.content));

  // 3) Sidecars stay out of the vault tree and lens registry
  const tree = await api('/prism/api/tree');
  const reqNode = tree.find(n => n.name === 'requirements');
  const treeNames = (reqNode?.children || []).map(c => c.name);
  check('pause sidecar hidden from tree', !treeNames.some(n => n.endsWith('-pause.md')));
  check('session sidecar hidden from tree', !treeNames.some(n => n.endsWith('-session.json')));
  const lenses = await api('/prism/api/lenses');
  check('paused session listed in /lenses', (lenses.paused || []).some(p => p.path === req.path));

  // 4) Resume — shared helper replays the real session. Scrollback ends on a
  //    live verdict card, so no extra resume message should be appended.
  chat.messages = [{ role: 'agent', text: 'greeting', attachments: [] }];
  chat.wfStep = 'init';
  chat.artifactContent = null;
  const resumed = await run('_wfResumeFromPause()');
  check('resume returned true', resumed === true);
  check('step restored to awaiting-prd-gate', chat.wfStep === 'awaiting-prd-gate');
  check('all 3 messages replayed', chat.messages.length === 3);
  check('prompt codeBlock replayed', chat.messages[0].codeBlock === PRD);
  const vmsg = chat.messages[2];
  check('verdict card replayed', vmsg && vmsg.verify && vmsg.verify.verdict === 'unrecognized');
  check('verdict card doors still live (not done)', vmsg.verify.done === false);
  check('verdict msgIdx re-indexed', vmsg.verify.msgIdx === 1);
  check('no spurious resume message after live verdict card', chat.messages.length === 3);

  // 5) Legacy session (sidecar missing): scrollback can't be replayed, so
  //    the step's prompt must be re-issued from the artifact instead.
  await fetch('http://localhost/prism/api/file?path=' + encodeURIComponent(sessPath), { method: 'DELETE' });
  chat.messages = [{ role: 'agent', text: 'greeting', attachments: [] }];
  chat.artifactContent = null;
  await run('_wfResumeFromPause()');
  check('legacy fallback message shown', /before replay support/.test(chat.messages[0].text));
  const last = chat.messages[chat.messages.length - 1];
  check('prompt re-issued when scrollback lacks one', last.codeBlock && /ARTIFACT/.test(last.codeBlock));

  // 6) Rationalizations respect the pause file (previously ignored)
  const rat = await apiPost('/prism/api/rationalizations/from-gibberish', { title: 'f3-resume-rat', artifact_path: ing.path });
  check('test rationalization created', rat.ok && rat.path);
  const ratPause = rat.path.replace(/\.md$/, '-pause.md');
  const ratPauseDoc = `**Step:** awaiting-intent-synth\n\n---\n\n## How to Resume\n\nContinue.`;
  await apiPost('/prism/api/file', { path: ratPause, content: ratPauseDoc });
  const ratSess = rat.path.replace(/\.md$/, '-session.json');
  await apiPost('/prism/api/file', { path: ratSess, content: JSON.stringify({
    workflow: 'rationalizations-default', step: 'awaiting-intent-synth',
    messages: [{ role: 'agent', text: 'Step 1 complete — Intent Synth.', codeBlock: 'ARTIFACT TYPE: unordered' }],
  }) });
  chat.workflowId = 'rationalizations-default';
  chat.artifactPath = rat.path;
  chat.artifactTitle = 'f3-resume-rat';
  chat.artifactContent = null;
  chat.messages = [{ role: 'agent', text: 'greeting', attachments: [] }];
  chat.wfStep = 'init';
  const ratResumed = await run('_wfResumeFromPause()');
  check('rationalizations resume works now', ratResumed === true);
  check('rat step restored', chat.wfStep === 'awaiting-intent-synth');
  check('rat session replayed', chat.messages.some(m => m.codeBlock === 'ARTIFACT TYPE: unordered'));

  // 7) Deleting a lens cleans up its sidecars
  await run(`deleteThought(${JSON.stringify(req.path)}, 'requirements')`);
  await sleep(600);
  const gone = await api('/prism/api/file?path=' + encodeURIComponent(pausePath));
  check('pause sidecar deleted with lens', !!gone.error);
  const sessGone = await api('/prism/api/file?path=' + encodeURIComponent(sessPath));
  check('session sidecar deleted with lens', !!sessGone.error);
  // cleanup rat artifacts
  await apiPost('/prism/api/file', { path: ratPause, content: 'x' }); // ensure exists for delete
  await fetch('http://localhost/prism/api/file?path=' + encodeURIComponent(ratPause), { method: 'DELETE' });
  await fetch('http://localhost/prism/api/file?path=' + encodeURIComponent(ratSess), { method: 'DELETE' });
  await fetch('http://localhost/prism/api/file?path=' + encodeURIComponent(rat.path), { method: 'DELETE' });
  await fetch('http://localhost/prism/api/file?path=' + encodeURIComponent(ing.path), { method: 'DELETE' });

  const pass = results.filter(r => r[1]).length;
  console.log(results.map(([n, ok]) => (ok ? 'PASS ' : 'FAIL ') + n).join('\n'));
  console.log(`\n${pass}/${results.length} checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
