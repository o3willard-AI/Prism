#!/usr/bin/env python3
"""F24: agent-adjudicated clarity — Prism asks, the agent judges, the answer
is recorded.

SETUP — same as F22, because this suite talks to a fake agent over TLS:

    export PRISM_TEST_KEY="sk-test-FAKE-not-a-real-key"
    export SSL_CERT_FILE=/tmp/fake-cert.pem
    ./scripts/start.sh

    openssl req -x509 -newkey rsa:2048 -keyout /tmp/fake-key.pem \\
        -out /tmp/fake-cert.pem -days 2 -nodes -subj "/CN=127.0.0.1" \\
        -addext 'subjectAltName=IP:127.0.0.1,DNS:localhost'

The suite reads its CA from F24_CA_FILE (or /tmp/fake-cert.pem), NOT from
SSL_CERT_FILE — that variable is already set to a certifi bundle in many
environments, and trusting it makes every handshake fail while the agent is
perfectly healthy. A test bug that looks exactly like a product bug.

Three halves, because the interesting failures are in different places:
  1. The parser — every way a reply can be malformed or contradictory.
  2. The live path against the echo agent — every way the CALL can fail.
  3. The live path against a STUB that returns real verdicts — because the
     echo agent can never exercise the paths that matter. An agent that never
     returns `below_threshold` means the derived-questions half of this
     feature is untested, and that half is the whole point of it.
"""
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = str(Path(__file__).resolve().parent.parent)
sys.path.insert(0, os.path.join(ROOT, 'prism'))

import adjudicate as A  # noqa: E402

API = 'http://127.0.0.1:8082'
ADIR = os.path.join(ROOT, 'prism', 'vault', 'knowledge', 'integrations', 'agentic')
LOG = '/tmp/fake-adj-f24.log'

# The fake agent's CA. NOT read from SSL_CERT_FILE: that variable is already
# set to a certifi bundle in many environments, so trusting it here points the
# test at the wrong CA and every handshake fails while the agent is healthy.
# Set F24_CA_FILE when the cert lives somewhere unusual.
CERT = os.environ.get('F24_CA_FILE', '/tmp/fake-cert.pem')

PASS = FAIL = 0


def check(name, cond, detail=''):
    global PASS, FAIL
    if cond:
        print('  PASS ' + name)
        PASS += 1
    else:
        print('  FAIL ' + name + (f'  — {detail}' if detail else ''))
        FAIL += 1


def section(s):
    print('\n' + s)


def post(path, obj):
    req = urllib.request.Request(API + path, data=json.dumps(obj).encode(),
                                 headers={'Content-Type': 'application/json'},
                                 method='POST')
    try:
        r = urllib.request.urlopen(req)
        return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def start_agent(port, mode):
    env = dict(os.environ, FAKE_AGENT_PORT=str(port), FAKE_AGENT_MODE=mode,
               FAKE_AGENT_LOG=LOG,
               # A DEDICATED variable, not SSL_CERT_FILE. That one is already
               # set to a certifi bundle in many environments (it is here), so
               # reading it silently points the test at the wrong CA and every
               # handshake fails with SSLCertVerificationError while the fake
               # agent itself is perfectly healthy. Prism still uses
               # SSL_CERT_FILE — this is about the TEST not picking up an
               # unrelated value.
               F24_CA_FILE=CERT)
    p = subprocess.Popen([sys.executable, os.path.join(ROOT, 'scripts', 'lib', 'fake_agent.py')],
                         env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    import ssl
    # The same value Prism's own restart uses, so the server and this test
    # agree on which CA to trust.
    cafile = os.environ.get('F24_CA_FILE') or '/tmp/fake-cert.pem'
    ctx = ssl.create_default_context(cafile=cafile)
    for _ in range(80):
        if p.poll() is not None:
            err = p.stderr.read().decode()[:300] if p.stderr else ''
            raise RuntimeError(f'fake agent ({mode}) on {port} exited early: {err}')
        try:
            with ctx.wrap_socket(socket.create_connection(('127.0.0.1', port), 0.5),
                                 server_hostname='127.0.0.1') as s:
                s.sendall(b'POST /v1/ping HTTP/1.0\r\nContent-Length: 2\r\n\r\n{}')
                if s.recv(16):
                    return p
        except Exception:
            time.sleep(0.1)
    p.kill()
    raise RuntimeError(f'fake agent ({mode}) never served on {port}')


def write_cfg(name, port):
    open(os.path.join(ADIR, name + '.md'), 'w').write(
        f'# adj test\n\n**Title:** Fake Adjudicator\n**Status:** active\n'
        f'**Kind:** openai\n**Endpoint:** https://127.0.0.1:{port}/v1/chat/completions\n'
        f'**Model:** fake\n**Auth env:** PRISM_TEST_KEY\n')
    return f'knowledge/integrations/agentic/{name}.md'


def drop_cfg(name):
    try:
        os.remove(os.path.join(ADIR, name + '.md'))
    except OSError:
        pass


def clean():
    for f in os.listdir(ADIR):
        if f.startswith('f24-'):
            os.remove(os.path.join(ADIR, f))


def preflight():
    """Same trap as F22: a missing key looks like a broken product."""
    problems = []
    try:
        urllib.request.urlopen(API + '/agent-configs', timeout=3).read()
    except Exception as e:
        return [f'Prism is not answering on {API} ({e.__class__.__name__}). '
                f'Start it with ./scripts/start.sh']
    probe = os.path.join(ADIR, 'f24-preflight.md')
    try:
        open(probe, 'w').write('# p\n\n**Title:** p\n**Status:** active\n'
                               '**Kind:** openai\n**Endpoint:** https://api.example.com/v1\n'
                               '**Model:** m\n**Auth env:** PRISM_TEST_KEY\n')
        agents = json.loads(urllib.request.urlopen(
            API + '/agent-configs', timeout=5).read())['agents']
        p = next((a for a in agents if a['path'].endswith('f24-preflight.md')), None)
        if p is None:
            problems.append('the probe config did not appear — the server may be stale')
        elif not p.get('has_key'):
            problems.append(
                'The Prism SERVER has no PRISM_TEST_KEY in its environment. Set it and\n'
                '    RESTART Prism:\n'
                '      export PRISM_TEST_KEY="sk-test-FAKE-not-a-real-key"\n'
                '      export SSL_CERT_FILE=/tmp/fake-cert.pem\n'
                '      ./scripts/start.sh')
    finally:
        drop_cfg('f24-preflight')
    if not os.path.exists(CERT):
        problems.append(
            f'No fake-agent certificate at {CERT}. Generate it with openssl req -x509\n'
            "  -newkey rsa:2048 -keyout /tmp/fake-key.pem -out /tmp/fake-cert.pem \\\n"
            "  -days 2 -nodes -subj '/CN=127.0.0.1' \\\n"
            "  -addext 'subjectAltName=IP:127.0.0.1,DNS:localhost'")
    return problems


# ── 1. The parser ──────────────────────────────────────────────────────────
def parser_tests():
    section('Reply parsing — every way an agent reply can be malformed')
    J = json.dumps

    cases = [
        ('clean at_threshold', J({'verdict': 'at_threshold', 'confidence': 92,
                                  'reasoning': 'Intent and scope both clear.',
                                  'questions': []}), 'at_threshold', 92, 0),
        ('clean below_threshold', J({'verdict': 'below_threshold', 'confidence': 88,
                                     'reasoning': 'No success metric.',
                                     'questions': ['What is the baseline?']}),
         'below_threshold', 88, 1),
        ('fenced in markdown', 'Here you go:\n\n```json\n' + J(
            {'verdict': 'at_threshold', 'confidence': 95, 'reasoning': 'ok',
             'questions': []}) + '\n```', 'at_threshold', 95, 0),
        ('prose around json', 'I think it is fine.\n' + J(
            {'verdict': 'at_threshold', 'confidence': 90, 'reasoning': 'ok',
             'questions': []}) + '\nDone.', 'at_threshold', 90, 0),
        ('nested braces in reasoning', J(
            {'verdict': 'at_threshold', 'confidence': 93,
             'reasoning': 'The {scope} and {goal} are clear.', 'questions': []}),
         'at_threshold', 93, 0),
        ('escaped quotes in reasoning', J(
            {'verdict': 'at_threshold', 'confidence': 93,
             'reasoning': 'User said "export" means CSV, not PDF.', 'questions': []}),
         'at_threshold', 93, 0),
        ('questions as objects', J(
            {'verdict': 'below_threshold', 'confidence': 80, 'reasoning': 'gaps',
             'questions': [{'question': 'Which browsers?', 'gap': 'needed for AC'}]}),
         'below_threshold', 80, 1),
        ('null entries in questions', J(
            {'verdict': 'below_threshold', 'confidence': 70, 'reasoning': 'gaps',
             'questions': [None, '', '   ', 'real question?']}),
         'below_threshold', 70, 1),
        ('not json at all', 'This looks pretty good, maybe 80 or so?',
         'uncertain', 0, 0),
        ('empty reply', '', 'uncertain', 0, 0),
        ('unknown verdict', J({'verdict': 'excellent', 'confidence': 90,
                               'reasoning': 'great', 'questions': []}),
         'uncertain', 90, 0),
        ('below_threshold with NO questions', J(
            {'verdict': 'below_threshold', 'confidence': 80,
             'reasoning': 'Something is missing.', 'questions': []}),
         'uncertain', 80, 0),
        ('questions not a list', J(
            {'verdict': 'below_threshold', 'confidence': 70, 'reasoning': 'gaps',
             'questions': 'just one string'}), 'uncertain', 70, 0),
        ('confidence out of range', J(
            {'verdict': 'at_threshold', 'confidence': 5000, 'reasoning': 'x',
             'questions': []}), 'at_threshold', 100, 0),
        ('confidence is a string', J(
            {'verdict': 'at_threshold', 'confidence': 'high', 'reasoning': 'x',
             'questions': []}), 'at_threshold', 0, 0),
        ('confidence is null', J(
            {'verdict': 'at_threshold', 'confidence': None, 'reasoning': 'x',
             'questions': []}), 'at_threshold', 0, 0),
        ('at_threshold WITH questions (agent hedging)', J(
            {'verdict': 'at_threshold', 'confidence': 95, 'reasoning': 'ready',
             'questions': ['Are you sure about the timeline?']}),
         'at_threshold', 95, 0),
    ]

    for name, reply, want_v, want_c, want_q in cases:
        j = A.parse_reply(reply)
        check(f'{name}: verdict is {want_v}', j['verdict'] == want_v, j['verdict'])
        check(f'{name}: confidence is {want_c}', j['confidence'] == want_c,
              str(j['confidence']))
        check(f'{name}: {want_q} question(s)', len(j['questions']) == want_q,
              str(len(j['questions'])))

    section('Parser — the distinctions that prevent a silent pass')
    j = A.parse_reply('not json')
    check('an unparseable reply is never at_threshold',
          j['verdict'] != 'at_threshold')
    check('an unparseable reply sets parse_failed', j['parse_failed'] is True)
    check('an unparseable reply keeps the raw text for a human',
          len(j.get('raw', '')) > 0)

    j = A.parse_reply('not json')
    check('raw is NOT kept on a clean judgment (no 2KB of JSON per artifact)',
          'raw' not in A.parse_reply(json.dumps(
              {'verdict': 'at_threshold', 'confidence': 90, 'reasoning': 'ok',
               'questions': []})))

    j = A.parse_reply(json.dumps({'verdict': 'below_threshold', 'confidence': 60,
                                  'reasoning': 'no metric', 'questions': []}))
    check('below_threshold with no gaps is demoted to uncertain',
          j['verdict'] == 'uncertain')
    check('and the contradiction is flagged', j.get('contradiction') is True)
    check('and the reason explains why it was not allowed to block',
          'No specific gaps' in j['reasoning'], j['reasoning'][:60])

    many = {'verdict': 'below_threshold', 'confidence': 70, 'reasoning': 'gaps',
            'questions': [f'Question {i}?' for i in range(40)]}
    check('a 40-question reply is capped at 12',
          len(A.parse_reply(json.dumps(many))['questions']) == 12,
          str(len(A.parse_reply(json.dumps(many))['questions'])))

    section('The judgment prompt')
    p = A.build_prompt('# PRD content here', 'requirements-default',
                       'THE SKILL: prd-gate.md')
    check('it states the confidence question',
          'confident' in p.lower() and 'intent' in p.lower())
    check('it separates intent from information', '1.' in p and '2.' in p)
    check('it carries the lens threshold', '95%' in p)
    check('it carries the skill the artifact must satisfy', 'prd-gate.md' in p)
    check('it carries the artifact', 'PRD content here' in p)
    check('it asks for JSON', '"verdict"' in p)
    check('it names all three verdicts',
          all(v in p for v in ('at_threshold', 'below_threshold', 'uncertain')))
    check('it requires specific questions, not "please clarify"',
          'please\n  clarify' in p or 'please clarify' in p)
    check('it warns against using below_threshold to stall', 'stalling' in p)
    check('it says substance beats formatting',
          'substance' in p.lower() and 'formatting' in p.lower())
    check('it says uncertain is legitimate, not a failure',
          'legitimate' in p)
    check('a different lens gets a different bar',
          '85%' in A.build_prompt('x', 'hypotheses-default'))

    section('The record written into the artifact')
    j = A.parse_reply(json.dumps({'verdict': 'below_threshold', 'confidence': 88,
                                  'reasoning': 'No metric.',
                                  'questions': ['Baseline?']}))
    j.update({'threshold': 85, 'agent_title': 'Fake Agent'})
    rec = A.format_for_record(j)
    check('it records the verdict and the bar', 'below threshold' in rec and '85%' in rec)
    check('it records WHO judged', 'Fake Agent' in rec)
    check('it records the reasoning', 'No metric.' in rec)
    check('it records the gaps', 'Baseline?' in rec)
    j2 = A.parse_reply('not json')
    j2.update({'threshold': 95, 'agent_title': 'Fake Agent'})
    check('an unparsed reply is recorded as explicitly not gated',
          'not gated' in A.format_for_record(j2))


# ── 2. The live path ───────────────────────────────────────────────────────
def live_tests():
    section('Live path — a real agent, and every way the call can fail')
    clean()
    if os.path.exists(LOG):
        os.remove(LOG)
    agents = []
    try:
        # No integration: the setup gap, reported as such.
        code, d = post('/adjudicate', {'artifact': '# PRD',
                                       'lens': 'requirements-default',
                                       'shape': 'prd-gate'})
        check('with no integration, nothing is judged', d['verdict'] == 'unjudged',
              d['verdict'])
        check('and it says why', 'No agent integration' in (d['agent_error'] or ''),
              str(d['agent_error'])[:60])
        check('and the floor did NOT stand in for a judgment',
              d['floor'] is not None and d['floor'].get('verdict') != 'match',
              str(d['floor'])[:50])
        check('asked=false distinguishes "nobody was asked"',
              d.get('asked') is False)

        # A working agent that replies with non-JSON (it echoes the prompt).
        p1 = start_agent(8200, 'ok')
        agents.append(p1)
        write_cfg('f24-a', 8200)
        code, d = post('/adjudicate', {'artifact': '# PRD\n\n## Executive Summary\nx',
                                       'lens': 'requirements-default',
                                       'shape': 'prd-gate'})
        check('POST /adjudicate responds 200', code == 200, str(code))
        check('an unparseable reply is uncertain, NOT unjudged (we did ask)',
              d['verdict'] == 'uncertain', d['verdict'])
        check('and it is never a silent pass', d['verdict'] != 'at_threshold')
        check('asked=true — the agent was consulted', d.get('asked') is True)
        check('parse_failed is the evidence', d['judgment']['parse_failed'] is True)
        check('the raw reply is kept for a human', len(d['judgment'].get('raw', '')) > 0)
        check('the record says the artifact was not gated',
              'not gated' in (d['record'] or ''), str(d['record'])[:60])
        check('the floor is reported separately', d['floor'] is not None)

        # The judge prompt really reaches the agent.
        rec = [json.loads(l) for l in open(LOG)][-1]
        sent = ''.join(m.get('content', '') for m in rec['body'].get('messages', []))
        check('the judge prompt reached the agent', len(sent) > 300, str(len(sent)))
        check('it carries the requirements threshold', '95%' in sent)
        check('it carries the artifact', 'Executive Summary' in sent)
        check('it names all three verdicts',
              all(v in sent for v in ('at_threshold', 'below_threshold', 'uncertain')))

        post('/adjudicate', {'artifact': 'x', 'lens': 'hypotheses-default'})
        rec2 = [json.loads(l) for l in open(LOG)][-1]
        sent2 = ''.join(m.get('content', '') for m in rec2['body'].get('messages', []))
        check('a different lens uses its own threshold',
              '85%' in sent2 and '95%' not in sent2)

        check('an empty artifact is a 400',
              post('/adjudicate', {'lens': 'requirements-default'})[0] == 400)
        check('a missing lens is a 400',
              post('/adjudicate', {'artifact': 'x'})[0] == 400)

        # The agent is down.
        p1.kill(); p1.wait()
        code, d3 = post('/adjudicate', {'artifact': '# PRD',
                                        'lens': 'requirements-default',
                                        'shape': 'prd-gate'})
        check('a dead agent still returns 200', code == 200, str(code))
        check('a dead agent is unjudged, not a pass', d3['verdict'] == 'unjudged')
        check('and is reported as unreachable',
              'Could not reach' in (d3['agent_error'] or ''), str(d3['agent_error'])[:60])
        check('asked=false when it could not be reached', d3.get('asked') is False)
        check('the floor still runs when the agent is down', d3['floor'] is not None)

        # The agent rejects the call.
        p2 = start_agent(8201, '401')
        agents.append(p2)
        drop_cfg('f24-a')
        write_cfg('f24-b', 8201)
        code, d4 = post('/adjudicate', {'artifact': 'x', 'lens': 'requirements-default'})
        check('a 401 is unjudged', d4['verdict'] == 'unjudged', d4['verdict'])
        check('and the HTTP status is surfaced', '401' in (d4['agent_error'] or ''),
              str(d4['agent_error'])[:60])

        # The service replies with something that is not JSON at all.
        p2.kill(); p2.wait()
        p3 = start_agent(8202, 'garbage')
        agents.append(p3)
        drop_cfg('f24-b')
        write_cfg('f24-c', 8202)
        code, d5 = post('/adjudicate', {'artifact': 'x', 'lens': 'requirements-default'})
        check('a non-JSON service reply is unjudged', d5['verdict'] == 'unjudged')
        check('and says so specifically', 'not JSON' in (d5['agent_error'] or ''),
              str(d5['agent_error'])[:60])
    finally:
        for p in agents:
            p.terminate()
            try:
                p.wait(timeout=3)
            except Exception:
                p.kill()
        clean()


def verdict_tests():
    """A stub that returns REAL verdicts.

    The echo agent can only ever produce parse failures, so without this the
    three verdicts — and specifically the derived-questions half, which is the
    entire point of the feature — would be untested. The stub picks its reply
    from a marker in the artifact, so one server serves all three.
    """
    section('Live verdicts — an agent that actually answers')
    from http.server import BaseHTTPRequestHandler, HTTPServer
    from socketserver import ThreadingMixIn
    import threading
    import ssl as _ssl

    replies = {
        'STUB:AT': json.dumps({
            "verdict": "at_threshold", "confidence": 93,
            "reasoning": "The PRD names the users, the failure mode, and two "
                         "measurable targets. Intent and scope are both clear.",
            "questions": []}),
        'STUB:BELOW': json.dumps({
            "verdict": "below_threshold", "confidence": 71,
            "reasoning": "There is no success metric, so I cannot tell whether "
                         "this solves the problem.",
            "questions": [
                "What baseline and target do you expect for export success?",
                {"question": "Which browsers must the export work in?",
                 "gap": "acceptance criteria cannot be written without it"},
                "Is a 5-minute budget acceptable, or is there a tighter constraint?"]}),
        'STUB:UNCERTAIN': json.dumps({
            "verdict": "uncertain", "confidence": 40,
            "reasoning": "This could be a reporting bug or a data-loss bug. The "
                         "description does not distinguish them.",
            "questions": []}),
    }

    class H(BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            pass

        def do_POST(self):
            n = int(self.headers.get('Content-Length', 0))
            try:
                body = json.loads(self.rfile.read(n) or b'{}')
            except ValueError:
                body = {}
            sent = ''.join(m.get('content', '') for m in body.get('messages', []))
            marker = next((k for k in replies if k in sent), 'STUB:AT')
            raw = json.dumps({
                "id": "stub", "model": "stub-model",
                "choices": [{"index": 0, "finish_reason": "stop",
                             "message": {"role": "assistant",
                                         "content": replies[marker]}}],
            }).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

    class S(ThreadingMixIn, HTTPServer):
        daemon_threads = True
        allow_reuse_address = True

    port = 8300
    ctx = _ssl.SSLContext(_ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(CERT, CERT.replace('cert', 'key'))
    srv = S(('127.0.0.1', port), H)
    srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    for _ in range(50):
        try:
            _ssl.create_default_context(cafile=CERT).wrap_socket(
                socket.create_connection(('127.0.0.1', port), 0.4),
                server_hostname='127.0.0.1').close()
            break
        except Exception:
            time.sleep(0.1)

    open(os.path.join(ADIR, 'f24-stub.md'), 'w').write(
        f'# stub\n\n**Title:** Stub Adjudicator\n**Status:** active\n'
        f'**Kind:** openai\n**Endpoint:** https://127.0.0.1:{port}/v1/chat/completions\n'
        f'**Model:** stub\n**Auth env:** PRISM_TEST_KEY\n')

    try:
        # at_threshold
        _, d = post('/adjudicate', {'artifact': 'STUB:AT\n\nA complete PRD.',
                                    'lens': 'requirements-default', 'shape': 'prd-gate'})
        check('at_threshold: verdict is correct', d['verdict'] == 'at_threshold', d['verdict'])
        check('at_threshold: asked=true', d['asked'] is True)
        check('at_threshold: the agent\'s confidence is carried',
              d['judgment']['confidence'] == 93, str(d['judgment']['confidence']))
        check('at_threshold: the reasoning is carried',
              'measurable targets' in d['judgment']['reasoning'])
        check('at_threshold: no questions are invented',
              d['judgment']['questions'] == [])
        check('at_threshold: the record names the agent and the bar',
              'Stub Adjudicator' in d['record'] and '95%' in d['record'])
        check('at_threshold: no raw JSON stored on a clean judgment',
              'raw' not in d['judgment'])

        # below_threshold — the derived-questions half
        _, d = post('/adjudicate', {'artifact': 'STUB:BELOW\n\nA PRD with no metrics.',
                                    'lens': 'requirements-default', 'shape': 'prd-gate'})
        check('below_threshold: verdict is correct',
              d['verdict'] == 'below_threshold', d['verdict'])
        check('below_threshold: asked=true', d['asked'] is True)
        check('below_threshold: the agent\'s confidence (71) is carried',
              d['judgment']['confidence'] == 71, str(d['judgment']['confidence']))
        check('below_threshold: THREE derived questions came back',
              len(d['judgment']['questions']) == 3,
              str(len(d['judgment']['questions'])))
        qs = ' '.join(d['judgment']['questions'])
        check('a question is concrete, not generic',
              'baseline' in qs.lower() and 'more detail' not in qs.lower(), qs[:70])
        check('a {question, gap} object keeps the gap it closes',
              'closes: acceptance criteria' in qs, qs[:110])
        check('below_threshold: the record lists the gaps for the human',
              'Gaps the agent identified' in d['record'], d['record'][:110])
        check('below_threshold: the record keeps the agent\'s reasoning',
              'no success metric' in d['record'].lower())

        # uncertain
        _, d = post('/adjudicate', {'artifact': 'STUB:UNCERTAIN\n\nAmbiguous.',
                                    'lens': 'requirements-default'})
        check('uncertain: verdict is uncertain, NOT unjudged',
              d['verdict'] == 'uncertain', d['verdict'])
        check('uncertain: asked=true — this is an opinion, not an absence',
              d['asked'] is True)
        check('uncertain: the reasoning explains why it cannot tell',
              'does not distinguish' in d['judgment']['reasoning'])
        check('uncertain: no questions are invented',
              d['judgment']['questions'] == [])

        # a per-lens bar reaches a real judgment
        _, d = post('/adjudicate', {'artifact': 'STUB:AT', 'lens': 'hypotheses-default'})
        check('a real judgment uses ITS lens bar (85%, not 95%)',
              '85%' in d['record'] and '95%' not in d['record'], d['record'][:80])
    finally:
        srv.shutdown()
        drop_cfg('f24-stub')


# ── 3. Source posture ───────────────────────────────────────────────────────
def source_tests():
    section('Source — the floor is demoted and cannot approve')
    api = open(os.path.join(ROOT, 'prism', 'api-server.py')).read()
    adj = open(os.path.join(ROOT, 'prism', 'adjudicate.py')).read()
    check('the floor is computed but never sets the verdict',
          'floor' in api and 'verdict = adjudicate.UNJUDGED' in api)
    check('the verdict comes from the judgment, never the floor',
          '"verdict": verdict' in api and 'judgment["verdict"]' in api)
    check('an unknown shape degrades rather than crashing the floor',
          'unknown shape' in api)
    check('the docstring records that the old ratio was never a judgment',
          'number was never computed' in adj)
    check('the module documents that Prism does not fake a judgment when absent',
          'does not fall back to pretending' in adj or 'honestly absent' in api)
    check('unjudged and uncertain are distinct constants',
          'UNJUDGED = "unjudged"' in adj and 'UNCERTAIN = "uncertain"' in adj)


def main():
    problems = preflight()
    if problems:
        print('F24 cannot run — the environment is not set up:\n')
        for p in problems:
            print('  * ' + p)
        print('\nSee the SETUP section at the top of this file.')
        sys.exit(2)

    parser_tests()
    live_tests()
    verdict_tests()
    source_tests()

    section('Cleanup')
    leftover = [f for f in os.listdir(ADIR) if f.startswith('f24-')]
    check('no test config is left in the vault', not leftover, ', '.join(leftover))
    today = time.strftime('%Y-%m-%d')
    residue = []
    for d in ['requirements', 'hypotheses', 'rationalizations', 'source/unordereds']:
        p = os.path.join(ROOT, 'prism', 'vault', d)
        if os.path.isdir(p):
            residue += [f'{d}/{f}' for f in os.listdir(p) if f.startswith(today + '-')]
    check('no lens or source residue', not residue, ', '.join(residue[:5]))

    print(f'\n{PASS}/{PASS + FAIL} checks passed')
    sys.exit(1 if FAIL else 0)


if __name__ == '__main__':
    main()
