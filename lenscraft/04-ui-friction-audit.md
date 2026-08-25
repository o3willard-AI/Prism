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

## Closure — 24 Aug 2026

All eleven items are settled: F1, F2, F3, F4, F5, F7, F8, F9, F10,
F11 resolved with fixes verified by the regression harnesses under
`scripts/e2e-verify*.js`; F6 closed as a scope boundary (desktop-local
by design; mobile users consume emitted artifacts via a website, not by
running Prism on a phone). The design law candidate above was confirmed
by every fix in the column: each one returned a bookkeeping task to the
machine and handed the human only a confirm-or-correct moment.

The audit is closed. Future friction gets recorded as a new session's
audit, not appended here.
