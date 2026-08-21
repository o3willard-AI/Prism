# Agentic Integrations

**Purpose:** Configuration files for AI-driven integrations — instructions, system prompts, tool definitions, and routing rules that connect Prism lenses to external AI agents, copilots, and LLM-powered services.

**What belongs here:**
- Agent system prompt templates
- Tool/function definitions for external AI services
- Routing logic (which lens output goes to which agent)
- Context injection rules (which knowledge files to include per agent call)

**Security note:** Never store API keys or secrets here. Reference environment variable names only. This folder is git-synced.

---

## Editing Conventions

> **All config files in this folder are agent-authored.** Do not edit them directly. To configure an agentic integration, describe the agent behaviour and routing requirements in Prism and the agent will create or update the config file.

Full conventions (file naming, frontmatter, status values, archiving, security) are defined in `vault/knowledge/README.md`.

**Required frontmatter for every config file:**
```
**Title:** <integration name and target AI service>
**Category:** integration-agentic
**Owner:** <team or engineer responsible for this integration>
**Status:** active | draft | archived
**Last updated:** <DDMonthYYYY>
```

Files become `archived` when an external AI service is deprecated, the integration is replaced, or the routing rules no longer reflect the current lens structure. Agents must not apply routing rules from `archived` configs.
