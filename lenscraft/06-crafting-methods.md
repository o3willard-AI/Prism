# Crafting Methods — LCM Provenance

*Settled design (24 Aug 2026), all five forks resolved with the human.
This document is the contract the lens-crafting machine builds against.*

---

## Vocabulary

- **Prism** — the product. Name is final.
- **LCM (Lens Crafting Machine)** — Prism's super-process: the dialogue
  by which Prism and a human co-create a new thought lens.
- **Thought lens** — a refraction chamber: a prompt-engineered lens that
  turns raw input into focused, agent-ready context. Origin-agnostic —
  the LCM is how NEW lenses get crafted, not what makes something a lens.
  The three original lenses (requirements, hypotheses, rationalizations)
  are thought lenses even though they predate the LCM. To people who
  haven't experienced Prism: a lens is essentially a *skill for humans*.
- **Prism Lexicon** — the library of ALL thought lenses: the three
  originals plus everything the LCM crafts. Physically: the lens
  workflows (`vault/workflows/<lens>-default/`) plus the skills they
  invoke (`vault/knowledge/resources/skills/`).
- **Crafting Method** — the complete conversation record of the process
  of crafting ONE given lens. The historical asset this document governs.

## Why methods exist (the two problems they solve)

1. **Learning from the past as it happened.** A lens that works well
   worked well for reasons visible in its crafting conversation — the
   questions asked, the refusals, the convergences. Without the record,
   that knowledge evaporates the moment the session ends.

2. **Agent/AI sprawl.** People will create nearly identical, overlapping
   lenses that perform the same function. Some will work objectively
   better than others; in other cases parts of some will beat parts of
   others. The crafting methods are the raw material for resolving this:
   run the methods themselves through further lensing / lens-crafting
   operations to rationalize them down to the single best lens for any
   given task. *The crafting experience of the whole, to create a
   singular instance of the best.*

## The five settled forks

1. **Location:** `vault/knowledge/resources/crafting-methods/`.
   Methods are corpus-level knowledge about how lenses get made — they
   live beside the skills and grind-notes they inform.

2. **Pointer:** every lens carries frontmatter metadata pointing to its
   method, in the same family as `Source:` and `Provenance:`:
   `**Crafting method:** [knowledge/resources/crafting-methods/x-method.md](…)`
   Lenses crafted before the LCM carry the honest mark
   `**Crafting method:** not recorded (pre-LCM)` — no synthesis, no
   fabricated history.

3. **Lifecycle:** the method is written at the END of the crafting
   session. It is a **historical asset, not a living document** —
   written once, content immutable thereafter. The API enforces this:
   a second write for the same lens returns 409.

4. **Emit behaviour:** option (b) — the method NEVER travels with the
   emission. As tempting as the "everything about one artifact travels
   together" symmetry is, the use case is learning from the past as it
   happened, and rationalizing sprawl needs ALL methods in one place —
   including methods of lenses long since emitted. The lens's pointer
   stays absolute (vault-relative) and resolves from the archive.

5. **Rationalization support:** methods carry genealogy-grade structure
   from day one (outcome, craft decisions, conversation record) so a
   future rationalization lens can compare them mechanically. Deprecation
   and supersession are marked in frontmatter — `Status: superseded`,
   `Deprecation marker: <date> — <rationale>` — with the meaning *"we
   will not return here."* The conversation content itself is never
   edited; the marker lives in the metadata.

## API surface

- `POST /method` — write a crafting method. Body: `{lens, conversation,
  lens_path?, crafted_by?, outcome?, decisions?}`. `conversation` may be
  a string or a message list. Write-once: existing method → 409. Attaches
  the pointer to `lens_path`'s frontmatter when the lens exists.
- `GET /methods` — list the library (name, path, lens, crafted, status).
- `GET /method?path=…` — read one method.
- `POST /method/status` — mark `superseded` / `deprecated` / `active`,
  with an optional marker rationale. Metadata only; content untouched.

## Method file shape

```markdown
# Crafting Method: <lens name>

**Lens:** [<lens path>](<lens path>)        <!-- or "not yet shelved" -->
**Crafted:** <date>
**Crafted by:** <agent/model or human>
**Status:** active                           <!-- active|superseded|deprecated -->

---

## Outcome
<!-- what this lens does — the single-best result it produced -->

## Conversation record
<!-- complete conversation log, verbatim; never edited -->

## Craft decisions
<!-- key decisions and their rationale — the rationalization feed -->
```

## Capture substrate

The F3 session sidecar (`-session.json`) already records messages,
prompts, and verdict cards for every workflow conversation. The LCM
grind flow — when it exists — reuses that substrate to assemble the
conversation record at session's end. Capture machinery is ready;
the crafting flow that produces methods is the next increment.

## Optics Library (25 Aug 2026 — design direction, settled in principle)

The Prism Lexicon's home may grow beyond this vault: an **Optics
Library**, backed by a pre-configured Git/GitHub repo. The two modes:

- **Loaded lenses** — present locally, usable and referenceable right
  now. What the Lexicon holds today.
- **Library lenses** — discoverable by searching the Optics Library
  repo; loading one pulls it into local use.

**Provenance travels:** the crafting method rolls in and rolls out side
by side with its lens. (This does NOT conflict with fork #4: emit-time
methods still stay in the central library — "rolls with the lens"
governs how a lens moves between vault and library, not what happens
at emission.) A loaded lens keeps its pointer resolvable: if the lens
and method arrive together, the pointer resolves locally; library
lenses carry their method so provenance survives the move.

Implementation is deferred — no repo plumbing exists yet. This section
is the settled contract the future work builds against.

## Explicit tenet amendment

"Prism doesn't store light" is amended, not violated: a crafting method
is light stored deliberately, exactly once, at craft time — because it
is the ore that makes future rationalization possible. The tenet still
prohibits storing per-use emissions; provenance of the glass itself is
kept.
