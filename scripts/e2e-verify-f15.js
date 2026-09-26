// Prism end-to-end regression test — F15: agent/workflow docs match the UI.
//
// The three agent definitions and three workflow READMEs each described a
// post-processing menu with five options (A–E), including
// "E — Archive and emit to integration". F8 removed that button from the
// UI on 24 Aug 2026 because no integration was configured, and deleted
// wfOptE() with it — but none of the six documents were updated. Since
// these are the files a human copies into their own agent, the drift was
// user-facing: an agent reading this vault would offer a door Prism cannot
// open (F8 / GN-006: no dead affordances).
//
// Two further defects in the same pass:
//   - the "Future: wire real LLM API calls" note in all three agent
//     definitions, which contradicted the "lens, not the laser" constraint
//     and described a placeholder response that does not exist in the code
//   - three references to vault/knowledge/integrations-config/, a path that
//     does not exist (the real one is vault/knowledge/integrations/)
//
// This suite asserts the documents describe the menu the code actually
// renders, so the two cannot drift apart silently again.
//
// No DOM stub and no backend needed: this reads the shipped app.js and the
// shipped vault documents.
//
// Usage:  node scripts/e2e-verify-f15.js     (exit 0 = all checks pass)

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'prism', 'app.js');
const VAULT = path.join(ROOT, 'prism', 'vault');

const AGENTS = [
  'requirements-default.md',
  'rationalizations-default.md',
  'ux-bridge.md',
];
const WORKFLOWS = [
  'requirements-default/README.md',
  'rationalizations-default/README.md',
  'ux-bridge-default/README.md',
];

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  PASS ' + name); pass++; }
  else { console.log('  FAIL ' + name + (detail ? '  — ' + detail : '')); fail++; }
}
function section(s) { console.log('\n' + s); }

const read = (p) => fs.readFileSync(p, 'utf8');

(async () => {
  const app = read(APP);

  // ── 1. Establish ground truth from the code ─────────────────────────────
  section('Ground truth: what the UI actually offers');
  // The post-processing buttons are emitted together in _chatBubbleHtml.
  const buttons = [...app.matchAll(/onclick="wfOpt([A-E])\(\)"/g)].map(m => m[1]);
  const unique = [...new Set(buttons)].sort();
  check('post-processing buttons found in app.js', buttons.length >= 4,
        'found: ' + JSON.stringify(buttons));
  check('UI offers exactly A–D', unique.join('') === 'ABCD', 'got ' + unique.join(''));
  check('wfOptE is gone from the code', !/function wfOptE\b/.test(app),
        'wfOptE still defined — if an integration is configured, say so and update this suite');
  check('no E button is rendered', !/onclick="wfOptE\(\)"/.test(app));

  // ── 2. Agent definitions describe A–D, and say why there is no E ───────
  section('Agent definitions');
  for (const a of AGENTS) {
    const p = path.join(VAULT, 'knowledge', 'agents', a);
    if (!fs.existsSync(p)) { check(a + ' exists', false); continue; }
    const t = read(p);

    check(`${a}: no "Options A–E" claim`, !/Options A–E|Options A-E/.test(t));
    check(`${a}: capability line says A–D`, /presents Options A–D/.test(t));

    // The menu block must not offer an E line. These files are CRLF, so
    // normalise before matching (an LF-only regex silently finds nothing).
    const norm = t.replace(/\r\n/g, '\n');
    const menu = norm.match(/```\nWhat would you like to do next\?[\s\S]*?```/);
    check(`${a}: menu block found`, !!menu, 'no "What would you like to do next?" block');
    if (menu) {
      check(`${a}: menu block offers no Option E`,
            !/^\s*E\s*—/m.test(menu[0]),
            'menu still lists E');
      // And it must still offer all four that the UI renders.
      for (const L of ['A', 'B', 'C', 'D']) {
        check(`${a}: menu offers ${L}`,
              new RegExp(`^\\s*${L}\\s*—`, 'm').test(menu[0]));
      }
    }

    check(`${a}: explains the absent door`,
          /There is no Option E/.test(t));
    check(`${a}: no Option E execution row`, !/\|\s*\*\*E\*\*\s*\|/.test(t));
    check(`${a}: no Option E handoff row`, !/^\|\s*Option E selected/m.test(t));
    check(`${a}: no "Option A or E" phrasing`, !/Option A or E|Option A or Option E/.test(t));
    check(`${a}: no stale LLM roadmap line`, !/Future: wire real LLM API calls/.test(t));
    check(`${a}: states the no-LLM constraint`,
          /never calls a language model/.test(t));
  }

  // ── 3. Workflow READMEs ────────────────────────────────────────────────
  section('Workflow definitions');
  for (const w of WORKFLOWS) {
    const p = path.join(VAULT, 'workflows', w);
    if (!fs.existsSync(p)) { check(w + ' exists', false); continue; }
    const t = read(p);

    check(`${w}: no live "Option E — Archive and emit" section`,
          !/### Option E — Archive and emit/.test(t));
    check(`${w}: marks Option E as not available`,
          /### Option E — not available/.test(t));
    // The bogus path that does not exist in the vault.
    check(`${w}: no integrations-config path`,
          !/integrations-config/.test(t),
          'still references a directory that does not exist');
  }

  // ── 4. No stray references anywhere in the vault ────────────────────────
  section('Vault-wide');
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) walk(fp);
      else if (e.name.endsWith('.md')) files.push(fp);
    }
  })(VAULT);

  const bad = [];
  for (const f of files) {
    const rel = path.relative(VAULT, f);
    const t = read(f);
    if (/Future: wire real LLM API calls/.test(t)) bad.push(rel + ' (LLM roadmap)');
    if (/integrations-config/.test(t)) bad.push(rel + ' (bad path)');
    if (/### Option E — Archive and emit/.test(t)) bad.push(rel + ' (Option E section)');
    if (/\| \*\*E\*\* \|/.test(t)) bad.push(rel + ' (Option E row)');
  }
  check('no stale doc-truth anywhere in the vault', bad.length === 0, bad.join(' | '));

  // The integration folders really are unconfigured — that is WHY E is gone.
  // Both subfolders hold only a README (the convention doc); no config file
  // means no service, so no door.
  section('Premise check');
  const integ = path.join(VAULT, 'knowledge', 'integrations');
  const configs = [];
  (function walk(d) {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) walk(fp);
      else if (e.name !== 'README.md') configs.push(path.relative(integ, fp));
    }
  })(integ);
  check('integrations/ holds no configured services (E absent legitimately)',
        configs.length === 0, 'found: ' + configs.join(', '));

  console.log(`\n${pass}/${pass + fail} checks passed`);
  if (fail) { console.log(`${fail} FAILED`); process.exit(1); }
  console.log('F15: agent and workflow docs match the post-processing menu the UI renders.');
})();
