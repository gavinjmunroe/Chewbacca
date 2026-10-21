"""Pre-deletion verification: coverage of old namespaces + retrieval sanity."""
import json
import random
import time
import amber_kg as k


def post(path, body):
    """Rate-limit tolerant POST."""
    for a in range(8):
        try:
            return k._post(path, body, HDR)
        except Exception as e:
            if "429" not in str(e) and a > 3:
                raise
            time.sleep(min(30, 2 * 2 ** a) + random.uniform(0, 2))
    raise RuntimeError("exhausted retries")

H, HDR = k.PINECONE_HOST, {"Api-Key": "x", "X-Pinecone-API-Version": "2025-04"}
inv = json.load(open("/home/user/workspace/inventory.json"))
random.seed(7)
probe = [random.uniform(-1, 1) for _ in range(2560)]

# ---- 1. every contact person must now exist as a canonical person node
names = set()
for label in ("apple", "apple_vcf", "google"):
    for r in inv[label]:
        n = (r.get("person_name") or "").strip()
        if n:
            names.add(n)
sample = random.sample(sorted(names), 40)
missing = []
for n in sample:
    r = post(H + "/query", {
        "vector": probe, "topK": 1, "namespace": k.NAMESPACE,
        "includeMetadata": True, "includeValues": False,
        "filter": {"kind": {"$eq": "person"}, "canonical_name": {"$eq": n}},
    })
    if not r.get("matches"):
        missing.append(n)
    time.sleep(0.4)
print(f"contact-name coverage: {len(sample) - len(missing)}/{len(sample)} found")
if missing:
    print("  MISSING:", missing[:10])

# ---- 2. every migrated cnft record must be present by id
cnft_ids = [r["id"] for r in inv["cnft"]]
sample_ids = random.sample(cnft_ids, 80)
found = 0
for i in range(0, len(sample_ids), 40):
    d = k.SESSION.get(H + "/vectors/fetch",
                      params=[("namespace", k.NAMESPACE)]
                      + [("ids", x) for x in sample_ids[i:i + 40]],
                      headers=HDR, timeout=120).json()
    found += len(d.get("vectors", {}))
print(f"cnft id coverage: {found}/{len(sample_ids)} present in canonical namespace")

# ---- 3. kind distribution in the canonical namespace
counts = {}
for kind in ("person", "entity", "edge", "outreach_draft", "episode",
             "conversation", "auto_fact", "message", "inferred_signal",
             "auto_preference", "context", "observation"):
    r = post(H + "/query", {
        "vector": probe, "topK": 1, "namespace": k.NAMESPACE,
        "includeMetadata": False, "includeValues": False,
        "filter": {"kind": {"$eq": kind}},
    })
    counts[kind] = "present" if r.get("matches") else "ABSENT"
    time.sleep(0.4)
print("kinds:", json.dumps(counts))

# ---- 4. retrieval sanity
tests = [
    ("health tech investor who could fund Amber", {"kind": {"$eq": "person"}}),
    ("who did I meet at Bombay Beach", None),
    ("people from McKinsey in my network", {"kind": {"$eq": "person"}}),
    ("my father Umesh and what he believed", None),
    ("who went to the Paint PE Rytual health party", {"kind": {"$eq": "edge"}}),
]
for q, flt in tests:
    time.sleep(1)
    r = k.query(q, top_k=4, flt=flt)
    print(f"\nQ: {q}")
    for m in r["matches"]:
        md = m["metadata"]
        label = md.get("canonical_name") or md.get("kind")
        print(f"   {m['score']:.3f} [{md.get('kind')}] {label}: "
              f"{(md.get('text') or '')[:95].replace(chr(10), ' ')}")
