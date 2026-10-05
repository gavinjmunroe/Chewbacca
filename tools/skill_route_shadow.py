#!/usr/bin/env python3
"""Shadow skill routing: Jev and the keyword matcher, side by side, acting on nothing.

The keyword router behind skill-route.sh named `jev-browse` and
`thinking-out-loud` for "how do further improve our entire stack with jev and
system one models" on 2026-10-05, matched on "jev, speed, model". The Jev
cascade in tools/hybrid_route.py was evaluated on synthetic prompts only
(docs/HYBRID-ROUTE.md). This runs it on real prompts without showing anything,
so the two can be compared on real traffic before either one is trusted more.

    echo '<UserPromptSubmit payload>' | skill_route_shadow.py

Writes one `skill-route` row to ~/.bob/decisions.jsonl through
bin/lib/decision_log.py, with both picks in `answers`. Prints nothing. The hook
runs it detached, so a slow or failed Jev call never delays a prompt. Outcomes
(which skill the session actually loaded) are joined later from the transcript.
"""
import json
import sys
import time
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "bin" / "lib"))

import decision_log  # noqa: E402
import hybrid_route  # noqa: E402
import skill_match  # noqa: E402


def shadow(payload: dict, evaluate=None) -> str | None:
    prompt = (payload.get("prompt") or "").strip()
    cwd = payload.get("cwd")
    catalog = hybrid_route.load_catalog(cwd)
    if not catalog:
        return None
    started = time.perf_counter()
    result = hybrid_route.route(prompt, catalog, use_llm=False, evaluate=evaluate)
    # Code-node answers (too short, a slash command, machine traffic) are rules,
    # not judgments; logging them would pad the comparison with free agreements.
    if result["decided_by"] == "code":
        return None
    jev = next((s for s in result["trace"] if s["backend"] == "jev"), {})
    kw = [name for name, _path, _why in skill_match.match(prompt, cwd)]
    answers = {
        "jev": {"choice": jev.get("skill") or "none", "probabilities": {jev.get("skill") or "none": jev.get("p", 0.0)}},
        "kw": {"choice": kw[0] if kw else "none", "probabilities": {kw[0] if kw else "none": 1.0}},
    }
    state = {"prompt": prompt, "session": payload.get("session_id"), "jev_status": jev.get("status"),
             "kw_all": kw, "policy": result["policy"]}
    return decision_log.record("skill-route", state, answers, (time.perf_counter() - started) * 1000,
                               error=jev.get("reason") if jev.get("status") == "error" else None)


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read(200_000) or "{}")
    except ValueError:
        return 0
    try:
        shadow(payload)
    except Exception:  # shadow mode must never surface into a session
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
