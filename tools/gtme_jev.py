#!/usr/bin/env python3
"""Jev checks on outbound email: one call per email, atomic questions, gated in code.

TypeSafe's own pattern (docs.typesafe.ai, "Decompose" and "Route on
uncertainty"): ask many small typed questions about one state in a single
request, combine the answers in code, and send anything uncertain to a person.
Here the state is one rendered cold email, and the questions are:

  line     is the personal opener a specific, checkable observation about
           their organization, said respectfully (Noul)
  rule:ID  does the email break a client ruling that carries a `jev` question
           in DECISIONS.json or clients.json (Noul each)

Nothing here sends. `gtme batch` holds any email this flags, and an email Jev
couldn't score is held too: a check that didn't run isn't a pass.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Guessed, never measured on our own sends: the docs' worked example routes
# below 0.8 to a person. A rude or vague opener reaching a pastor costs more
# than one held email, so the line bar sits there too. Raise either after a
# week of labelled holds says it is too loose.
LINE_OK = 0.8
# A ruling is broken when Jev puts it at even odds or worse. Holding a clean
# email costs a minute; sending one that breaks a client's rule costs trust.
RULE_BROKEN = 0.5


def _ask(state: dict, questions: dict):
    sys.path.insert(0, str(ROOT / "bin" / "lib"))
    try:
        import jev  # noqa: E402
    except ImportError:
        return None, None
    return jev.ask(state, questions, decision="gtme-email-check"), jev


def checks_for(rulings: list[dict]) -> dict:
    """The questions for one email: the opener, then each ruling with a `jev` question."""
    qs = {"line": {"type": "noul", "instructions":
                   "Look only at the opening line of this cold email. Is it a specific observation about the "
                   "recipient's own organization that they could check themselves (a page, a form, a time, a "
                   "fact), worded respectfully, with no insult, exaggeration or guess about their motives?"}}
    for r in rulings:
        q = (r.get("jev") or "").strip()
        if q and r.get("id"):
            qs[f"rule:{r['id']}"] = {"type": "noul", "instructions": q}
    return qs


def review(mail: dict, rulings: list[dict], ask=_ask) -> list[str]:
    """Why this email should wait for a person, empty when Jev passes it."""
    qs = checks_for(rulings)
    if not mail.get("line"):
        qs.pop("line")
    if not qs:
        return []
    state = {"opening_line": mail.get("line") or "", "subject": mail.get("subject") or "",
             "email": (mail.get("body") or "")[:3000]}
    answers, jev = ask(state, qs)
    if not answers:
        return ["Jev couldn't check it, so a person reads it first"]
    prob = jev.probability if jev else (lambda v: v if isinstance(v, (int, float)) else None)
    out = []
    for key in qs:
        a = answers.get(key)
        p = prob(a.get("noul")) if isinstance(a, dict) else None
        if p is None:
            out.append(f"Jev gave no answer for {key}")
        elif key == "line" and p < LINE_OK:
            out.append(f"the opener reads vague or harsh to Jev ({p:.2f})")
        elif key.startswith("rule:") and p >= RULE_BROKEN:
            rule = next((r["rule"] for r in rulings if f"rule:{r.get('id')}" == key), key)
            out.append(f"may break the rule \"{rule}\" ({p:.2f})")
    return out


def main(argv=None) -> int:
    import argparse
    ap = argparse.ArgumentParser(prog="gtme-jev", description=__doc__.splitlines()[0])
    ap.add_argument("email", help="a JSON file: {line, subject, body}")
    ap.add_argument("--rulings", help="a DECISIONS.json whose rulings carry `jev` questions")
    a = ap.parse_args(argv)
    mail = json.loads(Path(a.email).read_text())
    rulings = json.loads(Path(a.rulings).read_text()).get("rulings", []) if a.rulings else []
    why = review(mail, rulings)
    print(json.dumps({"hold": bool(why), "why": why}, indent=1))
    return 1 if why else 0


if __name__ == "__main__":
    sys.exit(main())
