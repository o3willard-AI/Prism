// Prism end-to-end regression test — F20: the UX Bridge workflow runner.
//
// ux-bridge-default was the one workflow in the vault with a full definition,
// skill, agent spec and 11-field process document — and no runner. F17 made
// that honest by labelling it "⚠️ defined, not yet runnable". This suite
// covers the runner that closes the gap.
//
// UX Bridge is the odd one out among the runners: it does not take a shot and
// finish, it INTERVIEWS the PM one question at a time until
// (validated fields / 11) >= 95%. So this suite is mostly about the loop and
// about one rule that is easy to get wrong: a clarifying QUESTION must never
// be written into the lens file, and only a compiled SPEC may be.
//
// Usage:  node scripts/e2e-verify-f20.js     (exit 0 = all checks pass)

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'prism', 'app.js');
const API_PY = path.join(ROOT, 'prism', 'api-server.py');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  PASS ' + name); pass++; }
  else { console.log('  FAIL ' + name + (detail ? '  — ' + detail : '')); fail++; }
}
function section(s) { console.log(`\n${s}`); }
const read = (p) => fs.readFileSync(p, 'utf8');

(async () => {
  const app = read(APP);
  const api = read(API_PY);

  // ── 1. Registered ──────────────────────────────────────────────────────
  section('Registered');
  check('ux-bridge-default is in _WF_RUNNERS',
        /'ux-bridge-default':\s*\{/.test(app));
  check('it points at the three handler names',
        /'ux-bridge-default':\s*\{\s*Init: '_wfUxInit', Respond: '_wfUxRespond', PostProcess: '_wfUxPostProcessMsg' \}/.test(app));
  check('_wfUxInit exists',      /async function _wfUxInit\(/.test(app));
  check('_wfUxRespond exists',   /function _wfUxRespond\(/.test(app));
  check('_wfUxPostProcessMsg exists', /function _wfUxPostProcessMsg\(/.test(app));
  check('_wfUxBridgePrompt exists',   /function _wfUxBridgePrompt\(/.test(app));

  // ── 2. The step machine is a LOOP, not a ladder ────────────────────────
  section('Interview loop');
  check('init opens the interview (awaiting-bridge)',
        /_chat\.wfStep = 'awaiting-bridge'/.test(app));
  check('respond routes both awaiting-bridge and interview into the loop',
        /step === 'awaiting-bridge' \|\| step === 'interview'/.test(app));
  check('_wfUxRespondMaybeSpec exists',
        /async function _wfUxRespondMaybeSpec\(/.test(app));
  check('_wfUxAdvance exists', /function _wfUxAdvance\(/.test(app));
  // An ANSWER is not agent output, so it must NOT go through F2 — the shape
  // check would call it "unrecognized" and the loop would stall forever. The
  // probe decides: a claimed spec is verified, anything else is an answer.
  check('an answer skips verification and advances the loop',
        /if \(!looksLikeSpec\) \{ _wfUxAdvance\(\); return; \}/.test(app));
  check('a claimed spec is routed through the real shape check',
        /_wfVerifyPasted\(userText, 'ux-handoff-spec'\)/.test(app));
  check('the probe keys on the spec heading, not on a round-trip',
        /UX\\s\*\[-–\]\?\\s\*Hand/.test(app));
  check('a question advances to interview (not to post-processing)',
        /_chat\.wfStep = 'interview'/.test(app)
        && /isInquiry\)[\s\S]{0,400}_chat\.wfStep = 'interview'/.test(app));
  check('a spec advances to post-processing',
        /_chat\.wfStep = 'post-processing'/.test(app));
  check('the blocking check matches the skill (media/application/code)',
        /const blocked = \['media', 'application', 'code'\]/.test(app));
  check('a blocked artifact says so and stops',
        /_chat\.wfStep = 'blocked'/.test(app));

  // ── 3. The answer log — the loop must be stateful ──────────────────────
  // The skill's loop carries state. If each prompt were stateless the agent
  // would re-ask from scratch every turn, which is exactly the failure the
  // "one question at a time" rule exists to avoid.
  section('Stateful prompt');
  check('the prompt gathers prior user answers',
        /_chat\.messages[\s\S]{0,120}filter\(m => m\.role === 'user' && m\.text\)/.test(app));
  check('answers are numbered into the log',
        /\*\*Answer \$\{i \+ 1\}:\*\*/.test(app));
  check('the log tells the agent not to re-ask',
        /do not re-ask anything already answered/.test(app));
  check('the log is omitted on the first turn (no empty log)',
        /const log = answers\.length/.test(app));
  check('the prompt names the skill',
        /Skill: vault\/knowledge\/resources\/skills\/ux-bridge\.md/.test(app));
  check('the prompt names the 11-field requirements doc',
        /UX REQUIREMENTS:\s+vault\/knowledge\/process\/ux-information-requirements\.md/.test(app));
  check('the prompt carries the product-context slot the skill requires',
        /PRODUCT CONTEXT:/.test(app));
  check('the prompt restates the one-question rule',
        /Ask ONE question per turn/.test(app));
  check('the prompt restates the 95% stop rule',
        /Stop the moment confidence reaches 95%/.test(app));

  // ── 4. The shape: question vs spec, discriminated by STRUCTURE ─────────
  section('Verify shape');
  check('the shape exists in api-server.py',
        /"ux-handoff-spec":/.test(api));
  check('it has exactly two kinds', /"question":/.test(api) && /"spec":/.test(api));
  // The 11 numbered headings are what distinguish a real spec from a document
  // that merely mentions accessibility — so they must be required.
  const uxShape = api.match(/"ux-handoff-spec": \{[\s\S]*?\n    \},/);
  check('the shape block is found', !!uxShape);
  if (uxShape) {
    // Each of the 11 mandatory fields must be a REQUIRED marker, with a
    // pattern that anchors the numbered heading (^#+\s*N\.) so a document that
    // merely discusses accessibility cannot pass as a spec.
    const raw = uxShape[0];
    for (let n = 1; n <= 11; n++) {
      const label = raw.includes(`("${n}. `) || raw.includes(`"${n}. `);
      const anchored = raw.includes('^#+\\s*' + n + '\\.\\s');
      check(`shape requires numbered section ${n}`, label && anchored,
            `label=${label} anchoredPattern=${anchored}`);
    }
    check('the question kind requires a question mark',
          raw.includes('"a question"') && raw.includes('r"\\?"'));
    check('the question kind requires a rationale',
          raw.includes('why it is being asked'));
    // Count kinds structurally: a kind is a key directly inside "kinds".
    const kindsBody = raw.match(/"kinds": \{([\s\S]*?)\n        \}/);
    check('the shape has a kinds block', !!kindsBody);
    if (kindsBody) {
      const kindNames = [...kindsBody[1].matchAll(/^\s{12}"([a-z-]+)": \{/gm)].map(m => m[1]);
      check('exactly two kinds: question and spec',
            kindNames.length === 2
            && kindNames.includes('question') && kindNames.includes('spec'),
            kindNames.join(', '));
    }
  }
  check('ux-handoff-spec is registered as terminal (spec only)',
        /'ux-handoff-spec':\s*true/.test(app));
  check('the spec writes status ux-ready, not review',
        /isUxSpec[\s\S]{0,200}'ux-ready'/.test(app));
  check('the spec has its own section label',
        /'ux-handoff-spec': '## UX Hand-off Specification/.test(app));
  check('a clarifying question is NOT written to the file',
        /isTerminal && !isInquiry/.test(app));

  // ── 5. Pause / resume fidelity ─────────────────────────────────────────
  section('Pause and resume');
  check('awaiting-bridge has a pause description',
        /'awaiting-bridge':\s*'UX Bridge interview/.test(app));
  check('interview has a pause description',
        /'interview':\s*'UX Bridge interview in progress/.test(app));
  check('awaiting-bridge has a next-step guide',
        /'awaiting-bridge':\s*`Run the \*\*UX Bridge\*\* prompt/.test(app));
  check('interview has a next-step guide',
        /'interview':\s*`Answer the UX Bridge question/.test(app));
  check('resume re-issues the bridge prompt with the answer log',
        /step === 'awaiting-bridge' \|\| step === 'interview'/.test(app)
        && /_wfUxBridgePrompt\(_chat\.artifactPath, name, _chat\.artifactContent \|\| ''\)/.test(app));
  check('resume uses the ux post-process message',
        /wf === 'ux-bridge-default'\s*\?\s*_wfUxPostProcessMsg\(\)/.test(app));
  check('init honours the shared resume path',
        /async function _wfUxInit\(\)[\s\S]{0,200}_wfResumeFromPause\(\)/.test(app));

  // ── 6. Option C can still hand a spec to another workflow ──────────────
  section('Handoff');
  check('the spec is written to vault/requirements via the lens file',
        /_wfApplyAccepted/.test(app));
  check('post-process message names ux-ready',
        /ux-ready/.test(app) && /_wfUxPostProcessMsg/.test(app));

  // ── 7. The docs must not still call it a stub ──────────────────────────
  section('Docs agree with the code');
  const agentDef = read(path.join(ROOT, 'prism', 'vault', 'knowledge', 'agents', 'ux-bridge.md'));
  check('agent definition still describes the iterative Q&A loop',
        /Iterative Q&A loop/.test(agentDef));
  check('agent definition still states one-question-at-a-time',
        /one targeted question per turn|one question at a time/i.test(agentDef));
  check('agent definition still names ux-ready as the output status',
        /ux-ready/.test(agentDef));
  check('workflow README describes the 11 fields',
        /11/.test(read(path.join(ROOT, 'prism', 'vault', 'workflows', 'ux-bridge-default', 'README.md'))));
  // The process doc is the authority for "11 mandatory fields" — the shape
  // must not drift from it silently.
  const proc = read(path.join(ROOT, 'prism', 'vault', 'knowledge', 'process',
                              'ux-information-requirements.md'));
  const procFields = (proc.match(/^###\s+(\d+)\.\s+(.+)$/gm) || []).length;
  check('the process doc still defines 11 fields', procFields === 11, 'found ' + procFields);
  const shapeSections = (api.match(/"\d+\.\s/g) || []).length;
  check('the shape covers at least the 11 process-doc fields',
        shapeSections >= 11, 'shape has ' + shapeSections + ' numbered checks');

  console.log(`\n${pass}/${pass + fail} checks passed`);
  if (fail) { console.log(`${fail} FAILED`); process.exit(1); }
  console.log('F20: UX Bridge runner — interview loop, shape check, ux-ready emission.');
})();
