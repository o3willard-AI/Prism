# Third-party vendored code

Files in this directory are vendored, unmodified, third-party source. They
are committed here so Prism stays fully local: no CDN, no network fetch, no
build step, no npm.

## marked.min.js

- **What:** markdown parser, used to render vault files in the Knowledge Base
  and Crafting Method viewers (`prism/app.js` — `marked.parse`).
- **Version:** 15.0.12
- **License:** MIT — see `marked.LICENSE.md`
- **Upstream:** https://github.com/markedjs/marked
- **Source:** npm registry tarball `marked-15.0.12.tgz`, file `package/marked.min.js`
- **sha256:** `3e7e7d7feb3e5d58cb6c804f68ab5c24cc7e5eb6270fd6e5cbb9124739217d0c`

The file is byte-identical to the copy in the official npm tarball. The
sha256 was cross-checked against two independent sources: the jsDelivr CDN
and the registry tarball.

### Why vendored, and why pinned

Prism previously loaded this from `https://cdn.jsdelivr.net/npm/marked/marked.min.js`
— **unpinned**, so the version silently drifted (it served 15.0.12 while
`latest` was 18.0.14), and the README claimed "no cloud dependency" while
the app needed the network to render markdown at all.

Vendoring fixes both: the version is fixed and auditable, the app works
offline, and "copy the directory, it runs" (the F11 definition of
self-contained) stays true.

### Upgrading

1. Download the new version's tarball from the npm registry.
2. Replace `marked.min.js` and `marked.LICENSE.md`.
3. Update the version, source and sha256 lines above.
4. Run the regression suites — `scripts/e2e-verify-f13.js` renders real vault
   markdown through the vendored copy and fails if the output changes shape.

### Sanitization is handled by the app, not by marked

marked v15 does **not** sanitize: raw HTML in a markdown file is passed
through, and `javascript:` URLs are not filtered. Prism does not rely on
marked for that — `prism/app.js` defines `renderMarkdown()`, which applies a
two-rule renderer override before output ever reaches `innerHTML`:

- raw HTML tokens are dropped
- link schemes are restricted to `http(s)`, protocol-relative, and
  site-relative (`/`, `#`, `?`); anything else renders as inert,
  visibly-blocked text

This is deliberately not a sanitizer dependency — that would reopen the
"one vendored library" position. `scripts/e2e-verify-f16.js` asserts the
hardening is present and that all 49 vault files render byte-identically to
stock marked, so the override cannot silently break real content.

**If you upgrade marked, run that suite first.** A renderer-API change is the
most likely way an upgrade could break this.
