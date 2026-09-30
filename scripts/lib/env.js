// Shared test environment. One place that knows how to find the repo and the
// running services.
//
// WHY THIS EXISTS
//
// Nine suites each used to resolve their own environment, and they disagreed:
//   ROOT   — hardcoded absolute, or __dirname-relative, or nothing
//   API    — PRISM_API / PRISM_SITE / PORT, three names for one server
//   FRONT  — PRISM_URL, hardcoded, or absent
//   certs  — /tmp/fake-cert.pem (works only on the box that made it)
//
// A test that only runs on one machine is not a test, and F26 shipped with a
// developer's home directory in it because the correct pattern was sitting in
// the file next to it. Centralising the resolution means the next suite gets it
// right by importing rather than by remembering.
//
// Two rules this module enforces:
//   1. Nothing here defaults to a path outside the repository. There is no
//      /tmp fallback, because /tmp state does not survive a fresh checkout and
//      the resulting failure looks like a product bug.
//   2. Every value is overridable by environment, and the FIRST spelling wins
//      with the others kept as aliases, so a variable that already exists in
//      someone's muscle memory keeps working.
'use strict';

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..', '..');
const LIB = path.join(ROOT, 'scripts', 'lib');
const VAULT = path.join(ROOT, 'prism', 'vault');

// Read the first defined, non-empty value from a list of names. Order is the
// contract: the first name is canonical, the rest are aliases kept working so
// existing runbooks don't rot.
function pick(...names) {
  for (const n of names) {
    const v = process.env[n];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return undefined;
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// ── Services ───────────────────────────────────────────────────────────────
// The API is the stdlib backend. PORT is a historical spelling kept as an
// alias; PRISM_SITE is what F19 called the FRONT door, which is why that suite
// needed its own name in the first place.
const API_PORT = num(pick('PRISM_API_PORT', 'PORT'), 8082);
const API_HOST = pick('PRISM_API_HOST') || '127.0.0.1';
const API = pick('PRISM_API', 'PRISM_SITE_API') || `http://${API_HOST}:${API_PORT}`;

const FRONT_PORT = num(pick('PRISM_FRONT_PORT'), 8090);
const FRONT_HOST = pick('PRISM_FRONT_HOST') || '127.0.0.1';
// PRISM_SITE is honoured as an alias because F19 has always used it, and
// silently repointing that suite at the backend would break it silently — the
// worst kind of break, because it still "passes" against the wrong target.
const FRONT = pick('PRISM_URL', 'PRISM_SITE') || `http://${FRONT_HOST}:${FRONT_PORT}`;

// The fake agent's TLS fixture: committed, not generated, and never in /tmp.
//
// SSL_CERT_FILE is deliberately NOT consulted. In many environments it points
// at a full CA bundle (certifi and friends), and honouring it here makes the
// test trust the wrong CA: every handshake fails while the agent is perfectly
// healthy, which reads as a product bug. F24's docstring already warned about
// exactly this; the variable simply crept back in while the precedence list was
// being written, and only F27 — which asserts the cert lives inside the repo —
// caught it.
const FAKE_CERT = pick('F24_CA_FILE', 'FAKE_AGENT_CERT')
  || path.join(LIB, 'fake-cert.pem');
const FAKE_KEY = pick('F24_KEY_FILE', 'FAKE_AGENT_KEY') || path.join(LIB, 'fake-key.pem');

// The stub agent used by the clarity-loop suites (F25/F26).
const STUB_HOST = pick('PRISM_STUB_HOST', 'STUB_HOST') || '127.0.0.1';
const STUB_PORT = num(pick('PRISM_STUB_PORT', 'LOOP_STUB_PORT', 'STUB_PORT'), 8400);
const STUB_ENDPOINT = `https://${STUB_HOST}:${STUB_PORT}/v1/chat/completions`;

// Ports the F22 error-mode agents bind, one per mode so a rebind never races a
// lingering socket.
const FAKE_AGENT_BASE_PORT = num(pick('FAKE_AGENT_PORT'), 8100);
const FAKE_AGENT_LOG = pick('FAKE_AGENT_LOG') || path.join(os.tmpdir(), 'fake-agent.log');
const F24_LOG = pick('F24_LOG') || path.join(os.tmpdir(), 'fake-adj-f24.log');

// The canonical name of every variable, in precedence order, with the value it
// falls back to. This table exists ONLY so scripts/e2e-verify-f27.py — sorry,
// e2e-verify-f27.js — can diff it against env.py's identical table and fail on
// drift. Without it, the two files define "the same" independently, which is
// precisely how PRISM_API and PRISM_SITE and PORT came to mean one server under
// three names.
const DECLARED = {
  API: [['PRISM_API'], `http://${API_HOST}:${API_PORT}`],
  API_PORT: [['PRISM_API_PORT', 'PORT'], 8082],
  FRONT: [['PRISM_URL', 'PRISM_SITE'], `http://${FRONT_HOST}:${FRONT_PORT}`],
  FAKE_CERT: [['F24_CA_FILE', 'FAKE_AGENT_CERT'], path.join(LIB, 'fake-cert.pem')],
  FAKE_KEY: [['F24_KEY_FILE', 'FAKE_AGENT_KEY'], path.join(LIB, 'fake-key.pem')],
  STUB_PORT: [['PRISM_STUB_PORT', 'LOOP_STUB_PORT', 'STUB_PORT'], 8400],
  STUB_HOST: [['PRISM_STUB_HOST', 'STUB_HOST'], '127.0.0.1'],
  FAKE_AGENT_BASE_PORT: [['FAKE_AGENT_PORT'], 8100],
};

// A loud refusal, used by every suite that needs a live service ─────────────
// A missing service should say so in one line naming the variable, not produce
// forty failures that all look like product defects.
function requireEnv(name, value, hint) {
  if (!value) {
    console.error(`\n  ${name} is not set — the environment is not ready.`);
    if (hint) console.error(`  ${hint}`);
    console.error('');
    process.exit(2);
  }
  return value;
}

// A freshness probe: confirm a service is up before asserting against it, so a
// missing server is one line instead of forty failures that all look like
// product defects.
function assertServiceUp(url, label) {
  const req = require('node:http');
  const u = new URL(url);
  return new Promise((resolve) => {
    const r = req.request(
      { host: u.hostname, port: u.port, path: '/healthz', method: 'GET', timeout: 1500 },
      (res) => { res.resume(); resolve(!!res.statusCode); });
    r.on('error', () => resolve(false));
    r.on('timeout', () => { r.destroy(); resolve(false); });
    r.end();
  }).then((ok) => {
    if (!ok) {
      console.error(`\n  ${label || u.origin} is not answering — start it, or point the`);
      console.error(`  suite elsewhere: PRISM_API / PRISM_URL / PRISM_API_PORT.`);
      console.error('');
      process.exit(2);
    }
    return true;
  });
}

module.exports = {
  ROOT, LIB, VAULT,
  API, API_HOST, API_PORT,
  FRONT, FRONT_HOST, FRONT_PORT,
  FAKE_CERT, FAKE_KEY,
  // Short aliases. Two suites predate the FAKE_ prefix and read CERT/KEY; a
  // rename with no alias is a silent `undefined` that surfaces as a
  // "MISSING undefined" setup message — the same class of bug as the hardcoded
  // paths this module exists to remove.
  CERT: FAKE_CERT, KEY: FAKE_KEY,
  STUB_HOST, STUB_PORT, STUB_ENDPOINT,
  FAKE_AGENT_BASE_PORT, FAKE_AGENT_LOG, F24_LOG, DECLARED,
  requireEnv, pick, num, pickEnv: pick,
  assertServiceUp,
  nodeMajor: Number(process.versions.node.split('.')[0]),
};
