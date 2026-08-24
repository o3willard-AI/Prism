# Prompts

Prepared prompts awaiting execution. This folder is the **filesystem
handoff channel** (delivery channel 2, see
`lenscraft/05-delivery-channels.md`): Prism prepares the light, any
file-capable agent can read it, and the human decides which door the
execution goes through.

Naming follows GN-009 — the world already knows what a prompt is.

## File convention

```
YYYY-MM-DD-<slug>.md
```

Every file opens with:

```
**Lens:** <lens that prepared this prompt, if any>
**Step:** <workflow step or session context>
**Status:** prepared | sent | stale
**Prepared:** <date>
```

followed by the prompt body — ready to paste into any agent or read
from disk by one.

## Door row (the world's doors)

When a prompt lands here, the UI presents three doors:

| Door | Channel | Always available |
|---|---|---|
| Copy | human handoff (clipboard) | yes |
| Open file / point an agent at it | filesystem handoff | yes |
| Send to \<configured service\> | direct injection | only if configured — never a dead button |

## Lifecycle

- `prepared` — awaiting the human's steering into a door.
- `sent` — delivered through a door; kept for provenance.
- `stale` — the lens or session that produced it has moved on; safe to
  archive.

Nothing here is deleted — same discipline as the rest of the vault.
