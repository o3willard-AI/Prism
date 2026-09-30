// Lifecycle for the loop stub agent: free the port, start it, wait for it to
// actually answer, and tear it down by PORT in a finally.
//
// Why this exists. Three suites need the stub (F25, F26, F28-ui) and each grew
// its own arrangement. F26 did it properly, F25 hand-rolled a readiness probe
// that opened 80 concurrent sockets in a tight loop, and F28-ui assumed someone
// else had started it. The result was that `bash run-all.sh` had to shell out
// and kill the process itself — the one part of "runs anywhere" resting on my
// orchestration script rather than the repo.
//
// Two rules, both learned the hard way:
//
//   1. Kill BY PORT, never by PID or by handle. A stub left by a PREVIOUS run
//      is not a child of this process, so killing our own handle frees nothing
//      and the next run talks to a stale agent with stale logic. That mistake
//      cost four separate debugging rounds (the F24 stale-server lesson).
//
//   2. Readiness means a real TLS request that came back, not a bare TCP
//      connect and not a fixed sleep. The stub wraps its socket in TLS, so a
//      plain probe either fails or, worse, leaves a half-open handshake that
//      blocks the threaded server behind it.
'use strict';

const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const env = require('./env.js');

const STUB_SCRIPT = path.join(env.LIB, 'loop_stub_agent.py');
const FREE_PORT = path.join(env.LIB, 'free-port.sh');

/** Kill whatever holds `port`, and confirm it is actually free. */
function freePort(port = env.STUB_PORT) {
  try {
    const out = execFileSync('bash', [FREE_PORT, String(port)],
                             { encoding: 'utf8' });
    return out.trim().endsWith('free');
  } catch (e) {
    // free-port.sh exits 1 when the port is still bound. That is a real
    // problem, and pretending otherwise is how a stale stub gets used.
    return false;
  }
}

/**
 * One TLS request to the stub. Resolves true only if the server answered with a
 * status code — a rejection or a timeout resolves false and nothing else.
 */
function pingStub(port, host) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        host: host || env.STUB_HOST,
        port,
        method: 'POST',
        path: '/v1/chat/completions',
        rejectUnauthorized: false,   // the fixture cert is self-signed by design
        servername: '127.0.0.1',
        timeout: 1500,
        headers: { 'Content-Type': 'application/json' },
      },
      (res) => { res.resume(); resolve(true); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end(JSON.stringify({ messages: [{ role: 'user', content: 'ping' }] }));
  });
}

/**
 * Wait for the stub, retrying SEQUENTIALLY. The first version of this in F25
 * looped 80 times issuing a request each pass with no await between them, so it
 * opened 80 sockets at once and raced itself.
 */
async function waitForStub(port, host, attempts = 40, delayMs = 250) {
  for (let i = 0; i < attempts; i++) {
    if (await pingStub(port, host)) return true;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

/**
 * Start the stub, wait for it, and return a stop() the caller MUST call.
 * Throws if it cannot bind — better to fail here, loudly, than to let a suite
 * run 40 assertions against an agent that was never there.
 */
async function startStub({ port = env.STUB_PORT, host = env.STUB_HOST } = {}) {
  if (!fs.existsSync(STUB_SCRIPT)) {
    throw new Error(`stub agent missing at ${STUB_SCRIPT}`);
  }
  if (!freePort(port)) {
    throw new Error(
      `port ${port} is still held by another process. A stub from a previous `
      + 'run is answering with stale logic; free it and retry.');
  }

  const proc = spawn('python3', [STUB_SCRIPT], {
    cwd: env.ROOT,
    // Forwarded under the names loop_stub_agent.py actually reads, so an
    // override moves the process AND the armed config together. Setting it in
    // one place only produces a config pointing at a port nobody is on.
    env: { ...process.env, STUB_PORT: String(port), STUB_HOST: host },
    stdio: 'ignore',
    detached: true,
  });
  proc.unref();

  if (!(await waitForStub(port, host))) {
    freePort(port);
    throw new Error(`stub agent did not answer on ${host}:${port}`);
  }
  return {
    port,
    host,
    endpoint: `https://${host}:${port}/v1/chat/completions`,
    stop() { freePort(port); },
  };
}

/**
 * Run `fn` with a live stub, guaranteeing teardown. This is the shape suites
 * should use: one call, no possibility of leaking a background process into
 * the next run, which is the failure this whole module exists to prevent.
 */
async function withStub(fn, opts) {
  const stub = await startStub(opts);
  try {
    return await fn(stub);
  } finally {
    stub.stop();
  }
}

module.exports = {
  startStub, withStub, freePort, waitForStub, pingStub,
  STUB_SCRIPT, FREE_PORT,
};
