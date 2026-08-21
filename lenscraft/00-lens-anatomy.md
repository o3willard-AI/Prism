# Lens Anatomy

*What a lens IS, distilled from the eight existing skills and three
workflows. This is the target shape the lens-crafting machine must learn
to co-create with a human. Every section below is present — explicitly or
implicitly — in every one of the eight reference lenses.*

A lens is a prompt-engineered refraction chamber. It receives scattered
light of a known shape and emits focused, identifiable context. It is
defined entirely as text — no machinery, no state, no runtime.

---

## The eight components

### 1. Reception condition — *what light this lens accepts*

Every lens opens with a trigger table: input shapes it accepts, and input
shapes it must refuse. Acceptance is by **artifact type** (formatted,
unordered, dictation, transcript, conversation, media, application, code)
and by **intent** ("a PM has a feature request and needs UX handoff").

A lens that accepts everything refracts nothing precisely. The refusal
column is as load-bearing as the acceptance column.

*Reference: every skill's "When to Use This Skill" table.*

### 2. Input contract — *what must be injected before light enters*

Each lens declares the context block it requires: the artifact's type and
path, the lens/seed-word identity, the raw content, and any load-bearing
reference documents (e.g., the 11-field UX template for ux-bridge). The
contract is explicit and minimal — a lens that needs unspoken context
produces ambiguous output.

*Reference: every skill's "Inputs Required" section.*

### 3. Persona — *who performs the refraction*

Each lens names a role with a stance: Principal PM and Systems Architect
(prd-gate), Executive Assistant and Business Analyst (conv-synth), senior
TPM liaison (ux-bridge). The stance constrains behaviour: "you structure
and preserve, you do not judge" (rationalizations); "ask one question at
a time" (ux-bridge).

The persona is not decoration. It selects which heuristics the LLM draws
on during refraction.

*Reference: every skill's "Role" section; agent "Identity & Tone".*

### 4. Refraction procedure — *how the scattering is separated*

The actual optical work, always some ordered combination of:

1. **Denoise** — strip filler, corrected pivots, repetition, sidetracks
2. **Disambiguate** — repair speech-to-text damage from surrounding
   context; flag proper nouns rather than guess
3. **Synthesize** — extract core subject, assertions, intentions
4. **Structure** — pour the clarified content into the output shape

Multi-phase lenses add alignment loops before execution (diagram-asset-
generator: intake → scope questions → tool gate). Interview lenses add
recursive Q&A loops with a live confidence score (ux-bridge).

*Reference: every skill's "Instructions" / "Workflow" section.*

### 5. Output shape — *the emitted wavelengths*

Every lens emits a fixed, named structure. The common deep shape is **five
blocks** answering the five questions an agent must resolve before acting:

| # | Block | Question answered |
|---|---|---|
| 1 | Core subject / objective / summary | What is this about, and why? |
| 2 | Key assertions / intentions / initiatives | What is being claimed or intended? |
| 3 | Constraints / dependencies | What must not be violated? |
| 4 | Tangents / secondary considerations | What is adjacent, worth tracking? |
| 5 | Ambiguities / open questions | What is unresolved, and why it matters? |

Gate lenses (prd-gate, clarification-gate) instead emit one of two shapes:
an **Inquiry** (numbered questions) or an **Execution** (the full target
document — PRD, Structured Account, Hypothesis brief). Never both.

*Reference: "Output Format" sections; the five-block pattern in
intent-synth, conv-synth, doc-synth.*

### 6. Confidence gate — *when the lens may emit*

A certainty threshold (95% for gates, 97% for reorder-and-list) with a
strict dichotomy: below threshold, emit clarifying questions; at or above,
emit the artifact. "There is no middle ground. Either ask questions or
produce the document — never attempt both."

This is the quality mechanism that keeps emissions trustworthy and makes
ambiguity a first-class wavelength rather than a failure state.

*Reference: prd-gate's "95% Certainty Rule", ux-bridge's confidence-score
formula, reorder-and-list's "97% Rule".*

### 7. Output handling — *where the emitted light focuses next*

Each lens declares its downstream: what happens to an Inquiry (surface to
human, loop), to a clean output (chain to next lens, or populate a lens
file directly), to each post-processing choice. Default focal point is a
plain text file; other focal points are modular.

*Reference: every skill's "Output Handling in Prism" table; workflow
Option A–E definitions.*

### 8. Behavioural constraints — *what the lens must never do*

Negative space, stated explicitly: never produce partial output; never
fabricate context; never conflate constraints with trade-offs; never batch
questions; never drop Block 4 content; never emit while unresolved
questions remain. These are the guardrails that distinguish a lens from a
chat prompt.

*Reference: agent "Behavioural constraints"; skill "Notes" sections.*

---

## The deep grammar

Across all eight reference lenses, the machine must learn one grammar:

> **A lens is a contract between scattered input and focused output,
> enforced by a confidence gate, in which ambiguity is emitted as its own
> wavelength rather than suppressed.**

Five things are invariant; everything else is design choice:

1. Declared reception (accept *and* refuse)
2. Explicit input contract
3. A procedure that denoises before it structures
4. A fixed output shape answering what/what-claimed/what-constrains/
   what's-adjacent/what's-unresolved
5. A confidence gate that forces questions over partial output

A co-created lens that satisfies these five is a real lens, whatever its
domain — requirements, rationalizations, UX handoff, incident debrief,
contract review, or a domain nobody has named yet.
