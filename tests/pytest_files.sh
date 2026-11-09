#!/usr/bin/env bash
# The test files in <dir> that import pytest, one path per line: the only ones
# the pytest group hands to pytest. Every other test_*.py is a script its own
# group runs with python3, and pytest importing it would run it a second time.
dir="${1:-$(cd "$(dirname "$0")" && pwd)}"
grep -lE '^[[:space:]]*(import pytest|from pytest import)' "$dir"/test_*.py 2>/dev/null | sort
