#!/usr/bin/env python3
"""chewbacca people-check: Amber's people rules over the people store, with Jev
for the cases rules can't settle. Reads only; nothing here merges or deletes.

  chewbacca people-check realness [--jev]   rows that aren't people (shortcodes, bots)
  chewbacca people-check dupes [--jev]      the same person filed twice, with the evidence
  chewbacca people-check mentions "<text>"  which contacts a sentence names
  chewbacca people-check filler "<text>"    a transcript minus Whisper's silence outros

The rules are Amber's (bin/lib/people-amber, from amber-id). Jev follows
TypeSafe's "route on uncertainty" pattern: the rules decide what they can, the
in-between rows go to Jev as one batched yes/no question each, and anything Jev
isn't sure of is left for a person. `--json` prints the raw result.
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

ROOT = Path(os.environ.get("CHEWBACCA_ROOT") or Path(__file__).resolve().parent.parent)
CLI = ROOT / "bin/lib/people-amber/cli.mjs"
DB = Path(os.environ.get("PEOPLE_DIR") or Path.home() / ".chewbacca/people") / "people.db"

# TypeSafe's worked example routes below 0.8 to a person; the same bar here.
# A wrong "not a person" hides a real friend, a wrong "same person" would
# merge two, so both directions need the same confidence.
JEV_SURE = 0.8
# Amber's realness gives a named person 1.0 and a shortcode 0.05; the rows in
# between (an unnamed number 0.25, a phone as the name 0.3, one letter 0.4) are
# the ones its own comments call low confidence. Those go to Jev.
REALNESS_UNSURE = (0.2, 0.5)
# One Jev request carries at most this many questions. Guessed, never measured:
# the request has a 100 KB budget and a contact row is a few hundred bytes.
JEV_BATCH = 40


def amber(op: str, payload: dict):
    r = subprocess.run(["node", str(CLI), op], input=json.dumps(payload), capture_output=True,
                       text=True, timeout=120)
    if r.returncode != 0:
        raise SystemExit(f"people-amber {op} failed: {r.stderr.strip()[-300:]}")
    return json.loads(r.stdout)


def store_rows(db: Path = DB) -> list[dict]:
    """Every live person, in the field names Amber's modules read."""
    if not db.exists():
        raise SystemExit(f"no people store at {db}: run `people import` first")
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    people = {r["id"]: dict(r) for r in con.execute(
        "SELECT id, name, phone, email, company, location, created_at FROM people WHERE deleted_at IS NULL")}
    phones, emails = {}, {}
    for r in con.execute("SELECT person_id, kind, value FROM identities"):
        if r["kind"] == "phone":
            phones.setdefault(r["person_id"], []).append(r["value"])
        elif r["kind"] == "email":
            emails.setdefault(r["person_id"], []).append(r["value"])
    con.close()
    rows = []
    for pid, p in people.items():
        ph = [x for x in [p["phone"]] + phones.get(pid, []) if x]
        em = [x for x in [p["email"]] + emails.get(pid, []) if x]
        rows.append({"id": pid, "name": p["name"], "full_name": p["name"], "company": p["company"],
                     "city": p["location"], "phone_primary": ph[0] if ph else None,
                     "phones_all": ",".join(ph), "phones": ph, "emails": ",".join(em),
                     "phoneNumbers": ph, "created_at": p["created_at"]})
    return rows


def jev_noul(states: list[tuple[str, dict]], instructions: str, decision: str) -> dict:
    """{key: probability} for each (key, state); missing when Jev didn't answer."""
    sys.path.insert(0, str(ROOT / "bin/lib"))
    try:
        import jev  # noqa: PLC0415
    except ImportError:
        return {}
    out = {}
    for i in range(0, len(states), JEV_BATCH):
        batch = states[i:i + JEV_BATCH]
        state = {key: s for key, s in batch}
        questions = {key: {"type": "noul", "instructions": f"{instructions} Answer only about the record {key}."}
                     for key, _ in batch}
        answers = jev.ask(state, questions, decision=decision) or {}
        for key in questions:
            answer = answers.get(key)
            p = jev.probability(answer.get("noul") if isinstance(answer, dict) else answer)
            if p is not None:
                out[key] = p
    return out


def realness(rows: list[dict], use_jev: bool) -> list[dict]:
    verdicts = {v["id"]: v for v in amber("realness", {"contacts": rows})}
    by_id = {r["id"]: r for r in rows}
    unsure = [pid for pid, v in verdicts.items() if REALNESS_UNSURE[0] <= v["confidence"] <= REALNESS_UNSURE[1]]
    if use_jev and unsure:
        states = [(f"c{pid}", {"name": by_id[pid]["name"] or "", "has_phone": bool(by_id[pid]["phones"]),
                               "has_email": bool(by_id[pid]["emails"]), "company": by_id[pid]["company"] or ""})
                  for pid in unsure]
        probs = jev_noul(states, "Is this address-book entry an individual human the owner knows personally, "
                                 "not a business, a bot, a verification-code sender, a service or a placeholder?",
                         "people-realness")
        for pid in unsure:
            p = probs.get(f"c{pid}")
            v = verdicts[pid]
            v["jev"] = p
            if p is not None and p >= JEV_SURE:
                v.update(isReal=True, decided_by="jev")
            elif p is not None and p <= 1 - JEV_SURE:
                v.update(isReal=False, decided_by="jev")
            else:
                v["decided_by"] = "a person"
    out = []
    for pid, v in verdicts.items():
        v["name"] = by_id[pid]["name"]
        v.setdefault("decided_by", "rules")
        out.append(v)
    return out


def dupes(rows: list[dict], use_jev: bool) -> list[dict]:
    pairs = amber("dupes", {"contacts": rows, "limit": 500})
    likely = [p for p in pairs if p["tier"] != "provable"]
    if use_jev and likely:
        def side(x):
            return {k: x.get(k) for k in ("name", "company", "tags")} | {
                "has_phone": bool(x.get("phones")), "email_domains": sorted({e.split("@")[-1] for e in x.get("emails", [])})}
        states = [(f"p{i}", {"a": side(p["keep"]), "b": side(p["drop"]), "why_flagged": p["reason"]})
                  for i, p in enumerate(likely)]
        probs = jev_noul(states, "Are records a and b the same individual person, filed twice?",
                         "people-dupes")
        for i, p in enumerate(likely):
            p["jev"] = probs.get(f"p{i}")
            p["decided_by"] = "jev" if p["jev"] is not None and p["jev"] >= JEV_SURE else "a person"
    for p in pairs:
        p.setdefault("decided_by", "rules" if p["tier"] == "provable" else "a person")
    return pairs


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="chewbacca people-check", description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="op", required=True)
    for name in ("realness", "dupes"):
        p = sub.add_parser(name)
        p.add_argument("--jev", action="store_true", help="send the cases rules can't settle to Jev")
        p.add_argument("--json", action="store_true")
    p = sub.add_parser("mentions")
    p.add_argument("text")
    p = sub.add_parser("filler")
    p.add_argument("text")
    a = ap.parse_args(argv)

    if a.op == "filler":
        print(json.dumps(amber("filler", {"text": a.text})))
        return 0
    rows = store_rows()
    if a.op == "mentions":
        for m in amber("mentions", {"text": a.text, "contacts": rows}):
            print(f"  {m['name']}  (id {m['id']})")
        return 0
    if a.op == "realness":
        result = realness(rows, a.jev)
        if a.json:
            print(json.dumps(result))
            return 0
        fake = [v for v in result if not v["isReal"]]
        ask = [v for v in result if v["decided_by"] == "a person"]
        print(f"{len(result)} contacts, {len(fake)} aren't people:")
        for v in fake[:40]:
            print(f"  {str(v['name'] or '(no name)'):<30} {v['reason']}" + (" (Jev)" if v["decided_by"] == "jev" else ""))
        if len(fake) > 40:
            print(f"  ...and {len(fake) - 40} more (--json for all)")
        if ask:
            print(f"\n{len(ask)} Jev wasn't sure about, left for you")
        return 0
    result = dupes(rows, a.jev)
    if a.json:
        print(json.dumps(result))
        return 0
    print(f"{len(result)} possible duplicates (nothing is merged here):")
    for p in result[:40]:
        tag = {"rules": "same", "jev": "Jev: same"}.get(p["decided_by"], "check")
        print(f"  [{tag}] {p['keep']['name']}  /  {p['drop']['name']}   {p['reason']}")
    if len(result) > 40:
        print(f"  ...and {len(result) - 40} more (--json for all)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
