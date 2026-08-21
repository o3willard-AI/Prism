**Name:** Requirements Default
**Description:** Routes a Genesis artifact through the right agent path to produce a developer-ready PRD, then offers post-processing options.
**For lenses:** requirements
**Type:** Agentic
**Skills:** vault/knowledge/resources/skills/intent-synth.md · vault/knowledge/resources/skills/prd-gate.md

---

# Requirements Default Workflow

Converts a Requirements Genesis artifact into a developer-ready PRD using skill-based agents, then presents the human with post-processing options.

---

## Step 1 — Detect artifact type and route

Inspect the `**Type:**` frontmatter field of the Genesis artifact.

| Artifact type | Agent path |
|---|---|
| `formatted` | → **[Step 2A]** Run PRD Gate directly |
| `unordered` | → **[Step 2B]** Run Intent Synthesizer → then PRD Gate |
| `dictation` | → **[Step 2B]** Run Intent Synthesizer → then PRD Gate |
| `media` · `application` · `code` | → Surface a message: *"This artifact type cannot be processed by the Requirements Default workflow. Please convert it to formatted or unordered text first, or select a different workflow."* — stop. |

---

## Step 2A — PRD Gate (formatted input)

Invoke the **PRD Gate** skill using the Genesis artifact content as input.

Provide the agent with:

```
ARTIFACT TYPE:    formatted
ARTIFACT PATH:    <path>
REQUIREMENT NAME: <title>
SEED CONTENT:
---
<full content of genesis artifact>
---
```

See full agent instructions in `vault/knowledge/resources/skills/prd-gate.md`.

**On agent response:**
- **Inquiry** → surface the numbered questions to the human in the chat window, collect answers, re-run PRD Gate with enriched input. Loop until Execution is returned.
- **Execution (PRD)** → proceed to **[Step 3]**.

---

## Step 2B — Intent Synthesizer → PRD Gate (unordered / dictation input)

### 2B-i: Intent Synthesizer

Invoke the **Intent Synthesizer** skill using the Genesis artifact content as input.

Provide the agent with:

```
ARTIFACT TYPE:    unordered | dictation
ARTIFACT PATH:    <path>
LENS NAME:        Requirement
SEED WORD:        Genesis
RAW CONTENT:
---
<full content of genesis artifact>
---
```

See full agent instructions in `vault/knowledge/resources/skills/intent-synth.md`.

**On agent response:**
- **Ambiguities present (Block 5 non-empty)** → surface the clarifying questions to the human, collect answers, re-run Intent Synthesizer with the enriched transcript. Loop until Block 5 is clean.
- **Clean Intention Blocks** → proceed to 2B-ii.

### 2B-ii: PRD Gate

Pass the full Intention Blocks output from 2B-i directly to the **PRD Gate** skill as the `[APPEND SYNTHESIZED INTENTIONS HERE]` input block.

```
ARTIFACT TYPE:    unordered
ARTIFACT PATH:    <path>
REQUIREMENT NAME: <title>
SEED CONTENT:
---
<paste full Intention Blocks output here>
---
```

**On agent response:**
- **Inquiry** → surface questions to the human, collect answers, re-run PRD Gate with enriched input. Loop until Execution is returned.
- **Execution (PRD)** → proceed to **[Step 3]**.

---

## Step 3 — Post-processing options

Once a PRD has been produced, present the human with the following options. Display them as clearly labelled action buttons or a numbered list in the chat window.

---

### Option A — Archive (emit, no additional steps)

Save the PRD as the main content of the Requirement file in `vault/requirements/`. Update `**Status:** review`. Proceed to the standard **Emit & Archive** flow — the Requirement is marked emitted and all assets are moved to `vault/archive/requirements/<name>/`.

*Use when: the PRD is complete and no further integration or downstream workflow is needed.*

---

### Option B — Re-run PRD Gate with additional inputs

Offer the human one or more of the following input methods to enrich the context before re-running:

| Input method | Description |
|---|---|
| **Type in chat** | Human types additional context directly in the chat input field |
| **Attach file** | Human attaches one or more files (markdown, text, CSV, JSON) via the chat attachment button |
| **Dictate** | Human uses the speech-to-text button to dictate additional context verbally |
| **Paste from clipboard** | Human pastes raw content into the chat input |

Once input is received, re-run **Step 2A** (or **Step 2B** if the new input is unordered) with the combined original + additional context.

*Use when: the PRD is close but the human has additional context that was not in the original artifact.*

---

### Option C — Send output to additional workflow

Re-surface the **Requirement Lens Workflow UI** (Step 3 of the Requirements wizard) with the current PRD output pre-loaded as a new sub-asset. The human can then select any workflow from the library and launch a new processing chain.

*Use when: the PRD needs to pass through a compliance check, estimation flow, or any other downstream workflow in the library.*

---

### Option D — Return to Unprocessed queue

Close the workflow chat and navigate the human back to the Unprocessed queue (`ingestion/unprocessed/`). The current Requirement file remains in `vault/requirements/` with whatever status it currently has.

*Use when: the human wants to stop and revisit this requirement later.*

---

### Option E — Archive and emit to integration

Archive the Requirement (same as Option A) and additionally route the emitted PRD to an external integration. Present the human with the configured integrations available in `vault/knowledge/integrations-config/`. Each integration defines its own emission handling.

*Use when: the PRD needs to be pushed to an external system (e.g., Jira, Linear, Notion, GitHub Issues) at the point of emission.*

---

## Skill references

- **Intent Synthesizer:** `vault/knowledge/resources/skills/intent-synth.md`
- **PRD Gate:** `vault/knowledge/resources/skills/prd-gate.md`
- **Integrations config:** `vault/knowledge/integrations-config/`
