"""Python mirror of scripts/lib/stub-agent.js.

Same lifecycle, same two rules, same reasons:

  1. Kill BY PORT. A stub left by a PREVIOUS run is not our child, so killing our
     own Popen handle frees nothing and the next run talks to a stale agent with
     stale logic. That mistake cost four separate debugging rounds.
  2. Readiness means a real TLS request that came back -- not a bare TCP connect
     and not a fixed sleep. The stub wraps its socket in TLS, so a plain probe
     either fails or leaves a half-open handshake that blocks the threaded
     server behind it.

Python cannot import a JavaScript module, so this file and stub-agent.js are two
definitions of the same behaviour. e2e-verify-f27.py diffs the environment
tables; this pair is held together by both files using the SAME script path, the
SAME port variable name, and the same free-port helper, so there is only one
place either can be wrong about the port.
"""
import json
import os
import socket
import ssl
import subprocess
import sys
import time
from pathlib import Path

import env

STUB_SCRIPT = Path(env.LIB) / 'loop_stub_agent.py'
FREE_PORT = Path(env.LIB) / 'free-port.sh'


def free_port(port=None):
    """Kill whatever holds `port`; True if it is free afterwards."""
    port = str(port or env.STUB_PORT)
    try:
        subprocess.run(['bash', str(FREE_PORT), port], check=True,
                       capture_output=True, text=True)
        return True
    except subprocess.CalledProcessError:
        # free-port.sh exits 1 when the port is still bound. That is a real
        # problem -- pretending otherwise is how a stale stub gets used.
        return False


def ping_stub(port=None, host=None, timeout=2.0):
    """One real HTTPS request, spoken properly.

    The first version wrote the JSON body straight onto the socket and waited
    for a reply. The stub is an http.server: it parses a request line and
    headers, so raw bytes got no response at all and the probe reported a
    perfectly healthy agent as unreachable — the readiness probe failing in the
    exact way it exists to detect.
    """
    port = int(port or env.STUB_PORT)
    host = host or env.STUB_HOST
    body = json.dumps({'messages': [{'role': 'user', 'content': 'ping'}]}).encode()
    request = (
        b'POST /v1/chat/completions HTTP/1.1\r\n'
        b'Host: 127.0.0.1\r\n'
        b'Content-Type: application/json\r\n'
        b'Content-Length: ' + str(len(body)).encode() + b'\r\n'
        b'Connection: close\r\n\r\n' + body
    )
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE      # the fixture cert is self-signed by design
    try:
        with socket.create_connection((host, port), timeout) as raw:
            with ctx.wrap_socket(raw, server_hostname='127.0.0.1') as s:
                s.settimeout(timeout)
                s.sendall(request)
                return b'HTTP/' in s.recv(32)
    except Exception:
        return False


def wait_for_stub(port=None, host=None, attempts=40, delay=0.25):
    """Retry SEQUENTIALLY. An earlier version issued every attempt at once and
    raced itself."""
    for _ in range(attempts):
        if ping_stub(port, host):
            return True
        time.sleep(delay)
    return False


def start_stub(port=None, host=None):
    """Start the stub and wait for it. Returns (endpoint, stop) — call stop()."""
    port = int(port or env.STUB_PORT)
    host = host or env.STUB_HOST

    if not STUB_SCRIPT.exists():
        raise RuntimeError(f'stub agent missing at {STUB_SCRIPT}')
    if not free_port(port):
        raise RuntimeError(
            f'port {port} is still held by another process. A stub from a '
            'previous run is answering with stale logic; free it and retry.')

    child_env = dict(os.environ, STUB_PORT=str(port), STUB_HOST=host)
    proc = subprocess.Popen([sys.executable, str(STUB_SCRIPT)], env=child_env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            start_new_session=True)
    if not wait_for_stub(port, host):
        free_port(port)
        raise RuntimeError(f'stub agent did not answer on {host}:{port}')
    return f'https://{host}:{port}/v1/chat/completions', lambda: free_port(port)


class stub_agent:
    """Context manager, so teardown is structural rather than remembered.

    with stub_agent() as endpoint:
        ...

    Exiting the block frees the port even if the body raises, which is the
    property the JS side gets from `finally` and the one this pair of files
    exists to guarantee.
    """

    def __init__(self, port=None, host=None):
        self._args = (port, host)
        self.endpoint = None
        self._stop = None

    def __enter__(self):
        self.endpoint, self._stop = start_stub(*self._args)
        return self.endpoint

    def __exit__(self, *exc):
        if self._stop:
            self._stop()
        return False        # never swallow the exception
