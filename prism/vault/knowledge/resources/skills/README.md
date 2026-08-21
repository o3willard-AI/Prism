# Agent Skills

**Purpose for agents:** This folder contains skill definitions — reusable agent capabilities, prompt patterns, and workflow templates that can be invoked when processing Prism lenses. Each file describes one skill: what it does, when to use it, required inputs, and expected outputs.

**What belongs here:**
- Agent system prompts and role definitions
- Skill trigger conditions and input/output contracts
- Workflow templates that chain multiple agent calls
- Output handling instructions for each skill's results

**What does NOT belong here:** One-off prompts or exploratory experiments — only stable, tested skills that agents can invoke reliably.

**Skill file format:**
```
# Skill: [Name]

**Type:** Agentic
**Input types:** [list of accepted artifact types]
**Trigger:** [when to invoke]
**Output:** [what this skill produces]

## When to Use This Skill
## Inputs Required
## Agent Instructions
## Output Handling in Prism
## Notes
```

---

## Editing Conventions

> **All skill files in this folder are agent-authored.** Do not edit them directly. To add a new skill or refine an existing one, describe the desired agent behaviour in Prism and the agent will create or update the skill file.

Full conventions (file naming, frontmatter, status values, archiving, security) are defined in `vault/knowledge/README.md`.

**Required frontmatter for every skill file:**
```
**Title:** <skill name>
**Category:** skill
**Owner:** <team that owns and maintains this skill>
**Status:** active | draft | archived
**Last updated:** <DDMonthYYYY>
```

Skills become `archived` when a better skill supersedes them or when the underlying model behaviour they depend on has changed enough to make them unreliable. Agents must not invoke `archived` skills.
