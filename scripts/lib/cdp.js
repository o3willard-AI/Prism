#!/usr/bin/env node
// Minimal CDP driver for Prism's browser checks — no npm, no Playwright.
//
// Prism's founding constraint is stdlib-only, so this deliberately does NOT
// add a dependency. It launches the Playwright-cached Chrome for Testing
// binary with --remote-debugging-port, speaks the DevTools Protocol over a
// raw WebSocket, and exposes just enough to load a page, evaluate JS in it,
// and read back results.
//
// Usage (as a module):
//   const { launch } = require('./cdp');
//   const b = await launch();
//   const page = await b.newPage();
//   await page.goto(url);
//   const v = await page.eval('document.title');
//   await b.close();

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const net = require('net');

// ── Locate a Chrome binary ────────────────────────────────────────────────
function findChrome() {
  if (process.env.PRISM_CHROME) return process.env.PRISM_CHROME;
  const cache = path.join(os.homedir(), '.cache', 'ms-playwright');
  const candidates = [];
  if (fs.existsSync(cache)) {
    for (const d of fs.readdirSync(cache)) {
      if (!d.startsWith('chromium')) continue;
      candidates.push(
        path.join(cache, d, 'chrome-linux64', 'chrome'),
        path.join(cache, d, 'chrome-linux', 'chrome'),
        path.join(cache, d, 'chrome-linux', 'headless_shell'));
    }
  }
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser',
                   '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable']) {
    if (fs.existsSync(p)) candidates.push(p);
  }
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('No Chrome binary found. Set PRISM_CHROME, or run:\n' +
    '  npx playwright install chromium');
}

// ── Tiny WebSocket client (RFC 6455, client side, text frames only) ─────
class WS {
  constructor(url) {
    const u = new URL(url);
    this.host = u.hostname;
    this.port = Number(u.port || 80);
    this.path = u.pathname + u.search;
    this.buf = Buffer.alloc(0);
    this.handlers = { message: [], close: [] };
    this.ready = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const key = crypto.randomBytes(16).toString('base64');
      const sock = net.connect(this.port, this.host, () => {
        sock.write(
          `GET ${this.path} HTTP/1.1\r\n` +
          `Host: ${this.host}:${this.port}\r\n` +
          'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
          `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
      });
      sock.on('error', reject);
      let handshake = false;
      sock.on('data', (chunk) => {
        if (!handshake) {
          const s = chunk.toString('latin1');
          const i = s.indexOf('\r\n\r\n');
          if (i < 0) return;
          if (!/101/.test(s.slice(0, i))) return reject(new Error('ws handshake: ' + s.slice(0, 80)));
          handshake = true;
          this.sock = sock;
          const rest = chunk.subarray(Buffer.byteLength(s.slice(0, i + 4), 'latin1'));
          if (rest.length) this._onData(rest);
          for (const h of this.handlers.open || []) h();
          resolve();                      // 101 received — connection is live
          return;
        }
        this._onData(chunk);
      });
      sock.on('close', () => { for (const h of this.handlers.close) h(); });
    });
  }

  _onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1];
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2); off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        len = Number(this.buf.readBigUInt64BE(2)); off = 10;
      }
      if (masked) off += 4;
      if (this.buf.length < off + len) return;
      let payload = this.buf.subarray(off, off + len);
      this.buf = this.buf.subarray(off + len);
      if (opcode === 0x8) { this.sock.end(); return; }
      if (opcode === 0x9) { continue; }   // ping — ignore
      if (opcode === 0x1) {              // text
        const msg = payload.toString('utf8');
        for (const h of this.handlers.message) h(msg);
      }
    }
  }

  send(text) {
    if (!this.sock) throw new Error('ws not connected');
    const data = Buffer.from(text, 'utf8');
    const mask = crypto.randomBytes(4);
    let header;
    if (data.length < 126) {
      header = Buffer.from([0x81, 0x80 | data.length]);
    } else if (data.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(data.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(data.length), 2);
    }
    const masked = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
    this.sock.write(Buffer.concat([header, mask, masked]));
  }

  close() { try { this.sock && this.sock.end(); } catch (e) {} }
}

// ── Chrome process ───────────────────────────────────────────────────────
function httpJson(url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method }, (res) => {
      let b = '';
      res.on('data', (d) => (b += d));
      res.on('end', () => {
        try { resolve(JSON.parse(b)); }
        catch (e) { reject(new Error('non-JSON from ' + url + ': ' + b.slice(0, 120))); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  for (;;) {
    try { return await fn(); } catch (e) {
      if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + label);
      await new Promise(r => setTimeout(r, 120));
    }
  }
}

async function launch(opts = {}) {
  const bin = findChrome();
  const port = opts.port || (9500 + Math.floor(Math.random() * 400));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-cdp-'));
  const args = [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--hide-scrollbars', '--mute-audio',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ];
  const proc = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (d) => (stderr += d.toString()));

  let version;
  try {
    version = await waitFor(() => httpJson(`http://127.0.0.1:${port}/json/version`), 20000, 'chrome devtools');
  } catch (e) {
    proc.kill('SIGKILL');
    throw new Error('Chrome did not start: ' + e.message + '\n' + stderr.slice(-400));
  }

  async function newPage(url) {
    // Chrome >= 111 requires PUT for /json/new; older builds only accept GET.
    // Try PUT, then fall back to reusing the existing about:blank page target.
    let target = null;
    for (const method of ['PUT', 'GET']) {
      try {
        const t = await waitFor(
          () => httpJson(
            `http://127.0.0.1:${port}/json/new?${encodeURIComponent(url || 'about:blank')}`,
            method).then((r) => (r && r.webSocketDebuggerUrl ? r : Promise.reject(new Error('no ws')))),
          6000, 'new target (' + method + ')');
        if (t && t.webSocketDebuggerUrl) { target = t; break; }
      } catch (e) { /* try the next method */ }
    }
    if (!target) {
      const list = await waitFor(
        () => httpJson(`http://127.0.0.1:${port}/json/list`).then(
          (l) => (l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
                  || Promise.reject(new Error('no page target')))),
        10000, 'existing page target');
      target = list;
    }
    const ws = new WS(target.webSocketDebuggerUrl);
    await ws.connect();
    return makePage(ws, target.id);
  }

  return {
    version, port, bin,
    newPage,
    async close() {
      try { proc.kill('SIGTERM'); } catch (e) {}
      await new Promise(r => setTimeout(r, 300));
      try { proc.kill('SIGKILL'); } catch (e) {}
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
    },
  };
}

// ── Page ─────────────────────────────────────────────────────────────────
function makePage(ws, targetId) {
  let id = 0;
  const pending = new Map();
  const consoleMsgs = [];
  const pageErrors = [];

  ws.handlers.message.push((raw) => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      return;
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      consoleMsgs.push({
        type: m.params.type,
        text: (m.params.args || []).map(a => a.value ?? a.description ?? a.type).join(' '),
      });
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails || {};
      pageErrors.push(d.exception?.description || d.text || 'unknown error');
    }
  });

  const send = (method, params) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
    setTimeout(() => {
      if (pending.has(mid)) { pending.delete(mid); reject(new Error('CDP timeout: ' + method)); }
    }, 30000);
  });

  const init = async () => {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Log.enable').catch(() => {});
  };

  return {
    targetId, ws, consoleMsgs, pageErrors, send,
    async goto(url, { waitMs = 400 } = {}) {
      await send('Page.navigate', { url });
      await new Promise(r => setTimeout(r, waitMs));
    },
    async eval(expression, { awaitPromise = true } = {}) {
      const r = await send('Runtime.evaluate', {
        expression, returnByValue: true, awaitPromise, userGesture: true,
      });
      if (r.exceptionDetails) {
        throw new Error('eval threw: ' +
          (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      }
      return r.result?.value;
    },
    async waitFor(expr, ms = 8000, label = expr) {
      const t0 = Date.now();
      for (;;) {
        if (await this.eval(`!!(${expr})`)) return true;
        if (Date.now() - t0 > ms) throw new Error('waitFor timed out: ' + label);
        await new Promise(r => setTimeout(r, 100));
      }
    },
    async close() { ws.close(); },
    ready: init,
  };
}

module.exports = { launch, findChrome };
