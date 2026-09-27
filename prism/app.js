const API = '/prism/api';
let _status = null;
let _currentFile = null;
let _editMode = false;

// ── Markdown rendering (F14) ───────────────────────────────────────────────
// marked v15 does not sanitize: raw HTML in a vault file is passed through
// verbatim, and `javascript:` URLs survive into an href. Both outputs land in
// innerHTML, so a vault file carrying `<img src=x onerror=…>` would execute in
// the Prism origin. Today the vault is not a trust boundary — the only writer
// is the human and their own agent, and the F12 same-origin guard stops any
// web page from writing at all — but that is a property of who writes today,
// not of the renderer, and it stops being true the moment a shared or
// third-party document lands in the vault.
//
// Rather than pull in a sanitizer dependency (which would reopen the "one
// vendored library" position F13 just settled), harden marked's own extension
// point. Two rules, applied through the renderer:
//
//   1. Raw HTML is dropped, not escaped. Vault markdown is written in
//      markdown; anything else is either noise or an injection attempt.
//   2. Link schemes are restricted. An href may be http(s), protocol-relative,
//      or site-relative (leading /, # or ?) — all of which stay inside Prism's
//      own origin. Anything with an explicit scheme that is not http(s)
//      (javascript:, data:, vbscript:, file:) renders as plain text, so the
//      words survive but the navigation does not.
//
// Measured blast radius across all 49 vault files: 8 render differently, and
// every one only loses an invisible HTML comment. No vault file relies on
// raw HTML. See scripts/e2e-verify-f16.js, which locks that baseline down.
const _SAFE_SCHEME = /^(https?:)?\/\/|^[/#?]/i;

function _mdRenderer() {
  return {
    // Inline and block HTML both route here; drop the token entirely.
    html() { return ''; },
    link(token) {
      const href = (token && (token.href
        || (token.tokens && token.tokens[0] && token.tokens[0].href))) || '';
      const text = marked.Parser.parseInline(token.tokens);
      return _SAFE_SCHEME.test(href)
        ? `<a href="${escHtml(href)}">${text}</a>`
        : `<span class="md-link-blocked" title="blocked link scheme">${text}</span>`;
    },
  };
}

let _mdReady = false;
function renderMarkdown(md) {
  if (!_mdReady && window.marked) {
    window.marked.use({ renderer: _mdRenderer() });
    _mdReady = true;
  }
  return window.marked.parse(md || '');
}

// ── API helpers ────────────────────────────────────────────────────────────

async function apiFetch(path, opts = {}) {
  const res = await fetch(API + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function apiGet(path) { return apiFetch(path); }

async function apiPost(path, body) {
  return apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

// ── Toast ──────────────────────────────────────────────────────────────────

function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show' + (isError ? ' error' : '');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.className = '', 2800);
}

// ── Navigation ─────────────────────────────────────────────────────────────

const VIEW_TITLES = {
  dashboard: 'Crafting Table',
  knowledge: 'Knowledge Base', workflows: 'Workflows', hypotheses: 'Hypotheses',
  requirements: 'Requirements',
  rationalizations: 'Rationalizations',
  'workflow-chat': 'Workflow', editor: 'Editor'
};

function nav(el, view) {
  view = view || (el && el.dataset.view);
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const target = (el && el.closest) ? el : document.querySelector(`[data-view="${view}"]`);
  if (target) target.classList.add('active');
  document.getElementById('topbar-title').textContent = VIEW_TITLES[view] || view;
  document.getElementById('topbar-actions').innerHTML = '';
  renderView(view);
}

// Awaitable nav — search results must not race the view render (F5).
async function gotoView(view) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const target = document.querySelector(`[data-view="${view}"]`);
  if (target) target.classList.add('active');
  document.getElementById('topbar-title').textContent = VIEW_TITLES[view] || view;
  document.getElementById('topbar-actions').innerHTML = '';
  await renderView(view);
}

// ── F5: Global search (Ctrl+K) ─────────────────────────────────────────────
// Findability is the dominant friction as lenses and emissions accumulate.
// One palette over the whole vault; every hit routes to its own surface.

const _SEARCH_ROUTE = {
  hypotheses:       { icon: '🔬', view: 'hypotheses',       open: p => openHypInPanel(p) },
  requirements:     { icon: '📋', view: 'requirements',     open: p => openReqInPanel(p) },
  rationalizations: { icon: '🧩', view: 'rationalizations', open: p => openRatInPanel(p) },
  workflows:        { icon: '⚙️', view: 'workflows',        open: p => openWorkflowFile(p) },
  knowledge:        { icon: '📚', view: 'knowledge',        open: p => openFile(p, 'knowledge-content') },
};
const _SEARCH_FALLBACK = { icon: '📄', view: 'knowledge', open: p => openFile(p, 'knowledge-content') };
const _SEARCH_ICONS = { emissions: '⬡', prompts: '📝', ingestion: '📂', decisions: '🧭',
  archive: '🗄', experiments: '🧪', maintenance: '🔧', source: '📦', stakeholders: '👥' };

let _search = { results: [], sel: 0, timer: null, open: false };

function openSearchPalette() {
  const overlay = document.getElementById('search-overlay');
  overlay.style.display = 'flex';
  _search.open = true;
  _search.sel = 0;
  const input = document.getElementById('search-input');
  input.value = '';
  _searchRenderHint();
  input.focus();
}

function closeSearchPalette() {
  document.getElementById('search-overlay').style.display = 'none';
  _search.open = false;
  _search.results = [];
  _search.sel = 0;
}

function _searchOnInput() {
  clearTimeout(_search.timer);
  const q = document.getElementById('search-input').value.trim();
  if (!q) { _search.results = []; _search.sel = 0; _searchRenderHint(); return; }
  _search.timer = setTimeout(() => _searchRunQuery(q), 150);
}

async function _searchRunQuery(q) {
  try {
    const data = await apiGet(`/search?q=${encodeURIComponent(q)}`);
    // Debounce race: a newer query may have replaced us
    if (document.getElementById('search-input').value.trim() !== q) return;
    _search.results = data.results || [];
    _search.sel = 0;
    _searchRenderHits(q);
  } catch (e) {
    document.getElementById('search-results').innerHTML =
      `<div class="search-empty">⚠️ ${escHtml(e.message)}</div>`;
  }
}

function _searchRenderHint() {
  document.getElementById('search-results').innerHTML =
    `<div class="search-empty">Type to search lens files, knowledge, workflows, prompts, and emissions.</div>`;
}

function _searchHighlight(text, terms) {
  let out = escHtml(text);
  for (const t of terms) {
    const safe = escHtml(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!safe) continue;
    try { out = out.replace(new RegExp(safe, 'gi'), m => `<mark>${m}</mark>`); } catch (e) {}
  }
  return out;
}

function _searchRenderHits(q) {
  const box = document.getElementById('search-results');
  if (!_search.results.length) {
    box.innerHTML = `<div class="search-empty">No matches for “${escHtml(q)}” in the vault.</div>`;
    return;
  }
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  box.innerHTML = _search.results.map((r, i) => {
    const route = _SEARCH_ROUTE[r.folder] || _SEARCH_FALLBACK;
    const icon = _SEARCH_ROUTE[r.folder] ? route.icon : (_SEARCH_ICONS[r.folder] || route.icon);
    const title = r.name.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/-/g, ' ');
    return `<div class="search-hit${i === _search.sel ? ' sel' : ''}" data-idx="${i}"
        onclick="_searchOpen(${i})" onmousemove="_searchHover(${i})">
      <span class="sh-icon">${icon}</span>
      <div class="sh-body">
        <div class="sh-title">${_searchHighlight(title, terms)}</div>
        <div class="sh-meta">${escHtml(r.path)}</div>
        ${r.snippet ? `<div class="sh-snippet">${_searchHighlight(r.snippet, terms)}</div>` : ''}
      </div>
      ${r.status ? `<span class="sh-status badge-status badge-${escHtml(r.status)}">${escHtml(r.status)}</span>` : ''}
    </div>`;
  }).join('');
}

function _searchHover(i) {
  if (_search.sel === i) return;
  _search.sel = i;
  document.querySelectorAll('.search-hit').forEach((el, j) =>
    el.classList[j === i ? 'add' : 'remove']('sel'));
}

function _searchOnKeydown(e) {
  if (e.key === 'Escape') { e.preventDefault(); closeSearchPalette(); return; }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (_search.results.length) _searchHover((_search.sel + 1) % _search.results.length);
    return;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (_search.results.length) _searchHover((_search.sel - 1 + _search.results.length) % _search.results.length);
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    if (_search.results.length) _searchOpen(_search.sel);
    return;
  }
}

async function _searchOpen(idx) {
  const hit = _search.results[idx];
  if (!hit) return;
  closeSearchPalette();
  const route = _SEARCH_ROUTE[hit.folder] || _SEARCH_FALLBACK;
  await gotoView(route.view);
  await route.open(hit.path);
  // Generic files (emissions, prompts, ingestion…) land in the knowledge
  // viewer — retitle the topbar to the file's real home (GN-009).
  if (!_SEARCH_ROUTE[hit.folder]) {
    const label = hit.folder.charAt(0).toUpperCase() + hit.folder.slice(1);
    document.getElementById('topbar-title').textContent = label;
  }
}

// Global keyboard entry point: Ctrl+K / Cmd+K opens the palette from
// anywhere, unless the user is already typing somewhere.
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    if (_search.open) { document.getElementById('search-input').focus(); }
    else openSearchPalette();
  }
});

// ── Views ──────────────────────────────────────────────────────────────────

async function renderView(view) {
  const area = document.getElementById('content-area');
  area.innerHTML = '<div class="loading-block"><div class="spinner"></div></div>';

  try {
    if (view === 'dashboard')    await renderDashboard(area);
    else if (view === 'knowledge')    await renderKnowledge(area);
    else if (view === 'workflows')    await renderWorkflows(area);
    else if (view === 'hypotheses')       await renderHypotheses(area);
    else if (view === 'requirements')     await renderRequirements(area);
    else if (view === 'rationalizations') await renderRationalizations(area);
    else if (view === 'workflow-chat')    renderWorkflowChat(area);
    else area.innerHTML = `<div class="empty-state"><p>View not found.</p></div>`;
  } catch (e) {
    area.innerHTML = `<div class="card" style="color:#dc2626">⚠️ ${e.message}</div>`;
  }
}

// ── Crafting Table: the Refraction Desk (F7 redesign) ─────────────────────
// One input surface — "bring fog, get focus." Not a status board.
// Renamed from "Front Door" 25 Aug 2026: it sits under Workflows, below
// Thought Lenses — users use lenses far more often than they craft them.

let _desk = { content: '', type: 'unordered', lens: null, fileLoaded: null };

async function renderDashboard(area) {
  await renderDesk(area);
}

async function renderDesk(area) {
  // One call for the whole desk: items, badges, paused sessions (GET /lenses
  // replaces the old /status + 3×/list fan-out).
  let lensData = { lenses: {}, paused: [], counts: {}, badges: {} };
  try { lensData = await apiGet('/lenses'); } catch (e) {}
  _status = lensData;
  updateBadges(lensData);

  // Paused sessions to resume (machine prepares; human steers — GN-009)
  let pausedRows = '';
  const pauses = lensData.paused || [];
  if (pauses.length) {
    pausedRows = `
      <div class="card" style="margin-top:20px">
        <div class="section-header" style="margin-bottom:10px">
          <h3 style="font-size:14px">Paused sessions</h3>
          <span style="font-size:12px;color:var(--text-secondary)">pick up where you left off</span>
        </div>
        ${pauses.map(p => {
          const label = p.name.split('/').pop().replace('.md','').replace(/^\d{4}-\d{2}-\d{2}-/,'').replace(/-/g,' ');
          return `<div class="desk-continue-row">
            <span class="desk-pause-tag">⏸ paused</span>
            <span style="flex:1;font-size:13.5px;font-weight:600">${escHtml(label)}</span>
            <button class="desk-door" onclick="continueWorkflow('${escHtml(p.path)}','${p.lens}','desk-content')">Resume →</button>
          </div>`;
        }).join('')}
      </div>`;
  }

  // The staged queue. Until now ingestion/unprocessed/ was write-only: the
  // Ingest page could fill it and the retired wizard was the only thing that
  // could read it. With both gone, the desk lists it here — otherwise staging
  // is a place raw thought goes to be lost.
  let queuedRows = '';
  let queued = [];
  try {
    const list = await apiGet('/list?path=' + encodeURIComponent('ingestion/unprocessed'));
    queued = (list || []).filter(f => f.type === 'file' && f.name.endsWith('.md')
                                     && !f.name.startsWith('_'));
  } catch (e) { /* queue is local and may not exist yet — not an error */ }

  if (queued.length) {
    queuedRows = `
      <div class="card" style="margin-top:20px">
        <div class="section-header" style="margin-bottom:10px">
          <h3 style="font-size:14px">In the queue</h3>
          <span style="font-size:12px;color:var(--text-secondary)">
            ${queued.length} staged · local only, never synced
          </span>
        </div>
        ${queued.map(f => {
          const label = f.name.replace('.md','').replace(/^\d{4}-\d{2}-\d{2}-/,'').replace(/-/g,' ');
          return `<div class="desk-continue-row">
            <span style="flex:1;font-size:13.5px">${escHtml(label)}</span>
            <button class="btn btn-ghost btn-sm" onclick="_deskLoadQueued('${escHtml(f.path)}')">Load →</button>
            <button class="btn btn-ghost btn-sm" onclick="_deskDiscardQueued('${escHtml(f.path)}')"
              title="Delete from the queue">🗑</button>
          </div>`;
        }).join('')}
      </div>`;
  }

  const lensDoors = [
    { key: 'requirements',     icon: '📋', label: 'Requirement',     hint: 'capability → developer-ready PRD' },
    { key: 'hypotheses',       icon: '🔬', label: 'Hypothesis',      hint: 'a belief worth testing' },
    { key: 'rationalizations', icon: '🧩', label: 'Rationalization', hint: 'post-hoc account, structured' },
  ].map(d => `
    <button class="desk-door" data-lens="${d.key}" onclick="deskLensDoor('${d.key}')"
      style="flex-direction:column;align-items:flex-start;gap:2px;min-width:170px;text-align:left">
      <span style="font-weight:600">${d.icon} ${d.label}</span>
      <span style="font-size:11.5px;color:var(--text-secondary);font-weight:400">${d.hint}</span>
    </button>`).join('');

  area.innerHTML = `
    <div style="max-width:720px">
      <div style="margin-bottom:18px">
        <h2 style="font-size:20px;font-weight:700;margin-bottom:4px">Bring fog. Get focus.</h2>
        <p style="font-size:13.5px;color:var(--text-secondary);margin:0">
          Drop in raw thought — a brain dump, a transcript, a half-formed idea.
          Prism refracts it into focused, agent-ready context.
        </p>
      </div>

      <div class="card">
        <textarea class="desk-textarea" id="desk-content"
          placeholder="Paste or type the raw thought here. Fog included — that's the point…"
          oninput="_desk.content = this.value">${escHtml(_desk.content)}</textarea>

        <div class="desk-drop" id="desk-drop" onclick="document.getElementById('desk-file').click()">
          <input type="file" id="desk-file" accept=".md,.txt,.csv,.json,.rtf"
            style="display:none" onchange="deskFileSelect(this.files)">
          <span id="desk-drop-label">📂 or drop / browse a file instead</span>
        </div>

        <details style="margin-top:14px">
          <summary class="form-label" style="font-size:12px;cursor:pointer">Input shape (auto-detected from the text — adjust if Prism guessed wrong)</summary>
          <select class="form-select" id="desk-type" onchange="_desk.type = this.value" style="max-width:320px;margin-top:8px">
            <option value="unordered">📝 Unordered text / brain dump</option>
            <option value="formatted">📄 Formatted or ordered text</option>
            <option value="dictation">🎤 Dictation / transcript</option>
            <option value="media">🎬 Media</option>
            <option value="code">💻 Code</option>
          </select>
        </details>
        <div id="desk-type-hint" style="font-size:11.5px;color:var(--text-secondary);margin-top:6px"></div>

        <label style="display:flex;align-items:center;gap:8px;margin-top:12px;cursor:pointer;font-size:12.5px;color:var(--text-secondary);user-select:none">
          <input type="checkbox" id="desk-private" onchange="_deskPrivate = this.checked"
            style="width:auto;accent-color:#f59e0b">
          🔒 Private — exclude from source copies and repo pushes
        </label>

        <div class="form-label" style="margin-top:18px;margin-bottom:8px">Route it through a lens:</div>
        <div class="desk-doors" id="desk-doors">${lensDoors}</div>

        <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border)">
          <button class="btn btn-ghost btn-sm" onclick="deskStageOnly()"
            title="Save to the unprocessed queue without creating a lens — refract it later">
            📥 Not yet — just hold it in the queue
          </button>
          <div style="font-size:11.5px;color:var(--text-secondary);margin-top:5px">
            Raw thought can arrive faster than you can lens it. Staging keeps it local
            (<code>ingestion/unprocessed/</code>, never synced) until you are ready.
          </div>
        </div>
        <div id="desk-error" style="color:#dc2626;font-size:13px;margin-top:10px"></div>
      </div>

      ${queuedRows}
      ${pausedRows}
    </div>`;

  const zone = document.getElementById('desk-drop');
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag-over'); deskFileSelect(e.dataTransfer.files);
  });

  // F10: auto-classify desk input as it is typed or file-loaded.
  _classifySurfaces.desk = {
    selectId: 'desk-type', contentId: 'desk-content', hintId: 'desk-type-hint',
    filename: _desk.fileLoaded || '', seq: 0, touched: false, timer: null, lastKey: null,
    onClassified: v => { _desk.type = v; },
  };
  _classifyWire(_classifySurfaces.desk);
}

function deskFileSelect(files) {
  if (!files?.length) return;
  readTextFile(files[0], (content, file) => {
    _desk.content = content;
    _desk.fileLoaded = file.name;
    document.getElementById('desk-content').value = content;
    document.getElementById('desk-drop-label').textContent = '✅ ' + file.name + ' loaded';
    // F10: infer the type from filename + content. Sticky human override.
    const surface = _classifySurfaces.desk;
    if (surface) { surface.filename = file.name; _classifyTrigger(surface); }
  });
}

function deskLensDoor(lensKey) {
  // A door is an action: pick the lens, go (one click, no start button).
  _desk.lens = lensKey;
  deskSubmit();
}

// ── Staged queue ───────────────────────────────────────────────────────────
// Load a staged artifact back into the desk so it can be lensed, or discard it.
// These live on the desk because the Ingest page (the only other surface) is
// retired, and the wizard that used to read the queue is gone — without these
// the queue is write-only and staged thought is lost.

// Unwrap a staged ingest document back to the raw thought. A queued artifact
// is a full ingest file:
//
//     # title
//     **Type:** … **Date:** … **Private:** … **Provenance:** … **Status:** …
//     ---            <- opening divider, after the provenance header
//     <raw thought>
//     ---            <- closing divider
//     ## Observations   (empty annotation stubs)
//
// The raw thought is BETWEEN the two dividers, so take the text after the
// FIRST divider and stop at the next one. Feeding the whole wrapper back into
// the desk would double-wrap it on re-submit. This mirrors what the backend
// does when scaffolding a lens from an artifact.
function _rawIngestBody(content) {
  const lines = String(content || '').split('\n');
  const open = lines.findIndex(l => l.trim() === '---');
  if (open < 0) return String(content || '');   // not a wrapper — take it as-is
  const close = lines.findIndex((l, i) => i > open && l.trim() === '---');
  const body = close < 0 ? lines.slice(open + 1) : lines.slice(open + 1, close);
  return body.join('\n').trim();
}

async function _deskLoadQueued(path) {
  try {
    const { content } = await apiGet('/file?path=' + encodeURIComponent(path));
    const raw = _rawIngestBody(content);
    const name = path.split('/').pop().replace(/^\d{4}-\d{2}-\d{2}-/,'').replace(/\.md$/,'');
    _desk = { content: raw, type: 'unordered', lens: null, fileLoaded: name };
    document.getElementById('topbar-title').textContent = 'Crafting Table';
    await renderDesk(document.getElementById('content-area'));
    toast('📥 Loaded — pick a lens to refract it, or stage it again');
  } catch (e) {
    toast('Could not load that artifact: ' + e.message, true);
  }
}

async function _deskDiscardQueued(path) {
  const name = path.split('/').pop();
  if (!confirm(`Discard "${name.replace(/^\d{4}-\d{2}-\d{2}-/,'').replace(/\.md$/,'')}" from the queue?\n\nThis cannot be undone.`)) return;
  try {
    await apiFetch('/file?path=' + encodeURIComponent(path), { method: 'DELETE' });
    // A private artifact was never mirrored into source/, so nothing else to
    // clean up. A public one has an immutable source copy that DELETE cannot
    // reach — say so rather than pretending the delete was total.
    toast('🗑 Discarded from the queue' + (name.includes('-private') ? '' : ' (source copy retained)'));
    await renderDesk(document.getElementById('content-area'));
  } catch (e) {
    toast('Could not discard: ' + e.message, true);
  }
}

async function deskStageOnly() {
  // Ingest without processing. The Ingest page used to be the only way to
  // stop here; it is retired, so the desk owns this. Useful when raw thought
  // arrives faster than it can be lensed — hold it, refract it later.
  const errEl = document.getElementById('desk-error');
  const content = _desk.content.trim();
  errEl.textContent = '';
  if (!content) { errEl.textContent = 'Add the raw thought first — even staged, it needs to be something.'; return; }

  try {
    await ingestArtifact({
      type: _desk.type,
      title: autoName('seed'),
      content,
      is_private: _deskPrivate,
    });
  } catch (e) { errEl.textContent = e.message; return; }

  _desk = { content: '', type: 'unordered', lens: null, fileLoaded: null };
  _deskPrivate = false;
  toast('📥 Staged in the queue — refract it when you are ready');
  await renderDesk(document.getElementById('content-area'));
}

async function deskSubmit() {
  const cfg = LENS_CONFIGS[_desk.lens];
  const errEl = document.getElementById('desk-error');
  const content = _desk.content.trim();
  errEl.textContent = '';
  if (!content) { errEl.textContent = 'Add the raw thought first — the lens needs light to refract.'; return; }

  const lensKey = _desk.lens;
  const ingType = _desk.type;

  // 1. Ingest the fog into the unprocessed queue — through the ONE shared
  //    path (F9), with the desk's own visible private decision.
  let ing;
  try {
    ing = await ingestArtifact({
      type: ingType,
      title: autoName(cfg.seedWord),
      content,
      is_private: _deskPrivate,
    });
  } catch (e) { errEl.textContent = e.message; return; }

  // 2. Create the lens item from the ingested artifact
  let r;
  try {
    r = await apiPost(cfg.endpoint, { title: autoName(cfg.seedWord), artifact_path: ing.path });
  } catch (e) { errEl.textContent = e.message; return; }
  if (!r.ok) { errEl.textContent = r.message || 'Could not create the lens item.'; return; }

  // 3. Clear the desk and launch straight into the workflow chat (no wizard)
  const lensPath = r.path;
  const lensTitle = lensPath.split('/').pop().replace('.md','').replace(/^\d{4}-\d{2}-\d{2}-/,'');
  _desk = { content: '', type: 'unordered', lens: null, fileLoaded: null };
  _deskPrivate = false;   // F9: private decision resets with the desk
  toast('✅ ' + cfg.noun + ' created');
  renderWorkflowChat(document.getElementById('content-area'), {
    title:         cfg.noun + ' Workflow',
    workflowId:    cfg.defaultWorkflow || 'ad-hoc',
    lensKey:       lensKey,
    artifactPath:  lensPath,
    gibberishPath: ing.path,
    artifactTitle: lensTitle,
    subAssets:     [],
    agentGreeting: 'Your ' + cfg.noun.toLowerCase() + ' is created at `' + lensPath + '`. Loading the seed…',
  });
}

// ── (Legacy dwell-bar dashboard removed in the F7 redesign — the front door
//    is the refraction desk now. See lenscraft/04-ui-friction-audit.md.) ──

function updateBadges(s) {
  // Badges now come straight from GET /lenses (single source of truth).
  const b = s.badges || {};
  document.getElementById('badge-hyp').textContent = b.hypotheses || '–';
  document.getElementById('badge-req').textContent = b.requirements || '–';
  document.getElementById('badge-rat').textContent = b.rationalizations || '–';
}

// ── F9: one ingest path, one private decision ──────────────────────────────
// Three surfaces (Refraction Desk, Ingest page, wizard quick-ingest) each
// used to build their own /ingest payload — and had already silently
// diverged: two hardcoded is_private:false, dropping the privacy boundary
// the user never saw. F17 retired two of the three; the survivor is the
// Crafting Table, and it still has exactly one builder.
//
// Per-surface private state; each owns a visible control.
// F17 retired both the wizard and the standalone Ingest page, so the Crafting
// Table is the only ingest surface left and this is its flag.
let _deskPrivate = false;

async function ingestArtifact({ type, title, content, is_private }) {
  if (!content || !content.trim()) throw new Error('Content cannot be empty.');
  if (!title   || !title.trim())   throw new Error('Please add a title.');
  return apiPost('/ingest', {
    type, title: title.trim(), content: content.trim(), is_private: !!is_private,
  });
}

// Shared dropped-file loader — every ingest surface reads files the same way
// (F9: three inline FileReader copies were the raw material the drift came
// from; one loader means they can't diverge again).
function readTextFile(file, onLoad) {
  const reader = new FileReader();
  reader.onload = e => onLoad(e.target.result, file);
  reader.onerror = () => toast('Could not read file.', true);
  reader.readAsText(file);
}
// ── Knowledge ──────────────────────────────────────────────────────────────

async function renderKnowledge(area) {
  const tree = await apiGet('/tree');
  const knowledgeNode = tree.find(n => n.name === 'knowledge');

  area.innerHTML = `<div class="split-layout">
    <div class="tree-panel">
      <h3>Knowledge Base</h3>
      <div id="knowledge-tree"></div>
    </div>
    <div class="view-panel" id="knowledge-content">
      <div class="empty-state">
        <div class="es-icon">📚</div>
        <p style="max-width:320px;text-align:center">Select a file to view or edit.<br>
        <span style="font-size:12px;color:var(--text-secondary)">Product · Process · Research · Resources · Integrations</span></p>
      </div>
    </div>
  </div>`;

  const treeEl = document.getElementById('knowledge-tree');
  if (knowledgeNode) renderTreeNode(treeEl, knowledgeNode.children || [], 'knowledge-content');
  else treeEl.innerHTML = '<div style="padding:8px;font-size:12px;color:var(--text-secondary)">No files yet.</div>';
}

async function renderWorkflows(area) {
  const tree = await apiGet('/tree');
  const wfNode = tree.find(n => n.name === 'workflows');

  area.innerHTML = `<div class="split-layout">
    <div class="tree-panel">
      <h3>Workflows</h3>
      <div id="workflows-tree"></div>
    </div>
    <div class="view-panel" id="workflows-content">
      <div class="empty-state">
        <div class="es-icon">⚙️</div>
        <p style="max-width:340px;text-align:center">Select a workflow to view its definition.<br>
        <span style="font-size:12px;color:var(--text-secondary)">Skills · Documents · Products · Integrations</span></p>
      </div>
    </div>
  </div>`;

  const treeEl = document.getElementById('workflows-tree');
  if (!wfNode) {
    treeEl.innerHTML = '<div style="padding:8px;font-size:12px;color:var(--text-secondary)">No workflows yet.</div>';
    return;
  }

  // Render workflow folders with ⚙️ icon, files with 📄
  renderWorkflowTree(treeEl, wfNode.children || []);
}

function renderWorkflowTree(container, nodes) {
  nodes.forEach(node => {
    const el = document.createElement('div');
    if (node.type === 'dir') {
      const label = node.name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      el.innerHTML = `<div class="tree-item is-dir"><span class="t-icon">⚙️</span>${label}</div>`;
      const children = document.createElement('div');
      children.className = 'tree-children';
      el.querySelector('.tree-item').addEventListener('click', () => {
        children.style.display = children.style.display === 'none' ? 'block' : 'none';
      });
      renderWorkflowTree(children, node.children || []);
      el.appendChild(children);
      // Auto-expand top-level workflow folders
      children.style.display = 'block';
    } else {
      const label = node.name.replace('.md', '');
      el.innerHTML = `<div class="tree-item"><span class="t-icon">📄</span>${label}</div>`;
      el.querySelector('.tree-item').addEventListener('click', async (e) => {
        document.querySelectorAll('.tree-item').forEach(t => t.classList.remove('active'));
        e.currentTarget.classList.add('active');
        await openWorkflowFile(node.path);
      });
    }
    container.appendChild(el);
  });
}

async function openWorkflowFile(relPath) {
  const panel = document.getElementById('workflows-content');
  panel.innerHTML = '<div class="loading-block"><div class="spinner"></div></div>';
  try {
    const { content } = await apiGet(`/file?path=${encodeURIComponent(relPath)}`);
    // Parse frontmatter header lines (top of file, before ---)
    const lines = content.split('\n');
    const meta = {};
    for (const line of lines) {
      const m = line.match(/^\*\*([^*]+):\*\*\s*(.+)/);
      if (!m) break;
      meta[m[1].trim().toLowerCase()] = m[2].trim();
    }
    const bodyStart = lines.findIndex(l => l.startsWith('---'));
    const body = bodyStart >= 0 ? lines.slice(bodyStart + 1).join('\n') : content;

    const headerHtml = meta['name'] ? `
      <div class="card" style="margin-bottom:16px;border-left:3px solid var(--accent)">
        <h3 style="margin:0 0 6px">${meta['name']}</h3>
        ${meta['description'] ? `<p style="margin:0 0 8px;color:var(--text-secondary)">${meta['description']}</p>` : ''}
        <div style="display:flex;flex-wrap:wrap;gap:8px;font-size:12px">
          ${_wfRunnerBadge(relPath)}
          ${meta['for lenses'] ? `<span class="badge">🔍 ${meta['for lenses']}</span>` : ''}
          ${meta['type'] ? `<span class="badge">⚡ ${meta['type']}</span>` : ''}
        </div>
        ${meta['skills'] ? `<div style="margin-top:8px;font-size:12px;color:var(--text-secondary)"><strong>Skills:</strong> ${meta['skills']}</div>` : ''}
        ${meta['documents'] ? `<div style="margin-top:4px;font-size:12px;color:var(--text-secondary)"><strong>Documents:</strong> ${meta['documents']}</div>` : ''}
        ${meta['integrations'] ? `<div style="margin-top:4px;font-size:12px;color:var(--text-secondary)"><strong>Integrations:</strong> ${meta['integrations']}</div>` : ''}
      </div>` : '';

    renderFileViewer(panel, relPath, content, 'workflows-content');
    // Prepend the rich header before the rendered markdown
    if (headerHtml) panel.insertAdjacentHTML('afterbegin', headerHtml);
  } catch (e) {
    panel.innerHTML = `<div class="card" style="color:#dc2626">⚠️ ${e.message}</div>`;
  }
}

// ── Runner status (D) ──────────────────────────────────────────────────────
// A workflow definition is not a runnable workflow. Since the Lens Wizard's
// step-3 picker is retired, the Workflows view is the only place a reader
// learns which definitions actually have a runner in app.js — so it says so
// explicitly. A definition without a runner is labelled, not silently listed
// as if it worked (GN-005: declaring the missing focal point).
//
// This is the same door-state discipline F8 applied to the integration
// option: a workflow becomes runnable when its runner is written, and the
// badge clears by itself because both sides read _WF_RUNNERS.

function _wfIdFromPath(relPath) {
  // workflows/<id>/README.md  ->  <id>
  const m = String(relPath || '').match(/^workflows\/([^/]+)\//);
  return m ? m[1] : '';
}

function _wfRunnerBadge(relPath) {
  const id = _wfIdFromPath(relPath);
  if (!id) return '';
  if (_wfHasRunner(id)) {
    return `<span class="badge ok" title="app.js has a runner for this workflow">▶ runnable</span>`;
  }
  return `<span class="badge warn" title="Defined in the vault, but app.js has no runner for it yet — "
    + "the Crafting Table cannot launch it. Writing the runner makes it runnable.">
    ⚠️ defined, not yet runnable</span>`;
}

function renderTreeNode(container, nodes, contentId) {
  nodes.forEach(node => {
    const el = document.createElement('div');
    if (node.type === 'dir') {
      el.innerHTML = `<div class="tree-item is-dir"><span class="t-icon">📁</span>${node.name}</div>`;
      const children = document.createElement('div');
      children.className = 'tree-children';
      children.style.display = 'none';
      el.querySelector('.tree-item').addEventListener('click', () => {
        children.style.display = children.style.display === 'none' ? 'block' : 'none';
      });
      renderTreeNode(children, node.children || [], contentId);
      el.appendChild(children);
      // Auto-expand first level
      children.style.display = 'block';
    } else {
      el.innerHTML = `<div class="tree-item"><span class="t-icon">📄</span>${node.name.replace('.md','')}</div>`;
      el.querySelector('.tree-item').addEventListener('click', async (e) => {
        document.querySelectorAll('.tree-item').forEach(t => t.classList.remove('active'));
        e.currentTarget.classList.add('active');
        await openFile(node.path, contentId);
      });
    }
    container.appendChild(el);
  });
}

// ── File viewer / editor ───────────────────────────────────────────────────

async function openFile(relPath, contentId) {
  _currentFile = relPath;
  _editMode = false;
  const panel = document.getElementById(contentId);
  panel.innerHTML = '<div class="loading-block"><div class="spinner"></div></div>';

  try {
    const { content } = await apiGet(`/file?path=${encodeURIComponent(relPath)}`);
    renderFileViewer(panel, relPath, content, contentId);
  } catch (e) {
    panel.innerHTML = `<div class="card" style="color:#dc2626">⚠️ ${e.message}</div>`;
  }
}

function _extractMethodPointer(content) {
  // Resolved pointer: **Crafting method:** [label](path)
  const m = content.match(/\*\*Crafting method:\*\*\s*\[([^\]]+)\]\(([^)]+)\)/);
  if (m) return { label: m[1], path: m[2] };
  // Honest pre-LCM mark: no affordance to offer (GN-006)
  if (/\*\*Crafting method:\*\*\s*not recorded/i.test(content)) return { pre: true };
  return null;
}

async function openCraftingMethod(lensRelPath, contentId) {
  // Crafting methods are historical assets — read-only by design. The only
  // live affordances here are viewing and going back.
  const panel = document.getElementById(contentId);
  panel.innerHTML = '<div class="loading-block"><div class="spinner"></div></div>';
  try {
    const lensDoc = await apiGet(`/file?path=${encodeURIComponent(lensRelPath)}`);
    const ptr = _extractMethodPointer(lensDoc.content);
    if (!ptr || !ptr.path) { toast('No crafting method recorded for this lens.', true); return; }
    const { content } = await apiGet(`/method?path=${encodeURIComponent(ptr.path)}`);
    panel.innerHTML = `
      <div class="editor-toolbar">
        <span class="editor-filename">${escHtml(ptr.path)}</span>
        <button class="btn btn-ghost btn-sm" onclick="openFile('${lensRelPath}','${contentId}')">← Back to lens</button>
        <span class="badge" style="font-size:11px">📜 historical asset — read-only</span>
      </div>
      <div class="md-viewer">${renderMarkdown(content)}</div>`;
  } catch (e) {
    panel.innerHTML = `<div class="card" style="color:#dc2626">⚠️ ${e.message}</div>`;
  }
}

function renderFileViewer(panel, relPath, content, contentId) {
  const lensMap = {
    hypotheses:      'hypotheses',
    requirements:    'requirements',
    rationalizations:'rationalizations',
  };
  const topFolder = relPath.split('/')[0];
  const isLens    = topFolder in lensMap && !relPath.includes('_template');

  // F-provenance: method button only when the pointer resolves to a real
  // path (GN-006 — pre-LCM lenses get no dead button).
  const methodPtr = _extractMethodPointer(content);
  const methodBtn = methodPtr && methodPtr.path
    ? `<button class="btn btn-ghost btn-sm" onclick="openCraftingMethod('${relPath}','${contentId}')">📜 Crafting method</button>`
    : '';

  const emitBtn = isLens
    ? `<button class="btn btn-sm" style="background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0"
         onclick="confirmEmit('${relPath}','${topFolder}','${contentId}')">⬡ Emit &amp; Archive</button>`
    : '';

  const actionBtns = isLens
    ? `${emitBtn}
       <button class="btn btn-primary btn-sm" onclick="continueWorkflow('${relPath}','${topFolder}','${contentId}')">▶ Continue Workflow</button>
       ${methodBtn}
       <button class="btn btn-ghost btn-sm" style="color:#dc2626;border-color:#fca5a5"
         onclick="confirmDeleteThought('${relPath}','${topFolder}','${contentId}')">🗑 Delete</button>`
    : `${emitBtn}
       ${methodBtn}
       <button class="btn btn-ghost btn-sm" id="edit-toggle-btn" onclick="toggleEdit('${relPath}','${contentId}')">✏️ Edit</button>
       <button class="btn btn-primary btn-sm" id="save-btn" style="display:none" onclick="saveFile('${relPath}','${contentId}')">💾 Save</button>
       <button class="btn btn-ghost btn-sm" id="cancel-btn" style="display:none" onclick="openFile('${relPath}','${contentId}')">Cancel</button>`;

  panel.innerHTML = `
    <div class="editor-toolbar">
      <span class="editor-filename">${relPath}</span>
      ${actionBtns}
    </div>
    <div id="file-view-area">
      <div class="md-viewer" id="md-rendered">${renderMarkdown(content)}</div>
      <textarea class="md-editor" id="md-raw" style="display:none">${escHtml(content)}</textarea>
    </div>`;
}

function toggleEdit(relPath, contentId) {
  _editMode = !_editMode;
  document.getElementById('md-rendered').style.display = _editMode ? 'none' : 'block';
  document.getElementById('md-raw').style.display      = _editMode ? 'block' : 'none';
  document.getElementById('edit-toggle-btn').style.display = _editMode ? 'none' : 'inline-flex';
  document.getElementById('save-btn').style.display    = _editMode ? 'inline-flex' : 'none';
  document.getElementById('cancel-btn').style.display  = _editMode ? 'inline-flex' : 'none';
}

async function saveFile(relPath, contentId) {
  const content = document.getElementById('md-raw').value;
  try {
    await apiPost('/file', { path: relPath, content });
    toast('✅ Saved');
    await openFile(relPath, contentId);
  } catch (e) {
    toast(e.message, true);
  }
}

// ── Continue Workflow ───────────────────────────────────────────────────────

function continueWorkflow(relPath, lensKey, contentId) {
  const cfg    = LENS_CONFIGS[lensKey] || {};
  const name   = relPath.split('/').pop().replace('.md','').replace(/-/g,' ');
  const wfName = cfg.defaultWorkflow
    ? cfg.defaultWorkflow.replace(/-/g,' ').replace(/\b\w/g, c => c.toUpperCase())
    : `${cfg.noun || 'Lens'} Workflow`;

  renderWorkflowChat(document.getElementById('content-area'), {
    title:         wfName,
    workflowId:    cfg.defaultWorkflow || 'ad-hoc',
    lensKey:       lensKey,
    artifactPath:  relPath,
    artifactTitle: name,
    subAssets:     [],
    agentGreeting: `Resuming workflow for **"${name}"** (\`${relPath}\`).\n\nReading artifact… one moment.`,
    resuming:      true,
  });
}

// ── Delete Thought ──────────────────────────────────────────────────────────

function confirmDeleteThought(relPath, lensKey, contentId) {
  const name  = relPath.split('/').pop().replace('.md','').replace(/-/g,' ');
  const panel = document.getElementById(contentId);
  panel.innerHTML = `
    <div style="max-width:480px">
      <div class="card" style="border-color:#dc2626;background:#fef2f2">
        <div style="font-size:20px;margin-bottom:10px">🗑 Delete this thought?</div>
        <h3 style="font-size:15px;font-weight:700;margin-bottom:8px">${escHtml(name)}</h3>
        <p style="font-size:13.5px;color:#7f1d1d;line-height:1.6;margin-bottom:20px">
          This will permanently delete <code>${escHtml(relPath)}</code> from Prism.<br>
          This action <strong>cannot be undone</strong>. The file will not be archived.
        </p>
        <div style="display:flex;gap:10px">
          <button class="btn btn-sm" style="background:#dc2626;color:#fff;border:none"
            onclick="deleteThought('${relPath}','${lensKey}')">Yes, delete permanently</button>
          <button class="btn btn-ghost btn-sm"
            onclick="openFile('${relPath}','${contentId}')">Cancel — keep it</button>
        </div>
      </div>
    </div>`;
}

async function deleteThought(relPath, lensKey) {
  try {
    const data = await apiFetch(`/file?path=${encodeURIComponent(relPath)}`, { method: 'DELETE' });
    // F3: session sidecars die with their lens — no ghost paused entries.
    for (const suffix of ['-pause.md', '-chat.md', '-session.json']) {
      const sidecar = relPath.replace(/\.md$/, suffix);
      await apiFetch(`/file?path=${encodeURIComponent(sidecar)}`, { method: 'DELETE' }).catch(() => {});
    }
    toast('🗑 Thought deleted');
    const cfg = LENS_CONFIGS[lensKey] || {};
    if (cfg.navKey) await renderView(cfg.navKey);
  } catch(e) {
    toast(e.message, true);
  }
}



function confirmEmit(relPath, lens, contentId) {
  const lensLabels = {
    hypotheses:      { noun: 'Hypothesis',     seed: 'Epiphany' },
    requirements:    { noun: 'Requirement',    seed: 'Genesis'  },
    rationalizations:{ noun: 'Rationalization',seed: 'Gibberish'},
  };
  const cfg   = lensLabels[lens] || { noun: 'Item', seed: '' };
  const name  = relPath.split('/').pop().replace('.md','').replace(/^\d{4}-\d{2}-\d{2}-/,'').replace(/-/g,' ');
  const panel = document.getElementById(contentId);

  panel.innerHTML = `
    <div style="max-width:520px">
      <div class="card" style="border-color:#15803d;background:#f0fdf4">
        <div style="font-size:20px;margin-bottom:10px">⬡ Emit &amp; Archive</div>
        <h3 style="font-size:16px;font-weight:700;margin-bottom:8px">${cfg.noun}: ${name}</h3>
        <p style="font-size:13.5px;color:var(--text-secondary);margin-bottom:20px;line-height:1.6">
          This ${cfg.noun.toLowerCase()} will exit Prism. Its file and the associated
          ${cfg.seed} artifact will be moved to
          <code style="font-size:12px;background:#dcfce7;padding:2px 6px;border-radius:4px">archive/${lens}/</code>
          and removed from the active workspace.
          <br><br>
          <strong>This cannot be undone from the UI.</strong> Files will be in the archive folder.
        </p>
        <div class="form-group" style="margin-bottom:16px">
          <label class="form-label">Emission note <span style="font-weight:400;color:var(--text-secondary)">(optional — what came out of this?)</span></label>
          <textarea class="form-textarea" id="emit-note" style="min-height:80px"
            placeholder="e.g. Converted to Jira epic PROD-142 · Sent to eng lead for review · Informed Q3 roadmap decision"></textarea>
        </div>
        <div style="display:flex;gap:10px">
          <button class="btn btn-ghost" onclick="openFile('${relPath}','${contentId}')">Cancel</button>
          <button class="btn btn-sm" style="background:#15803d;color:#fff;padding:7px 16px;font-size:13px"
            onclick="emitAndArchive('${relPath}','${lens}','${contentId}')">⬡ Confirm Emit &amp; Archive</button>
        </div>
      </div>
    </div>`;
}

async function emitAndArchive(relPath, lens, contentId) {
  const note = document.getElementById('emit-note')?.value.trim() || '';
  const btn  = document.querySelector('[onclick*="emitAndArchive"]');
  if (btn) { btn.textContent = 'Archiving…'; btn.disabled = true; }

  try {
    // Append emission note to the file before archiving
    if (note) {
      const { content } = await apiGet(`/file?path=${encodeURIComponent(relPath)}`);
      const date = new Date().toISOString().slice(0,10);
      const updated = content.trimEnd() + `\n\n---\n\n## Emission Note\n\n> ${date}: ${note}\n`;
      await apiPost('/file', { path: relPath, content: updated });
    }

    const r = await apiPost('/emit', { lens, path: relPath });
    toast(`⬡ Emitted successfully`);
    await nav(null, 'dashboard');
  } catch(e) {
    toast(e.message, true);
    if (btn) { btn.textContent = '⬡ Confirm Emit & Archive'; btn.disabled = false; }
  }
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function autoName(seedWord) {
  const pool = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const guid5 = Array.from({length: 5}, () => pool[Math.floor(Math.random() * pool.length)]).join('');
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const now = new Date();
  const day   = String(now.getDate()).padStart(2, '0');
  const month = months[now.getMonth()];
  return `${guid5}-${seedWord}-${day}${month}${now.getFullYear()}`;
}

// ── The one door ───────────────────────────────────────────────────────────
// Creating a lens happens at the Crafting Table, nowhere else. These views are
// for working on lenses that already exist — opening one, continuing its
// workflow, emitting or deleting it. The wizard that used to sit behind the
// "＋ New …" buttons is retired; the desk is the single entry point.
//
// The pointer is a link rather than a second creation path on purpose: a lens
// view must still hand the human a next action (GN-006), and "go to the door"
// is one, but it does not re-scatter entry points.

function _craftingTablePointer(noun) {
  return `<button class="btn btn-primary" style="margin-top:16px" onclick="gotoView('dashboard')">
    ◈ Go to the Crafting Table to add a ${escHtml(noun.toLowerCase())}</button>`;
}

// ── Hypotheses ─────────────────────────────────────────────────────────────

async function renderHypotheses(area) {
  setTopbarAction(`<button class="btn btn-ghost btn-sm" onclick="gotoView('dashboard')">◈ Crafting Table</button>`);

  const tree = await apiGet('/tree');
  const hypNode = tree.find(n => n.name === 'hypotheses');
  const files = (hypNode?.children || []).filter(f => f.type === 'file' && !f.name.startsWith('_'));

  if (files.length === 0) {
    area.innerHTML = `
      <div class="empty-state">
        <div class="es-icon">🔬</div>
        <p>No hypotheses yet. Bring a raw thought to the Crafting Table and it becomes one.</p>
        ${_craftingTablePointer('hypothesis')}
      </div>`;
    return;
  }

  const rows = await Promise.all(files.map(async f => {
    try {
      const { content } = await apiGet(`/file?path=${encodeURIComponent(f.path)}`);
      const meta = parseMarkdownMeta(content);
      return { ...f, meta, content };
    } catch { return { ...f, meta: {}, content: '' }; }
  }));

  // Sort: validated > proposed > candidate > demoted > archived
  const order = ['validated','proposed','candidate','demoted','archived'];
  rows.sort((a,b) => order.indexOf(a.meta.status||'candidate') - order.indexOf(b.meta.status||'candidate'));

  area.innerHTML = `
    <div class="split-layout">
      <div class="tree-panel">
        <h3>Files</h3>
        <div id="hyp-file-list">
          ${rows.map(r => `
            <div class="tree-item" onclick="openFile('${r.path}','hyp-content')">
              <span class="t-icon">🔬</span>
              <span style="flex:1;font-size:12px">${r.name.replace('.md','')}</span>
              <span class="badge-status badge-${r.meta.status||'candidate'}" style="margin-left:4px;font-size:10px">${r.meta.status||'?'}</span>
            </div>`).join('')}
        </div>
      </div>
      <div class="view-panel">
        <div class="file-list" id="hyp-list">
          ${rows.map(r => `
            <div class="record-row" onclick="openHypInPanel('${r.path}')">
              <div>
                <div class="rr-title">${r.name.replace(/^\d{4}-\d{2}-\d{2}-/,'').replace(/-/g,' ').replace('.md','')}</div>
                <div class="rr-meta" style="margin-top:4px">${r.path}</div>
              </div>
              <span class="badge-status badge-${r.meta.status||'candidate'}">${r.meta.status||'candidate'}</span>
              ${r.meta.confidence !== undefined ? `<span style="font-size:12px;color:var(--text-secondary)">conf: ${r.meta.confidence}</span>` : ''}
            </div>`).join('')}
        </div>
        <div id="hyp-content" style="margin-top:16px"></div>
      </div>
    </div>`;
}

async function openHypInPanel(path) {
  await openFile(path, 'hyp-content');
  document.getElementById('hyp-content').scrollIntoView({ behavior: 'smooth', block: 'start' });
}


// ── Requirements ───────────────────────────────────────────────────────────

async function renderRequirements(area) {
  setTopbarAction(`<button class="btn btn-ghost btn-sm" onclick="gotoView('dashboard')">◈ Crafting Table</button>`);

  const tree = await apiGet('/tree');
  const node = tree.find(n => n.name === 'requirements');
  const files = (node?.children || []).filter(f => f.type === 'file' && !f.name.startsWith('_'));

  if (files.length === 0) {
    area.innerHTML = `
      <div class="empty-state">
        <div class="es-icon">📋</div>
        <p>No requirements yet. Bring a raw thought to the Crafting Table and it becomes one.</p>
        ${_craftingTablePointer('requirement')}
      </div>`;
    return;
  }

  const rows = await Promise.all(files.map(async f => {
    try {
      const { content } = await apiGet(`/file?path=${encodeURIComponent(f.path)}`);
      return { ...f, meta: parseMarkdownMeta(content) };
    } catch { return { ...f, meta: {} }; }
  }));

  const order = ['review','draft','approved','deprecated'];
  rows.sort((a,b) => order.indexOf(a.meta.status||'draft') - order.indexOf(b.meta.status||'draft'));

  area.innerHTML = `
    <div class="split-layout">
      <div class="view-panel">
        <div class="file-list">
          ${rows.map(r => `
            <div class="record-row" onclick="openReqInPanel('${r.path}')">
              <div>
                <div class="rr-title">${r.name.replace(/^\d{4}-\d{2}-\d{2}-/,'').replace(/-/g,' ').replace('.md','')}</div>
                <div class="rr-meta" style="margin-top:4px">${r.path}</div>
              </div>
              <span class="badge-status badge-${r.meta.status||'draft'}">${r.meta.status||'draft'}</span>
              ${r.meta.priority ? `<span class="badge-status badge-${r.meta.priority==='must'?'validated':r.meta.priority==='should'?'proposed':'candidate'}">${r.meta.priority}</span>` : ''}
            </div>`).join('')}
        </div>
        <div id="req-content" style="margin-top:16px"></div>
      </div>
    </div>`;
}

async function openReqInPanel(path) {
  const panel = document.getElementById('req-content');
  panel.innerHTML = '<div class="loading-block"><div class="spinner"></div></div>';
  try {
    const { content } = await apiGet(`/file?path=${encodeURIComponent(path)}`);
    const meta  = parseMarkdownMeta(content);
    const name  = path.split('/').pop().replace('.md','').replace(/-/g,' ');
    const lensKey = 'requirements';

    const badgeColor = { review:'#f59e0b', draft:'#6b7280', approved:'#15803d', deprecated:'#9ca3af' };
    const priBadge = { must:'#15803d', should:'#2563eb', could:'#7c3aed', wont:'#9ca3af' };
    const status   = meta.status   || 'draft';
    const priority = meta.priority || '';

    panel.innerHTML = `
      <div style="max-width:600px;margin-top:8px">
        <div class="card" style="padding:16px 20px">
          <!-- Row 1: title + badges -->
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
            <div style="font-size:15px;font-weight:700;flex:1;min-width:0">${escHtml(name)}</div>
            <span class="badge-status badge-${status}">${status}</span>
            ${priority ? `<span class="badge-status" style="background:${priBadge[priority]||'#6b7280'};color:#fff">${priority}</span>` : ''}
          </div>
          <!-- Row 2: meta snippets -->
          <div style="display:flex;gap:20px;flex-wrap:wrap;font-size:12.5px;color:var(--text-secondary)">
            ${meta.created   ? `<span>📅 Created: ${escHtml(meta.created)}</span>` : ''}
            ${meta.artifact  ? `<span>📄 Artifact: <code style="font-size:11px">${escHtml(meta.artifact)}</code></span>` : ''}
            ${meta.owner     ? `<span>👤 ${escHtml(meta.owner)}</span>` : ''}
          </div>
          <!-- Actions -->
          <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
            <button class="btn btn-primary btn-sm" onclick="continueWorkflow('${path}','${lensKey}','req-content')">▶ Continue Workflow</button>
            <button class="btn btn-sm" style="background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0"
              onclick="confirmEmit('${path}','requirements','req-content')">⬡ Emit &amp; Archive</button>
            <button class="btn btn-ghost btn-sm" onclick="openFile('${path}','req-content')">📄 View full file</button>
            <button class="btn btn-ghost btn-sm" style="color:#dc2626;border-color:#fca5a5"
              onclick="confirmDeleteThought('${path}','${lensKey}','req-content')">🗑 Delete</button>
          </div>
        </div>
      </div>`;
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch(e) {
    panel.innerHTML = `<div class="card" style="color:#dc2626">⚠️ ${e.message}</div>`;
  }
}

// ── Lens configuration ─────────────────────────────────────────────────────
// Per-lens vocabulary and the default workflow each lens routes through.
// This was the header of the (now retired) Lens Wizard; the config itself is
// still the single source of truth for noun, seed word, creation endpoint and
// default workflow — the Crafting Table and every workflow runner read it.
//
// Creating a lens happens at the Crafting Table only. The wizard's step 3
// (choose a non-default workflow) is gone with it; see _wfRunnerFor() and the
// runner-status badge in the Workflows view for how a workflow without a
// runner is surfaced.

const LENS_CONFIGS = {
  hypotheses:      { noun: 'Hypothesis',      seedWord: 'Epiphany',  endpoint: '/hypotheses/from-epiphany',         navKey: 'hypotheses',      contentId: 'hyp-content', placeholder: 'e.g. Users churn because onboarding is too long',   defaultWorkflow: 'hypotheses-default' },
  requirements:    { noun: 'Requirement',     seedWord: 'Genesis',   endpoint: '/requirements/from-genesis',        navKey: 'requirements',    contentId: 'req-content', placeholder: 'e.g. User can export report as PDF',               defaultWorkflow: 'requirements-default' },
  rationalizations:{ noun: 'Rationalization', seedWord: 'Gibberish', endpoint: '/rationalizations/from-gibberish',  navKey: 'rationalizations',contentId: 'rat-content', placeholder: 'e.g. Why we did not ship feature X',             defaultWorkflow: 'rationalizations-default' },
};

// ── Rationalizations ────────────────────────────────────────────────────────

async function renderRationalizations(area) {
  setTopbarAction(`<button class="btn btn-ghost btn-sm" onclick="gotoView('dashboard')">◈ Crafting Table</button>`);

  const tree = await apiGet('/tree');
  const node = tree.find(n => n.name === 'rationalizations');
  const files = (node?.children || []).filter(f => f.type === 'file' && !f.name.startsWith('_'));

  if (files.length === 0) {
    area.innerHTML = `
      <div class="empty-state">
        <div class="es-icon">🧩</div>
        <p>No rationalizations yet. Bring the reasoning behind a choice to the Crafting Table.</p>
        ${_craftingTablePointer('rationalization')}
      </div>`;
    return;
  }

  const rows = await Promise.all(files.map(async f => {
    try {
      const { content } = await apiGet(`/file?path=${encodeURIComponent(f.path)}`);
      return { ...f, meta: parseMarkdownMeta(content) };
    } catch { return { ...f, meta: {} }; }
  }));

  const order = ['draft','review','approved','deprecated'];
  rows.sort((a,b) => order.indexOf(a.meta.status||'draft') - order.indexOf(b.meta.status||'draft'));

  area.innerHTML = `
    <div class="split-layout">
      <div class="view-panel">
        <div class="file-list">
          ${rows.map(r => `
            <div class="record-row" onclick="openRatInPanel('${r.path}')">
              <div>
                <div class="rr-title">${r.name.replace(/^\d{4}-\d{2}-\d{2}-/,'').replace(/-/g,' ').replace('.md','')}</div>
                <div class="rr-meta" style="margin-top:4px">${r.meta.context || r.path}</div>
              </div>
              <span class="badge-status badge-${r.meta.status||'draft'}">${r.meta.status||'draft'}</span>
              ${r.meta.date ? `<span class="rr-meta">${r.meta.date}</span>` : ''}
            </div>`).join('')}
        </div>
        <div id="rat-content" style="margin-top:16px"></div>
      </div>
    </div>`;
}

async function openRatInPanel(path) {
  await openFile(path, 'rat-content');
  document.getElementById('rat-content').scrollIntoView({ behavior: 'smooth', block: 'start' });
}



// ── Workflow Chat ───────────────────────────────────────────────────────────
//
// Reusable user↔agent chat surface. Not yet surfaced in the nav — workflows
// will call renderWorkflowChat(area, config) to launch it. Supports:
//   • Text input (multi-line, Enter-to-send, Shift+Enter for newline)
//   • File attachment (any file; shown as chips in the message)
//   • Speech-to-text via Web Speech API (🎤 button, interim + final results)

let _chat = {
  workflowId:    null,
  title:         'Workflow',
  messages:      [],      // { role, text, attachments: [{name, content}] }
  pending:       [],      // attachments staged for next send
  speechRecog:   null,
  speechOn:      false,
  // workflow runner state
  artifactPath:  null,
  artifactTitle: null,
  subAssets:     [],
  wfStep:        'init',  // init | routing | inquiry | post-processing
  artifactContent: null,
  artifactMeta:  null,
  pendingVerify: null,    // F2: awaiting Accept/Re-run decision on a verdict card
};

function renderWorkflowChat(area, config = {}) {
  console.log('[renderWorkflowChat] called, workflowId:', config.workflowId, 'area:', area?.id);
  _chat.workflowId      = config.workflowId    || 'default';
  _chat.title           = config.title         || 'Workflow';
  _chat.messages        = [];
  _chat.pending         = [];
  _chat.speechOn        = false;
  _chat.artifactPath    = config.artifactPath  || null;
  _chat.gibberishPath   = config.gibberishPath || null;
  _chat.artifactTitle   = config.artifactTitle || null;
  _chat.subAssets       = config.subAssets     || [];
  _chat.lensKey         = config.lensKey       || null;
  _chat.wfStep          = 'init';
  _chat.artifactContent = null;
  _chat.artifactMeta    = null;
  if (_chat.speechRecog) { try { _chat.speechRecog.abort(); } catch(e){} _chat.speechRecog = null; }
  _chat.pendingVerify = null;

  const greeting = config.agentGreeting ||
    'Hello! I\'m ready to assist. You can type your message, attach a document, or speak using the 🎤 button.';

  _chat.messages.push({ role: 'agent', text: greeting, attachments: [] });

  document.getElementById('topbar-title').textContent = _chat.title;
  setTopbarAction('');
  _chatRender(area);

  // Hand off to the runner for this workflow, if one exists. A workflow with
  // a definition but no runner (e.g. ux-bridge-default) still gets the chat
  // surface — it just does not drive a state machine. The Workflows view
  // labels those explicitly rather than letting them look live.
  const init = _wfRunnerFor(_chat.workflowId, 'Init');
  if (_chat.artifactPath && init) init();
}

// ── Workflow runner registry ────────────────────────────────────────────────
// The single place that knows which workflow ids have a runner in app.js.
// Three dispatch sites previously hardcoded the same three ids inline; the
// Workflows view needs the same knowledge to label a workflow honestly, so it
// lives here once. Adding a runner means adding one line here — and the
// "defined, not yet runnable" badge disappears on its own.
const _WF_RUNNERS = {
  'requirements-default':     { Init: '_wfReqInit', Respond: '_wfReqRespond', PostProcess: '_wfReqPostProcessMsg' },
  'rationalizations-default': { Init: '_wfRatInit', Respond: '_wfRatRespond', PostProcess: '_wfRatPostProcessMsg' },
  'hypotheses-default':       { Init: '_wfHypInit', Respond: '_wfHypRespond', PostProcess: '_wfHypPostProcessMsg' },
};

function _wfRunnerFor(workflowId, kind) {
  const entry = _WF_RUNNERS[workflowId];
  if (!entry || !entry[kind]) return null;
  const fn = window[entry[kind]];
  return typeof fn === 'function' ? fn : null;
}

function _wfHasRunner(workflowId) {
  return Object.prototype.hasOwnProperty.call(_WF_RUNNERS, workflowId);
}

function _chatRender(area) {
  console.log('[_chatRender] called, area:', area?.id, 'messages:', _chat.messages.length);
  area.innerHTML = `
    <div class="wf-chat-wrap">
      <div class="wf-chat-thread" id="wf-thread">
        ${_chat.messages.map(_chatBubbleHtml).join('')}
      </div>
      <div class="wf-input-bar">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;padding:0 2px">
          <span id="wf-save-status" style="font-size:11px;color:var(--text-secondary);font-style:italic"></span>
          ${_chat.artifactPath
            ? `<button class="btn btn-ghost btn-sm" style="font-size:12px;padding:4px 10px"
                 onclick="wfPauseHere()" title="Save progress and return to Dashboard">⏸ Pause Here</button>`
            : ''}
        </div>
        <div class="wf-pending-attachments" id="wf-pending"></div>
        <div class="wf-input-row">
          <button class="wf-icon-btn" title="Attach file" onclick="_chatPickFile()">📎
            <input type="file" id="wf-file-input" multiple style="position:absolute;inset:0;opacity:0;cursor:pointer;width:100%"
              onchange="_chatHandleFiles(this.files)">
          </button>
          <button class="wf-icon-btn" id="wf-mic-btn" title="Speak" onclick="_chatToggleSpeech()">🎤</button>
          <textarea class="wf-textarea" id="wf-input" rows="1"
            placeholder="Type or speak your message…"
            onkeydown="_chatKeydown(event)"
            oninput="_chatAutoResize(this)"></textarea>
          <button class="btn btn-primary wf-send-btn" onclick="_chatSend()">Send ↑</button>
        </div>
      </div>
    </div>`;
  _chatScrollBottom();
}

function _chatBubbleHtml(msg, idx) {
  const label = msg.role === 'agent' ? '🤖 Agent' : '👤 You';
  const chips  = (msg.attachments || []).map(a =>
    `<span class="wf-attach-chip">📎 ${escHtml(a.name)}</span>`
  ).join('');

  // Render markdown-ish bold + newlines for agent messages
  let bodyHtml = msg.role === 'agent'
    ? escHtml(msg.text)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,.08);padding:1px 4px;border-radius:3px">$1</code>')
        .replace(/\n/g, '<br>')
    : escHtml(msg.text).replace(/\n/g, '<br>');

  // Staging area: prepared prompt, editable, with a door row.
  // Delivery channels — see lenscraft/05-delivery-channels.md:
  //   Copy (channel 1) · Save as file -> vault/prompts/ (channel 2) ·
  //   Send-to-X appears only when a service is configured (channel 3).
  let codeHtml = '';
  if (msg.codeBlock) {
    const doors = [
      `<button class="wf-door" id="wf-stage-copy-${idx}" onclick="_stageCopy(${idx})">📋 Copy</button>`,
    ];
    if (msg.stageSavedPath) {
      doors.push(
        `<span class="wf-stage-saved">✓ vault/${escHtml(msg.stageSavedPath)}</span>`,
        `<button class="wf-stage-open" onclick="_stageOpen(${idx})">open</button>`
      );
    } else {
      doors.push(
        `<button class="wf-door" id="wf-stage-save-${idx}" onclick="_stageSave(${idx})">💾 Save as file</button>`
      );
    }
    codeHtml = `
      <div class="wf-stage">
        <div class="wf-stage-head">
          <span class="wf-stage-label">📋 Prepared prompt</span>
          <span class="wf-stage-hint">editable — steering welcome</span>
        </div>
        <textarea class="wf-stage-text" id="wf-stage-${idx}" spellcheck="false"
          oninput="_stageEdit(${idx}, this)">${escHtml(msg.codeBlock)}</textarea>
        <div class="wf-stage-doors">${doors.join('')}</div>
      </div>`;
  }

  // Post-processing option buttons
  const isPostProc = msg.role === 'agent' && _chat.wfStep === 'post-processing'
    && msg === _chat.messages[_chat.messages.length - 1];
  // Option E (emit to integration) removed — no integration is configured,
  // so the door does not exist yet (F8, GN-006: no dead affordances).
  const postProcHtml = isPostProc
    ? `<div style="margin-top:12px;display:flex;flex-direction:column;gap:8px">
         <button class="btn btn-sm" style="background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0;text-align:left" onclick="wfOptA()">A — Archive &amp; Emit (no further steps)</button>
         <button class="btn btn-ghost btn-sm" style="text-align:left" onclick="wfOptB()">B — Re-run synthesis with additional input</button>
         <button class="btn btn-ghost btn-sm" style="text-align:left" onclick="wfOptC()">C — Send to additional workflow</button>
         <button class="btn btn-ghost btn-sm" style="text-align:left" onclick="wfOptD()">D — Return to Unprocessed queue</button>
       </div>`
    : '';

  // F2 verdict card (structure check on pasted agent output)
  const verifyHtml = msg.verify ? _verifyCardHtml(idx) : '';

  return `
    <div class="wf-bubble-row ${msg.role}">
      <div class="wf-bubble-label">${label}</div>
      <div class="wf-bubble ${msg.role}">${bodyHtml}${chips ? `<div class="wf-attach-list">${chips}</div>` : ''}${codeHtml}${verifyHtml}${postProcHtml}</div>
    </div>`;
}

function _chatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _chatSend(); }
}

function _chatAutoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// ── Staging area door handlers (lenscraft/05-delivery-channels.md) ─────────

function _stageEdit(idx, el) {
  // Steering: edits to the prepared prompt update the message in place.
  if (_chat.messages[idx]) _chat.messages[idx].codeBlock = el.value;
}

async function _stageCopy(idx) {
  // Channel 1 — human handoff via clipboard.
  const msg = _chat.messages[idx];
  if (!msg) return;
  try {
    await navigator.clipboard.writeText(msg.codeBlock);
    toast('✅ Prompt copied — paste it into your AI agent');
  } catch (e) {
    // Fallback: select the staging text so Ctrl+C works.
    const ta = document.getElementById('wf-stage-' + idx);
    if (ta) { ta.focus(); ta.select(); toast('Clipboard blocked — prompt selected, press Ctrl+C', true); }
  }
}

async function _stageSave(idx) {
  // Channel 2 — filesystem handoff: file the prompt into vault/prompts/.
  const msg = _chat.messages[idx];
  if (!msg) return;
  const btn = document.getElementById('wf-stage-save-' + idx);
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const r = await apiPost('/prompt', {
      prompt: msg.codeBlock,
      lens:   _chat.workflowId || '',
      step:   _chat.wfStep || '',
      title:  (_chat.artifactTitle || 'prompt'),
    });
    msg.stageSavedPath = r.path;
    toast('✅ Filed to vault/' + r.path);
    const t = document.getElementById('wf-thread');
    if (t) { t.innerHTML = _chat.messages.map(_chatBubbleHtml).join(''); _chatScrollBottom(); }
    _chatScheduleSave();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = '💾 Save as file'; }
    toast(e.message, true);
  }
}

function _stageOpen(idx) {
  // Point at the filed prompt in the file viewer.
  const msg = _chat.messages[idx];
  if (msg && msg.stageSavedPath) openFile(msg.stageSavedPath, 'content-area');
}

function _chatSend() {
  const el   = document.getElementById('wf-input');
  const text = el ? el.value.trim() : '';
  if (!text && _chat.pending.length === 0) return;

  _chat.messages.push({ role: 'user', text, attachments: [..._chat.pending] });
  _chat.pending = [];
  el.value = '';
  el.style.height = 'auto';
  _chatScheduleSave();

  const thread = document.getElementById('wf-thread');
  if (thread) {
    thread.innerHTML = _chat.messages.map(_chatBubbleHtml).join('') + _chatTypingHtml();
    _chatScrollBottom();
  }

  // Route to the active workflow handler
  setTimeout(() => _wfDispatch(text), 600);
}

function _wfDispatch(userText) {
  const respond = _wfRunnerFor(_chat.workflowId, 'Respond');
  if (respond) { respond(userText); return; }
  // No runner for this workflow. Say so plainly and point at the door that
  // would fix it, rather than implying the agent is merely "being configured"
  // (F8/GN-006: no dead affordances, and no pretending a door opens).
  _chatAgentSay(
    `No runner is wired up for **${_chat.title || _chat.workflowId}** yet, so I can't ` +
    `drive this workflow — the chat surface is here, but the steps are unimplemented.\n\n` +
    `Its definition and skills are in the vault under \`workflows/${_chat.workflowId}/\`. ` +
    `Writing the runner is the work that makes it runnable.`
  );
}

function _chatAgentSay(text, html) {
  _chat.messages.push({ role: 'agent', text: text || '', attachments: [], html });
  const t = document.getElementById('wf-thread');
  if (t) { t.innerHTML = _chat.messages.map(_chatBubbleHtml).join(''); _chatScrollBottom(); }
  _chatScheduleSave();
}

// ── Requirements Default Workflow Runner ────────────────────────────────────

async function _wfReqInit() {
  // F3: shared resume — replays the real session and restores the paused step
  if (await _wfResumeFromPause()) return;

  // Load artifact content fresh
  try {
    const { content } = await apiGet(`/file?path=${encodeURIComponent(_chat.artifactPath)}`);
    _chat.artifactContent = content;
    _chat.artifactMeta    = parseMarkdownMeta(content);
  } catch(e) {
    _chatAgentSay(`⚠️ Could not load artifact at \`${_chat.artifactPath}\`: ${e.message}`);
    return;
  }

  const meta = _chat.artifactMeta;
  const type = (meta.type || '').toLowerCase();
  const name = _chat.artifactTitle || _chat.artifactPath.split('/').pop().replace('.md','');

  const unsupported = ['media','application','code'];
  if (unsupported.includes(type)) {
    _chatAgentSay(
      `⚠️ Artifact type **"${type}"** cannot be processed by the Requirements Default workflow.\n\n` +
      `Please convert it to **formatted** or **unordered** text first, or select a different workflow.`
    );
    _chat.wfStep = 'blocked';
    return;
  }

  let routeMsg;
  if (type === 'formatted') {
    routeMsg = `**Step 1 complete — artifact type detected: \`formatted\`**\n\nThis artifact goes directly to the **PRD Gate**.\n\nBelow is the prompt to run through your AI agent. Paste the output back here when ready.`;
    _chat.wfStep = 'awaiting-prd-gate';
  } else {
    routeMsg = `**Step 1 complete — artifact type detected: \`${type || 'unordered'}\`**\n\nThis artifact goes to **Intent Synthesizer → PRD Gate**.\n\nBelow is the Intent Synthesizer prompt. Paste the output back here when ready.`;
    _chat.wfStep = 'awaiting-intent-synth';
  }

  // Build the skill prompt block
  const skillPrompt = type === 'formatted'
    ? _wfReqPrdGatePrompt(_chat.artifactPath, name, _chat.artifactContent)
    : _wfReqIntentSynthPrompt(_chat.artifactPath, type || 'unordered', _chat.artifactContent);

  // Show the routing message + prompt block as a single agent turn
  _chat.messages[_chat.messages.length - 1] = {
    role: 'agent',
    text: routeMsg,
    attachments: [],
    codeBlock: skillPrompt,
  };
  const t = document.getElementById('wf-thread');
  if (t) { t.innerHTML = _chat.messages.map(_chatBubbleHtml).join(''); _chatScrollBottom(); }
}

function _wfReqRespond(userText) {
  const step = _chat.wfStep;

  if (step === 'awaiting-intent-synth') {
    // F2: verify the pasted Intent Synthesizer output before advancing.
    _wfVerifyPasted(userText, 'intent-synth');
    return;
  }

  if (step === 'awaiting-prd-gate') {
    // F2: verify the pasted PRD Gate output (Inquiry vs Execution) before
    // advancing — silent advancement on garbage was the bug (lenscraft/04).
    _wfVerifyPasted(userText, 'prd-gate');
    return;
  }

  if (step === 'post-processing') {
    // User typed instead of clicking a button — acknowledge and re-show options
    _chatAgentSay('Please choose one of the options above to continue. You can also type additional context if you want to re-run the PRD Gate (choose Option B first).');
    return;
  }

  if (step === 'inquiry') {
    // User answering PRD Gate clarifying questions — reissue PRD Gate with enriched context
    const name = _chat.artifactTitle || _chat.artifactPath.split('/').pop().replace('.md','');
    const enriched = (_chat.artifactContent || '') + '\n\n--- Additional context from user ---\n' + userText;
    const prdPrompt = _wfReqPrdGatePrompt(_chat.artifactPath, name, enriched);
    _chat.wfStep = 'awaiting-prd-gate';
    _chat.messages.push({ role: 'agent', text: 'Re-running **PRD Gate** with your additional context. Paste the new output back here.', attachments: [], codeBlock: prdPrompt });
    const t = document.getElementById('wf-thread');
    if (t) { t.innerHTML = _chat.messages.map(_chatBubbleHtml).join(''); _chatScrollBottom(); }
    return;
  }

  // Fallback
  _chatAgentSay('Type a message or use the buttons above to choose the next step.');
}

function _wfReqPostProcessMsg() {
  return `✅ PRD Gate output received. Choose how to proceed:\n\n` +
    `Use the action buttons below to continue.`;
}

// Called by post-processing option buttons
function wfOptA() {
  _chat.wfStep = 'done';
  if (_chat.artifactPath) {
    const lensKey = _chat.lensKey || _chat.artifactPath.split('/')[0];
    confirmEmit(_chat.artifactPath, lensKey, 'content-area');
  } else {
    _chatAgentSay('✅ Proceeding to Emit & Archive. No artifact path found — please emit manually from the lens list.');
  }
}
function wfOptB() {
  _chat.wfStep = 'inquiry';
  _chatAgentSay('Please provide additional context below (type, attach a file, or dictate). When ready, send it and I will re-run the synthesis with your enriched input.');
}
function wfOptC() {
  // Option C — hand the finished artifact to another workflow.
  //
  // This used to re-open the Lens Wizard at step 3 so the human could pick a
  // downstream workflow. The wizard is retired (the Crafting Table is the one
  // door), so the picker moved here: the list is read from GET /workflows,
  // and the chosen workflow launches with the current artifact pre-loaded.
  _chat.wfStep = 'done';
  const lensKey = _chat.lensKey || 'requirements';
  const cfg = LENS_CONFIGS[lensKey] || {};
  const area = document.getElementById('content-area');

  apiGet('/workflows').then(wfs => {
    const others = wfs.filter(w => w.id !== _chat.workflowId);
    if (!others.length) {
      _chatAgentSay('No other workflows are available to hand this to.');
      return;
    }
    area.innerHTML = `
      <div style="max-width:560px">
        <div class="card">
          <h3 style="font-size:16px;font-weight:700;margin-bottom:6px">Send to another workflow</h3>
          <p style="font-size:13.5px;color:var(--text-secondary);margin-bottom:16px">
            <strong>${escHtml(_chat.artifactTitle || cfg.noun || 'Artifact')}</strong> will be pre-loaded
            as the input to whichever you pick.
          </p>
          ${others.map((w, i) => `
            <button class="desk-door" data-wf="${escHtml(w.id)}"
              onclick="_wfOptCSend('${escHtml(w.id)}')"
              style="flex-direction:column;align-items:flex-start;gap:2px;width:100%;text-align:left;margin-bottom:8px">
              <span style="font-weight:600">${escHtml(w.name)}</span>
              <span style="font-size:11.5px;color:var(--text-secondary);font-weight:400">${escHtml(w.description || '')}</span>
            </button>`).join('')}
          <button class="btn btn-ghost btn-sm" onclick="renderDesk(document.getElementById('content-area'))"
            style="margin-top:8px">← Back to the Crafting Table</button>
        </div>
      </div>`;
  }).catch(e => {
    _chatAgentSay('Could not load the workflow list: ' + e.message);
  });
}

function _wfOptCSend(workflowId) {
  const lensKey = _chat.lensKey || 'requirements';
  const cfg = LENS_CONFIGS[lensKey] || {};
  renderWorkflowChat(document.getElementById('content-area'), {
    title:         cfg.noun ? cfg.noun + ' Workflow' : 'Workflow',
    workflowId:    workflowId,
    lensKey:       lensKey,
    artifactPath:  _chat.artifactPath,
    gibberishPath: _chat.gibberishPath,
    artifactTitle: _chat.artifactTitle,
    subAssets:     _chat.subAssets || [],
    agentGreeting: `Handing **${_chat.artifactTitle || 'the artifact'}** to the **${workflowId}** workflow. Loading the input…`,
  });
}
async function wfOptD() {
  _chat.wfStep = 'done';
  if (_chat.artifactPath) {
    try {
      const { content } = await apiGet(`/file?path=${encodeURIComponent(_chat.artifactPath)}`);
      const filename = _chat.artifactPath.split('/').pop();
      await apiPost('/file', { path: `ingestion/unprocessed/${filename}`, content });
      toast('📥 Sent to Unprocessed queue');
    } catch(e) {
      toast(`⚠️ Could not send to queue: ${e.message}`, true);
    }
  }
  // Option D returns the artifact to the staged queue. The Ingest page used to
  // be where the human landed to see it; that surface is retired and the queue
  // is now listed on the Crafting Table, so that is where we go.
  await renderView('dashboard');
}
// wfOptE removed with its button (F8) — the integration door does not exist
// until an integration is configured; see vault/knowledge/integrations/.

function _wfReqPrdGatePrompt(path, name, content) {
  return `ARTIFACT TYPE:    formatted\nARTIFACT PATH:    ${path}\nREQUIREMENT NAME: ${name}\nSEED CONTENT:\n---\n${content}\n---\n\nSkill: vault/knowledge/resources/skills/prd-gate.md`;
}
function _wfReqIntentSynthPrompt(path, type, content) {
  return `ARTIFACT TYPE:    ${type}\nARTIFACT PATH:    ${path}\nLENS NAME:        Requirement\nSEED WORD:        Genesis\nRAW CONTENT:\n---\n${content}\n---\n\nSkill: vault/knowledge/resources/skills/intent-synth.md`;
}


// ── Rationalizations Default Workflow Runner ────────────────────────────────

async function _wfRatInit() {
  console.log('[_wfRatInit] starting, artifactPath:', _chat.artifactPath, 'gibberishPath:', _chat.gibberishPath);
  // F3: shared resume — rationalizations previously ignored the pause file
  // entirely (every resume re-ran routing from scratch). Now it replays.
  if (await _wfResumeFromPause()) return;
  try {
    // Load the lens file to get type metadata
    const { content: lensContent } = await apiGet(`/file?path=${encodeURIComponent(_chat.artifactPath)}`);
    _chat.artifactMeta = parseMarkdownMeta(lensContent);

    // Load the actual gibberish source content for synthesis (fall back to lens file if not available)
    const sourcePath = _chat.gibberishPath || _chat.artifactPath;
    const { content } = await apiGet(`/file?path=${encodeURIComponent(sourcePath)}`);
    console.log('[_wfRatInit] source loaded from:', sourcePath, 'length:', content?.length);
    _chat.artifactContent = content;
  } catch(e) {
    console.error('[_wfRatInit] file load error:', e);
    _chatAgentSay(`⚠️ Could not load artifact at \`${_chat.artifactPath}\`: ${e.message}`);
    return;
  }

  try {
    const meta = _chat.artifactMeta;
    const type = (meta.artifact_type || meta.type || '').toLowerCase().split(/[\s/]/)[0];
    console.log('[_wfRatInit] type detected:', type, 'meta:', meta);
    const name = _chat.artifactTitle || _chat.artifactPath.split('/').pop().replace('.md','');

    const blocked = ['media','application','code'];
    if (blocked.includes(type)) {
      _chatAgentSay(
        `⚠️ Artifact type **"${type}"** cannot be processed by the Rationalizations Default workflow.\n\n` +
        `Please convert it to **formatted**, **unordered**, or **dictation** first, or select a different workflow.`
      );
      _chat.wfStep = 'blocked';
      return;
    }

    let routeMsg, skillPrompt;
    if (type === 'transcript' || type === 'conversation') {
      routeMsg = `**Step 1 complete — artifact type detected: \`${type}\`**\n\nThis artifact goes to **Conv Synth** to extract structured insights from the discussion.\n\nBelow is the Conv Synth prompt. Run it through your AI agent and paste the output back here.`;
      _chat.wfStep = 'awaiting-conv-synth';
      skillPrompt = _wfRatConvSynthPrompt(_chat.artifactPath, type, _chat.artifactContent);
    } else if (type === 'formatted') {
      routeMsg = `**Step 1 complete — artifact type detected: \`formatted\`**\n\nThis artifact is already structured text. It can be mapped directly to a Structured Account.\n\nBelow is the structure prompt. Run it through your AI agent and paste the output back here.`;
      _chat.wfStep = 'awaiting-structure';
      skillPrompt = _wfRatStructurePrompt(_chat.artifactPath, name, _chat.artifactContent);
    } else {
      routeMsg = `**Step 1 complete — artifact type detected: \`${type || 'unordered'}\`**\n\nThis artifact goes to **Intent Synth** to extract structured intent blocks.\n\nBelow is the Intent Synth prompt. Run it through your AI agent and paste the output back here.`;
      _chat.wfStep = 'awaiting-intent-synth';
      skillPrompt = _wfRatIntentSynthPrompt(_chat.artifactPath, type || 'unordered', _chat.artifactContent);
    }

    _chat.messages[_chat.messages.length - 1] = {
      role: 'agent',
      text: routeMsg,
      attachments: [],
      codeBlock: skillPrompt,
    };
    const t = document.getElementById('wf-thread');
    if (t) { t.innerHTML = _chat.messages.map(_chatBubbleHtml).join(''); _chatScrollBottom(); }
  } catch(e) {
    _chatAgentSay(`⚠️ Workflow routing error: ${e.message}. Please reload and try again.`);
  }
}

function _wfRatRespond(userText) {
  const step = _chat.wfStep;

  if (step === 'awaiting-intent-synth') {
    _wfVerifyPasted(userText, 'intent-synth');
    return;
  }
  if (step === 'awaiting-conv-synth') {
    _wfVerifyPasted(userText, 'conv-synth');
    return;
  }
  if (step === 'awaiting-structure') {
    _wfVerifyPasted(userText, 'structured-account');
    return;
  }

  if (step === 'post-processing') {
    _chatAgentSay('Please choose one of the options above to continue. You can also type additional context if you want to re-run the synthesis (choose Option B first).');
    return;
  }

  if (step === 'inquiry') {
    const name = _chat.artifactTitle || _chat.artifactPath.split('/').pop().replace('.md','');
    const enriched = (_chat.artifactContent || '') + '\n\n--- Additional context from user ---\n' + userText;
    const prompt = _wfRatIntentSynthPrompt(_chat.artifactPath, 'unordered', enriched);
    _chat.wfStep = 'awaiting-intent-synth';
    _chat.messages.push({ role: 'agent', text: 'Re-running **Intent Synth** with your additional context. Paste the new output back here.', attachments: [], codeBlock: prompt });
    const t = document.getElementById('wf-thread');
    if (t) { t.innerHTML = _chat.messages.map(_chatBubbleHtml).join(''); _chatScrollBottom(); }
    return;
  }

  _chatAgentSay('Type a message or use the buttons above to choose the next step.');
}

function _wfRatPostProcessMsg() {
  return `✅ Synthesis output received. Choose how to proceed:\n\nUse the action buttons below to continue.`;
}

function _wfRatIntentSynthPrompt(path, type, content) {
  return `ARTIFACT TYPE:    ${type}\nARTIFACT PATH:    ${path}\nLENS NAME:        Rationalization\nSEED WORD:        Gibberish\nRAW CONTENT:\n---\n${content}\n---\n\nSkill: vault/knowledge/resources/skills/intent-synth.md`;
}
function _wfRatConvSynthPrompt(path, type, content) {
  return `ARTIFACT TYPE:    ${type}\nARTIFACT PATH:    ${path}\nLENS NAME:        Rationalization\nSEED WORD:        Gibberish\nRAW CONTENT:\n---\n${content}\n---\n\nSkill: vault/knowledge/resources/skills/conv-synth.md`;
}
function _wfRatStructurePrompt(path, name, content) {
  return `ARTIFACT TYPE:    formatted\nARTIFACT PATH:    ${path}\nRATIONALIZATION NAME: ${name}\nSEED CONTENT:\n---\n${content}\n---\n\nTask: Structure this formatted content into a complete Structured Account with the following sections: Context, Reasoning, Constraints, Trade-offs Accepted, Secondary Considerations, Revisit Trigger.`;
}


// ── Hypotheses Default Workflow Runner ─────────────────────────────────────
// Chain per skills/clarification-gate.md ("When to Use" table):
//   formatted          → Clarification Gate directly
//   unordered/dictation→ Document Synthesizer → Clarification Gate
// Output: a hypothesis brief (Framework C) written into the lens file.

async function _wfHypInit() {
  // F3: shared resume (previously only post-processing was restored)
  if (await _wfResumeFromPause()) return;

  try {
    const { content } = await apiGet(`/file?path=${encodeURIComponent(_chat.artifactPath)}`);
    _chat.artifactContent = content;
    _chat.artifactMeta    = parseMarkdownMeta(content);
  } catch(e) {
    _chatAgentSay(`⚠️ Could not load artifact at \`${_chat.artifactPath}\`: ${e.message}`);
    return;
  }

  const meta = _chat.artifactMeta;
  const type = (meta.artifact_type || meta.type || '').toLowerCase().split(/[\s/]/)[0];
  const name = _chat.artifactTitle || _chat.artifactPath.split('/').pop().replace('.md','');

  const blocked = ['media','application','code'];
  if (blocked.includes(type)) {
    _chatAgentSay(
      `⚠️ Artifact type **"${type}"** cannot be processed by the Hypotheses Default workflow.\n\n` +
      `Please convert it to **formatted** or **unordered** text first, or select a different workflow.`
    );
    _chat.wfStep = 'blocked';
    return;
  }

  let routeMsg, skillPrompt;
  if (type === 'formatted') {
    routeMsg = `**Step 1 complete — artifact type detected: \`formatted\`**\n\nThis artifact goes directly to the **Clarification Gate**.\n\nBelow is the Clarification Gate prompt. Run it through your AI agent and paste the output back here.`;
    _chat.wfStep = 'awaiting-clarification';
    skillPrompt = _wfHypGatePrompt(_chat.artifactPath, name, _chat.artifactContent);
  } else {
    routeMsg = `**Step 1 complete — artifact type detected: \`${type || 'unordered'}\`**\n\nThis artifact goes to **Document Synthesizer → Clarification Gate**.\n\nBelow is the Document Synthesizer prompt. Paste the output back here.`;
    _chat.wfStep = 'awaiting-doc-synth';
    skillPrompt = _wfHypDocSynthPrompt(_chat.artifactPath, type || 'unordered', _chat.artifactContent);
  }

  _chat.messages[_chat.messages.length - 1] = {
    role: 'agent',
    text: routeMsg,
    attachments: [],
    codeBlock: skillPrompt,
  };
  _wfRerenderThread();
}

function _wfHypRespond(userText) {
  const step = _chat.wfStep;

  if (step === 'awaiting-doc-synth') {
    _wfVerifyPasted(userText, 'doc-synth');
    return;
  }

  if (step === 'awaiting-clarification') {
    _wfVerifyPasted(userText, 'hypothesis-brief');
    return;
  }

  if (step === 'post-processing') {
    _chatAgentSay('Please choose one of the options above to continue. You can also type additional context if you want to re-run the gate (choose Option B first).');
    return;
  }

  if (step === 'inquiry') {
    const name = _chat.artifactTitle || _chat.artifactPath.split('/').pop().replace('.md','');
    const enriched = (_chat.artifactContent || '') + '\n\n--- Additional context from user ---\n' + userText;
    const gatePrompt = _wfHypGatePrompt(_chat.artifactPath, name, enriched);
    _chat.wfStep = 'awaiting-clarification';
    _chat.messages.push({ role: 'agent', text: 'Re-running the **Clarification Gate** with your additional context. Paste the new output back here.', attachments: [], codeBlock: gatePrompt });
    _wfRerenderThread();
    return;
  }

  _chatAgentSay('Type a message or use the buttons above to choose the next step.');
}

function _wfHypPostProcessMsg() {
  return `✅ Hypothesis brief received and written into the lens file (status: review). Choose how to proceed:\n\nUse the action buttons below to continue.`;
}

function _wfHypGatePrompt(path, name, content) {
  return `ARTIFACT TYPE:    formatted\nARTIFACT PATH:    ${path}\nLENS NAME:        Hypothesis\nDOCUMENT NAME:    ${name}\nSEED CONTENT:\n---\n${content}\n---\n\nSkill: vault/knowledge/resources/skills/clarification-gate.md (Framework C — Hypothesis)`;
}

function _wfHypDocSynthPrompt(path, type, content) {
  return `ARTIFACT TYPE:    ${type}\nARTIFACT PATH:    ${path}\nLENS NAME:        Hypothesis\nSEED WORD:        Epiphany\nRAW CONTENT:\n---\n${content}\n---\n\nSkill: vault/knowledge/resources/skills/doc-synth.md`;
}


// ── F2 — Paste-back verification ────────────────────────────────────────────
// The machine checks pasted agent output against the skill's declared output
// shape (POST /verify — deterministic, no LLM). Structure verified by the
// machine; content stays the human's to steer (GN-009). Silent advancement
// on garbage was scattered light (lenscraft/04 — F2).

const _VERIFY_TERMINAL = { 'prd-gate': true, 'structured-account': true, 'hypothesis-brief': true };

async function _wfVerifyPasted(userText, shape) {
  let v;
  try {
    v = await apiPost('/verify', { shape, content: userText });
  } catch (e) {
    // Verification unavailable — never block the flow on a failed check.
    v = { ok: true, verdict: 'match', kind: null, kind_label: 'unverified',
          hits: 0, total: 0, missing: [], shape,
          advice: 'Verification endpoint unreachable — advancing without a shape check.' };
  }
  if (!v.ok) {
    v = { ...v, verdict: 'match', kind: null, kind_label: 'unverified',
          hits: 0, total: 0, missing: [], shape, advice: v.error || 'Skipped shape check.' };
  }

  const idx = _chat.messages.length - 1;   // the user's paste
  _chat.messages.push({
    role: 'agent', text: '', attachments: [],
    verify: { ...v, shape, msgIdx: idx, accepted: false, done: v.verdict === 'match' },
  });
  if (v.verdict === 'match') {
    _wfAdvanceVerified(v, userText);
  }
  _wfRerenderThread();
  _chatScheduleSave();
}

function _verifyCardHtml(idx) {
  const v = _chat.messages[idx].verify;
  if (!v) return '';
  const cls = v.verdict === 'match' ? 'pass' : v.verdict === 'partial' ? 'partial' : 'fail';
  const icon = v.verdict === 'match' ? '✅' : v.verdict === 'partial' ? '🟡' : '🔴';
  const head = v.verdict === 'match'
    ? `Structure verified — ${v.kind_label || 'shape check passed'}`
    : v.verdict === 'partial'
      ? `Partial match — ${v.kind_label || 'shape unclear'}`
      : 'Shape not recognised';
  const missing = (v.missing || []).length
    ? `<ul class="wf-verify-missing">${v.missing.map(m => `<li>${escHtml(m)}</li>`).join('')}</ul>`
    : '';
  const doors = v.done
    ? `<div class="wf-verify-applied">${v.accepted ? '✓ accepted — workflow advanced' : '✓ re-run requested'}</div>`
    : v.verdict === 'match'
      ? ''   // auto-advanced; no decision needed
      : `<div class="wf-verify-doors">
           <button class="wf-door" onclick="_verifyAccept(${idx})">✓ Accept anyway</button>
           <button class="wf-door" onclick="_verifyRerun(${idx})">↻ Re-run the skill</button>
         </div>`;
  return `
    <div class="wf-verify ${cls}">
      <div class="wf-verify-head">${icon} ${head}
        <span class="wf-verify-score">${v.total ? v.hits + '/' + v.total + ' markers' : ''}</span>
      </div>
      <div class="wf-verify-body">
        ${escHtml(v.advice || '')}${missing}
      </div>
      ${doors}
    </div>`;
}

function _verifyAccept(idx) {
  const v = _chat.messages[idx].verify;
  if (!v || v.done) return;
  const userText = _chat.messages[v.msgIdx]?.text || '';
  v.done = true; v.accepted = true;
  _wfAdvanceVerified(v, userText);
  _wfRerenderThread();
  _chatScheduleSave();
}

function _verifyRerun(idx) {
  const v = _chat.messages[idx].verify;
  if (!v || v.done) return;
  v.done = true; v.accepted = false;
  // Re-issue the last prompt with the missing sections called out —
  // steering, not authorship: the human edits the prompt before re-sending.
  let lastPrompt = '';
  for (let i = _chat.messages.length - 1; i >= 0; i--) {
    if (_chat.messages[i].codeBlock) { lastPrompt = _chat.messages[i].codeBlock; break; }
  }
  const note = `\n\n[Prism steering — address these before regenerating]\nMissing structural sections in the previous output:\n${(v.missing || []).map(m => '- ' + m).join('\n')}\n`;
  _chat.messages.push({
    role: 'agent',
    text: `Re-run the skill with this steering note appended — it calls out the sections the previous output was missing.`,
    attachments: [],
    codeBlock: lastPrompt ? lastPrompt + note : `The previous output was missing: ${(v.missing || []).join('; ')}. Please regenerate.`,
  });
  _wfRerenderThread();
  _chatScheduleSave();
}

// Single source of truth for "the paste was accepted" transitions — used by
// both auto-advance (match) and the Accept-anyway door (partial/fail).
function _wfAdvanceVerified(v, userText) {
  const isTerminal = !!_VERIFY_TERMINAL[v.shape];
  const isInquiry  = v.kind === 'inquiry';

  // Terminal output → write it into the lens file (Output Handling rule in
  // the skill files: "Save as the main content… Set **Status:** review").
  if (isTerminal && !isInquiry) _wfApplyAccepted(v, userText);

  if (_chat.workflowId === 'requirements-default') {
    if (v.shape === 'intent-synth') {
      const name = _chat.artifactTitle || _chat.artifactPath.split('/').pop().replace('.md','');
      const prdPrompt = _wfReqPrdGatePrompt(_chat.artifactPath, name, userText);
      _chat.wfStep = 'awaiting-prd-gate';
      _chat.messages.push({ role: 'agent', text: 'Intent Synthesizer output accepted.\n\nNow run this through the **PRD Gate**. Paste the output back here.', attachments: [], codeBlock: prdPrompt });
    } else if (v.shape === 'prd-gate') {
      if (isInquiry) {
        _chat.wfStep = 'inquiry';
        _chat.messages.push({ role: 'agent', text: 'The PRD Gate has questions — its certainty is below 95%. Answer them below; when you send your answers Prism re-runs the gate with the enriched input.', attachments: [] });
      } else {
        _chat.wfStep = 'post-processing';
        _chat.messages.push({ role: 'agent', text: _wfReqPostProcessMsg(), attachments: [] });
      }
    }
  } else if (_chat.workflowId === 'rationalizations-default') {
    _chat.wfStep = 'post-processing';
    _chat.messages.push({ role: 'agent', text: _wfRatPostProcessMsg(), attachments: [] });
  } else if (_chat.workflowId === 'hypotheses-default') {
    if (v.shape === 'doc-synth') {
      const name = _chat.artifactTitle || _chat.artifactPath.split('/').pop().replace('.md','');
      const gatePrompt = _wfHypGatePrompt(_chat.artifactPath, name, userText);
      _chat.wfStep = 'awaiting-clarification';
      _chat.messages.push({ role: 'agent', text: 'Synthesis Blocks accepted.\n\nNow run them through the **Clarification Gate** to produce the hypothesis brief. Paste the output back here.', attachments: [], codeBlock: gatePrompt });
    } else if (v.shape === 'hypothesis-brief') {
      if (isInquiry) {
        _chat.wfStep = 'inquiry';
        _chat.messages.push({ role: 'agent', text: 'The Clarification Gate has questions — its certainty is below 95%. Answer them below; when you send your answers Prism re-runs the gate with the enriched input.', attachments: [] });
      } else {
        _chat.wfStep = 'post-processing';
        _chat.messages.push({ role: 'agent', text: _wfHypPostProcessMsg(), attachments: [] });
      }
    }
  }
}

// Write accepted terminal agent output into the lens file.
async function _wfApplyAccepted(v, userText) {
  const lensPath = _chat.artifactPath;   // capture up front — may clear mid-flight
  if (!lensPath) return;
  try {
    const { content } = await apiGet(`/file?path=${encodeURIComponent(lensPath)}`);
    const lines = content.split('\n');
    // Preserve frontmatter (through the first ---), then the seed section
    // (Genesis / Epiphany / Gibberish provenance) through its closing ---.
    let dashCount = 0, provEnd = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        dashCount++;
        if (dashCount === 2) { provEnd = i; break; }
      }
    }
    const keep = (provEnd >= 0 ? lines.slice(0, provEnd + 1) : lines).join('\n');
    const today = new Date().toISOString().slice(0, 10);
    const updatedHead = keep
      .replace(/\*\*Status:\*\*.*/i, '**Status:** review')
      .replace(/\*\*Last updated:\*\*.*/i, `**Last updated:** ${today}`);
    const sectionLabel = ({
      'prd-gate': '## PRD (agent output, structure verified by Prism)',
      'structured-account': '## Structured Account (agent output, structure verified by Prism)',
      'hypothesis-brief': '## Hypothesis brief (agent output, structure verified by Prism)',
    })[v.shape] || '## Agent output (structure verified by Prism)';
    await apiPost('/file', { path: lensPath, content: `${updatedHead}\n\n${sectionLabel}\n\n${userText.trim()}\n` });
    toast('✓ Output written into the lens file — status set to review');
  } catch (e) {
    toast(`⚠️ Could not write output into the lens file: ${e.message}`, true);
  }
}

function _wfRerenderThread() {
  const t = document.getElementById('wf-thread');
  if (t) { t.innerHTML = _chat.messages.map(_chatBubbleHtml).join(''); _chatScrollBottom(); }
}


// ── F3 — Resume fidelity ────────────────────────────────────────────────────
// One resume path for all three workflow runners. Replay the real session
// from the machine-readable sidecar (messages, prepared prompts, verdict
// cards with live Accept/Re-run doors), restore the paused step, and hand
// the human exactly the prompt their step needs. No more context blob.

async function _wfResumeFromPause() {
  const pausePath = _chatPausePath();
  if (!pausePath) return false;

  let pauseContent;
  try {
    ({ content: pauseContent } = await apiGet(`/file?path=${encodeURIComponent(pausePath)}`));
  } catch (_) { return false; }   // no pause file — start fresh

  const pauseMeta = parseMarkdownMeta(pauseContent);
  if (pauseMeta.step) _chat.wfStep = pauseMeta.step;

  // 1) Replay the real messages from the sidecar.
  let replayed = false;
  const sessPath = _chatSessionPath();
  if (sessPath) {
    try {
      const { content: sessRaw } = await apiGet(`/file?path=${encodeURIComponent(sessPath)}`);
      const sess = JSON.parse(sessRaw);
      if (Array.isArray(sess.messages)) {
        _chat.messages = sess.messages.map(m => {
          const msg = {
            role: m.role === 'agent' ? 'agent' : 'user',
            text: m.text || '',
            attachments: (m.attachments || []).map(a => ({ name: a.name })),
          };
          if (m.codeBlock) msg.codeBlock = m.codeBlock;
          if (m.stageSavedPath) msg.stageSavedPath = m.stageSavedPath;
          if (m.verify) msg.verify = m.verify;   // doors stay live unless done
          return msg;
        });
        // Re-index verdict cards: msgIdx must point at the replayed positions.
        _chat.messages.forEach((m, i) => {
          if (m.verify && typeof m.verify.msgIdx === 'number') m.verify.msgIdx = i - 1;
        });
        replayed = true;
      }
    } catch (_) { /* sidecar missing or corrupt — fall back below */ }
  }
  if (!replayed) {
    // Legacy session (pre-F3): no replayable state. Surface the pause note,
    // then re-issue the step's prompt below — the human loses no forward
    // motion, only the old scrollback.
    const note = pauseContent.match(/## How to Resume\n\n[\s\S]*?\n\n---/)?.[0]
      ?.replace(/## How to Resume\n\n/, '').replace(/\n\n---/, '') || '';
    _chat.messages = [{
      role: 'agent',
      text: `🔄 **Resuming from saved checkpoint** (paused at step: \`${_chat.wfStep}\`)\n\nThis session was saved before replay support existed, so the old scrollback is available in the pause checkpoint file — the workflow itself picks up right here.\n\n${note ? '> ' + note : ''}`.trim(),
      attachments: [],
    }];
  }

  // 2) Make sure the artifact content is loaded — prompt re-issue and the
  //    legacy fallback both need it.
  if (!_chat.artifactContent && _chat.artifactPath) {
    try {
      const { content } = await apiGet(`/file?path=${encodeURIComponent(_chat.artifactPath)}`);
      _chat.artifactContent = content;
      _chat.artifactMeta    = parseMarkdownMeta(content);
    } catch (_) {}
  }

  // 3) Step-specific resume message. For awaiting-* steps the skill prompt
  //    is the thing in hand — replay it if the scrollback doesn't end with
  //    one (covers legacy sessions and any session whose last message was
  //    a user paste).
  const step = _chat.wfStep;
  const name = _chat.artifactTitle || (_chat.artifactPath || '').split('/').pop().replace('.md','');
  const type = ((_chat.artifactMeta && _chat.artifactMeta.type) || 'unordered').toLowerCase();
  // The scrollback already hands the human the next action when it ends with
  // a prepared prompt OR a verdict card whose doors are still live (Accept /
  // Re-run re-issue the prompt themselves — a duplicate would be noise).
  const lastMsg = _chat.messages[_chat.messages.length - 1] || {};
  const endsWithPrompt = !!lastMsg.codeBlock
    || (!!lastMsg.verify && !lastMsg.verify.done);
  const wf = _chat.workflowId;

  let resumeMsg = null;   // {text, codeBlock?} or null = scrollback suffices
  if (step === 'awaiting-prd-gate' && !endsWithPrompt) {
    resumeMsg = {
      text: '**Resuming at: PRD Gate**\n\nHere is the PRD Gate prompt. Run it through your AI agent and paste the output back here.',
      codeBlock: _wfReqPrdGatePrompt(_chat.artifactPath, name, _chat.artifactContent || ''),
    };
  } else if (step === 'awaiting-intent-synth' && !endsWithPrompt) {
    const prompt = wf === 'rationalizations-default'
      ? _wfRatIntentSynthPrompt(_chat.artifactPath, type, _chat.artifactContent || '')
      : _wfReqIntentSynthPrompt(_chat.artifactPath, type, _chat.artifactContent || '');
    resumeMsg = {
      text: '**Resuming at: Intent Synthesizer**\n\nHere is the Intent Synthesizer prompt. Paste the output back here.',
      codeBlock: prompt,
    };
  } else if (step === 'awaiting-conv-synth' && !endsWithPrompt) {
    resumeMsg = {
      text: '**Resuming at: Conversation Synthesizer**\n\nHere is the Conv Synth prompt. Paste the output back here.',
      codeBlock: _wfRatConvSynthPrompt(_chat.artifactPath, type, _chat.artifactContent || ''),
    };
  } else if (step === 'awaiting-structure' && !endsWithPrompt) {
    resumeMsg = {
      text: '**Resuming at: Structured Account**\n\nHere is the structure prompt. Paste the output back here.',
      codeBlock: _wfRatStructurePrompt(_chat.artifactPath, name, _chat.artifactContent || ''),
    };
  } else if (step === 'awaiting-doc-synth' && !endsWithPrompt) {
    resumeMsg = {
      text: '**Resuming at: Document Synthesizer**\n\nHere is the Document Synthesizer prompt. Paste the output back here.',
      codeBlock: _wfHypDocSynthPrompt(_chat.artifactPath, type, _chat.artifactContent || ''),
    };
  } else if (step === 'awaiting-clarification' && !endsWithPrompt) {
    resumeMsg = {
      text: '**Resuming at: Clarification Gate**\n\nHere is the Clarification Gate prompt. Paste the output back here.',
      codeBlock: _wfHypGatePrompt(_chat.artifactPath, name, _chat.artifactContent || ''),
    };
  } else if (step === 'post-processing' && !endsWithPrompt) {
    resumeMsg = { text: wf === 'rationalizations-default' ? _wfRatPostProcessMsg()
                     : wf === 'hypotheses-default'         ? _wfHypPostProcessMsg()
                     : _wfReqPostProcessMsg() };
  } else if (step === 'inquiry' && !endsWithPrompt) {
    resumeMsg = { text: 'The agent has questions (certainty below 95%). Answer them above — when you send your answers, Prism re-runs the skill with the enriched input.' };
  } else if (!replayed) {
    resumeMsg = { text: `Resumed. Current step: \`${step}\`. Send a message to continue.` };
  }

  if (resumeMsg) {
    _chat.messages.push({ role: 'agent', text: resumeMsg.text, attachments: [], ...(resumeMsg.codeBlock ? { codeBlock: resumeMsg.codeBlock } : {}) });
  }
  _wfRerenderThread();
  _chatScheduleSave();   // persist the resumed state immediately
  return true;
}





// ── Chat Auto-Save & Pause Checkpoint ──────────────────────────────────────

let _chatSaveTimer = null;

function _chatSavePath()  {
  if (!_chat.artifactPath) return null;
  return _chat.artifactPath.replace(/\.md$/, '-chat.md');
}
function _chatPausePath() {
  if (!_chat.artifactPath) return null;
  return _chat.artifactPath.replace(/\.md$/, '-pause.md');
}
// F3: machine-readable session sidecar — replays the real messages
// (code blocks, verdict cards, steering notes) instead of a text blob.
function _chatSessionPath() {
  if (!_chat.artifactPath) return null;
  return _chat.artifactPath.replace(/\.md$/, '-session.json');
}

function _chatSerializeMessages() {
  // Persist only what replay needs: role, text, prepared prompts, verdict
  // cards (pending Accept/Re-run decisions survive a pause), staging state.
  // Attachment payloads stay in the human-readable transcript, not here.
  return _chat.messages.map(m => ({
    role: m.role,
    text: m.text || '',
    codeBlock: m.codeBlock || null,
    stageSavedPath: m.stageSavedPath || null,
    verify: m.verify ? {
      ok: m.verify.ok, shape: m.verify.shape, verdict: m.verify.verdict,
      kind: m.verify.kind, kind_label: m.verify.kind_label,
      hits: m.verify.hits, total: m.verify.total,
      missing: m.verify.missing || [], advice: m.verify.advice || '',
      msgIdx: m.verify.msgIdx, accepted: m.verify.accepted, done: m.verify.done,
    } : null,
    attachments: (m.attachments || []).map(a => ({ name: a.name })),
  }));
}

function _chatScheduleSave() {
  if (!_chat.artifactPath) return;
  clearTimeout(_chatSaveTimer);
  _chatSaveTimer = setTimeout(_chatDoSave, 1200);
}

async function _chatDoSave() {
  const savePath = _chatSavePath();
  if (!savePath) return;
  const now = new Date();
  const stamp = now.toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' });

  const lines = [
    `**Title:** ${escHtml(_chat.artifactTitle || savePath.split('/').pop().replace('.md',''))} — Workflow Session`,
    `**Workflow:** ${_chat.title}`,
    `**Artifact:** ${_chat.artifactPath}`,
    `**Step:** ${_chat.wfStep}`,
    `**Last saved:** ${stamp}`,
    ``,
    `---`,
    ``,
    `## Session Log`,
    ``,
    ..._chat.messages.filter(m => !m.verify || m.text).map(m => {
      const who = m.role === 'agent' ? '### 🤖 Agent' : '### 👤 You';
      const body = (m.text || '').replace(/\r?\n/g, '\n');
      const attach = (m.attachments || []).map(a => `> 📎 ${a.name}`).join('\n');
      const code   = m.codeBlock ? `\n\`\`\`\n${m.codeBlock}\n\`\`\`` : '';
      return `${who}\n\n${body}${attach ? '\n\n' + attach : ''}${code}\n`;
    }),
  ];

  try {
    await apiPost('/file', { path: savePath, content: lines.join('\n') });
    // F3: keep the machine-readable replay sidecar in lockstep so a resume
    // at any moment can restore the real session, not a blob.
    const sessPath = _chatSessionPath();
    if (sessPath) {
      try {
        await apiPost('/file', {
          path: sessPath,
          content: JSON.stringify({
            workflow: _chat.workflowId,
            step: _chat.wfStep,
            saved_at: now.toISOString(),
            messages: _chatSerializeMessages(),
          }, null, 2),
        });
      } catch (_) { /* sidecar is best-effort */ }
    }
    const el = document.getElementById('wf-save-status');
    if (el) el.textContent = `Auto-saved ${stamp}`;
  } catch(e) {
    const el = document.getElementById('wf-save-status');
    if (el) el.textContent = `⚠️ Save failed: ${e.message}`;
  }
}

async function wfPauseHere() {
  const pausePath = _chatPausePath();
  const savePath  = _chatSavePath();
  if (!pausePath) { await renderView('dashboard'); return; }

  // Build comprehensive pause checkpoint document
  const now = new Date();
  const stamp = now.toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' });
  const name  = _chat.artifactTitle || _chat.artifactPath.split('/').pop().replace('.md','');

  const stepDescriptions = {
    'init':               'Workflow initialising — artifact not yet loaded.',
    'routing':            'Detecting artifact type and choosing agent path.',
    'awaiting-doc-synth': 'Waiting for Document Synthesizer output from user.',
    'awaiting-clarification': 'Waiting for Clarification Gate output from user.',
    'awaiting-intent-synth': 'Waiting for Intent Synthesizer output from user.',
    'awaiting-conv-synth': 'Waiting for Conversation Synthesizer output from user.',
    'awaiting-structure':  'Waiting for Structured Account output from user.',
    'awaiting-prd-gate':  'Waiting for PRD Gate output from user.',
    'post-processing':    'Agent output received — awaiting post-processing choice.',
    'inquiry':            'Agent requested clarifications — collecting additional user input.',
    'done':               'Workflow complete.',
    'blocked':            'Workflow blocked — unsupported artifact type.',
  };
  const stepDesc = stepDescriptions[_chat.wfStep] || _chat.wfStep;

  const nextStepGuide = {
    'awaiting-intent-synth': `Run the **Intent Synthesizer** skill prompt shown in the last agent message above. Paste the output into the chat and send.`,
    'awaiting-conv-synth':   `Run the **Conversation Synthesizer** skill prompt shown above. Paste the output into the chat and send.`,
    'awaiting-structure':    `Run the **structure prompt** shown above. Paste the output into the chat and send.`,
    'awaiting-doc-synth':    `Run the **Document Synthesizer** skill prompt shown above. Paste the output into the chat and send.`,
    'awaiting-clarification':`Run the **Clarification Gate** skill prompt shown above. Paste the output into the chat and send.`,
    'awaiting-prd-gate':     `Run the **PRD Gate** skill prompt shown in the last agent message above. Paste the output into the chat and send.`,
    'post-processing':       `Choose one of the post-processing options presented in the last agent message.`,
    'inquiry':               `Type or attach the additional context requested by the agent, then send it.`,
  };
  const lensNoun = (LENS_CONFIGS[_chat.lensKey] || {}).noun || 'Lens';
  const nextGuide = nextStepGuide[_chat.wfStep] || `Resume the workflow from the ${lensNoun} lens and click Continue Workflow.`;

  // Summarise completed steps
  const completedSteps = [];
  const steps = _chat.wfStep;
  if (['awaiting-prd-gate','post-processing','inquiry','done'].includes(steps)) completedSteps.push('✅ Step 1 — Artifact type detected and routed');
  if (['post-processing','inquiry','done'].includes(steps)) completedSteps.push('✅ Step 2 — PRD Gate processing complete');
  if (steps === 'awaiting-intent-synth') completedSteps.push('✅ Step 1 — Artifact type detected (unordered/dictation)');
  if (completedSteps.length === 0) completedSteps.push('⏳ No steps completed yet');

  const transcriptLines = _chat.messages.map(m => {
    const who  = m.role === 'agent' ? '#### 🤖 Agent' : '#### 👤 You';
    const body = (m.text || '').replace(/\r?\n/g, '\n');
    const code = m.codeBlock ? `\n\`\`\`\n${m.codeBlock}\n\`\`\`` : '';
    return `${who}\n\n${body}${code}`;
  }).join('\n\n---\n\n');

  const pauseDoc = [
    `**Title:** ${name} — Pause Checkpoint`,
    `**Workflow:** ${_chat.title}`,
    `**Artifact:** ${_chat.artifactPath}`,
    `**Step:** ${_chat.wfStep}`,
    `**Paused:** ${stamp}`,
    ``,
    `---`,
    ``,
    `## Task at Hand`,
    ``,
    `Processing the ${lensNoun.toLowerCase()} **"${name}"** through the **${_chat.title}** workflow.`,
    `The session artifact lives at \`${_chat.artifactPath}\`.`,
    ``,
    `---`,
    ``,
    `## Progress So Far`,
    ``,
    ...completedSteps.map(s => `- ${s}`),
    ``,
    `**Current state:** ${stepDesc}`,
    ``,
    `---`,
    ``,
    `## How to Resume`,
    ``,
    `1. Open the **${lensNoun}** lens from the left navigation.`,
    `2. Click on **"${name}"** in the list.`,
    `3. Click **▶ Continue Workflow**.`,
    `4. ${nextGuide}`,
    ``,
    `---`,
    ``,
    `## Artifact Reference`,
    ``,
    `- **Path:** \`${_chat.artifactPath}\``,
    `- **Type:** ${_chat.artifactMeta?.type || 'unknown'}`,
    ...(savePath ? [`- **Session log:** \`${savePath}\``] : []),
    ``,
    `---`,
    ``,
    `## Full Session Transcript`,
    ``,
    transcriptLines,
  ].join('\n');

  try {
    // Save the pause checkpoint, the human-readable transcript, and the
    // machine-readable replay sidecar simultaneously (F3).
    const sessPath = _chatSessionPath();
    await Promise.all([
      apiPost('/file', { path: pausePath, content: pauseDoc }),
      savePath ? apiPost('/file', { path: savePath, content: await _chatBuildTranscript(stamp) }) : Promise.resolve(),
      sessPath ? apiPost('/file', { path: sessPath, content: JSON.stringify({
        workflow: _chat.workflowId,
        step: _chat.wfStep,
        saved_at: now.toISOString(),
        messages: _chatSerializeMessages(),
      }, null, 2) }) : Promise.resolve(),
    ]);
    toast('⏸ Progress saved — returning to Dashboard');
    setTimeout(() => renderView('dashboard'), 800);
  } catch(e) {
    toast(`⚠️ Could not save pause checkpoint: ${e.message}`, true);
  }
}

async function _chatBuildTranscript(stamp) {
  const lines = [
    `**Title:** ${_chat.artifactTitle || ''} — Workflow Session`,
    `**Workflow:** ${_chat.title}`,
    `**Artifact:** ${_chat.artifactPath}`,
    `**Step:** ${_chat.wfStep}`,
    `**Last saved:** ${stamp}`,
    ``,
    `---`,
    ``,
    `## Session Log`,
    ``,
    ..._chat.messages.filter(m => !m.verify || m.text).map(m => {
      const who  = m.role === 'agent' ? '### 🤖 Agent' : '### 👤 You';
      const body = (m.text || '').replace(/\r?\n/g, '\n');
      const code = m.codeBlock ? `\n\`\`\`\n${m.codeBlock}\n\`\`\`` : '';
      return `${who}\n\n${body}${code}\n`;
    }),
  ];
  return lines.join('\n');
}

function _chatTypingHtml() {
  return `<div class="wf-bubble-row agent">
    <div class="wf-bubble-label">🤖 Agent</div>
    <div class="wf-bubble agent wf-typing">
      <div class="wf-dot"></div><div class="wf-dot"></div><div class="wf-dot"></div>
    </div>
  </div>`;
}

function _chatScrollBottom() {
  requestAnimationFrame(() => {
    const t = document.getElementById('wf-thread');
    if (t) t.scrollTop = t.scrollHeight;
  });
}

// ── File attachment ─────────────────────────────────────────────────────────

function _chatPickFile() { /* native file input handles it */ }

function _chatHandleFiles(files) {
  if (!files || files.length === 0) return;
  Array.from(files).forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      _chat.pending.push({ name: file.name, content: e.target.result });
      _chatRenderPending();
    };
    reader.onerror = () => toast(`Could not read ${file.name}`, true);
    reader.readAsText(file);
  });
  // Reset so the same file can be re-selected
  const inp = document.getElementById('wf-file-input');
  if (inp) inp.value = '';
}

function _chatRenderPending() {
  const el = document.getElementById('wf-pending');
  if (!el) return;
  el.innerHTML = _chat.pending.map((a, i) =>
    `<span class="wf-pending-chip">📎 ${escHtml(a.name)}<span class="rm" onclick="_chatRemoveAttachment(${i})">×</span></span>`
  ).join('');
}

function _chatRemoveAttachment(i) {
  _chat.pending.splice(i, 1);
  _chatRenderPending();
}

// ── Speech to text ──────────────────────────────────────────────────────────

function _chatToggleSpeech() {
  if (_chat.speechOn) {
    _chatStopSpeech();
  } else {
    _chatStartSpeech();
  }
}

function _chatStartSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('Speech recognition is not available in this browser.', true); return; }

  const recog          = new SR();
  recog.continuous     = true;
  recog.interimResults = true;
  recog.lang           = 'en-US';

  let committed = ''; // text already appended to textarea before this session

  recog.onstart = () => {
    _chat.speechOn = true;
    const btn = document.getElementById('wf-mic-btn');
    if (btn) btn.classList.add('recording');
    const el = document.getElementById('wf-input');
    committed = el ? el.value : '';
  };

  recog.onresult = e => {
    let interim = '';
    let final   = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) final += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    if (final) committed += (committed && !committed.endsWith(' ') ? ' ' : '') + final.trim();
    const el = document.getElementById('wf-input');
    if (el) {
      el.value = committed + (interim ? ' ' + interim : '');
      _chatAutoResize(el);
    }
  };

  recog.onerror = e => {
    if (e.error !== 'aborted') toast(`Speech error: ${e.error}`, true);
    _chatStopSpeech();
  };

  recog.onend = () => _chatStopSpeech();

  _chat.speechRecog = recog;
  recog.start();
}

function _chatStopSpeech() {
  _chat.speechOn = false;
  const btn = document.getElementById('wf-mic-btn');
  if (btn) btn.classList.remove('recording');
  if (_chat.speechRecog) {
    try { _chat.speechRecog.stop(); } catch(e) {}
    _chat.speechRecog = null;
  }
}

// ── Utilities ──────────────────────────────────────────────────────────────

function setTopbarAction(html) {
  document.getElementById('topbar-actions').innerHTML = html;
}

// ── F10: Auto-classification at ingest ────────────────────────────────────
// The lens system's own philosophy: classification is agent work. The UI
// used to ask the human to classify their own thought at every ingest
// surface. Now the machine infers from the text itself and the human only
// confirms-or-corrects — and their correction is final (state is sticky).
//
// Backend: POST /classify {content, filename} -> {type, confidence, basis}

const _TYPE_ICONS = {
  unordered: '📝', formatted: '📄', dictation: '🎤',
  media: '🎬', application: '📦', code: '💻',
};

// One live state object per ingest surface (rebuilt each render).
let _classifySurfaces = {};

// Debounced classification per surface. state:
//   { selectId, hintId, seq, touched, timer, lastKey }
async function _classifyRun(surface) {
  const selectEl = document.getElementById(surface.selectId);
  if (!selectEl) return;
  const contentEl = document.getElementById(surface.contentId);
  const content = contentEl ? contentEl.value : '';
  const filename = surface.filename || '';
  const key = content.length + ':' + content.slice(0, 200) + ':' + filename;
  if (key === surface.lastKey) return;   // nothing changed since last run
  surface.lastKey = key;

  // Skip near-empty input — don't classify ghosts
  if (content.trim().length < 12 && !filename) {
    _classifyHint(surface, '');
    return;
  }

  const mySeq = ++surface.seq;
  try {
    const r = await apiPost('/classify', { content, filename });
    if (mySeq !== surface.seq) return;   // a newer input superseded us
    if (!r.type) return;
    if (!surface.touched) {
      selectEl.value = r.type;
      // some surfaces may lack an option (desk has no 'application')
      if (selectEl.value !== r.type) selectEl.value = 'unordered';
      // keep local state in sync for surfaces that read a JS var
      if (surface.onClassified) surface.onClassified(selectEl.value);
    }
    _classifyHint(surface, r);
  } catch (e) { /* classification is advisory — never block ingest */ }
}

function _classifyHint(surface, r) {
  const el = document.getElementById(surface.hintId);
  if (!el) return;
  if (!r || !r.type) { el.innerHTML = ''; return; }
  const icon = _TYPE_ICONS[r.type] || '📄';
  const conf = r.confidence === 'high' ? '' :
    ` <span style="opacity:.7">(${r.confidence})</span>`;
  const basis = (r.basis || []).map(b => escHtml(b.split(': ').slice(1).join(': '))).join(' · ');
  el.innerHTML = `${icon} detected <strong>${r.type}</strong>${conf}${basis ? ` — ${basis}` : ''}`;
}

function _classifyWire(surface, extra) {
  const fire = () => _classifyTrigger(surface);
  const contentEl = document.getElementById(surface.contentId);
  if (contentEl) contentEl.addEventListener('input', fire);
  const selectEl = document.getElementById(surface.selectId);
  if (selectEl) {
    selectEl.addEventListener('change', () => {
      surface.touched = true;   // human override wins — stop auto-setting
      if (surface.onClassified) surface.onClassified(selectEl.value);
    });
  }
  if (extra) extra(fire);
  fire();
}

function _classifyTrigger(surface) {
  clearTimeout(surface.timer);
  surface.timer = setTimeout(() => _classifyRun(surface), 350);
}

function parseMarkdownMeta(content) {
  const meta = {};
  for (const line of content.split('\n')) {
    const m = line.match(/^\*\*(\w[\w\s]+):\*\*\s*(.+)/);
    if (m) {
      const key = m[1].toLowerCase().replace(/\s+/g,'_');
      meta[key] = m[2].split('<!--')[0].trim();
    }
  }
  // Normalize status
  if (meta.status) {
    meta.status = meta.status.toLowerCase().split(/\s/)[0];
  }
  // Parse confidence
  if (meta.confidence) {
    meta.confidence = parseFloat(meta.confidence) || undefined;
  }
  return meta;
}

// ── Boot ───────────────────────────────────────────────────────────────────

(async () => {
  try {
    await renderView('dashboard');
  } catch (e) {
    document.getElementById('content-area').innerHTML =
      `<div class="card" style="color:#dc2626;max-width:480px">
        <h3 style="margin-bottom:8px">⚠️ Cannot reach Prism API</h3>
        <p style="font-size:13.5px">Make sure the backend is running:<br>
        <code style="background:#f3f4f6;padding:2px 6px;border-radius:4px">python prism\\api-server.py</code></p>
      </div>`;
  }
})();
