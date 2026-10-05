// Snapshot and clean only files a browser suite created in Prism's vault.
//
// NEVER delete by date or filename prefix: a user's own file created today is
// not ours. Call `snapshotVault()` before the test action; in finally pass that
// snapshot to `cleanNewVaultFiles()`. Files present before the run are protected
// even if they share today's prefix with our generated artifacts.
const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./env.js');

const VAULT = path.join(ROOT, 'prism', 'vault');

const OUTPUT_DIRS = [
  'ingestion/unprocessed',
  'requirements',
  'hypotheses',
  'rationalizations',
  'source/unordereds',
];

function scopedDirs(vaultRoot) {
  return OUTPUT_DIRS.map(rel => path.join(vaultRoot, rel));
}

function filesInScope(vaultRoot = VAULT) {
  const files = new Map();
  for (const relDir of OUTPUT_DIRS) {
    const dir = path.join(vaultRoot, relDir);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      let st;
      try { st = fs.statSync(full); } catch (_) { continue; }
      if (st.isFile()) files.set(path.relative(vaultRoot, full), full);
    }
  }
  return files;
}

function snapshotVault(vaultRoot = VAULT) {
  const snapshot = new Map();
  for (const [rel, full] of filesInScope(vaultRoot)) {
    const st = fs.statSync(full);
    const content = fs.readFileSync(full);
    // Reading may update atime. Restore it immediately so a test's snapshot is
    // observational and cannot itself mutate the preserved user corpus.
    try { fs.utimesSync(full, st.atime, st.mtime); } catch (_) {}
    snapshot.set(rel, {
      content,
      mode: st.mode,
      atime: st.atime,
      mtime: st.mtime,
    });
  }
  return snapshot;
}

function cleanNewVaultFiles(snapshot, vaultRoot = VAULT) {
  if (!(snapshot instanceof Map)) throw new TypeError('vault snapshot must be a Map');
  const remaining = [];
  const removed = [];

  // Existing files are user-owned. Assert unchanged and never delete them.
  for (const [rel, before] of snapshot) {
    const full = path.join(vaultRoot, rel);
    if (!fs.existsSync(full)) {
      remaining.push(`pre-existing file was deleted: ${rel}`);
      continue;
    }
    const after = fs.readFileSync(full);
    if (!after.equals(before.content)) {
      // Some product writes use a same-day deterministic filename. If one
      // collides with a pre-existing artifact, restore its exact bytes rather
      // than leaving the user's file modified; still report the collision.
      try {
        fs.writeFileSync(full, before.content, { mode: before.mode });
        fs.chmodSync(full, before.mode);
        fs.utimesSync(full, before.atime, before.mtime);
      } catch (e) {
        remaining.push(`pre-existing file was modified and could not be restored: ${rel}: ${e.message}`);
        continue;
      }
      remaining.push(`pre-existing file was overwritten by the test; original restored: ${rel}`);
    } else {
      // Reading a user's file can update its atime. Restore that metadata so
      // snapshot and verification leave the preserved corpus untouched.
      try { fs.utimesSync(full, before.atime, before.mtime); } catch (_) {}
    }
  }

  // Only paths absent from the pre-run snapshot belong to this run.
  for (const [rel, full] of filesInScope(vaultRoot)) {
    if (snapshot.has(rel)) continue;
    try {
      fs.unlinkSync(full);
      removed.push(rel);
    } catch (e) {
      remaining.push(`could not remove test-created file ${rel}: ${e.message}`);
    }
  }

  // Do not remove directories: an empty directory may have existed before the
  // test, and keeping it is harmless. The invariant is zero new files, not that
  // git-ignored empty directory structure is byte-for-byte identical.
  return { removed, remaining };
}

module.exports = { OUTPUT_DIRS, snapshotVault, cleanNewVaultFiles };
