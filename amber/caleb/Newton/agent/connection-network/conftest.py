"""
conftest.py — makes the ported connection_network engine importable under
pytest without a manual PYTHONPATH, and supplies the import-time env vars the
engine reads (GCP_PROJECT_ID, Auth0 config) so `pytest` works from a clean
checkout. These defaults are test-only; production sets the real values.

This file is part of the UnifyNetwork port. The engine itself (the a_..j_
packages, i_api, tests) is a faithful copy of the CTO's connection_network
pipeline — see HANDOFF_UNIFYNETWORK.md.
"""

import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

# Import-time env required by i_api.app and h_security.security.
os.environ.setdefault("GCP_PROJECT_ID", "test-project")
os.environ.setdefault("AUTH0_DOMAIN", "bluemodern.us.auth0.com")
os.environ.setdefault("AUTH0_AUDIENCE", "https://mcp.bluemodern.ai")
