"""Confidence thresholds — per lens, configurable, recorded on the artifact.

The 95% figure was hardcoded in four places (two agent definitions, two skill
files) and therefore could not be changed by the human. That is the defect
this module fixes. A fixed 95% serves neither end of the range: trivial work
should not demand a full interview, and genuinely complex work may need the
gate turned *down* or the human can never get any output at all.

Where the value lives
--------------------
In the vault, at `knowledge/process/confidence-thresholds.md`, one line per
lens. The vault is the right home because that is where every other piece of
domain knowledge already lives, it is git-synced so a threshold change is a
reviewable commit, and it travels with the spec. An in-chat-only setting would
be forgotten by the next session and would not explain why an artifact came
out the way it did.

How the value reaches the agent
-------------------------------
It is *stated in the prompt*, not left to the agent's memory or a file it must
go and read. The gate is a live conversation; the agent has no reason to open
a config file mid-interview, and a threshold that is merely documented is a
threshold that is quietly ignored. So every prompt carries:

    CONFIDENCE THRESHOLD: 85%   (set by the human, adjustable)

That is a deliberate asymmetry with the skills, which say "95%+" as their
default. The skill documents the *intent*; the prompt carries the *decision*.
When they disagree, the prompt wins, and the artifact records which was used.

The range
---------
1–100 inclusive. 100 is legal and means "ask me about everything" — a real
choice for high-stakes work, and the system must not argue with it. 0 is not
offered: a gate of zero is not a gate, and silently degrading to one would be
worse than refusing the value.
"""

from __future__ import annotations

import re

DEFAULT_THRESHOLD = 95

# Bounds. 100 is allowed on purpose (see module docstring); 1 is the floor
# because anything lower is not a gate.
MIN_THRESHOLD = 1
MAX_THRESHOLD = 100

THRESHOLD_PATH = "knowledge/process/confidence-thresholds.md"

# The lenses that have a gate today. A lens not listed here uses the default,
# which means a new workflow is never blocked by missing configuration.
LENSES = (
    "requirements-default",
    "hypotheses-default",
    "rationalizations-default",
    "ux-bridge-default",
)

# Matches `| requirements-default | 85% | why |` in a markdown table row.
_ROW = re.compile(
    r"^\s*\|\s*`?([a-z0-9\-]+)`?\s*\|\s*(\d{1,3})\s*%?\s*\|(.*)$",
    re.IGNORECASE,
)


def _parse(markdown: str) -> dict:
    """Pull lens -> (value, note) out of the thresholds file.

    Tolerant of table formatting: a leading/trailing pipe, a backticked id, a
    value with or without a percent sign. What it does NOT tolerate is an
    out-of-range value, which is skipped and reported rather than clamped —
    silently clamping `850%` to 100 would hide a typo that matters.
    """
    out: dict = {}
    for line in markdown.splitlines():
        m = _ROW.match(line)
        if not m:
            continue
        lens, raw, rest = m.group(1), m.group(2), m.group(3)
        if lens not in LENSES:
            continue
        try:
            val = int(raw)
        except ValueError:
            continue
        if val < MIN_THRESHOLD or val > MAX_THRESHOLD:
            continue
        note = rest.strip().strip('|').strip()
        out[lens] = {"threshold": val, "note": note}
    return out


def load_thresholds() -> dict:
    """Every lens's threshold, with the default filled in for the unlisted.

    Returns {lens: {threshold, note, source}} where source is 'config' when
    the vault set it and 'default' when it fell back. The distinction is kept
    so the UI can honestly say whether a number was chosen or inherited.
    """
    from pathlib import Path
    p = Path(__file__).parent / "vault" / THRESHOLD_PATH
    configured: dict = {}
    if p.exists():
        try:
            configured = _parse(p.read_text(encoding="utf-8"))
        except OSError:
            configured = {}

    out = {}
    for lens in LENSES:
        if lens in configured:
            out[lens] = {**configured[lens], "source": "config"}
        else:
            out[lens] = {
                "threshold": DEFAULT_THRESHOLD,
                "note": "",
                "source": "default",
            }
    return out


def get_threshold(lens: str) -> int:
    """One lens's threshold. Never raises — a missing lens gets the default,
    because failing to start a workflow over a config value would be absurd."""
    return load_thresholds().get(lens, {}).get("threshold", DEFAULT_THRESHOLD)


def validate(value) -> int | None:
    """Coerce and range-check a value coming from the UI or an API.

    Returns the int, or None if it is not a usable threshold. Returning None
    rather than clamping is deliberate: a caller that sends 450 has made a
    mistake, and quietly treating it as 100 would hide that.
    """
    try:
        n = int(str(value).strip().rstrip('%'))
    except (TypeError, ValueError):
        return None
    if n < MIN_THRESHOLD or n > MAX_THRESHOLD:
        return None
    return n


def threshold_line(lens: str) -> str:
    """The one line that goes into every prompt.

    This is the whole mechanism. The agent does not read a config file; it is
    told, on every turn, what the human decided the bar is. That is the only
    way a per-lens setting survives a long interview across dozens of turns.
    """
    info = load_thresholds().get(lens, {})
    val = info.get("threshold", DEFAULT_THRESHOLD)
    src = "set by the human" if info.get("source") == "config" else "Prism default"
    line = f"CONFIDENCE THRESHOLD: {val}% ({src})"
    if info.get("note"):
        line += f"\n  why: {info['note']}"
    return line


def threshold_block(lens: str) -> str:
    """A fuller instruction block, for the prompt head where it is visible.

    Explains what the threshold MEANS, because "95%" on its own is a number
    with no semantics. The agent needs to know it is judging its own
    understanding against a bar the human set, and that the human may have
    set it to 100.
    """
    info = load_thresholds().get(lens, {})
    val = info.get("threshold", DEFAULT_THRESHOLD)
    src = "set by the human" if info.get("source") == "config" else "Prism default"

    out = (
        f"CONFIDENCE THRESHOLD: {val}%\n"
        f"\n"
        f"The human has set the clarity bar for this lens at {val}%. Judge your own\n"
        f"understanding against it: are you {val}% confident that you understand what\n"
        f"they actually intend, and that you have enough from them to produce an asset\n"
        f"a downstream agent will fully understand and execute to their intent?\n"
    )

    # The human's REASONING for the value. A bare number tells the agent where
    # the bar is but not what it is for, and without it the agent treats an
    # 85% and a 95% as arbitrary numbers rather than as a deliberate choice
    # about this kind of work. The note is often the most informative line in
    # the whole block.
    if info.get("note"):
        out += (
            f"\n"
            f"The human's reason for choosing {val}% here:\n"
            f"\"{info['note']}\"\n"
            f"Weigh your judgment in the light of that. This is why the bar sits\n"
            f"where it does, and it is not yours to move.\n"
        )

    out += (
        f"\n"
        f"- Below {val}%: ask the specific questions that would close the gap. Each\n"
        f"  question must name the uncertainty it resolves. No generic\n"
        f"  'please provide more detail'.\n"
        f"- At or above {val}%: produce the asset. There is no value in asking about\n"
        f"  something you already know.\n"
        f"- State your confidence and the reason for it. It is recorded.\n"
        f"\n"
        f"This threshold was chosen by the human and is not yours to raise. If it\n"
        f"seems wrong for this work, say so once and continue at the level set."
    )
    return out
