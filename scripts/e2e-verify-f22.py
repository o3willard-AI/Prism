"""F22 agent-integration probe.

SETUP — the suite needs a SERVER started with two environment variables, and
without them it fails for reasons that look like product bugs:

    export PRISM_TEST_KEY="sk-test-FAKE-not-a-real-key"
    export SSL_CERT_FILE=scripts/lib/fake-cert.pem   # trust the fake agent's cert
    ./scripts/start.sh

`PRISM_TEST_KEY` because agentic.py resolves a key from the *server's*
environment at call time. Setting it in this process proves nothing — the
server never sees it, and every "call succeeds" check fails with "No API key
found", which reads like a broken product rather than a missing test var.

`SSL_CERT_FILE` because the fake agent speaks TLS. agentic.py refuses an
http:// endpoint — correctly, since that would put the key on the wire in the
clear — so the suite must trust the fake agent's self-signed cert.

A self-signed cert for 127.0.0.1 is committed at scripts/lib/fake-cert.pem
(+ fake-key.pem), so a fresh checkout needs no /tmp setup. To regenerate:
    openssl req -x509 -newkey rsa:2048 -keyout scripts/lib/fake-key.pem \\
        -out scripts/lib/fake-cert.pem -days 3650 -nodes -subj "/CN=127.0.0.1" \\
        -addext 'subjectAltName=IP:127.0.0.1,DNS:localhost'

If you see "No API key found" or "certificate verify failed" in the output,
it is this, not the code. A full pass is 41/41.

Each error mode runs on its OWN PORT. Trying to rebind one port between
modes proved unreliable here: the old process's socket lingered, the next
mode could not bind, and the test then silently talked to the previous
mode — so a "401" check was really asserting against a 200. Distinct ports
remove the whole class of problem.
"""
import json, os, sys, time, socket, subprocess, urllib.request, urllib.error
from pathlib import Path

# Resolve the repo from this file rather than hardcoding a home directory.
# A hardcoded /home/<user>/ path is why a fresh clone on another machine
# cannot run this suite at all.
ROOT = str(Path(__file__).resolve().parent.parent)
sys.path.insert(0, os.path.join(ROOT, 'prism'))

API = os.environ.get('PRISM_API', 'http://127.0.0.1:8082')
AGENT_DIR = ROOT + '/prism/vault/knowledge/integrations/agentic'
LOG = os.environ.get('FAKE_AGENT_LOG', '/tmp/fake-agent.log')
BASE_PORT = int(os.environ.get('FAKE_AGENT_PORT', '8100'))
# A self-signed 127.0.0.1 cert is committed at scripts/lib/fake-cert.pem so the
# suite runs on a fresh checkout with no /tmp state left over from a previous
# machine. Override with FAKE_AGENT_CERT.
CERT = os.environ.get('FAKE_AGENT_CERT', os.path.join(ROOT, 'scripts', 'lib', 'fake-cert.pem'))

PASS = FAIL = 0

def preflight():
    """Fail loudly and specifically if the environment is not set up.

    Without this the suite reports a scatter of product-looking failures
    ("No API key found", "certificate verify failed") for what is actually a
    missing test variable. That misdiagnosis is expensive: the obvious
    reaction is to debug agentic.py, which is correct code.
    """
    problems = []
    # 1. Is the server up at all?
    try:
        urllib.request.urlopen(API + '/agent-configs', timeout=3).read()
    except Exception as e:
        problems.append(
            f'Prism is not answering on {API} ({e.__class__.__name__}). '
            f'Start it with ./scripts/start.sh')
        return problems

    # 2. Does the SERVER have the test key in ITS environment? This suite's
    #    configs do not exist yet at preflight time, so asking /agent-configs
    #    whether one names PRISM_TEST_KEY would always say no. Instead, ship
    #    the example config's env var through the server: create a throwaway
    #    config, ask, remove it. Checking os.environ HERE would prove nothing
    #    — the key is read by the server process.
    probe_rel = 'knowledge/integrations/agentic/preflight-probe.md'
    probe_abs = os.path.join(AGENT_DIR, 'preflight-probe.md')
    try:
        with open(probe_abs, 'w') as fh:
            fh.write('# preflight probe\n\n**Title:** probe\n**Status:** active\n'
                     '**Kind:** openai\n**Endpoint:** https://api.example.com/v1\n'
                     '**Model:** m\n**Auth env:** PRISM_TEST_KEY\n')
        agents = json.loads(urllib.request.urlopen(
            API + '/agent-configs', timeout=5).read())['agents']
        probe = next((a for a in agents if a['path'] == probe_rel), None)
        if probe is None:
            problems.append(
                'The probe config did not appear in /agent-configs — the server '
                'may be running an older build.')
        elif not probe.get('has_key'):
            problems.append(
                'The Prism SERVER has no PRISM_TEST_KEY in its environment. '
                'Set it and RESTART the server:\n'
                '    export PRISM_TEST_KEY="sk-test-FAKE-not-a-real-key"\n'
                '    export SSL_CERT_FILE=scripts/lib/fake-cert.pem\n'
                '    ./scripts/start.sh\n'
                '(Exporting it after startup does nothing — agentic.py reads '
                'the key from the server process at call time.)')
    finally:
        try:
            os.remove(probe_abs)
        except OSError:
            pass

    # 3. Is the fake agent's cert present and trusted?
    cert = os.environ.get('SSL_CERT_FILE', CERT)
    if not os.path.exists(cert):
        problems.append(
            f'No fake-agent certificate at {cert}. One is committed at '
            f'{CERT}, so a fresh checkout needs no setup; regenerate it with:\n'
            "    openssl req -x509 -newkey rsa:2048 -keyout scripts/lib/fake-key.pem \\\n"
            "        -out scripts/lib/fake-cert.pem -days 3650 -nodes -subj '/CN=127.0.0.1' \\\n"
            "        -addext 'subjectAltName=IP:127.0.0.1,DNS:localhost'\n"
            '    export SSL_CERT_FILE=scripts/lib/fake-cert.pem   # before starting Prism')
    return problems

def check(name, cond, detail=''):
    global PASS, FAIL
    if cond:
        print(f'  PASS {name}'); PASS += 1
    else:
        print(f'  FAIL {name}' + (f'  — {detail}' if detail else '')); FAIL += 1

def post(path, obj):
    req = urllib.request.Request(API + path, data=json.dumps(obj).encode(),
                                 headers={'Content-Type': 'application/json'}, method='POST')
    try:
        return urllib.request.urlopen(req).status, json.loads(urllib.request.urlopen(req).read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())

def get(path):
    return json.loads(urllib.request.urlopen(API + path).read())

_running = []
def start_agent(port, mode):
    env = dict(os.environ, FAKE_AGENT_PORT=str(port), FAKE_AGENT_MODE=mode, FAKE_AGENT_LOG=LOG)
    p = subprocess.Popen([sys.executable, ROOT + '/scripts/lib/fake_agent.py'], env=env,
                         stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    _running.append(p)
    import ssl
    ctx = ssl.create_default_context(cafile=CERT)
    for _ in range(80):
        if p.poll() is not None:
            raise RuntimeError(f'fake agent({mode}) on {port} exited early')
        try:
            with ctx.wrap_socket(socket.create_connection(('127.0.0.1', port), 0.5),
                                 server_hostname='127.0.0.1') as s:
                s.sendall(b'POST /v1/ping HTTP/1.0\r\nContent-Length: 2\r\n\r\n{}')
                if s.recv(16):
                    return p
        except Exception:
            time.sleep(0.1)
    p.kill()
    raise RuntimeError(f'fake agent({mode}) on {port} never served')

def write_cfg(name, **fields):
    body = '\n'.join(f'**{k}:** {v}' for k, v in fields.items())
    with open(f'{AGENT_DIR}/{name}.md', 'w') as fh:
        fh.write(f'# test\n\n{body}\n\n---\n\nbody\n')
    return f'knowledge/integrations/agentic/{name}.md'

def clean():
    for f in os.listdir(AGENT_DIR):
        if f.startswith('t-'):
            os.remove(os.path.join(AGENT_DIR, f))

# Preflight BEFORE anything else. Failing fast with a setup message beats
# emitting forty failures that all say "No API key found".
_problems = preflight()
if _problems:
    print('F22 cannot run — the environment is not set up:\n')
    for p in _problems:
        print('  * ' + p)
    print('\nSee the SETUP section at the top of this file.')
    sys.exit(2)

# Deliberately NOT setting os.environ['PRISM_TEST_KEY'] here. The key is read
# by the SERVER process, so setting it in this test process achieves nothing
# and used to disguise the real problem. preflight() asks the server instead.
clean()
ok_port = BASE_PORT
ok = start_agent(ok_port, 'ok')

try:
    import agentic
    print('== config validation ==')
    rel = write_cfg('t-http', Title='x', Status='active', Kind='openai',
                    Endpoint=f'http://127.0.0.1:{ok_port}/v1/chat/completions',
                    Model='m', Auth_env='PRISM_TEST_KEY')
    try:
        agentic.load_config(rel); got, err = True, ''
    except agentic.AgentConfigError as e:
        got, err = False, str(e)
    check('an http endpoint is REFUSED', not got, err)
    check('the refusal explains why', 'https' in err, err)

    rel = write_cfg('t-ok', Title='Fake OpenAI', Status='active', Kind='openai',
                    Endpoint=f'https://127.0.0.1:{ok_port}/v1/chat/completions',
                    Model='fake-model', Auth_env='PRISM_TEST_KEY')
    cfg = agentic.load_config(rel)
    check('a valid config loads', cfg['endpoint'].startswith('https://'))
    # has_key is resolved by whoever LOADS the config. In this process that
    # answer is meaningless — the key lives in the server's environment, and
    # asserting on a local load used to fail for exactly that reason. Ask the
    # server, which is the only process whose answer matters.
    _listed = json.loads(urllib.request.urlopen(API + '/agent-configs', timeout=5).read())['agents']
    _mine = next((a for a in _listed if a['path'] == rel), None)
    check('the server reports has_key=true for a config whose env var is set',
          _mine is not None and _mine.get('has_key') is True,
          json.dumps(_mine) if _mine else 'not listed')
    check('the key value never appears in the config', 'sk-test' not in json.dumps(cfg))

    print('\n== secrets can never be written into a config ==')
    for name, fields, want in [
        ('t-secret', dict(Title='x', Status='active',
                          Endpoint='https://api.example.com/v1', Api_key='sk-REAL'),
         'auth_env'),
        ('t-bogus', dict(Title='x', Status='active',
                         Endpoint='https://api.example.com/v1',
                         Auth_env='sk-ant-A-KEY-NOT-A-VARNAME'), ''),
        ('t-typo', dict(Title='x', Status='active', Kind='openai',
                        Endpoint='https://api.example.com/v1', Authe_env='X'),
         'authe_env'),
    ]:
        rel = write_cfg(name, **fields)
        try:
            agentic.load_config(rel); got, err = True, ''
        except agentic.AgentConfigError as e:
            got, err = False, str(e)
        check(f'{name[2:]}: is rejected', not got, err)
        if want:
            check(f'{name[2:]}: the error names the field', want in err, err)

    print('\n== draft cannot be invoked ==')
    rel = write_cfg('t-draft', Title='D', Status='draft', Kind='openai',
                    Endpoint=f'https://127.0.0.1:{ok_port}/v1/chat/completions',
                    Model='m', Auth_env='PRISM_TEST_KEY')
    code, body = post('/agent-invoke', {'agent': rel, 'prompt': 'x'})
    check('a draft refuses to be called', code == 502, code)
    check('the refusal names the status', 'draft' in str(body.get('error', '')).lower())

    print('\n== a real call, OpenAI wire shape ==')
    os.path.exists(LOG) and os.remove(LOG)
    rel = write_cfg('t-ok', Title='Fake OpenAI', Status='active', Kind='openai',
                    Endpoint=f'https://127.0.0.1:{ok_port}/v1/chat/completions',
                    Model='fake-model', Auth_env='PRISM_TEST_KEY',
                    System_prompt='You are a lens skill runner.')
    code, body = post('/agent-invoke', {'agent': rel, 'prompt': 'PROBE PROMPT TEXT'})
    check('the call succeeds', code == 200, f'{code} {body}')
    check('the reply comes back', 'FAKE REPLY' in str(body.get('text', '')), body)
    check('the prompt reached the agent', 'PROBE PROMPT TEXT' in str(body.get('text', '')))
    check('elapsed is reported', body.get('elapsed_ms', -1) >= 0)
    if os.path.exists(LOG):
        rec = [json.loads(l) for l in open(LOG)][-1]
        h = rec['auth_header']
        check('the key travelled as a bearer token',
              'bearer' in str(h.get('authorization', '')).lower(), h)
        msgs = rec['body'].get('messages', [])
        check('the system prompt is a system message', msgs and msgs[0]['role'] == 'system')
        check('the user prompt is last', msgs and msgs[-1]['content'] == 'PROBE PROMPT TEXT')
    lp = body.get('log_path')
    if lp and os.path.exists(ROOT + '/prism/vault/' + lp):
        txt = open(ROOT + '/prism/vault/' + lp).read()
        check('the call is logged with the prompt', 'PROBE PROMPT TEXT' in txt)
        check('the call is logged with the response', 'FAKE REPLY' in txt)
        check('the log records completion', 'Status:** completed' in txt)
    else:
        check('the ledger file exists', False, lp)

    print('\n== a real call, Anthropic wire shape ==')
    os.path.exists(LOG) and os.remove(LOG)
    ap = BASE_PORT + 1
    a2 = start_agent(ap, 'ok')
    rel = write_cfg('t-anth', Title='Fake Anthropic', Status='active', Kind='anthropic',
                    Endpoint=f'https://127.0.0.1:{ap}/v1/messages', Model='fake-model',
                    Auth_env='PRISM_TEST_KEY', Auth_header='x-api-key', Auth_prefix='',
                    System_prompt='You are a lens skill runner.')
    code, body = post('/agent-invoke', {'agent': rel, 'prompt': 'ANTHROPIC PROBE'})
    check('the anthropic-shaped call succeeds', code == 200, f'{code} {body}')
    check('the reply is parsed', 'FAKE REPLY' in str(body.get('text', '')), body)
    if os.path.exists(LOG):
        rec = [json.loads(l) for l in open(LOG)][-1]
        h, b = rec['auth_header'], rec['body']
        check('x-api-key is used, not Authorization',
              'sk-test' in str(h.get('x-api-key', '')), h)
        check('anthropic-version is sent', bool(h.get('anthropic-version')), h)
        check('system is TOP-LEVEL, not inside messages',
              'system' in b and all('system' not in m for m in b['messages']))
        check('max_tokens is set', b.get('max_tokens', 0) > 0)

    print('\n== error paths, each actionable (own port per mode) ==')
    for i, (mode, want) in enumerate([('401', '401'), ('500', '500'),
                                      ('garbage', 'not json'), ('empty', 'recognise')]):
        port = BASE_PORT + 10 + i
        start_agent(port, mode)
        rel = write_cfg(f't-err{i}', Title='E', Status='active', Kind='openai',
                        Endpoint=f'https://127.0.0.1:{port}/v1/chat/completions',
                        Model='m', Auth_env='PRISM_TEST_KEY')
        code, body = post('/agent-invoke', {'agent': rel, 'prompt': 'X'})
        err = str(body.get('error', ''))
        check(f'{mode}: fails 502 with a useful message',
              code == 502 and want in err.lower(), f'{code} {err[:90]}')

    print('\n== missing key ==')
    os.environ.pop('PRISM_TEST_KEY', None)
    rel = write_cfg('t-nokey', Title='N', Status='active', Kind='openai',
                    Endpoint=f'https://127.0.0.1:{ok_port}/v1/chat/completions',
                    Model='m', Auth_env='PRISM_TEST_KEY_MISSING')
    code, body = post('/agent-invoke', {'agent': rel, 'prompt': 'X'})
    err = str(body.get('error', ''))
    check('a missing key is refused, not attempted', code == 502, code)
    check('the message names the var and says restart',
          'PRISM_TEST_KEY_MISSING' in err and 'restart' in err.lower(), err)
    os.environ['PRISM_TEST_KEY'] = 'sk-test-FAKE-not-a-real-key'

    print('\n== has_key is reported without leaking ==')
    rel = write_cfg('t-haskey', Title='k', Status='active', Kind='openai',
                    Endpoint='https://api.example.com/v1', Model='m',
                    Auth_env='PRISM_TEST_KEY')
    agents = get('/agent-configs')['agents']
    me = [a for a in agents if a['path'] == rel]
    check('the config is listed', bool(me), [a['path'] for a in agents])
    check('has_key is a boolean', me and isinstance(me[0]['has_key'], bool))
    check('the listing never contains the key', 'sk-test' not in json.dumps(agents))

    print('\n== bad requests ==')
    for label, payload, want in [
        ('no agent named', {'prompt': 'x'}, 400),
        ('no prompt', {'agent': rel}, 400),
        ('a missing config', {'agent': 'knowledge/integrations/agentic/nope.md', 'prompt': 'x'}, 400),
        ('a config outside the agentic dir', {'agent': 'knowledge/agents/ux-bridge.md', 'prompt': 'x'}, 400),
    ]:
        code, _ = post('/agent-invoke', payload)
        check(f'{label} is a {want}', code == want, code)
finally:
    for p in _running:
        p.terminate()
        try: p.wait(timeout=3)
        except Exception:
            p.kill()
    clean()
    # remove ledger files this probe created
    lc = ROOT + '/prism/vault/ingestion/agent-calls'
    if os.path.isdir(lc):
        for f in os.listdir(lc):
            os.remove(os.path.join(lc, f))

print(f'\n{PASS}/{PASS + FAIL} checks passed')
sys.exit(1 if FAIL else 0)
