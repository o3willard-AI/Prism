**Name:** UX Bridge
**Description:** Interviews the PM through the UX Bridge agent to produce a complete UX Hand-off Specification, then offers post-processing options.
**For lenses:** requirements
**Type:** Agentic
**Skills:** vault/knowledge/resources/skills/ux-bridge.md

---

# UX Bridge Workflow

Converts one or more Requirements assets into a finalised **UX Hand-off Specification** by running the UX Bridge agent — a senior TPM liaison that interviews the PM until all 11 mandatory UX fields are satisfied at ≥95% confidence.

---

## Step 1 — Load assets

Collect the primary asset and any sub-assets passed into this workflow. These form the `PM DESCRIPTION` input for the UX Bridge agent.

Gather additional context:
- Load any relevant product documentation from `vault/knowledge/product/` as the `PRODUCT CONTEXT` input
- Load `vault/knowledge/process/ux-information-requirements.md` as the `UX REQUIREMENTS` input

If multiple assets are loaded, concatenate them in order (primary first, sub-assets appended) into a single `PM DESCRIPTION` block.

---

## Step 2 — Run UX Bridge agent

Invoke the **UX Bridge** skill with the following input block:

```
PRODUCT CONTEXT:
---
[content from vault/knowledge/product/ relevant to the feature area]
---

UX REQUIREMENTS:
vault/knowledge/process/ux-information-requirements.md

PM DESCRIPTION:
---
[full content of primary asset + any sub-assets]
---
```

See full agent instructions in `vault/knowledge/resources/skills/ux-bridge.md`.

**During the Q&A loop:**
- Surface each question to the PM in the chat window — one question at a time
- Paste the PM's answer back to the agent to continue the loop
- The agent will recalculate confidence after each answer
- The loop ends automatically when confidence reaches ≥95%

**On final output:**
- The agent produces a structured **UX Hand-off Specification** with all 11 mandatory sections
- Proceed to **[Step 3]**

---

## Step 3 — Post-processing options

Once the UX Hand-off Specification has been produced, present the PM with the following options as clearly labelled action buttons or a numbered list in the chat window.

---

### Option A — Archive (emit, no additional steps)

Save the UX Hand-off Specification as the main content of the Requirement file in `vault/requirements/`. Update `**Status:** ux-ready`. Proceed to the standard **Emit & Archive** flow — the Requirement is marked emitted and all assets are moved to `vault/archive/requirements/<name>/`.

*Use when: the spec is complete and no further integration or downstream workflow is needed.*

---

### Option B — Re-run PRD Gate with additional inputs

Offer the PM one or more of the following input methods to enrich context before re-running the UX Bridge agent:

| Input method | Description |
|---|---|
| **Type in chat** | PM types additional context directly in the chat input field |
| **Attach file** | PM attaches one or more files (markdown, text, CSV, JSON) via the chat attachment button |
| **Dictate** | PM uses the speech-to-text button to dictate additional context verbally |
| **Paste from clipboard** | PM pastes raw content into the chat input |

Once input is received, re-run **Step 2** with the combined original + additional context. The confidence score resets and the Q&A loop resumes from the current gap state.

*Use when: the spec is close but the PM has additional context not captured in the original asset(s).*

---

### Option C — Send output to additional workflow

Re-surface the **Requirement Lens Workflow UI** (Step 3 of the Requirements wizard) with the current UX Hand-off Specification pre-loaded as a new sub-asset. The PM can then select any workflow from the library and launch a new processing chain.

*Use when: the spec needs to pass through a compliance check, estimation flow, or any other downstream workflow in the library before handoff.*

---

### Option D — Return to Unprocessed queue

Close the workflow chat and navigate the PM back to the Unprocessed queue (`ingestion/unprocessed/`). The current Requirement file remains in `vault/requirements/` with whatever status it currently has.

*Use when: the PM wants to stop and revisit this item later.*

---

### Option E — Archive and emit to integration

Archive the Requirement (same as Option A) and additionally route the emitted UX Hand-off Specification to an external integration. Present the PM with the configured integrations available in `vault/knowledge/integrations-config/`. Each integration defines its own emission handling.

*Use when: the spec needs to be pushed to an external system (e.g., Figma handoff, Jira ticket, Notion design brief) at the point of emission.*

---

## Skill references

- **UX Bridge:** `vault/knowledge/resources/skills/ux-bridge.md`
- **UX Information Requirements:** `vault/knowledge/process/ux-information-requirements.md`
- **Product context:** `vault/knowledge/product/`
- **Integrations config:** `vault/knowledge/integrations-config/`
