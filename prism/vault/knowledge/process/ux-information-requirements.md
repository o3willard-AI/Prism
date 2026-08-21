**Title:** UX Information Requirements
**Category:** process
**Owner:** Product Management
**Status:** active
**Last updated:** 23May2026

---

# Process: UX Information Requirements

## Purpose

This document defines the minimum information a Product Manager must provide to a UX designer before any UX design work can begin. Agents lensing out Requirements, Decisions, or Hypotheses should validate that all items below are present before marking work ready for UX handoff.

---

## Required Inputs

The following items are **mandatory**. No UX work proceeds until all are present and complete.

---

### 1. Problem Statement

A clear, concise description of the problem being solved. Should answer:
- What is the user's pain point or unmet need?
- Why does it matter to the business?
- What is the current state and why is it insufficient?

*Format: 2–4 sentence prose. Not a solution description — a problem description.*

---

### 2. User Stories (INVEST)

One or more user stories that describe the desired capability from the user's perspective.

Each story must satisfy the **INVEST criteria**:

| Criterion | Meaning |
|---|---|
| **I** — Independent | The story can be developed and delivered without depending on another incomplete story |
| **N** — Negotiable | The story is not a rigid contract — details can be discussed and refined |
| **V** — Valuable | The story delivers clear value to the user or the business |
| **E** — Estimable | The team can estimate the effort required |
| **S** — Small | The story fits within a single sprint |
| **T** — Testable | The story has criteria that confirm when it is done |

*Format: "As a [persona], I want to [action], so that [outcome]."*

---

### 3. Acceptance Criteria (Gherkin)

Testable, scenario-based criteria written in Gherkin syntax for each user story.

```
Scenario: [short descriptive name]
  Given [a known starting state or context]
  When  [an action is taken]
  Then  [the observable outcome]
```

*Minimum one scenario per user story. Complex stories require multiple scenarios.*

---

### 4. Key User Scenarios and Flows

Step-by-step descriptions of the primary paths a user will take through the feature. Must include:
- The happy path (the intended, error-free flow)
- Any significant alternate paths (e.g., first-time vs. returning user)
- Decision points where the user must make a choice

*Format: numbered steps or a flow diagram description. Wireframes or journey maps are welcome but not a substitute for written flows.*

---

### 5. Error States and Edge Cases

Explicit definition of what the user should experience when something goes wrong or an unusual condition occurs. For each:
- **Trigger:** what causes this state
- **User-facing message or behaviour:** what the user sees
- **Recovery path:** how the user gets back on track

*Omitting this section is the most common cause of incomplete UX designs. It is required, not optional.*

---

### 6. Accessibility Considerations

Relevant accessibility requirements or constraints for this feature. At minimum, address:
- Keyboard navigation requirements
- Screen reader considerations (ARIA labels, reading order, announcements)
- Colour contrast and visual impairment considerations
- Touch target sizing (for mobile surfaces)
- Any known compliance standards that apply (e.g., WCAG 2.1 AA)

*If no specific considerations are known, state "No specific constraints identified — default WCAG 2.1 AA applies."*

---

### 7. Dependencies and Assumptions

A list of:
- **Dependencies:** external systems, APIs, teams, or decisions that this feature relies on, and their current status
- **Assumptions:** things the team is treating as true that have not been formally validated

*Each assumption should be flagged as a risk if it turns out to be false.*

---

### 8. Open Questions Requiring Further Discovery

Any known unknowns that could materially affect the UX design and have not yet been resolved. For each question:
- State the question clearly
- Note who owns the answer
- Note the deadline by which the answer is needed to avoid blocking UX work

*If this section is empty at handoff, the PM is confirming that no open questions remain that could cause a significant UX rework.*

---

### 9. Users or Personas

The user types, roles, or personas who will interact with this feature. For each:
- **Name / label** (e.g., "Returning Customer", "Admin User", "First-time Visitor")
- **Key characteristics** relevant to UX (technical proficiency, context of use, device preferences, accessibility needs)
- **Primary vs. secondary:** which persona is the primary design target

*Reference the product's established persona library if one exists.*

---

### 10. Business Goals

The measurable business outcomes this feature is intended to drive. Each goal should have:
- A metric (what will be measured)
- A baseline (current state of that metric)
- A target (desired state)
- A time horizon (by when)

*UX designers use business goals to make trade-off decisions. Without them, design trade-offs are made arbitrarily.*

---

### 11. Constraints

Any non-negotiable limitations the UX design must work within:
- **Technical constraints:** platform limitations, browser/device support matrix, performance budgets
- **Brand/design system constraints:** components or patterns that must be used or must not be deviated from
- **Timeline constraints:** hard delivery dates that affect design scope
- **Regulatory or legal constraints:** compliance requirements that limit design choices

---

## Completeness Check

Before submitting a handoff to UX, the PM should confirm all 11 items above are present. Agents evaluating a Requirements artifact for UX-readiness should use this checklist:

| # | Item | Present? |
|---|------|----------|
| 1 | Problem Statement | ☐ |
| 2 | User Stories (INVEST) | ☐ |
| 3 | Acceptance Criteria (Gherkin) | ☐ |
| 4 | Key User Scenarios and Flows | ☐ |
| 5 | Error States and Edge Cases | ☐ |
| 6 | Accessibility Considerations | ☐ |
| 7 | Dependencies and Assumptions | ☐ |
| 8 | Open Questions | ☐ |
| 9 | Users or Personas | ☐ |
| 10 | Business Goals | ☐ |
| 11 | Constraints | ☐ |

A handoff is **not ready for UX** if any item is missing or marked "TBD" without a named owner and a resolution date.

---

## Agent Guidance

When an agent is processing a Requirements artifact through any lens or workflow and a UX handoff is anticipated:

1. Cross-reference the artifact content against this checklist.
2. For any missing item, surface a specific gap question to the human (do not silently proceed).
3. Do not mark a Requirement as `review` or `ready` status until all 11 items are addressed or explicitly deferred with owner + date.
