// Prism F5 regression test — global search & keyboard navigation.
//
// Exercises search through the REAL backend (Apache -> api-server):
//   - GET /search: AND semantics, filename/frontmatter/content scoring,
//     snippets, scope filter, empty-query behaviour
//   - machinery exclusion: _templates and session sidecars never surface
//   - Ctrl+K palette: debounce, live results, arrow-key navigation,
//     Enter opens, Esc closes, stale-query race guard
//   - routing: lens hits open in their own view panel; generic vault
//     files land in the knowledge viewer with a retitled topbar (GN-009)
//
// Prereqs: python3 prism/api-server.py on :8082, Apache serving /prism/.
// Usage: node scripts/e2e-verify-f5.js   (exit 0 = all checks pass)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(process.cwd(), 'prism/index.html'), 'utf8');
const script = fs.readFileSync(path.join(process.cwd(), 'prism/app.js'), 'utf8');

class El {
  constructor(id) {
    this.id = id || '';
    this.innerHTML = ''; this.textContent = ''; this.value = '';
    this.style = {}; this.classList = { add(){}, remove(){}, toggle(){} };
    this.scrollTop = 0; this.scrollHeight = 0;
  }
  addEventListener() {} appendChild(c) { return c; }
  setAttribute() {} getAttribute() { return ''; }
  focus() {} select() {} click() {} querySelector() { return new El(); }
  querySelectorAll() { return []; } remove() {}
}
const byId = {};
const docHandlers = [];
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  Promise, JSON, Math, Date, RegExp, URL, URLSearchParams,
  encodeURIComponent, decodeURIComponent, Object, Array, String, Number, Boolean,
  Error, TypeError, RangeError, Symbol, Map, Set,
  document: {
    getElementById: id => byId[id] || (byId[id] = new El(id)),
    createElement: t => new El(t),
    addEventListener: (t, fn) => docHandlers.push([t, fn]),
    querySelector: () => null,
    querySelectorAll: () => [],
    body: new El('body'),
  },
  window: { addEventListener() {}, location: { href: 'http://localhost/prism' } },
  navigator: { clipboard: {}, userAgent: 'node-f5' },
  localStorage: { getItem: () => null, setItem(){}, removeItem(){} },
  fetch: (u, o) => fetch('http://localhost' + u, o),
  requestAnimationFrame: f => setTimeout(f, 0),
  FileReader: class { readAsText(){} }, Blob: class {},
};
sandbox.window = Object.assign(sandbox.window, sandbox);

// Spies must survive the script's own top-level `function` declarations,
// which write over sandbox properties unless they are non-writable.
const installSpy = (name, fn) => Object.defineProperty(sandbox, name, {
  value: fn, writable: false, configurable: true,
});
installSpy('renderView', async v => { sandbox.__lastView = v; });
installSpy('openReqInPanel', p => { sandbox.__opened = ['requirements', p]; });
installSpy('openFile', (p, cid) => { sandbox.__opened = ['openFile', p, cid]; });

vm.createContext(sandbox);
const run = (expr, t = 10000) => vm.runInContext(expr, sandbox, { timeout: t });

const results = [];
const check = (name, cond) => { results.push([name, !!cond]); if (!cond) console.log('FAIL at:', name); };
const api = (path, opts) => fetch('http://localhost' + path, opts).then(r => r.json());
const apiPost = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const TOKEN = 'f5xqz' + Date.now().toString(36);   // unique, cannot collide with real vault text
const TOKEN2 = 'auxword' + Date.now().toString(36);
const REQ = `requirements/2026-08-24-f5test-${TOKEN}.md`;
const TMPL = `requirements/_f5test-${TOKEN}.md`;   // underscore-prefixed: must be excluded
// Generic (non-lens) hit lives in ingestion/unprocessed — exercises the same
// fallback routing as emissions/prompts, and is deletable via the API.
const EMI = `ingestion/unprocessed/2026-08-24-f5test-${TOKEN}.md`;

(async () => {
  vm.runInContext(script, sandbox, { timeout: 10000 });
  await sleep(800);   // let the boot IIFE settle (renderView is already spied)

  // ── Seed real searchable content through the real API ────────────────────
  const reqDoc = `**Name:** f5-test-req\n**Status:** draft\n\n---\n\nThe ${TOKEN} capability ships with ${TOKEN2} support.`;
  const emiDoc = `**Name:** f5-test-generic\n\n---\n\nRaw artifact carrying ${TOKEN} forward.`;
  const pauseDoc = `sidecar holding ${TOKEN} must stay hidden`;
  const tmplDoc = `template holding ${TOKEN} must stay hidden`;
  await apiPost('/prism/api/file', { path: REQ, content: reqDoc });
  await apiPost('/prism/api/file', { path: EMI, content: emiDoc });
  await apiPost('/prism/api/file', { path: REQ.replace(/\.md$/, '-pause.md'), content: pauseDoc });
  await apiPost('/prism/api/file', { path: TMPL, content: tmplDoc });

  // ── 1) Backend: /search contract ─────────────────────────────────────────
  check('search functions exist in UI',
    run('typeof openSearchPalette') === 'function' &&
    run('typeof _searchOnKeydown') === 'function' &&
    run('typeof _searchOpen') === 'function' &&
    run('typeof gotoView') === 'function');

  let d = await api('/prism/api/search?q=' + TOKEN);
  check('finds seeded files by unique token', d.count >= 2);
  const reqHit = (d.results || []).find(r => r.path === REQ);
  const emiHit = (d.results || []).find(r => r.path === EMI);
  check('requirement hit has path/score/snippet', !!(reqHit && reqHit.score > 0 && typeof reqHit.snippet === 'string'));
  check('snippet contains the searched token', reqHit && reqHit.snippet.includes(TOKEN));
  check('emission hit found too', !!emiHit);
  check('no sidecar leak', !(d.results || []).some(r => r.path.endsWith('-pause.md')));
  check('no template leak', !(d.results || []).some(r => r.path === TMPL));

  d = await api(`/prism/api/search?q=${TOKEN}+${TOKEN2}`);
  check('AND semantics: both terms required', d.count === 1 && d.results[0].path === REQ);

  d = await api('/prism/api/search?q=' + TOKEN + '&scope=requirements');
  check('scope filter limits to one folder', d.count === 1 && d.results[0].folder === 'requirements');

  d = await api('/prism/api/search?q=zzz-no-such-term-zzz');
  check('nonsense query returns zero', d.count === 0);
  d = await api('/prism/api/search?q=');
  check('empty query returns zero', d.count === 0);

  // ── 2) Palette open / close / hint ───────────────────────────────────────
  run('openSearchPalette()');
  check('overlay shown on open', byId['search-overlay'].style.display === 'flex');
  check('palette state flag', run('_search.open') === true);
  check('hint rendered before typing', String(byId['search-results'].innerHTML).includes('Type to search'));

  run('closeSearchPalette()');
  check('overlay hidden on close', byId['search-overlay'].style.display === 'none');

  // ── 3) Ctrl+K global handler ─────────────────────────────────────────────
  const ctrlK = docHandlers.find(([t]) => t === 'keydown');
  check('global keydown handler registered', !!ctrlK);
  ctrlK[1]({ ctrlKey: true, metaKey: false, key: 'k', preventDefault(){} });
  check('Ctrl+K opens palette', byId['search-overlay'].style.display === 'flex' && run('_search.open') === true);

  // ── 4) Live search: debounce → results ───────────────────────────────────
  byId['search-input'].value = TOKEN;
  run('_searchOnInput()');
  await sleep(450);  // 150ms debounce + real HTTP round trip
  const hitsHtml = String(byId['search-results'].innerHTML);
  check('debounced query renders hits', hitsHtml.includes('search-hit'));
  check('hit list matches API count', (hitsHtml.match(/class="search-hit/g) || []).length >= 2);
  check('hit shows vault path', hitsHtml.includes(REQ));
  check('term highlighted with <mark>', hitsHtml.includes('<mark>'));

  // stale-query race guard: a late response for an old query must be dropped
  const before = String(byId['search-results'].innerHTML);
  byId['search-input'].value = 'something else entirely';
  await run(`_searchRunQuery(${JSON.stringify(TOKEN)})`);
  check('stale query result dropped', String(byId['search-results'].innerHTML) === before);
  byId['search-input'].value = TOKEN;

  // ── 5) Keyboard navigation ───────────────────────────────────────────────
  run('_searchRenderHits(' + JSON.stringify(TOKEN) + ')');
  await sleep(450); // re-render from live results happens inside renderHits synchronously
  check('selection starts at first hit', run('_search.sel') === 0);
  run('_searchOnKeydown({ key: "ArrowDown", preventDefault(){} })');
  check('ArrowDown advances selection', run('_search.sel') === 1);
  run('_searchOnKeydown({ key: "ArrowDown", preventDefault(){} })');
  check('ArrowUp retreats selection', (run('_searchOnKeydown({ key: "ArrowUp", preventDefault(){} })'), run('_search.sel')) === 1);

  // ── 6) Enter routes a LENS hit to its own surface ────────────────────────
  // Select the requirement hit explicitly, spy its panel opener.
  const idx = run(`(() => { const i = _search.results.findIndex(r => r.path === ${JSON.stringify(REQ)}); _search.sel = i; return i; })()`);
  check('requirement hit present in palette results', idx >= 0);
  sandbox.__opened = null;
  sandbox.openReqInPanel = p => { sandbox.__opened = ['requirements', p]; };
  await run(`_searchOpen(${idx})`);
  check('palette closed after open', byId['search-overlay'].style.display === 'none');
  check('gotoView routed to requirements view', sandbox.__lastView === 'requirements');
  check('lens panel opener called with hit path',
    sandbox.__opened && sandbox.__opened[0] === 'requirements' && sandbox.__opened[1] === REQ);
  check('topbar titled for requirements', String(byId['topbar-title'].textContent) === 'Requirements');

  // ── 7) Enter routes a GENERIC hit to the knowledge viewer ────────────────
  run('openSearchPalette()');
  byId['search-input'].value = TOKEN;
  run('_searchOnInput()');
  await sleep(450);
  const eIdx = run(`(() => { const i = _search.results.findIndex(r => r.path === ${JSON.stringify(EMI)}); _search.sel = i; return i; })()`);
  check('emission hit present in palette results', eIdx >= 0);
  sandbox.__opened = null;
  sandbox.openFile = (p, cid) => { sandbox.__opened = ['openFile', p, cid]; };
  await run(`_searchOpen(${eIdx})`);
  check('generic hit routed to knowledge view', sandbox.__lastView === 'knowledge');
  check('generic hit opened in knowledge viewer panel',
    sandbox.__opened && sandbox.__opened[1] === EMI && sandbox.__opened[2] === 'knowledge-content');
  check('topbar retitled to file home (GN-009)', String(byId['topbar-title'].textContent) === 'Ingestion');

  // ── 8) Esc closes from the input ─────────────────────────────────────────
  run('_searchOnKeydown({ key: "Escape", preventDefault(){} })');
  check('Escape closes palette', byId['search-overlay'].style.display === 'none');

  // ── 9) Highlighting never injects raw HTML ───────────────────────────────
  const hl = run(`_searchHighlight('<script>alert(1)</scr'+'ipt>', ['<script>'])`);
  check('highlight escapes HTML in results', !hl.includes('<script>') && hl.includes('&lt;'));

  // ── Cleanup seeded files ─────────────────────────────────────────────────
  for (const p of [REQ, EMI, REQ.replace(/\.md$/, '-pause.md'), TMPL]) {
    await fetch('http://localhost/prism/api/file?path=' + encodeURIComponent(p), { method: 'DELETE' });
  }

  const pass = results.filter(r => r[1]).length;
  console.log(results.map(([n, ok]) => (ok ? 'PASS ' : 'FAIL ') + n).join('\n'));
  console.log(`\n${pass}/${results.length} checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
