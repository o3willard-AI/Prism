// Prism end-to-end regression test (F2 verification + /lenses + lens apply).
//
// Runs the REAL script block of prism/index.html in a Node VM against a
// minimal DOM stub, with fetch() pointed at the REAL backend through
// Apache (http://localhost/prism/api). No mocks of application logic —
// only the browser is stubbed.
//
// Prerequisites:
//   - python3 prism/api-server.py running on :8082
//   - Apache serving /prism/ with /prism/api/ proxied to :8082
//     (see server/apache-prism.conf)
//   - node (uses global fetch — Node 18+)
//
// Usage:  node scripts/e2e-verify.js     (exit 0 = all checks pass)

// End-to-end test: runs the REAL prism/index.html script in a VM with a
// minimal DOM stub, while fetch() hits the REAL Apache backend on :80.
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('/home/sblanken/workspace/Prism/prism/index.html', 'utf8');
const script = fs.readFileSync('/home/sblanken/workspace/Prism/prism/app.js', 'utf8');

// ── DOM stub ──────────────────────────────────────────────────────────────
class El {
  constructor(id) {
    this.id = id || '';
    this.innerHTML = ''; this.textContent = ''; this.value = '';
    this.style = {}; this.children = []; this.classList = { add(){}, remove(){}, toggle(){} };
    this.scrollTop = 0; this.scrollHeight = 0; this.checked = false;
  }
  addEventListener() {} removeEventListener() {}
  appendChild(c) { this.children.push(c); return c; }
  setAttribute() {} getAttribute() { return ''; }
  focus() {} select() {} click() {} blur() {}
  querySelector() { return new El(); } querySelectorAll() { return []; }
  remove() {}
}
const byId = {};
const documentStub = {
  getElementById(id) { return byId[id] || (byId[id] = new El(id)); },
  createElement(tag) { return new El(tag); },
  addEventListener() {}, removeEventListener() {},
  body: new El('body'),
};
const windowStub = {
  addEventListener() {}, removeEventListener() {},
  setTimeout, clearTimeout,
  fetch: (...a) => fetch(...a),
  location: { href: 'http://localhost/prism' },
};

// fetch → real backend through Apache
const realFetch = (url, opts) => fetch('http://localhost' + url, opts);

const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  Promise, JSON, Math, Date, RegExp, URL, URLSearchParams,
  encodeURIComponent, decodeURIComponent, Object, Array, String, Number, Boolean,
  Error, TypeError, RangeError, Symbol, Proxy, Reflect, Map, Set, WeakMap,
  document: documentStub,
  window: windowStub,
  navigator: { clipboard: {}, userAgent: 'node-e2e' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  fetch: realFetch,
  requestAnimationFrame: (f) => setTimeout(f, 0),
  FileReader: class { readAsText() {} },
  Blob: class {},
  history: { pushState() {}, replaceState() {} },
};
sandbox.window = Object.assign(windowStub, sandbox);
vm.createContext(sandbox);

const results = [];
const check = (name, cond) => { results.push([name, !!cond]); if (!cond) console.log('FAIL at:', name); };

(async () => {
  // Run the real page script (boot IIFE fires renderView('dashboard'))
  vm.runInContext(script, sandbox, { timeout: 10000 });
  // Top-level `let` bindings don't attach to the sandbox object — reach them
  // through the context. _chat is never reassigned, so one live ref suffices.
  const chat = vm.runInContext('_chat', sandbox);

  // 1) Desk boot: real /lenses fetched, badges wired
  await new Promise(r => setTimeout(r, 1200));
  const status = vm.runInContext('_status', sandbox);
  if (!status) console.log('DIAG content-area:', byId['content-area'].innerHTML.slice(0, 300));
  check('desk booted with /lenses data', status && status.badges);
  check('badge-hyp shows live count', byId['badge-hyp'] && String(byId['badge-hyp'].textContent) === '1');
  check('desk rendered into content-area', /Bring fog\. Get focus\./.test(byId['content-area'].innerHTML));
  check('paused section absent when none', !/Paused sessions/.test(byId['content-area'].innerHTML));

  // 2) F2 verify — PRD Gate Execution paste (requirements workflow)
  const PRD_EXEC = `Scope clarity confirmed at 95%+. Proceeding to PRD generation.

# 1. Executive Summary & JTBD
When users finish a flow they want to export it.
# 2. Success Metrics
KPI: export rate.
# 3. User Personas & Critical Path
PM then click export.
# 4. Functional Requirements (MoSCoW)
Must: PDF export.
# 5. Technical Architecture
Client-side render.
# 6. Acceptance Criteria (BDD Format)
Given a PRD When exported Then PDF lands.
# 7. Risks & Assumptions
Browser rendering variance.`;

  chat.workflowId = 'requirements-default';
  chat.artifactPath = 'requirements/2026-08-24-e2e-test.md';
  chat.wfStep = 'awaiting-prd-gate';
  chat.messages = [{ role: 'user', text: PRD_EXEC, attachments: [] }];
  await vm.runInContext(`_wfVerifyPasted(${JSON.stringify(PRD_EXEC)}, 'prd-gate')`, sandbox, { timeout: 10000 });
  check('PRD execution verified → post-processing', chat.wfStep === 'post-processing');
  chat.artifactPath = null;  // keep the auto-save timer from writing test junk
  const verdictMsg = chat.messages.find(x => x.verify);
  check('verdict card recorded', verdictMsg && verdictMsg.verify.verdict === 'match');
  check('verdict card rendered with markers', /8\/8 markers/.test(sandbox._verifyCardHtml(chat.messages.indexOf(verdictMsg))));

  // 3) F2 verify — PRD Gate INQUIRY paste must route to inquiry, not post-processing
  const PRD_INQ = `I have identified 2 areas where my certainty is below 95%. Please clarify:

1. Which file formats at launch?
2. Sync or queued export?`;
  chat.wfStep = 'awaiting-prd-gate';
  chat.messages = [{ role: 'user', text: PRD_INQ, attachments: [] }];
  await vm.runInContext(`_wfVerifyPasted(${JSON.stringify(PRD_INQ)}, 'prd-gate')`, sandbox, { timeout: 10000 });
  check('PRD inquiry detected → inquiry step (the F2 bug)', chat.wfStep === 'inquiry');
  chat.artifactPath = null;

  // 4) F2 verify — garbage paste does NOT advance; card offers steering doors
  const JUNK = 'Sure! Here is a summary of the meeting. Everyone agreed to move forward.';
  chat.wfStep = 'awaiting-prd-gate';
  chat.messages = [{ role: 'user', text: JUNK, attachments: [] }];
  await vm.runInContext(`_wfVerifyPasted(${JSON.stringify(JUNK)}, 'prd-gate')`, sandbox, { timeout: 10000 });
  check('junk paste does not advance', chat.wfStep === 'awaiting-prd-gate');
  chat.artifactPath = null;
  const junkMsg = chat.messages.find(x => x.verify);
  check('junk verdict = unrecognized', junkMsg.verify.verdict === 'unrecognized');
  const cardHtml = sandbox._verifyCardHtml(chat.messages.indexOf(junkMsg));
  check('junk card shows Accept anyway + Re-run doors',
    /Accept anyway/.test(cardHtml) && /Re-run the skill/.test(cardHtml));

  // 5) Re-run door appends steering note to last prompt
  chat.messages = [
    { role: 'agent', text: '', attachments: [], codeBlock: 'ARTIFACT PATH: requirements/x.md\nSEED CONTENT: ...' },
    { role: 'user', text: JUNK, attachments: [] },
    { role: 'agent', text: '', attachments: [], verify: { ...junkMsg.verify, msgIdx: 1, done: false } },
  ];
  vm.runInContext('_verifyRerun(2)', sandbox, { timeout: 5000 });
  const lastMsg = chat.messages[chat.messages.length - 1];
  check('re-run reissues prompt with steering note',
    lastMsg.codeBlock && /Prism steering/.test(lastMsg.codeBlock) && /ARTIFACT PATH/.test(lastMsg.codeBlock));
  check('verdict card marked done', chat.messages[2].verify.done === true);

  // 6) Hypotheses workflow — doc-synth paste → Clarification Gate prompt
  chat.workflowId = 'hypotheses-default';
  chat.wfStep = 'awaiting-doc-synth';
  chat.artifactPath = 'hypotheses/2026-08-24-e2e-hyp.md';
  const DOC_SYNTH = `## 1. Core Subject & Context
Planning a refactor.
## 2. Key Assertions & Primary Points
- The author asserts that copy-first works.
## 3. Constraints & Dependencies
Node only.
## 4. Tangents & Secondary Insights
[Secondary Consideration] keyboard nav.
## 5. Identified Ambiguities
**What is unclear:** nothing major.`;
  chat.messages = [{ role: 'user', text: DOC_SYNTH, attachments: [] }];
  await vm.runInContext(`_wfVerifyPasted(${JSON.stringify(DOC_SYNTH)}, 'doc-synth')`, sandbox, { timeout: 10000 });
  check('doc-synth accepted → clarification gate step', chat.wfStep === 'awaiting-clarification');
  chat.artifactPath = null;
  const gateMsg = chat.messages[chat.messages.length - 1];
  check('clarification gate prompt issued', gateMsg.codeBlock && /clarification-gate\.md/.test(gateMsg.codeBlock));

  // 7) Hypothesis brief Inquiry → inquiry step
  chat.wfStep = 'awaiting-clarification';
  chat.messages = [{ role: 'user', text: PRD_INQ, attachments: [] }];
  await vm.runInContext(`_wfVerifyPasted(${JSON.stringify(PRD_INQ)}, 'hypothesis-brief')`, sandbox, { timeout: 10000 });
  check('hypothesis brief inquiry → inquiry step', chat.wfStep === 'inquiry');
  chat.artifactPath = null;

  // 8) Apply verified output to a REAL lens file through the API
  const ing = await realFetch('/prism/api/ingest', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'unordered', title: 'e2e-hyp-apply', content: 'users churn because onboarding drags', is_private: true }),
  }).then(r => r.json());
  const hyp = await realFetch('/prism/api/hypotheses/from-epiphany', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'e2e-hyp-apply', artifact_path: ing.path }),
  }).then(r => r.json());
  check('test lens file created', hyp.ok && hyp.path);

  const BRIEF = `**Hypothesis Statement:** We believe that faster onboarding will cause retention lift for new users.
**Basis:** Support tickets mention onboarding confusion.
**Success Signal:** D7 retention +5pp.
**Failure Signal:** No movement after 30 days.
**Test Approach:** A/B cohort over 2 weeks.
**Assumptions:** Traffic volume stable.`;
  chat.artifactPath = hyp.path;
  chat.workflowId = 'hypotheses-default';
  chat.wfStep = 'awaiting-clarification';
  chat.messages = [{ role: 'user', text: BRIEF, attachments: [] }];
  await vm.runInContext(`_wfVerifyPasted(${JSON.stringify(BRIEF)}, 'hypothesis-brief')`, sandbox, { timeout: 10000 });
  check('brief accepted → post-processing', chat.wfStep === 'post-processing');
  vm.runInContext('clearTimeout(_chatSaveTimer); _chatSaveTimer = null;', sandbox);
  chat.artifactPath = null;
  await new Promise(r => setTimeout(r, 400)); // let async file write land
  const fileBack = await realFetch('/prism/api/file?path=' + encodeURIComponent(hyp.path)).then(r => r.json());
  check('lens file gained verified brief section', /Hypothesis brief \(agent output, structure verified by Prism\)/.test(fileBack.content));
  check('lens file status set to review', /\*\*Status:\*\* review/.test(fileBack.content));
  check('Epiphany provenance preserved', /## Epiphany/.test(fileBack.content));

  // cleanup: remove test artifacts via API
  await realFetch('/prism/api/file?path=' + encodeURIComponent(hyp.path), { method: 'DELETE' });
  await realFetch('/prism/api/file?path=' + encodeURIComponent(ing.path), { method: 'DELETE' });

  // report
  const pass = results.filter(r => r[1]).length;
  console.log(results.map(([n, ok]) => (ok ? 'PASS ' : 'FAIL ') + n).join('\n'));
  console.log(`\n${pass}/${results.length} checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
