# GN-004 — Dual-axis unresolved gate: resource boundary vs knowledge boundary

**Harvested from:** Session 1, co-creator's answer to the failure-edge
question (Batch 2, Q7).

**The problem:** "Ask clarifying questions until clear" is not always
right. Sometimes no further question can be answered by *this human*,
and sometimes no question is answerable by *anyone*. A single confidence
gate cannot tell the two apart.

**The pattern:** track two distinct confidences during the clarification
loop, each with its own threshold and its own honest emission:

| Axis | Threshold | Meaning when reached | Emission |
|---|---|---|---|
| **Resource boundary** | ~80% sure | This human does not have the resources (knowledge, access, data, authority, time) to answer the questions that must be answered | *"Here's what I would need to settle it"* — name the missing evidence or resource; no shame attached |
| **Knowledge boundary** | ~97% sure | All of human and machine knowledge combined is incapable of answering the questions that need clarification | *Admit the boundary* — an honest statement that this is presently unknowable |

**Why two thresholds:** judging what a specific human has access to is
evidence-light and cheap — 80% is enough to stop spending their time.
Judging the boundary of all knowledge is a heavy claim and earns the
full gate discipline (97%).

**The principle:** confidence thresholds come in families with distinct
roles. Output gates (95–97%) govern emission quality; boundary judgments
govern when to stop asking. A lens needs as many thresholds as it has
distinct kinds of judgment to make — but each must be named and
justified, never defaulted.

**Reusable move:** when designing a lens's edge behaviour, ask: *what
kinds of "cannot settle" exist in this domain, and does each kind have
its own threshold and its own emission?*

**Recommendation surface:** any lens with clarification loops or
verdicts; grind Phase 2, gate-component design.
