#!/usr/bin/env python3
"""gtme-rules: every standing client ruling either runs as code or says it doesn't.

    gtme-rules audit [--decisions FILE ...] [--strict] [--json]
    gtme-rules check-text --client NAME [FILE|-] [--facts FILE] [--json]

Caleb, 2026-10-11: "Make chewb not just be a storage of a bunch of cool
things, but make it actually intelligently follow EVERY rule we set it". A
client's DECISIONS.json held ten rulings; nothing showed which of them any
code checked, so a ruling could sit in a file and be read as obeyed.

audit reads each active ruling's `enforced_by` list. A ref is
"path::needle": the file (relative to the client repo, or "kit:path" relative
to this kit) must exist and contain the needle, usually a test or function
name, so a deleted check shows up as BROKEN instead of silently passing. A
ruling with no refs is UNENFORCED. `--strict` exits 1 when any ruling is not
ENFORCED, for a pre-commit or CI line.

check-text runs the rulings that can be checked on words alone over text a
client will read: full words (no u, ur, w, plz), no process chatter, no claim
of interest the text doesn't quote, no em or en dashes, and with --facts every
number must be one the facts file holds. It exits 2 with each finding.
"""
import argparse
import glob
import json
import os
import re
import sys
from pathlib import Path

KIT = Path(__file__).resolve().parent.parent
CLIENT_REPOS = Path(os.environ.get("CHEWBACCA_CLIENT_REPOS", Path.home() / "code" / "work"))


def load(path):
    with open(path) as f:
        return json.load(f)


def decision_files(given):
    if given:
        return [Path(p) for p in given]
    return [Path(p) for p in sorted(glob.glob(str(CLIENT_REPOS / "*" / "DECISIONS.json")))]


def ref_state(ref, repo):
    """ENFORCED when the file exists and holds the needle, else BROKEN with why."""
    path, _, needle = str(ref).partition("::")
    if path.startswith("~/"):
        # A check that lives in another repo on this Mac (Togari's autopilot).
        target = Path(path).expanduser()
    else:
        base = KIT if path.startswith("kit:") else repo
        target = base / path.removeprefix("kit:")
    if not target.is_file():
        return "BROKEN", f"{path} does not exist"
    if needle and needle not in target.read_text(errors="replace"):
        return "BROKEN", f"{path} no longer contains {needle!r}"
    return "ENFORCED", path + (f"::{needle}" if needle else "")


def audit(files):
    report = []
    for f in files:
        d = load(f)
        repo = f.parent
        for r in d.get("rulings", []):
            if r.get("status") != "active":
                continue
            refs = r.get("enforced_by") or []
            states = [ref_state(x, repo) for x in refs]
            if not refs:
                state, detail = "UNENFORCED", r.get("unenforced_why", "no check names this ruling")
            elif all(s == "ENFORCED" for s, _ in states):
                state, detail = "ENFORCED", "; ".join(d for _, d in states)
            else:
                state, detail = "BROKEN", "; ".join(d for s, d in states if s != "ENFORCED")
            report.append({"client": d.get("client", repo.name), "id": r.get("id"), "state": state,
                           "rule": r.get("rule"), "detail": detail})
    return report


# --- text checks -------------------------------------------------------------

SHORTHAND = re.compile(r"\b(u|ur|w|plz|pls|tmr|abt|rn|bc|lol|lmk|idk)\b(?!['/.-]\w)", re.I)
# Words that describe our machinery rather than the client's outcome. Sagar,
# 10/3 and 10/5: "who hit launch" style messages get deleted from the channel.
# Words a client also uses for their own business ("pipeline", "model",
# "prompt reply") are left out, or every deal update would trip it.
CHATTER = re.compile(r"\b(togari|clay|workflow|webhook|enrichment|claygent|api|json|database|cron|"
                     r"llm|who hit launch|launched by)\b", re.I)
INTEREST = re.compile(r"\binterest(ed|ing)?\b|\bkeen\b|\bwarm lead\b|\bexcited to\b", re.I)
NEGATED = re.compile(r"\b(no|nobody|none|not|never|yet to)\b[^.!?,;]*\b(interest|keen)|n't\b[^.!?,;]*\b(interest|keen)", re.I)
QUOTE = re.compile(r"[\"“][^\"”]{8,}[\"”]")
DASH = re.compile("[—–]")
GREETING = re.compile(r"^\s*hey\b", re.I | re.M)
NUMBER = re.compile(r"(?<![\w.])\d[\d,]*(?:\.\d+)?%?")


def sentences(text):
    return [s for s in re.split(r"(?<=[.!?])\s+", re.sub(r"\s+", " ", text).strip()) if s]


def number_values(facts):
    vals = set()

    def walk(v):
        if isinstance(v, bool):
            return
        if isinstance(v, (int, float)):
            vals.add(float(v))
            vals.add(round(float(v), 1))
        elif isinstance(v, dict):
            for x in v.values():
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)
    walk(facts)
    return vals


def check_text(text, facts=None):
    findings = []
    for m in SHORTHAND.finditer(text):
        findings.append(("client-register", f"shorthand {m.group(0)!r}: write it out"))
    if GREETING.search(text):
        findings.append(("client-register", "opens with \"Hey\": client texts open on the point"))
    for s in sentences(text):
        c = CHATTER.search(s)
        if c:
            findings.append(("client-channel", f"process word {c.group(0)!r}: {s[:90]}"))
        if INTEREST.search(s) and not NEGATED.search(s) and not QUOTE.search(s):
            findings.append(("interest-from-text", f"claims interest with no quoted reply: {s[:90]}"))
    if DASH.search(text):
        findings.append(("client-register", "em or en dash"))
    if facts is not None:
        known = number_values(facts)
        for m in NUMBER.finditer(text):
            raw = m.group(0).replace(",", "").rstrip("%")
            try:
                v = float(raw)
            except ValueError:
                continue
            # Small counting words like "1 of 3 steps" and years are not claims.
            if v <= 3 or 2000 <= v <= 2100:
                continue
            if v not in known and round(v, 1) not in known:
                findings.append(("client-register", f"number {m.group(0)} is not in the facts file"))
    return findings


def main(argv=None):
    ap = argparse.ArgumentParser(prog="gtme-rules", description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("audit", help="which rulings run as code")
    a.add_argument("--decisions", action="append", help="a DECISIONS.json (default: every client repo)")
    a.add_argument("--strict", action="store_true", help="exit 1 unless every ruling is ENFORCED")
    a.add_argument("--json", action="store_true")
    t = sub.add_parser("check-text", help="check text a client will read")
    t.add_argument("--client", required=True)
    t.add_argument("file", nargs="?", default="-")
    t.add_argument("--facts", help="JSON whose numbers are the only ones the text may use")
    t.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)

    if args.cmd == "audit":
        files = decision_files(args.decisions)
        if not files:
            print("gtme-rules: no DECISIONS.json found", file=sys.stderr)
            return 2
        rep = audit(files)
        counts = {s: sum(1 for r in rep if r["state"] == s) for s in ("ENFORCED", "UNENFORCED", "BROKEN")}
        if args.json:
            print(json.dumps({"rulings": rep, "counts": counts}))
        else:
            for r in rep:
                print(f"{r['state']:<10} {r['client']}/{r['id']}: {r['detail']}")
            print(f"{counts['ENFORCED']} of {len(rep)} rulings run as code; "
                  f"{counts['UNENFORCED']} unenforced, {counts['BROKEN']} broken")
        return 1 if args.strict and len(rep) != counts["ENFORCED"] else 0

    text = sys.stdin.read() if args.file == "-" else Path(args.file).read_text()
    facts = load(args.facts) if args.facts else None
    found = check_text(text, facts)
    if args.json:
        print(json.dumps({"client": args.client, "findings": [{"ruling": r, "issue": i} for r, i in found]}))
    else:
        for r, i in found:
            print(f"{r}: {i}")
        if not found:
            print("ok: nothing a standing ruling refuses")
    return 2 if found else 0


if __name__ == "__main__":
    sys.exit(main())
