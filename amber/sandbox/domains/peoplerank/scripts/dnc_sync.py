#!/usr/bin/env python3
"""
dnc_sync.py — sync a medha-id contact graph into BigQuery togari_dnc + Clay enrichment.

Flow (see docs/DNC_AND_DATA_TAXONOMY.md):
  backfill   : medha-id /contacts/export -> contacts_raw_staging -> MERGE into contacts
  push-clay  : push sparse contacts (no company/title/email) to the Clay webhook
  merge-clay : MERGE Clay-enriched rows (contacts_clay_staging) into contacts

Taxonomy encoded in the MERGE SET lists:
  immutable  -> COALESCE(existing, incoming)   (fill-only, never overwrite)
  variable   -> COALESCE(incoming, existing)   (latest wins)
  DNC fields -> never in SET                    (sticky)

Env:
  MEDHA_ID_URL, MEDHA_ID_KEY, CLAY_WEBHOOK_URL
  BQ_PROJECT (default midyear-glazing-485303-u3), BQ_DATASET (default togari_dnc)
Uses the `bq` CLI for BigQuery (auth via the active gcloud service account).
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request

BQ_PROJECT = os.environ.get("BQ_PROJECT", "midyear-glazing-485303-u3")
BQ_DATASET = os.environ.get("BQ_DATASET", "togari_dnc")
MEDHA_ID_URL = os.environ.get("MEDHA_ID_URL", "https://medha-id-production.up.railway.app")
MEDHA_ID_KEY = os.environ.get("MEDHA_ID_KEY", "")
CLAY_WEBHOOK_URL = os.environ.get("CLAY_WEBHOOK_URL", "")
OWNER_EMAIL = os.environ.get("OWNER_EMAIL", "sagar@bluemodernadvisory.com")
ORG_ID = os.environ.get("ORG_ID", "bma")

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def http_json(url, key=None, method="GET", body=None, timeout=90):
    headers = {"content-type": "application/json"}
    if key:
        headers["x-api-key"] = key
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read().decode().strip()
        try:
            return r.status, (json.loads(raw) if raw else {})
        except json.JSONDecodeError:
            # Clay's webhook returns an empty/non-JSON body on 200; status is
            # the only signal that matters for a push.
            return r.status, {}


def first(*vals):
    for v in vals:
        if isinstance(v, list):
            for x in v:
                if isinstance(x, str) and x.strip():
                    return x.strip()
        elif isinstance(v, str) and v.strip():
            return v.strip()
    return None


def to_row(c, owner_did):
    """medha-id contact -> contacts_raw_staging row."""
    cid = c.get("id")
    if not cid:
        return None
    bday = c.get("birthday")
    dob = bday if isinstance(bday, str) and DATE_RE.match(bday) else None
    loc = first(c.get("location"))
    rs = c.get("relationshipScore")
    src = (first(c.get("source")) or "").lower()
    company = first(c.get("company"))
    notes = first(c.get("notes"))
    # Apple contacts misuse the company field for relationship notes
    # ("USC Neighbor"), not an employer. Fold it into notes; leave company empty
    # so nothing downstream treats it as a real company.
    if "apple" in src and company:
        notes = " | ".join(x for x in (company, notes) if x)
        company = None
    return {
        "contact_id": cid,
        "owner_did": owner_did,
        "owner_email": OWNER_EMAIL,
        "org_id": ORG_ID,
        "name": first(c.get("name")),
        "full_name": first(c.get("name")),
        "first_name": first(c.get("firstName")),
        "last_name": first(c.get("lastName")),
        "email": first(c.get("emailsNormalized"), c.get("emails"), c.get("email")),
        "phone": first(c.get("phoneNumbersNormalized"), c.get("phoneNumbers"), c.get("phone")),
        "company": company,
        "title": first(c.get("title")),
        "home_location": loc,
        "current_city": loc,
        "dob": dob,
        "notes": notes,
        "source_platform": first(c.get("source")) or "medha-id",
        "sources": first(c.get("source")) or "medha-id",
        "relationship_score": float(rs) if isinstance(rs, (int, float)) else None,
        "last_contacted_at": None,
    }


def bq(sql):
    subprocess.run(
        ["bq", "query", "--use_legacy_sql=false", "--project_id", BQ_PROJECT, sql],
        check=True,
    )


def bq_load(table, rows):
    with tempfile.NamedTemporaryFile("w", suffix=".ndjson", delete=False) as f:
        for r in rows:
            f.write(json.dumps({k: v for k, v in r.items() if v is not None}) + "\n")
        path = f.name
    subprocess.run(
        ["bq", "load", "--source_format=NEWLINE_DELIMITED_JSON", "--replace",
         f"{BQ_PROJECT}:{BQ_DATASET}.{table}", path],
        check=True,
    )
    os.unlink(path)


def fetch_contacts(owner_did):
    url = f"{MEDHA_ID_URL}/internal/users/{owner_did}/contacts/export"
    _, data = http_json(url, key=MEDHA_ID_KEY)
    return data.get("contacts", [])


MERGE_RAW = f"""
MERGE `{BQ_PROJECT}.{BQ_DATASET}.contacts` T
USING `{BQ_PROJECT}.{BQ_DATASET}.contacts_raw_staging` S
ON T.owner_did = S.owner_did AND T.contact_id = S.contact_id
WHEN MATCHED THEN UPDATE SET
  current_company = COALESCE(S.company, T.current_company),
  current_title   = COALESCE(S.title, T.current_title),
  current_city    = COALESCE(S.current_city, T.current_city),
  name      = COALESCE(T.name, S.name),
  full_name = COALESCE(T.full_name, S.full_name),
  first_name= COALESCE(T.first_name, S.first_name),
  last_name = COALESCE(T.last_name, S.last_name),
  email     = COALESCE(T.email, S.email),
  phone     = COALESCE(T.phone, S.phone),
  company   = COALESCE(T.company, S.company),
  title     = COALESCE(T.title, S.title),
  home_location = COALESCE(T.home_location, S.home_location),
  dob       = COALESCE(T.dob, S.dob),
  notes     = COALESCE(T.notes, S.notes),
  last_updated_at = CURRENT_TIMESTAMP(),
  last_synced_at  = CURRENT_TIMESTAMP(),
  sync_status     = 'synced'
WHEN NOT MATCHED THEN INSERT
  (id, contact_id, owner_did, owner_email, org_id, name, full_name, first_name,
   last_name, email, phone, company, current_company, title, current_title,
   home_location, current_city, dob, notes, source_platform, sources, is_dnc,
   first_seen_at, imported_at, last_updated_at, last_synced_at, sync_status)
VALUES
  (S.contact_id, S.contact_id, S.owner_did, S.owner_email, S.org_id, S.name,
   S.full_name, S.first_name, S.last_name, S.email, S.phone, S.company, S.company,
   S.title, S.title, S.home_location, S.current_city, S.dob, S.notes,
   S.source_platform, S.sources, FALSE, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP(),
   CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP(), 'synced')
"""

MERGE_CLAY = f"""
MERGE `{BQ_PROJECT}.{BQ_DATASET}.contacts` T
USING `{BQ_PROJECT}.{BQ_DATASET}.contacts_clay_staging` S
ON T.owner_did = S.owner_did AND T.contact_id = S.contact_id
WHEN MATCHED THEN UPDATE SET
  current_company = COALESCE(S.company, T.current_company),
  current_title   = COALESCE(S.title, T.current_title),
  current_city    = COALESCE(S.current_city, T.current_city),
  linkedin_url    = COALESCE(S.linkedin_url, T.linkedin_url),
  linkedin_username = COALESCE(S.linkedin_username, T.linkedin_username),
  email     = COALESCE(T.email, S.email),
  phone     = COALESCE(T.phone, S.phone),
  home_location = COALESCE(T.home_location, S.home_location),
  gender    = COALESCE(T.gender, S.gender),
  dob       = COALESCE(T.dob, S.dob),
  alma_mater= COALESCE(T.alma_mater, S.alma_mater),
  notes     = COALESCE(T.notes, S.notes),
  enriched_at = CURRENT_TIMESTAMP(),
  enrichment_source = 'clay',
  last_updated_at = CURRENT_TIMESTAMP()
"""


def cmd_backfill(owner_did):
    contacts = fetch_contacts(owner_did)
    rows = [r for r in (to_row(c, owner_did) for c in contacts) if r]
    print(f"fetched {len(contacts)} contacts, staging {len(rows)} rows")
    bq_load("contacts_raw_staging", rows)
    bq(MERGE_RAW)
    print("MERGE raw -> contacts done")


def cmd_push_clay(owner_did, limit=None, mode="all"):
    """Push contacts to the Clay webhook. mode='all' (default) pushes every
    contact with the fields we already have, so Clay's conditional enrichments
    ('only run if empty') skip what's already filled. mode='sparse' pushes only
    contacts missing company+title."""
    if not CLAY_WEBHOOK_URL:
        sys.exit("CLAY_WEBHOOK_URL not set")
    contacts = fetch_contacts(owner_did)
    rows = []
    for c in contacts:
        company = first(c.get("company"))
        title = first(c.get("title"))
        if mode == "sparse" and company and title:
            continue
        loc = first(c.get("location"))
        notes = first(c.get("notes"))
        src = (first(c.get("source")) or "").lower()
        if "apple" in src and company:
            notes = " | ".join(x for x in (company, notes) if x)
            company = None
        rows.append({
            "contact_id": c.get("id"),
            "owner_did": owner_did,
            "name": first(c.get("name")) or "",
            "first_name": first(c.get("firstName")) or "",
            "last_name": first(c.get("lastName")) or "",
            "email": first(c.get("emailsNormalized"), c.get("emails")) or "",
            "phone": first(c.get("phoneNumbersNormalized"), c.get("phoneNumbers")) or "",
            "company": company or "",
            "title": title or "",
            "home_location": loc or "",
            "notes": notes or "",
            "linkedin_url": "",
        })
    if limit:
        rows = rows[: int(limit)]
    print(f"pushing {len(rows)} contacts to Clay (mode={mode})")
    sent = 0
    for i, row in enumerate(rows, 1):
        try:
            st, _ = http_json(CLAY_WEBHOOK_URL, method="POST", body=row, timeout=20)
            if st == 200:
                sent += 1
        except Exception as e:  # noqa: BLE001
            print(f"  push failed for {row['contact_id']}: {e}")
        if i % 250 == 0:
            print(f"  ...{i}/{len(rows)} ({sent} ok)")
    print(f"pushed {sent}/{len(rows)}")


def cmd_merge_clay():
    bq(MERGE_CLAY)
    print("MERGE clay -> contacts done")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    did = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("OWNER_DID", "")
    if cmd == "backfill":
        cmd_backfill(did)
    elif cmd == "push-clay":
        cmd_push_clay(did, sys.argv[3] if len(sys.argv) > 3 else None)
    elif cmd == "merge-clay":
        cmd_merge_clay()
    else:
        sys.exit("usage: dnc_sync.py [backfill|push-clay|merge-clay] <owner_did> [limit]")
