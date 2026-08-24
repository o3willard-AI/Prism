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
    server = socketserver.ThreadingTCPServer(("127.0.0.1", PORT), PrismHandler)
    server.daemon_threads = True   # don't block shutdown on in-flight requests
    print(f"Prism API listening on http://127.0.0.1:{PORT} (threaded)")
    print(f"Vault root: {DATA_ROOT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
