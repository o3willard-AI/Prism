# Intelligence Rating

*Every lens in the library must declare the minimum intelligence required
to run it to a successful emission. A lens co-created by one agent may be
executed later by any agent — the library cannot assume the runner is as
capable as the creator.*

---

## The problem

Lenses are markdown in a shared, git-synced library. The LLM that
co-created a lens can presumably run it — it just did, during the grind.
But a future Prism session might route the lens through a much smaller
model: a local 8B, a quantized 14B, a hosted mid-tier. If that model
cannot hold the lens's discipline — cannot self-assess confidence,
cannot maintain a gap ledger, cannot refuse to emit partial output —
the emission will be scattered, and the failure will look like the
lens's fault when it is really a mismatch between glass and grinder.

So the co-creating agent must estimate, at shelving time, the **minimum
capability level** any future agent needs to Prism the lens through to a
successful emission.

---

## Two layers: demand profile, then parameter floor

Parameter count is the only universal metric available today, and it is
imperfect (training quality, architecture — MoE especially — and
quantization all decouple parameters from capability). The design
therefore carries two layers:

### Layer 1 — Cognitive demand class (the durable rating)

What the lens actually *demands* of the model, independent of how models
are measured. Classes are defined by the hardest cognitive move the lens
requires:

| Class | Name | Hardest required move | Examples of moves |
|---|---|---|---|
| **L1** | Template | Fill a fixed structure from clear input | Reformatting, extraction with no judgment |
| **L2** | Discriminate | Classify, separate, flag — judgment without self-scoring | Constraint vs trade-off splitting, proper-noun flagging, block mapping |
| **L3** | Self-gate | Assess own certainty and refuse partial output; keep ambiguity first-class | 95–97% confidence gates, Inquiry-vs-Execution dichotomy |
| **L4** | Recursive | Maintain multi-turn state and behavioural discipline across a loop | Live confidence scores, gap ledgers, one-question-at-a-time interviews, never-mix rules |

A lens is rated by its **hardest** move. A lens that mostly reformats
but contains one confidence gate is L3, not L1.

The class is the durable part of the rating: when better universal
metrics than parameter count emerge, the class is re-projected onto
them without re-grinding the lens.

### Layer 2 — Parameter floor (today's universal label)

A rough minimum parameter estimate for the class, explicitly
provisional and revisable. Initial calibration (2026-era models):

| Class | Provisional parameter floor |
|---|---|
| L1 | ~3–8B |
| L2 | ~8–20B |
| L3 | ~20–70B |
| L4 | ~70B+ / frontier-class |

These floors are estimates with provenance, not truths. They are
expected to move as field evidence accumulates.

---

## The frontmatter field

Shelved lenses carry the rating in frontmatter:

```
**Minimum agent:** L3 · ~30B parameters
**Rated by:** <model that co-created the lens> · <date>
**Rating basis:** <the hardest cognitive move, in one sentence>
```

The basis line matters: it lets a future co-creator or agent judge
whether their runner can handle the specific move, not just the number.
A 14B model that is unusually good at self-assessment might run an L3
lens whose basis is "confidence gate" but fail one whose basis is
"seven-section framework with MoSCoW + BDD" — the basis says which.

---

## When the rating is assigned

During **Phase 4 (test light)** and stamped in **Phase 5 (polish &
shelve)** of the grind loop. This timing is deliberate: at Phase 4 the
co-creating agent has just watched real light pass through the glass
and has empirical evidence of what the lens demanded — which moves were
hard, where the emission almost scattered, what the confidence gate
actually had to catch. The rating is an observation, not a guess.

If the test light reveals the lens demanding more than expected (the
emission needed rescuing), the glass is reground *or* the rating is
raised — the co-creator chooses. Both are honest outcomes.

---

## Revision and harvest

The rating is revisable on field evidence:

- A runner **below** the floor succeeds → the floor may drop. Record it.
- A runner **at or above** the floor fails → the floor may rise, or the
  basis may be wrong (the lens demands a move the class doesn't
  capture). Record it.

Both kinds of evidence are **harvest notes** (grind loop Phase 6):
*"prd-gate rated L3/~30B ran successfully on a 14B local model"* is
generalizable wisdom about what the confidence-gate move truly costs.
Over time, harvest evidence converts the provisional floors into
calibrated ones.

---

## Initial calibration — the eight reference lenses

Rated by hardest cognitive move. These ratings anchor the scale; they
are themselves harvest-grade estimates, open to field revision.

| Lens | Class | Floor | Rating basis |
|---|---|---|---|
| reorder-and-list-in-context | L3 | ~20B | 97% confidence gate; single pass but must self-assess and emit questions instead of guessing |
| intent-synth | L2–L3 | ~15B | Denoise + disambiguate + ambiguity flagging; gate only via Block 5, no hard refusal rule |
| conv-synth | L2–L3 | ~15B | Multi-speaker attribution + initiative splitting; same soft-gate shape as intent-synth |
| doc-synth | L2–L3 | ~15B | Multi-asset relationship establishment + five-block synthesis |
| prd-gate | L3 | ~30B | Hard 95% gate with strict Inquiry/Execution dichotomy + 7-section framework (JTBD, MoSCoW, BDD) |
| clarification-gate | L3 | ~30B | prd-gate demands + framework routing across four lens output shapes |
| diagram-asset-generator | L3–L4 | ~30–70B | Three-phase negotiation + hard tool gate (must never simulate an unprovisioned tool call) |
| ux-bridge | L4 | ~70B+ | Recursive Q&A loop with live confidence formula, blocking/non-blocking gap classification, one-question-at-a-time discipline held across many turns |

The spread is informative: the corpus already contains lenses spanning
L2 through L4. The library's most demanding reference lens (ux-bridge)
is frontier-class work — a small model picking it up would almost
certainly scatter the light. That is exactly what the rating exists to
prevent.

---

## Limits, stated plainly

- Parameter count is a blunt instrument. Two models with equal
  parameters can differ enormously; MoE models make the number itself
  ambiguous. The class layer is the hedge: it records *what* capability
  is needed, so any future metric can re-answer *who* has it.
- The co-creating agent rates its own creation — an estimate with a
  known bias (creators tend to believe their artifacts are runnable).
  Field evidence is the correction mechanism; the rating is never
  treated as final.
- Ratings say nothing about tool use, context window, or cost — only
  the cognitive discipline required. A lens may be L2 and still need a
  200k context window; that is a separate constraint and, if it ever
  matters, a separate field.
