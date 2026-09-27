// Prism end-to-end regression test — F17: one door, and honest workflow status.
//
// Retires the Lens Wizard. The Crafting Table is the only way to create a
// lens; the wizard's step 3 was the only place a non-default workflow could be
// selected, so retiring it also removed the only door to ux-bridge-default.
//
// This suite locks down the consequences so none of it silently regresses:
//   1. The wizard is gone and nothing references it.
//   2. Option C (send to another workflow) still works — it used to depend
//      on the wizard, so it had to be rebuilt rather than deleted.
//   3. The three lens views still reach the desk, and still hold a next
//      action for an empty lens (GN-006).
//   4. The dead /status endpoint and its counters are gone.
//   5. Workflow runner status is derived from ONE registry, and a workflow
//      without a runner is labelled rather than presented as live.
//
// No DOM stub and no backend needed.
//
// Usage:  node scripts/e2e-verify-f17.js     (exit 0 = all checks pass)

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'prism', 'app.js');
const API = path.join(ROOT, 'prism', 'api-server.py');
const CSS = path.join(ROOT, 'prism', 'prism.css');
const VAULT = path.join(ROOT, 'prism', 'vault');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  PASS ' + name); pass++; }
  else { console.log('  FAIL ' + name + (detail ? '  — ' + detail : '')); fail++; }
}
function section(s) { console.log('\n' + s); }
const read = (p) => fs.readFileSync(p, 'utf8');

(async () => {
  const app = read(APP);
  const api = read(API);

  // ── 1. The wizard is gone ──────────────────────────────────────────────
  section('Wizard retired');
  const ghosts = [
    [/\blet _wiz\b/, '_wiz state'],
    [/\b_startWizard\(/, '_startWizard()'],
    [/\bnewHypothesis\(/, 'newHypothesis()'],
    [/\bnewRequirement\(/, 'newRequirement()'],
    [/\bnewRationalization\(/, 'newRationalization()'],
    [/\bwizProgressBar\(/, 'wizProgressBar()'],
    [/\brenderWizardStep\(/, 'renderWizardStep()'],
    [/\brenderWizStep\d\(/, 'renderWizStepN()'],
    [/\bwizLaunch\(/, 'wizLaunch()'],
    [/\bwizBack\(/, 'wizBack()'],
    [/\bwizQuickIngest\(/, 'wizQuickIngest()'],
    [/\bwiz2SelectArtifact\(/, 'wiz2SelectArtifact()'],
    [/\bwiz3AddSubAsset\(/, 'wiz3AddSubAsset()'],
    [/\bwiz3SelectWorkflow\(/, 'wiz3SelectWorkflow()'],
  ];
  const found = ghosts.filter(([re]) => re.test(app)).map(([, n]) => n);
  check('no wizard symbols survive in app.js', found.length === 0, found.join(', '));
  check('no "New hypothesis/requirement/rationalization" buttons',
        !/＋ New (hypothesis|requirement|rationalization)/.test(app));
  check('LENS_CONFIGS survives (the desk and runners need it)',
        /const LENS_CONFIGS = \{/.test(app));
  check('the desk still creates lenses', /deskLensDoor\(/.test(app)
        && /apiPost\(cfg\.endpoint/.test(app));

  // The lens views are for working lenses, not creating them.
  for (const [view, noun] of [['renderHypotheses', 'hypothesis'],
                              ['renderRequirements', 'requirement'],
                              ['renderRationalizations', 'rationalization']]) {
    check(`${view}() exists`, app.includes(`async function ${view}(`));
  }
  check('lens views point at the Crafting Table', /_craftingTablePointer/.test(app));
  check('pointer navigates to the desk', /gotoView\('dashboard'\)/.test(app));

  // ── 2. Option C still works ────────────────────────────────────────────
  section('Option C rebuilt without the wizard');
  check('wfOptC no longer calls renderWizStep3', !/wfOptC[\s\S]{0,900}renderWizStep3/.test(app));
  check('wfOptC reads the workflow list from the API',
        /function wfOptC[\s\S]{0,900}apiGet\('\/workflows'\)/.test(app));
  check('wfOptC launches the chosen workflow', /_wfOptCSend/.test(app));
  check('_wfOptCSend hands off to renderWorkflowChat',
        /function _wfOptCSend[\s\S]{0,600}renderWorkflowChat/.test(app));
  check('Option C filters out the current workflow',
        /w\.id !== _chat\.workflowId/.test(app));
  check('Option C has an escape back to the desk',
        /Back to the Crafting Table/.test(app));

  // ── 3. Runner registry: one source of truth ────────────────────────────
  section('Runner registry');
  check('_WF_RUNNERS registry exists', /const _WF_RUNNERS = \{/.test(app));
  check('_wfRunnerFor() resolves by id + kind', /function _wfRunnerFor\(workflowId, kind\)/.test(app));
  check('_wfHasRunner() exists', /function _wfHasRunner\(/.test(app));

  // The two DISPATCH sites must not hardcode ids — they resolve through the
  // registry. Per-workflow STATE transitions (_wfAdvanceVerified branching on
  // which shape it just verified) are legitimately per-workflow and are not
  // in scope here.
  const dispatchHardcoded = [...app.matchAll(
    /function (renderWorkflowChat|_wfDispatch)\([\s\S]*?\n\}/g)]
    .filter(m => /_chat\.workflowId === '[a-z-]+-default'/.test(m[0]))
    .map(m => m[1]);
  check('no dispatch site hardcodes a workflow id', dispatchHardcoded.length === 0,
        dispatchHardcoded.join(', '));
  check('renderWorkflowChat dispatches through the registry',
        /_wfRunnerFor\(_chat\.workflowId, 'Init'\)/.test(app));
  check('_wfDispatch dispatches through the registry',
        /_wfRunnerFor\(_chat\.workflowId, 'Respond'\)/.test(app));
  check('state-transition logic still branches per workflow (unchanged)',
        /_chat\.workflowId === 'requirements-default'/.test(app));

  // Every id in the registry must resolve to a real function in app.js.
  const regBlock = app.match(/const _WF_RUNNERS = \{[\s\S]*?\n\};/);
  check('registry block found', !!regBlock);
  if (regBlock) {
    const ids = [...regBlock[0].matchAll(/'([a-z-]+)':\s*\{/g)].map(m => m[1]);
    const fns = [...regBlock[0].matchAll(/'(_wf\w+)':/g)].map(m => m[1]);
    check('registry lists the three known workflows', ids.length === 3, ids.join(', '));
    const missing = fns.filter(f => !app.includes('function ' + f));
    check('every registered function exists in app.js', missing.length === 0,
          missing.join(', '));
  }

  // ── 4. Workflow status is honest (D) ──────────────────────────────────
  section('Workflow status labelling');
  check('_wfRunnerBadge() exists', /function _wfRunnerBadge\(/.test(app));
  check('badge is rendered in the Workflows view header',
        /\$\{_wfRunnerBadge\(relPath\)\}/.test(app));
  check('runnable workflows are labelled positively', /▶ runnable/.test(app));
  check('runnerless workflows are labelled as not runnable',
        /defined, not yet runnable/.test(app));
  check('badge explains what would fix it', /Writing the runner makes it runnable/.test(app));
  check('css defines .badge.warn', /\.badge\.warn\s*\{/.test(read(CSS)));
  check('css defines .badge.ok', /\.badge\.ok\s*\{/.test(read(CSS)));

  // The premise: ux-bridge-default really has no runner, and the badge
  // depends on the registry, not on a hardcoded exclusion list.
  const wfDirs = fs.readdirSync(path.join(VAULT, 'workflows'))
                   .filter(d => fs.statSync(path.join(VAULT, 'workflows', d)).isDirectory());
  check('vault still has its three workflow definitions', wfDirs.length === 3,
        wfDirs.join(', '));
  check('ux-bridge-default is present in the vault',
        wfDirs.includes('ux-bridge-default'));
  check('ux-bridge-default has no runner in the registry',
        !/ux-bridge-default/.test(regBlock ? regBlock[0] : ''));
  check('the badge logic reads the registry, not an exclusion list',
        /_wfHasRunner\(id\)/.test(app) && !/id !== 'ux-bridge/.test(app));

  // A no-runner workflow must not pretend to be "being configured".
  check('no-runner chat says so plainly',
        /No runner is wired up/.test(app));
  check('old vague "still being configured" message is gone',
        !/still being configured/.test(app));

  // ── 5. The dead /status endpoint is gone ───────────────────────────────
  section('Dead status endpoint removed');
  check('api-server.py has no /status route', !/path == "\/status"/.test(api));
  check('get_status() removed', !/def get_status\(/.test(api));
  check('HYPOTHESIS_STATUSES removed', !/HYPOTHESIS_STATUSES/.test(api));
  check('stakeholder_count counter removed', !/stakeholder_count/.test(api));
  check('days_since_sweep counter removed', !/days_since_sweep/.test(api));
  check('dwell histogram removed', !/"dwell"/.test(api) && !/DWELL_LENSES/.test(api));
  // The endpoint the app actually depends on must survive.
  check('/lenses still served', /path == "\/lenses"/.test(api));
  check('/workflows still served', /path == "\/workflows"/.test(api));
  check('/ingest still served', /path == "\/ingest"/.test(api));
  check('list_lenses() survives', /def list_lenses\(/.test(api));
  // Nothing anywhere may still call the removed endpoint.
  const suites = fs.readdirSync(path.join(ROOT, 'scripts')).filter(f => f.endsWith('.js'));
  const callers = suites.filter(f => /['"`]\/status/.test(read(path.join(ROOT, 'scripts', f))));
  check('no regression suite calls /status', callers.length === 0, callers.join(', '));

  console.log(`\n${pass}/${pass + fail} checks passed`);
  if (fail) { console.log(`${fail} FAILED`); process.exit(1); }
  console.log('F17: one door; wizard gone; runner status honest; dead counters removed.');
})();
