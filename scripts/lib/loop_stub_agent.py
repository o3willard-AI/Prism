"""Stub agent for the F24 loop test: returns at_threshold the first time and
below_threshold the second, keyed on a marker in the artifact."""
import json, os, socket, ssl, sys, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn

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
        # A PRD marker means we are judging the second artifact.
        payload = BELOW if '## Executive Summary' in sent else AT
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
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(
        os.environ.get('F24_CA_FILE', '/tmp/fake-cert.pem'),
        os.environ.get('F24_KEY_FILE', '/tmp/fake-key.pem'))
    srv = S(('127.0.0.1', PORT), H)
    srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
    print(f'stub agent on {PORT}', flush=True)
    srv.serve_forever()
