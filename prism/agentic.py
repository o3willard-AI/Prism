"""Agent integrations — configuration, and the rule that keeps keys out of git.

F22 reverses a founding constraint. Prism previously refused to call a model
at all ("the lens, not the laser"). That was the right call while emission was
only a text file: Prism prepared a prompt, a human pasted it somewhere, and
Prism never needed to know what that somewhere was.

It is the wrong call now, for a reason worth stating plainly. **Prism's
workflows are not deterministic and cannot be made so.** UX Bridge asks the PM
one question at a time and only an agent can judge whether an answer actually
fills the field, or whether 95% is reached. No amount of programming here
produces a sufficient output without an agent in the loop. So the agent is a
REQUIRED PARTICIPANT, not a downstream consumer, and treating integration as
out of scope meant the most important dependency in the system was the one
thing documented as forbidden.

What does NOT change: **secrets never enter the vault.** An integration
config records the NAME of an environment variable, never its value. The
folder is git-synced, so a value written here would be committed. This module
therefore resolves a key from the process environment at call time and
refuses to write one.

Transport note: the outbound call is deliberately narrow. It targets one
configured endpoint with one configured key, from a local single-user server,
and every invocation is recorded to the vault. There is no plugin discovery, no
arbitrary URL from the client, and no key material in any file Prism writes.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path

# Where integration configs live. Matches integrations/agentic/README.md.
AGENT_DIR = "knowledge/integrations/agentic"

# A config's status. "active" is the only one that may be invoked — a draft
# or archived integration exists as a record and must not be called by accident.
_STATUSES = {"active", "draft", "archived"}

# Bound on how long an agent call may take. Without this a hung upstream would
# wedge the single-threaded API server, which serves the whole UI.
CALL_TIMEOUT = 180

# Bound on the response we will read back. An agent that streams a novel back
# should not be able to exhaust memory here.
MAX_RESPONSE = 8 * 1024 * 1024

# Only these field names may appear in a config. Anything else is rejected
# rather than ignored, so a stray "api_key: sk-..." cannot be persisted by
# accident through an unrecognised key.
_ALLOWED_FIELDS = {
    "title", "category", "owner", "status", "last_updated", "description",
    "kind", "endpoint", "model", "auth_env", "auth_header", "auth_prefix",
    "lenses", "system_prompt", "notes",
}

# Names that must never be written to a config, however they arrive.
_FORBIDDEN_FIELDS = re.compile(
    r"(api[_-]?key|secret|token|password|credential|bearer)", re.I
)

# An env var NAME is the only credential reference we permit.
_ENV_NAME = re.compile(r"^[A-Z][A-Z0-9_]{1,63}$")


class AgentConfigError(Exception):
    """Configuration is invalid. The message is shown to the human."""


def _parse_frontmatter(text: str) -> tuple[dict, str]:
    """Split a config into (frontmatter, body).

    The vault's convention is a run of `**Key:** value` lines near the top.
    Two details matter and both were wrong in the first version:

    1. There is usually NO opening `---` fence. The H1 comes first, the
       metadata follows, and the first `---` begins the body. Requiring a
       leading fence (the YAML habit) makes every real config parse as having
       NO fields at all — a spectacularly quiet failure, because the config
       loads, reports empty, and the call later refuses with "no endpoint".
    2. Key names are written with spaces in this vault (`**Auth env:**`), not
       underscores. Normalising to underscores is what lets one field be
       matched regardless of which style an author used.
    """
    meta: dict = {}
    lines = text.splitlines()
    body_lines: list[str] = []

    i = 0
    # Skip blank lines and the H1 / any comment lines.
    while i < len(lines) and (not lines[i].strip() or lines[i].startswith("#")):
        i += 1

    # An explicit opening fence is optional; consume it if present.
    if i < len(lines) and lines[i].strip() == "---":
        i += 1

    # Collect consecutive **Key:** lines. One blank line between them is
    # tolerated, because authors group related fields with spacing.
    found_any = False
    blanks = 0
    while i < len(lines):
        line = lines[i].strip()
        if line == "---":
            i += 1
            break
        m = re.match(r"^\*\*([^*]+):\*\*\s*(.*)$", line)
        if m:
            key = m.group(1).strip().lower().replace(" ", "_").replace("-", "_")
            meta[key] = m.group(2).strip()
            found_any = True
            blanks = 0
            i += 1
            continue
        if not line:
            # Only a spacer if metadata continues right after.
            blanks += 1
            if i + 1 < len(lines) and re.match(
                r"^\*\*[^*]+:\*\*", lines[i + 1].strip()
            ):
                i += 1
                continue
            break
        break

    if found_any:
        body_lines = lines[i:]
        while body_lines and not body_lines[0].strip():
            body_lines.pop(0)
        # A fence is a separator, not content. When a config has no opening
        # fence the closing one is still the first line we stopped at, so it
        # is sitting at body_lines[0] — drop it either way.
        if body_lines and body_lines[0].strip() == "---":
            body_lines.pop(0)
            while body_lines and not body_lines[0].strip():
                body_lines.pop(0)
        return meta, "\n".join(body_lines).strip()

    # No metadata at all: the whole document is the body.
    return meta, text.strip()


def load_config(rel_path: str) -> dict:
    """Read and validate one integration config. Raises AgentConfigError."""
    if not rel_path.startswith(AGENT_DIR + "/"):
        raise AgentConfigError(f"Agent configs live in {AGENT_DIR}/.")
    if not rel_path.endswith(".md"):
        raise AgentConfigError("Agent configs are Markdown files.")

    p = Path(__file__).parent / "vault" / rel_path
    if not p.exists():
        raise AgentConfigError(f"No agent config at {rel_path}.")

    text = p.read_text(encoding="utf-8")
    meta, body = _parse_frontmatter(text)

    unknown = [k for k in meta if k not in _ALLOWED_FIELDS]
    if unknown:
        # Loud, because an unrecognised field is how a secret would get in.
        raise AgentConfigError(
            f"{rel_path} has unknown field(s): {', '.join(sorted(unknown))}. "
            "Secrets are never stored in the vault — reference an environment "
            "variable name in auth_env instead."
        )
    forbidden = [k for k in meta if _FORBIDDEN_FIELDS.search(k)]
    if forbidden:
        raise AgentConfigError(
            f"{rel_path} must not contain {', '.join(sorted(forbidden))}. "
            "Store the value in an environment variable and name it in auth_env."
        )

    if meta.get("status", "draft").lower() not in _STATUSES:
        raise AgentConfigError(
            f"{rel_path}: status must be one of {', '.join(sorted(_STATUSES))}."
        )

    endpoint = meta.get("endpoint", "").strip()
    if endpoint:
        if not endpoint.startswith("https://"):
            # Plain http would put the API key on the wire in the clear.
            raise AgentConfigError(
                f"{rel_path}: endpoint must be https — an http endpoint would "
                "send your key in the clear."
            )

    auth_env = meta.get("auth_env", "").strip()
    if auth_env and not _ENV_NAME.match(auth_env):
        raise AgentConfigError(
            f"{rel_path}: auth_env must be an environment VARIABLE NAME like "
            "ANTHROPIC_API_KEY — never the key itself."
        )

    return {
        "path": rel_path,
        "name": p.stem,
        "title": meta.get("title", p.stem),
        "description": meta.get("description", ""),
        "status": meta.get("status", "draft").lower(),
        "kind": meta.get("kind", "chat"),
        "endpoint": endpoint,
        "model": meta.get("model", ""),
        "auth_env": auth_env,
        "auth_header": meta.get("auth_header", "Authorization"),
        "auth_prefix": meta.get("auth_prefix", "Bearer "),
        "lenses": [s.strip() for s in (meta.get("lenses", "") or "").split(",") if s.strip()],
        "system_prompt": meta.get("system_prompt", ""),
        "body": body,
        # Reported, never persisted.
        "has_key": bool(auth_env) and bool(os.environ.get(auth_env)),
        "key_env": auth_env,
    }


def list_configs() -> list[dict]:
    """Every readable config, with its validation state. Invalid ones are
    reported, not hidden — a config that cannot load is a thing to fix."""
    base = Path(__file__).parent / "vault" / AGENT_DIR
    out: list[dict] = []
    if not base.exists():
        return out
    for p in sorted(base.glob("*.md")):
        rel = f"{AGENT_DIR}/{p.name}"
        if p.name.lower() == "readme.md":
            continue
        try:
            cfg = load_config(rel)
            out.append({
                "path": rel, "name": cfg["name"], "title": cfg["title"],
                "description": cfg["description"], "status": cfg["status"],
                "kind": cfg["kind"], "model": cfg["model"],
                "lenses": cfg["lenses"], "configured": True,
                "has_key": cfg["has_key"], "key_env": cfg["key_env"],
                "error": None,
            })
        except AgentConfigError as exc:
            out.append({
                "path": rel, "name": p.stem, "title": p.stem,
                "description": "", "status": "invalid", "kind": "",
                "model": "", "lenses": [], "configured": False,
                "has_key": False, "key_env": "",
                "error": str(exc),
            })
    return out


def _build_payload(cfg: dict, prompt: str) -> dict:
    """The request body. One shape per supported agent protocol."""
    kind = (cfg.get("kind") or "chat").lower()
    system = cfg.get("system_prompt") or ""
    model = cfg.get("model") or ""

    if kind in ("anthropic", "messages"):
        # Anthropic Messages API. `system` is a TOP-LEVEL field, not a message
        # block — putting it in the messages array is a 400.
        payload = {
            "model": model,
            "max_tokens": 4096,
            "messages": [{"role": "user", "content": prompt}],
        }
        if system:
            payload["system"] = system
        return payload

    if kind in ("openai", "chat", "completions"):
        # OpenAI-compatible chat completions — the most portable shape.
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        return {"model": model, "messages": messages}

    raise AgentConfigError(
        f"Unknown integration kind {kind!r}. Use 'anthropic', or 'openai' for "
        "anything OpenAI-compatible."
    )


def _parse_response(kind: str, data: dict) -> str:
    """Pull the assistant's text out of whichever protocol came back."""
    # Anthropic
    if "content" in data and isinstance(data["content"], list):
        parts = [b.get("text", "") for b in data["content"] if isinstance(b, dict)]
        out = "".join(parts).strip()
        if out:
            return out
    # OpenAI-compatible
    choices = data.get("choices")
    if isinstance(choices, list) and choices:
        msg = choices[0].get("message") or {}
        content = msg.get("content")
        if isinstance(content, str) and content.strip():
            return content.strip()
        # Some gateways return a plain string.
        text = choices[0].get("text")
        if isinstance(text, str) and text.strip():
            return text.strip()
    raise AgentConfigError(
        "The agent replied in a shape Prism did not recognise. Check the "
        "integration's endpoint and kind."
    )


def invoke(cfg: dict, prompt: str) -> dict:
    """Call the configured agent. Returns {text, model, elapsed_ms, request_id}.

    Fails loudly and specifically. Every failure mode here is something the
    human can act on — a missing key, a wrong endpoint, a refusal — so none
    of them are collapsed into a generic error.
    """
    if not cfg.get("endpoint"):
        raise AgentConfigError(
            f"{cfg['path']} has no endpoint, so there is nowhere to send the prompt."
        )
    if cfg.get("status") != "active":
        raise AgentConfigError(
            f"{cfg['path']} has status {cfg.get('status')!r}. Only an active "
            "integration can be invoked."
        )

    auth_env = cfg.get("auth_env") or ""
    key = os.environ.get(auth_env, "") if auth_env else ""
    if auth_env and not key:
        raise AgentConfigError(
            f"No API key found. Set the {auth_env} environment variable and "
            "restart Prism — the key is read at call time and is never stored "
            "in the vault."
        )

    payload = _build_payload(cfg, prompt)
    body = json.dumps(payload).encode("utf-8")

    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if key:
        header = cfg.get("auth_header") or "Authorization"
        prefix = cfg.get("auth_prefix")
        headers[header] = f"{prefix}{key}" if prefix else key
    # The anthropic-version header is required by that API. Gate it on the
    # declared KIND, not on the endpoint containing "anthropic" — keying it on
    # the host means a proxy, a self-hosted compatible server, or a test
    # fixture silently omits a header the API demands, and the failure is a
    # confusing 400 rather than anything local.
    if (cfg.get("kind") or "").lower() in ("anthropic", "messages"):
        headers.setdefault("anthropic-version", "2023-06-01")

    req = urllib.request.Request(
        cfg["endpoint"], data=body, headers=headers, method="POST"
    )

    import time
    started = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=CALL_TIMEOUT) as resp:
            raw = resp.read(MAX_RESPONSE)
            status = resp.status
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = exc.read(2048).decode("utf-8", "replace")
        except Exception:
            pass
        raise AgentConfigError(
            f"The agent service rejected the call (HTTP {exc.code}). "
            + (detail[:300] if detail else "")
        )
    except urllib.error.URLError as exc:
        raise AgentConfigError(
            f"Could not reach the agent service ({exc.reason}). Check the "
            "endpoint and your network."
        )
    except TimeoutError:
        raise AgentConfigError(
            f"The agent did not reply within {CALL_TIMEOUT} seconds."
        )

    elapsed = int((time.monotonic() - started) * 1000)
    try:
        data = json.loads(raw.decode("utf-8", "replace"))
    except (ValueError, UnicodeDecodeError):
        raise AgentConfigError(
            "The agent service replied with something that is not JSON. Check "
            "that the endpoint is the API URL and not a web page."
        )
    if not isinstance(data, dict):
        raise AgentConfigError("The agent reply was not a JSON object.")

    text = _parse_response((cfg.get("kind") or "").lower(), data)
    return {
        "text": text,
        "model": data.get("model") or cfg.get("model", ""),
        "elapsed_ms": elapsed,
        "request_id": data.get("id", ""),
        "usage": data.get("usage") or {},
        "http_status": status,
    }
