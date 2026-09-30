# UI Friction Audit — Session 1 baseline

*Light through glass meets almost no resistance. Audit of the existing
SPA (prism/index.html, 2,753 lines) against that principle: what was
already friction-removed, and where the work had not yet converged.
This is the baseline for the UI iteration discussion.*

---

## Already friction-removed (implemented and working)

### Ingest surface — the most polished area
- Drag-and-drop zone with click-to-browse fallback.
- Auto-title from filename; auto-type-detection from extension and
  name hints (dictation/transcript/voice in the name → dictation).
- 🎲 Auto Name button — naming friction deliberately removed.
- Private toggle whose label text *describes its consequence* ("Off —
  file will be included in repo syncs") — the control explains itself.
- Form self-resets after submit; no stale state.
- Inline hint: "Becomes the filename. Be specific — you'll search for
  this later" — teaches the consequence at the point of decision.

### Wizard — inline escape hatches
- **Quick-ingest inside Step 2**: arriving at "choose seed" with no
  artifact lets you ingest inline and auto-select — no context switch
  back to the Ingest page. The single best friction removal in the app.
- Default workflow auto-selected in Step 3; the picker exists but the
  common path requires zero decisions.
- Sub-asset picker excludes already-chosen items; chips with × removal.
- Enter advances Step 1 and sends chat messages.

### Chat surface — the deepest investment
- Auto-resizing textarea.
- Auto-save of the transcript every 1.2s (debounced) — there is no
  Save action anywhere in the flow.
- **Pause Here** writes a comprehensive checkpoint document: current
  step, plain-language step description, next-step guide, how-to-resume.
  Resume restores the workflow step and presents the prior context.
- Speech-to-text input (webkitSpeechRecognition) — dictation as a
  first-class input mode.
- File attachments in chat.
- Post-processing options rendered as **buttons** (A–E), not typed
  choices.
- Skill prompts rendered in code blocks with an explicit label:
  "📋 COPY THIS PROMPT → paste into your AI agent."
- Lens files open read-only with action buttons (Continue / Emit /
  Delete) — no raw-edit affordance to corrupt them; non-lens files
  get Edit/Save/Cancel.
- Destructive actions (delete, emit) carry confirmation cards.

### Dashboard
- Dwell bars with per-bucket tooltips and a gradient legend —
  information density without clicks.

Also on record: the `.wf-icon-btn` CSS regression fix (hidden file
input covering the input row) documented in COPILOT-CONTEXT — evidence
that friction debugging was already an active practice.

---

## Not yet converged (friction remaining)

### F1 — No copy button on prompt code blocks · CORE-LOOP FRICTION
The entire execution model is copy-prompt → paste → paste-output, yet
the user must manually select text inside a `<pre>` block. Zero
clipboard references in the codebase. This is the highest-friction
point in the loop the product is built around.

### F2 — No paste-back verification ✅ resolved 24 Aug 2026
~~Any text is accepted as skill output; the state machine advances on
faith. No structural sanity check (e.g., Intention Block headers,
Inquiry-vs-Execution labels) before routing to the next step. Silent
advancement on garbage input is scattered light.~~

**Fix:** `POST /verify` — deterministic shape checks against the output
contracts already declared in the skill files (no LLM). Every
paste-back in the requirements / rationalizations / hypotheses
workflows is now verified before the state machine advances:
`match` auto-advances and records a green verdict card; `partial` /
`unrecognized` stop the flow and offer two steering doors — Accept
anyway (content is the human's to steer) or Re-run the skill with a
steering note appending the missing sections to the prompt. PRD Gate
Inquiry outputs are now detected and routed to the inquiry step
instead of being treated as a completed PRD. Accepted terminal output
is written into the lens file with `**Status:** review` per the
skill files' Output Handling rules. Verified end-to-end by
`scripts/e2e-verify.js` (21 checks).

### F3 — Shallow resume fidelity ✅ resolved 24 Aug 2026
~~The pause checkpoint document is excellent, but the UI restore presents
the prior session log as one context blob rather than replaying the
messages. The user must scroll to find where they left off. Good
checkpoint, minimal restoration.~~

**Fix:** resume now replays the real session. A machine-readable sidecar
(`<lens>-session.json`, written in lockstep with the 1.2s auto-save and
by Pause Here) stores the messages that matter: text, prepared prompts,
staging state, and F2 verdict cards — pending Accept/Re-run doors stay
live across a pause. One shared `_wfResumeFromPause()` serves all three
runners (rationalizations previously ignored the pause file entirely;
hypotheses only restored post-processing). Resume restores the paused
step and re-issues exactly the prompt that step needs when the
scrollback doesn't already end with one. Sidecar hygiene: hidden from
/tree and lens lists, travels into the emission on Emit, deleted with
the lens. Verified by `scripts/e2e-verify-f3.js` (29 checks).

### F4 — Title still required in wizard Step 1
Auto Name exists but is a button press, not a default. Every lens item
demands a naming decision before anything else happens. (Contrast the
grind-loop finding: naming should be easy — here it gates the flow.)

### F5 — No search, no keyboard navigation ✅ resolved 24 Aug 2026
~~Only two keyboard handlers exist (Enter in two fields). No global
search across the vault, no keyboard-driven navigation. As the lens
library and emissions grow, findability becomes the dominant friction.~~

**Fix:** one palette over the whole vault, reachable by Ctrl+K (or Cmd+K)
from anywhere or the topbar button. Backend `GET /search?q=&scope=` —
deterministic full-text scan (no index, no LLM): every term must appear
(AND), scored filename > frontmatter head > content, with one-line
snippets. Machinery stays invisible: `_templates` and session sidecars
never surface. Frontend: 150ms-debounced live results with stale-query
race guard, ↑↓/Enter/Esc keyboard navigation, term highlighting
(escaped — no HTML injection), and per-hit routing: lens files open in
their own view panel; generic vault files (emissions, prompts,
ingestion…) land in the knowledge viewer with the topbar retitled to
the file's real home (GN-009). Verified end-to-end by
`scripts/e2e-verify-f5.js` (36 checks).

### F6 — Desktop-only assumption ✅ closed by design 24 Aug 2026
~~Zero @media queries anywhere. Whether this is a defect depends on use
context; as stated, the glass only exists on wide screens.~~

**Decision:** Prism is desktop-local by design, and stays that way.
Mobile users don't run Prism on a phone — they wouldn't have a
local model of any useful size there anyway; they grab the *emitted
artifacts* from a website instead. The emitted markdown files are the
mobile deliverable; the workbench is the desktop artifact. Not a
defect, not a TODO — a scope boundary.

### F7 — The front door is PM-era chrome
The dashboard leads with dwell-time bars and review counts — metrics of
the old framing. Under the pivot, the front door should be a single
input surface ("bring fog, get focus"), not a status board. Related:
there is no single "start here" affordance — new items are reached via
per-lens nav + per-lens New buttons. Multiple doors = decision friction.

### F8 — Dead button: Option E ✅ resolved 24 Aug 2026
~~"Archive and emit to integration" exists as a button that replies
"not yet configured." A dead control violates GN-006 in UI form —
every visible affordance should leave the user holding a next action,
and a button that leads nowhere is friction of the worst kind.~~

**Fix:** the button is removed entirely. The door does not exist until
an integration is configured — then it reappears as a live affordance
(delivery-channel / emission-focal-point architecture: doors appear
when they can be opened, never as dead placeholders).

### F9 — Duplicated ingest paths with silent divergence ✅ resolved 24 Aug 2026
~~The Ingest page and the wizard quick-ingest are near-duplicate forms —
and they have already diverged: quick-ingest hardcodes `is_private:
false`. The private option is silently unavailable on the wizard path.
Duplication is maintenance friction that becomes user-visible drift.~~

**Fix:** three divergent forms became one shared path with explicit
decisions. `ingestArtifact()` is now the ONLY way an artifact enters
the vault (one `/ingest` call site in the whole SPA); every surface
passes an explicit `is_private` it owns — there is no default. The
desk and wizard quick-ingest gained visible private checkboxes (the
privacy boundary they had silently lost), the Ingest page keeps its
toggle. The three inline FileReader copies collapsed into one shared
`readTextFile()` loader. Private artifacts get the `-private` suffix,
`**Private:** yes` header, and no `source/` mirror — verified end-to-end
by `scripts/e2e-verify-f9.js` (35 checks). F10 had already unified the
type-classification rule across the three surfaces; F9 unifies the
payload and the privacy boundary.

### F10 — Self-classification at ingest ✅ resolved 24 Aug 2026
~~The human must classify their own artifact (formatted / unordered /
dictation / …). File-based detection exists; pasted text gets no
inference. The lens system's own philosophy says classification is
agent work — the UI asks the human to do it.~~

**Fix:** `POST /classify` — deterministic type inference from the text
itself plus filename (no LLM): code-shaped lines, CSV/tabular rows,
markdown headers/bullets, numbered lists, spoken-fillers for
dictation, prose-sentence density for unordered; every verdict carries
a human-readable basis. All three ingest surfaces (refraction desk,
legacy Ingest page, wizard quick-ingest) now share this ONE backend
rule — the three divergent hardcoded extension lists are deleted. As
you type, the type select fills itself and a hint shows the reasoning;
a manual override is sticky — the machine stops second-guessing once
the human has spoken. Verified end-to-end by
`scripts/e2e-verify-f10.js` (29 checks), including the inferred type
landing in the saved artifact's provenance header.

### F11 — Maintainer friction ✅ resolved 24 Aug 2026
~~One 2,753-line HTML file containing all JS and CSS. Syntax checking
requires extracting the script block and running node on it (per
COPILOT-CONTEXT). Editing the machine is itself high-friction.~~

**Fix:** the working definition of "self-contained" was settled first —
*copy the directory, it runs* — and three files satisfy that as well as
one. The SPA is now `prism/index.html` (structure, 104 lines) +
`prism/prism.css` (all component styles) + `prism/app.js` (all logic),
linked with plain `<link>` / `<script src>` — no build step, no npm,
served byte-identical behind both Caddy and Apache. `app.js` is now
directly `node --check`-able; every e2e harness loads it as a real file
instead of extracting an inline block. The single-file form survives as
the story of the tool; the machinery got honest. All five regression
suites re-run green against the split build.

### F12 — Cross-origin write hole in the API ✅ resolved 26 Sep 2026
~~The API answered every request with `Access-Control-Allow-Origin: *` and
checked no `Origin` at all. Any web page open in a browser on the same
machine could POST to `/file` and write arbitrary files inside the vault —
including `knowledge/resources/skills/`, which is prompt text the user's own
agent later executes, so the reachable surface included the optics
themselves. Reads leaked the vault the same way.~~

**Fix:** the API serves same-origin only and emits no CORS headers. A request
carrying `Origin` must match the host it was sent to; a request with no
`Origin` is a local tool (curl, the harnesses) and is allowed. Guards POST,
DELETE and OPTIONS, and drains the request body on rejection so a refused
request does not poison the next one on a keep-alive connection. Loopback
name aliases are allowed only on the *same port* — a page served from
`127.0.0.1:8092` is a different origin from the API on `:8090`, and treating
"loopback" as sufficient would have let any other local process write to the
vault. Documented in README under "Security posture". Verified by
`scripts/e2e-verify-f12.js` (30 checks).

**Also in this pass:** `safe_path()` had a broad `except (ValueError,
Exception)` that masked every failure as "Path not allowed" — narrowed to the
three exceptions it can actually raise.

**Not changed, deliberately:** `/file` POST has no folder allowlist, unlike
DELETE. The Knowledge Base convention is that agents author
`knowledge/resources/skills/` content files, so restricting writes would
break documented behavior. The CORS fix addresses the unauthorized-writer
problem without narrowing the authorized one.

### F13 — Unpinned CDN dependency ✅ resolved 26 Sep 2026
~~`prism/index.html` loaded marked from
`https://cdn.jsdelivr.net/npm/marked/marked.min.js`. Three problems with
one line: the README claimed "no cloud dependency" while the app needed the
network to render markdown at all; the URL was **unpinned**, so the version
silently drifted under the user (it served 15.0.12 while `latest` was
18.0.14) with no way to know what code had shipped; and it broke the
"copy the directory, it runs" definition F11 settled on. Invisible to the
friction lens too — the viewer worked fine on any machine that happened to
be online, which is exactly why nobody hit it.~~

**Fix:** marked is vendored at `prism/vendor/marked.min.js`, pinned to
15.0.12, with its MIT licence and full provenance (source, sha256, upgrade
procedure) in `prism/vendor/README.md`. The file is byte-identical to the
copy in the official npm tarball, cross-checked against two independent
sources. No build step, no npm, no network.

**New regression suite** `scripts/e2e-verify-f13.js` (21 checks) — asserts
no external URL survives in any shipped file, the vendored bytes match the
recorded sha256, and the render path still works. That render path
(`marked.parse` in `app.js`) had **no coverage at all** before this, so the
suite closes that gap too — eight markdown shapes including tables, which
vault files use heavily, plus a real vault file end to end. Verified the
suite has teeth in both directions: restoring the CDN tag fails 4 checks;
tampering with the vendored file fails the sha256, version and render checks.

### F14 — Markdown viewer does not sanitize ✅ resolved 26 Sep 2026
~~marked v15 does not sanitize: raw HTML in a vault file is passed through
verbatim, and `javascript:` URLs are not filtered. Both confirmed by direct
test. This is **pre-existing** — identical with the CDN version — and is not
introduced by F13. Today it is not a privilege boundary: vault content is
authored by the user and by their own agent, and the F12 guard means no
arbitrary web page can write to it. It becomes one if the vault ever ingests
genuinely untrusted input (a shared team repo, a third-party transcript).~~

**Fix:** both render paths now go through `renderMarkdown()` in `app.js`,
which applies a two-rule marked renderer override:

1. **Raw HTML is dropped, not escaped.** Vault markdown is written in
   markdown; anything else is noise or an injection attempt. No vault file
   relies on raw HTML — grepped, zero hits.
2. **Link schemes restricted.** `http(s)`, protocol-relative, and
   site-relative (leading `/`, `#`, `?`) hrefs all stay inside Prism's own
   origin and keep working as real anchors — vault files cross-reference each
   other that way. Any href with an explicit non-http scheme
   (`javascript:`, `data:`, `vbscript:`, `file:`) renders as inert text: the
   words survive, the navigation does not, and a `.md-link-blocked` style
   makes the degradation legible rather than mysterious.

Deliberately **not** a sanitizer dependency. A sanitizer is the thorough
answer, but it would reopen the "one vendored library" position F13 just
settled, and marked's own extension point closes the actual vectors with two
rules. The href is attribute-escaped, so a quote in a URL cannot break out
and become a second attribute.

**Measured blast radius: 49 vault files rendered, 0 differ** from stock
marked. (An earlier estimate of 8 files differing was measured against a
config that also stripped HTML comments; with comments left to marked's
default behaviour the hardened output is byte-identical on all 49.)

**New regression suite** `scripts/e2e-verify-f16.js` (44 checks) — asserts
the hardening is wired in, neutralizes 11 distinct vectors, preserves 10
normal markdown shapes plus all four legitimate link forms, round-trips an
attribute-escaping edge case, and holds the full-vault render baseline. It
loads `renderMarkdown()` out of the shipped `app.js` rather than testing a
copy, so the suite cannot pass against code the app does not run. Teeth
verified both ways: restoring raw HTML fails 8 checks, and reinstating a
direct `marked.parse` call site fails 2.

**One real bug found by the suite while writing it:** the first version of
the scheme rule allowed only `http(s)`, which silently broke every
site-relative link in the vault. Caught before commit, not shipped.

### F15 — Agent and workflow docs describe a door the UI removed ✅ resolved 26 Sep 2026
~~F8 removed the "Archive and emit to integration" button on 24 Aug 2026 and
deleted `wfOptE()` with it, because no integration was configured. **None of
the six documents describing that menu were updated.** All three agent
definitions and all three workflow READMEs still specified Options A–E,
including the execution table, the handoff table, and the capability line.

This was user-facing drift, not internal tidiness: these are the files a
human copies into their own agent, so an agent reading this vault would
offer Option E — a door Prism cannot open. F8's own law (no dead
affordances) was being violated by the documentation of the fix that
removed it.~~

**Three defects in one pass**, all doc-truth corrections:

1. **Option E described as live** in all six files — menu block, execution
   table, handoff table, and the "Options A–E" capability line. Now A–D, with
   an explicit statement of *why* E is absent (no integration configured, so
   per F8/GN-006 the door does not exist) and that it returns when one is.
   Also fixed "Do NOT offer Option A or Option E" in the rationalizations
   handoff gate and "upon Option A or E selection" in two Notes sections.
2. **"Future: wire real LLM API calls"** in all three agent definitions —
   contradicting the README and the "lens, not the laser" tenet. Replaced
   with an explicit statement that Prism never calls a model and this is a
   design constraint, not a missing feature, so the question stops being
   re-asked. The claim also contained a fiction: a "placeholder 800ms
   response" that does not exist anywhere in the code (the real delay is a
   600ms typing-latency affordance in `_chatSend`).
3. **Nonexistent path** `vault/knowledge/integrations-config/` referenced in
   all three workflow READMEs. The real path is `vault/knowledge/integrations/`.

**New regression suite** `scripts/e2e-verify-f15.js` (57 checks) — derives
ground truth from `app.js` (which buttons actually exist), then asserts every
document matches it, plus a vault-wide scan and a premise check that no
integration config exists. It has teeth both ways: reintroducing Option E
fails 1 check, reintroducing the bad path fails 2.

### F17 — One door: the Lens Wizard is retired ✅ resolved 27 Sep 2026
~~F7 made the Crafting Table the front door, but the three-step Lens Wizard
survived behind six "＋ New …" buttons (topbar and empty state, one pair per
lens). Two ways to create a lens, one of them three screens long, requiring a
title the machine can derive. The wizard's step 3 was also the only place a
non-default workflow could be chosen.~~

**Decided:** the Crafting Table is the one door. Decision recorded by the
maintainer; this entry records what it cost and what it bought.

**Removed:** 601 lines — `_wiz` state, `_startWizard`, the three `new*()`
entry points, and all three step renderers with their handlers.

**Rewritten rather than deleted — Option C.** Post-processing "C — send to
another workflow" re-opened wizard step 3, so deleting the wizard would have
silently broken it. It now reads `GET /workflows`, lists the other workflows,
and launches the chosen one with the artifact pre-loaded. Same behaviour,
new home, plus a way back to the desk.

**Lens views keep their job.** Requirements / Hypotheses /
Rationalizations are for *working* lenses — open, ▶ Continue Workflow, emit,
delete — and all of that is untouched. Only creation moved. Their empty
states and topbar now point at the Crafting Table rather than offering a
second creation path, so every view still hands the human a next action
(GN-006) without re-scattering entry points.

**The dead `/status` endpoint went with it.** Nothing consumed it — the desk
reads `/lenses`. What remained counted `stakeholder_count` and
`days_since_sweep` against vault folders that are permanently empty, plus a
dwell histogram whose UI F7 had already removed. Counting nothing and
labelling it a metric is GN-005 (declaring a focal point that does not
exist). Removed: `get_status()`, the route, `HYPOTHESIS_STATUSES`.

**The gap this exposes, made visible (option D).** Retiring the wizard
removed the only door to `ux-bridge-default`, which has an agent definition,
a skill and an 11-field process doc but **no runner in `app.js`**. So:

- Workflow runner ids now live in one `_WF_RUNNERS` registry; both dispatch
  sites resolve through it instead of hardcoding three ids inline.
- The Workflows view labels every definition **▶ runnable** or
  **⚠️ defined, not yet runnable**, from that same registry — so a definition
  without a runner can no longer look live (GN-005).
- A chat opened for a runnerless workflow now says so plainly and names the
  fix, instead of claiming the integration "is still being configured".

Writing a runner makes the badge clear itself. Same door discipline F8
applied to the integration option.

**Also fixed in passing:** `.badge.warn` was used throughout `index.html` but
never defined in any stylesheet, so those badges rendered unstyled. Defined,
along with `.badge.ok`.

**New suite** `scripts/e2e-verify-f17.js` (49 checks) — wizard gone with no
dangling references, Option C rebuilt, registry is the single source of truth
with every registered function verified to exist, badge reads the registry
rather than an exclusion list, and the dead counters are gone while
`/lenses`, `/workflows` and `/ingest` survive. Teeth verified: injecting four
regressions (a wizard ghost, a hardcoded dispatch, a fake registry entry)
fails 4 checks.

**Two pre-existing suites had to change, honestly:**

- `e2e-verify-f12.js` probed `/status` for its CORS checks. Removing the
  endpoint broke it — **a regression I introduced and caught**, repointed to
  `/lenses`.
- `e2e-verify-f9.js` had a whole section exercising wizard quick-ingest
  against the live backend. The surface no longer exists, so the section was
  **deleted, not skipped** — a skip would read as coverage that is still
  there. F9's law is unchanged and still asserted: one ingest path, one
  private decision, now over the two remaining surfaces.

### F18 — The Ingest page retired; staging folded into the desk ✅ resolved 27 Sep 2026
~~The standalone Ingest page survived F17's wizard retirement as the sidebar's
"Enlighten" section — duplicating the desk's file input, title handling, type
inference and private toggle, and offering a second way to do the same thing.~~

**But it was not a duplicate, and that is the finding.** `submitIngest()`
wrote to `ingestion/unprocessed/` and **stopped**. The desk always continued:
ingest → create lens → launch the chat. So the Ingest page was the
**staging buffer** — the only way to hold raw thought without processing it.

And staging was broken: the queue was **write-only**. The Ingest page could
fill it; the wizard's step-2 artifact picker (retired in F17) was the only
thing that could read it. Delete the page and staged thought had nowhere to
go and no way back.

**Fix — move the capability, then delete the surface:**

- `deskStageOnly()` — the desk's new "📥 Not yet — just hold it in the queue"
  door. Ingests through the same shared builder with an explicit
  `is_private`, clears the desk, leaves the human with the next thought.
- **The desk now lists the queue**, with Load and Discard per row. This part
  did not exist anywhere before.
- `_rawIngestBody()` unwraps a queued artifact back to raw thought. A queued
  file is a full ingest document — H1 title, `**Key:** Value` provenance
  header, dividers, empty annotation stubs — so loading it verbatim would
  have double-wrapped the thought on re-submit.
- Discard confirms first, and states that a public artifact's immutable
  source copy is **retained**, because `DELETE` cannot reach `source/`.
  Saying so beats implying the delete was total.

Removed: `renderIngest`, `submitIngest`, `togglePrivate`, `handleFileSelect`,
the `_isPrivate` state, the desk's duplicate `_qiPrivate` flag, the "Enlighten"
sidebar section, and the orphaned `.drop-zone` / `.dz-*` styles.

**Repaired in the same pass:** post-processing Option D ("return to
Unprocessed queue") called `renderView('ingest')` — a page this change
deletes. It now lands on the Crafting Table, which is where the queue is
visible. Found by grepping for the retired view, not by the compiler.

**New suite** `scripts/e2e-verify-f18.js` (14 checks) drives staging
end-to-end against the live backend, including that a loaded artifact
round-trips **without** its ingest wrapper and that the source copy survives a
discard. `e2e-verify-f17.js` grows to 71 checks covering the retirement and
the replacement.

**Two pre-existing suites tested the deleted page.** Both had dead blocks
**deleted, not skipped** — F9's Ingest section, and F10's "all three surfaces
share one rule", which now asserts the desk *is* the rule and that the retired
surfaces are gone. Both laws still hold and are still driven live: F9 submits
private and public artifacts and asserts the suffix, header and mirror
behaviour; F10 drives a real classification to a real verdict.

**The two read the maintainer's framing on `knowledge/integrations/`:** that
folder is a declared extension point, primarily for outputs, open to inputs
too — not inert scaffolding. Option E is therefore absent *by design* rather
than by omission, which is what F15's wording already says. Recorded here so
a future session does not "clean up" that folder again.

**Still open, and a real gap rather than debt:** external documents cannot be
ingested. Both surfaces accept `.md .txt .csv .json .rtf` and read via
`readAsText()`, so a PDF, DOCX or HTML file cannot be brought in at all.
Parsing those means either a dependency (which F13 just settled against) or a
conversion step — a piece of work, not a cleanup. Not started.

### F19 — A real browser check; two rendering bugs only a DOM could find ✅ resolved 27 Sep 2026
~~Every other suite drives `app.js` in a Node VM with a stubbed DOM. That is
fast and honest about application logic, but a stub cannot tell you whether
the page RENDERS: whether a relative `<script src>` resolves, whether a
stylesheet applies, whether an `onclick` reaches a global, whether markdown
becomes real elements. Those were exactly the things F17/F18 changed, and
exactly what nothing covered.~~

**Fix:** `scripts/e2e-verify-f19.js` (44 checks) runs the SPA in **real
Chrome** over the DevTools Protocol, driving it through real clicks. No npm
dependency — `scripts/lib/cdp.js` is a small stdlib WebSocket/CDP client, so
the stdlib-only constraint holds. It uses the Playwright-cached Chrome for
Testing binary, or any Chrome via `PRISM_CHROME`.

**It immediately found two real bugs, both invisible to every other check:**

1. **Empty lens badges rendered a dash instead of `0`.** `updateBadges()` used
   `b.requirements || '–'`, and `0` is falsy — so a fresh install showed three
   dashes where it should have shown three zeros. The API was returning
   `requirements: 0` the whole time; the badge lied about it. Now only
   `null`/`undefined`/`''` mean "not loaded".
2. **The "not yet runnable" tooltip silently truncated.** The title was
   written as a multi-line template literal with a trailing `+`, which puts a
   literal **newline inside the HTML attribute**. The browser ends the
   attribute value at the line break, so the tooltip stopped mid-sentence. The
   source reads perfectly; only a rendered DOM shows it. Now a single-line
   string, passed through `escHtml`.

Both shipped in F17 and are exactly the class of defect a stubbed DOM cannot
catch: a falsy-zero coercion, and a newline inside an attribute.

**One more, in the test harness itself:** my first front door (used because
port 80 needs root) stripped the `Host` header when proxying, which made
F12's same-origin guard reject the real app's own browser requests. That is
worth recording — **the guard's Host-preservation requirement is a real
deployment constraint, not a theoretical one.** Both shipped front doors
satisfy it (`ProxyPreserveHost On` / Caddy default); anything that does not
will break the app. F19 now runs against a front door that preserves Host, and
the README's security-posture section already warns about it.

**Coverage added:** the page boots with no console errors and no uncaught
exceptions; all scripts are same-origin; the stylesheet applies; the sidebar
is exactly the six expected views with the retired Ingest item gone; the desk
renders all its doors; **staging works through real clicks** (type → stage →
queue card appears → load → raw thought returns without its ingest wrapper →
discard); markdown becomes real elements and F14's hardening holds in a real
DOM (`<img onerror>` stripped, `javascript:` link inert, no XSS executed);
and the Workflows view labels runner status from the registry.

Teeth verified: restoring the CDN `<script src>` fails 2 checks.

**Note on exit codes:** `3` means "no browser available" — distinct from `1`
("checks failed") — so a missing Chrome is never mistaken for a regression.

### F20 — UX Bridge runner written; the last declared-but-unrunnable workflow is now real ✅ resolved 27 Sep 2026
~~`ux-bridge-default` was the one workflow in the vault with a complete
definition, an agent spec, a skill and an 11-field process document — and no
runner in `app.js`. F17 made that honest by labelling it
**⚠️ defined, not yet runnable**, which is the correct state for a capability
that does not exist. This entry records writing the runner.~~

**What makes UX Bridge different from the other three runners:** it does not
take a shot and finish. It *interviews the PM one question at a time* until
`(validated fields / 11) × 100 ≥ 95`, then compiles the UX Hand-off
Specification. So its step machine is a loop — `awaiting-bridge` ⇄
`interview` → `post-processing` — not the ladder the other three use.

**Two design decisions worth recording:**

1. **The prompt is stateful.** The skill's loop carries state, so a stateless
   prompt would restart the interview every turn. `_wfUxBridgePrompt()` gathers
   the PM's prior answers and appends them as a numbered log, with an explicit
   "do not re-ask anything already answered". The "one question at a time" rule
   exists precisely because batching degrades answer quality; restarting each
   turn would undermine it just as badly.

2. **An ANSWER is not agent output, so it is not shape-verified.** F2's
   paste-back check assumes the human pastes a finished artifact and validates
   its structure. In an interview the human pastes their *answer*, which
   matches neither kind of the shape — it came back `unrecognized` and the loop
   stalled on a red card forever. **This was caught only by driving the loop
   live, not by any static check.** The fix: a cheap structural probe first —
   a paste carrying the spec heading goes through the real F2 check (and, on a
   match, the terminal write); anything else is an answer and simply advances
   the loop. Prism carries the answer forward; the *agent* judges whether the
   field is satisfied. Grading answers is not the machine's job (GN-009).

   That leaves the answer path ungated, which is the honest cost. The
   suspender is that the two cheap failure modes are refused locally instead of
   being silently logged as "a validated answer" the agent has been told to
   trust: **empty** (the send button is reachable with no text) and **too thin**
   (under 20 characters — a stray keystroke, an accidental paste). Both are
   refused with an explanation and an explicit N/A escape hatch, and neither
   enters the log. Anything longer passes: quality is the agent's call.

   Worth recording what this deliberately does *not* buy. A third shape kind
   accepting prose would match everything, so it would be a rubber stamp
   wearing the costume of a gate — and it would dilute the reason the spec's 11
   headings are strict. The floor is a real check because it can fail; the
   prose kind never could.

**The shape (`ux-handoff-spec`, in `api-server.py`)** has two kinds
discriminated by structure, not by a self-declared label: `question`
(a question mark plus a rationale for asking) and `spec` (the spec heading
plus **all 11 numbered section headings**). The numbered headings are the
point — they are what distinguishes a real spec from a document that merely
discusses accessibility, and they are why the check can be trusted to gate the
write. Verified against 5 discriminating cases including unnumbered headings,
which correctly come back `partial`.

**Emission differs too:** the spec lands in `vault/requirements/` at status
**`ux-ready`**, not the generic `review` the other terminal shapes use — that
status is the signal the UX team reads, and the skill's Output Handling table
specifies it.

**The badge cleared itself.** No change was needed to the Workflows view: F17
built the badge from `_WF_RUNNERS`, so adding one line to the registry flipped
ux-bridge from ⚠️ to ▶ with zero view changes. That is the property F17's
design promised, now demonstrated rather than asserted. F17's and F19's suites
were updated to assert the new truth — and F17's registry count is now derived
from the vault rather than hardcoded, so it will not drift again.

**Two suites:** `scripts/e2e-verify-f20.js` (72 checks) asserts the runner's
shape statically; `scripts/e2e-verify-f20-loop.js` (27 checks) drives the
whole interview against the live backend and proves the property that matters
most — **a clarifying question never writes to the lens file and leaves status
untouched, while a spec writes at `ux-ready` with the Genesis seed preserved.**
It also asserts the re-issued prompt carries the answer log, and that the two
refused failure modes never enter it. It cleans up after itself, including the
session sidecar that `DELETE /file` cannot reach.

Both suites were checked for teeth: disabling the `UX_MIN_ANSWER_CHARS` guard
fails 5 checks in the live suite and 2 in the static one. A suspender nobody
can trip is not a suspender.

### F21 — external document ingest: the last functional gap, closed with stdlib only ✅ resolved 27 Sep 2026
~~External documents (PDF/DOCX/HTML) could not be ingested.~~ The Crafting
Table now accepts them, and nothing was added to install: `prism/extract.py`
is pure standard library (zipfile, zlib, html.parser, xml.etree, re).

**Formats:** DOCX, XLSX, PPTX, HTML, RTF, PDF, plus plain text/Markdown/CSV/JSON.
An unknown extension is *sniffed* by magic bytes, so a `.docx` misnamed
`.dat` still reads — and when that happens the response says `docx (sniffed)`
rather than pretending the extension was right.

**The design decision worth defending: refuse loudly, never guess.** A PDF is
a layout language with font subsetting and encodings; there is no stdlib
parser for it. So the PDF reader is explicitly *best effort* and **refuses**
when the extraction is not credible — a length floor (20 chars) *and* a
legibility ratio (≥85% printable). The refusal says why: "most likely a scan,
or an image-based document, and Prism does not do OCR. Open it, select the
text, and paste it in here."

The alternative — return whatever bytes we scraped — would put mojibake in
the vault looking exactly like something a person wrote, and a lens would
later refract it as though it were human thought. That is the failure mode
this whole system is built to prevent, so the reader is allowed to fail. A
one-paste cost beats silent corruption in a vault meant to hold years of
thought. **This is also why the length floor is deliberately low**: an
earlier 200-char version rejected legitimate three-line memos, which are
exactly the small notes someone is most likely to drop in.

**Two caps, both named, for different reasons.** `UPLOAD_MAX` (32 MB) bounds
what is read off the socket — the body is read whole before parsing, so an
unbounded body is an unbounded allocation from an unauthenticated local
client. `EXTRACT_MAX` (2 MB of text) bounds what is *staged* — a 200 MB dump
is not an artifact to refract, and it would be copied, diffed and rendered on
every view after. Both **refuse with an explanation rather than truncating**;
a truncated document that looks complete is worse than none.

**Two endpoints, because reading a document and filing it are different
acts.** `/ingest-document` extracts *and* stages into
`ingestion/unprocessed/`. `/extract-document` extracts only — that is the
chat-attachment path, and attaching a document to a message must not create a
file in the vault behind the user's back. An unreadable document returns
**422, not 400**: the request was well-formed, the document was not readable,
and telling someone their upload was "invalid" is both untrue and useless.

**Three real bugs, all found by running against genuine bytes rather than
theory:**

1. **RTF destination handling.** The obvious implementation — mark the
   enclosing group as skipped when a `\fonttbl` appears — is wrong, and
   silently so: writers commonly open ONE group around several tables, so the
   mark is never cleared and **the entire rest of the document is skipped**.
   The file comes back empty and the refusal says "no readable text", which
   reads like a bad file rather than a parser bug. Pushing a frame per
   destination is wrong the other way (the frame gets popped by an unrelated
   brace and the stack desynchronises). What actually holds: a destination's
   content runs until the next `\par`/`\line` or the closing brace, so
   `in_destination` is ended by a paragraph break, and the group stack is kept
   purely for nesting.
2. **xlsx sheet names.** Sheet names are keyed by relationship *id*, not by
   part filename. Without resolving `xl/_rels/workbook.xml.rels`, every sheet
   is labelled `Sheet1` and the human loses the only meaningful label in the
   output.
3. **Corrupt files crashed the server.** A truncated download raised
   `zipfile.BadZipFile` straight out of the handler — a traceback for what is
   an everyday event, and one that told the human nothing. Now a bad archive
   is a refusal: "that .docx is damaged or incomplete."

**A note on `.rtf`:** it was already in the Crafting Table's accept list and
was being read as plain text — so RTF control codes were being ingested as
content. F21 makes that a real reader.

**`scripts/e2e-verify-f21.js` (65 checks)** builds genuine fixtures — a
docx Word would open, a structurally valid PDF, RTF with a real font table —
because a mocked parser tests the mock. Teeth verified three ways: making the
PDF never refuse fails 4 checks; reverting the RTF destination bug fails the
extraction checks; making the read-only path stage fails 3. It also guards the
security posture (traversal, privacy suffix, both caps) and asserts no
third-party library is ever referenced.

**And the suite found a flaw in itself, which is the part worth keeping.** An
early "teeth" check flipped the read-only path back to staging and the suite
still reported 61/61 green — because it was talking to a **stale server
process** that had not been restarted. A suite that exercises a long-running
process can be confidently green about code that is not running. F21 now
opens with a freshness probe that stages via `/ingest-document` and asserts
`/extract-document` does *not*, and says "restart the server if this fails".

### F22 — the agent is a required participant, and the constraint that said otherwise was wrong ✅ resolved 27 Sep 2026
~~Prism never calls a language model, and this is a design constraint, not a
missing feature.~~ That sentence appeared in three agent definitions, the
README ("the lens, not the laser"), and the delivery-channel design, and it
was **load-bearing in the wrong direction**.

**The error:** the framing described the agent as a *downstream consumer* of
Prism's output — "whatever one the human already works with". That made
integration look like a convenience. It is not. **Prism's workflows cannot be
made deterministic.** UX Bridge asks one question at a time, and *something
must judge* whether an answer fills the field and whether 95% is reached.
Prism holds the state, prepares the prompt, and verifies the returned shape —
but it cannot know whether an answer is any good. No amount of programming
here substitutes for that judgment, and treating the dependency as forbidden
meant the most important participant in the system was the one thing
documented as out of scope.

Worth noting what did **not** change, because it matters more than the
reversal: **Prism still does not generate the thinking.** It prepares work,
holds the state machine, and checks the artifact. The judgment stays with the
agent, integrated or pasted, on identical terms. F15 had already killed every
doc claiming a "future LLM placeholder" — that instinct was right about
*pretending*; what was wrong was forbidding the real thing.

**The rule that survives everything: keys never enter the vault.** An
integration config records the *name* of an environment variable, never its
value, because `integrations/agentic/` is git-synced and a literal key written
there would be committed. `agentic.py` enforces this three ways: it rejects
unknown frontmatter fields loudly, it rejects any field whose name matches
`api_key|secret|token|password|credential|bearer`, and `auth_env` must match
`^[A-Z][A-Z0-9_]+$` so a value cannot masquerade as a variable name. An
`http://` endpoint is also refused — that would put the key on the wire in the
clear.

**Draft configs cannot be called.** Status is `active | draft | archived`, and
only `active` invokes. That is what makes it safe to write a config without
accidentally spending money, and it means the "Send to agent" door can be
present-and-honest rather than present-and-broken.

**Every call is recorded before it is sent**, not after it returns. If the call
hangs, gets killed, or the server dies mid-flight, the attempt is still in
`ingestion/agent-calls/`. That ordering is deliberate: reconciling a bill
means knowing what was *attempted*, and the reverse ordering loses exactly the
entries you would need.

**The delivery default flipped.** "Save as file" was the secondary door and
copy was primary, which made the human the courier for every prompt and left
`vault/prompts/` empty — the one channel an agent can walk on its own. Filing
is now the primary door ("💾 File it — agent-ready"), copy is the quieter
secondary, and channel 3 appears when an integration is active *and* has a key
present. Two door kinds (file vs send) for the same artifact would have been
the F9 drift trap, so the send door lives in the same row.

**Integration changes WHERE the work goes, not what Prism does with it.** An
integrated reply is pushed as a normal `role: 'agent'` message, so it goes
through the same F2 shape verification, the same `ux-ready` emission, the same
downstream steps as a pasted one. There is no privileged path.

## F23 — the confidence threshold becomes the human's decision ✅ resolved 28 Sep 2026
~~The 95% figure was hardcoded in four places.~~ It lived in `prd-gate.md`,
`clarification-gate.md`, the requirements/rationalizations/ux agent
definitions, and the ratio logic — and **could not be changed by the human at
all.** A fixed 95% serves neither end: trivial work should not demand a full
interview, and genuinely complex work may need the gate turned *down* or the
human can never get any output ever.

**Where the value lives:** `knowledge/process/confidence-thresholds.md`, one
line per lens, in the vault. Not in-chat. A per-chat control is forgotten by
the next session, explains nothing about why an artifact came out the way it
did, and is not reviewable when it changes. This file is git-synced, so
lowering a threshold is a visible, reversible commit — the right weight for a
decision that changes what kind of work you get out of the system.

**The four shipped values are deliberately not all equal:** requirements 95%,
ux-bridge 95%, hypotheses 85%, rationalizations 85%. The reasoning is the
point — a PRD handed to a developer with a misunderstood requirement is
expensive to discover late, while a hypothesis is *meant* to be cheap to be
wrong about. Setting them all to 95% would have honoured the letter of the
original spec and defeated its purpose.

**How the value reaches the agent: it is stated in the prompt, on every turn.**
Not written to a file the agent might read, and not left in the skill's text —
an agent mid-interview will not open a config file, and a threshold that is
merely documented is a threshold that is quietly ignored. The block also
carries **the human's stated reason**, because a bare number tells the agent
where the bar is but not what it is for, and without the reason an 85% and a
95% read as arbitrary. It ends by telling the agent the bar is *not its own
to raise* — it may say once that it seems wrong, then continue at the level
set.

**Range: 1–100.** 100 is a legitimate setting meaning "ask me about
everything," and the system must not argue with it. The floor is 1 because
anything lower is not a gate, and a gate that cannot block should not be
offered as a setting. Out-of-range values are **refused, not clamped** — a
`450` in the config is a typo worth surfacing, and quietly treating it as 100
would hide it.

**One splice point, not eighteen.** There are eight prompt builders and
eighteen places a `codeBlock` is attached. Editing each builder to append a
threshold is the F9 drift pattern in new costume: the sixth builder gets
forgotten, or gets differently-worded text, and the agent receives two
different instructions about the same bar. So each builder was renamed to
`*Raw` and re-exposed under its original name by a wrapper that appends the
threshold. Every existing call site is untouched, and a ninth builder cannot
be forgotten. The block text itself is built **server-side**
(`/threshold-block`) so there is exactly one copy of the wording.

**The Crafting Table shows the bars before the human commits to a lens**, and
names the file to edit. A control the human has never seen is one they will
never change, and the whole point is that this is their decision. Editing
happens in the vault; the panel reads and points.

**Every artifact records the bar it was produced under.** Months later, "why
is this thinner than the last one?" is answerable from the file rather than
from memory — the threshold is a human decision that varies per lens and over
time, so an artifact without it is unexplainable.

**Two bugs found by driving the real UI.** `thrInfo` is a map, not an array,
so `.map()` threw and the Crafting Table **failed to render at all** — a
total failure rather than a missing panel, because `renderDesk` builds its
whole `innerHTML` in one template. And the block initially omitted the human's
reason entirely: the number arrived, the reasoning did not, which is half a
feature.

**`scripts/e2e-verify-f23.js` (61 checks)** covers parsing, the legal range,
validation refusals, the block's wording, the HTTP surface, the one-splice-
point source posture, and — the part that matters — **a real browser proving
the value reaches a live prompt.** It edits the config to 60%, 100% and 70%
and asserts each appears in the corresponding prompt. Teeth verified by
removing the wrappers from three builders: 6 checks fail, including the live-
prompt ones, and pass again on restore. Two cleanup assertions guard against a
suite leaving a test threshold behind in the shipped config, which would
silently change the next person's run.

### Pre-existing failure found along the way (not caused by F23)

`scripts/e2e-verify.js` fails 7 checks with a `fetch failed` harness error —
on **clean `main`, with none of the F23 changes applied**, verified by stashing
them and re-running. So it predates this work. It is not counted in the
totals below, and it is worth fixing rather than carrying: the suite depends
on a live server and appears to be racing one. Same shape as the known F19
`sleep(1200)` race.

### F24 — the agent judges clarity; the regex gate stops pretending to ✅ pending review 28 Sep 2026
~~`ratio >= 0.8` over marker patterns is a 95% clarity gate.~~ It was not.
One of those markers was the agent's own claim that it had reached 95%, so
Prism was matching a *claim* about a judgment and calling the result a gate.
I verified the hole directly: a PRD that wrote `## Executive Summary` and
then `TBD` seven times came back `match`; a complete, well-reasoned PRD that
said "Scope" instead of "Executive Summary" came back `unrecognized`.

**Three answers, and all three matter:**

- `at_threshold` — clear. Advance, and record the number *and the reasoning*
  so the artifact explains itself later.
- `below_threshold` — short, and **the agent derives the specific questions**
  that would close the gap. This is the half that was missing. Without it,
  "below threshold" is a dead end: Prism would know the output is inadequate
  and have no route to an adequate one, which is worse than not checking.
- `uncertain` — the agent cannot judge. A legitimate answer, not a failure.
  It routes to the human rather than guessing, because overstating confidence
  is exactly how the old gate lied.

**The structural check is demoted, not deleted.** Per Principle 4 of the gate
document it is a floor: it catches a structural accident, it is reported as
context, and it can never approve anything. A suite check asserts the floor
cannot set the verdict, verified by making it try — 3 checks fail.

**Two absences kept distinct.** `unjudged` means Prism could not ask anyone
(no integration, service down, bad key). A judgment of `uncertain` means the
agent was asked and said it cannot tell. Collapsing them would make a working
integration look broken and a broken one look like an opinion, so the response
carries `asked`. An unparseable reply is `uncertain` + `parse_failed`, not
`unjudged` — we did ask. **I got this wrong first** and my own probe asserted
the wrong thing; the distinction is worth more than the convenience of one
label.

**When no agent is configured, Prism says so and does not substitute the
floor.** The old behaviour looked identical whether or not anyone had judged
anything, and that indistinguishability was the actual harm — not the ratio
being wrong, but nobody being able to tell that nothing had been judged.

**A `below_threshold` with no questions is a contradiction.** The agent said
it is short but named no gap, so the human would be stranded. Demoted to
`uncertain` with the reason stated.

**The prompt asks for substance, not formatting.** A well-organised document
missing half the answer is below threshold; a plainly-written one that captures
the intent is not. It also tells the agent that `uncertain` is legitimate and
that `below_threshold` must not become a stalling tactic — both are ways an
agent under pressure talks itself into the wrong answer.

**`scripts/e2e-verify-f24.py` (112 checks)** covers 17 malformed-reply cases
(fenced JSON, prose-wrapped, nested braces, escaped quotes, unknown verdict,
`below` with no questions, non-list questions, out-of-range and non-numeric
confidence, 40 questions capped to 12), the prompt's content, the record
format, and the live path against a real TLS agent across six failure modes.

Teeth verified on the three dangerous properties: **an unparseable reply
passing fails 6 checks; the floor approving when nothing judged fails 3;
dropping the contradiction guard fails 8.**

**An environment lesson worth keeping:** the suite reads its CA from
`F24_CA_FILE`, not `SSL_CERT_FILE`, because the latter is already set to a
certifi bundle in this environment — so trusting it made every handshake fail
while the fake agent was perfectly healthy. A test bug that presented exactly
like a product bug, which is the F21 stale-server lesson in a new costume.

**Known limitation, stated rather than hidden:** the *default* agent for
adjudication is the first configured, keyed integration by sorted filename.
When several exist, which one should judge is a real question this defers. A
per-lens `judged by` field is the obvious answer and is not built.

### F25 — the clarity-answers loop: below-threshold is a route forward ✅ pending review 29 Sep 2026
~~The agent could judge an artifact below threshold, and the human could see
the questions, and then had nowhere to go.~~ F24 produced a verdict with no
consequence attached. That is the dead end Principle 2 of the gate document
warns about: Prism would know the output was inadequate and have no route to
an adequate one — **worse than not checking at all**, because the human has
been told something is wrong and then left holding it.

**The loop, end to end:**

```
paste → agent judges below threshold, names specific gaps
      → Prism shows the gaps and opens `clarity-answers`
          → human answers
              → Prism re-runs the same skill with
                · the original artifact
                · the previous agent output, marked as judged-below
                · each question with the answer under it
                · the human's answer
                · the threshold again
                  → agent judges the NEW output against the same bar
```

The previous output is included because the agent cannot judge a revision
without seeing what it originally produced. The threshold is re-stated because
the bar must not drift between turns. The questions carry their answers
individually so the agent inherits the whole exchange, not just the last
message.

**One place, not four.** The step is identical for every lens, so it is
intercepted in `_wfDispatch` rather than added to each of the four `Respond`
functions. That is the F23 splice lesson applied again: a fifth lens cannot
forget it. The shape→builder map is a table, so a new shape is one line rather
than a branch in a dispatch function.

**The state is cleared before anything can fail.** `_wfClarityAnswerStep`
clears the pending questions, shape, previous output and return step *first*,
then looks up the builder. A shape Prism cannot re-run, an exception, or a
human pasting a novel would otherwise leave the workflow sitting in a step that
swallows every subsequent message with no way out. On an unknown shape it says
so plainly and hands the human back their thread. A suite check drives exactly
that case.

**The judgment is now visible where the decision is made.** The verdict card
shows the agent, the bar, the agent's own confidence, its reasoning, and the
gaps — above the structural verdict, which is relabelled "Shape check" and
carries an explicit line saying it is a floor that cannot judge clarity. A
human can disagree with a judgment they can see; they cannot disagree with one
they cannot.

**And the floor genuinely cannot approve.** A structural `match` no longer
auto-advances; only a judged `at_threshold` does, so the doors now appear even
for a shape match the agent did not clear. `scripts/e2e-verify-f25.js` proves
it with the document that motivated all of this: a PRD with every required
heading and `TBD` behind each one. It matches the shape. The step does **not**
advance. Teeth verified on four properties — never opening the loop (12
failures), dropping the questions from the re-run (2), **letting the floor
approve again (3)**, and trapping the workflow on an unknown shape (2).

**A regression this surfaced, honestly.** `e2e-verify-f20-loop.js` failed 5
checks because the UX spec now routes through `/adjudicate` — which is the
intended change, not a bug. The suite stubbed the judgment rather than being
weakened, because the thing it tests is the interview loop, not the judgment,
and F24 covers the judgment exhaustively (132 checks). A second fix in the
same file: the question-count assertion counted across the whole thread, so it
passed or failed depending on how many judgment cards happened to be on screen.
Scoped to the card under test.

### F26 — the human walkthrough: what a real pass-through reveals ✅ pending review 30 Sep 2026
F25 proved the loop works. It proved it by calling the same internals a test
would. This drives the flow the way a person does — type into the desk, click
a lens door, read, answer, send — and it found two things no unit-level suite
had.

**1. The artifact recorded the bar but not the judgment.** F23 writes
`Confidence threshold: 95%` into every artifact. F25's wiring added the
judgment block — and it never appeared. The cause was one line:

```js
_wfAdvanceVerified(v, userText);   // v = the FLOOR object
```

`v` was the structural-match result, captured *before* `/adjudicate` ran. The
judgment lived on a wrapper object that was pushed onto `_chat.messages` and
then discarded. So `_wfApplyAccepted` read `v.judgment`, found `undefined`, and
wrote an artifact that said *what bar this was judged against* but not *who
judged it or why* — which is the part that makes a past artifact auditable
rather than merely dated. Fixed by passing the card:

```js
_wfAdvanceVerified(card, userText);  // card carries .judgment
```

**2. A client-side fallback was masking a broken server response.** My first fix
reformatted the record locally when `v.judgment.record` was absent. The teeth
check then showed the suite passing 32/32 with `record` deliberately nulled on
the server — the fallback quietly reconstructed what the test meant to prove
was missing. Two formatters for one concept is exactly how they drift. F26 now
asserts the server's own string *and* that the artifact contains it verbatim,
and the client keeps the fallback only for the Accept-anyway door (where the
card carries a judgment the server never scored).

**3. The stale-stub lesson, fourth appearance.** A leftover `loop_stub_agent`
on :8400 answered every request with the previous run's mode, so the
walkthrough judged the good revision as below-threshold. Root cause is always
the same: killing by PID misses a process that a *previous* run bound. F26 now
calls `scripts/lib/free-port.sh 8400` before it starts and again in teardown,
installs its armed config itself, and removes it in `finally` — because an
active config left in the vault fails F15 ("integrations/ holds no ACTIVE
service") and F24 ("with no integration, nothing is judged") on the *next* run,
which is how both showed up as unexplained regressions.

**Two of my own assertions were wrong** and are worth recording, because both
are the standard trap: the walkthrough read `verify` via `slice(-1)`, which is
a *different* shape's card once a workflow issues more than one, and it
assumed the first paste is a PRD when the first step is `intent-synth`. It also
asserted the artifact contained "under 1" — a phrase I had invented from memory
of a fixture. Every one of these produced a confident FAIL pointing at Prism.
Scope assertions to the shape, and assert only on strings that are actually in
the fixture.

**Result:** 35/35, and both mutations are caught (4 failures and 2 failures).
A hollow PRD — every required heading, `TBD` behind each one, and a line
claiming "scope clarity confirmed 95%" — matches the shape, is judged below
threshold, opens the loop, and the revised artifact records *who cleared it*.

---

## The pattern in both columns

What was friction-removed follows one rule: **remove decisions, not
capability.** Auto-name, auto-detect, auto-select-default, auto-save,
inline quick-ingest — each one deletes a moment where the human had to
stop and choose something incidental to their intent.

What remains follows the inverse: every open item is either (a) a
moment where the human still does work the machine could do (copying
prompts, classifying artifacts, finding files), or (b) a surface that
belongs to the old framing (dashboard metrics, dead integration
button).

**Design law candidate (for the iteration):** the UI's job is to keep
the human inside their own thought. Every control that pulls them into
the machine's bookkeeping — naming, classifying, saving, finding,
deciding which door — is friction against the glass.

---

## Closure — 24 Aug 2026, amended 26 Sep 2026

All eleven items are settled: F1, F2, F3, F4, F5, F7, F8, F9, F10,
F11 resolved with fixes verified by the regression harnesses under
`scripts/e2e-verify*.js`; F6 closed as a scope boundary (desktop-local
by design; mobile users consume emitted artifacts via a website, not by
running Prism on a phone). The design law candidate above was confirmed
by every fix in the column: each one returned a bookkeeping task to the
machine and handed the human only a confirm-or-correct moment.

**Amendment 26 Sep 2026 (first pass):** F12 (cross-origin write hole in
the API) was added and resolved. It is a security item rather than a
friction item, but it belongs in this record because the audit's own closing
law — the UI's job is to keep the human inside their own thought — has a
backend twin: a vault any page in the browser can write to puts the human's
thought outside their control.

**Amendment 26 Sep 2026 (second pass):** F13 (unpinned CDN dependency on
marked) added and resolved; F14 (markdown viewer does not sanitize) added
and left **open** pending a product-intent decision.

**Amendment 26 Sep 2026 (third pass):** F15 (agent and workflow docs still
described the Option E door removed by F8) added and resolved — six files,
three distinct defects, plus a 57-check suite that derives the real menu from
`app.js` so the documents cannot drift from the code again.

**Amendment 26 Sep 2026 (fourth pass):** F14 closed. It was filed as
open pending a product decision, but on measurement the decision was much
cheaper than assumed — a two-rule marked renderer override, no sanitizer
dependency, and **zero** change to how any of the 49 vault files render. A
44-check suite now holds that baseline. The lesson for the next session: I
deferred this as "a product-intent call" without having measured the blast
radius, and the measurement was the thing that would have made the call
cheap. Measure before deferring.

**Amendment 26 Sep 2026 (fifth pass):** F17 — the Lens Wizard retired, the
Crafting Table is the one door, the dead `/status` endpoint removed, and
workflow runner status made visible in the Workflows view.

That last one is the item worth carrying forward. F17's *deletion* was clean,
but it exposed a capability that had been quietly broken for a long time:
`ux-bridge-default` has a full agent definition, a skill and a process doc,
and no runner. The wizard's step 3 was the only thing that made it look
selectable. Removing the wizard did not break it — it had never worked — but
it removed the last place the gap was visible. Hence D: the gap is now
labelled in the product rather than inferred from code.

The general shape: **a retired surface is also a visibility mechanism.** Before
deleting anything that touches a capability, check whether its existence is
what makes that capability discoverable. If so, replace the discovery with
something explicit before you remove the surface — or the gap becomes silent.

**Amendment 27 Sep 2026:** F18 — the Ingest page retired too, with its
staging capability folded into the desk. The same lesson, one level down: the
page looked like a duplicate of the desk, and it was not — it was the only
way to stop short of processing, and the only writer for a queue that had no
reader. **Before deleting a surface, check what only it can do.** Two
retirements in a row turned up a capability hiding behind each.

And the practical version, from the cut itself: `renderView('ingest')`
survived inside Option D and would have thrown at runtime. The compiler
cannot see it, because `renderView` takes a string. When removing a view,
grep for its *name* — the symbol is gone, but every string that reaches it is
not.

A pattern worth naming, now that three items have landed in the same place:
**F12, F13 and F15 were all invisible to the friction lens**, and two of the
three were invisible to *this* audit too. Every UI surface was correct in
each case — the defects lived in a response header, in a `<script src>`, and
in the documents describing a button that no longer exists. The audit
examines the screens the human touches; all three sat outside that: the
browser/backend seam, the dependency layer, and the written record. A future
session should audit those three seams deliberately, not incidentally.

Future friction gets recorded as a new session's
audit, not appended here.
