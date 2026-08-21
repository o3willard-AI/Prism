# Process Context

**Purpose for agents:** This folder contains markdown files that describe established team and organizational processes. When lensing out a human idea or intention, reference these files to ensure outputs align with how work actually gets done.

**What belongs here:**
- Development and delivery processes (sprint cadence, release gates, etc.)
- Review and approval workflows
- Escalation paths and decision rights
- Rituals, ceremonies, and their owners

**What does NOT belong here:** Ad hoc notes or one-off process changes — only stable, established processes that agents can reliably reference.

---

## Editing Conventions

> **All content files in this folder are agent-authored.** Do not edit them directly. To add or update a process, describe it in Prism and the agent will formalise it.

Full conventions (file naming, frontmatter, status values, archiving, security) are defined in `vault/knowledge/README.md`.

**Required frontmatter for every file in this folder:**
```
**Title:** <process name>
**Category:** process
**Owner:** <team or role that owns this process>
**Status:** active | draft | archived
**Last updated:** <DDMonthYYYY>
```

Files become `archived` when a process is formally retired or superseded. Agents referencing process files must check `**Status:** active` before applying the process to any output.
