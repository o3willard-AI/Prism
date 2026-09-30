"""Per-lens judge selection: which agent adjudicates which lens, and why.

The bug this covers: adjudication used `default_config()`, the first active
config by sorted filename, for EVERY lens. The `lenses:` field that every
config already carried was parsed, exposed through /agent-configs, and then
never read by the selection logic — a declared route that was inert. F26 then
started writing the judge into every artifact, which made the arbitrariness
legible without making it correct.

Precedence, and the reasoning behind refusing the obvious shortcut:
  1. a config that explicitly claims this lens
  2. a config claiming no lens at all (the catch-all, and the original setup)
  3. nothing — an unclaimed lens is NOT silently handed to an unrelated agent

Step 3 is the design decision. The old code's "first by filename" is a fallback
with no name, so nobody can tell it apart from a deliberate choice. Returning
no judge, with a reason that says exactly which line to add, is the honest
version of the same refusal.
"""
import os
import sys
from pathlib import Path

# One definition of the test environment, shared by every suite. F27 fails the
# build if a suite re-derives this, which is how the first draft of this very
# file was caught with a hardcoded home directory in it.
sys.path.insert(0, str(Path(__file__).resolve().parent / 'lib'))
import env  # noqa: E402

sys.path.insert(0, str(env.ROOT / 'prism'))
os.environ.setdefault('PRISM_TEST_KEY', 'sk-test-FAKE-not-a-real-key')

import adjudicate  # noqa: E402
import agentic     # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=''):
    global PASS, FAIL
    if cond:
        print(f'  PASS {name}')
        PASS += 1
    else:
        print(f'  FAIL {name}' + (f'  — {detail}' if detail else ''))
        FAIL += 1


def cfg_dir():
    """Where the config files live — same resolution list_configs() uses."""
    return Path(agentic.__file__).parent / 'vault' / str(agentic.AGENT_DIR)


def write_cfg(name, lenses=None, status='active', key='PRISM_TEST_KEY'):
    body = [f'# {name}', '', f'**Title:** {name}', f'**Status:** {status}']
    if lenses is not None:
        body.append('**Lenses:** ' + ', '.join(lenses))
    body += ['**Kind:** openai', '**Endpoint:** https://127.0.0.1:8400/v1/chat/completions',
             '**Model:** stub']
    if key:
        body.append(f'**Auth env:** {key}')
    body.append('')
    (cfg_dir() / f'{name}.md').write_text('\n'.join(body))


def clear():
    for f in cfg_dir().glob('seltest-*.md'):
        f.unlink()


print('\n== no integrations at all ==')
clear()
cfg, reason = adjudicate.select_config('requirements-default')
check('no config means no judge', cfg is None, str(reason))
check('and it says so', reason['selection'] == 'none', str(reason))

print('\n== one unscoped config: the original single-agent setup ==')
clear()
write_cfg('seltest-a', lenses=None)
cfg, reason = adjudicate.select_config('requirements-default')
check('it judges any lens', cfg is not None)
check('and the choice is named a fallback', reason['selection'] == 'fallback',
      str(reason))
check('the reason says how to fix it',
      'lenses:' in reason['why'], str(reason))

print('\n== two configs, each claiming specific lenses ==')
clear()
write_cfg('seltest-req', lenses=['requirements-default'])
write_cfg('seltest-ux', lenses=['ux-bridge-default', 'requirements-default'])
cfg, reason = adjudicate.select_config('ux-bridge-default')
check('the UX lens goes to the agent that claims it',
      cfg and 'ux' in cfg['name'], cfg['name'] if cfg else 'None')
check('and it is an explicit selection', reason['selection'] == 'explicit', str(reason))
check('no tie is claimed when only one config wants the lens',
      'also_claimed_by' not in reason, str(reason))

print('\n== when two agents claim the same lens, the tie is disclosed ==')
clear()
write_cfg('seltest-alpha', lenses=['requirements-default'])
write_cfg('seltest-beta', lenses=['requirements-default'])
cfg, reason = adjudicate.select_config('requirements-default')
check('one of them is used', cfg is not None)
check('the tie is disclosed, not hidden',
      'also_claimed_by' in reason, str(reason))
check('and it names the other claimant',
      any('beta' in n for n in reason.get('also_claimed_by', [])),
      str(reason.get('also_claimed_by')))
check('and says how to disambiguate',
      'narrower' in reason['why'], str(reason))

print('\n== routing actually differs per lens ==')
clear()
write_cfg('seltest-req', lenses=['requirements-default'])
write_cfg('seltest-ux', lenses=['ux-bridge-default'])
cfg_a, _ = adjudicate.select_config('ux-bridge-default')
cfg_b, _ = adjudicate.select_config('requirements-default')
check('two lenses go to two different agents',
      cfg_a and cfg_b and cfg_a['name'] != cfg_b['name'],
      f"{cfg_a['name'] if cfg_a else None} vs {cfg_b['name'] if cfg_b else None}")
check('each gets the one that claimed it',
      cfg_a and cfg_a['name'].endswith('ux') and cfg_b and cfg_b['name'].endswith('req'),
      f"{cfg_a['name'] if cfg_a else None} / {cfg_b['name'] if cfg_b else None}")

print('\n== an unclaimed lens is NOT handed to a scoped agent ==')
clear()
write_cfg('seltest-uxonly', lenses=['ux-bridge-default'])
cfg, reason = adjudicate.select_config('hypotheses-default')
check('an unclaimed lens gets no judge', cfg is None, str(cfg))
check('and the reason is specific', reason['selection'] == 'unclaimed', str(reason))
check('it names the candidates that exist',
      'uxonly' in ' '.join(reason.get('candidates', [])), str(reason))
check('it says how to fix it',
      'lenses:' in reason['why'], str(reason))

print('\n== an unscoped catch-all rescues an unclaimed lens ==')
clear()
write_cfg('seltest-scoped', lenses=['ux-bridge-default'])
write_cfg('seltest-catchall', lenses=None)
cfg, reason = adjudicate.select_config('hypotheses-default')
check('the catch-all takes it', cfg and cfg['name'].endswith('catchall'),
      cfg['name'] if cfg else 'None')
check('and it is disclosed as a fallback', reason['selection'] == 'fallback',
      str(reason))

print('\n== an explicit claim beats the catch-all ==')
clear()
write_cfg('seltest-catchall', lenses=None)
write_cfg('seltest-req', lenses=['requirements-default'])
cfg, reason = adjudicate.select_config('requirements-default')
check('the explicit claim wins over the unscoped one',
      cfg and cfg['name'].endswith('req'), cfg['name'] if cfg else 'None')
check('and that is an explicit selection', reason['selection'] == 'explicit',
      str(reason))

print('\n== unusable configs are not candidates ==')
for label, kwargs in [
    ('a draft', dict(status='draft')),
    ('one with no key in the environment', dict(key='PRISM_NOT_SET_ANYWHERE')),
]:
    clear()
    write_cfg('seltest-x', lenses=None, **kwargs)
    cfg, reason = adjudicate.select_config('requirements-default')
    check(f'{label} is not asked to judge', cfg is None, str(cfg))

print('\n== selection is stable regardless of directory order ==')
clear()
write_cfg('seltest-zzz', lenses=['requirements-default'])
write_cfg('seltest-aaa', lenses=['requirements-default'])
first, _ = adjudicate.select_config('requirements-default')
second, _ = adjudicate.select_config('requirements-default')
check('the same lens resolves the same way twice',
      first['name'] == second['name'], f"{first['name']} vs {second['name']}")
check('and it breaks the tie by filename, deterministically',
      first['name'].endswith('aaa'), first['name'])

print('\n== the routing reason reaches the artifact ==')
clear()
write_cfg('seltest-req', lenses=['requirements-default'])
write_cfg('seltest-ux', lenses=['ux-bridge-default'])
cfg_explicit, sel_explicit = adjudicate.select_config('requirements-default')
cfg_fallback, sel_fallback = adjudicate.select_config('hypotheses-default')

verdict = {'verdict': 'at_threshold', 'confidence': 93, 'threshold': 95,
           'agent': 'seltest-req', 'agent_title': 'Requirements Judge',
           'reasoning': 'Scope and intent are clear.', 'questions': []}
rec_explicit = adjudicate.format_for_record(verdict, sel_explicit)
rec_fallback = adjudicate.format_for_record(verdict, sel_fallback)
check('an explicit route adds no routing noise',
      'Routing:' not in rec_explicit, rec_explicit)
check('a fallback route is recorded in the artifact',
      'Routing:' in rec_fallback, rec_fallback)
check('and the recorded reason is the human sentence',
      sel_fallback['why'] in rec_fallback, rec_fallback)
check('the judgment itself is still there',
      'Judged by:' in rec_fallback and 'at threshold' in rec_fallback, rec_fallback)
check('a missing selection is tolerated (old callers)',
      'Routing:' not in adjudicate.format_for_record(verdict), 'no arg')

print('\n== unclaimed lens: no judge, and the reason explains the fix ==')
clear()
write_cfg('seltest-scoped', lenses=['ux-bridge-default'])
cfg, reason = adjudicate.select_config('hypotheses-default')
check('no judge is selected', cfg is None, str(cfg))
check('the reason names the lens', 'hypotheses-default' in reason['why'], str(reason))
check('and offers a concrete fix', 'lenses:' in reason['why'], str(reason))

clear()
print(f'\n{PASS}/{PASS + FAIL} checks passed')
sys.exit(1 if FAIL else 0)
