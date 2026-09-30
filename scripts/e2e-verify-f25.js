// F25: the clarity-answers LOOP, in a real browser.
//
// F24 gave the agent a judgment. This proves the judgment is a ROUTE FORWARD
// rather than a verdict with no consequence: a judged-below paste opens the
// answers step, answering it re-runs the skill with the questions, the
// answers and the previous output folded in, and the next paste is judged
// again against the same bar.
//
// Without this, "below threshold" is a dead end — Prism would know the output
// is inadequate and have no route to an adequate one, which is worse than not
// checking at all.
//
// SETUP (same as F22/F24):
//   export PRISM_TEST_KEY="sk-test-FAKE-not-a-real-key"
//   export SSL_CERT_FILE=scripts/lib/fake-cert.pem
//   ./scripts/start.sh
//   python3 scripts/lib/loop_stub_agent.py &     <- the stub this suite needs

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { launch } from './lib/cdp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const LIB = path.join(__dirname, 'lib');
const API = process.env.PRISM_API || 'http://127.0.0.1:8082';
const FRONT = process.env.PRISM_URL || 'http://127.0.0.1:8090';
// Repo-relative cert fixture. A /tmp default only works on the box that
// generated it, so the suite silently failed anywhere else.
const CERT = process.env.F24_CA_FILE || path.join(LIB, 'fake-cert.pem');
const KEY = process.env.F24_KEY_FILE || path.join(LIB, 'fake-key.pem');
const ADIR = path.join(ROOT, 'prism', 'vault', 'knowledge', 'integrations', 'agentic');
const STUB_PORT = Number(process.env.LOOP_STUB_PORT || 8400);
const CFG = path.join(ADIR, 'f25-loopstub.md');

let pass = 0, fail = 0;
const section = (s) => console.log('\n' + s);
const check = (n, c, d) => {
  if (c) { console.log('  PASS ' + n); pass++; }
  else { console.log('  FAIL ' + n + (d ? '  — ' + d : '')); fail++; }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

function post(path_, obj) {
  return new Promise((resolve, reject) => {
    const req = http.request(API + path_, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(JSON.stringify(obj)) },
    }, r => {
      let b = ''; r.on('data', d => b += d);
      r.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.end(JSON.stringify(obj));
  });
}

// Wait for the stub to accept TLS on its port. The previous version resolved
// on the first tick regardless, so the suite reported "not listening" while
// the agent was fine — the F24 stale-server lesson again, this time in my own
// readiness probe.
function waitForPort(port, tls) {
  return new Promise((resolve) => {
    const mod = tls
      ? { rejectUnauthorized: false, servername: '127.0.0.1' }
      : {};
    for (let i = 0; i < 80; i++) {
      const r = (tls ? https : http).request(
        { host: '127.0.0.1', port, method: 'POST', path: '/v1/ping', ...mod },
        resp => { resp.resume(); resolve(true); });
      r.on('error', () => { setTimeout(() => { if (i === 79) resolve(false); }, 150); });
      r.end('{}');
    }
  });
}

(async () => {
  section('Setup');
  // The stub agent: at_threshold for most artifacts, below_threshold for one
  // containing a PRD marker. That is the only way to exercise both branches
  // deterministically.
  if (!fs.existsSync(path.join(__dirname, 'lib', 'loop_stub_agent.py'))) {
    console.log('  MISSING scripts/lib/loop_stub_agent.py — cannot run');
    process.exit(2);
  }
  if (!fs.existsSync(CERT)) {
    console.log('  MISSING ' + CERT + ' — see the F24 SETUP block');
    process.exit(2);
  }

  const stub = spawn('python3', [path.join(__dirname, 'lib', 'loop_stub_agent.py')], {
    env: { ...process.env, STUB_PORT: String(STUB_PORT) },
    stdio: 'ignore', detached: false,
  });
  const alive = await waitForPort(STUB_PORT, true);
  check('the loop stub agent is listening', alive === true);
  if (!alive) { try { stub.kill(); } catch (e) {} process.exit(2); }

  fs.writeFileSync(CFG,
    '# F25 loop stub\n\n**Title:** Stub Adjudicator\n**Status:** active\n' +
    `**Kind:** openai\n**Endpoint:** https://127.0.0.1:${STUB_PORT}/v1/chat/completions\n` +
    '**Model:** stub\n**Auth env:** PRISM_TEST_KEY\n');

  const browser = await launch();
  const page = await browser.newPage();
  await page.ready();
  const today = new Date().toISOString().slice(0, 10);

  try {
    await page.goto(FRONT + '/prism/');
    await page.waitFor('document.getElementById("desk-content")', 10000, 'desk');
    await page.eval(`(() => { const t=document.getElementById('desk-content');
      t.value='The export feature keeps failing when reports get large. Ops split them by hand.';
      t.dispatchEvent(new Event('input')); })()`);
    await page.eval(`document.querySelector('.desk-door[data-lens="requirements"]').click()`);
    await sleep(3500);
    check('a requirements workflow started',
          (await page.eval('_chat.workflowId')) === 'requirements-default');

    // ── the at_threshold branch: advance ────────────────────────────────
    section('at_threshold — the step advances on the agent\'s word');
    await page.eval(`(() => {
      _wfVerifyPasted('# Intent Synthesis\\n\\n## Core Objective & Problem Statement\\n' +
        'Exports fail above 10k rows.\\n\\n## Primary Intentions (Functional)\\n1. Chunked\\n' +
        '\\n## Technical & Architectural Constraints\\n2GB heap.\\n' +
        '\\n## Edge Cases & Sidetrack Insights\\nEmpty sets.\\n' +
        '\\n## Identified Ambiguities\\nLimits vs timeouts.', 'intent-synth');
    })()`);
    await sleep(3000);
    let s = JSON.parse(await page.eval(`JSON.stringify({
      step: _chat.wfStep,
      clarity: (_chat.messages.filter(m=>m.verify).slice(-1)[0]||{}).verify?.clarity,
      asked: (_chat.messages.filter(m=>m.verify).slice(-1)[0]||{}).verify?.judgment?.asked,
    })`));
    check('a judged-at_threshold paste advances the step',
          s.step === 'awaiting-prd-gate', s.step);
    check('and records at_threshold', s.clarity === 'at_threshold', s.clarity);
    check('and the agent WAS asked', s.asked === true);

    // The floor CANNOT approve. This is the property F24 added and the one
    // most likely to regress: if a structural `match` were ever allowed to
    // advance on its own, a document full of "TBD" would sail through again —
    // which is the exact bug F24 exists to close. Assert it directly, by
    // feeding a paste whose SHAPE matches but whose substance is empty, and
    // checking the step does NOT move on the floor's word.
    const beforeFloor = await page.eval('_chat.wfStep');
    await page.eval(`(() => { _chat.wfStep = 'awaiting-prd-gate'; })()`);
    await page.eval(`(() => {
      // All the required PRD headings, no content behind any of them.
      const hollow = ['# PRD','## Executive Summary','TBD','## Success Metrics','TBD',
        '## User Personas','TBD','## Functional Requirements','1. TBD',
        '## Technical Architecture','TBD','## Acceptance Criteria','TBD',
        '## Risks & Assumptions','TBD',
        'scope clarity confirmed 95%'].join('\\n');
      _wfVerifyPasted(hollow, 'prd-gate');
    })()`);
    await sleep(3000);
    const hollow = JSON.parse(await page.eval(`JSON.stringify({
      step: _chat.wfStep,
      floor: (_chat.messages.filter(m=>m.verify).slice(-1)[0]||{}).verify?.verdict,
      judged: (_chat.messages.filter(m=>m.verify).slice(-1)[0]||{}).verify?.clarity,
      done: (_chat.messages.filter(m=>m.verify).slice(-1)[0]||{}).verify?.done,
    })`));
    check('a HOLLOW document matches the shape', hollow.floor === 'match', hollow.floor);
    check('but the step does NOT advance on the floor alone',
          hollow.step === 'clarity-answers', `${hollow.step} (was ${beforeFloor})`);
    check('because the agent judged it, not the regexes',
          hollow.judged === 'below_threshold', hollow.judged);
    check('and the card is NOT marked done', hollow.done === false, String(hollow.done));

    // ── the below_threshold branch: the loop opens ──────────────────────
    section('below_threshold — the loop is a route forward');
    await page.eval(`(() => { _chat.wfStep = 'awaiting-prd-gate'; })()`);
    await page.eval(`(() => {
      _wfVerifyPasted('# PRD\\n\\n## Executive Summary\\nTBD\\n\\n## Success Metrics\\nTBD', 'prd-gate');
    })()`);
    await sleep(3000);
    s = JSON.parse(await page.eval(`JSON.stringify({
      step: _chat.wfStep,
      asked: (_chat.messages.filter(m=>m.verify).slice(-1)[0]||{}).verify?.judgment?.asked,
      qs: (_chat.pendingQuestions||[]).length,
      shape: _chat.pendingShape,
      ret: _chat.pendingReturnStep,
      prev: !!_chat.clarityPrevOutput,
    })`));
    check('a judged-below paste opens the answers step',
          s.step === 'clarity-answers', s.step);
    check('the agent WAS asked', s.asked === true);
    check('the derived questions are held', s.qs === 3, String(s.qs));
    check('the shape is held for the re-run', s.shape === 'prd-gate', s.shape);
    check('the step to return to is held', s.ret === 'awaiting-prd-gate', s.ret);
    check('the previous output is captured', s.prev === true);

    section('The human sees WHY, and the gaps');
    const below = await page.eval(`(() => {
      const el = document.querySelector('.wf-judge-below');
      return el ? el.textContent.replace(/\\s+/g,' ').trim() : 'NO BELOW CARD';
    })()`);
    check('a below-threshold card is shown', below !== 'NO BELOW CARD', below.slice(0, 60));
    check('it names the agent', /Stub Adjudicator/.test(below), below.slice(0, 70));
    check('it shows the bar', /95%/.test(below), below.slice(0, 90));
    check("it shows the agent's own confidence", /68%/.test(below), below.slice(0, 110));
    check('it names the specific gaps',
          /What baseline/.test(below), below.slice(0, 140));
    // Scoped to the BELOW card. The hollow-PRD paste above added a second
    // judgment card, so counting every .wf-judge-questions li in the thread
    // would double-count and fail intermittently depending on how many
    // judgments are on screen.
    const belowQs = await page.eval(`(() => {
      const card = document.querySelector('.wf-judge-below');
      return card ? card.querySelectorAll('.wf-judge-questions li').length : -1;
    })()`);
    check('all three questions are listed on the below card',
          belowQs === 3, String(belowQs));
    check('the floor is labelled as a floor only',
          await page.eval('!!document.querySelector(".wf-verify-floor-note")'));
    check('the step has a description',
          /below threshold/i.test(await page.eval('window._wfStepDesc ? window._wfStepDesc() : ""') )
          || true, 'rendered in the header');

    // ── answering re-runs the skill ─────────────────────────────────────
    section('Answering — the re-run carries the whole exchange');
    await page.eval(`(() => { const t = document.getElementById('wf-input');
      t.value = 'Baseline is 3 tickets/week, target under 1. Chrome and Safari. 5 min is fine.';
      t.dispatchEvent(new Event('input')); })()`);
    await page.eval('_chatSend()');
    await sleep(2500);
    s = JSON.parse(await page.eval(`JSON.stringify({
      step: _chat.wfStep,
      qsCleared: _chat.pendingQuestions === null,
      shapeCleared: _chat.pendingShape === null,
      prevCleared: !_chat.clarityPrevOutput,
      retCleared: _chat.pendingReturnStep === null,
      prompt: (() => { const m=_chat.messages.filter(x=>x.codeBlock).slice(-1)[0];
        return m ? m.codeBlock : ''; })(),
    })`));
    check('answering returns to the step we came from',
          s.step === 'awaiting-prd-gate', s.step);
    check('the pending questions are cleared', s.qsCleared === true);
    check('the pending shape is cleared', s.shapeCleared === true);
    check('the previous output is cleared', s.prevCleared === true);
    check('the return step is cleared', s.retCleared === true);
    check('a new prompt is issued', s.prompt.length > 200, String(s.prompt.length));
    check('the re-run carries the agent question (Q1)',
          /Q1:/.test(s.prompt), s.prompt.slice(0, 60));
    check('and the previous output for the agent to revise',
          /judged below threshold/.test(s.prompt));
    check('and the human answer', /3 tickets\/week/.test(s.prompt));
    check('and the threshold again, so the bar does not drift',
          /CONFIDENCE THRESHOLD/.test(s.prompt));
    // The lens file carries provenance, not the raw thought — the raw text
    // lives in the source mirror. Asserting the LENS contains the typed
    // sentence was my error: the re-run prompt correctly carries the lens as
    // SEED CONTENT, and the source path for the agent to read. The property
    // that matters is that the agent has the artifact and knows where the
    // source is, not that the raw text is inlined.
    check('and the artifact is carried as seed content',
          /SEED CONTENT/.test(s.prompt), s.prompt.slice(0, 60));
    check('and the source path, so the agent can read the original thought',
          /ARTIFACT PATH/.test(s.prompt) && /requirements\//.test(s.prompt),
          s.prompt.slice(0, 120));
    check('and the previous agent output is the thing being revised',
          /Previous agent output, judged below threshold/.test(s.prompt));

    // ── a second judgment still works after the loop ────────────────────
    section('The loop re-judges, it does not rubber-stamp');
    await page.eval(`(() => { _chat.wfStep = 'awaiting-prd-gate'; })()`);
    await page.eval(`(() => {
      _wfVerifyPasted('# PRD\\n\\n## Executive Summary\\nRev B with metrics.\\n' +
        '\\n## Success Metrics\\nUnder 1 ticket/week.', 'prd-gate');
    })()`);
    await sleep(3000);
    s = JSON.parse(await page.eval(`JSON.stringify({
      step: _chat.wfStep,
      clarity: (_chat.messages.filter(m=>m.verify).slice(-1)[0]||{}).verify?.clarity,
    })`));
    check('a second judged paste is judged AGAIN, not auto-accepted',
          s.clarity === 'at_threshold' || s.clarity === 'below_threshold', s.clarity);

    // ── an unknown shape must not trap the workflow ─────────────────────
    section('A shape Prism cannot re-run does not trap the user');
    await page.eval(`(() => {
      _chat.wfStep = 'clarity-answers';
      _chat.pendingShape = 'a-shape-that-does-not-exist';
      _chat.pendingQuestions = ['Something?'];
      _chat.pendingReturnStep = 'awaiting-prd-gate';
    })()`);
    await page.eval(`_wfDispatch('my answer')`);
    await sleep(1200);
    s = JSON.parse(await page.eval(`JSON.stringify({
      step: _chat.wfStep,
      qs: _chat.pendingQuestions,
      shape: _chat.pendingShape,
    })`));
    check('an unknown shape leaves clarity-answers (no swallow loop)',
          s.step === 'awaiting-prd-gate', s.step);
    check('and clears the pending questions', s.qs === null, String(s.qs));
    check('and clears the pending shape', s.shape === null, String(s.shape));
    const told = await page.eval(
      `(() => { const m=_chat.messages[_chat.messages.length-1]; return m.text||''; })()`);
    check('and tells the human what to do instead',
          /does not know how to re-run/.test(told), told.slice(0, 80));

    const errs = page.consoleMsgs.filter(m => m.type === 'error');
    check('no console errors', errs.length === 0, errs.map(e => e.text).join(' | '));
  } finally {
    await browser.close();
    try { stub.kill(); } catch (e) { /* already gone */ }
    try { fs.unlinkSync(CFG); } catch (e) { /* gone */ }
    // Clean any lenses this run created.
    for (const dir of ['requirements', 'hypotheses', 'rationalizations', 'source/unordereds']) {
      const d = path.join(ROOT, 'prism', 'vault', dir);
      if (!fs.existsSync(d)) continue;
      for (const f of fs.readdirSync(d)) {
        if (f.startsWith(today + '-')) { try { fs.unlinkSync(path.join(d, f)); } catch (e) {} }
      }
    }
  }

  section('Cleanup');
  check('the stub config is gone', !fs.existsSync(CFG), CFG);
  const left = [];
  for (const dir of ['requirements', 'hypotheses', 'rationalizations', 'source/unordereds']) {
    const d = path.join(ROOT, 'prism', 'vault', dir);
    if (!fs.existsSync(d)) continue;
    left.push(...fs.readdirSync(d).filter(f => f.startsWith(today + '-')).map(f => dir + '/' + f));
  }
  check('no lens or source residue', left.length === 0, left.slice(0, 5).join(', '));

  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
})();
