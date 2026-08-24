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

### F2 — No paste-back verification
Any text is accepted as skill output; the state machine advances on
faith. No structural sanity check (e.g., Intention Block headers,
Inquiry-vs-Execution labels) before routing to the next step. Silent
advancement on garbage input is scattered light.

### F3 — Shallow resume fidelity
The pause checkpoint document is excellent, but the UI restore presents
the prior session log as one context blob rather than replaying the
messages. The user must scroll to find where they left off. Good
checkpoint, minimal restoration.

### F4 — Title still required in wizard Step 1
Auto Name exists but is a button press, not a default. Every lens item
demands a naming decision before anything else happens. (Contrast the
grind-loop finding: naming should be easy — here it gates the flow.)

### F5 — No search, no keyboard navigation
Only two keyboard handlers exist (Enter in two fields). No global
search across the vault, no keyboard-driven navigation. As the lens
library and emissions grow, findability becomes the dominant friction.

### F6 — Desktop-only assumption
Zero @media queries anywhere. Whether this is a defect depends on use
context; as stated, the glass only exists on wide screens.

### F7 — The front door is PM-era chrome
The dashboard leads with dwell-time bars and review counts — metrics of
the old framing. Under the pivot, the front door should be a single
input surface ("bring fog, get focus"), not a status board. Related:
there is no single "start here" affordance — new items are reached via
per-lens nav + per-lens New buttons. Multiple doors = decision friction.

### F8 — Dead button: Option E
"Archive and emit to integration" exists as a button that replies
"not yet configured." A dead control violates GN-006 in UI form —
every visible affordance should leave the user holding a next action,
and a button that leads nowhere is friction of the worst kind.

### F9 — Duplicated ingest paths with silent divergence
The Ingest page and the wizard quick-ingest are near-duplicate forms —
and they have already diverged: quick-ingest hardcodes `is_private:
false`. The private option is silently unavailable on the wizard path.
Duplication is maintenance friction that becomes user-visible drift.

### F10 — Self-classification at ingest
The human must classify their own artifact (formatted / unordered /
dictation / …). File-based detection exists; pasted text gets no
inference. The lens system's own philosophy says classification is
agent work — the UI asks the human to do it.

### F11 — Maintainer friction
One 2,753-line HTML file containing all JS and CSS. Syntax checking
requires extracting the script block and running node on it (per
COPILOT-CONTEXT). Editing the machine is itself high-friction.

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
