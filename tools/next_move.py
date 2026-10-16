#!/usr/bin/env python3
"""gtme next-move: when a GTM step comes back empty or blocked, work out what to try next.

    chewbacca gtme next-move plan FILE|- [--no-jev] [--json] [--credits-left N] [--client-dir DIR]
    chewbacca gtme next-move run FILE|- [--max-steps N] [--no-jev] [--json]   free reads only, then the pick
    chewbacca gtme next-move replay DIR [--no-jev] [--json]                   the falsifier, on recorded blockers
    chewbacca gtme next-move record --client X --kind K --step S --cleared yes|no --credits N

Built 2026-10-16 after a Sabo call credited Chewbacca with "finding a way around a
blocker" when the parent domain came from parents.json, filled by hand after
barebells.com returned nobody. The loop has four parts:

  generate  every move operator reads the failure evidence and proposes moves. No
            operator is keyed to a failure type: all of them run every time, and an
            operator with nothing in the evidence to work from proposes nothing.
            The agent adds its own moves with "extra" in the request.
  bound     skills/gtm-engineering/references/next-move.json holds the boundaries as
            data, plus the client's DECISIONS.json rulings. A move that breaks one is
            dropped and logged with the rule, before Jev sees it, and checked again
            right before anything runs.
  rank      Jev gives each surviving move a probability of progress from the
            evidence. Cost, caps and the ledger's record stay in code:
            ev = p / (credits + downstream credits + minutes * credit_per_minute + overhead).
            Jev's number is evidence, never permission.
  act/learn the caller hands in executors (live_chain has the paid ones; this CLI
            only runs free reads). Every attempt lands in the GTME lesson ledger as
            move_stats on a next-move:<kind> lesson, and the next ranking reads it.
"""
import argparse
import copy
import html
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

KIT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(KIT / "tools"))
DATA_FILE = KIT / "skills" / "gtm-engineering" / "references" / "next-move.json"

# Phrases a company uses to say who owns it. "backed by" and "investor" are left
# out on purpose: WHOOP lists Abbott as a strategic investor, and an investor's
# staff don't buy for the brand.
OWNER_PHRASE = re.compile(
    r"\b(?:is\s+)?(?:a\s+)?(?:part of|owned by|subsidiary of|division of|a brand of|brand of|member of|"
    r"acquired by|company of)\s+(?:the\s+)?([A-Z][\w&'.-]*(?:\s+[A-Z][\w&'.-]*){0,4})")
COPYRIGHT = re.compile(r"(?:©|&copy;|\(c\))\s*(?:\d{4}(?:\s*[-–]\s*\d{4})?\s*)?"
                       r"([A-Z][\w&'.-]*(?:\s+[A-Z][\w&'.-]*){0,4})")
GENERIC = {"group", "ab", "inc", "llc", "ltd", "limited", "holdings", "holding", "co", "company", "corp",
           "corporation", "gmbh", "sa", "plc", "the", "brands", "international"}
LINK = re.compile(r"https?://([a-z0-9.-]+\.[a-z]{2,})", re.I)
TWO_LEVEL = {"co.uk", "com.au", "co.jp", "co.nz", "com.br", "co.za", "com.mx"}
EXECUTABLE = {"read", "paid_write", "write"}


def load_data(path=None):
    return json.loads(Path(path or DATA_FILE).read_text())


def registrable(host):
    host = (host or "").lower().strip(".")
    host = host[4:] if host.startswith("www.") else host
    parts = host.split(".")
    if len(parts) >= 3 and ".".join(parts[-2:]) in TWO_LEVEL:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:]) if len(parts) >= 2 else host


def name_key(name, drop_generic=False):
    words = re.findall(r"[a-z0-9]+", (name or "").lower())
    if drop_generic:
        while words and words[-1] in GENERIC:
            words.pop()
    return "".join(words)


def sentence_around(text, start, end, width=140):
    s = text[max(0, start - width):end + width]
    return " ".join(s.split())


def related_orgs(blocker, data):
    """Companies the evidence ties to this account: {domain: {"why", "trust"}}.

    trust says how the tie was made. Only "owned_and_linked" (an ownership sentence on the
    brand's own site naming a company whose domain the site also links) is strong enough for a
    caller to treat that domain's emails as the account's. "owned_guessed", "linked_only" and
    "email_domain" are leads to search, never proof of ownership.

    Read from the brand's own words (site, LinkedIn, research), the links its site
    carries, and the email domains of people already found at the account.
    """
    ev = blocker.get("evidence", {})
    account = blocker.get("account", {})
    brand_dom = registrable(account.get("domain", ""))
    brand_label = brand_dom.split(".")[0]
    brand_key = name_key(account.get("brand"))
    not_orgs = set(data.get("not_orgs", []))
    texts = [ev.get(k) or "" for k in ("site_text", "linkedin_text", "research_text", "error")]
    text = "\n".join(t for t in texts if t)

    names = []  # (name, quote)
    for rx in (OWNER_PHRASE, COPYRIGHT):
        for m in rx.finditer(text):
            name = m.group(1).strip(" .,")
            if name_key(name) and not name_key(name).startswith(brand_key or "\0"):
                names.append((name, sentence_around(text, m.start(), m.end())))

    links = set(ev.get("links") or []) | {m.group(1) for m in LINK.finditer(text)}
    domains = {}
    for host in links:
        d = registrable(host)
        if not d or d == brand_dom or d.split(".")[0] == brand_label or d in not_orgs:
            continue
        domains.setdefault(d, set()).add(host.lower())

    found = {}
    for name, quote in names:
        keys = {name_key(name), name_key(name, drop_generic=True)} - {""}
        matched = [d for d in domains if any(d.split(".")[0] == k or k in d.split(".")[0]
                                             or d.split(".")[0] in k for k in keys)]
        for d in matched:
            hosts = ", ".join(sorted(domains[d]))
            found.setdefault(d, {"why": f'the brand\'s own text says "{quote}", and it links {hosts}',
                                 "trust": "owned_and_linked"})
        if not matched:
            for k in sorted(keys):
                found.setdefault(f"{k}.com", {"why": f'the brand\'s own text says "{quote}"; '
                                                     f"{k}.com is guessed from that name, the site doesn't link it",
                                              "trust": "owned_guessed"})
    for d, hosts in domains.items():
        found.setdefault(d, {"why": f"the brand's site links {', '.join(sorted(hosts))}, with no ownership sentence",
                             "trust": "linked_only"})

    at = {}
    for p in ev.get("people") or []:
        dom = registrable((p.get("email") or "").rsplit("@", 1)[-1]) if "@" in (p.get("email") or "") else ""
        if dom and dom != brand_dom:
            at.setdefault(dom, []).append(p.get("name") or "someone")
    for d, who in at.items():
        found.setdefault(d, {"why": f"{len(who)} of the people found at this account have email at {d}",
                             "trust": "email_domain"})
    return found


# ---------------------------------------------------------------- generate

def cost_of(data, step):
    return float(data["costs"].get(data["rerun_cost"].get(step, step), 0.0))


def minutes_of(data, step):
    return float(data["minutes"].get(data["rerun_cost"].get(step, step), 1.0))


# org_hop, persona_swap and loosen_filter all rerun the people search, whichever
# step blocked: a wrong person at the email step is fixed upstream as often as
# not (Gymshark, 2026-10-16). What they propose comes from the evidence alone.
def op_org_hop(blocker, data):
    return [{"kind": "org_hop", "target": d, "action": f"rerun the people search on {d}",
             "why": why, "action_class": "paid_write", "credits": cost_of(data, "people_search"),
             "minutes": minutes_of(data, "people_search"), "reversible": True, "touches": ["table_write"],
             "reruns": "people_search", "trust": trust}
            for d, why, trust in ((d, o["why"], o["trust"]) for d, o in related_orgs(blocker, data).items())]


def op_read_source(blocker, data):
    out = []
    for src in data["sources"].get(blocker.get("step"), []):
        out.append({"kind": "read_source", "target": src["id"], "action": src["action"],
                    "why": f"adds {src['adds']} to the evidence, which nothing has read yet",
                    "action_class": src["action_class"],
                    "credits": float(data["costs"].get(src["id"], 0.0)),
                    "minutes": float(data["minutes"].get(src["id"], 1.0)),
                    "reversible": True, "touches": list(src.get("touches", [])), "adds": src["adds"]})
    return out


def op_next_person(blocker, data):
    people = [p for p in blocker.get("evidence", {}).get("people") or [] if not p.get("tried")]
    people.sort(key=lambda p: -(p.get("score") or 0))
    return [{"kind": "next_person", "target": p.get("name"),
             "action": f"find and verify the email for {p.get('name')} ({p.get('title') or 'no title'})",
             "why": f"scored {p.get('score')} for the goal and hasn't been tried",
             "action_class": "paid_write", "credits": float(data["costs"]["email_find"] + data["costs"]["email_verify"]),
             "minutes": float(data["minutes"]["email_find"]), "reversible": True, "touches": ["table_write"]}
            for p in people]


def op_persona_swap(blocker, data):
    persona = [t for t in blocker.get("persona") or []]
    current = [t.lower() for t in (blocker.get("evidence", {}).get("filters", {}).get("titles") or [])]
    add = [t for t in persona if t.lower() not in current]
    floor = blocker.get("score_floor", 0.5)
    rejected = sorted({p["title"] for p in blocker.get("evidence", {}).get("people") or []
                       if p.get("title") and (p.get("score") or 0) < floor})
    if not add and not rejected:
        return []
    return [{"kind": "persona_swap", "target": "",
             "action": f"rerun the people search with titles {add or current} and excluding {rejected or 'nothing'}",
             "why": f"the current title filter is {current or 'empty'}; the goal's persona is {persona}; "
                    f"found titles under the score floor: {rejected or 'none'}",
             "action_class": "paid_write", "credits": cost_of(data, "people_search"),
             "minutes": minutes_of(data, "people_search"), "reversible": True, "touches": ["table_write"],
             "reruns": "people_search", "args": {"titles": add or current, "exclude": rejected}}]


def op_loosen(blocker, data):
    step = "people_search"
    out = []
    for key, val in (blocker.get("evidence", {}).get("filters") or {}).items():
        if key == "titles":
            continue
        if isinstance(val, (int, float)) and not isinstance(val, bool):
            new = min(int(val) * 2, data["max_limit"])
            if new == val:
                continue
            change, target = f"raise {key} from {val} to {new}", f"{key}={new}"
        else:
            change, target = f"drop the {key} filter ({val})", f"{key}=none"
        out.append({"kind": "loosen_filter", "target": target, "action": f"rerun the people search and {change}",
                    "why": f"{key} is one of the filters the step ran with",
                    "action_class": "paid_write", "credits": cost_of(data, step),
                    "minutes": minutes_of(data, step), "reversible": True, "touches": ["table_write"],
                    "reruns": step})
    return out


def op_retry(blocker, data):
    step = blocker.get("step")
    if step not in data["rerun_cost"]:
        return []
    return [{"kind": "retry", "target": "", "action": f"rerun {step} unchanged",
             "why": f"the failure was: {blocker.get('failure') or blocker.get('evidence', {}).get('error') or 'not stated'}",
             "action_class": "paid_write", "credits": cost_of(data, step), "minutes": minutes_of(data, step),
             "reversible": True, "touches": ["table_write"], "reruns": step}]


def op_ask(blocker, data):
    return [{"kind": "ask_client", "target": "",
             "action": f"ask the client: {blocker.get('failure') or 'the step is blocked'}; do you know the answer?",
             "why": "the client may know what no source shows", "action_class": "ask", "credits": 0.0,
             "minutes": float(data["minutes"]["ask"]), "reversible": True, "touches": ["client_message"]}]


OPERATORS = (op_read_source, op_org_hop, op_next_person, op_persona_swap, op_loosen, op_retry, op_ask)


def signature(c):
    return f"{c['kind']}:{c.get('target') or ''}"


def generate(blocker, data):
    seen, out = set(blocker.get("tried") or []), []
    for op in OPERATORS:
        for c in op(blocker, data):
            sig = signature(c)
            if sig not in seen:
                seen.add(sig)
                out.append(c)
    for c in blocker.get("extra") or []:  # the agent's own moves
        c = dict(c, source="agent")
        c.setdefault("target", "")
        c.setdefault("touches", [])
        c.setdefault("reversible", False)
        c.setdefault("credits", 0.0)
        c.setdefault("minutes", 1.0)
        sig = signature(c)
        if sig not in seen:
            seen.add(sig)
            out.append(c)
    for i, c in enumerate(out):
        c["id"] = f"m{i}"
        c["signature"] = signature(c)
    return out


# ---------------------------------------------------------------- bound

def load_rulings(client_dir):
    if not client_dir:
        return {}
    f = Path(client_dir).expanduser() / "DECISIONS.json"
    try:
        d = json.loads(f.read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    rulings = d.get("rulings", d) if isinstance(d, dict) else d
    return {r.get("id"): r for r in rulings if isinstance(r, dict) and r.get("status", "active") == "active"}


def violations(c, ctx, data, rulings):
    """Every boundary this move breaks, as (rule id, reason). Empty means it may run."""
    out = []
    for rule in data["boundaries"]:
        w, hit = rule["when"], True
        if "action_class" in w:
            hit &= c.get("action_class") in w["action_class"]
        if "action_class_not_in" in w:
            hit &= c.get("action_class") not in w["action_class_not_in"]
        if "touches" in w:
            hit &= bool(set(c.get("touches") or []) & set(w["touches"]))
        if "credits_over" in w:
            left = ctx.get(w["credits_over"])
            hit &= left is not None and float(c.get("credits") or 0) > float(left)
        if hit and rule.get("unless_receipt") and (ctx.get("receipts") or {}).get(rule["unless_receipt"]) is True:
            hit = False
        if hit:
            out.append((rule["id"], rule["reason"]))
    for m in data.get("client_rulings", []):
        r = rulings.get(m["ruling"])
        if r and set(c.get("touches") or []) & set(m["forbids"]):
            out.append((f"client:{m['ruling']}", f"{m['reason']} ({r.get('who')}, {r.get('date')})"))
    return out


def bound(cands, blocker, data):
    ctx = {"credits_left": blocker.get("credits_left"), "receipts": blocker.get("receipts") or {}}
    rulings = load_rulings(blocker.get("client_dir"))
    keep, dropped = [], []
    for c in cands:
        v = violations(c, ctx, data, rulings)
        if v:
            dropped.append(dict(c, broke=[{"rule": r, "reason": why} for r, why in v]))
        else:
            keep.append(c)
    return keep, dropped


# ---------------------------------------------------------------- rank

def evidence_summary(blocker, limit=6000):
    ev = blocker.get("evidence", {})
    lines = [f"Goal: {blocker.get('goal')}", f"Account: {json.dumps(blocker.get('account', {}))}",
             f"Blocked step: {blocker.get('step')}", f"What happened: {blocker.get('failure')}"]
    if blocker.get("tried"):
        lines.append(f"Already tried: {', '.join(blocker['tried'])}")
    if ev.get("filters"):
        lines.append(f"Filters the step ran with: {json.dumps(ev['filters'])}")
    for p in ev.get("people") or []:
        at = (p.get("email") or "").rsplit("@", 1)[-1] if p.get("email") else None
        lines.append(f"Person found: {p.get('name')}, {p.get('title')}, goal score {p.get('score')}, "
                     f"email domain {at}, email status {p.get('email_status')}, tried {bool(p.get('tried'))}")
    for k in ("site_text", "linkedin_text", "research_text", "error"):
        t = ev.get(k)
        if t:
            lines.append(f"{k}: {t[:1500]}")
    for k, v in (ev.get("notes") or {}).items():
        lines.append(f"{k}: {v}")
    return "\n".join(lines)[:limit]


def jev_probabilities(blocker, cands, evaluate=None):
    """Jev's probability that each move makes progress, from the evidence. (dict, status)."""
    if not cands:
        return {}, "no candidates"
    import jev
    if evaluate is None:
        evaluate = jev.evaluate
    req = {"model": jev.MODEL, "state": evidence_summary(blocker), "questions": {
        c["id"]: {"type": "noul",
                  "instructions": f"Proposed next move: {c['action']}. Why it was proposed: {c['why']}. "
                                  "Given the goal and everything that already happened, will this move get "
                                  "the goal done, or turn up the evidence that gets it done?"}
        for c in cands}}
    try:
        out = evaluate(req)
        return {c["id"]: float(out["answers"][c["id"]]["noul"]) for c in cands}, "ok"
    except Exception as e:  # Jev failing leaves the ranking to the ledger and cost; say so
        return {}, f"unavailable: {type(e).__name__}: {str(e)[:120]}"


def priors(kinds, ledger=None):
    """Per move kind: (clears, attempts) summed over every client's next-move lesson."""
    try:
        import gtme_lessons
        lessons = gtme_lessons.load_all(ledger)
    except Exception:
        return {}
    out = {}
    for lesson in lessons:
        st = lesson.get("move_stats")
        if not st:
            continue
        for tag in lesson.get("applies_to", []):
            if tag.startswith("next-move:") and tag[10:] in kinds:
                c, n = out.get(tag[10:], (0, 0))
                out[tag[10:]] = (c + st.get("clears", 0), n + st.get("attempts", 0))
    return out


def rank(cands, blocker, data, evaluate=None, use_jev=True, ledger=None):
    probs, status = jev_probabilities(blocker, cands, evaluate) if use_jev else ({}, "off")
    record = priors({c["kind"] for c in cands}, ledger)
    k = float(data["jev_weight"])
    for c in cands:
        p_jev = probs.get(c["id"], 0.5)  # 0.5 is "no idea", used only when Jev didn't answer
        clears, n = record.get(c["kind"], (0, 0))
        p = (p_jev * k + clears) / (k + n)
        then = sum(float(data["costs"].get(x, 0)) for x in data.get("downstream", {}).get(c.get("reruns"), []))
        cost = (float(c.get("credits") or 0) + then + float(c.get("minutes") or 0) * data["credit_per_minute"]
                + data["overhead"])
        ev = p / cost / (1 if c.get("reversible") else 2)
        c.update(p_jev=round(p_jev, 3) if c["id"] in probs else None, record=f"{clears}/{n}",
                 p=round(p, 3), cost=round(cost, 3), ev=round(ev, 3))
    return sorted(cands, key=lambda c: -c["ev"]), status


def plan(blocker, data=None, evaluate=None, use_jev=True, ledger=None):
    data = data or load_data()
    cands = generate(blocker, data)
    keep, dropped = bound(cands, blocker, data)
    ranked, status = rank(keep, blocker, data, evaluate, use_jev, ledger)
    pick = next((c for c in ranked if c["action_class"] in EXECUTABLE | {"ask"} and c["p"] >= data["stop_below"]), None)
    decision = "stop" if pick is None else ("ask" if pick["action_class"] == "ask" else "run")
    return {"decision": decision, "pick": pick, "ranked": ranked, "dropped": dropped, "jev": status,
            "generated": len(cands)}


# ---------------------------------------------------------------- act and learn

def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-") or "unknown"


STAGE = {"people_search": "list", "buyer_rank": "list", "email_find": "verify", "email_verify": "verify",
         "launch_gate": "send"}


def record_outcome(client, kind, step, cleared, credits, when=None, ledger=None):
    """Add one attempt to the client's next-move:<kind> lesson; history keeps every earlier state."""
    import gtme_lessons
    lesson_id = f"{slug(client)}-move-{slug(kind)}"
    path = Path(ledger or gtme_lessons.LEDGER) / f"{lesson_id}.json"
    if path.is_file():
        lesson = json.loads(path.read_text())
        st = dict(lesson.get("move_stats") or {"attempts": 0, "clears": 0, "credits": 0.0})
    else:
        lesson, st = None, {"attempts": 0, "clears": 0, "credits": 0.0}
    st["attempts"] += 1
    st["clears"] += 1 if cleared else 0
    st["credits"] = round(st["credits"] + float(credits or 0), 3)
    result = (f"{st['clears']} of {st['attempts']} attempts cleared the blocker, "
              f"{st['credits']} credits spent in all; last attempt on {step}")
    oracle = {"metric": "observation", "numerator": st["clears"], "denominator": st["attempts"],
              "unit": "cases", "source": "run_log", "baseline": "the move not tried"}
    if lesson is None:
        lesson = {"id": lesson_id, "title": f"How often the {kind.replace('_', ' ')} move clears a blocked step",
                  "client": client, "date": when or __import__("datetime").date.today().isoformat(),
                  "stage": STAGE.get(step, "ops"), "applies_to": ["next-move", f"next-move:{kind}", step],
                  "hypothesis": f"{kind} clears blocked GTM steps often enough to try early.",
                  "change": f"gtme next-move ran {kind} when it ranked first.", "oracle": oracle,
                  "result": result, "verdict": "observed",
                  "next_decision": "gtme next-move reads move_stats on its next ranking.",
                  "check": f"Read this move's clear rate before ranking {kind} again.",
                  "evidence": ["tools/next_move.py"], "scope": f"{client} runs of gtme next-move",
                  "move_stats": st}
        return gtme_lessons.write(lesson, ledger)
    lesson["move_stats"] = st
    gtme_lessons.write(lesson, ledger, replace=True)  # write first so a refused lesson keeps its stats
    return gtme_lessons.record(lesson_id, result, "observed", oracle=oracle, when=when, ledger=ledger)


def merge_evidence(blocker, new):
    ev = blocker.setdefault("evidence", {})
    for k, v in (new or {}).items():
        if isinstance(v, list) and isinstance(ev.get(k), list):
            ev[k] = ev[k] + [x for x in v if x not in ev[k]]
        elif isinstance(v, str) and isinstance(ev.get(k), str) and v not in ev[k]:
            ev[k] = ev[k] + "\n" + v
        else:
            ev[k] = v


def run(blocker, executors, data=None, evaluate=None, use_jev=True, max_steps=4, ledger=None, learn=True,
        pick_fn=None, run_classes=EXECUTABLE):
    """Plan, run the top move that has an executor, learn, repeat until cleared, stopped or out of steps.

    executors maps a move kind (or "kind:target" for one source) to fn(move, blocker) returning
    {"cleared": bool, "credits": float, "evidence": {...}}. A move with no executor is never run;
    a move that breaks a boundary is never run, checked again here right before the call.
    """
    data = data or load_data()
    blocker = copy.deepcopy(blocker)
    blocker.setdefault("tried", [])
    trace, spent = [], 0.0
    for _ in range(max_steps):
        p = plan(blocker, data, evaluate, use_jev, ledger)
        runnable = [c for c in p["ranked"] if c["action_class"] in run_classes and c["p"] >= data["stop_below"]
                    and (c["signature"] in executors or c["kind"] in executors)]
        pick = pick_fn(p, runnable) if pick_fn else (runnable[0] if runnable else None)
        if pick is None:
            return {"cleared": False, "decision": "ask" if p["decision"] == "ask" else p["decision"],
                    "next": p["pick"], "trace": trace, "credits": spent, "last_plan": p}
        ctx = {"credits_left": blocker.get("credits_left"), "receipts": blocker.get("receipts") or {}}
        broke = violations(pick, ctx, data, load_rulings(blocker.get("client_dir")))
        if broke:  # never reached through plan(); here so a caller's pick_fn can't route around a boundary
            raise PermissionError(f"refusing {pick['signature']}: {broke}")
        fn = executors.get(pick["signature"]) or executors[pick["kind"]]
        out = fn(pick, blocker) or {}
        cost = float(out.get("credits", pick.get("credits") or 0))
        spent += cost
        if blocker.get("credits_left") is not None:
            blocker["credits_left"] = float(blocker["credits_left"]) - cost
        blocker["tried"].append(pick["signature"])
        merge_evidence(blocker, out.get("evidence"))
        trace.append({"move": pick["signature"], "action": pick["action"], "p": pick["p"], "ev": pick["ev"],
                      "jev": p["jev"],
                      "cleared": bool(out.get("cleared")), "credits": cost, "why": pick["why"]})
        if learn and pick["action_class"] != "read":
            record_outcome(blocker.get("client") or "unknown", pick["kind"], blocker.get("step"),
                           bool(out.get("cleared")), cost, ledger=ledger)
        if out.get("cleared"):
            return {"cleared": True, "decision": "cleared", "trace": trace, "credits": spent, "result": out}
    return {"cleared": False, "decision": "out of steps", "trace": trace, "credits": spent}


# ---------------------------------------------------------------- free reads

def read_site(domain, fetch=None):
    """The brand's homepage as text plus the hosts it links: the footer is where ownership lives."""
    url = f"https://{registrable(domain)}/"
    if fetch is None:
        def fetch(u):
            req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0 (chewbacca next-move)"})
            with urllib.request.urlopen(req, timeout=15) as r:
                return r.read(2_000_000).decode("utf-8", "ignore")
    raw = fetch(url)
    hosts = sorted({m.group(1).lower() for m in LINK.finditer(raw)})
    text = html.unescape(re.sub(r"<script.*?</script>|<style.*?</style>", " ", raw, flags=re.S | re.I))
    text = " ".join(re.sub(r"<[^>]+>", " ", text).split())
    keep = [sentence_around(text, m.start(), m.end()) for rx in (OWNER_PHRASE, COPYRIGHT) for m in rx.finditer(text)]
    return {"site_text": " | ".join(dict.fromkeys(keep)) or text[-1500:], "links": hosts}


def site_executor(move, blocker):
    try:
        ev = read_site(blocker["account"]["domain"])
    except Exception as e:
        return {"cleared": False, "credits": 0.0, "evidence": {"error": f"site read failed: {e}"}}
    return {"cleared": False, "credits": 0.0, "evidence": ev}


# ---------------------------------------------------------------- replay

def world_executor(world, data):
    def fn(move, blocker):
        hit = world.get(move["signature"])
        if hit is None:
            return {"cleared": False, "credits": move.get("credits", 0.0), "unknown": True}
        return {"cleared": bool(hit.get("cleared")), "credits": float(hit.get("credits", move.get("credits", 0))),
                "evidence": hit.get("evidence") or {}}
    return fn


class AllMoves(dict):
    """An executor table that has an entry for every move: the replay world answers each one."""
    def __init__(self, fn):
        super().__init__()
        self.fn = fn

    def __contains__(self, key):
        return True

    def get(self, key, default=None):
        return self.fn

    def __getitem__(self, key):
        return self.fn


def replay_case(case, data=None, evaluate=None, use_jev=True, max_steps=4):
    data = data or load_data()
    world = case["world"]
    fn = world_executor(world, data)
    # A replay answers asks from the record too: asking the client is a move the agent makes.
    loop = run(case["blocker"], AllMoves(fn), data, evaluate, use_jev, max_steps, learn=False,
               run_classes=EXECUTABLE | {"ask"})
    unknown = sum(1 for t in loop["trace"] if t["move"] not in world)

    def policy(moves):
        cleared, credits, steps, unk = False, 0.0, 0, 0
        for sig in moves:
            hit = world.get(sig)
            steps += 1
            if hit is None:
                unk += 1
                continue
            credits += float(hit.get("credits", 0))
            if hit.get("cleared"):
                cleared = True
                break
        return {"cleared": cleared, "credits": round(credits, 3), "steps": steps, "unknown": unk, "moves": moves}

    out = {"name": case["name"], "loop": {"cleared": loop["cleared"], "credits": round(loop["credits"], 3),
                                          "steps": len(loop["trace"]), "unknown": unknown,
                                          "moves": [t["move"] for t in loop["trace"]],
                                          "stopped": loop["decision"],
                                          "jev": sorted({t["jev"] for t in loop["trace"]})}}
    for key in sorted(k for k in case if k.startswith("old_path")):
        out[key] = policy(case[key])
    if "ask_once" in case:
        out["ask_once"] = policy([case["ask_once"]["signature"]] if case["ask_once"].get("signature") else [])
    return out


def score(results, policy):
    rows = [r[policy] for r in results if policy in r]
    cleared = sum(r["cleared"] for r in rows)
    credits = round(sum(r["credits"] for r in rows), 3)
    return {"policy": policy, "cases": len(rows), "cleared": cleared, "credits": credits,
            "cleared_per_credit": round(cleared / credits, 3) if credits else (float("inf") if cleared else 0.0),
            "steps": sum(r["steps"] for r in rows), "unknown_outcomes": sum(r["unknown"] for r in rows)}


# ---------------------------------------------------------------- CLI

def read_input(path):
    return json.loads(sys.stdin.read() if path == "-" else Path(path).read_text())


def show_plan(p, out=sys.stdout):
    print(f"decision: {p['decision']}   jev: {p['jev']}   generated {p['generated']}, "
          f"dropped {len(p['dropped'])}", file=out)
    for c in p["ranked"]:
        print(f"  ev {c['ev']:>6}  p {c['p']:<5} cost {c['cost']:<5} {c['signature']:<34} {c['action']}", file=out)
        print(f"         why: {c['why'][:200]}", file=out)
    for c in p["dropped"]:
        print(f"  DROPPED {c['signature']}: " + "; ".join(f"{b['rule']}: {b['reason']}" for b in c["broke"]), file=out)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="chewbacca gtme next-move", description=__doc__.splitlines()[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("plan", "run"):
        p = sub.add_parser(name)
        p.add_argument("file")
        p.add_argument("--no-jev", action="store_true")
        p.add_argument("--json", action="store_true")
        p.add_argument("--credits-left", type=float)
        p.add_argument("--client-dir")
        if name == "run":
            p.add_argument("--max-steps", type=int, default=3)
    p = sub.add_parser("replay")
    p.add_argument("dir")
    p.add_argument("--no-jev", action="store_true")
    p.add_argument("--json", action="store_true")
    p = sub.add_parser("record")
    p.add_argument("--client", required=True)
    p.add_argument("--kind", required=True)
    p.add_argument("--step", required=True)
    p.add_argument("--cleared", choices=("yes", "no"), required=True)
    p.add_argument("--credits", type=float, default=0.0)
    a = ap.parse_args(argv)

    if a.cmd == "record":
        f = record_outcome(a.client, a.kind, a.step, a.cleared == "yes", a.credits)
        print(f)
        return 0
    if a.cmd == "replay":
        cases = [json.loads(f.read_text()) for f in sorted(Path(a.dir).glob("*.json"))]
        results = [replay_case(c, use_jev=not a.no_jev) for c in cases]
        policies = ["loop"] + sorted({k for r in results for k in r if k not in ("name", "loop")})
        totals = [score(results, k) for k in policies]
        if a.json:
            print(json.dumps({"cases": results, "totals": totals}, indent=1))
        else:
            for r in results:
                print(r["name"])
                for k in policies:
                    if k in r:
                        x = r[k]
                        print(f"  {k:<9} cleared {str(x['cleared']):<5} credits {x['credits']:<5} "
                              f"steps {x['steps']} unknown {x['unknown']}  {' > '.join(x['moves']) or '(stop)'}")
            for t in totals:
                print(f"{t['policy']:<9} {t['cleared']}/{t['cases']} cleared, {t['credits']} credits, "
                      f"{t['cleared_per_credit']} cleared per credit, {t['unknown_outcomes']} unknown outcomes")
        return 0

    blocker = read_input(a.file)
    blocker = blocker.get("blocker", blocker)  # a replay case works as input too
    if a.credits_left is not None:
        blocker["credits_left"] = a.credits_left
    if a.client_dir:
        blocker["client_dir"] = a.client_dir
    if a.cmd == "plan":
        p = plan(blocker, use_jev=not a.no_jev)
        print(json.dumps(p, indent=1)) if a.json else show_plan(p)
        return 0
    # run: free reads only. Paid moves come back as the recommendation for a caller with its own gates.
    res = run(blocker, {"read_source:site_read": site_executor}, use_jev=not a.no_jev, max_steps=a.max_steps,
              learn=False)
    if a.json:
        print(json.dumps(res, indent=1, default=str))
    else:
        for t in res["trace"]:
            print(f"ran {t['move']}: {t['action']}")
        if "last_plan" in res:
            show_plan(res["last_plan"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
