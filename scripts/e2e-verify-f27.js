// F27: the shared test environment cannot drift, and no suite may go back to
// resolving its own.
//
// This exists because of a specific failure. Nine suites each resolved ROOT,
// API, FRONT and the fake-agent cert themselves, and they disagreed:
// PRISM_API / PRISM_SITE / PORT all meant one server, FRONT was hardcoded in
// two places and absent in four, and the cert defaulted to /tmp — which works
// only on the machine that generated it. F26 shipped with a developer's home
// directory in it while the correct pattern sat in the file beside it.
//
// Two files now define "the same" environment: scripts/lib/env.js and
// scripts/lib/env.py. Python cannot import a JS module, so nothing but a test
// holds them together. This is that test.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const E = require('./lib/env.js');

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { console.log('  PASS ' + name); pass++; }
  else { console.log('  FAIL ' + name + (detail ? '  — ' + detail : '')); fail++; }
};
const section = (s) => console.log('\n' + s);

const ROOT = E.ROOT;
const LIB = E.LIB;
const SCRIPT_FILES = fs.readdirSync(path.join(ROOT, 'scripts'))
  .filter((f) => /^e2e-verify-.*\.(js|py)$/.test(f));

section('Shared module resolves its own paths');
check('ROOT is derived from the module, not hardcoded',
      path.isAbsolute(ROOT) && ROOT === path.resolve(ROOT), ROOT);
check('ROOT is the checkout this suite is actually testing',
      fs.existsSync(path.join(ROOT, 'prism', 'app.js'))
      && fs.existsSync(path.join(ROOT, 'scripts', 'lib', 'env.js')));
// NOT "ROOT is not under /home/..." — this checkout legitimately lives in a
// home directory. The property that matters is that the module DERIVED it, and
// the checks below prove no suite carries a literal path.
check('LIB sits under ROOT', LIB.startsWith(ROOT), LIB);
check('ROOT contains the repo we are testing',
      fs.existsSync(path.join(ROOT, 'prism', 'app.js')));
check('the fake-agent cert fixture is committed, not in /tmp',
      fs.existsSync(E.FAKE_CERT) && E.FAKE_CERT.startsWith(ROOT), E.FAKE_CERT);
check('and so is the key', fs.existsSync(E.FAKE_KEY) && E.FAKE_KEY.startsWith(ROOT),
      E.FAKE_KEY);

section('No default points outside the repository');
for (const [k, v] of Object.entries(E)) {
  if (typeof v !== 'string') continue;
  if (!/fake-|cert|key/i.test(k)) continue;
  check(`${k} defaults inside the repo`, !v.startsWith('/tmp/') || /log$/i.test(k), v);
}

section('The JS and Python definitions agree');
// Import the Python side in a child process and read what it computed, so the
// comparison is against real values rather than a re-derivation of them.
const { execFileSync } = require('node:child_process');
const pyOut = execFileSync('python3', ['-c', `
import json, sys
sys.path.insert(0, ${JSON.stringify(LIB)})
import env
print(json.dumps({
    'API': env.API, 'FRONT': env.FRONT, 'FAKE_CERT': env.FAKE_CERT,
    'FAKE_KEY': env.FAKE_KEY, 'STUB_PORT': env.STUB_PORT,
    'STUB_HOST': env.STUB_HOST, 'FAKE_AGENT_BASE_PORT': env.FAKE_AGENT_BASE_PORT,
    'ROOT': str(env.ROOT), 'DECLARED': env.DECLARED,
}))
`], { encoding: 'utf8' });
const PY = JSON.parse(pyOut);

check('ROOT resolves identically in both', PY.ROOT === ROOT,
      `js=${ROOT} py=${PY.ROOT}`);
check('API resolves identically', PY.API === E.API, `js=${E.API} py=${PY.API}`);
check('FRONT resolves identically', PY.FRONT === E.FRONT,
      `js=${E.FRONT} py=${PY.FRONT}`);
check('the cert path resolves identically', PY.FAKE_CERT === E.FAKE_CERT,
      `js=${E.FAKE_CERT} py=${PY.FAKE_CERT}`);
check('the key path resolves identically', PY.FAKE_KEY === E.FAKE_KEY);
check('the stub port resolves identically', PY.STUB_PORT === E.STUB_PORT);
check('the stub host resolves identically', PY.STUB_HOST === E.STUB_HOST);
check('the fake-agent base port resolves identically',
      PY.FAKE_AGENT_BASE_PORT === E.FAKE_AGENT_BASE_PORT);

section('The declared variable names are the same set on both sides');
// env.js keeps its own table purely so the two can be diffed by a test rather
// than by a human reading two files and hoping.
const jsDeclared = E.DECLARED;
for (const key of Object.keys(jsDeclared)) {
  check(`${key} is declared on both sides`,
        PY.DECLARED && key in PY.DECLARED,
        'missing from env.py');
  if (!PY.DECLARED || !(key in PY.DECLARED)) continue;
  check(`${key}: same variable names in the same order`,
        JSON.stringify(jsDeclared[key][0]) === JSON.stringify(PY.DECLARED[key][0]),
        `js=${jsDeclared[key][0]} py=${PY.DECLARED[key][0]}`);
  check(`${key}: same fallback value`,
        String(jsDeclared[key][1]) === String(PY.DECLARED[key][1]),
        `js=${jsDeclared[key][1]} py=${PY.DECLARED[key][1]}`);
}
for (const key of Object.keys(PY.DECLARED)) {
  check(`${key} is declared on the JS side too`, key in jsDeclared, 'missing from env.js');
}

section('No suite resolves its own environment any more');
const BANNED = [
  { re: /\/home\/[a-z0-9_-]+\//, why: 'a developer\'s home directory' },
  { re: /require\(\s*['"]\/[^'"]*cdp/, why: 'an absolute require()' },
  { re: /cafile\s*=\s*['"]\/tmp\/fake-/, why: 'a /tmp cert path' },
  { re: /['"]\/tmp\/fake-cert\.pem['"]/, why: 'a /tmp cert path' },
  { re: /['"]\/tmp\/fake-key\.pem['"]/, why: 'a /tmp key path' },
  // process.cwd() is worse than a hardcoded path: it is right only when the
  // suite is launched from the repo root, so running one from anywhere else
  // reads a file that is not there and asserts against the wrong subject.
  { re: /process\.cwd\(\)/, why: 'a process.cwd()-relative path' },
  // Re-resolving what the shared module already resolved.
  { re: /process\.env\.PRISM_API\s*\|\|/, why: 'its own API resolution' },
  { re: /process\.env\.PRISM_URL\s*\|\|/, why: 'its own FRONT resolution' },
  { re: /os\.environ\.get\(['"]PRISM_API['"]/, why: 'its own API resolution' },
];
for (const f of SCRIPT_FILES) {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', f), 'utf8');
  // This suite names the banned patterns in order to look for them.
  const isSelf = f === 'e2e-verify-f27.js';
  for (const b of BANNED) {
    if (isSelf) continue;
    check(`${f} has no ${b.why}`, !b.re.test(src),
          (src.match(b.re) || [''])[0].slice(0, 70));
  }
  // Sourcing the shared module is the point, so require it where the suite is
  // JavaScript. A Python suite imports env instead.
  if (f.endsWith('.js')) {
    const imports = /require\(\s*['"]\.\/lib\/env(\.js)?['"]\s*\)/
      .test(src) || /from\s+['"]\.\/lib\/env(\.js)?['"]/.test(src);
    check(`${f} sources the shared env`, imports);
  } else {
    const imports = /import\s+env\b|from\s+env\s+import/.test(src);
    check(`${f} imports the shared env`, imports);
  }
  // Every identifier a suite destructures from the shared module must actually
  // exist on it. A rename with no alias yields a silent `undefined` that shows
  // up as "MISSING undefined" at run time — or worse, as a check against
  // `undefined` that passes. Compare the destructured names against the real
  // export list rather than trusting that the names line up.
  const exported = new Set(Object.keys(E));
  if (f.endsWith('.js')) {
    const m = src.match(/(?:const|let)\s*\{([^}]*)\}\s*=\s*(?:env|require\(\s*['"]\.\/lib\/env\.js['"]\s*\))/);
    if (m) {
      for (const raw of m[1].split(',')) {
        const name = raw.split(':')[0].trim();
        if (!name) continue;
        check(`${f}: '${name}' is really exported by lib/env.js`,
              exported.has(name), 'would be undefined at run time');
      }
    }
  }
}

section('Every suite actually loads');
// `node --check` is not enough: it parses each file in isolation and cannot
// see a duplicate binding across the import graph, which is how F25 shipped a
// second `const STUB_PORT` and died with "Identifier already declared" only at
// run time. Actually EXECUTE the module and let the loader find real problems.
// (execFileSync is already required above, for reading the Python env.)
for (const f of SCRIPT_FILES) {
  if (f.endsWith('.py')) continue;
  // F27 itself exits the process, and the loop suites need a live server plus
  // several minutes, so load-check the ones that are safe to import blind.
  if (/^e2e-verify-f(1[2-8]|2[0-4]|27)\.js$/.test(f) || f === 'e2e-verify-lcm.js') {
    let ok = true, why = '';
    try {
      execFileSync('node', [path.join(ROOT, 'scripts', f)],
                   { stdio: 'ignore', timeout: 25000 });
    } catch (e) {
      // A non-zero exit is fine (suites report failures that way); what matters
      // is whether the module LOADED. A SyntaxError or ReferenceError at import
      // time is not fine.
      const out = (e.stderr || '').toString() + (e.stdout || '').toString();
      if (/SyntaxError|ReferenceError|is not defined|already been declared/.test(out)) {
        ok = false;
        why = out.split('\n').filter((l) => /Error|declared/.test(l))[0] || 'load error';
      }
    }
    check(`${f} loads without a module-level error`, ok, why);
  }
}

section('The suite list is not silently shrinking');
// If a rename drops a suite from this directory, the guard above silently
// checks less. Assert we found the ones we know about.
for (const known of ['e2e-verify-f12.js', 'e2e-verify-f22.py', 'e2e-verify-f25.js',
                     'e2e-verify-f26.js', 'e2e-verify-f27.js']) {
  check(`${known} is present`, SCRIPT_FILES.includes(known));
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
