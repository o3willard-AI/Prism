// F28 (browser half): the routing note must actually RENDER.
//
// The API suites prove the `selection` field exists and the server formats the
// record correctly. Neither proves a person can read it — CSS can hide a
// correctly-populated element, and a class in the DOM is not a message on a
// screen. This drives the real app with an UNCLAIMED lens, which is the case
// that produces the note, and checks both the text and the computed style.
//
// Requires the loop stub agent: start it with `python3 scripts/lib/loop_stub_agent.py`.
// Does the routing note actually RENDER? The API tests prove the field exists;
// only a browser proves the human sees it. It also reads the computed style,
// because "the class is in the DOM" and "a person can read it, and it stays
// visually quieter than the verdict" are different claims and only one of
// them survives contact with CSS.
// One definition of the environment, shared by every suite.
const env = require('./lib/env.js');
const { ROOT, FRONT, STUB_ENDPOINT } = env;
const { launch } = require('./lib/cdp.js');
const fs = require('node:fs');
const path = require('node:path');

const ADIR = path.join(ROOT, 'prism', 'vault', 'knowledge', 'integrations', 'agentic');
const CFG = path.join(ADIR, 'f28-ui.md');

let pass = 0, fail = 0;
const check = (n, c, d) => {
  if (c) { console.log('  PASS ' + n); pass++; }
  else { console.log('  FAIL ' + n + (d ? '  — ' + d : '')); fail++; }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // A config that claims only the UX lens, so the requirements lens is
  // UNCLAIMED -> the unjudged card must carry the routing note.
  fs.writeFileSync(CFG,
    '# f28 ui probe\n\n**Title:** UX Judge\n**Status:** active\n' +
    '**Lenses:** ux-bridge-default\n**Kind:** openai\n' +
    `**Endpoint:** ${STUB_ENDPOINT}\n**Model:** stub\n**Auth env:** PRISM_TEST_KEY\n`);

  const b = await launch();
  const page = await b.newPage();
  await page.ready();
  try {
    await page.goto(FRONT + '/prism/');
    await page.waitFor('document.getElementById("desk-content")', 10000, 'desk');
    await page.eval(`(() => { const t=document.getElementById('desk-content');
      t.value='Export fails on large reports.'; t.dispatchEvent(new Event('input')); })()`);
    await page.eval(`document.querySelector('.desk-door[data-lens="requirements"]').click()`);
    await sleep(3500);

    // The intent-synth step passes the shape check; the agent then judges it.
    await page.eval(`(() => { const t=document.getElementById('wf-input');
      t.value = ['# Intent Synthesis: bulk export','',
        '## Core Objective & Problem Statement','Exports fail above 10k rows.','',
        '## Primary Intentions (Functional)','1. Export completes','',
        '## Technical & Architectural Constraints','Single worker.','',
        '## Edge Cases & Sidetrack Insights','Empty result sets.','',
        '## Identified Ambiguities','Row limits vs timeouts.'].join('\\n');
      t.dispatchEvent(new Event('input')); _chatSend(); })()`);
    await sleep(4500);

    const card = await page.eval(`(() => {
      const el = document.querySelector('.wf-judge');
      return el ? el.className + ' || ' + el.textContent.replace(/\\s+/g,' ').trim() : 'NO CARD'; })()`);
    console.log('\n  card: ' + card.slice(0, 200) + '\n');

    check('a judgment card rendered', card !== 'NO CARD', card.slice(0, 80));
    check('the requirements lens was NOT judged (unclaimed)',
          /Unjudged|nobody was asked/.test(card), card.slice(0, 120));
    check('the routing note is on screen', /Routing:/.test(card), card.slice(0, 200));
    check('and it says no integration claims this lens',
          /No integration claims/.test(card), card.slice(0, 240));
    check('and it tells the human what to do',
          /lenses:/.test(card), card.slice(0, 280));

    const styled = await page.eval(`(() => {
      const el = document.querySelector('.wf-judge-route');
      if (!el) return null;
      const s = getComputedStyle(el);
      return { size: s.fontSize, color: s.color, border: s.borderTopStyle };
    })()`);
    check('the routing note is actually styled', styled && parseFloat(styled.size) > 8,
          JSON.stringify(styled));
    check('and it is visually quieter than the verdict',
          styled && parseFloat(styled.size) < 13, JSON.stringify(styled));
  } finally {
    await b.close();
    // The vault, not just the config. Opening a lens and pasting into the
    // workflow writes a Genesis source and, if the run completes, a requirements
    // artifact — plus a session json. The first version of this suite cleaned up
    // only its agent config and left four files behind, which is exactly the
    // residue this repo does not accept. F25/F26 already knew this.
    const today = new Date().toISOString().slice(0, 10);
    for (const rel of ['requirements', 'hypotheses', 'rationalizations',
                       'source/unordereds']) {
      const dir = path.join(ROOT, 'prism', 'vault', rel);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!f.startsWith(today + '-')) continue;
        try { fs.unlinkSync(path.join(dir, f)); } catch (e) {}
      }
    }
    try { fs.unlinkSync(CFG); } catch (e) {}
  }
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
