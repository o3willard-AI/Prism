"""Direct-module teeth for F31.

The HTTP checks in e2e-verify-f31.py cannot catch four of the eight mutations,
because a broken module still returns HTTP 200 and the handler catches the
exception: an unavailable agent faked as "ready" simply falls through to
agentic.invoke(None), which raises, which the handler converts back into
"unavailable". The suite is green for a reason unrelated to the promise it
claims to test.

So these call interrogate() directly with a stubbed agent. That is the only way
to assert what the module RETURNS rather than what the transport survives.
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'lib'))
import env  # noqa: E402

sys.path.insert(0, str(env.ROOT / 'prism'))
import adjudicate   # noqa: E402
import interrogate  # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=''):
    global PASS, FAIL
    if cond:
        print(f'  PASS {name}')
        PASS += 1
    else:
        print(f'  FAIL {name}' + (f'  — {detail}' if detail else ''))
        FAIL += 1


def json_val(x):
    import json
    return json.dumps(x)[:140]


def with_no_config(fn):
    """Run fn with every eligible agent config removed from consideration."""
    real = adjudicate.select_config
    adjudicate.select_config = lambda lens: (None, {'selection': 'none',
                                                    'why': 'none configured'})
    try:
        return fn()
    finally:
        adjudicate.select_config = real


def run(reply, answers=None):
    """interrogate() with a stubbed agent returning `reply`."""
    real_cfg, real_invoke = adjudicate.select_config, interrogate.agentic.invoke
    adjudicate.select_config = lambda lens: (
        {'name': 'probe', 'title': 'Probe', 'kind': 'openai',
         'endpoint': 'https://127.0.0.1:1/v1', 'model': 'stub',
         'api_key_env': 'X'},
        {'selection': 'exact_lens', 'why': 'test'},
    )
    interrogate.agentic.invoke = lambda cfg, prompt: {
        'text': reply, 'model': 'stub', 'elapsed_ms': 1,
    }
    try:
        return interrogate.interrogate('a raw thought', answers or [], '')
    finally:
        adjudicate.select_config = real_cfg
        interrogate.agentic.invoke = real_invoke


print('== an unconfigured agent is UNAVAILABLE, and never "ready" ==')
r = with_no_config(lambda: interrogate.interrogate('a raw thought', [], ''))
check('asked is false', r.get('asked') is False, json_val(r))
check('the verdict is "unavailable"', r.get('verdict') == 'unavailable',
      str(r.get('verdict')))
check('it is NOT "ready"', r.get('verdict') != 'ready', str(r.get('verdict')))
check('no questions were invented', r.get('questions') == [], str(r.get('questions')))
check('no shape was proposed', r.get('proposed_shape') is None,
      str(r.get('proposed_shape')))
check('and it says why, in words',
      # Deliberately not the exact wording: the REASON comes from
      # select_config and varies ("no integrations" vs "none active and
      # keyed"). What matters is that a human is told, in English, why there
      # is no agent — not that the sentence is byte-identical.
      'none configured' in (r.get('agent_error') or '')
      or 'No agent integration' in (r.get('agent_error') or ''),
      (r.get('agent_error') or '')[:80])
check('and refuses to fake it',
      'not a substitute' in (r.get('agent_error') or ''),
      (r.get('agent_error') or '')[-60:])

print('\n== an unreadable reply is never consent ==')
for label, reply in [('prose', 'I think it depends on the weather'),
                     ('a JSON array', '[1,2,3]'),
                     ('nothing at all', ''),
                     ('truncated JSON', '{"verdict": "need_more", "quest')]:
    r = run(reply)
    check(f'{label} -> unclear, not ready', r.get('verdict') == 'unclear',
          f"{label}: {r.get('verdict')}")
    check(f'{label} is flagged parse_failed', r.get('parse_failed') is True,
          f"{label}: {r.get('parse_failed')}")

print('\n== only a well-formed "ready" is ready ==')
r = run('{"verdict":"ready","questions":[],"understanding":"u","outcome":"o",'
        '"proposed_shape":"requirements","shape_reason":"because"}')
check('a real "ready" is honoured', r.get('verdict') == 'ready', str(r.get('verdict')))
check('and it is NOT flagged parse_failed', r.get('parse_failed') is False,
      str(r.get('parse_failed')))
check('and it still needs no questions', r.get('questions') == [], str(r.get('questions')))

print('\n== a shape the desk has no door for is dropped ==')
r = run('{"verdict":"ready","proposed_shape":"interpretive-dance"}')
check('an invented shape is normalised to None', r.get('proposed_shape') is None,
      str(r.get('proposed_shape')))
check('and it is not in the known set',
      r.get('proposed_shape') not in interrogate.SHAPES,
      str(r.get('proposed_shape')))
r = run('{"verdict":"ready","proposed_shape":"REQUIREMENTS"}')
check('a real shape survives case and whitespace',
      r.get('proposed_shape') == 'requirements', str(r.get('proposed_shape')))

print('\n== the round bound is real, and told to the human ==')
last = [{'question': f'q{i}', 'answer': f'a{i}'}
        for i in range(interrogate.MAX_ROUNDS - 1)]
r = run('{"verdict":"need_more","questions":["more?"]}', last)
check(f'round {interrogate.MAX_ROUNDS} is flagged at_last_round',
      r.get('at_last_round') is True, str(r.get('at_last_round')))
check('and the round number is reported',
      r.get('round') == interrogate.MAX_ROUNDS, str(r.get('round')))
check('and the bound is reported so a client can show it',
      r.get('max_rounds') == interrogate.MAX_ROUNDS, str(r.get('max_rounds')))
r2 = run('{"verdict":"need_more","questions":["more?"]}',
         last[:interrogate.MAX_ROUNDS - 2])
check(f'round {interrogate.MAX_ROUNDS - 1} is NOT flagged',
      r2.get('at_last_round') is False, str(r2.get('at_last_round')))

print('\n== the agent is actually asked, with the whole exchange ==')
seen = {}
real_invoke = interrogate.agentic.invoke
interrogate.agentic.invoke = lambda cfg, prompt: (
    seen.update(prompt=prompt) or {'text': '{"verdict":"ready"}', 'model': 's',
                                   'elapsed_ms': 1})
try:
    real_cfg = adjudicate.select_config
    adjudicate.select_config = lambda lens: (
        {'name': 'p', 'title': 'P', 'kind': 'openai',
         'endpoint': 'https://127.0.0.1:1/v1', 'model': 's', 'api_key_env': 'X'},
        {'selection': 'exact_lens', 'why': 't'})
    interrogate.interrogate('THE THOUGHT', [{'question': 'THE QUESTION',
                                             'answer': 'THE ANSWER'}], '')
finally:
    interrogate.agentic.invoke = real_invoke
    adjudicate.select_config = real_cfg
check('the prompt reached the agent', 'THE THOUGHT' in seen.get('prompt', ''))
check('the earlier question reached the agent',
      'THE QUESTION' in seen.get('prompt', ''))
check('the earlier answer reached the agent',
      'THE ANSWER' in seen.get('prompt', ''))

print(f'\n{PASS}/{PASS + FAIL} checks passed')
sys.exit(1 if FAIL else 0)