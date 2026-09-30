"""Confirm the routing note reaches the screen and the artifact, using a REAL
configured agent — the assertion F28's unit tests cannot make.

F28 covers select_config() and format_for_record() in isolation. This covers the
two ends: the rendered card, and the file written from the server's record.
"""
import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'lib'))
import env  # noqa: E402

sys.path.insert(0, str(env.ROOT / 'prism'))
import adjudicate  # noqa: E402
import agentic     # noqa: E402

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


# A config that claims only the UX lens. The requirements lens is therefore
# UNCLAIMED, which must yield no judge and a reason that explains the fix —
# the case the old first-by-filename code handled by silently picking someone.
CFG.write_text(
    '# f28 probe\n\n'
    '**Title:** UX Judge\n'
    '**Status:** active\n'
    '**Lenses:** ux-bridge-default\n'
    '**Kind:** openai\n'
    f'**Endpoint:** {env.STUB_ENDPOINT}\n'
    '**Model:** stub\n'
    '**Auth env:** PRISM_TEST_KEY\n')

try:
    print('\n== an unclaimed lens gets no judge, and says why ==')
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
    CFG.write_text(
        '# f28 probe\n\n'
        '**Title:** Catch-all Judge\n'
        '**Status:** active\n'
        '**Kind:** openai\n'
        f'**Endpoint:** {env.STUB_ENDPOINT}\n'
        '**Model:** stub\n'
        '**Auth env:** PRISM_TEST_KEY\n')
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
    rec = d3['record']
    for field in ('Clarity:', 'Judged by:', 'Routing:'):
        check(f'the artifact carries {field}', field in rec, rec)
finally:
    try:
        CFG.unlink()
    except OSError:
        pass

print(f'\n{PASS}/{PASS + FAIL} checks passed')
sys.exit(1 if FAIL else 0)
