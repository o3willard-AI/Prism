// Prism end-to-end regression test — F20 (live): the UX Bridge interview loop.
//
// e2e-verify-f20.js asserts the runner's SHAPE statically. This one drives it
// for real against the live backend, because the property that matters most
// is behavioural and easy to get wrong:
//
//   a clarifying QUESTION must never be written into the lens file, and only
//   a compiled SPEC may be — written at status ux-ready, not review.
//
// It also proves the loop is stateful: the second prompt carries the answer
// log, so the agent is not asked to restart the interview every turn.
//
// Prerequisites: backend :8082 and a front door serving /prism/ (see README).
// Usage:  node scripts/e2e-verify-f20-loop.js     (exit 0 = all checks pass)

// Drive the UX Bridge interview loop end-to-end against the live backend.
// Verifies the two outcomes that matter: a QUESTION keeps the loop open and
// does NOT touch the lens file; a SPEC writes it at status ux-ready.
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const API = 'http://127.0.0.1:8090/prism/api';
const app = fs.readFileSync('/home/sblanken/workspace/Prism/prism/app.js', 'utf8');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class El {
  constructor(id) {
    this.id = id || ''; this.innerHTML = ''; this.textContent = ''; this.value = '';
    this.style = {}; this.children = []; this.checked = false; this.scrollTop = 0; this.scrollHeight = 0;
    this.classList = { add(){}, remove(){}, toggle(){}, contains(){ return false; } };
  }
  addEventListener(){} removeEventListener(){} appendChild(c){ this.children.push(c); return c; }
  setAttribute(){} getAttribute(){ return ''; } focus(){} select(){} click(){} blur(){} remove(){}
  querySelector(){ return new El(); } querySelectorAll(){ return []; }
  closest(){ return null; } insertAdjacentHTML(){}
}
const byId = {};
const base = `http://127.0.0.1:8090/prism`;
const f = (u, o) => fetch(new URL(u, API).toString(), o);
const sandbox = {
  console,
  document: {
    getElementById(id){ return byId[id] || (byId[id] = new El(id)); },
    createElement(t){ return new El(t); }, addEventListener(){}, removeEventListener(){},
    querySelectorAll(){ return []; }, querySelector(){ return null; },
    insertAdjacentHTML(){}, body: new El('body'),
  },
  location: { href: base },
  window: { addEventListener(){}, removeEventListener(){}, setTimeout, clearTimeout,
            location: { href: base }, fetch: f },
  fetch: f, setTimeout, clearTimeout, confirm: () => true, alert(){},
  Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error,
  parseInt, isNaN, encodeURIComponent, decodeURIComponent,
  requestAnimationFrame: (f) => setTimeout(f, 0),
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(app, sandbox, { timeout: 40000 });
const run = (e) => vm.runInContext(e, sandbox, { timeout: 40000 });

let pass = 0, fail = 0;
const check = (n, c, d) => { if (c) { console.log('  PASS ' + n); pass++; }
  else { console.log('  FAIL ' + n + (d ? '  — ' + d : '')); fail++; } };

const QUESTION = 'To ensure the UX team knows the duplicate-submit case, could you describe what the user should see?';
const SPEC = `# UX Hand-off Specification
**Feature:** Bulk export
## 1. Problem Statement
Analysts cannot extract data.
## 2. User Stories (INVEST)
As an analyst I want export so that I can leave.
## 3. Acceptance Criteria (Gherkin)
Given a dataset, When export, Then a CSV.
## 4. Key User Scenarios and Flows
1. Open export. 2. Choose format.
## 5. Error States and Edge Cases
Trigger: dataset too large.
## 6. Accessibility Considerations
Default WCAG 2.1 AA applies.
## 7. Dependencies and Assumptions
Depends on the export worker.
## 8. Open Questions Requiring Further Discovery
Who owns retention policy?
## 9. Users or Personas
Analyst — primary.
## 10. Business Goals
Metric: exports/week. Target 500.
## 11. Constraints
Must not block the UI thread.
`;

(async () => {
  // Seed a requirement to interview.
  const reqPath = 'requirements/2026-09-27-f20probe-bulk-export.md';
  await fetch(API + '/file', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: reqPath, content:
`# Bulk export

**Status:** draft
**Priority:** must
**Created:** 2026-09-27
**Last updated:** 2026-09-27

---

## Genesis

Analysts need to export their datasets in bulk.

---

## Problem Statement

TODO
` }) });

  // Launch the workflow the way the app does.
  run(`_chat = { workflowId: 'ux-bridge-default', title: 'UX Bridge', messages: [],
    pending: [], artifactPath: ${JSON.stringify(reqPath)}, artifactTitle: 'bulk-export',
    subAssets: [], wfStep: 'init', artifactContent: null, artifactMeta: null,
    pendingVerify: null, gibberishPath: null, speechRecog: null, speechOn: false }`);
  run(`_chat.messages.push({ role: 'agent', text: 'greeting', attachments: [] })`);
  byId['wf-thread'] = new El('wf-thread');
  byId['topbar-title'] = new El('topbar-title');
  byId['toast'] = new El('toast');

  await run('_wfUxInit()');
  await sleep(700);

  check('init routed to awaiting-bridge', run('_chat.wfStep') === 'awaiting-bridge',
        run('_chat.wfStep'));
  const firstPrompt = run("_chat.messages[_chat.messages.length-1].codeBlock || ''");
  check('init issued the bridge prompt', /skills\/ux-bridge\.md/.test(firstPrompt));
  check('first prompt has no answer log', !/UX Interview/.test(firstPrompt));
  check('first prompt carries the PM description',
        /Analysts need to export/.test(firstPrompt));
  check('first prompt names the 11-field doc',
        /ux-information-requirements\.md/.test(firstPrompt));

  // Turn 1: the agent asks a question. The PM answers.
  run(`_chat.messages.push({ role: 'user', text: 'A friendly inline error, with a retry link.', attachments: [] })`);
  run(`_chat.messages.push({ role: 'agent', text: 'The agent asked: ' + ${JSON.stringify(QUESTION)}, attachments: [] })`);
  run(`_chat.wfStep = 'interview'`);
  run(`_chat.messages.push({ role: 'user', text: 'A friendly inline error with a retry.', attachments: [] })`);
  await run("_wfUxRespond('A friendly inline error with a retry.')");
  await sleep(900);

  const step = run('_chat.wfStep');
  const last = run("_chat.messages[_chat.messages.length-1] || {}");
  console.log('  [after question] step=' + step + ' kind=' +
    JSON.stringify(run("_chat.messages.slice(-2)[0].verify && _chat.messages.slice(-2)[0].verify.kind")));

  // Either it is mid-interview (question) or it jumped to post-processing
  // (if the shape check treated the answer as a spec — it should not).
  const verifyCard = run(`(() => {
    for (let i = _chat.messages.length - 1; i >= 0; i--) {
      if (_chat.messages[i].verify) return JSON.stringify(_chat.messages[i].verify);
    }
    return null; })()`);
  console.log('  [verify] ' + String(verifyCard).slice(0, 160));

  // The file must NOT yet contain a spec.
  const afterQ = await (await fetch(API + '/file?path=' + encodeURIComponent(reqPath))).json();
  check('a question never writes a spec into the file',
        !/UX Hand-off Specification/.test(afterQ.content), 'file was modified');
  check('a question leaves status untouched',
        /\*\*Status:\*\* draft/.test(afterQ.content),
        (afterQ.content.match(/\*\*Status:\*\*.*/) || [''])[0]);

  // The loop must be STATEFUL: once an answer has been given, the re-issued
  // prompt carries it, so the agent is not asked to restart the interview.
  const reissued = run("_chat.messages[_chat.messages.length-1].codeBlock || ''");
  check('the re-issued prompt carries an answer log',
        /UX Interview/.test(reissued), reissued.slice(0, 80));
  check('the answer log includes what the PM actually said',
        /friendly inline error/.test(reissued));
  check('the answer log tells the agent not to re-ask',
        /do not re-ask anything already answered/.test(reissued));
  check('the re-issued prompt still carries the original description',
        /Analysts need to export/.test(reissued));

  // Turn 2: the agent finishes the interview and emits the spec.
  run(`_chat.messages.push({ role: 'user', text: 'The finished spec', attachments: [] })`);
  await run(`_wfUxRespond(${JSON.stringify(SPEC)})`);
  await sleep(1200);

  check('a spec advances to post-processing', run('_chat.wfStep') === 'post-processing',
        run('_chat.wfStep'));
  const final = await (await fetch(API + '/file?path=' + encodeURIComponent(reqPath))).json();
  check('the spec was written into the file',
        /UX Hand-off Specification/.test(final.content));
  check('status is ux-ready, not review',
        /\*\*Status:\*\* ux-ready/.test(final.content),
        (final.content.match(/\*\*Status:\*\*.*/) || [''])[0]);
  check('the spec content is preserved', /Must not block the UI thread/.test(final.content));
  check('the Genesis seed is preserved',
        /Analysts need to export their datasets in bulk/.test(final.content));

  // cleanup. The session auto-save also writes a <lens>-chat.md sidecar, and
  // DELETE /file does not remove sidecars (only deleteThought does), so remove
  // it explicitly or the suite leaves residue in the vault on every run.
  for (const suffix of ['.md', '-chat.md', '-pause.md', '-session.json']) {
    const p = 'requirements/2026-09-27-f20probe-bulk-export' + suffix;
    await fetch(API + '/file?path=' + encodeURIComponent(p), { method: 'DELETE' })
      .catch(() => {});
  }
  const leftover = fs.readdirSync(
    path.join(__dirname, '..', 'prism', 'vault', 'requirements'))
    .filter(f => f.includes('f20probe'));
  check('the suite leaves no vault residue', leftover.length === 0, leftover.join(', '));

  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e.message); process.exit(2); });
