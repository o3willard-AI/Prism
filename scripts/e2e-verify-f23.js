// F23: the configurable confidence threshold.
//
// The 95% figure was hardcoded in four places and could not be changed by the
// human. This suite asserts that the bar is now the human's decision, per
// lens, and that the value actually REACHES THE AGENT — which is the part
// that is easy to build and easy to get wrong. A threshold that exists in a
// config file but not in the prompt is a threshold that does not exist.
//
// Two halves, because the failure modes are different:
//   1. Config + parsing + validation (pure, fast)
//   2. The block reaching a real prompt, through the real UI

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { launch } from './lib/cdp.js';

// One definition of the environment, shared by every suite.
import env from './lib/env.js';
const { ROOT, API, FRONT } = env;
const CFG_REL = 'knowledge/process/confidence-thresholds.md';
const CFG = path.join(ROOT, 'prism', 'vault', CFG_REL);

let pass = 0, fail = 0;
const section = (s) => console.log('\n' + s);
const check = (name, cond, detail) => {
  if (cond) { console.log('  PASS ' + name); pass++; }
  else { console.log('  FAIL ' + name + (detail ? '  — ' + detail : '')); fail++; }
};

function get(p) {
  return new Promise((resolve, reject) => {
    http.get(API + p, r => {
      let b = ''; r.on('data', d => b += d);
      r.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function pyThresholds() {
  const driver = `
import json, sys
sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'prism'))})
import thresholds as T
out = {
  "loaded": T.load_thresholds(),
  "get": {l: T.get_threshold(l) for l in T.LENSES},
  "validate": {str(v): T.validate(v) for v in
               ["85","85%",95,100,1,0,101,"abc","450"," 70 ","",None,3.7]},
  "line": T.threshold_line("hypotheses-default"),
  "block": T.threshold_block("hypotheses-default"),
  "block_unknown": T.threshold_block("no-such-lens"),
  "default": T.DEFAULT_THRESHOLD, "min": T.MIN_THRESHOLD, "max": T.MAX_THRESHOLD,
  "lenses": list(T.LENSES), "path": T.THRESHOLD_PATH,
}
print(json.dumps(out))
`;
  const p = '/tmp/prism-f23-driver.py';
  fs.writeFileSync(p, driver);
  return JSON.parse(execFileSync('python3', [p], { encoding: 'utf8' }));
}

(async () => {
  // ── 1. The module ───────────────────────────────────────────────────────
  section('Threshold module — parsing, defaults, and the legal range');
  const T = pyThresholds();

  check('all four lenses are known', T.lenses.length === 4, T.lenses.join(', '));
  check('the default is 95', T.default === 95, String(T.default));
  check('100 is a LEGAL value (ask about everything)', T.max === 100);
  check('the floor is 1, not 0 (a gate of 0 is not a gate)', T.min === 1);
  check('the config path is the process doc', T.path === CFG_REL, T.path);
  check('the config file exists', fs.existsSync(CFG), CFG);

  section('Per-lens values are genuinely per-lens');
  const vals = Object.values(T.get);
  check('not every lens has the same threshold', new Set(vals).size > 1,
        Object.entries(T.get).map(([k, v]) => k + '=' + v).join(' '));
  check('requirements is held to a high bar', T.get['requirements-default'] >= 90,
        String(T.get['requirements-default']));
  check('hypotheses is held to a lower bar than requirements',
        T.get['hypotheses-default'] < T.get['requirements-default'],
        T.get['hypotheses-default'] + ' vs ' + T.get['requirements-default']);
  check('every lens reports whether it was configured or defaulted',
        Object.values(T.loaded).every(v => v.source === 'config' || v.source === 'default'));

  section('Validation — accept real input, refuse nonsense');
  const v = T.validate;
  check('a bare number is accepted', v['85'] === 85);
  check('a number with % is accepted', v['85%'] === 85);
  check('100 is accepted (not treated as out of range)', v['100'] === 100);
  check('1 is accepted (the floor)', v['1'] === 1);
  check('surrounding whitespace is tolerated', v[' 70 '] === 70);
  check('0 is REFUSED (not a gate)', v['0'] === null);
  check('101 is refused', v['101'] === null);
  check('450 is refused rather than clamped to 100', v['450'] === null);
  check('non-numeric input is refused', v['abc'] === null && v[''] === null);
  check('null is refused', v['None'] === null);
  check('a float is refused rather than truncated', v['3.7'] === null,
        String(v['3.7']));

  section('The block that reaches the agent');
  check('it states the number', /CONFIDENCE THRESHOLD: 85%/.test(T.line));
  check('it carries the human\'s REASON, not just the number',
        /cheap to be wrong about/.test(T.block),
        T.block.slice(0, 120));
  check('it says the bar is not the agent\'s to raise',
        /not yours to raise/.test(T.block));
  check('it forbids generic "more detail" questions',
        /please provide more detail/.test(T.block));
  check('it asks for the confidence to be stated', /State your confidence/.test(T.block));
  check('an unknown lens falls back rather than failing',
        T.block_unknown.includes('CONFIDENCE THRESHOLD: 95%'));

  // ── 2. The HTTP surface ─────────────────────────────────────────────────
  section('HTTP — the UI reads thresholds from the server');
  const t = await get('/thresholds');
  check('/thresholds responds', t.ok === true);
  check('it reports the default and bounds', t.default === 95 && t.min === 1 && t.max === 100);
  check('it returns a value per lens', Object.keys(t.thresholds).length === 4);
  check('it names the file to edit', t.path === CFG_REL);
  const blk = await get('/threshold-block?lens=requirements-default');
  check('/threshold-block returns the lens value', blk.threshold === 95, String(blk.threshold));
  check('/threshold-block returns the exact text the agent will read',
        /CONFIDENCE THRESHOLD: 95%/.test(blk.block));
  const unknown = await get('/threshold-block?lens=nope');
  check('an unknown lens does not error', unknown.ok === true);
  check('an unknown lens gets the default', unknown.threshold === 95);

  // ── 3. The source posture ───────────────────────────────────────────────
  section('Source — the block is spliced in ONE place, not eighteen');
  const app = fs.readFileSync(path.join(ROOT, 'prism', 'app.js'), 'utf8');
  const builders = ['_wfReqPrdGatePrompt', '_wfReqIntentSynthPrompt', '_wfRatIntentSynthPrompt',
    '_wfRatConvSynthPrompt', '_wfRatStructurePrompt', '_wfHypGatePrompt',
    '_wfHypDocSynthPrompt', '_wfUxBridgePrompt'];
  for (const b of builders) {
    check(`${b} is wrapped exactly once`,
          new RegExp(`const ${b} = \\(\\.\\.\\.a\\) => _wfWithThreshold\\(${b}Raw\\(\\.\\.\\.a\\)\\);`).test(app));
  }
  check('no prompt builder is left unwrapped',
        builders.every(b => app.includes(`function ${b}Raw(`) && app.includes(`const ${b} = `)));
  check('every runner loads the threshold before building a prompt',
        ['_wfReqInit', '_wfRatInit', '_wfHypInit', '_wfUxInit'].every(fn => {
          const m = app.match(new RegExp(`async function ${fn}\\(\\) \\{([\\s\\S]{0,400})`));
          return m && m[1].includes('_wfThresholdBlock(');
        }));
  check('the block text is built server-side, not restated in app.js',
        /threshold-block\?lens=/.test(app) && !/The human has set the clarity bar/.test(app));
  check('the artifact records the threshold it was produced under',
        /\*\*Confidence threshold:\*\*/.test(app));
  check('a missing thresholds endpoint degrades instead of breaking',
        /An unfilled cache produces no|if \(!lens\) return promptText/.test(app));

  // ── 4. The real UI ──────────────────────────────────────────────────────
  section('Real browser — the value reaches a live prompt');
  let browser = null;
  try {
    browser = await launch();
  } catch (e) {
    console.log('  SKIP  no browser: ' + e.message.split('\n')[0]);
  }

  if (browser) {
    const orig = fs.readFileSync(CFG, 'utf8');
    const page = await browser.newPage();
    await page.ready();
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function setThreshold(lens, val) {
      fs.writeFileSync(CFG, orig.replace(
        new RegExp(`(\\| \`?${lens}\`? \\|\\s*)\\d+(%\\s*\\|)`), `$1${val}$2`));
    }

    // Create the lens, and remember what to delete afterwards. The suite
    // clicks real lens doors, which ingests a source mirror and creates a
    // requirements/hypotheses file — and a suite that leaves those behind
    // pollutes the next run and the next person's `git status`.
    // Cleanup matches on the run's date rather than on tracked paths, so no
    // bookkeeping is needed here — the source mirror gets its own random
    // stem and reconstructing the link between it and the lens was the fragile
    // part of the first attempt.
    async function firstPrompt(lensKey) {
      await page.goto(FRONT + '/prism/');
      await page.waitFor('document.getElementById("desk-content")', 10000, 'desk');
      await page.eval(`(() => { const t=document.getElementById('desk-content');
        t.value='Checkout loses users at the address step. Maybe the form is too long.';
        t.dispatchEvent(new Event('input')); })()`);
      await page.eval(`document.querySelector('.desk-door[data-lens="${lensKey}"]').click()`);
      await sleep(3500);
      return page.eval(`(() => { const m=_chat.messages.filter(x=>x.codeBlock).slice(-1)[0];
        return m ? m.codeBlock : ''; })()`);
    }

    try {
      // The desk shows the bars before the human commits to a lens.
      await page.goto(FRONT + '/prism/');
      await page.waitFor('document.getElementById("desk-content")', 10000, 'desk');
      const panel = await page.eval(`(() => {
        const d=[...document.querySelectorAll('details')].find(x=>/Clarity bar/.test(x.textContent));
        return d ? d.textContent.replace(/\\s+/g,' ') : 'NO PANEL'; })()`);
      check('the Crafting Table shows the clarity bars', panel !== 'NO PANEL', panel.slice(0, 80));
      check('the panel shows more than one distinct value',
            /95%/.test(panel) && /85%/.test(panel), panel.slice(0, 120));
      check('the panel says where to change them', /confidence-thresholds\.md/.test(panel));
      check('the desk still renders its lens doors',
            (await page.eval('document.querySelectorAll(".desk-door").length')) === 3,
            String(await page.eval('document.querySelectorAll(".desk-door").length')));

      // And the number in the prompt is the one for THAT lens.
      const hyp = await firstPrompt('hypotheses');
      check('a hypotheses prompt carries the hypotheses bar',
            /CONFIDENCE THRESHOLD: 85%/.test(hyp), hyp.slice(-100));
      check('and not another lens\'s bar', !/CONFIDENCE THRESHOLD: 95%/.test(hyp));
      check('the prompt keeps its original content too',
            /Skill: vault\/knowledge\/resources\/skills\//.test(hyp));

      // Configurable: change the file, and the prompt follows.
      for (const [lens, key, val] of [
        ['hypotheses-default', 'hypotheses', 60],
        ['hypotheses-default', 'hypotheses', 100],
        ['requirements-default', 'requirements', 70],
      ]) {
        setThreshold(lens, val);
        const p = await firstPrompt(key);
        check(`changing the config to ${val}% reaches the ${key} prompt`,
              new RegExp(`CONFIDENCE THRESHOLD: ${val}%`).test(p),
              p.slice(-120).replace(/\n/g, ' '));
      }

      const errs = page.consoleMsgs.filter(m => m.type === 'error');
      check('no console errors during the whole run', errs.length === 0,
            errs.map(e => e.text).join(' | '));
    } finally {
      fs.writeFileSync(CFG, orig);
      // Clean the vault. The lens file and its sidecars share a stem, but the
      // source mirror in source/unordereds/ gets its OWN random stem, so
      // stem-matching alone leaves it behind. Rather than reconstruct the
      // link, match on the run: every file this suite creates is dated today,
      // and nothing legitimately in the vault is. The date is read from the
      // clock rather than hardcoded so the suite keeps working tomorrow.
      const vault = path.join(ROOT, 'prism', 'vault');
      const today = new Date().toISOString().slice(0, 10);
      for (const dir of ['requirements', 'hypotheses', 'rationalizations', 'source/unordereds']) {
        const d = path.join(vault, dir);
        if (!fs.existsSync(d)) continue;
        for (const f of fs.readdirSync(d)) {
          if (f.startsWith(today + '-')) {
            try { fs.unlinkSync(path.join(d, f)); } catch (e) { /* ignore */ }
          }
        }
      }
      await browser.close();
    }
  }

  // ── 5. No drift left behind ─────────────────────────────────────────────
  section('Cleanup');
  // A real assertion, not `|| true`. The browser block edits this file, and a
  // suite that leaves the shipped thresholds altered is worse than one that
  // fails: the next person's test run inherits whatever the last one set.
  const shipped = fs.readFileSync(CFG, 'utf8');
  check('the shipped thresholds are the documented ones',
        /`requirements-default`\s*\|\s*95%/.test(shipped) &&
        /`hypotheses-default`\s*\|\s*85%/.test(shipped) &&
        /`rationalizations-default`\s*\|\s*85%/.test(shipped) &&
        /`ux-bridge-default`\s*\|\s*95%/.test(shipped),
        shipped.split('\n').filter(l => l.includes('-default` |'))
               .map(l => l.trim().slice(0, 40)).join(' | '));
  check('no test threshold value (60, 70, 100) was left behind',
        !/\|\s*60%\s*\|/.test(shipped) && !/\|\s*70%\s*\|/.test(shipped),
        'a test value leaked into the shipped config');

  // The suite clicks real lens doors, which ingest a source mirror and create
  // a lens file. Those must be gone: residue makes the next run's counts wrong
  // and the next person's `git status` dirty, and it is invisible unless
  // something asserts it. Same clock-derived date the cleanup uses.
  const VAULT = path.join(ROOT, 'prism', 'vault');
  const TODAY = new Date().toISOString().slice(0, 10);
  const residue = [];
  for (const dir of ['requirements', 'hypotheses', 'rationalizations', 'source/unordereds']) {
    const d = path.join(VAULT, dir);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (f.startsWith(TODAY + '-')) residue.push(dir + '/' + f);
    }
  }
  check('the suite leaves no lens or source residue in the vault',
        residue.length === 0, residue.slice(0, 6).join(', '));

  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
})();
