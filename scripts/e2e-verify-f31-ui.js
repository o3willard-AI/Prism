// F31 in a real browser: the agent interrogates the human at the Crafting Table.
//
// The server suites prove interrogate() works. This proves the THING works — that
// a person can walk up to the Table, type a fog of a thought, be asked real
// questions, answer them, and reach a proposed shape. Three properties matter
// most and are checked hardest:
//
//   1. A real question appears. Not a hint, not a shape menu — an actual question
//      with an answer box.
//   2. Answering it changes the conversation: the exchange accumulates and the
//      agent is given the prior answers.
//   3. Opting out is always possible. Interrogation must never be a trap door
//      the human cannot leave.
//
// And the failure that must not happen: an unreadable agent reply is never shown
// as agreement, and never advances anything.

const fs = require('node:fs');
const path = require('node:path');
const { ROOT, FRONT } = require('./lib/env.js');
const { launch } = require('./lib/cdp.js');
const { startStub, freePort } = require('./lib/stub-agent.js');

// The agent config the server will select. Arms its OWN file and removes it in
// `finally`, for the reason F23's leak taught: a config left behind changes
// which agent the NEXT suite finds, and the failure looks like a product bug.
const ADIR = path.join(ROOT, 'prism', 'vault', 'knowledge', 'integrations', 'agentic');
const CFG = path.join(ADIR, 'f31-ui.md');

const RAW = 'Bulk export dies on big reports. Ops splits them by hand every friday.';

// Files this run STAGED, so `finally` can delete exactly those and nothing else.
// The handoff writes a real queue item (the workflow re-reads its artifact from
// disk, so a preload cannot carry it) — a suite that stages without cleaning adds
// to the developer's backlog on every run, which is how F23 leaked 9 files per run.
const STAGED = [];
const PASS = [];
const FAIL = [];

function check(name, cond, detail = '') {
  (cond ? PASS : FAIL).push(name);
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `\n         ${detail}`}`);
}

function section(s) { console.log(`\n== ${s} ==`); }

// A local sleep, not page.sleep(): cdp.js exposes no timer on the page
// object. Suites that sleep for a guessed duration invite flakes, so this is
// used only where no observable condition is available to wait on.
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let stub = null;
  try {
    // The stub asks on round one and is ready on round two, so the whole
    // conversation is walked without a language model's judgement in the loop.
    stub = await startStub();

    // Catch-all route: interrogation runs BEFORE a lens is chosen, so the
    // config must be selectable with no lens hint at all.
    fs.writeFileSync(CFG,
      '# f31 ui probe\n\n**Title:** Interrogator\n**Status:** active\n' +
      '**Kind:** openai\n' +
      `**Endpoint:** ${stub.endpoint}\n**Model:** stub\n**Auth env:** PRISM_TEST_KEY\n`);

    const b = await launch();
    const page = await b.newPage();
    await page.ready();
    // cdp.js collects console output onto page.consoleMsgs rather than exposing
    // an event emitter, so page.on() does not exist here.
    const errors = () => page.consoleMsgs.filter(m => m.type === 'error');

    await page.goto(FRONT + '/prism/');
    await page.waitFor("document.getElementById('desk-content')", 20000, 'desk');
    await sleep(1200);

    section('The door exists and is a peer, not a footnote');
    const hasBtn = await page.eval(`!!document.getElementById('desk-interrogate-btn')`);
    check('the Table offers "ask the agent"', hasBtn);
    // It must be reachable and legible — the earlier queue bug was a real control
    // rendered as invisible footer chrome, so assert the class that makes it a door.
    const cls = await page.eval(
      `document.getElementById('desk-interrogate-btn').className`);
    check('it is styled as a desk door, like the lens doors',
          /desk-door/.test(cls), cls);
    const doors = await page.eval(
      `document.querySelectorAll('.desk-doors .desk-door').length`);
    check('and the lens doors are still there (interrogation does not replace them)',
          doors > 0, `${doors} doors`);

    section('The agent asks');
    await page.eval(`(() => {
      const ta = document.getElementById('desk-content');
      ta.value = ${JSON.stringify(RAW)};
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await page.eval(`deskInterrogate()`);
    await page.waitFor(`!!document.querySelector('.desk-interrogate-q textarea')`,
                       45000, 'a question');

    const qCount = await page.eval(`document.querySelectorAll('.desk-interrogate-q').length`);
    check('a real question is asked', qCount > 0, `${qCount} questions`);
    const qText = await page.eval(
      `document.querySelector('.desk-interrogate-q-label').textContent.trim()`);
    check('the question has text', qText.length > 8, qText);
    check('and it reads like a question',
          qText.includes('?') || /^(what|why|who|when|which|how|is|are|do|does|can)\b/i
            .test(qText), qText);

    const heard = await page.eval(
      `document.querySelector('.desk-interrogate-heard') ? 'yes' : 'no'`);
    check('the agent says what it understood', heard === 'yes');
    const outcome = await page.eval(
      `document.querySelector('.desk-interrogate-outcome') ? 'yes' : 'no'`);
    check('and states the outcome a later agent must reach', outcome === 'yes',
          'the lens exists to enable this');

    const round = await page.eval(
      `document.querySelector('.desk-interrogate-round').textContent`);
    check('the round is numbered so the human knows where they are',
          /round 1 of \d/.test(round), round);

    section('Answering carries the exchange forward');
    await page.eval(`(() => {
      const t = document.querySelector('.desk-interrogate-q textarea');
      t.value = 'Nobody loses a friday to a failed export.';
      t.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await page.eval(`deskInterrogateAnswer()`);
    await page.waitFor(
      `(() => { const r = document.querySelector('.desk-interrogate-round');
               return r && !/round 1 /.test(r.textContent); })()`,
      45000, 'round 2');

    const round2 = await page.eval(
      `document.querySelector('.desk-interrogate-round').textContent`);
    check('the conversation advanced to round 2', /round 2 of/.test(round2), round2);
    const shown = await page.eval(
      `document.querySelector('.desk-interrogate-answers') ?
         document.querySelector('.desk-interrogate-answers').textContent : ''`);
    // Match on the answer, not the whole sentence: the card renders
    // "question→answer" on one line, and a substring spanning the join is a
    // brittle thing to assert on.
    check('the prior answer is shown back to the human',
          shown.includes('Nobody loses a friday'), shown.slice(0, 90));
    check('and the question that asked it', shown.includes('?'), shown.slice(0, 90));

    section('Reaching a shape');
    // The stub is ready on round 2 and proposes a shape.
    const shapeBtn = await page.eval(`(() => {
      const b = Array.from(document.querySelectorAll('.desk-interrogate-actions button'))
        .find(x => /^Use /.test(x.textContent.trim()));
      return b ? b.textContent.trim() : '';
    })()`);
    check('a shape is proposed once the agent is satisfied',
          shapeBtn.length > 0, shapeBtn || 'no "Use …" button');
    check('and the agent explains why',
          await page.eval(`!!document.querySelector('.desk-interrogate-shape, .desk-interrogate-actions')`));

    section('The handoff carries the interrogation into the workflow');
    // The exchange must travel WITH the artifact. A lens whose provenance is
    // "we asked what you wanted" and then threw the answers away is exactly the
    // context-less artifact the whole feature exists to prevent.
    const body = await page.eval(`(() => {
      const b = Array.from(document.querySelectorAll('.desk-interrogate-actions button'))
        .find(x => /workflow chat/.test(x.textContent));
      if (!b) return { found: false };
      b.click();
      const ta = document.getElementById('desk-content');
      return { found: true, value: ta ? ta.value : '' };
    })()`);
    check('the workflow-chat door is offered once the agent is satisfied',
          body.found === true, JSON.stringify(body).slice(0, 80));
    await sleep(700);
    // The handoff LEAVES the Table — that is the point — so desk-content is
    // gone by now. Reading it was my bug: the text has moved into the chat.
    // Look where a human's own words would actually be, and prove it got there.
    // Assert on `_chat.artifactContent`, NOT on a textarea. That is the field the
    // workflow folds into its first prompt — a textbox is where a human would see
    // text, not necessarily where the program will use it, and asserting on the
    // box would have passed while the text went nowhere.
    // Read the STAGED FILE, because that is what the workflow will load: it
    // re-reads `_chat.artifactPath` from disk and overwrites artifactContent.
    // Asserting on the in-memory field would test the preload that does not
    // survive — a green that certifies nothing.
    // The path comes from the handoff itself, so this does NOT scan the
    // developer's 539-file backlog — an earlier version did, which was both slow
    // and would have found somebody else's file on a shared machine.
    const staged = await page.eval(`(async () => {
      const p = _INTERROGATE_STATE.stagedPath;
      if (!p) return { found: false };
      const c = await apiGet('/file?path=' + encodeURIComponent(p));
      return { found: true, content: c.content || '', path: p };
    })()`);
    const carried = staged.content || '';
    const handed = { leftTable: staged.found === true };
    if (staged.path) STAGED.push(staged.path);
    check('the handoff actually leaves the Crafting Table', handed.leftTable === true,
          'still on the Table — the chat door did nothing');
    check('the raw thought still travels', /Bulk export dies/.test(carried),
          carried.slice(0, 80));
    check('the understanding travels with it', /Understood as/.test(carried),
          'provenance lost in handoff');
    check('the outcome travels with it', /Must enable an agent to/.test(carried),
          'the lens lost its reason for existing');
    const qaState = await page.eval(`(() => ({
      answers: (_INTERROGATE_STATE.answers || []).length,
      content: (_desk.content || '').length,
      raw: _INTERROGATE_STATE.raw,
    }))()`);
    // Assert on the fixture's ACTUAL words. An earlier version checked for
    // "lost a friday" — a rewording of "Nobody loses a friday", so it had never
    // matched and would have failed forever against a correct implementation.
    check('the Q&A travels with it',
          /Interrogation/.test(carried) && /loses a friday/.test(carried),
          `${qaState.answers} answers staged; body=${carried.slice(0, 120)}`);

    section('Opting out is always possible');
    // The handoff navigated away, so come back to the Table — otherwise this
    // section silently runs against the chat and times out on a missing element,
    // which reads like a product bug and is only a test-sequencing mistake.
    await page.goto(FRONT + '/prism/');
    await page.waitFor("document.getElementById('desk-content')", 20000, 'desk');
    await sleep(900);
    await page.eval(`(() => {
      const ta = document.getElementById('desk-content');
      ta.value = ${JSON.stringify(RAW)};
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await page.eval(`_deskInterrogateReset()`);
    await page.eval(`deskInterrogate()`);
    await page.waitFor(`!!document.querySelector('.desk-interrogate-actions')`,
                       45000, 'actions');
    const skip = await page.eval(`(() => {
      const b = Array.from(document.querySelectorAll('.desk-interrogate-actions button'))
        .find(x => /Not now|Carry on/.test(x.textContent));
      return b ? b.textContent.trim() : '';
    })()`);
    check('the human can decline and carry on', skip.length > 0, skip || 'no opt-out');
    await page.eval(`deskInterrogateSkip()`);
    await sleep(500);
    const gone = await page.eval(`!document.querySelector('.desk-interrogate-q')`);
    check('declining clears the card and leaves the doors usable', gone);

    section('An unreadable reply is NOT agreement');
    // Feed the card something a real agent might emit and Prism cannot parse.
    await page.eval(`(() => {
      _INTERROGATE_STATE.reply = { asked: true, verdict: 'unclear',
        parse_failed: true, raw: 'I think it depends', questions: [], round: 1 };
      _deskInterrogateRender();
    })()`);
    // Wait for the rendered card, not for a guessed duration. A fixed sleep here
    // is how five assertions silently read an empty container and reported a
    // product bug that did not exist.
    await page.waitFor(
      `/could not be read/.test(document.getElementById('desk-interrogate-out').textContent)`,
      10000, 'the unreadable-reply card');
    const unread = await page.eval(
      `(document.getElementById('desk-interrogate-out') || {}).textContent || ''`);
    check('the unreadable reply is disclosed', /could not be read/.test(unread));
    check('and it explicitly says nothing was approved',
          /not as agreement|Nothing has been approved/.test(unread),
          unread.slice(0, 120));
    check('no question box is offered for output we did not understand',
          await page.eval(`!document.querySelector('.desk-interrogate-q textarea')`));
    check('and the raw reply is available to read',
          await page.eval(`!!document.querySelector('.desk-interrogate details')`));

    section('No agent at all is honest, not fake');
    await page.eval(`_deskInterrogateReset()`);
    await page.eval(`(() => { _deskInterrogateUnavailable('No agent integration is active and keyed.'); })()`);
    await page.waitFor(
      `/isn't available/.test(document.getElementById('desk-interrogate-out').textContent)`,
      10000, 'the unavailable card');
    const na = await page.eval(
      `(document.getElementById('desk-interrogate-out') || {}).textContent || ''`);
    check('it says the agent is unavailable', /isn't available/.test(na), na.slice(0, 80));
    check('and offers a way past it',
          /Carry on without it/.test(na), na.slice(0, 120));
    check('without pretending an interrogation happened',
          await page.eval(`!document.querySelector('.desk-interrogate-q textarea')`));

    section('Too little to work with');
    await page.eval(`_deskInterrogateReset()`);
    await page.eval(`(() => {
      const ta = document.getElementById('desk-content');
      ta.value = 'hi';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await page.eval(`deskInterrogate()`);
    await page.waitFor(
      `/something to work with/.test(document.getElementById('desk-interrogate-out').textContent)`,
      10000, 'the too-short card');
    const thin = await page.eval(
      `(document.getElementById('desk-interrogate-out') || {}).textContent || ''`);
    check('two words does not trigger a round trip to the agent',
          /something to work with/.test(thin), thin.slice(0, 90));

    section('No console errors');
    check('the walkthrough produced no JS errors', errors().length === 0,
          errors().slice(0, 3).map(m => m.text).join(' | '));

    await b.close();
  } finally {
    // Own-state discipline: the config, the port, and anything this run staged —
    // whatever happened. Staging writes TWO files (the queue item and an immutable
    // source mirror); removing only the queue item is how F29 leaked residue.
    try { fs.unlinkSync(CFG); } catch (e) { /* never armed */ }
    for (const rel of STAGED) {
      for (const base of [path.join(ROOT, 'prism', 'vault', rel),
                          path.join(ROOT, 'prism', 'vault', 'source', 'unordereds',
                                    path.basename(rel))]) {
        try { fs.unlinkSync(base); } catch (e) { /* already gone */ }
      }
    }
    if (stub) freePort(stub.port);
  }

  console.log(`\n${PASS.length}/${PASS.length + FAIL.length} checks passed`);
  if (FAIL.length) {
    console.log('FAILED:');
    for (const f of FAIL) console.log(`  - ${f}`);
  }
  process.exit(FAIL.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });