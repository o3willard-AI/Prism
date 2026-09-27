const vm = require('vm');
const fs = require('fs');
const path = require('path');

const API = 'http://127.0.0.1:8090/prism/api';
const app = fs.readFileSync('/home/sblanken/workspace/Prism/prism/app.js', 'utf8');

class El {
  constructor(id) {
    this.id = id || '';
    this.innerHTML = ''; this.textContent = ''; this.value = '';
    this.style = {}; this.children = []; this.checked = false;
    this.classList = { add(){}, remove(){}, toggle(){} };
    this.scrollTop = 0; this.scrollHeight = 0;
  }
  addEventListener(){} removeEventListener(){}
  appendChild(c){ this.children.push(c); return c; }
  setAttribute(){} getAttribute(){ return ''; }
  focus(){} select(){} click(){} blur(){} remove(){}
  querySelector(){ return new El(); } querySelectorAll(){ return []; }
}
const byId = {};
const sandbox = {
  console,
  document: {
    getElementById(id){ return byId[id] || (byId[id] = new El(id)); },
    createElement(t){ return new El(t); },
    addEventListener(){}, removeEventListener(){},
    querySelectorAll(){ return []; }, querySelector(){ return null; },
    body: new El('body'),
  },
  // app.js uses the RELATIVE base '/prism/api' (correct in a browser, always
  // same-origin). Node's fetch cannot resolve a relative URL, so the harness
  // resolves it exactly the way a browser would: relative to window.location.
  // Mirrors the other e2e suites.
  location: { href: API.replace(/\/prism\/api$/, '/prism') },
  window: {
    addEventListener(){}, removeEventListener(){}, setTimeout, clearTimeout,
    location: { href: API.replace(/\/prism\/api$/, '/prism') },
    fetch: (u, o) => fetch(new URL(u, API).toString(), o),
  },
  fetch: (u, o) => fetch(new URL(u, API).toString(), o),
  setTimeout, clearTimeout, confirm: () => true, alert(){},
  Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error,
  parseInt, isNaN, encodeURIComponent, decodeURIComponent,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(app, sandbox, { timeout: 30000 });
const run = (e) => vm.runInContext(e, sandbox, { timeout: 30000 });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (n, c, d) => { if (c) { console.log('  PASS ' + n); pass++; }
  else { console.log('  FAIL ' + n + (d ? '  — ' + d : '')); fail++; } };

(async () => {
  const listBefore = await (await fetch(API + '/list?path=' +
    encodeURIComponent('ingestion/unprocessed'))).json();
  const before = new Set(listBefore.map(f => f.name));

  // 1. stage only
  run("_desk = { content: 'a staged thought for f18', type: 'unordered', lens: null, fileLoaded: null }");
  run('_deskPrivate = false');
  await run('deskStageOnly()');
  await sleep(600);

  // deskStageOnly() names with autoName(), which is deliberately random — so
  // identify the new file by the queue growing, not by a predictable name.
  const list = await (await fetch(API + '/list?path=' +
    encodeURIComponent('ingestion/unprocessed'))).json();
  const added = list.find(f => !before.has(f.name));
  check('deskStageOnly() added exactly one artifact to the queue', !!added,
        'queue: ' + list.map(f => f.name).join(', '));
  if (!added) { console.log(`\n${pass}/${pass + fail} checks passed`); process.exit(1); }

  const name = added.name;
  const qPath = added.path;
  check('staged file lives in ingestion/unprocessed/',
        qPath.startsWith('ingestion/unprocessed/'), qPath);

  // A public stage also makes a source copy (immutable, by design).
  const srcPath = 'source/unordereds/' + name;
  const srcRes = await fetch(API + '/file?path=' + encodeURIComponent(srcPath));
  check('staged artifact has a source mirror', srcRes.status === 200,
        'src ' + srcPath + ' -> ' + srcRes.status);

  // 2. the desk lists the queue
  byId['content-area'] = new El('content-area');
  byId['badge-hyp'] = new El('badge-hyp');
  byId['badge-req'] = new El('badge-req');
  byId['badge-rat'] = new El('badge-rat');
  await run('renderDesk(document.getElementById("content-area"))');
  const html = byId['content-area'].innerHTML;
  check('desk renders an "In the queue" card', /In the queue/.test(html));
  check('desk lists the staged artifact', html.includes(name.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '')),
        html.slice(0, 200));
  check('queue rows offer Load', /_deskLoadQueued/.test(html));
  check('queue rows offer Discard', /_deskDiscardQueued/.test(html));
  check('stage-only door is present', /deskStageOnly\(\)/.test(html));
  check('lens doors still present', /deskLensDoor\('requirements'\)/.test(html));

  // 3. load it back
  await run(`_deskLoadQueued(${JSON.stringify(qPath)})`);
  await sleep(500);
  const loaded = run('_desk.content');
  // A queued artifact is a full ingest document — frontmatter, provenance
  // header, and the trailing annotation sections. The desk wants the raw
  // thought back, not the wrapper, or re-submitting would double-wrap it.
  // parseIngestBody() must unwrap it.
  check('load restores the raw thought, not the ingest wrapper',
        loaded === 'a staged thought for f18', JSON.stringify(loaded).slice(0, 120));
  check('loaded content carries no frontmatter',
        !/^\*\*(Type|Date|Private|Provenance|Status):\*\*/m.test(String(loaded)));
  check('loaded content carries no annotation sections',
        !/##\s*(Observations|Interpretations|Hypotheses|Assumptions)/.test(String(loaded)));

  // 4. discard (and report the source copy honestly)
  await run(`_deskDiscardQueued(${JSON.stringify(qPath)})`);
  await sleep(500);
  const after = await (await fetch(API + '/list?path=' +
    encodeURIComponent('ingestion/unprocessed'))).json();
  check('discard removed it from the queue',
        !after.some(f => f.name === name), 'still there');
  const srcAfter = await fetch(API + '/file?path=' + encodeURIComponent(srcPath));
  check('source copy is retained (DELETE cannot reach source/)',
        srcAfter.status === 200, 'got ' + srcAfter.status);

  // cleanup the source copy the suite itself created
  const { execSync } = require('child_process');
  try { execSync(`rm -f /home/sblanken/workspace/Prism/prism/vault/${srcPath}`); } catch (e) {}

  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
})();
