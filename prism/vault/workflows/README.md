# Workflows

Each workflow in Prism lives in its own subfolder here. A workflow is a
repeatable, structured process that guides a team or agent through a specific
sequence of actions — distinct from Thought Lenses (which hold the *content*
being transformed) and from Knowledge (which holds *context* for agents).

## Structure

```
vault/workflows/
  <workflow-name>/
    README.md        — what this workflow does, when to run it, who owns it
    steps.md         — step-by-step instructions (agent-readable)
    config.md        — configuration inputs (optional)
    history/         — log of past runs (optional)
```

## Workflow types (expected)

| Type | Description |
|------|-------------|
| Agentic | Driven by an AI agent with Prism context |
| Deterministic | Scripted / automated, no AI judgment required |
| Hybrid | Human-in-the-loop with agent assistance |

## Adding a new workflow

1. Create a subfolder: `vault/workflows/<workflow-name>/`
2. Add a `README.md` describing purpose, trigger, and owner
3. Add a `steps.md` with the ordered action list
4. Wire a nav item in `prism/index.html` pointing to your new workflow view
   (or expose it through an agent integration in `vault/knowledge/integrations/`)
