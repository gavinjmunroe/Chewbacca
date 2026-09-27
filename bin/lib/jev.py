"""TypeSafe's Jev: typed judgments over HTTP, fast enough to sit in a voice turn.

One call, `ask(state, questions)`, returning the `answers` map or None. None
means "no judgment": no key, a timeout, a non-200, a body that is not JSON.
Callers treat None exactly like an unconfigured classifier, so Jev being down
never costs more than the rules already cost.

Docs: https://docs.typesafe.ai/api.md
"""
import json
import math
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import decision_log  # noqa: E402

URL = "https://api.typesafe.ai/v1/systemone"
MODEL = os.environ.get("TYPESAFE_MODEL", "jev-latest")
# Well above the single-question call times seen from this Mac on 2026-09-23
# (kept private under TypeSafe's agreement 2.3(f)), and inside the router's
# 3 s budget.
TIMEOUT_S = 2.5

_key: str | None = None


def api_key() -> str | None:
    """TYPESAFE_API_KEY from the environment, else the login Keychain.

    hud-listen runs under launchd and does not inherit a shell, so the
    Keychain entry (service TYPESAFE_API_KEY) is the path that actually
    fires in production. Looked up once per process.

    Resolved into a local and published once: assigning "" to the cache before
    the Keychain lookup returned made every other thread read "no key", and on
    2026-09-23 that failed 29 of 30 calls in fanout's two-worker pool.
    """
    global _key
    if _key is None:
        key = os.environ.get("TYPESAFE_API_KEY", "")
        if not key:
            # Two integrations shipped with different Keychain service names.
            # Read either existing entry; do not migrate or expose credentials.
            for arguments in (
                ["-s", "TYPESAFE_API_KEY"],
                ["-a", "chewbacca", "-s", "typesafe-ai"],
            ):
                try:
                    out = subprocess.run(
                        ["security", "find-generic-password", *arguments, "-w"],
                        capture_output=True, text=True, timeout=2.0,
                    )
                    key = out.stdout.strip() if out.returncode == 0 else ""
                except (OSError, subprocess.TimeoutExpired):
                    key = ""
                if key:
                    break
        _key = key
    return _key or None


def allowed() -> bool:
    """Whether this process may send anything to Jev at all.

    Jev is a cloud API, so every call is data leaving the machine. Inside an
    Amber user's root (AMBER_ROOT, set by bin/amber-user and amber-mcp) that
    needs the person's own yes, recorded by `amber-user consent <user> jev on`
    in <root>/consent.json. A new user has no file, so Jev is off for them
    until they choose it. Outside any root is the machine owner's own install,
    where having put a TypeSafe key on the machine is the choice.
    """
    root = os.environ.get("AMBER_ROOT")
    if not root:
        return True
    try:
        with open(os.path.join(root, "consent.json")) as f:
            return json.load(f).get("jev") is True
    except (OSError, ValueError, AttributeError):
        return False


def probability(value) -> float | None:
    """A finite probability, never a truthy string, bool or NaN."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if 0 <= value <= 1 and math.isfinite(value) else None


def validate_choice(answer, criteria) -> tuple[str, float] | None:
    """Validate the full choice distribution; callers own cost thresholds."""
    if not isinstance(answer, dict) or answer.get("type", "choice") != "choice":
        return None
    scores = answer.get("probabilities")
    if not isinstance(scores, dict) or set(scores) != set(criteria) or not scores:
        return None
    if any(probability(value) is None for value in scores.values()):
        return None
    # Numerical serialization tolerance, not a calibration guarantee.
    if abs(sum(scores.values()) - 1) > 1e-6:
        return None
    choice = answer.get("choice")
    if not isinstance(choice, str) or choice not in scores:
        return None
    score = scores[choice]
    if score != max(scores.values()) or sum(v == score for v in scores.values()) != 1:
        return None
    return choice, float(score)


def ask_result(state, questions: dict, timeout: float = TIMEOUT_S, *,
               max_attempts: int = 1, retry_codes=(), decision: str | None = None) -> dict | None:
    """One request by default; callers explicitly opt into bounded retries.

    Retry policy preserves fanout's existing backoff. Invalid response shapes
    abstain immediately; retries cannot repair a broken answer schema.
    `decision` names the call in ~/.bob/decisions.jsonl (bin/lib/decision_log.py);
    unnamed calls, the bulk ones, are not logged. One row per call, not per attempt.
    """
    if type(max_attempts) is not int or not 1 <= max_attempts <= 4:
        raise ValueError("max_attempts must be between one and four")
    if not allowed():
        return None
    key = api_key()
    if not key:
        return None
    body = json.dumps({"state": state, "model": MODEL, "questions": questions}, allow_nan=False).encode()
    started = time.monotonic()
    result, error = _send(body, key, timeout, max_attempts, retry_codes)
    if decision:
        answers = result["answers"] if result else None
        decision_log.record(decision, state, answers, (time.monotonic() - started) * 1000,
                            error or (None if answers else "no answers"))
    return result


def _send(body: bytes, key: str, timeout: float, max_attempts: int,
          retry_codes) -> tuple[dict | None, str | None]:
    """The request loop. Returns (result, error class name or None)."""
    for attempt in range(max_attempts):
        req = urllib.request.Request(URL, data=body, method="POST", headers={
            "Authorization": f"Bearer {key}", "Content-Type": "application/json",
        })
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                payload = json.loads(resp.read())
        except urllib.error.HTTPError as err:
            status = err.code
            err.close()
            if status not in retry_codes or attempt + 1 == max_attempts:
                return None, f"HTTP {status}"
        except (OSError, urllib.error.URLError, ValueError) as err:
            if attempt + 1 == max_attempts:
                return None, type(err).__name__
        else:
            if not isinstance(payload, dict) or not isinstance(payload.get("answers"), dict):
                return None, "invalid response"
            # Allowlisted metadata only; never echo provider diagnostics or input.
            return {"answers": payload["answers"], "model": payload.get("model"),
                    "usage": payload.get("usage"), "attempts": attempt + 1}, None
        time.sleep(2 ** attempt)
    return None, "exhausted"


def ask(state, questions: dict, timeout: float = TIMEOUT_S, decision: str | None = None) -> dict | None:
    result = ask_result(state, questions, timeout, decision=decision)
    return result["answers"] if result else None
