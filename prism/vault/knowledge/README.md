# Knowledge Base

**Owner:** Product Management
**Maintained by:** Team leads (this README) · Agents (all content files)

The Knowledge Base is the shared memory layer that agents draw on when processing Thought Lenses through Prism. It is organised into five areas, each serving a distinct context purpose.

---

## Folder Map

| Folder | Purpose |
|---|---|
| `product/` | Context about existing products — scope, capabilities, constraints, current state |
| `process/` | Established team and organisational processes agents must follow or reference |
| `research/` | Previously validated research — user studies, analytics, competitive intelligence |
| `agents/` | Full agent definitions — identity, system prompts, skills list, knowledge refs, handoff behaviour |
| `resources/skills/` | Reusable agent skill definitions — prompts, workflows, capabilities |
| `resources/urls/` | Curated URL lists — docs, APIs, style guides for agent reference |
| `integrations/agentic/` | Config for AI-driven integrations (routing, prompts, tool definitions) |
| `integrations/deterministic/` | Config for rule-based integrations (webhooks, field maps, triggers) |

---

## Editing Conventions

### 1. Agent-authored content

**All content files in the Knowledge Base are created and maintained by agents.** Humans do not directly edit content files. To add, update, or retire a file, describe what you need in the Prism chat workflow — the agent will create or update the file and apply the correct conventions.

**The only exceptions** are README files (including this one), which are maintained by team leads to define folder scope, conventions, and ownership. README files are never agent-authored.

### 2. File naming

- Use `kebab-case` with no spaces (e.g., `ux-information-requirements.md`, `prd-gate.md`)
- Names should be descriptive and self-explanatory without needing to open the file
- No version numbers in filenames — use `**Status:**` frontmatter and `**Last updated:**` instead
- All files must use the `.md` extension

### 3. Required frontmatter

Every content file must open with the following frontmatter block before any other content:

```
**Title:** <human-readable name>
**Category:** <product | process | research | agent | skill | url | integration-agentic | integration-deterministic>
**Owner:** <team or role responsible for this knowledge>
**Status:** <active | draft | archived>
**Last updated:** <DDMonthYYYY>
```

- `active` — current, reliable, and in use by agents
- `draft` — under construction; agents should note uncertainty when referencing
- `archived` — superseded or no longer valid; agents must not reference as current

### 4. When agents create or update files

Agents should create a new Knowledge Base file when:
- A Thought Lens is emitted and produces validated knowledge (research findings, a confirmed process, a product decision)
- A human explicitly provides source material and asks for it to be formalised (as with skills and process docs)
- An integration is configured and needs a permanent config record

Agents should update an existing file when:
- A newer emission supersedes a previous finding or process
- A skill's agent instructions are refined based on observed output quality
- An integration endpoint, key reference, or routing rule changes

### 5. Archiving

When a file is no longer current, agents update its `**Status:**` to `archived` and append an `**Archived:**` date. Files are never deleted — archiving preserves institutional memory while preventing agents from citing outdated information as current.

### 6. Security

Integration config files must never contain actual secrets, credentials, or API keys. Reference environment variable names only (e.g., `$JIRA_API_KEY`). All Knowledge Base files are git-synced by default.
