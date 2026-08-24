# Can AI Help Me — Verdict

**Ask:** Passive wellbeing awareness for an elderly parent living alone — alerts when something deviates from her normal, without cameras she would hate.
**Verdict:** PARTIAL
**Date:** 2026-08-23
**Lens:** can-ai-help-me (Session 1 test light)

## Grounds

First-principles decomposition of the ask, component by component:

| Component | Classification | AI-shaped? |
|---|---|---|
| Sensing her state without cameras (doors, appliances, motion, wearable, phone patterns) | perception — passive sensors | The sensing is engineering/hardware; making sense of the signal is AI |
| Learning what "normal" looks like for her | pattern learning | YES — mature |
| Detecting deviation from her normal ("something's off") | anomaly detection on routine patterns | YES — mature; this is the strongest AI-shaped slice |
| Judging severity and deciding to alert | judgment / accountability-bearing | PARTIAL — AI can flag, a human or a service must own the response decision |
| Inferring medical states ("is she okay" as a health question) | medical inference | NO — not reliably AI-shaped; not a responsible slice for this lens to endorse |
| Her consent, dignity, and whether she wants this at all | trust / relationship work | NO — not AI-shaped; it is the load-bearing wall of the whole thing |
| Installing, wiring, maintaining hardware | engineering | NO — buildable plumbing, not an AI question |

**Verdict logic:** the AI-shaped slice is real and mature — baseline
learning plus deviation detection on passive, camera-free signals. The
slices that are not AI-shaped are not gaps to be engineered around:
consent and dignity are relationship work that must be settled with her,
and medical inference is outside reliable AI territory today. The
capability question is answered PARTIAL because the ask as phrased
("tells me if she's okay") fuses an AI-shaped slice with two slices AI
cannot responsibly carry.

## Recommended next steps

1. **Settle the relationship slice first — it gates everything.** Have
   the conversation with her about what she would accept. Until consent
   exists, no amount of capability matters. This is the true first step,
   not a technology choice.
2. **Scope the AI-shaped slice concretely.** Decide which passive signal
   she would tolerate (wearable, door/appliance patterns, phone-usage
   rhythm) — one signal, learned for two weeks, beats five signals never
   installed.
3. **Find who owns the alert path.** Choose the category of responder —
   you, a neighbor, or a professional monitoring service — before
   choosing any product. The alert is worthless without an owned
   response.

## Routing

**Next lens:** MISSING FOCAL POINT — `setup-path` (declared by this
library): a lens to take a YES/PARTIAL verdict and produce the actual
setup path — signal choice, baseline plan, alert rules, rollout steps.
**Carry forward:** the PARTIAL verdict, the three next steps above, and
this constraint set: camera-free sensing only; consent required before
any install; alert path must have a named human owner.

## Boundary note

*(none reached — this was a standard PARTIAL, not an edge case)*
