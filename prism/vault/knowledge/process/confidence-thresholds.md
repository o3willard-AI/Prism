# Confidence thresholds

**Purpose:** The clarity bar each lens is held to, and the reason for it.
**Owner:** the human
**Status:** active
**Last updated:** 28September2026

---

## What this is

Each lens below has a **confidence threshold**: the level of clarity the agent
must reach before it produces a finished artifact instead of asking more
questions. The agent judges this — it is a judgment about whether it
understands what you actually mean, which no algorithm can compute. See
`lenscraft/06-confidence-gate.md` for the full principle.

**Prism states the threshold in every prompt**, so the agent knows the bar
you set without having to read this file. The value here is the record; the
prompt is the instruction.

---

## Thresholds

| Lens | Threshold | Why this value |
|---|---|---|
| `requirements-default` | 95% | A PRD handed to a developer with a misunderstood requirement is expensive to discover late. Hold the bar high. |
| `hypotheses-default` | 85% | A hypothesis is meant to be cheap to be wrong about. Asking twice costs more than testing one. |
| `rationalizations-default` | 85% | A post-hoc account is a hypothesis about the past. Same logic — the value is in being testable, not certain. |
| `ux-bridge-default` | 95% | Eleven mandatory fields; a spec handed to a UX team is expensive to re-interview. |

## Legal values

**1–100 inclusive.**

- **100%** is a legitimate setting. It means "ask me about everything," which
  is correct for high-stakes or genuinely ambiguous work. The system will not
  argue with it.
- **1%** is the floor. Anything lower is not a gate, and a gate that cannot
  block anything should not be offered as a setting.
- A lens not listed here uses **95%**. Adding a new workflow never gets
  blocked by missing configuration.

---

## Changing a value

Edit the number in the table above. It takes effect the next time you start
that lens — Prism reads this file when the workflow opens and states the
threshold in the prompt, so nothing needs restarting and no value is cached
into a running session.

Your current setting is shown on the Crafting Table before you commit to a
lens, and it is recorded in every artifact that lens produces:

```
**Confidence threshold:** 85% (set by the human, adjustable)
```

That last part matters: months later, when you are reading an artifact and
wondering why it is thinner than the last one, the answer is in the file.

---

## Why this is not a per-chat setting

A per-chat control would be forgotten by the next session, would not explain
why an artifact came out the way it did, and would not be reviewable when it
changes. This file is git-synced, so lowering a threshold is a visible,
reversible commit — which is the right weight for a decision that changes what
kind of work you get out of the system.

## Why the skills still say "95%"

`prd-gate.md`, `clarification-gate.md` and the agent definitions state 95% as
their **default intent**. That is deliberate: those documents describe the
designed behaviour, and a reader of the spec should see the number the system
was built around.

When your setting and the skill text disagree, **the prompt wins** — Prism
states your value in every prompt precisely so the agent cannot silently fall
back to the number it read in the skill. If you are reading an agent
definition and want to know what actually applied to a given artifact, read
the artifact.
