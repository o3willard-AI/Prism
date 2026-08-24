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
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote

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

HYPOTHESIS_STATUSES = ["candidate", "proposed", "validated", "demoted", "archived"]


# ── Helpers ──────────────────────────────────────────────────────────────────

def safe_path(rel: str) -> Path | None:
    """Resolve a relative path inside DATA_ROOT. Returns None if escape attempt."""
    try:
        resolved = (DATA_ROOT / rel).resolve()
        resolved.relative_to(DATA_ROOT.resolve())
        return resolved
    except (ValueError, Exception):
        return None


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


def get_status() -> dict:
    """Aggregate Prism status stats."""
    status = {
        "hypothesis_counts":   {s: 0 for s in HYPOTHESIS_STATUSES},
        "requirement_counts":  {"draft": 0, "review": 0, "approved": 0, "deprecated": 0},
        "rationalization_counts": {"draft": 0, "review": 0, "approved": 0, "deprecated": 0},
        "stakeholder_count": 0,
        "ingestion_count": 0,
        "days_since_sweep": None,
    }

    def count_by_status(folder: Path, count_dict: dict, default: str):
        if folder.exists():
            for f in folder.glob("*.md"):
                if f.name.startswith("_"):
                    continue
                meta = parse_frontmatter(f.read_text(encoding="utf-8"))
                s = meta.get("status", default)
                if s in count_dict:
                    count_dict[s] += 1

    count_by_status(DATA_ROOT / "hypotheses",   status["hypothesis_counts"],  "candidate")
    count_by_status(DATA_ROOT / "requirements",    status["requirement_counts"],    "draft")
    count_by_status(DATA_ROOT / "rationalizations",status["rationalization_counts"], "draft")

    # Dwell time: days each lens item has been un-emitted, bucketed in 2-day increments
    # Bucket index = min(days // 2, 15); bucket 15 = "30+ days"
    DWELL_LENSES = ["requirements", "hypotheses", "rationalizations"]
    today = datetime.now().date()
    dwell = {}
    for lens in DWELL_LENSES:
        folder = DATA_ROOT / lens
        counts = [0] * 16
        if folder.exists():
            for f in folder.glob("*.md"):
                if f.name.startswith("_"):
                    continue
                meta = parse_frontmatter(f.read_text(encoding="utf-8"))
                created_str = meta.get("created") or meta.get("date", "")
                if created_str:
                    try:
                        created = datetime.strptime(created_str[:10], "%Y-%m-%d").date()
                        days = (today - created).days
                        counts[min(max(days, 0) // 2, 15)] += 1
                    except ValueError:
                        pass
        dwell[lens] = counts
    status["dwell"] = dwell

    # Stakeholders
    stk_dir = DATA_ROOT / "stakeholders"
    if stk_dir.exists():
        status["stakeholder_count"] = sum(
            1 for f in stk_dir.glob("*.md") if not f.name.startswith("_")
        )

    # Ingestion count
    ing_dir = DATA_ROOT / "ingestion"
    if ing_dir.exists():
        status["ingestion_count"] = sum(
            1 for f in ing_dir.rglob("*.md") if not f.name.startswith("_")
        )

    # Days since last sweep
    log_dir = DATA_ROOT / "maintenance" / "log"
    if log_dir.exists():
        logs = sorted(log_dir.glob("*.md"), reverse=True)
        if logs:
            m = re.search(r"(\d{4}-\d{2}-\d{2})", logs[0].name)
            if m:
                try:
                    sweep_date = datetime.strptime(m.group(1), "%Y-%m-%d")
                    status["days_since_sweep"] = (datetime.now() - sweep_date).days
                except ValueError:
                    pass

    return status


# ── Request Handler ───────────────────────────────────────────────────────────

class PrismHandler(http.server.BaseHTTPRequestHandler):
    # HTTP/1.1 keeps connections alive — prevents Caddy's pool from using stale
    # HTTP/1.0 connections and causing ~2-minute timeout hangs on page load.
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        print(f"  {self.address_string()} {fmt % args}")

    def send_json(self, code: int, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, code: int, msg: str):
        self.send_json(code, {"error": msg})

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_DELETE(self):
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

        if path == "/status":
            self.send_json(200, get_status())

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
                 "type": "dir" if f.is_dir() else "file"}
                for f in sorted(p.iterdir(), key=lambda e: (e.is_file(), e.name.lower()))
                if f.is_dir() or f.suffix == ".md"
            ]
            self.send_json(200, files)

        elif path == "/lenses":
            self.send_json(200, list_lenses())

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

        elif path == "/verify":
            body = self.read_body()
            if not body or not (body.get("content") or "").strip():
                return self.send_error_json(400, "content required")
            shape_key = (body.get("shape") or "").strip()
            if shape_key not in VERIFY_SHAPES:
                return self.send_error_json(400, f"shape must be one of: {', '.join(sorted(VERIFY_SHAPES))}")
            self.send_json(200, verify_output(shape_key, body["content"]))

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
