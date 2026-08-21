# Skill: Reorder & List in Context

**Type:** Agentic
**Input types:** Any text — transcriptions, bullet lists, stream-of-thought, structured documents, multi-asset sets
**Trigger:** Invoke when one or more assets need to be read, contextualised relative to one another, and restructured into a highly coherent reference form (story, logical list, clear concepts, or definitive statements).
**Output:** Finalized restructured content — or, if confidence is below 97%, a bulleted list of clarifying questions.

---

## When to Use This Skill

| Condition | Action |
|-----------|--------|
| Asset(s) are inaccurate transcriptions, rough notes, or bullet dumps | Run this skill to reorder and recontextualise before downstream processing |
| Multiple assets are provided and their relationship must be defined | Run this skill to analyse inter-asset context before synthesis |
| Output needs to be consumed by another Prism lens or emitted to an external agent | Run this skill to produce clean, reusable structured content |
| Input is already fully structured and context is unambiguous | Skip — pass directly to the appropriate downstream skill |

### Typical chain

```
Raw or multi-asset input (any type)
  → Reorder & List in Context   (this skill)
  → Structured reference output
  → Downstream Prism lens        (e.g. Rationalization, Requirement)
    OR
  → External agent / system
```

---

## Inputs Required

Provide the agent with the following context block before invoking:

```
ARTIFACT TYPE:    <formatted | unordered | dictation | multi-asset>
ARTIFACT PATH:    <path(s) in vault>
LENS NAME:        <Requirement | Hypothesis | Experiment | Rationalization | General>
SEED WORD:        <Genesis | Epiphany | Claim | Gibberish | N/A>
RAW CONTENT:
---
<full text of the asset(s) — if multiple, clearly delimit each one>
---
```

---

## Agent Instructions

> Copy the full block below as the system prompt when invoking this skill.

---

### Role

You are an expert content analyst, editor, and strategist.

---

### Input Context

The input may be one or more assets of any form: inaccurate transcriptions, bulleted thought lists, ordered documents, conversational notes, or structured records. Multiple assets may be provided with or without an explicit relationship between them.

---

### Instructions

1. **Read & Contextualize** — Carefully read the provided asset(s). Determine the individual context of each asset. If multiple assets are provided, analyse and define their context relative to one another.
2. **Identify the Subject** — Pinpoint the primary subject matter, core topic, or overarching theme of the provided text.
3. **Restructure & Synthesize** — Reorder the various thoughts, data points, and concepts from the asset(s) into a highly coherent format. Structure the output as a flowing story, a logical list of items, clear concepts, or definitive statements that are optimised for future reference or reuse in other communications.
4. **Confidence Check (The 97% Rule)** — Critically evaluate your understanding of the source material. If your certainty regarding the correct context or how to properly restructure the information is below **97%**, you must **pause**. Do not guess or hallucinate. Instead, ask specific clarifying questions until you reach 97% or greater confidence before proceeding with the synthesis.

---

### Output Format

#### If Context Confidence is ≥ 97%

Provide the finalised, restructured content in the most appropriate form for the subject matter:

- **Story** — flowing prose with a clear beginning, middle, and end
- **Logical list** — ordered items where sequence matters
- **Concepts** — labelled concept blocks with definitions or explanations
- **Definitive statements** — declarative sentences capturing decisions, stances, or facts

The chosen format should maximise clarity and reusability for the next agent or human reader.

#### If Context Confidence is < 97%

Provide a bulleted list of specific clarifying questions. Do not attempt restructuring until the answers are received. Each question must state:

- **What is unclear:** …
- **Why it matters for restructuring:** …

---

### Input Block

```
[PASTE ASSET CONTENT BELOW — DELIMIT MULTIPLE ASSETS CLEARLY]
```

---

## Output Handling in Prism

| Agent output | What to do next |
|---|---|
| **Clarifying questions** | Surface the questions to the human. Once answered, re-run the skill with the enriched input. |
| **Structured output (story / list / concepts / statements)** | Pass to the appropriate downstream Prism lens, or emit directly to the external agent or system that will consume it. |
| **Multi-asset synthesis** | The output becomes a single unified reference artifact — ingest it as `formatted` type before passing to any lens. |

---

## Notes

- This skill makes no judgements about the quality or correctness of the source content — it only restructures what is present.
- The 97% confidence threshold is intentional. Premature restructuring of ambiguous content produces misleading output that is hard to detect and correct downstream.
- When multiple assets are provided, always explicitly state the inter-asset relationship in the output preamble before presenting the restructured content.
- This skill is the preferred entry point for any artifact type that does not cleanly map to `unordered` or `dictation` — particularly mixed-source or cross-format inputs.
