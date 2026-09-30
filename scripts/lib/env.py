"""Shared test environment for the Python suites.

The JavaScript side lives in scripts/lib/env.js and MUST stay in step with this
file. Python cannot import a JS module, so the two are bound together by
scripts/e2e-verify-f27.py, which compares the variable names, precedence and
defaulted values declared here against the ones env.js exports and fails on any
drift. Two definitions of "the same" is exactly how PRISM_API and PRISM_SITE and
PORT ended up meaning one server under three names.

Rules, identical to env.js:
  1. Nothing defaults to a path outside the repository. No /tmp fallback for
     anything the suite needs to exist — /tmp state does not survive a fresh
     checkout, and the failure looks like a product bug.
  2. Every value is overridable, first spelling wins, older spellings kept as
     aliases so existing runbooks keep working.
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
LIB = ROOT / 'scripts' / 'lib'
VAULT = ROOT / 'prism' / 'vault'

# Kept as a string so it can be dropped straight into a URL. The JavaScript side
# exports a string too, and F27 compares them.
API_HOST = os.environ.get('PRISM_API_HOST') or '127.0.0.1'
API_PORT = int(os.environ.get('PRISM_API_PORT') or os.environ.get('PORT') or 8082)
API = os.environ.get('PRISM_API') or f'http://{API_HOST}:{API_PORT}'

FRONT_HOST = os.environ.get('PRISM_FRONT_HOST') or '127.0.0.1'
FRONT_PORT = int(os.environ.get('PRISM_FRONT_PORT') or 8090)
FRONT = os.environ.get('PRISM_URL') or os.environ.get('PRISM_SITE') or \
    f'http://{FRONT_HOST}:{FRONT_PORT}'

# The fake agent's TLS fixture: committed, never in /tmp. SSL_CERT_FILE is
# deliberately excluded — it commonly points at a full CA bundle, and trusting
# that here fails every handshake while the agent is healthy.
FAKE_CERT = os.environ.get('F24_CA_FILE') or os.environ.get('FAKE_AGENT_CERT') \
    or str(LIB / 'fake-cert.pem')
FAKE_KEY = os.environ.get('F24_KEY_FILE') or os.environ.get('FAKE_AGENT_KEY') \
    or str(LIB / 'fake-key.pem')

STUB_HOST = os.environ.get('PRISM_STUB_HOST') or os.environ.get('STUB_HOST') or '127.0.0.1'
STUB_PORT = int(os.environ.get('PRISM_STUB_PORT') or os.environ.get('LOOP_STUB_PORT')
                or os.environ.get('STUB_PORT') or 8400)
STUB_ENDPOINT = f'https://{STUB_HOST}:{STUB_PORT}/v1/chat/completions'

FAKE_AGENT_BASE_PORT = int(os.environ.get('FAKE_AGENT_PORT') or 8100)
FAKE_AGENT_LOG = os.environ.get('FAKE_AGENT_LOG') or '/tmp/fake-agent.log'
F24_LOG = os.environ.get('F24_LOG') or '/tmp/fake-adj-f24.log'

# The canonical name of every variable, in precedence order, plus the value each
# falls back to. F27 reads this out of env.js and compares, so the two files
# cannot quietly disagree about what a variable is called.
DECLARED = {
    'API': [['PRISM_API'], f'http://{API_HOST}:{API_PORT}'],
    'API_PORT': [['PRISM_API_PORT', 'PORT'], 8082],
    'FRONT': [['PRISM_URL', 'PRISM_SITE'], f'http://{FRONT_HOST}:{FRONT_PORT}'],
    'FAKE_CERT': [['F24_CA_FILE', 'FAKE_AGENT_CERT'],
                  str(LIB / 'fake-cert.pem')],
    'FAKE_KEY': [['F24_KEY_FILE', 'FAKE_AGENT_KEY'], str(LIB / 'fake-key.pem')],
    'STUB_PORT': [['PRISM_STUB_PORT', 'LOOP_STUB_PORT', 'STUB_PORT'], 8400],
    'STUB_HOST': [['PRISM_STUB_HOST', 'STUB_HOST'], '127.0.0.1'],
    'FAKE_AGENT_BASE_PORT': [['FAKE_AGENT_PORT'], 8100],
}


def service_up(url, timeout=1.5):
    """True if something answers on url. Used to refuse loudly, not to assert."""
    import urllib.error
    import urllib.request
    try:
        with urllib.request.urlopen(url.rstrip('/') + '/healthz', timeout=timeout) as r:
            return bool(r.status)
    except urllib.error.HTTPError as e:
        return bool(e.code)      # a 404 still means something is listening
    except Exception:
        return False


def require_service(url, label):
    """Refuse in one clear line rather than producing failures that look like
    product defects. Exit code 2 distinguishes 'not set up' from 'broke'."""
    if not service_up(url):
        sys.stderr.write(
            f'\n  {label} ({url}) is not answering.\n'
            f'  Start it, or point this suite elsewhere with PRISM_API / PRISM_URL.\n\n')
        raise SystemExit(2)
    return True
