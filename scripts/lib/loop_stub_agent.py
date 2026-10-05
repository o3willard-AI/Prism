"""Stub agent for the live-agent suites: serves BOTH of Prism's agent judges.

Two callers, one server, discriminated by what the PROMPT looks like:

- An INTERROGATION prompt (built by prism/interrogate.py) gets a question on
  round one and a shape proposal on round two, so a browser suite can walk the
  whole conversation without a language model's judgement in the loop. The
  round is read from the prompt itself — the presence of "=== SO FAR, IN THEIR
  WORDS ===" means answers already exist, which is more honest than counting
  requests, since a retried request must not look like a new round.

- An ADJUDICATION prompt (prism/adjudicate.py) gets at_threshold or
  below_threshold, keyed on "TBD" as before.

TBD is the signal that a document padded with TBD has not been written. An
earlier version keyed on "## Executive Summary", which the hollow and the
revised document both contain — so the good revision was judged below threshold
and the walkthrough failed for a reason that had nothing to do with Prism.
"""
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

# ── Interrogation replies ──────────────────────────────────────────────
# Round 1 asks about the OUTCOME, which is the thing a text box cannot supply.
# Round 2 proposes the shape and stops — a human who has said what the outcome
# is does not need to be asked a third time.
INTERROGATE_Q = json.dumps({
    "verdict": "need_more",
    "proposed_shape": "requirements",
    "shape_reason": "You want something built and fixed, not understood.",
    "understanding": "Large exports fail and someone repairs them by hand every week.",
    "outcome": "an agent can size and specify the chunking fix without re-asking you why.",
    "questions": [
        "What must be true for this export fix to have been worth doing?",
        "Who is the agent that reads the finished lens — and what will it do with it?",
        "Is the manual split a stopgap, or the thing you actually need?"],
    "reasoning": "I can see the failure but not the cost of getting it wrong."})

INTERROGATE_READY = json.dumps({
    "verdict": "ready",
    "proposed_shape": "requirements",
    "shape_reason": "It is a thing to build, with a cost you have now named.",
    "understanding": "Large exports fail and someone repairs them by hand every week.",
    "outcome": "an agent can size and specify the chunking fix without re-asking you why.",
    "questions": [],
    "reasoning": "You have given me the outcome and the cost. That is enough to write down."})


def _is_interrogation(sent: str) -> bool:
    """Discriminate the two judges by their prompt's closing instruction.

    An earlier version also required 'classify' NOT to appear, on the theory
    that /classify was the other caller. It is not — /classify is deterministic
    and never reaches an agent — and the interrogation prompt itself says
    "You are NOT classifying", so the substring was always present and the
    interrogation branch never ran. The stub answered at_threshold to an
    interrogation request, which parsed as an empty verdict.

    One unambiguous marker, no negations: a predicate that must exclude
    something is a predicate that will eventually exclude the wrong thing.
    """
    return '=== YOUR REPLY (JSON only) ===' in sent


class H(BaseHTTPRequestHandler):
    def log_message(self, fmt, *a): pass
    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0))
        try: body = json.loads(self.rfile.read(n) or b'{}')
        except ValueError: body = {}
        sent = ''.join(m.get('content', '') for m in body.get('messages', []))

        if _is_interrogation(sent):
            # The round is a property of the prompt, not of how many times we
            # have been called: a retried round-1 request must still ask.
            payload = (INTERROGATE_READY if '=== SO FAR, IN THEIR WORDS ===' in sent
                       else INTERROGATE_Q)
        else:
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
