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


_KIT_JEV = None


def kit_jev():
    """The kit's Jev client, bin/lib/jev.py, loaded by path. `import jev` is not safe here:
    tools/jev.py has the same name and no ask(), and once tools sat first on sys.path (11/2, a
    Baptize rebuild) every buyer check came back "Jev not scored, held" and the why-now check
    crashed. None when the file is missing."""
    global _KIT_JEV
    if _KIT_JEV is None:
        import importlib.util
        path = ROOT / "bin" / "lib" / "jev.py"
        if not path.exists():
            return None
        spec = importlib.util.spec_from_file_location("chewbacca_kit_jev", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        _KIT_JEV = mod
    return _KIT_JEV


def _ask(state: dict, questions: dict):
    jev = kit_jev()
    if jev is None:
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


# Growth Engine X's copy rubric (demand-gen-playbooks.md, gate 2): situation
# recognition 25, value clarity with proof 25, personalization 20, CTA effort
# 15, punchiness at 50-90 words 10, subject line 5. 85 ships. The four that
# need judgment go to Jev as Score questions in the same call; length and
# subject are counted here.
RUBRIC = {
    "grade:situation": (25, "How clearly does the email show it understands the recipient's own situation?",
                        ["Generic, could go to anyone", "Some sign it's about them", "Clearly about their situation"]),
    "grade:value": (25, "How clear is what the sender offers, and is there any proof or specific detail behind it?",
                    ["Unclear offer", "Clear offer, no proof", "Clear offer with a concrete detail"]),
    "grade:personal": (20, "How specific to this one recipient is the personalization?",
                       ["None", "Name or company only", "A real detail about them"]),
    "grade:cta": (15, "How easy is the closing ask to answer?",
                  ["Hard, needs a meeting or a long reply", "Medium", "Answerable in five words"]),
}


def _code_points(mail: dict) -> tuple[int, int]:
    """Punchiness (10) and subject (5), counted, never judged."""
    body = (mail.get("body") or "").split("\n\n" + "If you'd rather")[0]
    words = len(body.split())
    punch = 10 if 50 <= words <= 90 else 5 if words <= 125 else 0
    subject = (mail.get("subject") or "").removeprefix("Re: ").strip()
    subj = 5 if 2 <= len(subject.split()) <= 4 or not subject else 2 if subject else 0
    return punch, subj


def grade(mail: dict, answers: dict, levels=RUBRIC) -> tuple[int, dict]:
    """0-100 from Jev's expected level on each judged row plus the counted rows."""
    parts = {}
    for key, (weight, _q, crit) in levels.items():
        a = answers.get(key)
        score = a.get("score") if isinstance(a, dict) else None
        if not isinstance(score, (int, float)):
            return -1, parts
        parts[key.split(":", 1)[1]] = round(weight * max(0.0, min(1.0, score / (len(crit) - 1))))
    parts["punch"], parts["subject"] = _code_points(mail)
    return sum(parts.values()), parts


def review(mail: dict, rulings: list[dict], ask=_ask, min_grade=None) -> list[str]:
    """Why this email should wait for a person, empty when Jev passes it."""
    qs = checks_for(rulings)
    if not mail.get("line"):
        qs.pop("line")
    graded = bool(min_grade) and mail.get("step", 1) == 1
    if graded:
        for key, (_w, q, crit) in RUBRIC.items():
            qs[key] = {"type": "score", "instructions": q, "criteria": crit}
    if not qs:
        return []
    state = {"opening_line": mail.get("line") or "", "subject": mail.get("subject") or "",
             "email": (mail.get("body") or "")[:3000]}
    answers, jev = ask(state, qs)
    if not answers:
        return ["Jev couldn't check it, so a person reads it first"]
    prob = jev.probability if jev else (lambda v: v if isinstance(v, (int, float)) else None)
    out = []
    if graded:
        total, parts = grade(mail, answers)
        if total < 0:
            out.append("Jev couldn't grade the copy")
        elif total < min_grade:
            weak = ", ".join(f"{k} {v}" for k, v in parts.items())
            out.append(f"the copy grades {total} of 100, under {min_grade} ({weak})")
    for key in qs:
        if key.startswith("grade:"):
            continue
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


# A why-now is about the account or it is nothing. On 2026-10-27 a keyword check
# matched a baseball trade and another state's First Baptist as church signals;
# Jev reads each one against the org's name, city and site. Same bar as the
# opener (guessed, never measured): under 0.8 the signal doesn't count.
ABOUT_OK = 0.8


def _ask_about(state: dict, questions: dict):
    jev = kit_jev()
    if jev is None:
        return None, None
    return jev.ask(state, questions, decision="gtme-signal-about"), jev


def signals_about(org: dict, signals: list, ask=_ask_about) -> tuple[list, list] | None:
    """Split signals into (about this org, not), or None when Jev couldn't answer.

    `org` is {name, city, state, website}. One call for every signal."""
    if not signals:
        return [], []
    qs = {f"sig:{i}": {"type": "noul", "instructions":
                       f"Signal {i} below: is it about this exact organization ({org.get('name', '')}"
                       f"{', ' + org['city'] if org.get('city') else ''}{', ' + org['state'] if org.get('state') else ''}"
                       f"{', ' + org['website'] if org.get('website') else ''}) itself, not a different organization "
                       "with a similar name, another city, or unrelated news?"}
          for i in range(len(signals))}
    state = {"organization": org, "signals": [{"i": i, "what": s.get("what") or s.get("text") or "",
                                                "source": s.get("source") or "", "date": s.get("date") or ""}
                                               for i, s in enumerate(signals)]}
    answers, jev = ask(state, qs)
    if not answers:
        return None
    prob = jev.probability if jev else (lambda v: v if isinstance(v, (int, float)) else None)
    keep, drop = [], []
    for i, s in enumerate(signals):
        a = answers.get(f"sig:{i}")
        p = prob(a.get("noul")) if isinstance(a, dict) else None
        if p is None:
            return None
        (keep if p >= ABOUT_OK else drop).append({**s, "about": round(p, 2)})
    return keep, drop


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
