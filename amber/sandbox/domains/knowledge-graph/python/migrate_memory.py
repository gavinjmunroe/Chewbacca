"""
Migrate the 1,930 cnft memory records into the canonical namespace.

Vectors are copied as-is — no re-embedding, so semantics are preserved exactly.
While copying we: normalise `user_cnft` to the `did` field the DID-keyed client
expects, link records to canonical person nodes via phone, attribute Caleb's
ingested GitHub context to him, and drop test residue.
"""
import json
import re
import sys
import time
import amber_kg as k

SRC_NS = "cnft:did:privy:cmo0ay9oy001u0cl7h1wb7thy"
DST_NS = k.NAMESPACE
H, HDR = k.PINECONE_HOST, {"Api-Key": "x", "X-Pinecone-API-Version": "2025-04"}
DROP_KINDS = {"test", "smoke_test"}

# phone -> person_entity_id, from the records we just built
phone_map, name_map = {}, {}
for line in open("/home/user/workspace/records.jsonl"):
    r = json.loads(line)
    if r["kind"] != "person":
        continue
    pid = r["extra"]["person_entity_id"]
    name_map[r["personName"].lower()] = pid
    for p in r["extra"].get("phones") or []:
        phone_map[re.sub(r"\D", "", p)[-10:]] = pid

CALEB = name_map.get("caleb newton", "person:caleb-newton")


def get(path, params):
    for a in range(6):
        try:
            r = k.SESSION.get(H + path, params=params, headers=HDR, timeout=120)
            if r.status_code < 300:
                return r.json()
            raise RuntimeError(f"{r.status_code}: {r.text[:200]}")
        except Exception as e:
            print("  get retry", a + 1, str(e)[:120], flush=True)
            time.sleep(min(60, 3 * 2 ** a))
    sys.exit("get failed")


# ---- collect all ids
ids, tok = [], None
while True:
    p = {"namespace": SRC_NS, "limit": 100}
    if tok:
        p["paginationToken"] = tok
    d = get("/vectors/list", p)
    ids += [v["id"] for v in d.get("vectors", [])]
    tok = (d.get("pagination") or {}).get("next")
    if not tok:
        break
print("source ids:", len(ids), flush=True)

stats = {"copied": 0, "dropped": 0, "linked_person": 0, "caleb": 0}
for i in range(0, len(ids), 100):
    batch = ids[i:i + 100]
    d = get("/vectors/fetch",
            [("namespace", SRC_NS)] + [("ids", x) for x in batch])
    out = []
    for vid, v in d.get("vectors", {}).items():
        m = dict(v.get("metadata") or {})
        if m.get("kind") in DROP_KINDS:
            stats["dropped"] += 1
            continue
        src = m.get("source") or ""
        m["did"] = "did:privy:cmo0ay9oy001u0cl7h1wb7thy"
        m.pop("user_cnft", None)
        m["migrated_from"] = "cnft-namespace"
        m["dimension"] = k.DIMS
        if "caleb-context" in src:
            m["person_entity_id"] = CALEB
            m["origin_owner"] = "caleb-newton"
            m["visibility"] = "private"
            m["shareable"] = False
            stats["caleb"] += 1
        pid = m.get("person_id")
        if pid:
            digits = re.sub(r"\D", "", str(pid))[-10:]
            if digits in phone_map:
                m["person_entity_id"] = phone_map[digits]
                stats["linked_person"] += 1
        out.append({"id": vid, "values": v["values"], "metadata": m})

    for a in range(9):
        try:
            k._post(H + "/vectors/upsert",
                    {"vectors": out, "namespace": DST_NS}, HDR)
            break
        except Exception as e:
            print("  upsert retry", a + 1, str(e)[:120], flush=True)
            time.sleep(min(60, 3 * 2 ** a))
    else:
        sys.exit("upsert failed at " + str(i))
    stats["copied"] += len(out)
    print(f"  {stats['copied']}/{len(ids)}", flush=True)
    time.sleep(1.5)

print(json.dumps(stats, indent=2), flush=True)
