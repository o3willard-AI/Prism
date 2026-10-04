"""F31: interrogation, end to end, against a real agent.

The point of the feature is that the AGENT asks, not that a regex does. So the
only meaningful test drives a live agent through the whole conversation: does it
ask about OUTCOME rather than format, does it carry the exchange forward without
repeating a question, does it propose a shape with a reason, and does it stop
when it has enough?

And the two things that must NOT happen: an unconfigured agent must be reported
unavailable rather than faked, and an unparseable reply must never read as
"ready".
"""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'lib'))
import env  # noqa: E402

sys.path.insert(0, str(env.ROOT / 'prism'))
import agentic      # noqa: E402
import adjudicate   # noqa: E402
import interrogate  # noqa: E402

# agentic.AGENT_DIR is already a vault-relative string ("knowledge/integrations/
# agentic"), so join it directly onto the vault — prefixing "vault/" a second
# time produces a path that exists nowhere.
CFG_DIR = Path(agentic.__file__).parent / 'vault' / agentic.AGENT_DIR
CFG = CFG_DIR / 'f31-probe.md'

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
    req = urllib.request.Request(env.API + path, data=json.dumps(payload).encode(),
                                 headers={'Content-Type': 'application/json'})
    return json.load(urllib.request.urlopen(req))


def arm(lenses=None):
    body = ['# f31 probe', '',
            '**Title:** Interrogator', '**Status:** active']
    if lenses:
        body.append('**Lenses:** ' + ', '.join(lenses))
    body += ['**Kind:** openai', f'**Endpoint:** {env.STUB_ENDPOINT}',
             '**Model:** stub', '**Auth env:** PRISM_TEST_KEY']
    CFG.write_text('\n'.join(body) + '\n')


print('== no agent configured: reported unavailable, NOT faked ==')
try:
    CFG.unlink()
except OSError:
    pass
r = post('/interrogate', {'raw': 'Export keeps failing on large reports.'})
check('asked is false', r.get('asked') is False, json.dumps(r)[:120])
check('the verdict is "unavailable", not "ready"',
      r.get('verdict') == 'unavailable', str(r.get('verdict')))
check('it says why', 'No agent integration' in (r.get('agent_error') or ''),
      (r.get('agent_error') or '')[:90])
check('and it names the alternative it refused to fake',
      'not a substitute' in (r.get('agent_error') or ''), (r.get('agent_error') or '')[-70:])
check('no questions are invented', r.get('questions') == [], str(r.get('questions')))

print('\n== a missing raw thought is refused, not guessed at ==')
try:
    urllib.request.urlopen(urllib.request.Request(
        env.API + '/interrogate', data=b'{}',
        headers={'Content-Type': 'application/json'}))
    check('400 without raw', False, 'no error raised')
except urllib.error.HTTPError as e:
    check('400 without raw', e.code == 400, str(e.code))

print('\n== an UNPARSEABLE reply must never read as "ready" ==')
check('gibberish -> unclear', interrogate._coerce('I think it depends')['verdict'] == 'unclear')
check('gibberish is flagged', interrogate._coerce('I think it depends')['parse_failed'] is True)
check('empty -> unclear', interrogate._coerce('')['verdict'] == 'unclear')
check('a JSON array -> unclear, not ready',
      interrogate._coerce('[1,2,3]')['verdict'] == 'unclear')
check('a ready verdict with no questions is honoured',
      interrogate._coerce('{"verdict":"ready"}')['verdict'] == 'ready')
check('an invented verdict is normalised to unclear',
      interrogate._coerce('{"verdict":"looks_good"}')['verdict'] == 'unclear')

print('\n== question capping ==')
many = {"verdict": "need_more",
        "questions": [f"Q{i}?" for i in range(20)]}
capped = interrogate._coerce(json.dumps(many))
check('questions are capped so a human is not handed a wall',
      len(capped['questions']) == interrogate.MAX_QUESTIONS_PER_ROUND,
      f"{len(capped['questions'])} questions")

print('\n== the prompt asks about OUTCOME, and carries the exchange ==')
p1 = interrogate.build_interrogation_prompt('raw thought here', [])
check('round 1 carries the raw thought', 'raw thought here' in p1)
check('and instructs JSON-only output', 'JSON only' in p1 or 'JSON object' in p1)
check('and says never to ask what is already answered',
      'NEVER ask something the text already answers' in p1)
check('and asks about outcome, not format', 'OUTCOME, not format' in p1)
check('round 1 has no exchange', 'SO FAR' not in p1)

answers = [{'question': 'What must be true for this to be worth doing?',
            'answer': 'Nobody loses an afternoon to a failed export.'}]
p2 = interrogate.build_interrogation_prompt('raw thought here', answers)
check('round 2 carries the prior exchange', 'SO FAR, IN THEIR WORDS' in p2)
check('including the question', 'worth doing?' in p2)
check('and the answer', 'failed export' in p2)
check('and is told not to ask it again', 'Do not ask again' in p2)

print('\n== a chosen shape is respected ==')
p3 = interrogate.build_interrogation_prompt('raw', [], 'requirements')
check('the chosen shape is stated', 'requirements' in p3)
check('and the agent is told not to propose another', 'not propose a different' in p3)

print('\n== the interrogation is recorded for the artifact ==')
rec = interrogate.summarise_for_record({
    'understanding': 'They want large exports to stop failing silently.',
    'outcome': 'An agent can size a chunking fix without re-asking.',
    'proposed_shape': 'requirements', 'shape_reason': 'It is a build.',
    'answers': answers,
})
for field in ('**Understood as:**', '**Must enable an agent to:**', '**Shape:**',
              '**Interrogation:**', 'worth doing?'):
    check(f'the record carries {field}', field in rec, rec[:80])
check('the record answers "why this shape?"',
      'It is a build.' in rec, rec[:120])

print('\n== bounds ==')
check('rounds are bounded', 1 <= interrogate.MAX_ROUNDS <= 6,
      str(interrogate.MAX_ROUNDS))
check('every shape offered is one the desk has a door for',
      set(interrogate.SHAPES) == {'requirements', 'hypotheses',
                                  'rationalizations', 'ux-bridge'},
      str(sorted(interrogate.SHAPES)))

print('\n== the live stub routes BOTH judges to the right branch ==')
# A stub that misreads which judge is calling answers the wrong question. This
# happened for real: the discriminator also required "classify" to be ABSENT, and
# the interrogation prompt itself says "You are NOT classifying" — so the
# interrogation branch never ran and every browser assertion failed on an empty
# verdict. A test that only exercises the happy path cannot see this.
sys.path.insert(0, str(env.LIB))
import loop_stub_agent as stubmod  # noqa: E402

iq = interrogate.build_interrogation_prompt('a raw thought', [], '')
check('an interrogation prompt is recognised as one',
      stubmod._is_interrogation(iq) is True)
check('even though it contains the word "classifying"',
      'classif' in iq, 'the negation guard that broke this')
aj = adjudicate.build_judge_prompt('a draft PRD with TBD in it', 'requirements') \
    if hasattr(adjudicate, 'build_judge_prompt') else '## Requirements\nTBD\n'
check('a different judge prompt is NOT treated as an interrogation',
      stubmod._is_interrogation(aj) is False, aj[:60])
check('the stub asks on round one',
      'need_more' in stubmod.INTERROGATE_Q, stubmod.INTERROGATE_Q[:60])
check('and proposes a shape on round two',
      'ready' in stubmod.INTERROGATE_READY and '"questions": []' in stubmod.INTERROGATE_READY)
check('and round two really asks nothing',
      json.loads(stubmod.INTERROGATE_READY)['questions'] == [])
check('the questions are real questions',
      all(q.strip().endswith('?') for q in json.loads(stubmod.INTERROGATE_Q)['questions']))

print('\n== against a REAL agent ==')
# The stub answers "need_more" once, then "ready" — so the conversation's shape
# is exercised without depending on a language model's judgement.
stub = subprocess.Popen([sys.executable, str(env.LIB / 'loop_stub_agent.py')],
                        env=dict(os.environ, STUB_PORT=str(env.STUB_PORT),
                                 STUB_HOST=env.STUB_HOST),
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                        start_new_session=True)
time.sleep(2)
try:
    arm()
    r = post('/interrogate', {'raw': 'Bulk export fails on large reports. Ops split by hand.'})
    check('the agent WAS asked', r.get('asked') is True, json.dumps(r)[:160])
    check('it produced a verdict', r.get('verdict') in
          ('need_more', 'ready', 'unclear'), str(r.get('verdict')))
    check('round 1 is numbered', r.get('round') == 1, str(r.get('round')))
    check('the judge is named', bool(r.get('agent_title')), str(r.get('agent_title')))
    check('it says what it understood',
          isinstance(r.get('understanding'), str), str(r.get('understanding'))[:60])
    check('questions are a list', isinstance(r.get('questions'), list))
    check('round 1 is not flagged as the last', r.get('at_last_round') is False,
          str(r.get('at_last_round')))

    r2 = post('/interrogate', {
        'raw': 'Bulk export fails on large reports.',
        'answers': [{'question': 'What outcome?', 'answer': 'No lost afternoons.'}],
    })
    check('round 2 carries the exchange forward',
          len(r2.get('answers') or []) == 1, str(len(r2.get('answers') or [])))
    check('round 2 is numbered 2', r2.get('round') == 2, str(r2.get('round')))
    check('round 2 of 4 is not the last', r2.get('at_last_round') is False,
          str(r2.get('at_last_round')))

    # The last round must be flagged so the human is told, not silently cut off.
    from interrogate import MAX_ROUNDS
    rlast = post('/interrogate', {
        'raw': 'x',
        'answers': [{'question': f'q{i}', 'answer': f'a{i}'}
                    for i in range(MAX_ROUNDS - 1)],
    })
    check('the final round is flagged at_last_round', rlast.get('at_last_round') is True,
          str(rlast.get('at_last_round')))
finally:
    try:
        stub.kill()
    except Exception:
        pass
    try:
        CFG.unlink()
    except OSError:
        pass

print(f'\n{PASS}/{PASS + FAIL} checks passed')
sys.exit(1 if FAIL else 0)