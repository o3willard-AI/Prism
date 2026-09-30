"""Routing, end to end, against a REAL configured agent — the assertion F28's
unit tests cannot make.

F28 covers select_config() and format_for_record() in isolation. This covers the
two ends: what the API actually returns, and the record string the client writes
into the artifact verbatim.

Self-contained: it starts the stub agent itself (scripts/lib/stub_agent.py, the
Python mirror of stub-agent.js) and tears it down by port on the way out. It
previously assumed a human had started one, which is why the test runner had to
do it from outside -- the last piece of "runs anywhere" resting on my
orchestration script rather than on the repo.
"""
import json
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'lib'))
import env  # noqa: E402

# The stub lifecycle, shared with the JavaScript suites. Python cannot import a
# JS module, so stub_agent.py mirrors stub-agent.js; both read the same
# STUB_PORT from the same env module and call the same free-port.sh, so there is
# only one place either can be wrong about the port.
import stub_agent  # noqa: E402

sys.path.insert(0, str(env.ROOT / 'prism'))
import agentic  # noqa: E402

CFG_DIR = Path(agentic.__file__).parent / 'vault' / str(agentic.AGENT_DIR)
CFG = CFG_DIR / 'f28-probe.md'

PASS = FAIL = 0


def check(name, cond, detail=''):
    global PASS, FAIL
    if cond:
        print(f'  PASS {name}')
        PASS += 1
    else:
        print(f'  FAIL {name}' + (f'  — {detail}' if detail else ''))
        FAIL += 1


def post(path, payload):
    req = urllib.request.Request(env.API + path,
                                 data=json.dumps(payload).encode(),
                                 headers={'Content-Type': 'application/json'})
    return json.load(urllib.request.urlopen(req))


def arm(title, lenses, endpoint):
    """Write an agent config. The endpoint comes from the LIVE stub, never from
    a re-derivation of host and port — two spellings of one URL is how they
    drift apart and leave the config pointing at nothing."""
    body = [f'# f28 probe', '',
            f'**Title:** {title}', '**Status:** active']
    if lenses:
        body.append('**Lenses:** ' + ', '.join(lenses))
    body += ['**Kind:** openai', f'**Endpoint:** {endpoint}',
             '**Model:** stub', '**Auth env:** PRISM_TEST_KEY']
    CFG.write_text('\n'.join(body) + '\n')


def run(endpoint):
    print('\n== an unclaimed lens gets no judge, and says why ==')
    # Claims only the UX lens, so requirements-default is UNCLAIMED. The old
    # first-by-filename code handled this by silently picking someone.
    arm('UX Judge', ['ux-bridge-default'], endpoint)
    d = post('/adjudicate', {'lens': 'requirements-default',
                             'artifact': '# PRD\n\n## Executive Summary\nx\n',
                             'threshold': 95})
    check('nothing was judged', d.get('asked') is False, json.dumps(d)[:200])
    check('the selection is reported as unclaimed',
          d.get('selection', {}).get('selection') == 'unclaimed',
          json.dumps(d.get('selection')))
    check('the reason names the lens',
          'requirements-default' in d['selection']['why'], d['selection']['why'])
    check('and the reason says how to fix it',
          'lenses:' in d['selection']['why'], d['selection']['why'])
    check('the response explains the consequence',
          'floor only' in (d.get('agent_error') or ''), d.get('agent_error'))

    print('\n== the claimed lens does get judged ==')
    d2 = post('/adjudicate', {'lens': 'ux-bridge-default',
                              'artifact': '# UX Hand-off Specification\n\n'
                                          '## Core Objective & Problem Statement\nx\n',
                              'threshold': 95})
    check('the UX lens was judged', d2.get('asked') is True, json.dumps(d2)[:200])
    check('and it is an explicit selection',
          d2.get('selection', {}).get('selection') == 'explicit',
          json.dumps(d2.get('selection')))
    check('the judge is the one that claimed it',
          (d2.get('judgment') or {}).get('agent_title') == 'UX Judge',
          str((d2.get('judgment') or {}).get('agent_title')))
    check('an explicit route adds no Routing line to the record',
          'Routing:' not in (d2.get('record') or ''), d2.get('record'))

    print('\n== a fallback route is recorded in the artifact ==')
    # No `lenses:` at all — the original single-agent setup.
    arm('Catch-all Judge', None, endpoint)
    d3 = post('/adjudicate', {'lens': 'requirements-default',
                              'artifact': '# PRD\n\n## Executive Summary\nx\n',
                              'threshold': 95})
    check('the unscoped config judged it', d3.get('asked') is True,
          json.dumps(d3)[:200])
    check('and it is disclosed as a fallback',
          d3['selection']['selection'] == 'fallback', json.dumps(d3['selection']))
    check('the record carries the Routing line',
          'Routing:' in (d3.get('record') or ''), d3.get('record'))
    check('the recorded reason is the human sentence',
          d3['selection']['why'] in d3['record'], d3.get('record'))
    check('the judgment is still recorded alongside it',
          'Judged by:' in d3['record'] and 'Clarity:' in d3['record'],
          d3.get('record'))

    print('\n== the record the client writes verbatim is complete ==')
    for field in ('Clarity:', 'Judged by:', 'Routing:'):
        check(f'the artifact carries {field}', field in d3['record'], d3['record'])


try:
    with stub_agent.stub_agent() as endpoint:
        print(f'\nstub agent: {endpoint}')
        run(endpoint)
finally:
    try:
        CFG.unlink()
    except OSError:
        pass

print(f'\n{PASS}/{PASS + FAIL} checks passed')
sys.exit(1 if FAIL else 0)
