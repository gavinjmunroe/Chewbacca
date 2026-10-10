#!/usr/bin/env python3
"""Pick the control in an appctl snapshot that does what the agent means.

Code first: one exact label match answers without a model call. Only when the
label doesn't settle it does Jev get a choice question over the actionable
elements. Jev's answer is a suggestion, never permission: `chewie app do`
still goes through appctl's revalidation and its irreversible-action gate.
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

# Guessed, never measured. Below this `do` shows the candidates instead of
# pressing. Raise or lower it only against labeled cases from real snapshots.
MIN_CONFIDENCE = 0.6
# Jev's request cap is 100 KB; 80 one-line candidates stay far under it.
MAX_CANDIDATES = 80


def describe(e):
    parts = [e["role"].removeprefix("AX")]
    if e.get("label"):
        parts.append(repr(e["label"]))
    if e.get("value"):
        parts.append("value=" + repr(e["value"])[:60])
    if e.get("editable"):
        parts.append("editable")
    return " ".join(parts)


def actionable(e):
    return bool(e.get("editable")) or any(a in ("AXPress", "AXConfirm") for a in e.get("actions", []))


def find(snapshot, intent):
    elements = [e for e in snapshot["elements"] if actionable(e)]
    want = intent.strip().lower()
    exact = [e for e in elements if (e.get("label") or "").lower() == want]
    if len(exact) == 1:
        return {"i": exact[0]["i"], "element": exact[0], "confidence": 1.0, "via": "exact label"}
    pool = elements[:MAX_CANDIDATES]
    if not pool:
        return {"i": None, "via": "none", "reason": "no actionable elements in the snapshot"}
    import jev  # tools/jev.py; imported late so the exact path needs no key
    criteria = {str(k): describe(e) for k, e in enumerate(pool)}
    criteria["none"] = "None of the listed controls does this"
    payload = {
        "model": jev.MODEL,
        "state": f"App: {snapshot.get('app')}. Window: {snapshot.get('title')}.\n"
                 f"The agent wants to: {intent}",
        "questions": {"target": {
            "type": "choice",
            "instructions": "Which single control in this window would the agent operate to do what it wants? "
                            "Pick none if no listed control does it.",
            "criteria": criteria,
        }},
    }
    try:
        answer = jev.evaluate(payload)["answers"]["target"]
    except jev.JevError as err:
        # No key, no network, or a bad response: say so and hand back the
        # candidates so the agent can pick by index, never a silent guess.
        return {"i": None, "via": "jev unavailable", "reason": str(err),
                "candidates": [{"i": e["i"], "label": describe(e)} for e in pool]}
    choice = answer["choice"]
    probs = answer.get("probabilities", {})
    runner_up = sorted(((p, k) for k, p in probs.items() if k != choice), reverse=True)[:3]
    alts = [{"i": pool[int(k)]["i"], "label": describe(pool[int(k)]), "p": round(p, 3)}
            for p, k in runner_up if k != "none"]
    if choice == "none":
        return {"i": None, "via": "jev", "confidence": answer["confidence"], "alternatives": alts}
    e = pool[int(choice)]
    return {"i": e["i"], "element": e, "confidence": answer["confidence"], "via": "jev", "alternatives": alts}


def main():
    if len(sys.argv) < 4 or sys.argv[1] not in ("find", "do"):
        sys.exit("usage: app_find.py find|do <appctl> <app> <intent> [--text T] [--window ID]")
    mode, appctl, app, intent = sys.argv[1:5]
    extra = sys.argv[5:]
    window = []
    if "--window" in extra:
        k = extra.index("--window")
        window = extra[k:k + 2]
    seen = subprocess.run([appctl, "see", app, *window], capture_output=True, text=True)
    if seen.returncode != 0:
        sys.stderr.write(seen.stderr)
        sys.exit(seen.returncode)
    result = find(json.loads(seen.stdout), intent)
    if mode == "find" or result["i"] is None:
        print(json.dumps(result, indent=2))
        sys.exit(0 if result["i"] is not None else 3)
    if result["confidence"] < MIN_CONFIDENCE:
        result["refused"] = f"confidence {result['confidence']:.2f} under {MIN_CONFIDENCE}; pick one by index"
        print(json.dumps(result, indent=2))
        sys.exit(3)
    verb = "set" if result["element"].get("editable") and "--text" in extra else "press"
    cmd = [appctl, verb, app, str(result["i"]), *window]
    if verb == "set":
        cmd.insert(4, extra[extra.index("--text") + 1])
    # Never forward --yes. Consent was given to a sentence, not to whichever
    # control Jev picked for it; a gated pick comes back for the person to
    # confirm by index (`chewie app press <app> <i> --yes`). Security review of
    # cbd074b3, 2026-10-09.
    done = subprocess.run(cmd, capture_output=True, text=True)
    if done.returncode == 4:
        print(json.dumps({"found": result, "refused": done.stderr.strip(),
                          "confirm_with": f"chewie app {verb} {app} {result['i']} --yes"}, indent=2))
        sys.exit(4)
    sys.stderr.write(done.stderr)
    out = {"found": result}
    if done.stdout.strip():
        out["did"] = json.loads(done.stdout)
    print(json.dumps(out, indent=2))
    sys.exit(done.returncode)


if __name__ == "__main__":
    main()
