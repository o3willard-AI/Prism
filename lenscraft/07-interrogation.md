# The agent interrogates before the human chooses

**Status:** implemented as F31 · `prism/interrogate.py`, `POST /interrogate`

## The gap this closes

Prism had exactly one place an agent touched a human's work, and it was the wrong one.

Typing a raw thought called `POST /classify` — deterministic heuristics, a regex guessing whether the text looked like an unordered note or a post-hoc account. Then the human was shown a **menu of lenses** and picked one. Only after the artifact existed did an agent appear, via `/adjudicate`, with one power: to say yes or no at a confidence threshold.

So the sequence was: *guess the shape → fill it in → find out whether it was right.* Every question that would have told us the shape came **after** the commitment.

The cost is not a bad artifact. It is a well-shaped artifact answering the wrong question — a complete PRD for the wrong outcome, at 95% confidence, with a real agent's signature on it.

## The principle

> A lens is a contract with every downstream agent that will read it: context, boundaries, and a roadmap.
>
> A contract written from one paragraph, with nobody asked what outcome it has to produce, is not a contract. It is a guess.

The agent is the only party capable of noticing the gaps. A human is the only party able to close them. Neither substitutes for the other, which is why this is a **conversation** and not a form.

## Both surfaces, because the human said both

| Surface | What it is for |
|---|---|
| **Crafting Table** | Capture the thought, get asked, answer. One door. |
| **Workflow chat** | Continue once there's an artifact to work on. |

The Table is not a form with a chat widget; it *is* the conversation. It sits above the lens doors as a peer, because "the Table didn't feel like a place where crafting happens" was the complaint, and burying the agent below a divider would repeat it — the same mistake as the queue button rendered as invisible footer chrome.

The handoff carries the whole exchange: the understanding, the outcome, the proposed shape **and its reason**, and every question/answer pair. `deskInterrogateHandoff` writes it to a real staged artifact, because the workflow re-reads `_chat.artifactPath` from disk on every start and discards any preload — a fact that cost four false-green assertions before it was found.

## Rules that are not negotiable

1. **No agent means no interrogation, not a fake one.** `verdict: "unavailable"`, the reason stated in plain English, and a way past it. A deterministic guess must never stand in for the agent's judgment — that substitution is precisely what `/classify` does, and it is the bug.
2. **Silence is not consent.** An unparseable reply renders as *unclear*, with the raw text available under a disclosure. It never reads as agreement and never advances anything.
3. **The agent proposes; the human decides.** `proposed_shape` is a recommendation with a reason, not a menu. The doors stay, and they stay usable at any moment.
4. **Opting out is always one click.** Interrogation must never be a trap door.
5. **Bounded.** Four rounds, then `at_last_round` is surfaced to the human rather than grinding on or cutting off silently.

## What is recorded

`interrogate.summarise_for_record` writes into the artifact:

```markdown
**Understood as:** ...
**Must enable an agent to:** ...
**Shape:** requirements — <the reason>

**Interrogation:**
- *<question>*
  → <answer>
```

Six months on, *"why is this a requirement and not a hypothesis?"* is a question the file answers without a human present. That is the whole point: the lens's purpose is to give a downstream agent context and a roadmap it can execute without asking you again.

## Testing note

Four of eight mutations initially survived the HTTP suite, because a broken module still returns 200 and the handler's catch-all converts the exception back into `unavailable` — green for reasons unrelated to the claim. `e2e-verify-f31-unit.py` calls `interrogate()` directly with a stubbed agent; all eight mutations are now caught.

The stub agent's judge discriminator also failed in a way worth remembering: it required `'classify' not in sent`, and the interrogation prompt itself says *"You are NOT classifying"*, so the branch never ran. **A predicate that must exclude something is a predicate that will eventually exclude the wrong thing.**