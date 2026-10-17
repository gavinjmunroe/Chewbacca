#!/usr/bin/env python3
"""gtme next-move: when a GTM step comes back empty or blocked, work out what to try next.

    chewbacca gtme next-move plan FILE|- [--no-jev] [--json] [--credits-left N] [--client-dir DIR]
    chewbacca gtme next-move run FILE|- [--max-steps N] [--no-jev] [--json]   free reads only, then the pick
    chewbacca gtme next-move replay DIR [--no-jev] [--json]                   the falsifier, on recorded blockers
    chewbacca gtme next-move record --client X --kind K --step S --cleared yes|no --credits N

Built 2026-10-16 after the first client's call credited Chewbacca with "finding a way around a
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
import unicodedata
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
ANCHOR = re.compile(r"<a\b[^>]*?\bhref\s*=\s*[\"']?\s*(?:https?:)?//([a-z0-9.-]+\.[a-z]{2,})", re.I)
ABOUT_PATH = re.compile(r"<a\b[^>]*?\bhref\s*=\s*[\"']?((?:https?://[a-z0-9.-]+)?/[^\"'\s>#?]*"
                        r"(?:about|our-story|ourstory|company|who-we-are)[^\"'\s>#?]*)", re.I)
# A host label that names delivery plumbing, not a company: shopifycdn, shopifysvc, website-files.
NOTICE = re.compile(r"(?:copyright\s*)?(?:©|&copy;|\(c\)).{0,120}?(?:all rights reserved\.?|$|(?=\|))", re.I)
INFRA_LABEL = re.compile(r"(?:^|-)(?:cdn|svc|static|assets?|files|cache|pixel)$|cdn$|svc$")
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
    not_orgs = set(data.get("not_orgs", [])) | {d for ds in (data.get("infra_domains") or {}).values() for d in ds}
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
        if not d or d == brand_dom or d.split(".")[0] == brand_label or infrastructure(d, not_orgs):
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
                                 "trust": "owned_and_linked", "hosts": sorted(domains[d])})
        if not matched:
            for k in sorted(keys):
                found.setdefault(f"{k}.com", {"why": f'the brand\'s own text says "{quote}"; '
                                                     f"{k}.com is guessed from that name, the site doesn't link it",
                                              "trust": "owned_guessed"})
    about = " ".join((ev.get("about_text") or "").split())
    for d, hosts in domains.items():
        if d in found:
            continue
        named = named_on_about(d, about)
        if named:
            found[d] = {"why": f'the brand\'s about page names "{named}" ("{sentence_around(about, *about_span(about, named), 80)}"), '
                               f"and it links {', '.join(sorted(hosts))}",
                        "trust": "named_on_about", "hosts": sorted(hosts)}
        else:
            found[d] = {"why": f"the brand's site links {', '.join(sorted(hosts))}, with no ownership sentence",
                        "trust": "linked_only", "hosts": sorted(hosts)}

    at = {}
    for p in ev.get("people") or []:
        dom = registrable((p.get("email") or "").rsplit("@", 1)[-1]) if "@" in (p.get("email") or "") else ""
        if dom and dom != brand_dom:
            at.setdefault(dom, []).append(p.get("name") or "someone")
    for d, who in at.items():
        found.setdefault(d, {"why": f"{len(who)} of the people found at this account have email at {d}",
                             "trust": "email_domain"})
    return found


def infrastructure(domain, listed):
    """True for a domain that hosts, serves, measures or widgets a site and so owns nothing."""
    return domain in listed or bool(INFRA_LABEL.search(domain.split(".")[0]))


def about_span(text, name):
    i = text.find(name)
    return (i, i + len(name)) if i >= 0 else (0, 0)


def named_on_about(domain, about):
    """The company name on the brand's about page that this domain's label spells, or "".

    A capitalized run of words whose letters, generic suffixes dropped, are the domain's label:
    "Strava Inc" for strava.com. A blog it links (therunbuddy.co.uk on runna.com)
    or a tool it embeds has no such sentence, so it stays linked_only.
    """
    if not about:
        return ""
    # Runna, 2026-10-17: "Copyright © 2025 Runna, The Run Buddy LTD" names the brand's own legal
    # entity, and therunbuddy.co.uk is its blog. A copyright line that names another company is
    # already read by COPYRIGHT above; here it only ever names the brand itself.
    about = NOTICE.sub(" ", about)
    label = domain.split(".")[0].replace("-", "")
    for m in re.finditer(r"[A-Z][\w&'.-]*(?:\s+[A-Z][\w&'.-]*){0,4}", about):
        words = m.group(0).split()
        for i in range(len(words)):
            for j in range(len(words), i, -1):
                name = " ".join(words[i:j])
                if label and label in (name_key(name), name_key(name, drop_generic=True)):
                    return name
    return ""


# ---------------------------------------------------------------- generate

def cost_of(data, step):
    return float(data["costs"].get(data["rerun_cost"].get(step, step), 0.0))


def minutes_of(data, step):
    return float(data["minutes"].get(data["rerun_cost"].get(step, step), 1.0))


# org_hop, persona_swap and loosen_filter all rerun the people search, whichever
# step blocked: a wrong person at the email step is fixed upstream as often as
# not (Gymshark, 2026-10-16). What they propose comes from the evidence alone.
CORP_SUFFIX = re.compile(r"(group|holdings?|brands|inc|corp|co|international|global|hq)$")
STAFF_HOST = re.compile(r"^(careers?|jobs|team|people|work|join)\.")
TRUST_RANK = {"owned_and_linked": 3, "owned_guessed": 2, "named_on_about": 1, "email_domain": 1}


def company_stem(domain):
    label = domain.split(".")[0]
    return CORP_SUFFIX.sub("", label) or label


# Replays, 2026-10-16: on a 0.67 vs 0.66 Jev tie the loop searched the parent's group domain and
# then its operating domain, 0.5 credits for one company. Domains that share a stem are one company,
# so the hop proposes its best untried domain: strongest tie, then a careers or jobs host
# (people work there), then the shorter name. The rest wait until
# that one has been tried.
def op_org_hop(blocker, data):
    tried = set(blocker.get("tried") or [])
    groups = {}
    for d, o in related_orgs(blocker, data).items():
        # First creator client, 2026-10-17: bare links hopped Runna to therunbuddy.co.uk, website-files.com and
        # marker.io and Zico to acsbapp.com, shopifysvc.com and shopifycdn.com, 0.5 credits each and
        # nobody found. A link alone is a blog, a CDN or a widget far more often than an owner, so a
        # paid search needs an ownership sentence, a company the about page names, or found emails.
        if o["trust"] not in TRUST_RANK:
            continue
        groups.setdefault(company_stem(d), []).append((d, o))
    out = []
    for members in groups.values():
        members.sort(key=lambda m: (-TRUST_RANK.get(m[1]["trust"], 0),
                                    -any(STAFF_HOST.match(h) for h in m[1].get("hosts", [])), len(m[0])))
        left = [m for m in members if f"org_hop:{m[0]}" not in tried]
        if not left:
            continue
        d, o = left[0]
        also = [m[0] for m in left[1:]]
        out.append({"kind": "org_hop", "target": d, "action": f"rerun the people search on {d}",
                    "why": o["why"] + (f"; same company as {', '.join(also)}, searched first" if also else ""),
                    "action_class": "paid_write", "credits": cost_of(data, "people_search"),
                    "minutes": minutes_of(data, "people_search"), "reversible": True, "touches": ["table_write"],
                    "reruns": "people_search", "trust": o["trust"]})
    return out


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
    return f"{c.get('kind') or 'agent'}:{c.get('target') or ''}"


# Break-it pass, 2026-10-16: an agent move labeled "write" whose action was "delete the empty
# row and retry" landed in ranked, and a move with no "kind" crashed generate(). An agent's
# move is now classed by what its action text and touches say it does, and the most
# restrictive of that and its own label wins. Code-built moves are trusted; agent ones aren't.
RISK = ["read", "ask", "write", "paid_write", "add_leads", "send", "launch", "delete"]
DOES = [
    ("delete", re.compile(r"\b(delet\w*|remov\w*|purg\w*|eras\w*|wip(e|es|ed|ing)\b|drop (the|a|all)\b|"
                          r"archiv\w*|truncat\w*|clear (the|all)\b|get rid of|nuk\w*|scrap\w*|trash\w*|destroy\w*)", re.I)),
    ("launch", re.compile(r"\b(launch\w*|(start|kick off|turn on) (the |a )?(campaign|sequence)s?|resum\w*|unpaus\w*|"
                          r"activat\w*|go live|hit (go|start|send))\b", re.I)),
    ("send", re.compile(r"\b(send\w*|sent|reply to|respond to|e-?mail (them|him|her|the (lead|prospect|buyer|contact))|"
                        r"messag\w* (them|him|her|the)|dm|text (them|him|her)|intro e-?mail|outreach|blast\w*|"
                        r"fire off|ping (them|him|her|the)|cold e-?mail\w*|mail merge)\b", re.I)),
    ("add_leads", re.compile(r"\b(add[- ]leads?|enroll\w*|add .{0,40}to (the |a )?(campaign|sequence))\b", re.I)),
]
# Attack round 2, 2026-10-16: "reach out to her by email to confirm" labeled read got ranked.
# A keyword list always loses to paraphrase, so the default flipped: an agent move counts as a
# read or an ask only when its whole action matches one of these known-safe shapes. Anything
# else labeled read or ask is treated as a send, which no-send-without-ready drops. Jev can't
# unlock one: a test with a Jev that answers "read" to everything got "check in with her by
# email" through, so Jev only confirms or raises a class.
SAFE = {
    "read": re.compile(r"^(re-?)?(read|look up|look at|check|search|fetch|scan|review|list|count|compare|score|rank|"
                       r"find|pull|view|inspect|grep|query)\b[^.;!?]{0,140}$", re.I),
    "ask": re.compile(r"^ask (the )?(client|team|caleb|[A-Z][a-z]+( and [A-Z][a-z]+)?)\b[^.;!?]{0,200}$"),
}
# A safe shape is one clause. Round 3 of the attack got "check in with her by email", "review
# and ship the drafts" and "search for her number and call her" past a verb-only allowlist.
DOES_SOMETHING = re.compile(
    r"\b(and|then|after|before|plus|also|e-?mail\w*|messag\w*|call\w*|phon\w*|text\w*|whatsapp|slack|dm|"
    r"connect\w*|note|intro\w*|pitch\w*|ship\w*|live|post\w*|publish\w*|trigger\w*|wave|overwrit\w*|updat\w*|"
    r"set|write|writ\w*|chang\w*|edit\w*|mov\w*|sign\w*|buy\w*|enroll\w*|in with|reach\w*|contact\w*|"
    r"submit\w*|book\w*|invit\w*|schedul\w*)\b|[,;&]", re.I)
TOUCH_WORDS = [("purchase", re.compile(r"\b(buy\w*|purchas\w*|subscrib\w*|pay for|upgrade (the )?plan|sign(ing|s|ed)? up)\b", re.I)),
               ("auto_run", re.compile(r"\bauto[- ]?run\b", re.I)),
               ("vendor_ui_by_hand", re.compile(r"\b(open|click\w*) (the |in )?(clay|ui|browser)\b", re.I))]


def plain(text):
    """Fold compatibility forms (NFKC: fullwidth, ligatures) and drop invisible format characters,
    so "ＤＥＬＥＴＥ" and "d<zero-width space>elete" read as delete. Cross-script lookalikes
    (a Cyrillic e) are NOT folded; that's why agent moves fail closed without a Jev confirmation."""
    text = unicodedata.normalize("NFKC", str(text))
    return "".join(ch for ch in text if unicodedata.category(ch) != "Cf")


def agent_move(c):
    """Normalize one agent-proposed move. Anything malformed comes back as a move the bounds drop."""
    if not isinstance(c, dict):
        return {"kind": "agent", "target": slug(str(c))[:60], "action": str(c)[:300], "why": "",
                "action_class": None, "touches": [], "credits": 0.0, "minutes": 1.0, "reversible": False,
                "source": "agent", "malformed": "a move is a JSON object"}
    # Security review, 2026-10-16: an agent move named "org_hop" reached the code's own
    # org_hop executor with an agent-chosen target and its own "trust". Agent kinds now sit
    # under "agent:", and trusted fields are dropped, so no agent move reaches a built-in executor.
    # Security review, 2026-10-16: an agent could set "note" itself and stop Jev raising its ask
    # to a send. Every flag the loop sets is stripped from input, and the ask exemption lives in
    # "_ask_kept", which only the branch below writes.
    c = {k: v for k, v in c.items() if not str(k).startswith("_") and k not in (
        "trust", "reruns", "args", "signature", "id", "source", "unvetted", "reclassed", "jev_confirmed",
        "malformed", "note")}
    c["source"] = "agent"
    action = str(c.get("action") or "")
    c["action"] = action
    kind = str(c.get("kind") or "move")
    c["kind"] = kind if kind.startswith("agent:") else f"agent:{kind}"
    c["target"] = str(c.get("target") or slug(action)[:60])
    c["why"] = str(c.get("why") or "")
    touches = c.get("touches") or []
    c["touches"] = [str(t) for t in touches] if isinstance(touches, list) else [str(touches)]
    for word, rx in TOUCH_WORDS:
        if rx.search(plain(action)) and word not in c["touches"]:
            c["touches"].append(word)
    for key, default in (("credits", 0.0), ("minutes", 1.0)):
        try:
            val = float(c.get(key, default))
        except (TypeError, ValueError):
            val, c["malformed"] = default, f"{key} is not a number"
        if val != val or val < 0 or val == float("inf"):  # NaN, negative, infinite
            val, c["malformed"] = default, f"{key} must be a finite number of zero or more"
        c[key] = val
    c["reversible"] = c.get("reversible") is True
    said = c.get("action_class")
    said_text = plain(action) + " | " + plain(" ".join(c["touches"])).replace("_", " ")
    does = [cls for cls, rx in DOES if rx.search(said_text)]
    # Replays, 2026-10-16: "ask Jonah and Ryan which mailing address to use, or for a written
    # ruling to send without one" read as a send and dropped the move that cleared Zeutara's
    # gate. An ask goes to a person and never runs, so an ask-shaped move whose only keyword is
    # send stays an ask. A chained second action ("then send the intro") still counts.
    if (said == "ask" and does == ["send"] and SAFE["ask"].match(plain(action).strip())
            and not ASK_CHAIN.search(plain(action)) and set(c["touches"]) <= {"client_message"}):
        does = []
        c["_ask_kept"] = True
        c["note"] = "mentions sending inside a question for the client; asks go to a person and never run"
    if said in RISK:
        c["action_class"] = max([said, *does], key=RISK.index)
        if c["action_class"] != said:
            c["reclassed"] = f"labeled {said}, but the action reads as {c['action_class']}"
    elif does:
        c["action_class"] = max(does, key=RISK.index)
    # else: no known label and nothing read from the text, so "unclassified" drops it
    text = plain(action).strip()
    shape_ok = c.get("action_class") in SAFE and SAFE[c["action_class"]].match(text) and (
        not ASK_CHAIN.search(text) if c["action_class"] == "ask" else not DOES_SOMETHING.search(text))
    if c.get("action_class") in SAFE and not shape_ok:
        c["unvetted"] = {"said": c["action_class"], "keyword_hit": bool(does)}
        c["action_class"] = "send"
        c["reclassed"] = (f"labeled {c['unvetted']['said']}, but the action isn't one of the known-safe "
                          f"{c['unvetted']['said']} shapes, so it counts as a send")
    return c


def num(value, default=None):
    try:
        v = float(value)
    except (TypeError, ValueError):
        return default
    return v if v == v and v not in (float("inf"), float("-inf")) else default


def clean_blocker(raw):
    """The blocker in the shape every operator expects. Bad fields become empty, never a crash.

    A credits_left that isn't a number becomes 0, so every paid move drops: an unreadable
    budget is no budget (break-it pass, 2026-10-16: "abc" crashed the bound step).
    """
    if not isinstance(raw, dict):
        raise ValueError("the blocker is a JSON object with goal, step, account, failure and evidence")
    b = dict(raw)
    acct = b.get("account")
    b["account"] = {k: str(v) for k, v in acct.items() if v is not None} if isinstance(acct, dict) else (
        {"brand": str(acct)} if acct else {})
    for key in ("goal", "step", "failure", "client"):
        if b.get(key) is not None and not isinstance(b[key], str):
            b[key] = str(b[key])
    ev = b.get("evidence")
    ev = dict(ev) if isinstance(ev, dict) else {}
    people = ev.get("people")
    ev["people"] = [dict(p, score=num(p.get("score"), 0.0), name=str(p.get("name") or "someone"),
                         title=p.get("title") if isinstance(p.get("title"), str) else None,
                         email=p.get("email") if isinstance(p.get("email"), str) else None)
                    for p in (people if isinstance(people, list) else []) if isinstance(p, dict)]
    ev["filters"] = ev.get("filters") if isinstance(ev.get("filters"), dict) else {}
    ev["links"] = [str(x) for x in ev.get("links")] if isinstance(ev.get("links"), list) else []
    for k in ("site_text", "linkedin_text", "research_text", "error"):
        if ev.get(k) is not None and not isinstance(ev[k], str):
            ev[k] = json.dumps(ev[k], ensure_ascii=False)[:4000]
    if not isinstance(ev.get("notes"), dict):
        ev.pop("notes", None)
    b["evidence"] = ev
    tried = b.get("tried")
    b["tried"] = [str(t) for t in tried] if isinstance(tried, list) else ([str(tried)] if tried else [])
    persona = b.get("persona")
    b["persona"] = [str(t) for t in persona] if isinstance(persona, list) else ([str(persona)] if persona else [])
    if "credits_left" in b and b["credits_left"] is not None:
        b["credits_left"] = max(num(b["credits_left"], 0.0), 0.0)
    b["receipts"] = b["receipts"] if isinstance(b.get("receipts"), dict) else {}
    b["flags"] = [str(x) for x in b["flags"]] if isinstance(b.get("flags"), list) else []
    if b.get("client_dir") is not None and not isinstance(b["client_dir"], str):
        b["client_dir"] = None
    return b


def generate(blocker, data):
    seen, out = set(blocker.get("tried") or []), []
    for op in OPERATORS:
        for c in op(blocker, data):
            sig = signature(c)
            if sig not in seen:
                seen.add(sig)
                out.append(c)
    extra = blocker.get("extra") or []
    for c in extra if isinstance(extra, list) else [extra]:  # the agent's own moves
        c = agent_move(c)
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
    try:
        f = Path(client_dir).expanduser() / "DECISIONS.json"
    except (TypeError, ValueError):
        return {}
    try:
        d = json.loads(f.read_text())
    except (OSError, ValueError):  # ValueError covers bad JSON and a NUL in the path
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
        if "flag" in w:
            hit &= w["flag"] in (ctx.get("flags") or [])
        if "malformed" in w:
            hit &= bool(c.get("malformed"))
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
    ctx = {"credits_left": blocker.get("credits_left"), "receipts": blocker.get("receipts") or {},
           "flags": blocker.get("flags") or []}
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


# How an ask smuggles a second action. Attack on the win-back, 2026-10-16: "ask Ava for a
# meeting by sending her the intro" and "ask Ava by messaging her on LinkedIn" stayed asks.
ASK_CHAIN = re.compile(r"\b(then|after that|afterwards|also|and)\s+(send|e-?mail|messag|launch|start|delet|remov|"
                       r"add|enroll|reply|dm|text|call|post)\w*|[;:]|\b(send|e-?mail|messag|dm|text|ping)\w* "
                       r"(her|him|them|it|this|the (intro|pitch|draft|deck|sequence|email|campaign))\b|"
                       r"\b(by|via|over|through|on)\s+(send|e-?mail|messag|dm|text|linkedin|whatsapp|phone|call|sms)\w*|"
                       r",\s*(send|e-?mail|messag|launch|delet|remov)\w*", re.I)


JEV_CLASSES = {"read": "Only reads or looks something up; changes nothing and contacts nobody",
               "ask": "Asks the client or a teammate a question; nothing goes to a lead or prospect",
               "write": "Changes our own working data (a table cell, a draft) and nothing anyone outside sees",
               "send": "Sends an email, message or reply to someone outside the team",
               "launch": "Starts, resumes or activates a campaign or sequence",
               "add_leads": "Adds people to a campaign or sequence",
               "delete": "Deletes, removes, clears or archives data or records"}


def jev_reclass(cands, evaluate=None):
    """Ask Jev what each agent move does. Jev can only make a move MORE restricted, never less:
    any class it gives 25% or more that is riskier than the label wins. Returns a status line."""
    agent = [c for c in cands if c.get("source") == "agent" and c.get("action_class") in RISK]
    if not agent:
        return "no agent moves"
    import jev
    evaluate = evaluate or jev.evaluate
    req = {"model": jev.MODEL, "state": "\n".join(f"{c['id']}: {c['action']}" for c in agent),
           "questions": {c["id"]: {"type": "choice", "criteria": JEV_CLASSES,
                                   "instructions": f"Move {c['id']}: \"{c['action']}\". What does carrying it out do?"}
                         for c in agent}}
    try:
        answers = evaluate(req)["answers"]
    except Exception as e:
        return f"unavailable, keywords only: {type(e).__name__}"
    for c in agent:
        probs = (answers.get(c["id"]) or {}).get("probabilities") or {}
        top = max(probs, key=lambda k: num(probs[k], 0)) if probs else None
        if top in RISK and RISK.index(top) <= RISK.index(c["action_class"]):
            c["jev_confirmed"] = True
        # An ask kept as an ask (see agent_move) can still be raised to delete, launch or
        # add_leads, but not to send: mentioning a send is why it was kept.
        risky = [k for k, v in probs.items() if k in RISK and num(v, 0) >= 0.25
                 and RISK.index(k) > RISK.index(c["action_class"])
                 and not (c.get("_ask_kept") is True and c["action_class"] == "ask" and k == "send")]
        if risky:
            was, c["action_class"] = c["action_class"], max(risky, key=RISK.index)
            c["reclassed"] = f"labeled {was}, Jev reads the action as {c['action_class']}"
    return "ok"


def hold_unconfirmed(cands, classed):
    """An agent move Jev didn't confirm never runs: it comes back as an ask for a person."""
    for c in cands:
        if c.get("source") == "agent" and c.get("action_class") in EXECUTABLE and not c.get("jev_confirmed"):
            c["reclassed"] = (f"held for a person: labeled {c['action_class']}, and Jev didn't confirm it "
                              f"({classed})")
            c["action_class"] = "ask"


def plan(blocker, data=None, evaluate=None, use_jev=True, ledger=None):
    data = data or load_data()
    blocker = clean_blocker(blocker)
    cands = generate(blocker, data)
    classed = jev_reclass(cands, evaluate) if use_jev else "off, keywords only"
    hold_unconfirmed(cands, classed)
    keep, dropped = bound(cands, blocker, data)
    ranked, status = rank(keep, blocker, data, evaluate, use_jev, ledger)
    pick = next((c for c in ranked if c["action_class"] in EXECUTABLE | {"ask"} and c["p"] >= data["stop_below"]), None)
    decision = "stop" if pick is None else ("ask" if pick["action_class"] == "ask" else "run")
    return {"decision": decision, "pick": pick, "ranked": ranked, "dropped": dropped, "jev": status,
            "agent_classes": classed, "generated": len(cands)}


# ---------------------------------------------------------------- blocked paths

# Seam for tests and callers with no Jev of their own; None is live Jev.
DEFAULT_EVALUATE = None


def on_blocked(step, account, failure, *, client=None, goal=None, evidence=None, persona=None, tried=None,
               credits_left=None, client_dir=None, extra=None, log_path=None, evaluate=None, use_jev=True,
               data=None, flags=None):
    """A blocked step's record and next-move's plan for it, in place of an empty return or a raise.

    Runs nothing. The caller keeps its own gates, so a paid or outbound pick is a
    recommendation until the caller's gate runs it. The record is appended to log_path (JSONL)
    when one is given. Never raises: a broken plan comes back as decision "stop" with the reason.
    """
    blocker = {"client": client or "unknown", "step": step, "account": account or {}, "failure": failure,
               "goal": goal or f"get past the blocked {step} step", "evidence": evidence or {},
               "persona": persona or [], "tried": tried or [], "extra": extra or [], "flags": flags or []}
    if credits_left is not None:
        blocker["credits_left"] = credits_left
    if client_dir:
        blocker["client_dir"] = client_dir
    try:
        p = plan(blocker, data, evaluate or DEFAULT_EVALUATE, use_jev)
    except Exception as e:  # a blocked path must still say it's blocked
        p = {"decision": "stop", "pick": None, "ranked": [], "dropped": [], "jev": f"plan failed: {type(e).__name__}: {e}"}
    pick = p.get("pick")
    rec = {"at": __import__("time").strftime("%Y-%m-%dT%H:%M:%S%z"), "client": blocker["client"], "step": step,
           "account": blocker["account"], "failure": str(failure)[:500], "decision": p["decision"],
           "next": {k: pick.get(k) for k in ("signature", "action", "why", "action_class", "credits")} if pick else None,
           "ranked": [{"move": c["signature"], "p": c.get("p"), "ev": c.get("ev")} for c in p["ranked"][:5]],
           "dropped": [{"move": c["signature"], "rules": [b["rule"] for b in c.get("broke", [])]} for c in p["dropped"]],
           "jev": p["jev"]}
    if log_path:
        try:
            with open(log_path, "a") as f:
                f.write(json.dumps(rec, ensure_ascii=False, default=str) + "\n")
        except OSError as e:
            rec["log_error"] = str(e)
    return rec


def next_line(rec):
    """One plain line for a report: what's blocked and what to do next."""
    nxt = rec.get("next")
    if not nxt:
        return f"blocked at {rec['step']}: {rec['failure']}; no move worth making, stop"
    return f"blocked at {rec['step']}: {rec['failure']}; next ({rec['decision']}): {nxt['action']}"


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
    blocker = clean_blocker(copy.deepcopy(blocker))
    trace, spent = [], 0.0
    for _ in range(max_steps):
        p = plan(blocker, data, evaluate, use_jev, ledger)
        runnable = [c for c in p["ranked"] if c["action_class"] in run_classes and c["p"] >= data["stop_below"]
                    and (c["signature"] in executors or c["kind"] in executors)]
        pick = pick_fn(p, runnable) if pick_fn else (runnable[0] if runnable else None)
        if pick is None:
            return {"cleared": False, "decision": "ask" if p["decision"] == "ask" else p["decision"],
                    "next": p["pick"], "trace": trace, "credits": spent, "last_plan": p}
        ctx = {"credits_left": blocker.get("credits_left"), "receipts": blocker.get("receipts") or {},
               "flags": blocker.get("flags") or []}
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

def page_text(raw):
    text = html.unescape(re.sub(r"<script.*?</script>|<style.*?</style>", " ", raw, flags=re.S | re.I))
    return " ".join(re.sub(r"<[^>]+>", " ", text).split())


def about_urls(raw, domain, limit=2):
    """Same-site about pages the homepage links, first found first."""
    site = registrable(domain)
    out = []
    for m in ABOUT_PATH.finditer(raw):
        href = html.unescape(m.group(1))
        host = LINK.match(href)
        if host and registrable(host.group(1)) != site:
            continue
        url = href if host else f"https://{site}{href}"
        if url not in out:
            out.append(url)
    return out[:limit]


def read_site(domain, fetch=None):
    """The brand's homepage and about page as text, plus the hosts their anchors link.

    links holds only <a href> hosts. Runna and Zico, 2026-10-17: every hop target that found
    nobody (website-files.com, marker.io, acsbapp.com, shopifysvc.com, shopifycdn.com) came from a
    stylesheet, preconnect or script URL, which says what the site is built on, not who owns it.
    Those hosts go in asset_hosts for the record and never reach a hop.
    """
    url = f"https://{registrable(domain)}/"
    if fetch is None:
        def fetch(u):
            req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0 (chewbacca next-move)"})
            with urllib.request.urlopen(req, timeout=15) as r:
                return r.read(2_000_000).decode("utf-8", "ignore")
    raw = fetch(url)
    pages, about = [raw], []
    for u in about_urls(raw, domain):
        try:
            page = fetch(u)
        except Exception:
            continue
        pages.append(page)
        about.append(page_text(page))
    anchors = sorted({m.group(1).lower() for p in pages for m in ANCHOR.finditer(p)})
    every = {m.group(1).lower() for p in pages for m in LINK.finditer(p)}
    keep = []
    for text in [page_text(p) for p in pages]:
        keep += [sentence_around(text, m.start(), m.end()) for rx in (OWNER_PHRASE, COPYRIGHT) for m in rx.finditer(text)]
    return {"site_text": " | ".join(dict.fromkeys(keep)) or page_text(raw)[-1500:], "links": anchors,
            "asset_hosts": sorted(every - set(anchors)), "about_text": " ".join(about)[:20000]}


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
    try:
        got = json.loads(sys.stdin.read() if path == "-" else Path(path).read_text())
    except (OSError, ValueError) as e:
        raise SystemExit(f"gtme next-move: can't read {path}: {e}")
    if not isinstance(got, dict):
        raise SystemExit("gtme next-move: the input is a JSON object (a blocker, or a replay case holding one)")
    return got


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
