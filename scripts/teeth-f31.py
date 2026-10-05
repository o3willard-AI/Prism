"""Teeth for F31: mutate the interrogation, confirm the suite notices.

A suite that passes proves nothing on its own. Each mutation below breaks one
promise the feature makes, and the suite must fail. If a mutation survives, the
corresponding check is decoration.

Both suites run: e2e-verify-f31.py drives the HTTP surface, and
e2e-verify-f31-unit.py calls interrogate() directly with a stubbed agent. The
second exists because four of these mutations SURVIVED the HTTP suite alone —
a broken module still returns 200, and the handler's catch-all converts the
resulting exception straight back into "unavailable", so the suite went green
for reasons unrelated to the promise it claimed to test. Any mutation caught by
either suite counts as caught.
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / 'prism' / 'interrogate.py'
SRC = TARGET.read_text()

SUITES = [ROOT / 'scripts' / 'e2e-verify-f31.py',
          ROOT / 'scripts' / 'e2e-verify-f31-unit.py']

MUTATIONS = [
    # The core failure: substitute a deterministic guess for the agent. This is
    # exactly what /classify does, and the whole module exists to stop it.
    ('agent unavailable is reported as "ready"',
     'if cfg is None:', 'if cfg is None and False:'),

    # Unreadable agent output silently becomes consent.
    ('an unparseable reply reads as ready',
     'return {"verdict": "unclear", "parse_failed": True, "raw": text[:800],',
     'return {"verdict": "ready", "parse_failed": True, "raw": text[:800],'),

    # Drop a question the human already answered.
    ('the exchange is not carried forward',
     'parts += ["", "=== SO FAR, IN THEIR WORDS ==="]',
     'parts += ["", "=== (exchange dropped) ==="]'),

    # Stop policing how many questions a human is handed.
    ('the question cap is removed',
     '[:MAX_QUESTIONS_PER_ROUND]', '[:99]'),

    # Never admit when to stop.
    ('the round bound is removed',
     'round_no >= MAX_ROUNDS', 'False'),

    # Drop the outcome — the thing the lens exists to enable.
    ('the outcome is dropped from the record',
     'if state.get("outcome"):', 'if False:'),

    # Invent a shape the desk has no door for.
    ('an unknown shape is not normalised away',
     'if shape not in SHAPES:', 'if False:'),

    # Report a parse failure as though nothing went wrong.
    ('a parse failure is reported as clean',
     '"parse_failed": False,', '"parse_failed": True,'),
]

failed = []
for name, old, new in MUTATIONS:
    if old not in SRC:
        print(f'  SKIP     {name}  — anchor not found')
        failed.append(name + ' (anchor missing)')
        continue
    TARGET.write_text(SRC.replace(old, new, 1))
    caught_by = None
    for suite in SUITES:
        r = subprocess.run([sys.executable, str(suite)],
                           capture_output=True, text=True, cwd=ROOT,
                           env={**os.environ,
                                'PRISM_TEST_KEY': 'sk-test-FAKE-not-a-real-key',
                                'SSL_CERT_FILE': str(ROOT / 'scripts/lib/fake-cert.pem')})
        if r.returncode != 0:
            caught_by = suite.name
            break
    TARGET.write_text(SRC)
    label = f'{caught_by}' if caught_by else 'SURVIVED'
    print(f'  {label:<32} {name}')
    if not caught_by:
        failed.append(name)

print()
if failed:
    print(f'{len(failed)} mutation(s) not caught:')
    for f in failed:
        print(f'  - {f}')
    sys.exit(1)
print(f'all {len(MUTATIONS)} mutations caught')