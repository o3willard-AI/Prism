"""
Prism API Server
Raw input → focused clarity for product managers.
Python stdlib only — no pip required.
Port: 8082
"""

import http.server
import json
import os
import re
import socketserver
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote

# F21: the document extractor is a sibling module, not an installed package.
# Prism ships no build step and no site-packages, so the script's own
# directory has to be importable regardless of the working directory the
# server was started from — otherwise `python3 prism/api-server.py` from the
# repo root and from prism/ behave differently.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract import UnsupportedDocument, extract_document  # noqa: E402
import agentic  # noqa: E402
import adjudicate  # noqa: E402
import interrogate  # noqa: E402
import thresholds  # noqa: E402

PORT = 8082
# Data directory lives next to this script
DATA_ROOT = Path(__file__).parent / "vault"

INGEST_TYPES = {
    "formatted",
    "unordered",
    "media",
    "application",
    "code",
    "dictation",
}

# F21: external document ingest. Two independent caps, and both matter.
#
# UPLOAD_MAX bounds what the server will read off the socket. The request is
# read whole into memory before it is parsed, so an unbounded body is an
# unbounded allocation from an unauthenticated local client — cheap to
# trigger, and there is no streaming parser underneath to relieve it.
#
# EXTRACT_MAX bounds what will be staged. A 200MB text dump is not an
# "artifact to refract", it is a file the person put in the wrong place, and
# it would then be copied, diffed and rendered on every subsequent view. The
# refusal message says so, rather than truncating silently — a truncated
# document that looks complete is worse than a refused one.
UPLOAD_MAX = 32 * 1024 * 1024        # 32 MB on the wire
EXTRACT_MAX = 2 * 1024 * 1024         # 2 MB of extracted text

# Formats the client should offer in the file picker. This is UI convenience
# only — the server's extension dispatch plus magic-byte sniffing is what
# actually decides, so a file arriving by any other route still works.
INGEST_ACCEPT = ".md,.txt,.csv,.json,.rtf,.html,.htm,.pdf,.docx,.xlsx,.pptx"



# ── Helpers ──────────────────────────────────────────────────────────────────

def safe_path(rel: str) -> Path | None:
    """Resolve a relative path inside DATA_ROOT. Returns None if escape attempt."""
    try:
        resolved = (DATA_ROOT / rel).resolve()
    except (OSError, ValueError, RuntimeError):
        # RuntimeError: symlink loop. ValueError: not a path. OSError: bad name.
        return None
    try:
        resolved.relative_to(DATA_ROOT.resolve())
    except ValueError:
        return None
    return resolved


def read_file(rel: str) -> tuple[str | None, str | None]:
    """Return (content, error)."""
    p = safe_path(rel)
    if p is None:
        return None, "Path not allowed"
    if not p.exists():
        return None, "File not found"
    return p.read_text(encoding="utf-8"), None


def write_file(rel: str, content: str) -> str | None:
    """Write content. Returns error string or None."""
    p = safe_path(rel)
    if p is None:
        return "Path not allowed"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    return None


def move_file(src_rel: str, dest_rel: str) -> str | None:
    """Move src to dest within the vault. Returns error string or None."""
    src = safe_path(src_rel)
    dst = safe_path(dest_rel)
    if src is None or dst is None:
        return "Path not allowed"
    if not src.exists():
        return f"Source not found: {src_rel}"
    dst.parent.mkdir(parents=True, exist_ok=True)
    src.rename(dst)
    return None


def build_tree(root: Path, base: Path) -> list:
    """Recursive directory tree as list of dicts."""
    items = []
    try:
        entries = sorted(root.iterdir(), key=lambda e: (e.is_file(), e.name.lower()))
    except PermissionError:
        return items
    for entry in entries:
        rel = str(entry.relative_to(base)).replace("\\", "/")
        if entry.is_dir():
            items.append({"name": entry.name, "path": rel, "type": "dir",
                          "children": build_tree(entry, base)})
        elif entry.suffix == ".md":
            # Session sidecars are machinery, not light — keep them out of
            # lens lists and the vault tree (F3).
            if entry.name.endswith(("-pause.md", "-chat.md")):
                continue
            items.append({"name": entry.name, "path": rel, "type": "file"})
    return items


def parse_frontmatter(content: str) -> dict:
    """Generic **Key:** Value parser for Prism markdown files."""
    meta = {}
    for line in content.splitlines():
        m = re.match(r"\*\*([^*]+):\*\*\s*(.+)", line)
        if not m:
            continue
        key   = m.group(1).strip().lower().replace(" ", "_")
        value = m.group(2).split("<!--")[0].strip()
        # Normalise common fields
        if key in ("status", "type", "priority", "influence_level", "relationship_health"):
            value = value.split()[0].lower()  # first word, lowercase
        elif key == "confidence":
            try:
                value = float(value)
            except ValueError:
                continue
        elif key in ("last_updated", "date", "created"):
            dm = re.search(r"\d{4}-\d{2}-\d{2}", value)
            value = dm.group(0) if dm else value
        # Store under the key, plus convenience aliases
        meta[key] = value
    # Aliases for legacy callers
    if "influence_level"      in meta: meta.setdefault("influence", meta["influence_level"])
    if "relationship_health"  in meta: meta.setdefault("health",    meta["relationship_health"])
    if "last_updated"         in meta: meta.setdefault("date",      meta["last_updated"])
    if "created"              in meta: meta.setdefault("date",      meta["created"])
    return meta


# ── Lens registry (one call replaces N+1 /status + /list fan-out) ───────────

LENS_FOLDERS = ["requirements", "hypotheses", "rationalizations"]


def list_lenses() -> dict:
    """One consolidated view of every thought lens: items, statuses, paused
    sessions, and the counts the sidebar badges show."""
    lenses = {}
    paused = []
    counts = {}

    for lens in LENS_FOLDERS:
        folder = DATA_ROOT / lens
        items, lens_counts = [], {}
        if folder.exists():
            for f in sorted(folder.glob("*.md")):
                name = f.name
                if name.startswith("_"):
                    continue
                # Session sidecars belong to the session, not the lens list
                if name.endswith("-pause.md") or name.endswith("-chat.md"):
                    if name.endswith("-pause.md"):
                        meta = parse_frontmatter(f.read_text(encoding="utf-8"))
                        paused.append({
                            "lens":     lens,
                            "path":     f"{lens}/{name[:-9]}.md",  # strip '-pause.md', add '.md'
                            "name":     name[:-9],
                            "step":     meta.get("step", ""),
                            "paused_at": meta.get("paused", ""),
                        })
                    continue
                meta = parse_frontmatter(f.read_text(encoding="utf-8"))
                status = meta.get("status", "draft")
                lens_counts[status] = lens_counts.get(status, 0) + 1
                items.append({
                    "name":   name[:-3],
                    "path":   f"{lens}/{name}",
                    "status": status,
                    "title":  meta.get("title", ""),
                    "created": meta.get("created", ""),
                    "last_updated": meta.get("last_updated", ""),
                })
        lenses[lens] = items
        counts[lens] = lens_counts

    # Badge semantics (kept identical to the old /status-based wiring):
    #   hyp badge = total hypotheses in flight
    #   req badge = requirements awaiting review
    #   rat badge = rationalizations still in draft
    badges = {
        "hypotheses":      sum(counts.get("hypotheses", {}).values()),
        "requirements":    counts.get("requirements", {}).get("review", 0),
        "rationalizations": counts.get("rationalizations", {}).get("draft", 0),
    }
    return {"lenses": lenses, "paused": paused, "counts": counts, "badges": badges}


# ── Paste-back verification (F2) ─────────────────────────────────────────────
# Deterministic shape checks against the output contracts already written in
# the skill files. The machine verifies structure; the human steers content.
# See lenscraft/04-ui-friction-audit.md (F2) and GN-009.

VERIFY_SHAPES = {
    # From skills/prd-gate.md — 95% certainty rule, two labelled output kinds
    "prd-gate": {
        "label": "PRD Gate",
        "kinds": {
            "inquiry": {
                "label": "Inquiry (clarifying questions)",
                "required": [
                    ("certainty statement", r"(?i)certainty.{0,80}below 95\s*%|I have identified"),
                    ("numbered question list", r"(?m)^\s*(?:1[\.\)]|-\s+\d+[\.\)])\s+\S"),
                ],
            },
            "execution": {
                "label": "Execution (developer-ready PRD)",
                "required": [
                    ("clarity confirmation", r"(?i)scope clarity confirmed|95\s*%\+|95%\+"),
                    ("Executive Summary", r"(?i)executive\s+summary"),
                    ("Success Metrics", r"(?i)success\s+metrics"),
                    ("User Personas", r"(?i)user\s+personas?"),
                    ("Functional Requirements (MoSCoW)", r"(?i)functional\s+requirements"),
                    ("Technical Architecture", r"(?i)technical\s+architecture"),
                    ("Acceptance Criteria (Given/When/Then)", r"(?i)acceptance\s+criteria"),
                    ("Risks & Assumptions", r"(?i)risks?\s*[&and]*\s*assumptions?"),
                ],
            },
        },
    },
    # From skills/intent-synth.md — Five Intention Blocks
    "intent-synth": {
        "label": "Intent Synthesizer",
        "kinds": {
            "blocks": {
                "label": "Five Intention Blocks",
                "required": [
                    ("Core Objective & Problem Statement", r"(?i)core\s+objective"),
                    ("Primary Intentions (Functional)", r"(?i)primary\s+intentions?"),
                    ("Technical & Architectural Constraints", r"(?i)(technical|architectural)\s+.{0,30}constraints?"),
                    ("Edge Cases & Sidetrack Insights", r"(?i)edge\s+cases?"),
                    ("Identified Ambiguities", r"(?i)identified\s+ambiguities?|ambiguities\s+identified"),
                ],
            },
        },
    },
    # From skills/conv-synth.md — Five Actionable Blocks
    "conv-synth": {
        "label": "Conversation Synthesizer",
        "kinds": {
            "blocks": {
                "label": "Five Actionable Blocks",
                "required": [
                    ("Executive Summary", r"(?i)executive\s+summary"),
                    ("Key Initiatives & Deliverables", r"(?i)key\s+initiatives?"),
                    ("Operational & Budgetary Constraints", r"(?i)(operational|budgetary)\s+.{0,30}constraints?|constraints?"),
                    ("Secondary Considerations & Future Items", r"(?i)secondary\s+considerations?"),
                    ("Open Questions & Ambiguities", r"(?i)open\s+questions?"),
                ],
            },
        },
    },
    # Structured Account sections (rationalizations-from-gibberish template)
    "structured-account": {
        "label": "Structured Account",
        "kinds": {
            "account": {
                "label": "Structured Account sections",
                "required": [
                    ("Context", r"(?im)^\s*#+\s*context\s*$|\*\*context\*\*"),
                    ("Reasoning", r"(?im)^\s*#+\s*reasoning\s*$|\*\*reasoning\*\*"),
                    ("Constraints", r"(?im)^\s*#+\s*constraints\s*$|\*\*constraints\*\*"),
                    ("Trade-offs Accepted", r"(?i)trade-?offs?\s+accepted"),
                    ("Secondary Considerations", r"(?i)secondary\s+considerations?"),
                    ("Revisit Trigger", r"(?i)revisit\s+trigger"),
                ],
            },
        },
    },
    # From skills/doc-synth.md — Five Synthesis Blocks
    "doc-synth": {
        "label": "Document Synthesizer",
        "kinds": {
            "blocks": {
                "label": "Five Synthesis Blocks",
                "required": [
                    ("Core Subject & Context", r"(?i)core\s+subject"),
                    ("Key Assertions & Primary Points", r"(?i)key\s+assertions?"),
                    ("Constraints & Dependencies", r"(?i)constraints?\s*(?:[&and]*\s*dependencies?)?|dependencies?"),
                    ("Tangents & Secondary Insights", r"(?i)tangents?"),
                    ("Identified Ambiguities", r"(?i)identified\s+ambiguities?|ambiguities\s+identified"),
                ],
            },
        },
    },
    # From skills/clarification-gate.md Framework C — Hypothesis brief
    # (two output kinds, same 95% certainty rule as PRD Gate)
    "hypothesis-brief": {
        "label": "Clarification Gate (Hypothesis)",
        "kinds": {
            "inquiry": {
                "label": "Inquiry (clarifying questions)",
                "required": [
                    ("certainty statement", r"(?i)certainty.{0,80}below 95\s*%|I have identified"),
                    ("numbered question list", r"(?m)^\s*(?:1[\.\)]|-\s+\d+[\.\)])\s+\S"),
                ],
            },
            "brief": {
                "label": "Hypothesis brief",
                "required": [
                    ("Hypothesis Statement", r"(?i)hypothesis\s+statement|we\s+believe\s+that"),
                    ("Basis", r"(?i)\bBasis\b"),
                    ("Success Signal", r"(?i)success\s+signal"),
                    ("Failure Signal", r"(?i)failure\s+signal"),
                    ("Test Approach", r"(?i)test\s+approach"),
                    ("Assumptions", r"(?i)assumptions?"),
                ],
            },
        },
    },
    # From skills/ux-bridge.md — UX Hand-off Specification.
    #
    # UX Bridge is the one ITERATIVE skill: it interviews the PM one question
    # at a time until (validated fields / 11) >= 95%, and only then compiles
    # the spec. So its shape has two very different outputs, discriminated by
    # STRUCTURE rather than by a self-declared label:
    #   - "question": still interviewing. The human pastes their ANSWER back
    #     and the loop continues — so this kind is NOT terminal and must never
    #     be written into the lens file.
    #   - "spec": confidence reached 95% and all 11 sections were compiled.
    #     Terminal — written into the file with status ux-ready.
    #
    # The 11 section patterns deliberately require the NUMBERED headings from
    # the skill's output format. That is what distinguishes a real spec from a
    # document that merely discusses accessibility, and it is why the shape
    # check can be trusted to gate the write.
    "ux-handoff-spec": {
        "label": "UX Hand-off Specification",
        "kinds": {
            "question": {
                "label": "Clarifying question (interview in progress)",
                "required": [
                    ("a question", r"\?"),
                    ("why it is being asked", r"(?i)\bso that\b|\bto (?:ensure|clarify|confirm|let|define|specify)\b"),
                ],
            },
            "spec": {
                "label": "UX Hand-off Specification",
                "required": [
                    ("spec heading",              r"(?i)UX\s*[-–]?\s*Hand[-\s]?off\s*Specification"),
                    ("1. Problem Statement",      r"(?im)^#+\s*1\.\s*Problem\s+Statement"),
                    ("2. User Stories (INVEST)",  r"(?im)^#+\s*2\.\s*User\s+Stor"),
                    ("3. Acceptance Criteria",     r"(?im)^#+\s*3\.\s*Acceptance\s+Criter"),
                    ("4. User Scenarios and Flows", r"(?im)^#+\s*4\.\s*Key\s+User\s+Scenarios"),
                    ("5. Error States and Edge Cases", r"(?im)^#+\s*5\.\s*Error\s+States"),
                    ("6. Accessibility",          r"(?im)^#+\s*6\.\s*Accessibility"),
                    ("7. Dependencies and Assumptions", r"(?im)^#+\s*7\.\s*Dependencies\s+and\s+Assumptions"),
                    ("8. Open Questions",         r"(?im)^#+\s*8\.\s*Open\s+Questions"),
                    ("9. Users or Personas",      r"(?im)^#+\s*9\.\s*Users\s+or\s+Personas"),
                    ("10. Business Goals",        r"(?im)^#+\s*10\.\s*Business\s+Goals"),
                    ("11. Constraints",           r"(?im)^#+\s*11\.\s*Constraints"),
                ],
            },
        },
    },
}


# Precompile every verify pattern at import time. Python 3.11+ rejects
# inline global flags mid-expression (e.g. "(?im)…|(?i)…"), so a bad
# pattern must crash the server at startup — never on a user's request.
_VERIFY_PATTERNS = {}
for _sk, _shape in VERIFY_SHAPES.items():
    for _kk, _spec in _shape["kinds"].items():
        for _name, _pat in _spec["required"]:
            _VERIFY_PATTERNS[(_sk, _kk, _name)] = re.compile(_pat)


def verify_output(shape_key: str, content: str) -> dict:
    """Check pasted agent output against the declared output shape.

    Returns a verdict the chat UI renders: which kind matched, which
    structural markers are present/missing, and steering advice. No LLM —
    pure deterministic shape matching."""
    shape = VERIFY_SHAPES.get(shape_key)
    if shape is None:
        return {"ok": False, "error": f"unknown shape: {shape_key}"}
    if not (content or "").strip():
        return {"ok": False, "error": "content required"}

    best_kind, best_hits, best_checks = None, 0, []
    kinds = {}
    for kind_key, spec in shape["kinds"].items():
        checks = []
        for name, pattern in spec["required"]:
            compiled = _VERIFY_PATTERNS[(shape_key, kind_key, name)]
            checks.append({"name": name, "present": bool(compiled.search(content))})
        hits = sum(1 for c in checks if c["present"])
        kinds[kind_key] = {"label": spec["label"], "checks": checks, "hits": hits,
                           "total": len(checks)}
        if hits > best_hits or (hits == best_hits and best_kind is None):
            best_kind, best_hits, best_checks = kind_key, hits, checks

    total = len(best_checks)
    ratio = best_hits / total if total else 0
    if ratio >= 0.8:
        verdict = "match"          # shape is recognisably there
    elif ratio >= 0.4:
        verdict = "partial"        # close — surface what's missing, human decides
    else:
        verdict = "unrecognized"   # does not look like the expected output

    missing = [c["name"] for c in best_checks if not c["present"]]

    if verdict == "match":
        advice = f"Output matches the {shape['label']} contract ({best_hits}/{total} structural markers). Structure verified — content is yours to steer."
    elif verdict == "partial":
        advice = (f"Output partially matches the {shape['label']} contract "
                  f"({best_hits}/{total} markers). Missing: {'; '.join(missing)}. "
                  f"You can accept it anyway, or re-run the skill with a note about the missing sections.")
    else:
        advice = (f"This does not look like {shape['label']} output "
                  f"({best_hits}/{total} markers found). It may be the wrong skill's "
                  f"output, or free-form text. Accept it as context, or re-run.")

    return {
        "ok": True,
        "shape": shape_key,
        "verdict": verdict,
        "kind": best_kind,
        "kind_label": shape["kinds"][best_kind]["label"] if best_kind else None,
        "hits": best_hits,
        "total": total,
        "missing": missing,
        "advice": advice,
    }


# ── Crafting Methods (LCM provenance) ──────────────────────────────────────
# A Crafting Method is the complete conversation record of crafting ONE
# thought lens. Historical asset, not a living document: written once at
# the end of the crafting session, content immutable afterwards. Every
# lens carries pointer metadata to its method (frontmatter). Methods stay
# in the library forever — even after the lens they produced is emitted —
# because the use case is learning from the past as it happened, and
# rationalizing lens sprawl needs ALL of them in one place.
# Spec: lenscraft/06-crafting-methods.md

METHODS_DIR = DATA_ROOT / "knowledge" / "resources" / "crafting-methods"
METHOD_STATUS_FIELDS = ("Status", "Deprecation marker")


def safe_lens_slug(name: str) -> str | None:
    """Sanitise a lens name into a filesystem slug. None if unusable."""
    slug = re.sub(r"[^\w\-]", "-", (name or "").strip().lower()).strip("-")
    return slug[:60] or None


def write_crafting_method(body: dict) -> tuple[int, dict]:
    """Write a crafting method. Write-once: existing method → 409.

    Returns (http_code, response_dict)."""
    lens_name = (body.get("lens") or "").strip()
    if not lens_name:
        return 400, {"error": "lens name required"}
    conversation = body.get("conversation")
    if not conversation:
        return 400, {"error": "conversation record required"}
    if isinstance(conversation, list):
        conversation = "\n\n".join(
            f"**{m.get('role', 'voice')}:** {m.get('text', '')}"
            for m in conversation if isinstance(m, dict))
    conversation = str(conversation).strip()
    if not conversation:
        return 400, {"error": "conversation record required"}

    slug = safe_lens_slug(lens_name)
    if not slug:
        return 400, {"error": "lens name unusable as filename"}

    METHODS_DIR.mkdir(parents=True, exist_ok=True)
    method_path = METHODS_DIR / f"{slug}-method.md"
    rel_path = method_path.relative_to(DATA_ROOT).as_posix()
    if method_path.exists():
        return 409, {"error": "crafting method already exists — it is a historical asset, not a living document",
                     "path": rel_path}

    lens_path = (body.get("lens_path") or "").strip()
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    crafted_by = (body.get("crafted_by") or "unrecorded").strip()
    outcome = (body.get("outcome") or "").strip() or "<!-- what this lens does — the single-best result it produced -->"
    decisions = (body.get("decisions") or "").strip() or "<!-- key craft decisions and their rationale -->"

    lens_line = (f"**Lens:** [{lens_path}]({lens_path})" if lens_path
                 else f"**Lens:** {lens_name} (not yet shelved)")
    content = f"""# Crafting Method: {lens_name}

{lens_line}
**Crafted:** {date_str}
**Crafted by:** {crafted_by}
**Status:** active

---

## Outcome

{outcome}

## Conversation record

<!-- The complete conversation log of the crafting session, verbatim.
     Historical asset: this content is never edited. Deprecation and
     supersession are marked in the frontmatter, never here. -->

{conversation}

## Craft decisions

{decisions}
"""
    err = write_file(rel_path, content)
    if err:
        return 400, {"error": err}

    # Attach the pointer to the lens file itself, if it exists in the vault
    attached = False
    if lens_path:
        lens_content, lerr = read_file(lens_path)
        if lerr is None and "Crafting method" not in lens_content:
            pointer = f"**Crafting method:** [{rel_path}]({rel_path})"
            # Insert after the last frontmatter field, before the first ---
            lines = lens_content.splitlines()
            insert_at = None
            for i, line in enumerate(lines):
                if line.strip() == "---":
                    insert_at = i
                    break
            if insert_at is not None:
                lines.insert(insert_at, pointer)
                if not write_file(lens_path, "\n".join(lines) + "\n"):
                    attached = True

    return 200, {"ok": True, "path": rel_path, "pointer_attached": attached}


def list_crafting_methods() -> list:
    """Every method in the library, newest first, with its frontmatter."""
    if not METHODS_DIR.exists():
        return []
    methods = []
    for f in sorted(METHODS_DIR.glob("*.md")):
        if f.name == "README.md":
            continue
        meta = parse_frontmatter(f.read_text(encoding="utf-8"))
        methods.append({
            "name": f.stem.replace("-method", ""),
            "path": f.relative_to(DATA_ROOT).as_posix(),
            "lens": meta.get("lens", ""),
            "crafted": meta.get("crafted", ""),
            "status": meta.get("status", "active"),
        })
    methods.sort(key=lambda m: m["crafted"], reverse=True)
    return methods


def set_method_status(body: dict) -> tuple[int, dict]:
    """Mark a method superseded/deprecated (fork 5: 'we will not return
    here'). Content stays immutable — only the status fields change."""
    rel = (body.get("path") or "").strip()
    status = (body.get("status") or "").strip().lower()
    if status not in ("active", "superseded", "deprecated"):
        return 400, {"error": "status must be active, superseded, or deprecated"}
    content, err = read_file(rel)
    if err:
        return 404, {"error": err}
    lines = content.splitlines()
    for i, line in enumerate(lines):
        if line.startswith("**Status:**"):
            lines[i] = f"**Status:** {status}"
            break
    else:
        return 400, {"error": "method has no Status field"}
    marker = (body.get("marker") or "").strip()
    if status in ("superseded", "deprecated"):
        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        marker_line = f"**Deprecation marker:** {date_str}" + (f" — {marker}" if marker else "")
        for i, line in enumerate(lines):
            if line.startswith("**Deprecation marker:**"):
                lines[i] = marker_line
                break
        else:
            # insert right after Status
            for i, line in enumerate(lines):
                if line.startswith("**Status:**"):
                    lines.insert(i + 1, marker_line)
                    break
    write_file(rel, "\n".join(lines) + "\n")
    return 200, {"ok": True, "path": rel, "status": status}


def _search_snippet(content: str, terms: list, width: int = 160) -> str:
    """Excerpt around the first term hit, whitespace-collapsed to one line."""
    lower = content.lower()
    best = -1
    for t in terms:
        i = lower.find(t)
        if i >= 0 and (best == -1 or i < best):
            best = i
    if best < 0:
        return ""
    # Prefer starting at the line containing the hit when it's close by
    nl = content.rfind("\n", 0, best)
    if nl >= 0 and best - nl <= 60:
        start = nl + 1
    else:
        start = max(0, best - 40)
    snippet = re.sub(r"\s+", " ", content[start:start + width]).strip()
    return ("…" if start > 0 else "") + snippet


def search_vault(q: str, scope: str | None = None, limit: int = 30) -> dict:
    """Deterministic full-text search over the vault (F5).

    Every term must appear somewhere in a file (AND semantics). Scoring:
    term in filename +8, in frontmatter head +4, +1 per content occurrence
    (capped at 5). Session sidecars and _templates are machinery, not
    light — never searchable. No LLM, no index: the vault is small enough
    to scan directly, which keeps it honest."""
    terms = [t for t in (q or "").lower().split() if t]
    if not terms:
        return {"query": q or "", "results": [], "count": 0}
    scopes = {s.strip() for s in scope.split(",") if s.strip()} if scope else None

    results = []
    for f in DATA_ROOT.rglob("*.md"):
        rel = f.relative_to(DATA_ROOT).as_posix()
        top = rel.split("/")[0]
        name = f.name
        if name.startswith("_"):
            continue
        if name.endswith(("-pause.md", "-chat.md")):
            continue
        if scopes and top not in scopes:
            continue
        try:
            text = f.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        name_l, text_l = name.lower(), text.lower()
        head = "\n".join(text.splitlines()[:15]).lower()
        score, matched_all = 0, True
        for t in terms:
            hit = False
            if t in name_l:
                score += 8
                hit = True
            if t in head:
                score += 4
                hit = True
            cnt = text_l.count(t)
            if cnt:
                score += min(cnt, 5)
                hit = True
            if not hit:
                matched_all = False
                break
        if not matched_all:
            continue
        meta = parse_frontmatter(text)
        results.append({
            "name": name[:-3],
            "path": rel,
            "folder": top,
            "status": meta.get("status") or None,
            "score": score,
            "snippet": _search_snippet(text, terms),
        })
    results.sort(key=lambda r: (-r["score"], r["path"]))
    return {"query": q, "results": results[:limit], "count": len(results)}


def classify_artifact(content: str, filename: str = "") -> dict:
    """Infer the artifact type from raw input (F10).

    Classification is lens work — asking the human to classify their own
    thought is the machine pushing its bookkeeping onto the user. Pure
    deterministic heuristics, every verdict carries its basis so the
    human can confirm or override at a glance. No LLM."""
    text = content or ""
    lower = text.lower()
    name = (filename or "").lower()
    ext = name.rsplit(".", 1)[-1] if "." in name else ""
    reasons = []
    score = {"unordered": 0, "formatted": 0, "code": 0,
             "dictation": 0, "media": 0, "application": 0}

    def bump(kind, pts, why):
        score[kind] += pts
        reasons.append(f"{kind} +{pts}: {why}")

    # ── Filename hints (strongest signal — the human already named it) ──
    if ext in ("mp3", "mp4", "wav", "mov", "avi", "png", "jpg", "jpeg",
               "gif", "webp", "svg", "m4a", "ogg"):
        bump("media", 10, f"media extension .{ext}")
    elif ext in ("ppt", "pptx", "xls", "xlsx", "pdf", "sketch", "fig", "ai"):
        bump("application", 10, f"application extension .{ext}")
    elif ext in ("js", "ts", "py", "go", "rb", "java", "css", "html",
                 "json", "yaml", "yml", "sh", "c", "cpp", "rs"):
        bump("code", 8, f"code extension .{ext}")
    elif ext in ("csv", "tsv"):
        bump("formatted", 8, f"tabular extension .{ext}")
    for hint in ("dictation", "transcript", "voice", "speech", "audio-log"):
        if hint in name:
            bump("dictation", 9, f"filename mentions '{hint}'")
            break

    # ── Content signals ─────────────────────────────────────────────────
    lines = [l for l in text.splitlines()]
    nonblank = [l for l in lines if l.strip()]
    n = len(nonblank)

    # Code markers
    code_markers = 0
    for l in nonblank[:60]:
        s = l.strip()
        if s.startswith(("#!", "//", "/*", "*", "import ", "from ", "def ",
                         "class ", "function ", "const ", "var ", "let ",
                         "package ", "#include", "<", "<?")):
            code_markers += 1
        if s.endswith(("{", "}", ";", ":", ")")) and ("=" in s or "(" in s):
            code_markers += 0.5
    if code_markers >= 4:
        bump("code", 4 + min(code_markers, 6), f"{code_markers:.0f} code-shaped lines")

    # CSV-ish: repeated delimited rows
    if n >= 3:
        comma_rows = sum(1 for l in nonblank[:40] if l.count(",") >= 2)
        tab_rows = sum(1 for l in nonblank[:40] if "\t" in l)
        if comma_rows / min(n, 40) >= 0.7 and comma_rows >= 3:
            bump("formatted", 8, f"{comma_rows} comma-delimited rows")
        elif tab_rows / min(n, 40) >= 0.7 and tab_rows >= 3:
            bump("formatted", 8, f"{tab_rows} tab-delimited rows")

    # Markdown-ish structure → formatted
    md_headers = sum(1 for l in nonblank[:40] if l.startswith("#"))
    md_bullets = sum(1 for l in nonblank[:40] if l[:2] in ("- ", "* ") or l[:3] in ("1. ", "2. "))
    if md_headers >= 2 or (md_headers >= 1 and md_bullets >= 2):
        bump("formatted", 6, f"{md_headers} headers, {md_bullets} list items")

    # Numbered/ordered lines → formatted
    numbered = sum(1 for l in nonblank[:40] if re.match(r"^\s*\d+[.)]\s", l))
    if numbered >= 3:
        bump("formatted", 5, f"{numbered} numbered lines")

    # Prose → unordered (or dictation if conversational). Works on the
    # whole text, not per line — a brain dump is often one long line.
    sentences = re.findall(r"[.!?]+(?:\s|$)", text)
    total_chars = len(text.strip())
    fillers = sum(lower.count(w) for w in
                  (" um,", " uh,", " you know,", " like,", " so yeah", " anyways"))
    if fillers >= 2:
        bump("dictation", 7, f"{fillers} spoken-fillers ('um', 'uh', …)")
    if n >= 2:
        avg_len = len(text) / n
        lowercase_starts = sum(1 for l in nonblank[:40]
                               if l[:1].isalpha() and l[:1].islower())
        if lowercase_starts / min(n, 40) >= 0.5 and avg_len > 60:
            bump("dictation", 5, "most lines start lowercase (spoken flow)")
    if len(sentences) >= 3 and total_chars >= 120 and md_headers == 0 and code_markers < 2:
        bump("unordered", 5, f"{len(sentences)} prose sentences, no structure")

    if not reasons:
        return {"type": "unordered", "confidence": "default",
                "basis": ["no strong signals — defaulting to unordered text"]}

    # Pick winner; ties break toward the least specific (unordered)
    order = ["unordered", "formatted", "code", "dictation", "media", "application"]
    best = max(order, key=lambda k: score[k])
    if score[best] == 0:
        best = "unordered"
    confidence = "high" if score[best] >= 8 else ("medium" if score[best] >= 4 else "low")
    # Only report reasons for the winning kind
    basis = [r for r in reasons if r.startswith(best)] or reasons[:2]
    return {"type": best, "confidence": confidence, "basis": basis}


# ── Request Handler ───────────────────────────────────────────────────────────

class PrismHandler(http.server.BaseHTTPRequestHandler):
    # HTTP/1.1 keeps connections alive — prevents Caddy's pool from using stale
    # HTTP/1.0 connections and causing ~2-minute timeout hangs on page load.
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        print(f"  {self.address_string()} {fmt % args}")

    # ── Same-origin enforcement ────────────────────────────────────────────
    # Prism is always served same-origin behind the front door (Caddy or
    # Apache), so it needs no CORS at all. The old wildcard
    # "Access-Control-Allow-Origin: *" meant any web page open in a browser
    # on this machine could POST to the API and write into the vault —
    # including the skill library, which is prompt text the user's own agent
    # later executes. Read access leaked the vault the same way.
    #
    # Browsers always send Origin; non-browser clients (curl, the e2e
    # harnesses) send none. So: a request with NO Origin is a local tool and
    # is allowed; a request with an Origin must match the host it was sent
    # to, which is exactly what same-origin means for a browser.
    # (SameSite-style CSRF protection, at the only layer that sees both
    # headers.)

    # A browser Origin is always scheme://host[:port]. Prism is a local app, so
    # the only origins it legitimately serves are loopback/local hosts.
    LOCAL_HOST_RE = re.compile(
        r"^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d{1,5})?$", re.I)
    # Port-insensitive form, used ONLY to recognise loopback-ness on both sides.
    _local_bare = re.compile(
        r"^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$", re.I)

    def _local_hosts(self) -> set:
        """Every host the app legitimately answers on: the request's own
        Host, plus the Host/Origin the front door forwarded.

        Depending on the front door (ProxyPreserveHost On, or Caddy's
        default) the Host the backend sees is the front door's address; if
        that flag were ever turned off it becomes 127.0.0.1:8082 instead.
        Either way the page and the API live on the same local host, so
        accept a loopback Origin and require a non-loopback one to match
        Host exactly. That keeps the guard correct under both proxy
        configurations rather than silently breaking the app.
        """
        hosts = set()
        for value in (self.headers.get("Host"), self.headers.get("X-Forwarded-Host")):
            if value:
                hosts.add(value.strip().lower())
        return hosts

    def _origin_allowed(self) -> bool:
        origin = self.headers.get("Origin")
        if not origin:
            return True                      # not a browser — cannot be CSRF'd
        try:
            parsed = urlparse(origin)
        except ValueError:
            return False
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            return False
        netloc = parsed.netloc.lower()

        hosts = self._local_hosts()
        if netloc in hosts:
            return True                      # exactly the host we were called on

        # Origin names a *different* local host than the request's Host. That
        # is only legitimate if BOTH sides are loopback/local — i.e. the page
        # and the API are the same machine reached by different names (page
        # at localhost:8080, proxy reached as 127.0.0.1:8082). The scheme must
        # be http, since Prism is local-only.
        #
        # The Host side matters as much as the Origin side: a request that
        # arrived addressed to a remote host must never be exempted by a
        # loopback Origin, or a spoofed X-Forwarded-Host could smuggle one
        # past the exact-match rule above.
        #
        # The PORT matters too, and this is the subtle one: origin is
        # scheme://host:port, so a page served from 127.0.0.1:8092 is a
        # DIFFERENT origin from the API on 127.0.0.1:8090 even though both are
        # loopback. Treating "loopback" as sufficient would let any other
        # local process — or any page another local app serves — write to the
        # vault. So the two sides may differ by NAME (localhost vs 127.0.0.1,
        # which is what a proxy hop looks like) but not by PORT. The port of
        # the Origin must equal the port of the Host it is being compared to.
        if parsed.scheme != "http" or not hosts:
            return False
        if not self.LOCAL_HOST_RE.match(netloc):
            return False
        if not all(self._local_bare.match(h.rsplit(":", 1)[0]
                                         if h.count(":") == 1 else h)
                   for h in hosts):
            return False
        origin_port = parsed.port or 80
        # Every Host we were reached on must agree with the Origin's port.
        for h in hosts:
            host_port = self._port_of(h)
            if host_port is not None and host_port != origin_port:
                return False
        return True

    @staticmethod
    def _port_of(netloc: str):
        """Port from a netloc, or None when it carries none."""
        try:
            return urlparse("//" + netloc).port
        except ValueError:
            return None

    def _drain_body(self):
        """Consume the request body so the connection stays usable.

        Without this, a rejected request leaves its body bytes in the socket;
        the next request on that keep-alive connection is then parsed starting
        mid-body and the server answers 400. (Symptom seen only with clients
        that reuse connections — Node's fetch — not with curl.)
        """
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
        except ValueError:
            return
        remaining = length
        while remaining > 0:
            chunk = self.rfile.read(min(remaining, 65536))
            if not chunk:
                break
            remaining -= len(chunk)

    def _reject_cross_origin(self) -> bool:
        """Guard every mutating method. Returns True if the request was
        rejected and the caller should stop."""
        if self._origin_allowed():
            return False
        self._drain_body()
        self.send_json(403, {
            "error": "Cross-origin request refused — Prism accepts same-origin only",
        })
        return True

    def send_json(self, code: int, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # Echo the origin only when it is ours; never a wildcard. Without
        # this header a foreign page cannot read the response body either.
        origin = self.headers.get("Origin")
        if origin and self._origin_allowed():
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, code: int, msg: str):
        self.send_json(code, {"error": msg})

    def do_OPTIONS(self):
        if self._reject_cross_origin():
            return
        self.send_response(200)
        origin = self.headers.get("Origin")
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_DELETE(self):
        if self._reject_cross_origin():
            return
        parsed = urlparse(self.path)
        path   = parsed.path.rstrip("/")
        qs     = parse_qs(parsed.query)

        if path == "/file":
            rel = unquote(qs.get("path", [""])[0])
            if not rel:
                return self.send_error_json(400, "path required")
            p = safe_path(rel)
            if p is None:
                return self.send_error_json(403, "Path not allowed")
            if not p.exists():
                return self.send_error_json(404, "File not found")
            # Safety: only allow deletion inside lens folders and ingestion
            allowed_roots = {"requirements", "hypotheses",
                             "rationalizations", "ingestion"}
            top = rel.split("/")[0]
            if top not in allowed_roots:
                return self.send_error_json(403, "Deletion not permitted for this folder")
            p.unlink()
            self.send_json(200, {"deleted": rel})
        else:
            self.send_error_json(404, "Not found")

    def handle_ingest_document(self, stage=True):
        """F21: extract text from an uploaded document.

        With stage=True the extracted text is filed as an artifact in
        ingestion/unprocessed/. With stage=False only the text comes back —
        that is the chat-attachment path, where reading a document must not
        quietly create a file in the vault as a side effect.

        The contract with the human matters more than the plumbing. When a
        document cannot be read, the response carries the extractor's own
        explanation — "it is a scan, paste the text in instead" — rather than
        a generic 400. A person who just dropped a scanned PDF needs to be
        told what to do next, not told the request was invalid.
        """
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
        except (TypeError, ValueError):
            return self.send_error_json(400, "Could not read the upload size.")

        if length <= 0:
            return self.send_error_json(400, "No file was sent.")
        if length > UPLOAD_MAX:
            return self.send_error_json(
                413,
                f"That file is {length // (1024 * 1024)} MB. Prism's limit is "
                f"{UPLOAD_MAX // (1024 * 1024)} MB — if it really is a document "
                "to refract, open it and paste the relevant text in instead."
            )

        raw = self.rfile.read(length)
        if len(raw) != length:
            return self.send_error_json(400, "The upload was cut short — try again.")

        try:
            filename = unquote(self.headers.get("X-File-Name", "") or "")
        except Exception:
            filename = ""
        if not filename:
            return self.send_error_json(
                400, "Prism could not tell what file that was — the name is missing."
            )

        # ---- extraction -------------------------------------------------
        try:
            text, extractor = extract_document(raw, filename)
        except UnsupportedDocument as exc:
            # 422: the request was well-formed, the document was not readable.
            # The distinction is worth keeping — 400 would tell the human the
            # upload was malformed, which is not true and not actionable.
            return self.send_error_json(422, str(exc))
        except MemoryError:
            return self.send_error_json(
                413, "That document was too large for Prism to open safely."
            )
        except Exception as exc:  # a parser bug must not read as a bad file
            return self.send_error_json(
                500,
                f"Prism hit an unexpected error reading that document ({type(exc).__name__}). "
                "The file was not staged.",
            )

        if not text.strip():
            return self.send_error_json(
                422,
                "Prism read that file but it contained no text. If it is a scan or "
                "an image document, Prism cannot read it — paste the text in instead.",
            )
        if len(text) > EXTRACT_MAX:
            return self.send_error_json(
                413,
                f"That document extracted to {len(text) // 1024} KB of text, over Prism's "
                f"{EXTRACT_MAX // 1024} KB limit. Prism did not stage it, because a "
                "truncated document that looks complete is worse than none. Paste the "
                "relevant section instead.",
            )

        result = {
            "ok": True,
            "extractor": extractor,
            "chars": len(text),
            "bytes": len(raw),
            "filename": filename,
            "text": text,
        }

        if not stage:
            # Extraction only — no vault write. The chat path wants the words,
            # not an artifact.
            return self.send_json(200, result)

        # ---- stage it ---------------------------------------------------
        title = filename.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
        if "." in title:
            title = title.rsplit(".", 1)[0]
        title = title.strip() or "untitled"

        artifact_type = self.headers.get("X-Artifact-Type", "").strip().lower()
        if artifact_type not in INGEST_TYPES:
            artifact_type = "application"      # an imported document
        is_private = (self.headers.get("X-Private", "") or "").lower() in ("1", "true", "yes")

        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        safe_title = re.sub(r"[^\w\-]", "-", title.lower())[:40].strip("-")
        privacy_suffix = "-private" if is_private else ""
        stored_name = f"{date_str}-{safe_title}{privacy_suffix}.md"
        rel_path = f"ingestion/unprocessed/{stored_name}"

        source_note = (f"`{filename}` · extracted with the {extractor} reader · "
                       f"{len(raw):,} bytes in, {len(text):,} characters out")

        file_content = f"""# {title}

**Type:** {artifact_type}
**Date:** {date_str}
**Private:** {"yes" if is_private else "no"}
**Source document:** {source_note}
**Status:** unprocessed

---

{text}

---

## Observations
<!-- Direct quotes, factual claims -->

## Interpretations
<!-- Agent or PM framing of above -->

## Hypotheses
<!-- Testable beliefs surfaced -->
"""
        err = write_file(rel_path, file_content)
        if err:
            return self.send_error_json(400, err)

        self.send_json(200, {**result, "path": rel_path, "type": artifact_type})

    def handle_agent_invoke(self):
        """F22: send a prepared prompt to a configured agent integration.

        Every call is recorded in the vault before the request goes out, not
        after it returns. That ordering is deliberate: if the call hangs, is
        killed, or the server dies mid-flight, there is still a record that it
        was attempted — which is the fact you would want when reconciling a
        subscription bill.
        """
        body = self.read_body()
        if not body:
            return self.send_error_json(400, "Invalid JSON")
        rel = (body.get("agent") or "").strip()
        prompt = (body.get("prompt") or "").strip()
        if not rel:
            return self.send_error_json(400, "No agent integration named.")
        if not prompt:
            return self.send_error_json(400, "No prompt to send.")

        try:
            cfg = agentic.load_config(rel)
        except agentic.AgentConfigError as exc:
            return self.send_error_json(400, str(exc))

        # Record the attempt BEFORE calling, so an interrupted call is still
        # visible in the ledger.
        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        safe = re.sub(r"[^\w\-]", "-", cfg["name"].lower())[:40].strip("-") or "agent"
        log_rel = f"ingestion/agent-calls/{date_str}-{safe}-{int(time.time())}.md"
        started = datetime.now(timezone.utc).strftime("%H:%M:%S")
        write_file(log_rel, f"""# Agent call — {cfg['title']}

**Agent:** {cfg['name']}
**Started:** {started}
**Status:** in progress

---

{prompt}
""")

        try:
            result = agentic.invoke(cfg, prompt)
        except agentic.AgentConfigError as exc:
            # 502: Prism reached the endpoint and it refused or failed. The
            # message is the human's next action.
            return self.send_error_json(502, str(exc))

        # Close the ledger entry with what came back.
        try:
            with (DATA_ROOT / log_rel).open("a", encoding="utf-8") as fh:
                fh.write(
                    f"\n---\n\n**Status:** completed  \n"
                    f"**Elapsed:** {result['elapsed_ms']} ms  \n"
                    f"**Model:** {result['model'] or '—'}\n\n"
                    f"## Response\n\n{result['text']}\n"
                )
        except OSError:
            # The call succeeded and the ledger append is best-effort; losing
            # the transcript must not turn a good result into an error.
            pass

        self.send_json(200, {
            "ok": True,
            "text": result["text"],
            "model": result["model"],
            "elapsed_ms": result["elapsed_ms"],
            "request_id": result["request_id"],
            "usage": result["usage"],
            "log_path": log_rel,
        })

    def handle_interrogate(self):
        """Ask the agent what the human actually wants, BEFORE a lens is chosen.

        The counterpart to handle_adjudicate. That one runs after an artifact
        exists and can only say yes or no; this one runs first and shapes what
        gets built. A lens is a contract with every downstream agent that will
        read it, so a lens written from one paragraph with nobody asked is a
        guess — and the agent is the one who can see the gaps.

        Returns the agent's proposed shape, what it thinks the outcome is, and
        the questions it needs answered. An unconfigured agent is reported as
        UNAVAILABLE rather than approximated: substituting a deterministic guess
        here would recreate exactly the bug that /classify represents.
        """
        body = self.read_body()
        if body is None:
            return self.send_error_json(400, "Invalid JSON")
        raw = (body.get("raw") or body.get("content") or "").strip()
        if not raw:
            return self.send_error_json(400, "raw thought required")
        answers = body.get("answers") or []
        if not isinstance(answers, list):
            return self.send_error_json(400, "answers must be a list")
        lens_hint = (body.get("lens") or "").strip()

        try:
            result = interrogate.interrogate(raw, answers, lens_hint)
        except agentic.AgentConfigError as exc:
            result = {
                "ok": False, "asked": False, "verdict": "unavailable",
                "selection": {"selection": "none", "why": ""},
                "agent_error": str(exc), "questions": [],
            }
        except Exception as exc:            # never 500 a human's own typing
            result = {
                "ok": False, "asked": False, "verdict": "unavailable",
                "selection": {"selection": "none", "why": ""},
                "agent_error": f"unexpected error interrogating: {type(exc).__name__}",
                "questions": [],
            }

        # The answers travel with the reply so the client holds the exchange and
        # not just the last turn.
        result["answers"] = answers
        self.send_json(200, result)

    def handle_adjudicate(self):
        """F24: ask the AGENT whether a pasted artifact meets the bar.

        Returns both the agent's judgment and the structural floor, and is
        explicit about which one is which. The floor is demoted: it is
        context for the human, never an approval. The old design let a regex
        ratio decide, which meant a document full of "TBD" passed and a good
        one with unusual headings failed.
        """
        body = self.read_body()
        if not body:
            return self.send_error_json(400, "Invalid JSON")
        artifact = (body.get("artifact") or "").strip()
        lens = (body.get("lens") or "").strip()
        shape = (body.get("shape") or "").strip()
        if not artifact:
            return self.send_error_json(400, "No artifact to judge.")
        if not lens:
            return self.send_error_json(400, "No lens named.")

        thr = thresholds.get_threshold(lens)

        # The structural floor. Runs regardless, and is reported as a FLOOR.
        floor = None
        if shape:
            try:
                if shape not in VERIFY_SHAPES:
                    floor = {"error": f"unknown shape {shape!r}"}
                else:
                    floor = verify_output(shape, artifact)
            except Exception as exc:
                floor = {"error": f"structural check failed: {type(exc).__name__}"}

        # The judgment. Absent an integration, this is honestly absent — and
        # the response says so rather than substituting the floor for it.
        judgment = None
        agent_error = None
        # Why THIS agent judged this lens, so the human can see the choice
        # instead of inferring it. F26 writes the judge into every artifact, so
        # an arbitrary judge became legible — this makes it correctable.
        selection = {"selection": "none", "why": "no judgment was attempted"}
        try:
            cfg, selection = adjudicate.select_config(lens)
            if cfg is None:
                agent_error = (
                    f"{selection['why']} Nothing was judged. The structural "
                    "check below is a floor only — it cannot approve an "
                    "artifact."
                )
            else:
                judgment = adjudicate.judge(artifact, lens, cfg)
        except agentic.AgentConfigError as exc:
            agent_error = str(exc)
        except Exception as exc:
            agent_error = f"unexpected error judging: {type(exc).__name__}"

        # Two different absences, and conflating them would be a lie in one
        # direction or the other. `judgment is None` means Prism could not ask
        # anyone — no integration, service down, bad key. A judgment whose
        # verdict is UNCERTAIN means the agent WAS asked and said it cannot
        # tell. The first is a gap in setup; the second is an opinion.
        if judgment is None:
            verdict = adjudicate.UNJUDGED
        else:
            verdict = judgment["verdict"]

        self.send_json(200, {
            "ok": True,
            "lens": lens,
            "threshold": thr,
            "verdict": verdict,
            "asked": judgment is not None,
            "judgment": judgment,
            "agent_error": agent_error,
            "selection": selection,
            "floor": floor,
            "record": (adjudicate.format_for_record(judgment, selection)
                       if judgment else None),
        })

    def read_body(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length)
            return json.loads(raw)
        except Exception:
            return None

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        qs = parse_qs(parsed.query)

        if path == "/thresholds":
            # F23: per-lens confidence thresholds, and the default for a lens
            # that has never been configured. Read-only — the file is edited
            # in the vault, so there is exactly one source of truth.
            self.send_json(200, {
                "ok": True,
                "default": thresholds.DEFAULT_THRESHOLD,
                "min": thresholds.MIN_THRESHOLD,
                "max": thresholds.MAX_THRESHOLD,
                "path": thresholds.THRESHOLD_PATH,
                "thresholds": thresholds.load_thresholds(),
            })

        elif path == "/threshold-block":
            # The exact text that goes into a prompt for one lens. Built here
            # so the string exists in exactly one place: restating it in
            # app.js is how the F9 drift happened, and a threshold that exists
            # in two copies is a threshold that will disagree with itself.
            lens = (qs.get("lens", [""])[0] or "").strip()
            self.send_json(200, {
                "ok": True,
                "lens": lens,
                "threshold": thresholds.get_threshold(lens),
                "block": thresholds.threshold_block(lens),
                "line": thresholds.threshold_line(lens),
            })

        elif path == "/agent-configs":
            # F22: which agent integrations exist, and which are callable now.
            # `has_key` reports whether the named env var is set WITHOUT ever
            # returning its value — the key itself never leaves the server.
            self.send_json(200, {"ok": True, "agents": agentic.list_configs()})

        elif path == "/tree":
            self.send_json(200, build_tree(DATA_ROOT, DATA_ROOT))

        elif path == "/file":
            rel = unquote(qs.get("path", [""])[0])
            if not rel:
                return self.send_error_json(400, "path required")
            content, err = read_file(rel)
            if err:
                return self.send_error_json(404, err)
            self.send_json(200, {"path": rel, "content": content})

        elif path == "/list":
            # List files in a folder (non-recursive)
            rel = unquote(qs.get("path", [""])[0])
            p = safe_path(rel) if rel else DATA_ROOT
            if p is None or not p.is_dir():
                return self.send_error_json(404, "Folder not found")
            files = [
                {"name": f.name,
                 "path": str(f.relative_to(DATA_ROOT)).replace("\\", "/"),
                 "type": "dir" if f.is_dir() else "file",
                 # F29: modification time, so a client can order a list by when
                 # a thing actually arrived. Filenames carry a date but no
                 # time and a random id, so two files created on the same day
                 # had NO defined order — "newest first" silently degraded to
                 # "highest random id". The fact belongs here, where it is
                 # known, rather than being guessed in the browser. Only for
                 # files: a directory's mtime means something else entirely.
                 **({} if f.is_dir() else {"modified": int(f.stat().st_mtime)})}
                for f in sorted(p.iterdir(), key=lambda e: (e.is_file(), e.name.lower()))
                if f.is_dir() or f.suffix == ".md"
            ]
            self.send_json(200, files)

        elif path == "/lenses":
            self.send_json(200, list_lenses())

        elif path == "/search":
            q = qs.get("q", [""])[0].strip()
            scope = qs.get("scope", [None])[0]
            self.send_json(200, search_vault(q, scope))

        elif path == "/methods":
            self.send_json(200, {"methods": list_crafting_methods()})

        elif path == "/method":
            rel = unquote(qs.get("path", [""])[0])
            if not rel:
                return self.send_error_json(400, "path required")
            content, err = read_file(rel)
            if err:
                return self.send_error_json(404, err)
            self.send_json(200, {"path": rel, "content": content})

        elif path == "/workflows":
            wf_dir = DATA_ROOT / "workflows"
            result = []
            if wf_dir.exists():
                for entry in sorted(wf_dir.iterdir()):
                    if not entry.is_dir():
                        continue
                    readme = entry / "README.md"
                    meta   = {}
                    if readme.exists():
                        meta = parse_frontmatter(readme.read_text(encoding="utf-8"))
                    result.append({
                        "id":          entry.name,
                        "name":        meta.get("name",        entry.name.replace("-", " ").title()),
                        "description": meta.get("description", ""),
                        "for_lenses":  meta.get("for_lenses",  "all"),
                    })
            self.send_json(200, result)

        else:
            self.send_error_json(404, "Not found")

    def do_POST(self):
        if self._reject_cross_origin():
            return
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")

        if path == "/file":
            body = self.read_body()
            if not body or "path" not in body or "content" not in body:
                return self.send_error_json(400, "path and content required")
            err = write_file(body["path"], body["content"])
            if err:
                return self.send_error_json(400, err)
            self.send_json(200, {"ok": True, "path": body["path"]})

        elif path == "/ingest-document":
            # F21: external document ingest. The browser sends the raw bytes
            # and this server extracts the text, so the extraction logic lives
            # in exactly one place and the client stays a thin uploader.
            self.handle_ingest_document(stage=True)

        elif path == "/extract-document":
            # F21: extraction WITHOUT staging. The chat attachment path needs
            # the text to show the agent, but it must not drop a file in the
            # vault as a side effect of someone attaching a document to a
            # message — that would create artifacts nobody asked for. Reading
            # a document and filing it are two different acts.
            self.handle_ingest_document(stage=False)

        elif path == "/ingest":
            body = self.read_body()
            if not body:
                return self.send_error_json(400, "Invalid JSON")
            artifact_type = body.get("type", "formatted").lower()
            if artifact_type not in INGEST_TYPES:
                artifact_type = "formatted"
            title = body.get("title", "untitled").strip()
            content = body.get("content", "").strip()
            is_private = bool(body.get("is_private", False))

            if not content:
                return self.send_error_json(400, "content required")

            date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            safe_title = re.sub(r"[^\w\-]", "-", title.lower())[:40].strip("-")
            privacy_suffix = "-private" if is_private else ""
            filename = f"{date_str}-{safe_title}{privacy_suffix}.md"

            # All ingests land in unprocessed/ first (gitignored — local queue)
            rel_path = f"ingestion/unprocessed/{filename}"

            # Build provenance header
            file_content = f"""# {title}

**Type:** {artifact_type}
**Date:** {date_str}
**Private:** {"yes" if is_private else "no"}
**Provenance:** [source/{artifact_type}s/{filename}]
**Status:** unprocessed

---

{content}

---

## Observations
<!-- Direct quotes, factual claims -->

## Interpretations
<!-- Agent or PM framing of above -->

## Hypotheses
<!-- Testable beliefs surfaced -->

## Assumptions
<!-- Implicit claims worth flagging -->
"""
            err = write_file(rel_path, file_content)
            if err:
                return self.send_error_json(400, err)

            # Immutable source copy — skipped for private files
            source_rel = None
            if not is_private:
                source_rel = f"source/{artifact_type}s/{filename}"
                write_file(source_rel, f"# SOURCE (immutable)\n\n{content}\n")

            self.send_json(200, {
                "ok": True,
                "path": rel_path,
                "source": source_rel,
                "private": is_private
            })

        elif path == "/requirements/from-genesis":
            body = self.read_body()
            if not body:
                return self.send_error_json(400, "Invalid JSON")

            title         = body.get("title", "").strip()
            artifact_path = body.get("artifact_path", "").strip()
            if not title or not artifact_path:
                return self.send_error_json(400, "title and artifact_path required")

            artifact_content, err = read_file(artifact_path)
            if err:
                return self.send_error_json(404, err)

            meta          = parse_frontmatter(artifact_content)
            artifact_type = meta.get("type", "unknown").lower()

            SUPPORTED = {"formatted", "unordered", "dictation"}
            TYPE_LABELS = {
                "formatted":   "Formatted or Ordered Text",
                "unordered":   "Unordered Text",
                "dictation":   "Dictation",
                "media":       "Media",
                "application": "Application Specific",
                "code":        "Code",
            }

            if artifact_type not in SUPPORTED:
                label = TYPE_LABELS.get(artifact_type, artifact_type.title())
                return self.send_json(200, {
                    "ok": False,
                    "unsupported": True,
                    "artifact_type": label,
                    "message": f"Requirement from {label} not yet available"
                })

            # Extract the raw body — content after the second "---" divider
            lines = artifact_content.splitlines()
            dash_count, genesis_start = 0, 0
            for i, line in enumerate(lines):
                if line.strip() == "---":
                    dash_count += 1
                    if dash_count == 2:
                        genesis_start = i + 1
                        break
            genesis_body = "\n".join(lines[genesis_start:]).strip()
            # Strip the trailing annotation sections (Observations etc.)
            for marker in ["## Observations", "## Interpretations", "## Hypotheses", "## Assumptions"]:
                if marker in genesis_body:
                    genesis_body = genesis_body[:genesis_body.index(marker)].strip()

            date_str   = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            safe_title = re.sub(r"[^\w\-]", "-", title.lower())[:40].strip("-")
            req_path   = f"requirements/{date_str}-{safe_title}.md"

            type_note = {
                "formatted": "Formatted / ordered text",
                "unordered": "Unordered text",
                "dictation": "Dictation → unordered text",
            }[artifact_type]

            req_content = f"""# {title}

**Status:** draft
**Priority:** must
**Created:** {date_str}
**Last updated:** {date_str}
**Source:** [{artifact_path}]({artifact_path})

---

## Genesis

> **Origin:** `{artifact_path}`
> **Artifact type:** {type_note}

{genesis_body}

---

## Problem Statement

<!-- Distill the Genesis above into one clear sentence. -->

---

## User Stories

<!-- As a [persona], I want to [action], so that [outcome]. -->

-

---

## Acceptance Criteria

<!-- Gherkin format: Given / When / Then -->

```
Given
When
Then
```

---

## Dependencies & Assumptions

| Item | Type | Notes |
|---|---|---|
| | dependency | |

---

## Open Questions

<!-- Blockers that must be resolved before this can be approved. -->

-
"""
            write_err = write_file(req_path, req_content)
            if write_err:
                return self.send_error_json(400, write_err)

            self.send_json(200, {
                "ok": True,
                "path": req_path,
                "artifact_type": artifact_type
            })

        elif path in ("/hypotheses/from-epiphany", "/rationalizations/from-gibberish"):
            body = self.read_body()
            if not body:
                return self.send_error_json(400, "Invalid JSON")

            title         = body.get("title", "").strip()
            artifact_path = body.get("artifact_path", "").strip()
            if not title or not artifact_path:
                return self.send_error_json(400, "title and artifact_path required")

            artifact_content, err = read_file(artifact_path)
            if err:
                return self.send_error_json(404, err)

            meta          = parse_frontmatter(artifact_content)
            artifact_type = meta.get("type", "unknown").lower()

            SUPPORTED = {"formatted", "unordered", "dictation"}
            TYPE_LABELS = {
                "formatted":   "Formatted or Ordered Text",
                "unordered":   "Unordered Text",
                "dictation":   "Dictation",
                "media":       "Media",
                "application": "Application Specific",
                "code":        "Code",
            }
            TYPE_NOTE = {
                "formatted": "Formatted / ordered text",
                "unordered": "Unordered text",
                "dictation": "Dictation → unordered text",
            }

            if artifact_type not in SUPPORTED:
                label    = TYPE_LABELS.get(artifact_type, artifact_type.title())
                lens_map = {
                    "/hypotheses/from-epiphany":       "Hypothesis",
                    "/rationalizations/from-gibberish":"Rationalization",
                }
                noun = lens_map[path]
                return self.send_json(200, {
                    "ok": False,
                    "unsupported": True,
                    "artifact_type": label,
                    "message": f"{noun} from {label} not yet available"
                })

            # Extract raw body — content after the second "---" divider
            lines = artifact_content.splitlines()
            dash_count, seed_start = 0, 0
            for i, line in enumerate(lines):
                if line.strip() == "---":
                    dash_count += 1
                    if dash_count == 2:
                        seed_start = i + 1
                        break
            seed_body = "\n".join(lines[seed_start:]).strip()
            for marker in ["## Observations", "## Interpretations", "## Hypotheses", "## Assumptions"]:
                if marker in seed_body:
                    seed_body = seed_body[:seed_body.index(marker)].strip()

            date_str   = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            safe_title = re.sub(r"[^\w\-]", "-", title.lower())[:40].strip("-")
            type_note  = TYPE_NOTE[artifact_type]

            if path == "/hypotheses/from-epiphany":
                out_path = f"hypotheses/{date_str}-{safe_title}.md"
                file_content = f"""# Hypothesis: {title}

**Status:** candidate
**Confidence:** 0.0
**Created:** {date_str}
**Last updated:** {date_str}
**Source:** [{artifact_path}]({artifact_path})

---

## Epiphany

> **Origin:** `{artifact_path}`
> **Artifact type:** {type_note}

{seed_body}

---

## The Belief

> In one sentence: what do we believe is true?

---

## Risk Areas

### Value
**Evidence for:**
**Evidence against:**
**Open questions:**

### Usability
**Evidence for:**
**Evidence against:**
**Open questions:**

### Feasibility
**Evidence for:**
**Evidence against:**
**Open questions:**

### Viability
**Evidence for:**
**Evidence against:**
**Open questions:**

---

## What Would Promote This

## What Would Demote This

## Evidence Log

| Date | Type | Summary | Provenance |
|---|---|---|---|
| | observation | | |
"""

            else:  # /rationalizations/from-gibberish
                out_path = f"rationalizations/{date_str}-{safe_title}.md"
                file_content = f"""# {title}

**Status:** draft
**Type:** {artifact_type}
**Created:** {date_str}
**Last updated:** {date_str}
**Source:** [{artifact_path}]({artifact_path})

---

## Gibberish

> **Origin:** `{artifact_path}`
> **Artifact type:** {type_note}

{seed_body}

---

## Context

<!-- What situation or constraint led to this decision or stance? -->

---

## Reasoning

<!-- The structured argument: why this made sense given what was known. -->

---

## Trade-offs Accepted

<!-- What was consciously given up or deferred? -->

---

## Constraints

<!-- Hard limits — technical, legal, org, or resource — that shaped this decision. -->

---

## Secondary Considerations

<!-- Adjacent factors, known risks, or open questions that did not block the decision but are worth tracking. -->

---

## Revisit Trigger

<!-- Under what conditions should this rationalization be challenged? -->
"""

            write_err = write_file(out_path, file_content)
            if write_err:
                return self.send_error_json(400, write_err)

            self.send_json(200, {
                "ok": True,
                "path": out_path,
                "artifact_type": artifact_type
            })

        elif path == "/adjudicate":
            # F24: ask the configured agent whether a pasted artifact meets
            # this lens's clarity bar, and record the answer.
            self.handle_adjudicate()

        elif path == "/interrogate":
            # F31: the agent asks the human what they actually want, BEFORE a
            # lens is chosen. The other half of the agent's job in Prism.
            self.handle_interrogate()

        elif path == "/verify":
            body = self.read_body()
            if not body or not (body.get("content") or "").strip():
                return self.send_error_json(400, "content required")
            shape_key = (body.get("shape") or "").strip()
            if shape_key not in VERIFY_SHAPES:
                return self.send_error_json(400, f"shape must be one of: {', '.join(sorted(VERIFY_SHAPES))}")
            self.send_json(200, verify_output(shape_key, body["content"]))

        elif path == "/classify":
            # F10: infer the artifact type from raw input. Deterministic
            # heuristics — classification is lens work, not the human's.
            body = self.read_body()
            if body is None:
                return self.send_error_json(400, "Invalid JSON")
            content = body.get("content", "") or ""
            filename = body.get("filename", "") or ""
            self.send_json(200, classify_artifact(content, filename))

        elif path == "/method":
            # LCM provenance: write the crafting method at the end of a
            # crafting session. Write-once — historical asset (fork 3).
            body = self.read_body()
            if body is None:
                return self.send_error_json(400, "Invalid JSON")
            code, resp = write_crafting_method(body)
            self.send_json(code, resp)

        elif path == "/method/status":
            # Fork 5: supersession/deprecation markers ("we will not
            # return here"). Content stays immutable.
            body = self.read_body()
            if body is None:
                return self.send_error_json(400, "Invalid JSON")
            code, resp = set_method_status(body)
            self.send_json(code, resp)

        elif path == "/agent-configs":
            # F22: which agent integrations exist, and which are callable now.
            # `has_key` reports whether the named env var is set WITHOUT ever
            # returning its value.
            self.send_json(200, {"ok": True, "agents": agentic.list_configs()})

        elif path == "/agent-invoke":
            self.handle_agent_invoke()

        elif path == "/prompt":
            # File a prepared prompt into vault/prompts/ (delivery channel 2:
            # filesystem handoff). See lenscraft/05-delivery-channels.md and
            # prism/vault/prompts/README.md.
            body = self.read_body()
            if not body or not (body.get("prompt") or "").strip():
                return self.send_error_json(400, "prompt required")

            prompt   = body["prompt"].strip()
            lens     = (body.get("lens") or "").strip()
            step     = (body.get("step") or "").strip()
            title    = (body.get("title") or "prompt").strip()

            date_str   = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            safe_title = re.sub(r"[^\w\-]", "-", title.lower())[:40].strip("-") or "prompt"
            filename   = f"{date_str}-{safe_title}.md"
            rel_path   = f"prompts/{filename}"
            # Never overwrite — append a counter if the name is taken
            n = 1
            while (DATA_ROOT / rel_path).exists():
                rel_path = f"prompts/{date_str}-{safe_title}-{n}.md"
                n += 1

            prompt_content = f"""**Lens:** {lens or "—"}
**Step:** {step or "—"}
**Status:** prepared
**Prepared:** {date_str}

---

{prompt}
"""
            err = write_file(rel_path, prompt_content)
            if err:
                return self.send_error_json(400, err)
            self.send_json(200, {"ok": True, "path": rel_path})

        elif path == "/emit":
            body = self.read_body()
            if not body:
                return self.send_error_json(400, "Invalid JSON")

            lens      = body.get("lens", "").strip()
            lens_path = body.get("path", "").strip()

            VALID_LENSES = {"hypotheses", "requirements", "rationalizations"}
            if lens not in VALID_LENSES:
                return self.send_error_json(400, f"lens must be one of: {', '.join(sorted(VALID_LENSES))}")
            if not lens_path:
                return self.send_error_json(400, "path required")

            content, err = read_file(lens_path)
            if err:
                return self.send_error_json(404, err)

            # Derive emission folder name from the lens filename (strip folder prefix)
            filename   = Path(lens_path).stem          # e.g. "2026-05-23-allow-pdf-export"
            date_str   = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            # Use the filename as-is if it starts with a date, otherwise prepend today
            if re.match(r"\d{4}-\d{2}-\d{2}", filename):
                emission_name = filename
            else:
                emission_name = f"{date_str}-{filename}"

            emission_dir = f"archive/{lens}/{emission_name}"
            dest_lens    = f"{emission_dir}/{Path(lens_path).name}"

            # Move lens file → archive
            move_err = move_file(lens_path, dest_lens)
            if move_err:
                return self.send_error_json(400, move_err)

            moved = [dest_lens]

            # Session sidecars travel with the lens into the emission so no
            # ghost paused-session entries survive an emit (F3).
            lens_abs = safe_path(lens_path)
            if lens_abs is not None:
                for suffix in ("-pause.md", "-chat.md", "-session.json"):
                    sidecar = lens_abs.with_name(lens_abs.stem + suffix)
                    if sidecar.exists():
                        rel_sidecar = f"{Path(lens_path).parent}/{sidecar.name}"
                        dest_sidecar = f"{emission_dir}/{sidecar.name}"
                        if not move_file(rel_sidecar, dest_sidecar):
                            moved.append(dest_sidecar)

            # Find and move the source artifact if it exists and is in the vault
            meta = parse_frontmatter(content)
            source_raw = meta.get("source", "")
            # Source field is markdown link format: [path](path) — extract path
            src_match = re.search(r"\(([^)]+)\)", source_raw)
            if src_match:
                source_path = src_match.group(1).strip()
            else:
                source_path = source_raw.strip()

            if source_path:
                src_abs = safe_path(source_path)
                if src_abs and src_abs.exists():
                    dest_src = f"{emission_dir}/{Path(source_path).name}"
                    mv_err = move_file(source_path, dest_src)
                    if not mv_err:
                        moved.append(dest_src)

            self.send_json(200, {
                "ok": True,
                "emission_path": emission_dir,
                "moved": moved
            })

        else:
            self.send_error_json(404, "Not found")

# ── Entry Point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if not DATA_ROOT.exists():
        print(f"ERROR: vault/ directory not found at {DATA_ROOT}")
        sys.exit(1)

    class ReusableServer(socketserver.ThreadingTCPServer):
        # Survive rapid restarts: don't fail bind on lingering TIME_WAIT
        allow_reuse_address = True

    server = ReusableServer(("127.0.0.1", PORT), PrismHandler)
    server.daemon_threads = True   # don't block shutdown on in-flight requests
    print(f"Prism API listening on http://127.0.0.1:{PORT} (threaded)")
    print(f"Vault root: {DATA_ROOT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
