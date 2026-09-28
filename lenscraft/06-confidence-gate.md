# The Confidence Gate — corrected principle

*Written 28 Sep 2026 to replace a spec that was lost in an agent handoff, and
to fix an implementation that faithfully built the wrong thing.*

---

## What was lost

Four skill files (`prd-gate`, `clarification-gate`, `ux-bridge`, and the
requirements/rationalizations agent definitions) declared:

> **Confidence gate:** The agent must be 95%+ certain of the full scope before
> producing output. Below that threshold it **must** ask questions instead.

That is the original intent, and it is correct. It was lost in a handoff
between implementers and replaced with this:

> Prism never calls a language model... the human runs the skill in whichever
> agent they use, and pastes the result back.

From that premise, Prism **simulated** the gate with regex markers and a ratio:

```python
if ratio >= 0.8:    verdict = "match"
elif ratio >= 0.4:  verdict = "partial"
```

A PRD that wrote `## Executive Summary` and then `TBD` passed. A PRD that said
"Scope" instead of "Executive Summary" failed. **The number was never
computed.** Prism matched the agent's *claim* that it had computed it, and
called that a gate.

This document restores the intent and specifies it tightly enough that it
cannot be lost the same way twice.

---

## Principle 1 — The gate is judged by the agent, never by an algorithm

> **Question:** Given what the user has told me, am I 95% confident I can
> produce an outcome asset that any downstream agent will fully understand,
> and execute to the outcome the user actually intends?

Two things must be true, and they are different:

1. **The harness and the model understand the user's intent.** Not the words
   — the intent. Intent behind a half-formed sentence is the whole job.
2. **The user has supplied enough information and clarity** that a proper
   asset can be generated for whatever downstream agentic execution follows.

Neither is computable by string matching. A regex cannot tell whether a PM
meant "40 minutes per report" as a complaint, a requirement, or a metric. An
agent can, and will ask.

**Consequence: Prism does not score clarity. Prism asks, the agent answers,
and the answer is recorded.** Every gate in Prism is a *recorded judgment*,
never a *computed verdict*.

### "Execution" is used loosely, on purpose

We do not know what lenses will be created, how complex they will be, or
what the outcomes are for. "Execution" means *whatever downstream agentic
work this asset enables*. The gate asks whether the asset will serve that
work — not whether it matches a template.

---

## Principle 2 — Below the gate, the harness derives the questions

When confidence is under threshold, **the agent generates specific follow-up
questions it believes, if answered fully, will cross the threshold.**

Not a generic checklist. Not "please provide more detail." The agent knows
*which specific unknowns* are holding it back, and it asks about those.

The turn structure is then a genuine conversation:

```
human thought
  → agent judges          (confidence + reasoning, recorded)
  → below threshold?
      → agent derives specific questions
          → human answers
              → agent re-judges with the answer in context
                  → repeat until threshold met
  → at threshold: agent produces the asset
```

**Answers accumulate.** Every Q&A turn stays in context, and every
re-judgment sees the whole interview. This is why the prompt must be
stateful — a stateless prompt restarts the interview every turn and the
agent can never reach a threshold, because it keeps re-asking what it has
already been told.

**The loop ends when the agent says it is at threshold — not when a counter
does.** A human may also stop early and take the best available. That is
their call, and Prism must never trap them in a loop they want to leave.

---

## Principle 3 — The threshold is configurable, per lens, by the human

**Default: 95%.** But some work is so complex that the user must turn the
gate *down* to get any output ever, and some is so trivial they should turn it
*up*. A fixed 95% is a constant that serves neither case.

- Per-lens, so Hypotheses can differ from Requirements.
- Settable at the door, before the interview starts, with the current value
  visible throughout.
- Recorded in the artifact, so an output is always attributable to the
  standard it was produced under.

A threshold of 100% is legitimate: it means "ask me about everything." That
is a real and sometimes correct choice for high-stakes work, and the system
must not argue with it.

---

## Principle 4 — Deterministic checks are a floor for lens *crafting* only

The distinction is by purpose, not by confidence.

**Lens crafting** (Requirements, Hypotheses, Rationalizations) has *structural
requirements* that are worth enforcing mechanically, because the structure is
the contract between the human and the agent working with them:

- a risk section exists
- success metrics are present
- the file has a usable heading outline

These are cheap, they catch genuine accidents, and they fail in ways a human
immediately understands. **Keep them. They are a floor, never a judge.** They
must not be able to *approve* anything — passing every deterministic check
means "nothing obviously missing," not "this is good."

**All other flows have no deterministic gate.** UX Bridge, interview loops,
agent adjudication — these are conversational, and a regex has no business
adjudicating them. A shape check on a conversation is a category error.

**The rule that prevents this drifting again:** *if a check cannot be
explained as "catching a structural accident in a lens artifact," it does not
belong in code.*

---

## Principle 5 — Prism is a skill for humans; the agent is the sherpa

Prism is a **refraction tool**: raw human thought in, focused context out.
The focused output is designed to sit **in the spectrum of agentic thought** —
shaped so that an agent reading it does not need translation. An LLM-shaped
Requirement, a Hypothesis that reads like a falsifiable bet, a
Rationalization that reads like a post-mortem.

The agent is not a downstream consumer of Prism's output. It is the **sherpa
who guides the human through the lens** — asking the question, judging the
answer, and pressing until the thought is sharp enough to hand onward.

```
raw thought → [PRISM: refract] → shaped context → [AGENT: guide, judge, press]
     ↑                                                            │
     └──────────────── human answers, iterates ───────────────────┘
```

Success is **success velocity**: the time and friction for a human to reach
an outcome they and their agent can both act on. Every design choice is
judged against that, including the gates — a gate that rejects a good PRD
because it used a different heading name makes the human *slower*, and has
therefore failed at its job.

---

## What this changes in the system

| Was | Becomes |
|---|---|
| Regex markers over the pasted artifact, scored by ratio | The agent judges clarity and **states** the number with reasoning |
| `unrecognized` / `partial` / `match` as a verdict on quality | The judgment is **recorded** with its reasoning, attributed to the agent |
| A fixed 95% | Configurable per lens, settable by the human, recorded in the artifact |
| Generic "provide more detail" prompts | Questions the agent derives, each with the gap it closes |
| Prism "never calls a model" as a constraint | Prism calls the agent because the gate is *inherently* a judgment |
| Deterministic shape checks across all flows | Structural floor for lens crafting only; nothing deterministic elsewhere |

**What does not change:** Prism still does not generate the thinking. It
prepares the work, holds the state, records the judgment, and checks the
structural floor. The judgment is the agent's — now *made explicit and
recorded* instead of *simulated and faked*.

**What survives the reversal:** keys never enter the vault. An integration
config names an environment variable; it never stores a value. That rule was
never about distrusting agents.

---

## The test for any future change

Before adding any check that gates an artifact, ask:

> **Who is this check standing in for?**

If the answer is "the agent, because the agent isn't wired up yet" — it is
wrong. Wire up the agent. If the answer is "catching a structural accident in
a lens file" — it belongs. Anything else should not be in code.
