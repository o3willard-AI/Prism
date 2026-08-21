# Agents

**Purpose for agents:** This folder contains full agent definitions — the complete, named agents that are instantiated in Prism workflows. Each file defines one agent: its identity, role, capabilities, knowledge references, and system prompt. Agents invoke skills (defined in `resources/skills/`) but are distinct from them.

**Distinction from `resources/skills/`:**

| | Skills (`resources/skills/`) | Agents (`agents/`) |
|---|---|---|
| **What it is** | A reusable capability or prompt pattern | A complete, named agent persona |
| **Scope** | A single focused task (e.g., synthesise a conversation) | A full role with many capabilities and a system prompt |
| **Invoked by** | An agent, as a tool | A workflow, as the primary actor |
| **Contains** | Input/output contract, trigger conditions, agent instructions | Identity, role, knowledge refs, skills list, full system prompt |

**What belongs here:**
- Full agent system prompts and identity definitions
- The list of skills and knowledge sources each agent draws on
- Routing rules for which workflows each agent serves
- Output and handoff behaviour

**What does NOT belong here:** Individual skill definitions, one-off prompts, or workflow definitions — those belong in `resources/skills/` and `workflows/` respectively.

**Agent file format:**
```
# Agent: [Name]

**Role:** [one-line description of what this agent does]
**Serves workflows:** [list of workflow IDs]
**Skills:** [list of skill files this agent may invoke]
**Knowledge refs:** [list of vault/knowledge paths this agent reads]

## Identity & Tone
## Capabilities
## System Prompt
## Handoff Behaviour
## Notes
```

---

## Editing Conventions

> **All agent files in this folder are agent-authored.** Do not edit them directly. To define a new agent or update an existing one, describe the desired behaviour in Prism and the agent will create or update the file.

Full conventions (file naming, frontmatter, status values, archiving, security) are defined in `vault/knowledge/README.md`.

**Required frontmatter for every agent file:**
```
**Title:** <agent name>
**Category:** agent
**Owner:** <team that owns and maintains this agent>
**Status:** active | draft | archived
**Last updated:** <DDMonthYYYY>
```

Agents become `archived` when they are replaced by a newer definition or when the workflow they serve is retired. Archived agents must not be invoked by workflows.
