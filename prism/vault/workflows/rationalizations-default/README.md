**Name:** Rationalizations Default
**Description:** Routes a Gibberish artifact through the appropriate synthesis path to produce a Structured Account, then offers post-processing options.
**For lenses:** rationalizations
**Type:** Agentic
**Skills:** vault/knowledge/resources/skills/intent-synth.md · vault/knowledge/resources/skills/conv-synth.md

---

# Rationalizations Default Workflow

Converts a Rationalizations Gibberish artifact into a well-ordered Structured Account using skill-based agents, then presents the human with post-processing options.

---

## Step 1 — Detect artifact type and route

Inspect the `**Type:**` frontmatter field of the Gibberish artifact.

| Artifact type | Agent path |
|---|---|
| `formatted` | → **[Step 2A]** Structure directly — no synthesizer needed |
| `unordered` | → **[Step 2B]** Run Intent Synthesizer → then structure |
| `dictation` | → **[Step 2B]** Run Intent Synthesizer → then structure |
| `transcript` | → **[Step 2C]** Run Conversation Synthesizer → then structure |
| `conversation` | → **[Step 2C]** Run Conversation Synthesizer → then structure |
| `media` · `application` · `code` | → Surface a message: *"This artifact type cannot be processed by the Rationalizations Default workflow. Please convert it to text first, or select a different workflow."* — stop. |

**Routing note — formatted vs unordered:** If the artifact's type field is `formatted` but the content reads as loosely structured, partially coherent, or ambiguous, treat it as `unordered` and use Step 2B. When in doubt, synthesize.

---

## Step 2A — Structure formatted input directly

The agent reads the Gibberish artifact content and structures it into the Structured Account sections without invoking a synthesizer skill.

Structuring rules:

| Section | What to populate |
|---|---|
| **Context** | Extract the situation, event, or background that gave rise to this content. Write as 2–4 sentence prose. |
| **Reasoning** | Organise the core argument or narrative into readable, ordered prose or labelled bullets. |
| **Constraints** | Identify any external limitations, facts, or non-negotiable boundaries stated or implied. If none, write "None identified." |
| **Trade-offs Accepted** | Identify any conscious choices, deferrals, or compromises explicitly made. Distinguish from Constraints — these are decisions, not facts. If none, write "None identified." |
| **Secondary Considerations** | Capture adjacent insights, edge cases, or parking-lot items. If none, write "None identified." |
| **Revisit Trigger** | State the specific conditions under which this rationalization should be revisited or challenged. |

**On completion:**
- If the agent has high confidence in all sections → proceed to **[Step 3]**.
- If one or more sections cannot be reliably populated from the input → surface specific clarifying questions to the human, collect answers, re-structure with the enriched content. Repeat until all sections are complete.

---

## Step 2B — Intent Synthesizer → Structure (unordered / dictation input)

### 2B-i: Intent Synthesizer

Invoke the **Intent Synthesizer** skill using the Gibberish artifact content as input.

Provide the agent with:

```
ARTIFACT TYPE:    unordered | dictation
ARTIFACT PATH:    <path>
LENS NAME:        Rationalization
SEED WORD:        Gibberish
RAW CONTENT:
---
<full content of Gibberish artifact>
---
```

See full agent instructions in `vault/knowledge/resources/skills/intent-synth.md`.

**On agent response:**
- **Ambiguities present (Block 5 non-empty)** → surface the clarifying questions to the human, collect answers, re-run Intent Synthesizer with the enriched input. Loop until Block 5 is clean.
- **Clean Intention Blocks** → proceed to 2B-ii.

### 2B-ii: Structure the Intention Blocks output

Map the Intention Blocks directly to the Structured Account sections:

| Intention Block | Maps to |
|---|---|
| Block 1 — Core Objective & Problem Statement | **Context** |
| Block 2 — Primary Intentions (Functional) | **Reasoning** |
| Block 3 — Technical & Architectural Constraints | **Constraints** — but separate any conscious deferrals or choices into **Trade-offs Accepted** |
| Block 4 — Edge Cases & Sidetrack Insights | **Secondary Considerations** |
| Block 5 — Identified Ambiguities | **Revisit Trigger** (resolved ambiguities become forward-looking conditions; unresolved ones become open questions that block handoff-ready state) |

**Constraints vs Trade-offs Accepted rule:** If a Block 3 item is phrased as an external fact or limit ("cannot exceed X", "must comply with Y"), it goes in **Constraints**. If it is phrased as a choice or compromise ("we decided not to…", "deferred until…"), it goes in **Trade-offs Accepted**. Items that are genuinely ambiguous should be surfaced to the human for classification before proceeding.

Once all sections are populated → proceed to **[Step 3]**.

---

## Step 2C — Conversation Synthesizer → Structure (transcript / conversation input)

### 2C-i: Conversation Synthesizer

Invoke the **Conversation Synthesizer** skill using the Gibberish artifact content as input.

Provide the agent with:

```
ARTIFACT TYPE:    transcript | conversation
ARTIFACT PATH:    <path>
LENS NAME:        Rationalization
RAW CONTENT:
---
<full content of Gibberish artifact>
---
```

See full agent instructions in `vault/knowledge/resources/skills/conv-synth.md`.

**Long transcript guidance:** If the transcript exceeds ~2,000 words and covers multiple distinct topics, run the Conversation Synthesizer once per topic thread and merge the Actionable Blocks outputs before structuring.

**On agent response:**
- **Open Questions present (Block 5 non-empty)** → surface the open questions to the human. Collect answers. Re-run Conversation Synthesizer with the enriched context if needed. Proceed once Block 5 is resolved or the human accepts the open questions as forward-looking conditions.
- **Clean Actionable Blocks** → proceed to 2C-ii.

### 2C-ii: Structure the Actionable Blocks output

Map the Actionable Blocks directly to the Structured Account sections:

| Actionable Block | Maps to |
|---|---|
| Block 1 — Executive Summary & Core Objective | **Context** |
| Block 2 — Key Initiatives & Deliverables | **Reasoning** |
| Block 3 — Operational & Budgetary Constraints | **Constraints** — but separate any conscious deferrals or choices into **Trade-offs Accepted** |
| Block 4 — Secondary Considerations & Future Items | **Secondary Considerations** |
| Block 5 — Open Questions & Ambiguities | **Revisit Trigger** (resolved → forward-looking conditions; unresolved → block handoff-ready state) |

Apply the same **Constraints vs Trade-offs Accepted rule** from Step 2B-ii.

Once all sections are populated → proceed to **[Step 3]**.

---

## Step 3 — Post-processing options

Once a Structured Account has been produced, present the human with the following options. Display them as clearly labelled action buttons or a numbered list in the chat window.

---

### Option A — Archive (emit, no additional steps)

Save the Structured Account as the main content of the Rationalization file in `vault/rationalizations/`. Update `**Status:** review`. Proceed to the standard **Emit & Archive** flow — the Rationalization is marked emitted and all assets are moved to `vault/archive/rationalizations/<name>/`.

*Use when: the Structured Account is complete and no further processing or integration is needed.*

---

### Option B — Re-run with additional input

Offer the human one or more of the following input methods to enrich the context before re-running:

| Input method | Description |
|---|---|
| **Type in chat** | Human types additional context directly in the chat input field |
| **Attach file** | Human attaches one or more files (markdown, text, CSV, JSON) via the chat attachment button |
| **Dictate** | Human uses the speech-to-text button to dictate additional context verbally |
| **Paste from clipboard** | Human pastes raw content into the chat input |

Once input is received, re-run from the correct Step 2 path with the combined original + additional context.

*Use when: the Structured Account is close but the human has additional context that was not in the original artifact.*

---

### Option C — Send output to another lens or workflow

Re-surface the **Rationalization Lens Workflow UI** (Step 3 of the wizard) with the current Structured Account pre-loaded as a new sub-asset. The human can then select any workflow from the library and launch a new processing chain — for example, promoting the Structured Account into a Requirement or Decision.

*Use when: the structured content should be the seed for another Prism lens, or needs to pass through a downstream workflow.*

---

### Option D — Return to Unprocessed queue

Close the workflow chat and navigate the human back to the Unprocessed queue (`ingestion/unprocessed/`). The current Rationalization file remains in `vault/rationalizations/` with whatever status it currently has.

*Use when: the human wants to stop and revisit this rationalization later.*

---

### Option E — Archive and emit to integration

Archive the Rationalization (same as Option A) and additionally route the emitted Structured Account to an external integration. Present the human with the configured integrations available in `vault/knowledge/integrations-config/`. Each integration defines its own emission handling.

*Use when: the Structured Account needs to be pushed to an external system (e.g., a document management system, AI agent API, or knowledge base) at the point of emission.*

---

## Skill references

- **Intent Synthesizer:** `vault/knowledge/resources/skills/intent-synth.md`
- **Conversation Synthesizer:** `vault/knowledge/resources/skills/conv-synth.md`
- **Process definition:** `vault/knowledge/process/rationalizations.md`
- **Integrations config:** `vault/knowledge/integrations-config/`
