"""
1. Flag suspect person nodes (export artifacts) so they can be filtered out.
2. Create the share namespace and seed it with its governing policy record.
3. Publish the outreach drafts into it by copying vectors (no re-embedding).
"""
import json
import time
import amber_kg as k

H = k.PINECONE_HOST
HDR = {"Api-Key": "x", "X-Pinecone-API-Version": "2025-04"}
SHARE_NS = "share-did-privy-cmo0ay9oy001u0cl7h1wb7thy"
BRANDS = {"amber", "partiful", "meet", "say", "clay"}


def retry(fn, *a):
    for i in range(8):
        try:
            return fn(*a)
        except Exception as e:
            print("   retry:", str(e)[:110], flush=True)
            time.sleep(min(45, 3 * 2 ** i))
    raise RuntimeError("exhausted")


records = [json.loads(l) for l in open("/home/user/workspace/records.jsonl")]

# ---------- 1. flag suspect person nodes ----------
IDENT = ("phones", "emails", "linkedin", "instagram", "org", "title",
         "school", "circles", "events")
suspect = []
for r in records:
    if r["kind"] != "person":
        continue
    nm = r["personName"].strip().lower()
    no_signal = not any(r["extra"].get(f) for f in IDENT)
    if nm in BRANDS or no_signal:
        suspect.append((k.derive_id(r), r["personName"],
                        "brand_or_app_artifact" if nm in BRANDS
                        else "no_identity_signal"))

for vid, nm, reason in suspect:
    retry(k._post, H + "/vectors/update", {
        "id": vid, "namespace": k.NAMESPACE,
        "setMetadata": {"data_quality": "suspect", "suspect_reason": reason,
                        "shareable": False},
    }, HDR)
    time.sleep(0.25)
print(f"flagged {len(suspect)} suspect person nodes", flush=True)

# ---------- 2. seed the share namespace ----------
policy = {
    "person": "person:sagar-tiwari",
    "kind": "policy",
    "text": (
        "Share layer policy. This namespace holds only content Sagar has "
        "explicitly cleared to share with other people or to expose to "
        "outward-facing agents. Nothing lands here automatically. The private "
        "namespace tenant-did-privy-cmo0ay9oy001u0cl7h1wb7thy is the source of "
        "truth and holds everything: people, relationships, memories, health "
        "assessments, scores and rationales. Promotion is one-directional: a "
        "record is copied from private to share only after review, and its "
        "vector is reused so the semantics are identical. Never promote a "
        "record about a third party's private life, a relationship score or "
        "its rationale, a health assessment, a phone number, or an email "
        "address. Records owned by someone else, such as material ingested "
        "from Caleb Newton's context repo, are never shareable."
    ),
    "extra": {"graph_layer": "governance", "shareable": True,
              "visibility": "shared"},
}
recs = k.build_records([policy])
for r in recs:
    r["metadata"]["visibility"] = "shared"
retry(k._post, H + "/vectors/upsert",
      {"vectors": [{"id": r["id"], "values": r["values"],
                    "metadata": r["metadata"]} for r in recs],
       "namespace": SHARE_NS}, HDR)
print("share namespace seeded with policy record", flush=True)

# ---------- 3. publish outreach drafts by copying vectors ----------
draft_ids = [k.derive_id(r) for r in records
             if r["kind"] == "outreach_draft"]
published = 0
for i in range(0, len(draft_ids), 100):
    batch = draft_ids[i:i + 100]
    d = retry(lambda: k.SESSION.get(
        H + "/vectors/fetch",
        params=[("namespace", k.NAMESPACE)] + [("ids", x) for x in batch],
        headers=HDR, timeout=120).json())
    out = []
    for vid, v in d.get("vectors", {}).items():
        m = dict(v.get("metadata") or {})
        m.update({"visibility": "shared", "shareable": True,
                  "promoted_from": "private-namespace"})
        for f in ("phones", "emails", "phone", "email", "stage_2_score",
                  "stage_1_score", "relationship_score", "investor_tier"):
            m.pop(f, None)
        out.append({"id": vid, "values": v["values"], "metadata": m})
    retry(k._post, H + "/vectors/upsert",
          {"vectors": out, "namespace": SHARE_NS}, HDR)
    published += len(out)
    print(f"  published {published}/{len(draft_ids)}", flush=True)
    time.sleep(1.2)

time.sleep(8)
s = retry(k._post, H + "/describe_index_stats", {}, HDR)
print()
for ns, v in sorted(s["namespaces"].items(), key=lambda x: -x[1]["vectorCount"]):
    print(f"{v['vectorCount']:>7}  {ns}")
print("total:", s["totalVectorCount"])
print("suspect sample:", [(n, r) for _, n, r in suspect[:8]])
