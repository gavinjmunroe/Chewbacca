"""
build_people.py — people-first record builder.

Merges the CSV relationship export with the 2,252 unique humans recovered from
the three Pinecone contact namespaces, resolves identity, and emits every record
to records.jsonl for the resumable uploader.
"""
import csv
import json
import re
import collections

CSV = ("/home/user/workspace/uploaded_attachments/"
       "5180401cd14f4f29a92e9ab792da2954/"
       "Sagar-s-People-Default-view-export-1787728355798.csv")
INVENTORY = "/home/user/workspace/inventory.json"
OUT = "/home/user/workspace/records.jsonl"

HEALTH_COLS = [
    ("Spiritual Health", "spiritual"), ("Emotional Health", "emotional"),
    ("Physical Health", "physical"), ("Social Health", "social"),
    ("Intellectual Health", "intellectual"), ("Financial Health", "financial"),
]


def slug(s, maxlen=60):
    s = re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")
    return s[:maxlen] or "unknown"


def norm_phone(p):
    d = re.sub(r"\D", "", p or "")
    if len(d) == 11 and d.startswith("1"):
        d = d[1:]
    return d if len(d) == 10 else None


def e164(d):
    return "+1" + d if d else None


def clean(v, cap=None):
    v = re.sub(r"\s+", " ", (v or "").strip())
    if v in ("❌ No Profile Found", "-", "n/a", "N/A"):
        return ""
    return v[:cap] if cap else v


def parse_contact(text):
    res = {"phones": [], "emails": [], "notes": None, "company": None}
    m = re.match(r"Contact:\s*(.*?)\.\s*Source:", text or "")
    res["name"] = m.group(1).strip() if m else None
    for field, key in (("Phones", "phones"), ("Emails", "emails")):
        mm = re.search(rf"{field}:\s*(.*?)(?:\.\s+[A-Z][a-z]+:|\.?$)", text or "")
        if mm:
            res[key] = [x.strip() for x in mm.group(1).split(",") if x.strip()]
    nn = re.search(r"Notes:\s*(.*)$", text or "")
    if nn:
        res["notes"] = nn.group(1).strip().rstrip(".")
    cc = re.search(r"Company:\s*(.*?)(?:\.\s+[A-Z][a-z]+:|\.?$)", text or "")
    if cc:
        res["company"] = cc.group(1).strip()
    return res


# ---------------------------------------------------------------- load sources
rows = list(csv.DictReader(open(CSV, newline="", encoding="utf-8-sig")))
inv = json.load(open(INVENTORY))

contacts = {}
for label in ("apple", "apple_vcf", "google"):
    for r in inv[label]:
        c = parse_contact(r.get("text", ""))
        name = clean(r.get("person_name") or c.get("name") or "")
        if not name:
            continue
        e = contacts.setdefault(name.lower(), {
            "name": name, "sources": set(), "phones": set(), "emails": set(),
            "notes": set(), "company": set()})
        e["sources"].add(label)
        for p in c["phones"]:
            n = norm_phone(p)
            if n:
                e["phones"].add(n)
        for m in c["emails"]:
            e["emails"].add(m.lower())
        if c["notes"]:
            e["notes"].add(c["notes"])
        if c["company"]:
            e["company"].add(c["company"])

# ------------------------------------------------------- resolve unique humans
people = {}          # person_id -> merged dict
phone_index = {}     # 10-digit -> person_id
name_index = {}      # lower name -> person_id
used_ids = set()


def new_id(name):
    base = "person:" + slug(name)
    pid, n = base, 2
    while pid in used_ids:
        pid, n = f"{base}-{n}", n + 1
    used_ids.add(pid)
    return pid


for r in rows:
    name = clean(r.get("full name"))
    if not name:
        continue
    ph = norm_phone(r.get("phone"))
    pid = new_id(name)
    rec = {
        "person_id": pid, "name": name, "phones": set(), "emails": set(),
        "notes": set(), "circles": set(), "events": set(),
        "contact_sources": set(), "csv": r,
    }
    if ph:
        rec["phones"].add(ph)
        phone_index[ph] = pid
    for col in ("final email", "email", "email search"):
        v = clean(r.get(col)).lower()
        if v and "@" in v:
            rec["emails"].add(v)
    note = clean(r.get("notes"))
    if note:
        rec["notes"].add(note)
        for t in re.split(r"\s+[xX]\s+", note):
            t = t.strip().rstrip(".")
            if 1 < len(t) <= 40:
                rec["circles"].add(t)
    for e in re.split(r"[,;|]", clean(r.get("partiful events attended"))):
        e = e.strip()
        if e:
            rec["events"].add(e)
    people[pid] = rec
    name_index[name.lower()] = pid

# fold contact records into matching people, or create contact-only people
merged_contacts = 0
for key, c in contacts.items():
    pid = None
    for p in c["phones"]:
        if p in phone_index:
            pid = phone_index[p]
            break
    if not pid:
        pid = name_index.get(key)
    if not pid:
        pid = new_id(c["name"])
        people[pid] = {"person_id": pid, "name": c["name"], "phones": set(),
                       "emails": set(), "notes": set(), "circles": set(),
                       "events": set(), "contact_sources": set(), "csv": None}
        name_index[key] = pid
    else:
        merged_contacts += 1
    rec = people[pid]
    rec["phones"] |= c["phones"]
    rec["emails"] |= c["emails"]
    rec["contact_sources"] |= c["sources"]
    for n in c["notes"]:
        rec["notes"].add(n)
        for t in re.split(r"\s+[xX]\s+", n):
            t = t.strip().rstrip(".")
            if 1 < len(t) <= 40:
                rec["circles"].add(t)
    for p in c["phones"]:
        phone_index.setdefault(p, pid)

# ------------------------------------------------------------- hub aggregation
event_counts = collections.Counter()
org_counts = collections.Counter()
school_counts = collections.Counter()
circle_counts = collections.Counter()
for rec in people.values():
    for e in rec["events"]:
        event_counts[e] += 1
    for c in rec["circles"]:
        circle_counts[c] += 1
    if rec["csv"]:
        o = clean(rec["csv"].get("Org"))
        s = clean(rec["csv"].get("School Name Education"))
        if o:
            org_counts[o] += 1
        if s:
            school_counts[s] += 1

ORG_MIN = SCHOOL_MIN = CIRCLE_MIN = 5
hub_orgs = {o for o, n in org_counts.items() if n >= ORG_MIN}
hub_schools = {s for s, n in school_counts.items() if n >= SCHOOL_MIN}
hub_circles = {c for c, n in circle_counts.items() if n >= CIRCLE_MIN}

# ------------------------------------------------------------------- emit
records = []
SAGAR = "person:sagar-tiwari"


def person_text(rec):
    r, parts = rec["csv"], []
    head = rec["name"]
    if r:
        title, org = clean(r.get("Title"), 200), clean(r.get("Org"), 120)
        if title and org:
            head += f" — {title} at {org}"
        elif title:
            head += f" — {title}"
        elif org:
            head += f" — {org}"
    parts.append(head + ".")

    if r:
        sch, fos = clean(r.get("School Name Education"), 150), clean(
            r.get("Field Of Study Education"), 200)
        if sch:
            parts.append(f"Education: {sch}" + (f", {fos}" if fos else "") + ".")

    ident = []
    for p in sorted(rec["phones"]):
        ident.append(e164(p))
    ident += sorted(rec["emails"])[:2]
    if r:
        for col, lbl in (("final linkedin url", "LinkedIn"),
                         ("final instagram url", "Instagram")):
            v = clean(r.get(col))
            if v:
                ident.append(f"{lbl}: {v}")
    if ident:
        parts.append("Contact: " + ", ".join(x for x in ident if x) + ".")

    if rec["circles"]:
        parts.append("Circles: " + ", ".join(sorted(rec["circles"])[:12]) + ".")
    if rec["events"]:
        parts.append("Events attended with Sagar: "
                     + ", ".join(sorted(rec["events"])[:10]) + ".")
    if rec["contact_sources"]:
        parts.append("Present in Sagar's "
                     + "/".join(sorted(rec["contact_sources"])) + " contacts.")

    if r:
        tier, rat = clean(r.get("Investor Tier")), clean(
            r.get("Investor Tier Rationale"), 500)
        if tier:
            parts.append(f"Investor tier {tier}." + (f" {rat}" if rat else ""))
        s2, s2r = clean(r.get("stage_2_score")), clean(r.get("stage_2_rationale"), 600)
        if s2:
            parts.append(f"Relationship score {s2}/100." + (f" {s2r}" if s2r else ""))
        for col, dim in HEALTH_COLS:
            v = clean(r.get(col), 400)
            if v and not v.lower().startswith("no public evidence"):
                parts.append(f"{dim.capitalize()} health: {v}")
    return "\n".join(parts)


def num(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


for rec in people.values():
    r = rec["csv"]
    meta = {
        "graph_layer": "entity", "node_type": "person",
        "person_entity_id": rec["person_id"],
        "canonical_name": rec["name"],
        "phones": [e164(p) for p in sorted(rec["phones"])] or None,
        "emails": sorted(rec["emails"])[:3] or None,
        "circles": sorted(rec["circles"])[:20] or None,
        "events": sorted(rec["events"])[:20] or None,
        "contact_sources": sorted(rec["contact_sources"]) or None,
        "in_csv": bool(r),
    }
    if r:
        meta.update({
            "title": clean(r.get("Title"), 200) or None,
            "org": clean(r.get("Org"), 150) or None,
            "school": clean(r.get("School Name Education"), 150) or None,
            "field_of_study": clean(r.get("Field Of Study Education"), 150) or None,
            "linkedin": clean(r.get("final linkedin url")) or None,
            "instagram": clean(r.get("final instagram url")) or None,
            "investor_tier": clean(r.get("Investor Tier")) or None,
            "stage_1_score": num(r.get("stage_1_score")),
            "stage_2_score": num(r.get("stage_2_score")),
        })
    records.append({
        "kind": "person", "text": person_text(rec), "source": "people-export",
        "healthDimension": "social", "trust": 0.9,
        "personId": e164(sorted(rec["phones"])[0]) if rec["phones"] else rec["person_id"],
        "personName": rec["name"],
        "extra": {k: v for k, v in meta.items() if v is not None},
    })


def hub(eid, name, node_type, text, count, dim="social"):
    records.append({
        "kind": "entity", "text": text, "source": "people-export",
        "healthDimension": dim, "trust": 0.9,
        "extra": {"graph_layer": "entity", "entity_id": eid,
                  "node_type": node_type, "canonical_name": name,
                  "member_count": count},
    })


def edge(subj, pred, obj, text, dim="social", conf=0.9):
    records.append({
        "kind": "edge", "text": text, "source": "people-export",
        "healthDimension": dim, "trust": conf,
        "extra": {"graph_layer": "edge", "subject": subj, "predicate": pred,
                  "object": obj, "confidence": conf},
    })


for e, n in event_counts.items():
    hub(f"event:{slug(e)}", e, "event",
        f"Event: {e}. A Partiful event in Sagar's world, attended by {n} people "
        f"in his network.", n, dim="social")
for o in hub_orgs:
    hub(f"org:{slug(o)}", o, "org",
        f"Organization: {o}. {org_counts[o]} people in Sagar's network work "
        f"there.", org_counts[o], dim="occupational")
for s in hub_schools:
    hub(f"school:{slug(s)}", s, "school",
        f"School: {s}. {school_counts[s]} people in Sagar's network studied "
        f"there.", school_counts[s], dim="intellectual")
for c in hub_circles:
    hub(f"circle:{slug(c)}", c, "circle",
        f"Circle: {c}. A tag Sagar uses in his own contact notes to group "
        f"people; {circle_counts[c]} people carry it.", circle_counts[c])

for rec in people.values():
    pid, nm = rec["person_id"], rec["name"]
    for e in rec["events"]:
        edge(pid, "attended", f"event:{slug(e)}", f"{nm} attended {e}.")
    for c in rec["circles"]:
        if c in hub_circles:
            edge(pid, "in_circle", f"circle:{slug(c)}",
                 f"{nm} belongs to Sagar's '{c}' circle.")
    if rec["csv"]:
        o = clean(rec["csv"].get("Org"))
        s = clean(rec["csv"].get("School Name Education"))
        if o in hub_orgs:
            edge(pid, "works_at", f"org:{slug(o)}", f"{nm} works at {o}.",
                 dim="occupational")
        if s in hub_schools:
            edge(pid, "studied_at", f"school:{slug(s)}", f"{nm} studied at {s}.",
                 dim="intellectual")
    # No generic Sagar->knows edge: membership in this namespace already means
    # "in Sagar's network", and 7,228 near-identical edge texts would flood
    # semantic search with duplicate vectors.

for rec in people.values():
    r = rec["csv"]
    if not r:
        continue
    msg = clean(r.get("Outreach Message"))
    if not msg:
        continue
    records.append({
        "kind": "outreach_draft", "text": f"Outreach draft to {rec['name']}: {msg}",
        "source": "people-export", "healthDimension": "social", "trust": 0.8,
        "personName": rec["name"],
        "personId": e164(sorted(rec["phones"])[0]) if rec["phones"] else rec["person_id"],
        "extra": {"graph_layer": "artifact", "artifact_type": "outreach_draft",
                  "person_entity_id": rec["person_id"], "status": "draft"},
    })

with open(OUT, "w") as f:
    for r in records:
        f.write(json.dumps(r, ensure_ascii=False) + "\n")

print(json.dumps({
    "unique_humans": len(people),
    "csv_rows": len(rows),
    "contact_names_merged_into_csv_people": merged_contacts,
    "contact_only_people": sum(1 for p in people.values() if not p["csv"]),
    "hubs": {"events": len(event_counts), "orgs": len(hub_orgs),
             "schools": len(hub_schools), "circles": len(hub_circles)},
    "records_by_kind": dict(collections.Counter(r["kind"] for r in records)),
    "total_records": len(records),
    "avg_person_text_chars": int(sum(
        len(r["text"]) for r in records if r["kind"] == "person") / len(people)),
}, indent=2))
