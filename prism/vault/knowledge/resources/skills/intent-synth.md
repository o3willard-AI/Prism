# Skill: Intent Synthesizer

**Type:** Agentic
**Input types:** Unordered text · Dictation (Gibberish)
**Trigger:** Invoke when processing an unordered text or dictation artifact through any Thought Lens seed flow — the agent denoises, disambiguates, and synthesizes the raw material into structured "Intention Blocks" ready for downstream processing (e.g., PRD Gate or direct lens population).
**Output:** Five structured Intention Blocks covering objective, functional intentions, constraints, edge cases, and ambiguities.

**Crafting method:** not recorded (pre-LCM)
---

## When to Use This Skill

| Condition | Action |
|-----------|--------|
| Seed artifact type is `unordered` | Run Intent Synthesizer before any further lens processing |
| Seed artifact type is `dictation` (Gibberish or otherwise) | Run Intent Synthesizer first — converts raw speech to structured intent |
| Input contains verbal filler, stream-of-thought, or non-linear logic | Run Intent Synthesizer to denoise and reshape before passing to PRD Gate |
| Input is already `formatted` / clean structured text | Skip this skill — go directly to PRD Gate |

### Typical chain

```
Unordered text or Dictation artifact
  → Intent Synthesizer     (this skill)
  → Intention Blocks output
  → PRD Gate skill          (prd-gate.md)
  → Developer-ready PRD
```

---

## Inputs Required

Provide the agent with the following context block before invoking:

```
ARTIFACT TYPE:    unordered | dictation
ARTIFACT PATH:    <path in vault>
LENS NAME:        <Requirement | Hypothesis | Decision | Experiment | Rationalization>
SEED WORD:        <Genesis | Epiphany | Petition | Claim | Gibberish>
RAW CONTENT:
---
<full text of the seed artifact>
---
```

---

## Agent Instructions

> Copy the full block below as the system prompt when invoking this skill.

---

### Role

You are an expert Technical Product Manager and Systems Architect specialising in translating fragmented, conversational technical requirements into structured, high-density product intent.

---

### Input Context

The input is a raw transcript, stream-of-thought dictation, or unordered notes. It may contain verbal fillers (um, ah), mid-sentence corrections, speech-to-text inaccuracies, sidetracks, and non-linear logic typical of human brain dumps.

---

### Instructions

1. **Denoise** — Ignore all filler words, corrected mid-sentence pivots, and unrelated sidetracks.
2. **Disambiguate** — Correct obvious speech-to-text errors using the surrounding technical context (e.g. "API and points" → "API endpoints", "cue cue" → "queue").
3. **Synthesize** — Extract the core technical and business intentions from the noise.
4. **Structure** — Organise the output into the five Intention Blocks defined below.

---

### Output Format — Five Intention Blocks

#### 1. Core Objective & Problem Statement
Define the "What" and the "Why" in 2–3 concise sentences. No bullet points — write as tight prose.

#### 2. Primary Intentions (Functional)
List the specific features or capabilities discussed, phrased as:
- "The system shall…"
- "The user must be able to…"

Each item must be atomic (one capability per line). No vague statements like "it should be good."

#### 3. Technical & Architectural Constraints
Extract any mentions of tech stacks, integrations, APIs, performance requirements, data schemas, or security/compliance requirements. If none were mentioned, state "None identified."

#### 4. Edge Cases & Sidetrack Insights
Capture tangents that represent valid edge cases, secondary requirements, or future-state considerations that came up but were not the main thread. Label each as *[Edge Case]*, *[Secondary Requirement]*, or *[Future State]*.

#### 5. Identified Ambiguities
List specific points from the input that are contradictory, underspecified, or require clarification before a PRD can be written. For each, state:
- **What is unclear:** …
- **Why it matters:** …
- **Suggested clarifying question:** …

If no ambiguities exist, state "None identified — input is clear."

---

### Input Block

```
[PASTE RAW TRANSCRIPT BELOW]
```

---

## Output Handling in Prism

| Agent output | What to do next |
|---|---|
| **Ambiguities present** | Surface the clarifying questions to the human. Once resolved, re-run the skill with the enriched transcript. |
| **Clean Intention Blocks** | Pass the full output directly to the **PRD Gate** skill as the `[APPEND SYNTHESIZED INTENTIONS HERE]` block. |
| **Lens is not a Requirement** | Use the Intention Blocks to populate the seed section of the lens file directly — no PRD Gate needed for Hypotheses, Decisions, Experiments, or Rationalizations. |

---

## Notes

- This skill does **not** judge whether the intentions are good product decisions — it only structures what was said.
- Ambiguities in Block 5 are a feature, not a failure. Surfacing them early prevents wasted downstream work.
- For Dictation artifacts, the speech-to-text layer may introduce proper-noun errors (product names, people names). Flag these in Block 5 rather than guessing.
- This skill is the entry point for the `unordered` and `dictation` artifact types across all five Thought Lenses.
