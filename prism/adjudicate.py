"""Clarity adjudication — ask the AGENT, record the answer.

The defect this replaces
------------------------
Prism's "95% clarity gate" was a regex ratio. `ratio >= 0.8` over marker
patterns, where one of the markers was the agent's own claim that it had
reached 95%. So a PRD that wrote `## Executive Summary` and then `TBD` seven
times passed, and a genuinely good PRD that said "Scope" instead of
"Executive Summary" failed. The number was never computed. Prism matched the
agent's *claim* that it had computed it, and called that a gate.

What replaces it
----------------
A real second opinion. When a human pastes an artifact, Prism sends it back to
the configured agent with the lens's threshold and the skill's own criteria,
and asks one question: is this at or above the bar, and why?

Three possible answers, and the design cares about all three:

- **AT_THRESHOLD** — the agent judges it clear. Advance, and record the number
  and the reasoning so the artifact explains itself later.
- **BELOW_THRESHOLD** — the agent judges it short, and (this is the important
  part) *derives the specific questions* that would close the gap. Prism shows
  them. This is the loop from `lenscraft/06-confidence-gate.md`, and it is the
  half that was missing: without it, "below threshold" is a dead end with no
  route forward.
- **UNCERTAIN** — the agent cannot judge. That is a legitimate answer, not a
  failure, and it routes to the human rather than guessing. Overstating
  confidence is how the old gate lied.

The structural shape check is NOT deleted here. It is demoted, per Principle 4
of the gate document: a floor that can catch a structural accident, and which
is never allowed to approve anything on its own. It runs, its result is shown
as context for the human's decision, and the agent's judgment is what actually
gates the step.

Degrading honestly
------------------
With no integration configured, there is no agent to ask, and Prism does not
fall back to pretending the regex ratio was a judgment. It says so plainly and
falls back to the structural floor with an explicit "unjudged" label, so the
human can see that nobody has assessed this artifact's clarity. That is the
whole point of the change: the previous behaviour looked identical whether or
not anyone had judged anything.
"""

from __future__ import annotations

import json
import re

import agentic
import thresholds as T

# The three answers. Strings, not an enum, because they go straight into the
# vault and the UI, and because the agent is asked to return one of these
# literals and a readable one is easier to get right.
#
# NOTE the third is "uncertain", not "unjudged". `unjudged` is what Prism
# reports when it could not ask anyone at all — no integration configured, the
# service down, an unparseable reply. Those are different states and the UI
# distinguishes them: "the agent said it cannot tell" is a JUDGMENT, while
# "nobody was asked" is an absence. Collapsing them would make a working
# integration look broken, and a broken one look like an opinion.
AT_THRESHOLD = "at_threshold"
BELOW_THRESHOLD = "below_threshold"
UNCERTAIN = "uncertain"

# The state where no judgment was obtained at all. Never returned by the
# agent; synthesized by the server.
UNJUDGED = "unjudged"

VALID = (AT_THRESHOLD, BELOW_THRESHOLD, UNCERTAIN)

# What we ask. Kept here so there is one copy, and so it can be asserted.
JUDGE_PROMPT = """\
You are judging ONE artifact against a clarity threshold. You are the judge —
this is your call, not a formality.

THE QUESTION

Given the material the user gave you, and the artifact below: are you at least
{THRESHOLD}% confident that you understand what the user actually intends, and
that you have enough from them to produce an asset a downstream agent will
fully understand and execute to that intent?

Two things must both hold, and they are different:
1. You understand the INTENT behind what the user said, not just the words.
2. The user supplied enough information and clarity for a proper asset.

{LENSESKILL}

THE ARTIFACT
---
{ARTIFACT}
---

HOW TO ANSWER

Reply with JSON and nothing else. Exactly these keys:

  "verdict":     "at_threshold" | "below_threshold" | "uncertain"
  "confidence":  integer 0-100 — your actual confidence in THIS verdict
  "reasoning":   2-4 sentences. What specifically supports your verdict. If
                 below, name the specific gaps — not "needs more detail".
  "questions":   an array of questions, ONLY when below_threshold. Each must
                 name the specific uncertainty it would resolve. Empty array
                 otherwise. No generic "please clarify".

CHOOSING THE VERDICT HONESTLY

- "at_threshold" means you would produce the asset NOW and be confident in it.
- "below_threshold" means you have real, nameable gaps. Do not use this as a
  way of stalling — if you have none, say at_threshold.
- "uncertain" is a legitimate answer, and the honest one when you genuinely
  cannot tell. Use it rather than guessing in either direction. A wrong
  "at_threshold" is much more expensive than an "uncertain".

Judge the ARTIFACT's substance, not its formatting. A well-organised document
that is missing half the answer is below threshold. A plainly-written one that
captures what the user actually wants is not.
"""


def _extract_json(text: str) -> dict | None:
    """Pull the JSON object out of an agent reply.

    Models wrap JSON in prose or fences about as often as not, so this looks
    for the outermost brace pair rather than demanding a clean reply. Returns
    None rather than raising: an unparseable reply is a real case that the
    caller must handle as "the agent did not answer clearly".
    """
    if not text:
        return None
    s = text.strip()

    # A fenced block is the common case.
    m = re.search(r"```(?:json)?\s*(.+?)```", s, re.DOTALL)
    if m:
        s = m.group(1).strip()

    # Then the outermost {...}.
    start = s.find("{")
    if start == -1:
        return None
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(s)):
        c = s[i]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
            continue
        if c == '"':
            in_str = True
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                try:
                    obj = json.loads(s[start:i + 1])
                    return obj if isinstance(obj, dict) else None
                except ValueError:
                    return None
    return None


def build_prompt(artifact: str, lens: str, skill_hint: str = "") -> str:
    thr = T.get_threshold(lens)
    return (
        JUDGE_PROMPT
        .replace("{THRESHOLD}", str(thr))
        .replace("{LENSESKILL}", (
            f"THE SKILL THIS ARTIFACT IS SUPPOSED TO SATISFY:\n{skill_hint}\n"
            if skill_hint else ""
        ))
        .replace("{ARTIFACT}", artifact)
    )


def _record(verdict: str, confidence: int, reasoning: str, questions: list,
            raw: str, **extra) -> dict:
    """Build a judgment record.

    `raw` is the agent's unparsed reply, kept ONLY when something went wrong
    with it. Keeping it on every successful judgment would put 2KB of JSON
    into every artifact for no benefit — the reasoning and questions are the
    useful parts, and the raw is there for the case where a human needs to see
    what the agent actually said to understand why it was unjudged.
    """
    d = {
        "verdict": verdict,
        "confidence": confidence,
        "reasoning": reasoning,
        "questions": questions,
        "parse_failed": False,
        **extra,
    }
    if verdict == UNCERTAIN or extra.get("contradiction"):
        d["raw"] = raw[:2000]
    return d


def parse_reply(text: str) -> dict:
    """Normalise an agent reply into a judgment record.

    Every field is validated rather than trusted. A reply claiming
    `"verdict": "excellent"` is an UNCERTAIN, not a crash and not a silent
    pass — an unrecognised answer means nobody actually judged this.
    """
    raw = text or ""
    obj = _extract_json(raw)
    if obj is None:
        return _record(UNCERTAIN, 0, "", [], raw, parse_failed=True)

    verdict = str(obj.get("verdict", "")).strip().lower()
    if verdict not in VALID:
        # Keep the reasoning — it is still informative — but the verdict is
        # unknown, so nothing was judged.
        return _record(
            UNCERTAIN, _conf(obj), str(obj.get("reasoning", "")).strip(), [], raw,
            unknown_verdict=str(obj.get("verdict", ""))[:60],
        )

    conf = _conf(obj)
    reasoning = str(obj.get("reasoning", "")).strip()

    questions = _questions(obj.get("questions"))

    # A below_threshold verdict with no questions is a contradiction. The agent
    # said it is short but named no gap, so there is no route forward and the
    # human would be stranded. Demote it to uncertain and say why — that is
    # strictly more useful than "below threshold, good luck".
    if verdict == BELOW_THRESHOLD and not questions:
        return _record(
            UNCERTAIN, conf,
            (reasoning + " (No specific gaps were named, so there is nothing to "
             "ask; treating this as unjudged rather than blocking with nothing "
             "to go on.)").strip(),
            [], raw, contradiction=True,
        )

    # Questions only make sense when below the bar. An at_threshold with
    # questions is an agent hedging; drop them rather than pretend they block.
    if verdict == AT_THRESHOLD:
        questions = []

    return _record(verdict, conf, reasoning, questions, raw)


def _conf(obj: dict) -> int:
    """Confidence, coerced and clamped. A missing or non-numeric value is 0,
    not a guess — 'high' is not a number and rounding it up would be inventing
    data."""
    try:
        return max(0, min(100, int(obj.get("confidence", 0))))
    except (TypeError, ValueError):
        return 0


def _questions(raw_q) -> list[str]:
    """Normalise the questions array. Capped at 12 — an agent that returns
    forty questions has stopped being useful, and the human cannot answer
    forty things before getting any output."""
    out: list[str] = []
    if isinstance(raw_q, list):
        for q in raw_q:
            if isinstance(q, str) and q.strip():
                out.append(q.strip())
            elif isinstance(q, dict):
                # Accept {"question": ..., "gap": ...} as well as a bare
                # string — an agent that names the gap is more useful, and
                # refusing the richer form would be pedantic. Coerce every
                # part to str: a JSON reply can carry a number or a nested
                # object, and None is a real possibility.
                text_q = str(q.get("question") or "").strip()
                if text_q:
                    gap = str(q.get("gap") or "").strip()
                    out.append(f"{text_q}" + (f"  _(closes: {gap})_" if gap else ""))
    return out[:12]


def judge(artifact: str, lens: str, cfg: dict, skill_hint: str = "") -> dict:
    """Ask the agent to judge one artifact. Returns a judgment record.

    Raises AgentConfigError for anything infrastructural (no endpoint, no key,
    the service is down) so the caller can distinguish "the agent could not be
    asked" from "the agent answered and said no". Those need different
    handling and only the second one is a judgment.
    """
    prompt = build_prompt(artifact, lens, skill_hint)
    result = agentic.invoke(cfg, prompt)
    verdict = parse_reply(result["text"])
    verdict["agent"] = cfg.get("name", "")
    verdict["agent_title"] = cfg.get("title", "")
    verdict["model"] = result.get("model", "")
    verdict["elapsed_ms"] = result.get("elapsed_ms", 0)
    verdict["threshold"] = T.get_threshold(lens)
    return verdict


def default_config() -> dict | None:
    """The first configured, keyed integration — or None.

    "First" is by sorted filename, which is stable and predictable. When
    several exist, asking the human which agent should judge is a real design
    question, and guessing is worse than being explicit about the default.
    """
    candidates = [
        a for a in agentic.list_configs()
        if a.get("status") == "active" and a.get("has_key") and not a.get("error")
    ]
    if not candidates:
        return None
    return agentic.load_config(candidates[0]["path"])


def format_for_record(j: dict) -> str:
    """The markdown block written into the artifact.

    The judgment is recorded next to the output it judged, so months later the
    reasoning is there — not just the number.
    """
    label = {
        AT_THRESHOLD: "at threshold",
        BELOW_THRESHOLD: "below threshold",
        UNCERTAIN: "unjudged",
    }.get(j.get("verdict"), "unjudged")

    thr = j.get("threshold", "?")
    who = j.get("agent_title") or j.get("agent") or "no agent configured"

    lines = [
        f"**Clarity:** {label} — judged at {thr}% threshold"
        + (f" (agent confidence {j['confidence']}%)" if j.get("confidence") else ""),
    ]
    if j.get("reasoning"):
        lines.append(f"**Judged by:** {who} — {j['reasoning']}")
    else:
        lines.append(f"**Judged by:** {who} — no reasoning returned")
    if j.get("questions"):
        lines.append("")
        lines.append("**Gaps the agent identified:**")
        for q in j["questions"]:
            lines.append(f"- {q}")
    if j.get("parse_failed"):
        lines.append("")
        lines.append("_The agent's reply could not be parsed, so nothing was "
                     "judged. This artifact was not gated._")
    return "\n".join(lines)
