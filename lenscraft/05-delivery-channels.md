# Delivery Channels — what "copy" actually means

*Session 1 UI dilemma, resolved at first principles: "Do we really want
copy, or do we want send-to / transfer-to / inject? Why isn't the
content moving forward more automatically?"*

---

## The dilemma

Prism's execution model is copy-prompt → external agent → paste-output.
Copy feels like friction — the light should flow forward, not be carried
by hand. But "send to" raises the question: send *where*, through
*what*, with *whose credentials*?

## First principles: three physical channels

For prepared light (a prompt) to be executed, it must enter **some
agent's context**. There are exactly three physical ways that can
happen — no others exist:

| # | Channel | Mechanism | Works with | Cost |
|---|---|---|---|---|
| 1 | **Human handoff** | clipboard → paste | Every agent that exists | Manual — but zero config, zero keys, zero coupling |
| 2 | **Filesystem handoff** | prompt written as a file; agent reads/references it | Any file-capable agent (CLI agents: Claude Code, Codex, Hermes, …) | Agent must read files and know where to look |
| 3 | **Direct injection** | API call to a configured service | Only configured services | Keys, config, cloud coupling — violates founding constraints unless explicitly optional |

**"Inject" decomposes into channel 2 or channel 3. There is no third
magic.** Every imagined "send to" resolves to one of these doors.

## The key realization

This is the **emission focal-point problem, mirrored**. Emission asks
where refined *output* lands (default: a text file on disk; everything
else modular and unbuilt). Delivery asks where prepared *prompts* go to
be executed. Same architecture, opposite direction:

- **Copy is focal point zero** — the universal default that always
  works with zero configuration. It is not a design failure; it is the
  one door that can never be bricked.
- **Prompt-as-file is focal point one** — and it is the most
  Prism-native answer, because the default emission focal point is
  *already* a file on disk. Prompts and emissions both become files:
  git-syncable, agent-readable, provable. The whole system unifies as
  *light-as-files*.
- **Direct injection is focal point two-plus** — optional, modular,
  user-configured, never baked in. This is the only way to honor
  "send to" without breaking no-cloud / no-baked-in-AI-API.

So the question was never "copy or send." It is: **which doors does
Prism expose, and when do they appear?** Copy is always open. File
lands alongside it as a first-class default. API doors appear only
when the human configures them — and never as dead buttons (F8,
GN-006 in UI form).

## The staging area

The prompt is a **draft, not a decree**. The UI must make editing
visibly permitted before forwarding:

- Prepared prompt renders in an **editable staging area**, labeled as
  such — "edit before forwarding; steering welcome."
- Below it, the **door row**: Copy · Save as file · Send-to-X (only
  if configured).
- The human's interaction with prepared light is *steering*, not
  authorship and not blind forwarding.

## The queued next step

After output is pasted back (and verified against the lens's expected
shape), the machine **immediately prepares the next step**: the next
prompt pre-assembled in the staging area, doors below it. The human is
never shown an empty "what now?" state. Their only job is a little
steering into one of the available doors.

**Design law candidate (GN-009): The machine prepares; the human
steers.** Every next action arrives pre-assembled and waiting; empty
states that make the human assemble the next move are friction against
the glass. (Pairs with GN-006 — no dead ends — and the UI audit's
closing law: keep the human inside their own thought.)

## Constraint check

- Channels 1–2 keep Prism fully local-first, stdlib, keyless — the
  founding constraints hold.
- Channel 3 exists only as an opt-in module; its presence never
  becomes a dependency.
- Nothing here requires Prism to *run* an agent. The lens-not-laser
  tenet survives intact: Prism prepares light; execution stays with
  the human's chosen agent, reached through whichever door they have.
