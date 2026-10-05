"""Interrogation: the agent asks a human what they actually want, before any
lens is chosen.

Why this module exists. Prism had exactly one place an agent touched a human's
work, and it was the wrong one: `POST /adjudicate`, AFTER a lens had been picked
and an artifact pasted. The agent's only power was to say yes/no. Typing a
thought called `/classify`, which is deterministic heuristics — a regex guessing
whether the text looks like an unordered note or a post-hoc account. Nobody was
ever asked what they were trying to accomplish.

That is backwards, and it is backwards in a specific way. A lens is a contract
with every downstream agent that will read it: context, boundaries, and a
roadmap. A contract written from one paragraph of raw text, with nobody asked
what outcome it has to produce, is not a contract — it is a guess. The agent is
the one capable of noticing the gaps, and a human is the only one who can close
them. So the agent asks, the human answers, and only then is a lens worth
writing.

Three properties this holds to, each from something that went wrong before:

1. **The agent proposes the shape; the human does not pick from a menu.** Asking
   "Requirement, Hypothesis, or Rationalization?" up front is a form that
   presumes the answer. Better to ask what the outcome is FOR and let the shape
   follow. The doors stay — F17 retired the wizard so there is exactly one door —
   but they become the agent's recommendation rather than the human's burden.

2. **A round is bounded and always terminates.** Max rounds, and a "good enough"
   exit the human controls. An agent that can interrogate forever is a tax.

3. **Silence is a real answer.** If no agent is configured, this says so plainly
   and the human may proceed un-interrogated. It never pretends the question was
   asked, and never substitutes a deterministic guess for the agent's judgment —
   that substitution is the exact bug /classify represents.
"""
from __future__ import annotations

import json
import re

import agentic
import adjudicate
import thresholds

# Rounds. Deep enough to matter, shallow enough that it stays a conversation.
# Four is deliberate: by round four either the human knows what they want or the
# premise was wrong, and both are worth surfacing rather than grinding on.
MAX_ROUNDS = 4

# A human should never be handed a wall of text. Two or three questions per
# round is answerable in a sitting.
MAX_QUESTIONS_PER_ROUND = 3

# The shapes a crafted artifact can take. Mirrors the desk's doors.
SHAPES = {
    "requirements": "a requirement: something to build",
    "hypotheses": "a hypothesis: a belief worth testing",
    "rationalizations": "a rationalization: why it went the way it went",
    "ux-bridge": "a UX hand-off specification",
}


def _truthy_env(name: str) -> bool:
    import os
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


# ── The prompt ───────────────────────────────────────────────────────────

_INTERROGATE_SYSTEM = """\
You are the craftsperson helping a human shape a piece of thought into something \
a downstream AI agent can actually use.

You are NOT classifying. You are not asking which template to fill in. You are \
finding out what this person actually needs, so that whatever you produce \
together is worth handing to an agent who has never met them.

Your reply MUST be a single JSON object and nothing else. No prose, no code \
fence, no commentary before or after. Shape:

{
  "verdict": "need_more" | "ready" | "unclear",
  "proposed_shape": "requirements" | "hypotheses" | "rationalizations" | "ux-bridge" | null,
  "shape_reason": "why that shape, in one sentence",
  "understanding": "what you believe the human is trying to accomplish",
  "outcome": "the concrete outcome a downstream agent must be able to produce \
from this, in one sentence",
  "questions": ["at most 3 questions, best first"],
  "reasoning": "why these questions, in one or two sentences"
}

How to decide:

- "need_more" — you are missing something that would change the artifact. Ask.
- "ready" — you have enough to name the outcome and the shape. Do NOT ask \
questions; an empty list is the correct answer here.
- "unclear" — the text does not cohere well enough to aim at. Say so in \
understanding, and ask what it is actually about.

Asking well is the whole skill:

- Ask about OUTCOME, not format. "What must be true for this to have been worth \
doing?" beats "what's the scope".
- Ask what constrains it: deadline, people who must approve, what already \
exists, what would make it worthless.
- Ask the question whose answer would most change what you write. One good \
question beats three safe ones.
- NEVER ask something the text already answers. That is the failure mode of a \
form.
- If the text is thin, do not manufacture false precision. A short honest \
question beats a confident fabrication.
- `proposed_shape` is your RECOMMENDATION with a reason, not a menu. Set it \
only when you have enough to choose; otherwise null.
"""


def build_interrogation_prompt(raw: str, answers: list[dict], lens_hint: str = "") -> str:
    """The prompt for one round. Carries the whole exchange, not just the last
    answer — the agent needs what it already asked, or it will ask again."""
    parts = [_INTERROGATE_SYSTEM, "", "=== THE HUMAN'S RAW THOUGHT ===", raw.strip()]
    if answers:
        parts += ["", "=== SO FAR, IN THEIR WORDS ==="]
        for a in answers:
            parts.append(f"Q: {a.get('question', '')}")
            parts.append(f"A: {a.get('answer', '')}")
        parts += ["",
                  "Do not ask again anything already answered above. If their "
                  "answers still leave a real gap, ask it; otherwise say ready."]
    if lens_hint:
        parts += ["", f"=== THEY CHOSE THIS SHAPE: {lens_hint} ===",
                  "Respect that choice. Do not propose a different one, but do "
                  "still say whether they have enough to craft it well."]
    parts += ["", "=== YOUR REPLY (JSON only) ==="]
    return "\n".join(parts)


# ── Parsing ──────────────────────────────────────────────────────────────

_VERDICTS = {"need_more", "ready", "unclear"}


def _coerce(reply: str) -> dict:
    """Pull the JSON object out of an agent reply and normalise it.

    Tolerant of a code fence and of prose around it, because a real agent does
    both, and intolerant of anything else: a reply we cannot read is NOT a
    "ready". Treating silence as consent is the failure this whole module exists
    to avoid, so an unparseable reply becomes 'unclear' with the raw text kept
    for the human to judge.
    """
    text = (reply or "").strip()
    if not text:
        return {"verdict": "unclear", "parse_failed": True, "raw": "",
                "questions": [], "proposed_shape": None}

    obj = None
    try:
        obj = json.loads(text)
    except (ValueError, TypeError):
        m = re.search(r"\{.*\}", text, re.S)      # a fence or prose around it
        if m:
            try:
                obj = json.loads(m.group(0))
            except (ValueError, TypeError):
                obj = None

    if not isinstance(obj, dict):
        return {"verdict": "unclear", "parse_failed": True, "raw": text[:800],
                "questions": [], "proposed_shape": None}

    verdict = str(obj.get("verdict", "")).strip().lower()
    if verdict not in _VERDICTS:
        verdict = "unclear"
    shape = obj.get("proposed_shape")
    shape = str(shape).strip().lower() if shape else None
    if shape not in SHAPES:
        shape = None

    return {
        "verdict": verdict,
        "proposed_shape": shape,
        "shape_reason": str(obj.get("shape_reason") or "").strip(),
        "understanding": str(obj.get("understanding") or "").strip(),
        "outcome": str(obj.get("outcome") or "").strip(),
        "questions": adjudicate._questions(obj.get("questions"))[:MAX_QUESTIONS_PER_ROUND],
        "reasoning": str(obj.get("reasoning") or "").strip(),
        "parse_failed": False,
        "raw": text[:800],
    }


# ── One round ────────────────────────────────────────────────────────────

def interrogate(raw: str, answers: list[dict] | None = None,
                lens_hint: str = "") -> dict:
    """Ask the agent one round. Returns the normalised reply plus provenance.

    Raises AgentConfigError for anything infrastructural, exactly like
    adjudicate.judge, so the caller can distinguish "the agent could not be
    asked" from "the agent answered and asked for more". Only the second is a
    round.
    """
    answers = answers or []
    cfg, reason = adjudicate.select_config(lens_hint) if lens_hint \
        else adjudicate.select_config("requirements-default")
    if cfg is None:
        return {
            "ok": False,
            "asked": False,
            "selection": reason,
            "agent_error": (
                f"{reason.get('why', 'No agent is configured.')} The agent is "
                "what makes interrogation possible — a deterministic guess is "
                "not a substitute, so this is left un-asked rather than faked."
            ),
            "verdict": "unavailable",
            "questions": [],
        }

    prompt = build_interrogation_prompt(raw, answers, lens_hint)
    result = agentic.invoke(cfg, prompt)
    parsed = _coerce(result.get("text", ""))

    round_no = len(answers) + 1
    out = {
        "ok": True,
        "asked": True,
        "selection": reason,
        "agent": cfg.get("name", ""),
        "agent_title": cfg.get("title", ""),
        "model": result.get("model", ""),
        "elapsed_ms": result.get("elapsed_ms", 0),
        "round": round_no,
        "max_rounds": MAX_ROUNDS,
        # Past this point the agent is grinding, not helping. Surfaced to the
        # human rather than decided for them — they may well know what they want.
        "at_last_round": round_no >= MAX_ROUNDS,
        "threshold": thresholds.get_threshold(lens_hint) if lens_hint else
                     thresholds.get_threshold("requirements-default"),
    }
    out.update(parsed)
    return out


def summarise_for_record(state: dict) -> str:
    """The interrogation, recorded in the artifact.

    A lens written after interrogation should carry WHY it is shaped the way it
    is. Six months on, "why is this a requirement and not a hypothesis?" is a
    question the file should answer without a human present.
    """
    lines = []
    if state.get("understanding"):
        lines.append(f"**Understood as:** {state['understanding']}")
    if state.get("outcome"):
        lines.append(f"**Must enable an agent to:** {state['outcome']}")
    if state.get("proposed_shape"):
        lines.append(
            f"**Shape:** {state['proposed_shape']}"
            + (f" — {state['shape_reason']}" if state.get("shape_reason") else "")
        )
    rounds = state.get("answers") or []
    if rounds:
        lines.append("")
        lines.append("**Interrogation:**")
        for a in rounds:
            lines.append(f"- *{a.get('question', '').strip()}*")
            lines.append(f"  → {a.get('answer', '').strip()}")
    return "\n".join(lines)