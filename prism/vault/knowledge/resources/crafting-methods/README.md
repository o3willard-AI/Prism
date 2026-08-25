# Crafting Methods

Complete conversation records of crafting each thought lens — the LCM's
provenance. Historical assets, not living documents: written once at the
end of the crafting session, never edited afterwards.

Design contract: `lenscraft/06-crafting-methods.md` (all five forks
settled 24 Aug 2026).

Conventions:

- One file per lens: `<lens-slug>-method.md`.
- Shape: frontmatter (`Lens`, `Crafted`, `Crafted by`, `Status`) +
  Outcome + Conversation record + Craft decisions.
- `Status`: `active` | `superseded` | `deprecated`. Supersession means
  *"we will not return here"* and is marked with a dated
  `**Deprecation marker:**` line — the conversation content itself is
  never touched.
- Every lens points here via its `**Crafting method:**` frontmatter.
  Lenses crafted before the LCM carry `not recorded (pre-LCM)`.
- Methods never move — not on emit, not on emit-archive. Rationalizing
  lens sprawl needs all of them in one place; the use case is learning
  from the past as it happened.
