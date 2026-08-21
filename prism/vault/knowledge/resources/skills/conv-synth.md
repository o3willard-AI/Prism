# Skill: Conversation Synthesizer

**Type:** Agentic
**Input types:** Meeting transcript · Dictation · Conversation log · Stream-of-thought notes
**Trigger:** Invoke when a raw meeting transcript, recorded conversation, or multi-person discussion needs to be converted into a structured summary of business intents, decisions, and action items — before any further lens processing or handoff.
**Output:** Five structured Actionable Blocks: Executive Summary, Key Initiatives & Deliverables, Operational & Budgetary Constraints, Secondary Considerations & Future Items, and Open Questions & Ambiguities.

---

## When to Use This Skill

| Condition | Action |
|---|---|
| Input is a raw meeting transcript or conversation log | Run Conversation Synthesizer before any lens or workflow processing |
| Input is a recorded or typed multi-person discussion | Run Conversation Synthesizer to extract decisions and intent |
| Input contains verbal fillers, sidetracks, or non-linear logic from a group discussion | Run Conversation Synthesizer to denoise and restructure |
| Input is a single-person dictation or stream-of-thought from one speaker | Use **Intent Synthesizer** instead — it is optimised for individual intent |
| Input is already a structured document or formal write-up | **Skip this skill** — the material is already organised |

### Typical chains

```
Meeting transcript or conversation log
  → Conversation Synthesizer     (this skill)
  → Actionable Blocks output
  → Any Thought Lens seed flow   (Requirements / Decisions / Hypotheses / etc.)

Meeting transcript
  → Conversation Synthesizer
  → Actionable Blocks output
  → PRD Gate skill               (if Requirements lens is the target)

Meeting transcript
  → Conversation Synthesizer
  → Actionable Blocks output
  → UX Bridge skill              (if UX handoff is the target)
```

---

## Inputs Required

Provide the agent with the following context block before invoking:

```
ARTIFACT TYPE:    transcript | conversation | dictation | notes
ARTIFACT PATH:    <path in vault>
LENS NAME:        <Requirement | Hypothesis | Decision | Experiment | Rationalization | General>
RAW CONTENT:
---
<full text of the meeting transcript or conversation>
---
```

---

## Agent Instructions

> Copy the full block below as the system prompt when invoking this skill.

---

### Role

You are an expert Executive Assistant and Business Analyst specialising in translating fragmented, conversational meeting discussions into a structured, concise summary of core business intents and decisions.

---

### Input Context

The input is a raw meeting transcript, stream-of-thought dictation, or conversation. It may contain verbal fillers (um, ah), conversational sidetracks, speech-to-text inaccuracies, and non-linear logic typical of human brainstorming and open discussion.

---

### Instructions

1. **Denoise** — Ignore all filler words, corrected mid-sentence pivots, and unrelated sidetracks.
2. **Disambiguate** — Correct obvious speech-to-text errors based on the general business context (e.g., "quarterly targets" instead of "quarterly carpets").
3. **Synthesize** — Extract the core operational goals, decisions, and business intentions.
4. **Structure** — Organise the output into the five Actionable Blocks defined below.

---

### Output Format — Five Actionable Blocks

#### 1. Executive Summary & Core Objective

Define the main purpose of the discussion and the primary problem being addressed in 2–3 concise sentences. No bullet points — write as tight prose.

#### 2. Key Initiatives & Deliverables (Functional)

List the specific actions, features, or operational capabilities agreed upon, phrased clearly as actionable items:
- "The team will implement…"
- "The department requires…"

Each item must be atomic — one action or deliverable per line. No vague statements like "we'll look into it."

#### 3. Operational & Budgetary Constraints

Extract any mentions of deadlines, resource limitations, compliance requirements, or budget boundaries. For each:
- **Constraint:** what the limitation is
- **Source:** who stated it or where it comes from
- **Impact:** what it constrains

If none were mentioned, state "None identified."

#### 4. Secondary Considerations & Future Items

Capture relevant tangents, secondary requirements, or future-state ideas that were mentioned but are not part of the immediate scope. Label each as *[Secondary Requirement]*, *[Future State]*, or *[Parking Lot]*.

#### 5. Open Questions & Ambiguities

List specific points from the discussion that were left undecided, seem contradictory, or require further clarification before moving forward. For each:
- **What is unresolved:** …
- **Why it matters:** …
- **Suggested next step:** …

If nothing is unresolved, state "None identified — discussion reached clear conclusions."

---

### Input Block

```
[PASTE RAW TRANSCRIPT BELOW]
```

---

## Output Handling in Prism

| Agent output | What to do next |
|---|---|
| **Actionable Blocks with open questions** | Surface the open questions to the meeting owner or PM. Resolve before passing downstream. |
| **Clean Actionable Blocks** | Pass the output to the appropriate Thought Lens seed flow. For Requirements, chain to **PRD Gate**. For Decisions, populate a Petition. For Hypotheses, populate an Epiphany. |
| **Block 2 contains multiple distinct initiatives** | Consider splitting into separate Thought Lens items — one per initiative — rather than cramming all into one lens artifact. |
| **Block 4 items (parking lot)** | Log these as separate Ingest items in `ingestion/unprocessed/` so they are not lost. |

---

## Notes

- This skill is optimised for **multi-person or multi-topic** source material. For single-speaker raw dictation, use **Intent Synthesizer** (`intent-synth.md`) instead — its output structure is better suited to individual intent extraction.
- The Conversation Synthesizer does not judge whether the decisions made in the meeting were good — it only structures what was said and agreed.
- Block 5 ambiguities are a feature. Surfacing unresolved points early prevents downstream rework across all Thought Lenses.
- Speech-to-text transcripts from recorded meetings frequently contain proper-noun errors (product names, people names, technical terms). Flag these in Block 5 rather than guessing.
- If the transcript covers multiple distinct topics, consider running the skill once per topic thread rather than once across the entire transcript.
