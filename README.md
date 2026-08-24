# Prism

**Raw input, focused clarity.**

A physical prism does not store light. It receives the full spectrum —
scattered, mixed, unfocused — and refracts it into precise, identifiable
wavelengths that are emitted exactly where they are needed.

Prism does the same for human thought. It takes raw human communication —
dictation, brain dumps, meeting transcripts, half-formed intentions, chat
logs — and refines it into **actionable, reusable context optimized for
agentic comprehension and extension**.

Prism is deliberately **not**:

- an agent harness or orchestrator
- a storage system or knowledge base product
- a memory layer, agent swarm, or automation loop

It is a **refraction tool**. Humans bring scattered thought in; focused
context comes out. The consumer of that output is typically an AI agent —
whatever one the human already works with. Prism generates the prompts,
the human's agent does the generation, and the result is captured back.
Prism is the lens, not the laser.

---

## Architecture

```
prism/                  The app
├── api-server.py       Python stdlib HTTP backend, port 8082 (no deps)
├── index.html          Single-file SPA frontend (vanilla JS, no build step)
├── layout/ theme/      Separable structural + visual styling
└── vault/              All data is plain Markdown — git-syncable
    ├── ingestion/      Raw input queue (unprocessed/ is local-only)
    ├── requirements/ hypotheses/ rationalizations/ decisions/ experiments/
    │                   "Thought Lenses" — refraction chambers
    ├── knowledge/      Refraction optics:
    │   └── resources/skills/   The prompt library (the core of Prism)
    ├── workflows/      Refraction sequences built from optics
    ├── archive/        Emitted wavelengths (historical record)
    └── source/         Immutable source copies
healthcheck/            Stack verification app (port 8081)
Caddyfile               Reverse-proxy + static serving config
scripts/                Start/stop + Caddy download
```

**Stack:** one Caddy binary (reverse proxy + static server) + two Python
stdlib backends + vanilla JS. No npm, no frameworks, no external AI APIs,
no cloud dependency.

## The optics

`vault/knowledge/resources/skills/` contains the refraction prompts —
the real core of Prism. Each skill takes raw input of a given shape and
emits structured, agent-consumable context with confidence gates
(95–97%: either ask clarifying questions or produce output; never
produce partial output). Surfacing unresolved gaps is a first-class
feature: an agent that receives "here's what is unresolved and why it
matters" can extend the thought instead of hallucinating.

| Optic | Refracts | Into |
|---|---|---|
| intent-synth | single-speaker dictation / brain dump | 5 Intention Blocks |
| conv-synth | multi-person transcripts | 5 Actionable Blocks |
| doc-synth | any raw/multi-asset input | 5 Synthesis Blocks |
| clarification-gate | formatted or synthesized input | lens-appropriate structured document |
| prd-gate | formatted requirement input | developer-ready PRD |
| ux-bridge | PM feature request | UX Hand-off Specification (≥95% of 11 fields) |
| diagram-asset-generator | any structured output | Draw.io / Mermaid diagram |
| reorder-and-list-in-context | any text | coherent reusable reference form |

## Emission

A prism emits light; it does not store it. Prism stores as little as
possible. The built-in focal point for a refined artifact is a **plain
text file on the filesystem**. Every other focal point (ticketing
systems, docs, external agents) is intended to be fully modular and is
not yet built — see `vault/knowledge/integrations/` for the stubs.

---

## Running

```bash
# one-time: get the Caddy binary (Linux)
scripts/fetch-caddy.sh

# start the full stack
scripts/start.sh        # Caddy :8080, healthcheck :8081, Prism :8082

# open the app
#   http://localhost:8080/prism/
#   http://localhost:8080/healthcheck/

scripts/stop.sh
```

Requires only Python 3.10+ and curl. No pip installs.

## Web-server portability

Prism must run — and be proven to run — behind Caddy **and** at least
one other lightweight local web service. Caddy is the reference server
(the whole stack uses it); the second server proves nothing in Prism
depends on Caddy-specific behaviour. Proven combinations:

| Server | Front door | API proxying |
|---|---|---|
| Caddy (reference) | `http://localhost:8080/prism/` | `handle /prism/api/*` → :8082 |
| Apache 2.4 | `http://localhost/prism/` | `ProxyPass /prism/api/` → :8082 |

The Apache vhost lives in `server/apache-prism.conf` (Alias +
mod_proxy_http; a one-time `setfacl u:www-data:x` on the home directory
lets Apache traverse to the workspace). The Python backends are
identical in both setups — only the front-door config differs.

## Status

This repository is a refactored early proof of concept. The PM-toolkit-era
scope (five Thought Lenses, dashboards, dwell-time metrics, emission
integrations) is being narrowed to the core mission: **refining human
communication into agentic context**. See the project history in commits.

## License

MIT — see LICENSE.
