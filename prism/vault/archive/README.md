# Archive — Out of the Prism

## Mental Model

Thought Lenses enter Prism as raw, unstructured human intentions. They travel through one or more lenses (Hypotheses → Decisions → Requirements → Experiments), gaining clarity and structure with each pass. When a lens has completed its journey, it exits Prism in one of two ways:

```
                    ┌─────────────────────────────┐
  Human idea  ───▶  │         P R I S M           │  ───▶  Emitted artifact
  (raw input)       │  Hypotheses                 │          (Jira ticket, doc,
                    │  Decisions                  │           spec, email, etc.)
                    │  Requirements               │
                    │  Experiments                │
                    └─────────────────────────────┘
                                  │
                                  ▼
                            archive/<lens>/<emission>/
                            (all assets, out of the prism)
```

**Emit & Archive** — The lens produces an output artifact that is sent somewhere (integration, document, ticket). All associated files are then moved here.

**Archive** — No external emission. The lens is complete (validated, confirmed, approved, or concluded) and its files move here to clear the active workspace.

In both cases, the lens and all its associated assets leave the active Prism workspace permanently and live here as a historical record.

---

## Structure

Each emission gets its own dated subfolder under the lens type:

```
archive/
  hypotheses/
    2026-05-23-users-struggle-with-setup/
      hypothesis.md         ← the lens file
      epiphany-artifact.md  ← the source artifact from ingestion
  decisions/
    2026-05-23-simplify-onboarding/
      decision.md
      petition-artifact.md
  requirements/
    2026-05-23-allow-pdf-export/
      requirement.md
      genesis-artifact.md
  experiments/
    2026-05-23-shorter-onboarding/
      experiment.md
      claim-artifact.md
```

---

## What moves here

When a thought lens is archived, the following are moved into its emission subfolder:

1. **The lens file itself** — the hypothesis, decision, requirement, or experiment markdown
2. **The seed artifact** — the file referenced in `**Source:**` from `ingestion/unprocessed/` or `source/`
3. Any additional files manually associated with the lens (future: linked assets)

---

## Git sync behavior

The `archive/` folder **is** synced to the shared repo. This is intentional — archived emissions are institutional memory. Every PM in the org can see what has flowed through Prism and what came out.

Private files (`*-private.md`) follow the standard `.gitignore` rule and are never synced even when archived.
