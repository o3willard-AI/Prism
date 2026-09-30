"""A local stand-in for an agent API, so F22 can be tested for real.

It speaks both wire shapes Prism supports (Anthropic messages and
OpenAI-compatible chat completions), and can be told to fail in each of the
ways a real service fails — so the error paths are exercised rather than
assumed.
"""
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(os.environ.get("FAKE_AGENT_PORT", "8099"))
MODE = os.environ.get("FAKE_AGENT_MODE", "ok")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(n) or b"{}")

        # Record what arrived so the test can assert on headers and payload.
        with open(os.environ.get("FAKE_AGENT_LOG", "/tmp/fake-agent.log"), "a") as fh:
            fh.write(json.dumps({
                "path": self.path,
                "auth_header": {k.lower(): v for k, v in self.headers.items()
                                if k.lower() in ("authorization", "x-api-key",
                                                 "anthropic-version")},
                "body": body,
            }) + "\n")

        if MODE == "401":
            return self._send(401, {"error": {"message": "invalid x-api-key"}})
        if MODE == "500":
            return self._send(500, {"error": "upstream exploded"})
        if MODE == "garbage":
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(b"<html>not an api</html>")
            return
        if MODE == "empty":
            return self._send(200, {"choices": []})

        if self.path.endswith("/messages"):
            return self._send(200, {
                "id": "msg_fake_001",
                "type": "message",
                "role": "assistant",
                "model": body.get("model", "fake-model"),
                "content": [{"type": "text", "text": "FAKE REPLY: " + _last_text(body)}],
                "usage": {"input_tokens": 12, "output_tokens": 7},
            })
        return self._send(200, {
            "id": "cmpl_fake_001",
            "object": "chat.completion",
            "model": body.get("model", "fake-model"),
            "choices": [{"index": 0, "finish_reason": "stop",
                         "message": {"role": "assistant",
                                     "content": "FAKE REPLY: " + _last_text(body)}}],
            "usage": {"prompt_tokens": 12, "completion_tokens": 7},
        })

    def _send(self, code, obj):
        raw = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


def _last_text(body):
    """Pull the prompt out of either payload shape."""
    if "messages" in body:
        msgs = body["messages"]
        for m in reversed(msgs):
            c = m.get("content")
            if isinstance(c, str):
                return c
    return ""


if __name__ == "__main__":
    # TLS, because agentic.py refuses an http:// endpoint — a config that
    # would put the key on the wire in the clear. The test therefore has to
    # speak real https to prove the happy path, which is the point: the guard
    # is not something the suite can route around.
    import ssl
    # Repo-relative cert fixtures by default, so the harness runs on a fresh
    # checkout rather than depending on /tmp state from another machine. The
    # variable name matches e2e-verify-f22.py's, which trusts the same file.
    here = os.path.dirname(os.path.abspath(__file__))
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(
        os.environ.get("FAKE_AGENT_CERT", os.path.join(here, "fake-cert.pem")),
        os.environ.get("FAKE_AGENT_KEY", os.path.join(here, "fake-key.pem")),
    )

    # Threaded, NOT single-threaded. A single-threaded HTTPServer handles one
    # connection at a time, so a bare TCP/TLS probe that opens a socket and
    # closes it without sending a request leaves the server blocked inside the
    # TLS handshake — the next real request then hangs, and the readiness
    # check silently passes against a server that is not serving. That is not
    # hypothetical: it is exactly what this test did before it was threaded.
    from socketserver import ThreadingMixIn
    from http.server import ThreadingHTTPServer

    class Server(ThreadingMixIn, HTTPServer):
        daemon_threads = True
        allow_reuse_address = True

    srv = Server(("127.0.0.1", PORT), Handler)
    srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
    srv.serve_forever()
