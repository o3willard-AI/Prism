"""Stub agent for the F24 loop test: returns at_threshold the first time and
below_threshold the second, keyed on a marker in the artifact."""
import json, os, socket, ssl, sys, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from socketserver import ThreadingMixIn

HERE = Path(__file__).resolve().parent
# Repo-relative cert fixtures by default. A /tmp default works only on the box
# that generated it, which is the same non-portable assumption as a hardcoded
# checkout path. Override with F24_CA_FILE / F24_KEY_FILE when needed.
DEFAULT_CERT = str(HERE / 'fake-cert.pem')
DEFAULT_KEY = str(HERE / 'fake-key.pem')

PORT = int(os.environ.get('STUB_PORT', '8400'))

AT = json.dumps({"verdict": "at_threshold", "confidence": 93,
                 "reasoning": "Intent, scope and the failure mode are all clear.",
                 "questions": []})
BELOW = json.dumps({"verdict": "below_threshold", "confidence": 68,
                    "reasoning": "No success metric and no acceptance criteria, so I "
                                 "cannot tell whether this solves the problem.",
                    "questions": [
                        "What baseline and target do you expect for export success?",
                        "Which browsers must the export work in?",
                        "Is a five-minute budget acceptable, or is there a tighter one?"]})

class H(BaseHTTPRequestHandler):
    def log_message(self, fmt, *a): pass
    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0))
        try: body = json.loads(self.rfile.read(n) or b'{}')
        except ValueError: body = {}
        sent = ''.join(m.get('content', '') for m in body.get('messages', []))
        # Judge on the ARTIFACT'S OWN substance, not on a heading that appears
        # in every PRD. An earlier version keyed on "## Executive Summary",
        # which the hollow and the revised document both contain — so the
        # good revision was judged below threshold and the walkthrough failed
        # for a reason that had nothing to do with Prism.
        #
        # TBD is the signal: a document padded with TBD has not been written.
        hollow = 'TBD' in sent
        payload = BELOW if hollow else AT
        raw = json.dumps({"id": "stub", "model": "stub",
                          "choices": [{"index": 0, "finish_reason": "stop",
                                       "message": {"role": "assistant",
                                                   "content": payload}}]}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

class S(ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

if __name__ == '__main__':
    HOST = os.environ.get('STUB_HOST', '127.0.0.1')
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(
        os.environ.get('F24_CA_FILE', DEFAULT_CERT),
        os.environ.get('F24_KEY_FILE', DEFAULT_KEY))
    srv = S((HOST, PORT), H)
    srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
    print(f'stub agent on {HOST}:{PORT}', flush=True)
    srv.serve_forever()
