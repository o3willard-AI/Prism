# Example agent integration — Anthropic

**Title:** Anthropic Claude
**Category:** integration-agentic
**Owner:** sblanken
**Status:** draft
**Last updated:** 27September2026
**Description:** Sends a prepared prompt to Claude and brings the reply back into the chat thread.
**Kind:** anthropic
**Endpoint:** https://api.anthropic.com/v1/messages
**Model:** claude-sonnet-4-5
**Auth env:** ANTHROPIC_API_KEY
**Auth header:** x-api-key
**Auth prefix:** 
**Lenses:** requirements-default, hypotheses-default, rationalizations-default, ux-bridge-default
**System prompt:** You are executing a Prism lens skill. Follow the skill instructions exactly and return the requested artifact and nothing else.

---

## Before you enable this

Set the key in the environment Prism runs in, then restart it:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
./scripts/start.sh
```

**The key is never written into this file or anywhere in the vault.** Only the
variable NAME lives here. `Auth env` must be a variable name; Prism rejects a
config that tries to put a literal key in it, and rejects an `http://` endpoint
because that would send the key in the clear.

Rename this file to `anthropic.md` (or another `.md` name) and set
`Status: active` to enable it. While it is `draft`, Prism lists it but will
refuse to call it — so you can write a config without accidentally spending
money.

## Supported kinds

- `anthropic` — the Anthropic Messages API
- `openai` — anything OpenAI-compatible (chat completions): OpenAI, Together,
  Groq, Ollama, LM Studio, vLLM, and most gateways

## What happens when you use it

Every call is recorded in `ingestion/agent-calls/` **before** the request is
sent, and the reply is appended to that same file. If a call hangs or the
server dies mid-request, the attempt is still on record.

The reply arrives in the chat thread as a normal agent message, so you can
edit it, re-run it, or just carry on — Prism treats an integrated agent
exactly as it always treated a pasted one.
