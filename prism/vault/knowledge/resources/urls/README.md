# Reference URLs

**Purpose for agents:** This folder contains curated URL lists — documentation, APIs, style guides, and other web resources that agents may need to reference during processing. Each file groups related URLs by topic.

**What belongs here:**
- Official product and platform documentation links
- API reference URLs for tools Prism integrates with
- Design system and brand guideline URLs
- Standards bodies or compliance reference URLs relevant to the team's work

**What does NOT belong here:** Temporary links, personal bookmarks, or URLs that require authentication to access.

**URL file format:**
```
# [Topic] URLs

- [Label](https://url) — one-line description of what's at this URL
```

---

## Editing Conventions

> **All URL files in this folder are agent-authored.** Do not edit them directly. To add or update URL references, provide the URLs in Prism and the agent will add them to the appropriate file (or create a new topic file).

Full conventions (file naming, frontmatter, status values, archiving, security) are defined in `vault/knowledge/README.md`.

**Required frontmatter for every URL file:**
```
**Title:** <topic or tool name> URLs
**Category:** url
**Owner:** <team responsible for keeping these links current>
**Status:** active | draft | archived
**Last updated:** <DDMonthYYYY>
```

Agents should treat any URL file marked `archived` as potentially stale and prefer live documentation lookups over citing the archived links.
