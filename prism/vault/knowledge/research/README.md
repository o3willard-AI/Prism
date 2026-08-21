# Research Context

**Purpose for agents:** This folder contains markdown files summarizing previously established research — user studies, market analysis, competitive intelligence, and validated findings. When lensing out a human idea or intention, reference these files to avoid re-litigating settled questions and to ground outputs in evidence.

**What belongs here:**
- Summarized user research and interview findings
- Validated personas and behavioral patterns
- Market and competitive landscape summaries
- Analytics findings and quantitative baselines

**What does NOT belong here:** Raw unprocessed artifacts (those live in `ingestion/unprocessed/`) or active hypotheses (those live in the Hypotheses lens).

---

## Editing Conventions

> **All content files in this folder are agent-authored.** Do not edit them directly. Research is promoted here when a Thought Lens emission validates a finding — the agent creates the file as part of the emit workflow.

Full conventions (file naming, frontmatter, status values, archiving, security) are defined in `vault/knowledge/README.md`.

**Required frontmatter for every file in this folder:**
```
**Title:** <research topic or study name>
**Category:** research
**Owner:** <team or researcher who conducted or commissioned the work>
**Status:** active | draft | archived
**Last updated:** <DDMonthYYYY>
```

Files become `archived` when findings are superseded by newer research or when the context (product, market, user base) has changed significantly enough to make the findings unreliable. Agents must not cite `archived` research as current evidence.
