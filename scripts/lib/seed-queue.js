// Shared corpus seeding for the queue suites (F29 / F29b).
//
// Why this file exists. `prism/vault/ingestion/unprocessed/` is gitignored and
// ships with ZERO committed files, so on a fresh clone the queue holds ~0 items.
// F29 and F29b nevertheless asserted pagination properties against a large
// backlog — "the default page shows 20 rows", "epiphany matches >30", "the
// last page holds the remainder". Those only passed on one developer's box,
// where a suite leak had accumulated hundreds of files. A green that only
// reproduces in one place is a false green, and Prism has no CI, so the suite
// IS the certification.
//
// Both suites now seed their own corpus and remove it in `finally`, so the
// assertions describe the SEEDED state rather than whatever happened to be on
// disk. 45 files is deliberate: more than 40 so "page 2 exists" is true and
// "page size 40 shows 40" has something to show, and a remainder of 5 on the
// last page so the last-page assertion has a non-zero tail.
//
// Each seeded file carries a run-unique probe word. A content filter must then
// match exactly the seeded set — which also proves the filter is reading
// content rather than coincidentally matching filenames.
const fs = require('node:fs');
const path = require('node:path');

const { ROOT } = require('./env.js');

const QUEUE_DIR = path.join(ROOT, 'prism', 'vault', 'ingestion', 'unprocessed');

/** Enough that page 2 exists, page size 40 fills, and the last page has a tail. */
const SEED_COUNT = 45;

// FNV-1a, so the probe word differs per run and per suite without needing a
// random source that could collide with the probe of a previous run.
function probeWord(label) {
  let h = 0x811c9dc5;
  const s = `${label}:${process.pid}:${Date.now()}:${Math.random()}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // base36 keeps it lowercase and filename-safe; the prefix makes it greppable.
  return `zzprobe${h.toString(36)}`;
}

/** The body a seeded file gets: the probe word, plus filler that is NOT it. */
function seedBody(probe, i) {
  return [
    '# seeded corpus',
    '',
    '**Type:** unordered',
    `**Probe:** ${probe}`,
    '',
    '---',
    '',
    `seeded item ${i} carrying probe ${probe}`,
    'This line exists so the body is not empty, and deliberately does not',
    'repeat the probe word more than once.',
    '',
  ].join('\n');
}

/** The filename, shaped like a real staged artifact. */
function seedName(probe, i) {
  const d = new Date();
  const day = String(d.getDate()).padStart(2, '0');
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                  'August', 'September', 'October', 'November', 'December'];
  return `2026-01-${String(i % 28 + 1).padStart(2, '0')}-seed${i}${day}` +
         `${months[d.getMonth()]}${d.getFullYear()}-${probe}.md`;
}

/**
 * Seed `count` thoughts into the queue. Returns { probe, files, dirCreated }.
 *
 * The directory is CREATED if absent — on a fresh clone it does not exist,
 * because .gitignore excludes it and git does not track empty directories.
 * F29 used to crash with ENOENT on `scandir` here, which is a test defect
 * masquerading as a product one.
 */
function seedCorpus(count = SEED_COUNT, label = 'f29') {
  const probe = probeWord(label);
  const dirCreated = !fs.existsSync(QUEUE_DIR);
  if (dirCreated) fs.mkdirSync(QUEUE_DIR, { recursive: true });

  const files = [];
  for (let i = 0; i < count; i++) {
    const name = seedName(probe, i);
    const full = path.join(QUEUE_DIR, name);
    fs.writeFileSync(full, seedBody(probe, i));
    files.push(name);
  }
  return { probe, files, dirCreated };
}

/**
 * Remove a seeded corpus. Only files this run created — never a blanket
 * delete of the queue, which on a developer's box holds real staged thoughts.
 * The directory is removed too when this run created it, so the vault is
 * exactly as it was found.
 */
function cleanCorpus(seeded) {
  if (!seeded || !seeded.files) return;
  for (const name of seeded.files) {
    try { fs.unlinkSync(path.join(QUEUE_DIR, name)); } catch (e) { /* gone */ }
  }
  if (seeded.dirCreated) {
    try { fs.rmdirSync(QUEUE_DIR); } catch (e) { /* not empty: leave it */ }
  }
}

module.exports = {
  QUEUE_DIR, SEED_COUNT, seedCorpus, cleanCorpus, probeWord,
};