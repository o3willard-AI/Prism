# Prism

**Raw input, focused clarity.**

A physical prism does not store light. It receives the full spectrum —
scattered, mixed, unfocused — and refracts it into precise, identifiable
wavelengths that are emitted exactly where they are needed.

Prism does the same for human thought. It takes raw human communication —
dictation, brain dumps, meeting transcripts, half-formed intentions, chat
logs, and documents you already have — and refines it into **actionable,
reusable context optimized for agentic comprehension and extension**.

Prism is deliberately **not**:

- a place where thought is stored and forgotten
- a chat interface pretending to be a thinking partner
- a substitute for the judgment that a thinking partner actually provides

It is a **refraction tool**: humans bring scattered thought in; focused context
comes out, and an **agent works with you to produce it**.

## The agent is a required participant

**This is the load-bearing fact about Prism, and it used to be stated
backwards.** Prism's workflows are not deterministic, and no amount of
programming here makes them so. UX Bridge asks the PM one question at a time
and *something has to judge* whether an answer actually fills the field, and
whether 95% is reached. Prism can hold the state, prepare the prompt, and
verify the shape of what comes back — but it cannot know whether an answer is
any good. That judgment is the agent's, and it is not optional.

So the agent is **not a downstream consumer** of Prism's output. It is a
participant in producing it. Prism is the lens; the agent supplies the
judgment that makes refraction meaningful.

This is why Prism can stay honest about its own limits while integrating
directly: it never *becomes* the thinking partner. It prepares the work,
holds the state machine, and checks the artifact. The judgment stays with the
agent — integrated, and on the same terms as a pasted one.

## Getting light to the agent

Three channels, all real (see `lenscraft/05-delivery-channels.md`):

| Channel | Mechanism | When |
|---|---|---|
| **File it** | prompt written to `vault/prompts/`; the agent reads it | **The default** — no human carrying text |
| **Send to agent** | direct API call to a configured integration | When an integration is set up and has a key |
| **Copy** | clipboard → paste | Always available; the door that can never be bricked |

Filing is the default because copy-paste made the human the courier for every
prompt, and left `vault/prompts/` empty — the one path an agent can walk on
its own. The agent is required, so the door that hands it work without a
human carrying it should be the easiest to walk through.

**Keys never enter the vault.** An integration config records the *name* of an
environment variable, never its value — the folder is git-synced, so a literal
key written there would be committed. Every agent call is recorded in
`ingestion/agent-calls/` **before** the request is sent, so an interrupted
call is still on record.

---

## Architecture

```
prism/                  The app
├── api-server.py       Python stdlib HTTP backend, port 8082 (no deps)
├── index.html          SPA structure (markup only — 104 lines)
├── prism.css           All component styles
├── app.js              All logic (vanilla JS; node --check-able)
├── layout/ theme/      Separable structural + visual styling
├── vendor/             Third-party code, vendored + pinned (marked, MIT)
└── vault/              All data is plain Markdown — git-syncable
    ├── ingestion/      Raw input queue (unprocessed/ is local-only)
    ├── requirements/ hypotheses/ rationalizations/ decisions/ experiments/
    │                   "Thought Lenses" — refraction chambers
    ├── knowledge/      Refraction optics:
    │   └── resources/skills/   The prompt library (the core of Prism)
    ├── workflows/      Refraction sequences built from optics
    ├── archive/        Emitted wavelengths (historical record)
    └── source/         Immutable source copies
healthcheck/            Stack verification app (port 8081)
Caddyfile               Reverse-proxy + static serving config
scripts/                Start/stop + Caddy download
```

**Stack:** one Caddy binary (reverse proxy + static server) + two Python
stdlib backends + vanilla JS. No npm, no frameworks, no external AI APIs,
no cloud dependency.

The one third-party library, `marked` (markdown rendering), is **vendored
and pinned** at `prism/vendor/marked.min.js` — so Prism runs fully offline
and the version cannot drift under you. See `prism/vendor/README.md` for
provenance, the recorded sha256, and the upgrade procedure.

## Security posture

The API binds `127.0.0.1` and is always served **same-origin** behind the
front door, so it sends no CORS headers at all. Requests that carry an
`Origin` header must match the host they were sent to; a request with no
`Origin` (curl, scripts, the e2e harnesses) is treated as a local tool and
allowed. This closes cross-origin writes to the vault — including
`knowledge/resources/skills/`, which is prompt text the user's own agent
later executes.

Both shipped front doors must **preserve Host** (Caddy does by default;
`server/apache-prism.conf` sets `ProxyPreserveHost On`). If a front door is
configured not to, the guard fails closed and the app stops working rather
than widening access — an app you can fix, versus a vault any local page can
write.

Verified by `scripts/e2e-verify-f12.js`.

**Markdown rendering is hardened.** marked does not sanitize by default, so
`app.js` routes both render paths through `renderMarkdown()`, which drops raw
HTML and restricts link schemes to http(s) and same-origin-relative forms.
Any other scheme renders as inert, visibly-blocked text. No sanitizer
dependency. Verified by `scripts/e2e-verify-f16.js`, which also holds the
render baseline for all 49 vault files.

## The optics

`vault/knowledge/resources/skills/` contains the refraction prompts —
the real core of Prism. Each skill takes raw input of a given shape and
emits structured, agent-consumable context with confidence gates
(95–97%: either ask clarifying questions or produce output; never
produce partial output). Surfacing unresolved gaps is a first-class
feature: an agent that receives "here's what is unresolved and why it
matters" can extend the thought instead of hallucinating.

A workflow is a *definition* in `vault/workflows/`; a workflow is
*runnable* only when `app.js` has a runner for it. The Workflows view labels
each definition **▶ runnable** or **⚠️ defined, not yet runnable**, read from
the single `_WF_RUNNERS` registry — so a definition cannot look like a
working door. All four workflows in the vault now have runners; adding one is
a single line in that registry, and the badge clears itself.

The four runners differ in shape. Requirements, Hypotheses and
Rationalizations are ladders — ingest, refract, verify, emit. **UX Bridge is
a loop**: it interviews the PM one question at a time until all 11 mandatory
UX fields are validated (≥95%), carrying every prior answer forward so the
interview never restarts. Its finished spec lands in `vault/requirements/` at
status **`ux-ready`**.

## The one door

The **Crafting Table** is the only entry point. Paste or drop raw thought,
pick a lens, and Prism refacts it and opens the workflow — one click, no
wizard. The sidebar's other views are for *working* on lenses that already
exist: open one, continue its workflow, emit it, delete it.

Two doors on the desk, because "what do you want to do with this" is the
only real question:

- **a lens** — refract now
- **📥 Not yet** — stage it in `ingestion/unprocessed/` (local, never
  synced) and refract later. The desk lists that queue with Load and Discard
  per item, so staged thought is never stranded.

`vault/knowledge/integrations/` is the declared extension point for
capabilities that do not exist yet — primarily emission targets, open to
inputs as well. It ships empty on purpose, which is why there is no "emit to
integration" option today: a door appears when something can open it.

## Ingesting documents

The Crafting Table accepts external documents as well as typed text:
**DOCX, XLSX, PPTX, HTML, RTF and PDF**, alongside Markdown, text, CSV and
JSON. A file whose extension is wrong is sniffed by magic bytes, so a `.docx`
renamed to `.dat` still reads.

Extraction is **Python standard library only** — no pip install, no build
step. DOCX and friends are unzipped and parsed as XML; HTML goes through
`html.parser`; RTF is a small scanner; PDF is best-effort.

**When Prism cannot read a document, it says so and refuses** rather than
guessing. This is deliberate. A scanned PDF yields no text, and a
font-subset PDF yields bytes that decode to noise — returning either would
put garbage in the vault looking exactly like something a person wrote, and a
lens would later refract it as though it were human thought. The refusal names
the reason and says what to do instead ("this is a scan; select the text and
paste it in"). Prism does not do OCR, and will not pretend otherwise.

Two limits, both of which refuse rather than truncate: 32 MB on the wire, and
2 MB of extracted text. A truncated document that looks complete is worse than
no document.

Reading a document and filing it are two different acts. Dropping a document
on the Crafting Table stages it in `ingestion/unprocessed/`; attaching one to
a chat message extracts its text without creating a file, because reading
something should not quietly add an artifact you did not ask for.

| Optic | Refracts | Into |
|---|---|---|
| intent-synth | single-speaker dictation / brain dump | 5 Intention Blocks |
| conv-synth | multi-person transcripts | 5 Actionable Blocks |
| doc-synth | any raw/multi-asset input | 5 Synthesis Blocks |
| clarification-gate | formatted or synthesized input | lens-appropriate structured document |
| prd-gate | formatted requirement input | developer-ready PRD |
| ux-bridge | PM feature request | UX Hand-off Specification (≥95% of 11 fields) |
| diagram-asset-generator | any structured output | Draw.io / Mermaid diagram |
| reorder-and-list-in-context | any text | coherent reusable reference form |

## Emission

A prism emits light; it does not store it. Prism stores as little as
possible. The built-in focal point for a refined artifact is a **plain
text file on the filesystem**. Every other focal point (ticketing
systems, docs, external agents) is intended to be fully modular and is
not yet built — see `vault/knowledge/integrations/` for the stubs.

---

## Running

```bash
# one-time: get the Caddy binary (Linux)
scripts/fetch-caddy.sh

# start the full stack
scripts/start.sh        # Caddy :8080, healthcheck :8081, Prism :8082

# open the app
#   http://localhost:8080/prism/
#   http://localhost:8080/healthcheck/

scripts/stop.sh
```

Requires only Python 3.10+ and curl. No pip installs.

## Web-server portability

Prism must run — and be proven to run — behind Caddy **and** at least
one other lightweight local web service. Caddy is the reference server
(the whole stack uses it); the second server proves nothing in Prism
depends on Caddy-specific behaviour. Proven combinations:

| Server | Front door | API proxying |
|---|---|---|
| Caddy (reference) | `http://localhost:8080/prism/` | `handle /prism/api/*` → :8082 |
| Apache 2.4 | `http://localhost/prism/` | `ProxyPass /prism/api/` → :8082 |

The Apache vhost lives in `server/apache-prism.conf` (Alias +
mod_proxy_http; a one-time `setfacl u:www-data:x` on the home directory
lets Apache traverse to the workspace). The Python backends are
identical in both setups — only the front-door config differs.

## Status

This repository is a refactored early proof of concept. The PM-toolkit-era
scope (five Thought Lenses, dashboards, dwell-time metrics, emission
integrations) is being narrowed to the core mission: **refining human
communication into agentic context**. See the project history in commits.

## License

MIT — see LICENSE.

---

## Tests

```
scripts/e2e-verify*.js          node   the regression suites
scripts/e2e-verify-f19.js       node   the SPA in a REAL browser (Chrome, no npm)
```

The other suites run `app.js` in a Node VM with a stubbed DOM. F19 drives the
real page in real Chrome over the DevTools Protocol, because a stub cannot
tell you whether the page *renders* — and that is where two shipped bugs hid
(a `0` badge shown as a dash, and a tooltip truncated by a newline inside an
HTML attribute).

F19 needs a browser and exits **3** if it cannot find one, so "no Chrome" is
never mistaken for "checks failed". It uses the Playwright-cached Chrome for
Testing binary, or any Chrome via `PRISM_CHROME`:

```
npx playwright install chromium      # if you have no Chrome
```

It also needs the stack running and a front door that **preserves `Host`** (see
Security posture above).
