**Title:** Rationalizations Lens — Process Definition
**Category:** process
**Owner:** Product Management
**Status:** active
**Last updated:** 01Jun2026

---

# Process: Rationalizations Lens

## Purpose

The Rationalizations lens takes any series of human-derived text — from inaccurate transcriptions to bulleted thought lists, stream-of-thought dictation, and everything in between — and turns it into a **Structured Account**: a well-ordered document that can be fed into another Prism lens or emitted to an external agent or system that needs to quickly comprehend and act on the content.

This is not a requirements or decisions lens. The Rationalizations lens captures post-hoc explanations, lessons learned, debriefs, and any raw human narrative that needs to be preserved and structured without being immediately actionable.

---

## Output Artifact

A **Structured Account** — the main content saved to `vault/rationalizations/<name>.md`.

| Section | Purpose | Required |
|---|---|---|
| **Gibberish** | The raw seed material, exactly as ingested. Never modified. Preserves full provenance. | Yes — always |
| **Context** | What situation, event, or constraint gave rise to this rationalization. 2–4 sentence prose. | Yes |
| **Reasoning** | The structured argument: core points, key narrative, logic chain. May use bullets. | Yes |
| **Constraints** | External limitations or non-negotiable facts that shaped the rationalization. Not choices — reality. | Yes (state "None identified" if absent) |
| **Trade-offs Accepted** | What was consciously given up or deferred. Intentional decisions, not external limits. | Yes (state "None identified" if absent) |
| **Secondary Considerations** | Adjacent insights, edge cases, future-state ideas, or parking-lot items noted but outside the main thread. | Yes (state "None identified" if absent) |
| **Revisit Trigger** | The specific conditions under which this rationalization should be challenged or updated. | Yes |

---

## Artifact States

| State | Meaning | Action allowed |
|---|---|---|
| `draft` | Sections being populated — not yet structured | None |
| `structured-blocked` | All sections populated but **Revisit Trigger is non-empty with unresolved ambiguities** | Human must resolve open questions before emission |
| `handoff-ready` | All sections populated, Revisit Trigger contains only forward-looking conditions (not unresolved questions) | May emit, archive, or send to another lens |
| `archived` | Emitted and moved to `vault/archive/` | Read-only |

---

## "Done" Standard

A Structured Account meets the done standard when **all** of the following are true:

1. **Gibberish** section preserves the original raw input verbatim.
2. **Context** is written as 2–4 sentence prose — not bullets.
3. **Reasoning** is organised and readable as a standalone document.
4. **Constraints** and **Trade-offs Accepted** are clearly separated — no constraint masquerading as a trade-off and vice versa.
5. **Secondary Considerations** captures Block 4 content (if any) — nothing is silently dropped.
6. **Revisit Trigger** contains forward-looking conditions only. Any open question from synthesis must be resolved by the human before the artifact is considered handoff-ready.
7. Artifact state is `handoff-ready`.

---

## Routing to Downstream Lenses

The Structured Account is designed to be machine-readable. Any downstream Prism lens or external agent receiving it should be able to:

- Identify **Context** to understand the origin
- Read **Reasoning** as the primary content payload
- Check **Constraints** and **Trade-offs Accepted** to understand non-negotiable boundaries vs deliberate decisions
- Scan **Secondary Considerations** for adjacent work
- Evaluate **Revisit Trigger** to determine whether the rationalization is still valid

When routing to another lens:
- A Requirement uses **Reasoning** as its seed content.
- A Decision uses **Reasoning** + **Constraints** + **Trade-offs Accepted**.
- A Hypothesis uses **Reasoning** + **Secondary Considerations**.

---

## Notes

- The Rationalizations lens does **not** judge whether the reasoning is correct — it structures and preserves it.
- **Constraints** are facts the PM encountered. **Trade-offs Accepted** are choices the PM made. Conflating them in the output breaks downstream decision traceability.
- If Block 4 output from a synthesizer skill is empty, write "None identified" in **Secondary Considerations** rather than omitting the section.
- Long transcripts (>2,000 words) should be chunked by topic before synthesis. Run Conversation Synthesizer once per topic thread and merge the outputs.
