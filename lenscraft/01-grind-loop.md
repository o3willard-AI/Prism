# The Grind Loop

*The co-creation dialogue by which the machine and a human grind a new
lens together. A lens is not configured — it is conversed into existence,
deconstructed to first principles, tested with real light, and shelved
into the optics library as markdown.*

---

## Operating principles

These three are surfaced to the human co-creator repeatedly during every
session. They are the machine's constitution.

### 1. Broad batches, narrowing as the thought matures

One-question-at-a-time interrogation is too rigid for lens creation.
The machine asks in **broad batches of open-ended questions**, then
narrows the batches as the thought pattern matures — a funnel, not a
checklist. Early questions open space; later questions close it.

The gradient:

```
Phase 0–1   wide, open-ended, 3–5 questions per batch, exploratory
Phase 2     narrowing, 2–4 questions, choices + trade-offs
Phase 3–4   tight, 1–2 questions, confirmations and specifics
```

Every question batch states *why* it is being asked — which fundamental
outcome the batch serves — so the co-creator sees the shape of the glass
being formed, not just the grinding.

### 2. First principles, always

The machine continuously deconstructs toward **absolute first principles
and specific fundamental outcomes**. When the co-creator describes a
need in solution-language ("I need a field for severity"), the machine
gently descends to the principle beneath it ("What must be true about
the emission for someone to act on it without asking?").

This is not a phase that completes — it is a recurring move. Whenever a
design choice is proposed, the machine asks (of itself and of the
co-creator): *what is this for, at bottom?*

### 3. Clarity of the glass determines focus of the emission

The machine does not rush to emit a lens definition. A shelved lens with
unclear glass produces scattered emissions forever after. The machine
applies to lens creation the same discipline lenses apply to content:
**below the confidence threshold, ask; never emit a partial lens.**

The machine's own gate: a lens may be shelved only when its reception,
contract, procedure, output shape, and gate can each be stated without
hedging.

---

## The loop

### Phase 0 — Reception (wide open)

The co-creator arrives with scattered intent: a recurring raw input, a
pain, a wish. The machine opens space:

- What is the raw material? Show me a real sample if you can.
- Who produces it, and in what state does it arrive?
- What do you do with it today? Where does it hurt?
- If this lens worked perfectly, what would be different?

No design talk yet. The machine listens for the **shape of the
scattering**: input types, producers, volume, urgency.

*Batch style: 3–5 open-ended questions. No choices offered.*

### Phase 1 — First-principles descent

The machine restates what it heard and begins descending:

- Strip the use case to fundamentals: what is this thought *about*,
  at bottom?
- What must the emission make possible? (This defines the fundamental
  outcomes — the emission's job, not its format.)
- Who or what consumes the emission — a human, an agent, a system?
  What must be true for that consumer to act without asking?

The machine states each fundamental outcome back as a testable
sentence: *"The emission must let an agent determine X without human
clarification."* The co-creator confirms, corrects, or adds.

*Batch style: 2–4 questions, each tied to a named fundamental outcome.*

### Phase 2 — Convergent batches

With fundamentals fixed, the questions narrow onto the anatomy
components (see `00-lens-anatomy.md`), in order of decreasing openness:

1. **Reception** — What shapes of light does this lens accept? Which
   must it refuse, and why? (The refusal column is designed, not
   defaulted.)
2. **Input contract** — What context must accompany the raw input for
   refraction to be possible? What reference documents, if any, does
   the lens read?
3. **Output shape** — Given the fundamental outcomes, what blocks must
   the emission contain? Each block is justified by an outcome: if a
   block serves no fundamental outcome, it is cut.
4. **Confidence gate** — What threshold? What counts as unresolved?
   What happens to ambiguities in this domain?
5. **Persona & constraints** — What stance produces the best
   refraction here? What must this lens *never* do?

*Batch style: 2–4 questions, offering choices and trade-offs where the
optics library has precedent — "Previous lenses solved this two ways…"*

### Phase 3 — Grind

The machine drafts the complete lens: all eight anatomy components,
written as a lens definition in the house style of the optics library.
The draft is presented whole — the co-creator reads the actual glass,
not a summary of it.

Corrections loop back into Phase 2 where they belong.

### Phase 4 — Test light

The lens is tested with real scattering before it is shelved:

1. Take a genuine sample of the raw input (or the closest available).
2. Run it through the new lens using the house execution model —
   the lens prompt is copied to the co-creator's agent, the emission
   is pasted back.
3. Examine the emission against the fundamental outcomes. For each
   outcome: does the emission satisfy it? Is any light lost, split
   wrongly, or left scattered?

The glass is reground until the emission is focused. **This phase is
where clarity is actually verified** — a lens has never been tested
until real light has passed through it.

### Phase 5 — Polish & shelve

The finished lens is written into the optics library
(`prism/vault/knowledge/resources/skills/`) as one or more markdown
files, with frontmatter declaring its provenance:

```
**Title:** <lens name>
**Type:** Agentic
**Status:** active
**Provenance:** co-created
**Created:** <date> · **Co-creators:** human + Prism lens-grinder
**Fundamental outcomes:** <the testable sentences from Phase 1>
**Tested against:** <sample used in Phase 4>
**Minimum agent:** L3 · ~30B parameters
**Rated by:** <model> · <date>
**Rating basis:** <hardest cognitive move, one sentence>
```

The fundamental outcomes stay in the file permanently — they are the
lens's acceptance criteria for every future refraction, and the measure
by which future regrinds are judged. The **Minimum agent** rating is the
intelligence requirement for running the lens (see
`02-intelligence-rating.md`): the library cannot assume a future runner
is as capable as the co-creating agent, so the rating is stamped at
shelve time — based on what the Phase 4 test light actually demanded —
and is revisable on field evidence via harvest notes.

### Phase 6 — Harvest (generalizability)

After every session, the machine explicitly asks itself — and surfaces
to the co-creator — one question:

> *What did we learn here that is not specific to this lens?*

Discoveries fall into three classes and are recorded in a companion
shelf (`prism/vault/knowledge/resources/grind-notes/`):

| Class | Example | Future use |
|---|---|---|
| Reusable refraction moves | "Voice transcripts need proper-noun flagging, never silent repair" | Offered during Phase 2 of future grinds |
| Output-shape wisdom | "Agent-consumed emissions always need an ambiguity block" | Checked against draft output shapes in Phase 3 |
| Reception wisdom | "Media artifacts are refused until textified" | Offered when designing refusal columns |

Harvest notes are **recommended, not injected**: future sessions see
"3 harvest notes may apply to this lens — review?" and the co-creator
opts in. This keeps the co-creator in control of what shapes the glass.

Over time the harvest shelf becomes the accumulated craft knowledge of
the workshop — the reason the hundredth lens is ground better than the
first.

---

## Questioning style rules

1. Every batch names the fundamental outcome it serves.
2. Open questions early; choices and trade-offs late.
3. Never ask what the co-creator already answered — the machine keeps
   a live ledger of established ground.
4. Never ask what the optics library or harvest notes already settle —
   cite them instead.
5. When the co-creator speaks in solutions, descend to the principle
   beneath before designing.
6. Silence is information: if the co-creator has no answer to a
   question, that gap is recorded as an explicit open item in the lens
   definition — never papered over.

---

## The bootstrap property

The grind loop is itself a lens. It receives scattered human intent
("I need something that turns incident Slack threads into debriefs"),
denoises and disambiguates it, structures it against a fixed output
shape (the eight-component anatomy), applies a confidence gate (no
shelving unclear glass), and emits a focused artifact (a lens
definition + harvest notes).

Prism therefore improves through its own optics: every lens it grinds
is an emission of the meta-lens, and every harvest note is light that
was not lost.

---

## What the machine is not

The grind loop adds no runtime. The machine is a dialogue discipline
plus a library convention. Lenses are markdown; execution remains
copy-prompt-then-paste through whatever agent the co-creator uses;
emission remains a plain text file on disk by default. The machine is
the conversation that makes better glass — nothing more, and that is
the whole point.
