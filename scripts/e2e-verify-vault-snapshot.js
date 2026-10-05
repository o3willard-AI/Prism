// Regression for test-owned vault cleanup. Uses an isolated temporary vault so
// it can prove ownership without touching the developer's intentionally
// preserved queue. A file matching today's product naming convention is seeded
// before the snapshot to prove cleanup never means "delete today's files".
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// Resolve the repository through the shared environment module, as all suites do.
require('./lib/env.js');
const { OUTPUT_DIRS, snapshotVault, cleanNewVaultFiles } = require('./lib/vault-snapshot.js');

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-vault-snapshot-'));
try {
  for (const d of OUTPUT_DIRS) fs.mkdirSync(path.join(root, d), { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const userFile = path.join(root, 'requirements', `${today}-user-owned.md`);
  const userOriginal = Buffer.from('user-owned; created today; must survive');
  fs.writeFileSync(userFile, userOriginal);
  const baseline = snapshotVault(root);

  // A suite creates a queue item and a source mirror; both are its to remove.
  const queue = path.join(root, 'ingestion/unprocessed', `${today}-test-owned-seed.md`);
  const mirror = path.join(root, 'source/unordereds', `${today}-test-owned-seed.md`);
  fs.writeFileSync(queue, 'suite-owned');
  fs.writeFileSync(mirror, 'suite-owned mirror');

  const result = cleanNewVaultFiles(baseline, root);
  check('the suite-created queue item is removed', !fs.existsSync(queue));
  check('the suite-created source mirror is removed', !fs.existsSync(mirror));
  check('the same-day user artifact is still there', fs.existsSync(userFile));
  check('the same-day user artifact bytes are unchanged',
        fs.readFileSync(userFile).equals(userOriginal));
  check('the cleanup reports no collision or mutation', result.remaining.length === 0,
        result.remaining.join('; '));
  check('exactly the two suite-owned paths were removed', result.removed.length === 2,
        JSON.stringify(result.removed));

  // Mutation test: if suite code overwrites a pre-existing path through a
  // deterministic same-day name, cleanup restores original bytes and reports it.
  fs.writeFileSync(userFile, 'overwritten by test');
  const collision = cleanNewVaultFiles(baseline, root);
  check('a same-path overwrite is restored byte-for-byte',
        fs.readFileSync(userFile).equals(userOriginal));
  check('the overwrite collision is reported, not hidden',
        collision.remaining.some(x => x.includes('original restored')),
        collision.remaining.join('; '));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
