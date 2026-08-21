# Deterministic Integrations

**Purpose:** Configuration files for rule-based, non-AI integrations — webhooks, API connectors, automation triggers, and data pipelines that connect Prism to external services with predictable, deterministic behavior.

**What belongs here:**
- Webhook endpoint configs
- API key references (use environment variable names, never actual secrets)
- Field mapping definitions
- Trigger/action rules for tools like Zapier, Make, Jira, Linear, Slack, etc.

**Security note:** Never store actual secrets or credentials here. Reference environment variable names only (e.g., `$JIRA_API_KEY`). This folder is git-synced.

---

## Editing Conventions

> **All config files in this folder are agent-authored.** Do not edit them directly. To add or update an integration, describe the integration requirements in Prism and the agent will create or update the config file. Never manually insert credentials — always use environment variable references.

Full conventions (file naming, frontmatter, status values, archiving, security) are defined in `vault/knowledge/README.md`.

**Required frontmatter for every config file:**
```
**Title:** <integration name and target service>
**Category:** integration-deterministic
**Owner:** <team or engineer responsible for this integration>
**Status:** active | draft | archived
**Last updated:** <DDMonthYYYY>
```

Files become `archived` when an integration is decommissioned or replaced by an agentic equivalent. Agents must not invoke routing rules from `archived` integration configs.
