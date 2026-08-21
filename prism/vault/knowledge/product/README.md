# Product Context

**Purpose for agents:** This folder contains markdown files that describe existing products — their scope, capabilities, constraints, and current state. When lensing out a human idea or intention, reference these files to ground the output in what actually exists today.

**What belongs here:**
- Product overviews and positioning statements
- Feature inventories and capability maps
- Known limitations and technical constraints
- Current release state and roadmap context

**What does NOT belong here:** Hypotheses, requirements, or aspirational descriptions — those live in their respective Prism lenses.

---

## Editing Conventions

> **All content files in this folder are agent-authored.** Do not edit them directly. To add or update product context, describe what you need in Prism and the agent will create or update the file.

Full conventions (file naming, frontmatter, status values, archiving, security) are defined in `vault/knowledge/README.md`.

**Required frontmatter for every file in this folder:**
```
**Title:** <product name or topic>
**Category:** product
**Owner:** <product team or PM>
**Status:** active | draft | archived
**Last updated:** <DDMonthYYYY>
```

Files become `archived` when a product is sunset, significantly redesigned, or replaced. Agents must not cite `archived` files as current product state.
