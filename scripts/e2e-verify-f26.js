// The whole point of F23+F24+F25, driven the way a person would use it.
//
//   type a thought -> take a lens -> the agent judges the output below
//   threshold -> Prism shows the gaps -> answer them -> the skill re-runs ->
//   the agent judges the revision -> the artifact is written.
//
// Every step goes through the UI a human would click. No internal function is
// called directly.
//
// Two bugs this found, both recorded in the audit:
//   1. _wfApplyAccepted wrote the THRESHOLD but not the JUDGMENT into the
//      artifact, so a past artifact recorded the bar but not who cleared it.
//   2. The walkthrough itself was wrong twice: it read slice(-1) for the
//      verdict card (which is a different shape's card once the workflow has
//      issued more than one) and it assumed the first paste is a PRD when the
//      first step is intent-synth. Both are the classic "assert on whatever is
//      on screen" mistake.
const { launch } = require('/home/sblanken/workspace/Prism/scripts/lib/cdp.js');
const fs = require('node:fs');
const path = require('node:path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ROOT = '/home/sblanken/workspace/Prism';
const FRONT = 'http://127.0.0.1:8090';
const ADIR = path.join(ROOT, 'prism', 'vault', 'knowledge', 'integrations', 'agentic');
// This suite is the ONLY thing that should ever arm an agent config in the
// vault. It installs walkstub.md in setup and removes it in teardown — an
// active config left behind breaks F15 ("integrations/ holds no ACTIVE
// service") and F24 ("with no integration, nothing is judged"), which is
// exactly what happened when an earlier run forgot to clean up.
const STUB = path.join(ADIR, 'walkstub.md');
const STUB_BODY = [
  '# walk stub', '',
  '**Title:** Stub Adjudicator',
  '**Status:** active',
  '**Kind:** openai',
  '**Endpoint:** https://127.0.0.1:8400/v1/chat/completions',
  '**Model:** stub',
  '**Auth env:** PRISM_TEST_KEY',
  '',
].join('\n');

let pass = 0, fail = 0;
const check = (n, c, d) => {
  if (c) { console.log('  PASS ' + n); pass++; }
  else { console.log('  FAIL ' + n + (d ? '  — ' + d : '')); fail++; }
};

// Send text the way a human does: into the box, then Send.
async function say(page, text, wait = 4000) {
  await page.eval(`(() => { const t = document.getElementById('wf-input');
    t.value = ${JSON.stringify(text)};
    t.dispatchEvent(new Event('input')); _chatSend(); })()`);
  await sleep(wait);
}

// The card for a SPECIFIC shape, never slice(-1) of everything.
const cardFor = (shape) => `(() => {
  const m = _chat.messages.filter(x => x.verify && x.verify.shape === ${JSON.stringify(shape)}).slice(-1)[0];
  if (!m) return null;
  return JSON.stringify({ verdict: m.verify.verdict, hits: m.verify.hits,
    total: m.verify.total, clarity: m.verify.clarity, missing: m.verify.missing || [],
    kind: m.verify.kind || null, advice: (m.verify.advice || '').slice(0, 120) });
})()`;

const INTENT = [
  '# Intent Synthesis: bulk export',
  '',
  '## Core Objective & Problem Statement',
  'Exports fail above 10k rows, so ops split reports by hand.',
  '',
  '## Primary Intentions (Functional)',
  '1. Export completes without manual splitting',
  '2. Ops sees progress while it runs',
  '',
  '## Technical & Architectural Constraints',
  'Single worker, 2GB heap, no new dependencies.',
  '',
  '## Edge Cases & Sidetrack Insights',
  'Empty result sets; reports over 100MB.',
  '',
  '## Identified Ambiguities',
  'Whether row limits or timeouts trigger first.',
].join('\n');

const HOLLOW_PRD = [
  '# PRD: Bulk export', '## Executive Summary', 'TBD',
  '## Success Metrics', 'TBD', '## User Personas', 'TBD',
  '## Functional Requirements', '1. TBD', '## Technical Architecture', 'TBD',
  '## Acceptance Criteria', 'TBD', '## Risks & Assumptions', 'TBD',
  'scope clarity confirmed 95%',
].join('\n');

const GOOD_PRD = [
  '# PRD: Bulk export', '',
  '## Executive Summary',
  'Exports fail above 10k rows; ops split them by hand at 40 minutes each.', '',
  '## Success Metrics',
  'Export tickets fall from three a week to under one.', '',
  '## User Personas',
  'Ops lead running weekly reporting.', '',
  '## Functional Requirements',
  '1. (Must) Chunked export   2. (Should) Progress indicator', '',
  '## Technical Architecture',
  'Stream rows to disk; the 2GB heap is sufficient.', '',
  '## Acceptance Criteria',
  'Given a 100k-row report, when export runs, then it completes in under 5 minutes.', '',
  '## Risks & Assumptions',
  'Assumes no new dependencies; risk of regression on small reports.', '',
].join('\n');

(async () => {
  // Free the stub port FIRST. A leftover stub from a previous run answers with
  // stale logic and the walkthrough then fails for reasons that have nothing
  // to do with Prism.
  const { execSync, spawn } = require('node:child_process');
  execSync('bash scripts/lib/free-port.sh 8400', { cwd: ROOT, stdio: 'inherit' });
  fs.writeFileSync(STUB, STUB_BODY);
  // Detached and unref'd: the stub outlives this process, and teardown kills it
  // BY PORT rather than by handle, which is the only way that actually works
  // when a previous run is what bound the port.
  const stubProc = spawn('python3', ['scripts/lib/loop_stub_agent.py'],
                         { cwd: ROOT, detached: true, stdio: 'ignore' });
  stubProc.unref();
  await sleep(1500);   // let it bind before the workflow asks it anything

  const b = await launch();
  const page = await b.newPage();
  await page.ready();
  const today = new Date().toISOString().slice(0, 10);
  try {
    await page.goto(FRONT + '/prism/');
    await page.waitFor('document.getElementById("desk-content")', 10000, 'desk');

    // ── 1. a human types a thought, and sees the bar before committing ──
    await page.eval(`(() => { const t=document.getElementById('desk-content');
      t.value = 'The bulk export feature keeps failing once a report gets large. '
        + 'Ops are splitting reports by hand, which takes about forty minutes each time.';
      t.dispatchEvent(new Event('input')); })()`);
    check('the desk accepted the thought', (await page.eval('_desk.content.length')) > 80);

    const bar = await page.eval(`(() => {
      const d=[...document.querySelectorAll('details')].find(x=>/Clarity bar/.test(x.textContent));
      return d ? d.textContent.replace(/\\s+/g,' ') : 'NO BAR'; })()`);
    check('the clarity bar is shown before choosing a lens', bar !== 'NO BAR');
    check('and shows the requirements bar at 95%', /requirements 95%/.test(bar), bar.slice(0,90));

    await page.eval(`document.querySelector('.desk-door[data-lens="requirements"]').click()`);
    await sleep(3500);
    check('the workflow opened', (await page.eval('_chat.workflowId')) === 'requirements-default');

    const p1 = await page.eval(`(() => { const m=_chat.messages.filter(x=>x.codeBlock).slice(-1)[0];
      return m ? m.codeBlock : ''; })()`);
    check('the first prompt carries the threshold', /CONFIDENCE THRESHOLD: 95%/.test(p1));
    check('and the human\'s reason for it', /expensive to discover late/.test(p1));

    // ── 2. step one passes, and the workflow moves to the PRD gate ───────
    await say(page, INTENT, 4500);
    let c = JSON.parse(await page.eval(cardFor('intent-synth')));
    check('the intent output is judged at threshold',
          c && c.clarity === 'at_threshold', JSON.stringify(c));
    check('and the workflow advanced to the PRD gate',
          (await page.eval('_chat.wfStep')) === 'awaiting-prd-gate',
          await page.eval('_chat.wfStep'));

    // ── 3. a HOLLOW PRD: matches the shape, must not sail through ───────
    await say(page, HOLLOW_PRD, 4500);
    c = JSON.parse(await page.eval(cardFor('prd-gate')));
    check('a hollow PRD MATCHES the structural shape', c && c.verdict === 'match',
          JSON.stringify(c));
    check('but the agent judged it BELOW threshold',
          c && c.clarity === 'below_threshold', JSON.stringify(c));
    check('so the loop opened', (await page.eval('_chat.wfStep')) === 'clarity-answers',
          await page.eval('_chat.wfStep'));
    check('with derived questions waiting',
          (await page.eval('(_chat.pendingQuestions||[]).length')) === 3,
          String(await page.eval('(_chat.pendingQuestions||[]).length')));

    const card = await page.eval(`(() => {
      const el=document.querySelector('.wf-judge-below');
      return el ? el.textContent.replace(/\\s+/g,' ').trim() : 'NONE'; })()`);
    check('the human is shown why', /Below threshold/.test(card), card.slice(0,70));
    check('and which agent decided', /Stub Adjudicator/.test(card), card.slice(0,90));
    check('and the gaps are on screen',
          (await page.eval(`document.querySelectorAll('.wf-judge-questions li').length`)) === 3);

    // ── 4. the human answers ────────────────────────────────────────────
    await say(page,
      'Baseline is three export tickets a week and I want it under one. '
      + 'Chrome and Safari only. Five minutes is an acceptable budget.', 3000);
    const p2 = await page.eval(`(() => { const m=_chat.messages.filter(x=>x.codeBlock).slice(-1)[0];
      return m ? m.codeBlock : ''; })()`);
    check('the skill re-ran with the answers', p2.length > 200, String(p2.length));
    check('the answers are in the prompt', /three export tickets a week/.test(p2));
    check('the agent sees its own question again', /Q1:/.test(p2));
    check('and its previous output to revise', /judged below threshold/.test(p2));
    check('and the bar has not drifted', /CONFIDENCE THRESHOLD: 95%/.test(p2));
    check('and we are back at the PRD gate',
          (await page.eval('_chat.wfStep')) === 'awaiting-prd-gate',
          await page.eval('_chat.wfStep'));

    // ── 5. the revised output is judged again and written ──────────────
    await say(page, GOOD_PRD, 5000);
    c = JSON.parse(await page.eval(cardFor('prd-gate')));
    check('the revision is judged AGAIN, on the same bar',
          c && c.clarity === 'at_threshold', JSON.stringify(c));
    check('and the workflow advanced', (await page.eval('_chat.wfStep')) === 'post-processing',
          await page.eval('_chat.wfStep'));

    // ── 6. the artifact records the bar AND the judgment ────────────────
    const file = await page.eval(`(async () => {
      const r = await fetch('/prism/api/file?path=' + encodeURIComponent(_chat.artifactPath));
      const j = await r.json(); return j.content || ''; })()`);
    check('the artifact was written', file.length > 800, String(file.length));
    check('it records the confidence threshold',
          /Confidence threshold:\*\* 95%/.test(file), '');
    check('it records the CLARITY JUDGMENT (the bug this found)',
          /Clarity:\*\* at threshold/.test(file),
          file.slice(0, 260).replace(/\n/g, ' '));
    check('it records who judged', /Judged by:\*\* Stub Adjudicator/.test(file), '');
    check("it records the agent's own confidence",
          /agent confidence 9\d%/.test(file), '');
    // Assert on phrases that are actually in GOOD_PRD, not paraphrases of it.
    // "under 1" is not in the document — "Under one ticket a week" is. An
    // assertion written from memory of the fixture is an assertion that lies.
    check('and the artifact text is intact',
          /Stream rows to disk/.test(file)
          && /Export tickets fall from three a week to under one/.test(file)
          && /under 5 minutes/.test(file)
          && /Chunked export/.test(file),
          (file.match(/^# PRD.*$/m) || ['<no PRD heading>'])[0]);
    check('and the Genesis seed is preserved', /forty minutes|40 minutes/.test(file), '');
    check('the section label says judged, not just verified',
          /judged by the agent/.test(file), '');

    // The artifact must carry the SERVER's own record, not a client-side
    // reconstruction of it. A local fallback formatter can mask a broken
    // `record` in the /adjudicate response — the teeth check proved exactly
    // that (stripping record on the server still passed 32/32). So assert the
    // server's string separately: one formatter, not two, and drift is
    // visible rather than silently papered over.
    const srvRecord = await page.eval(`(() => {
      const m = _chat.messages.filter(x => x.verify && x.verify.shape === 'prd-gate').slice(-1)[0];
      return m && m.verify.judgment ? (m.verify.judgment.record || '') : ''; })()`);
    check('the server returned a judgment record', srvRecord.length > 40, srvRecord);
    check('it names the agent', /Stub Adjudicator/.test(srvRecord), srvRecord.slice(0, 90));
    check('and the artifact uses THAT record verbatim',
          file.includes(srvRecord.trim()),
          'the artifact formatted its own copy instead of the server record');

    const errs = page.consoleMsgs.filter(m => m.type === 'error');
    check('no console errors across the whole session',
          errs.length === 0, errs.map(e => e.text).join(' | '));
  } finally {
    await b.close();
    // The armed config MUST go, or F15 and F24 fail on the next run. Leaving
    // test scaffolding in the vault is the residue this repo does not accept.
    try { fs.unlinkSync(STUB); } catch (e) { /* already gone */ }
    try { execSync('bash scripts/lib/free-port.sh 8400', { cwd: ROOT, stdio: 'ignore' }); }
    catch (e) { /* port already free */ }
    for (const d of ['requirements', 'hypotheses', 'rationalizations', 'source/unordereds']) {
      const dir = path.join(ROOT, 'prism', 'vault', d);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (f.startsWith(today + '-')) { try { fs.unlinkSync(path.join(dir, f)); } catch (e) {} }
      }
    }
  }
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
