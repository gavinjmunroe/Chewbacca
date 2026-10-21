"""
amber_kg.py — writes a two-layer personal knowledge graph into the existing
`amber-people` Pinecone index, using Amber's own conventions.

Conventions mirrored from amberintelligence/amber-id:
  - embeddings: pplx-embed-v1-4b, base64_int8 -> float/127, 2560 dims
  - namespace:  tenant-<did lowercased, ':' -> '-'>
  - id:         sha256(json({did,person,kind,text,createdAt}))[:32]
  - metadata:   {did, kind, source, created_at, ingested_at, text, trust,
                 visibility, instance_id, dimension, ...extra}

Two graph layers live side by side, distinguished by `kind`:
  kind="episode"  narrative memory chunk (what happened / what was said)
  kind="entity"   typed node (person, place, object, value, era, work)
  kind="edge"     typed relationship between two entity ids
"""

import hashlib
import json
import base64
import datetime
import os
import requests

# The agent proxy terminates TLS with its own CA for intercepted upstreams, but
# the CONNECT hop to the proxy itself uses a public CA. requests needs both, so
# verify against certifi + the two proxy CAs concatenated.
CA = "/home/user/workspace/ca-bundle.pem"
if not os.path.exists(CA):
    import certifi, shutil
    shutil.copy(certifi.where(), CA)
    with open(CA, "a") as out:
        p = os.environ.get("SSL_CERT_FILE", "/etc/ssl/certs/agent-proxy-ca-2.pem")
        if os.path.exists(p):
            out.write(open(p).read())

# Python 3.14 enables VERIFY_X509_STRICT, which rejects the proxy-minted leaf
# certs (no Authority Key Identifier). Relax just that flag.
import ssl
from requests.adapters import HTTPAdapter

_CTX = ssl.create_default_context(cafile=CA)
_CTX.verify_flags &= ~ssl.VERIFY_X509_STRICT


class _ProxyAdapter(HTTPAdapter):
    def init_poolmanager(self, *a, **kw):
        kw["ssl_context"] = _CTX
        return super().init_poolmanager(*a, **kw)

    def proxy_manager_for(self, *a, **kw):
        kw["ssl_context"] = _CTX
        return super().proxy_manager_for(*a, **kw)


SESSION = requests.Session()
SESSION.mount("https://", _ProxyAdapter())

PPLX_URL = "https://api.perplexity.ai/v1/embeddings"
MODEL = "pplx-embed-v1-4b"
DIMS = 2560
MAX_BATCH = 96

DID = "did:privy:cmo0ay9oy001u0cl7h1wb7thy"
NAMESPACE = "tenant-" + DID.lower().replace(":", "-")
PINECONE_HOST = "https://amber-people-ttzdjqw.svc.aped-4627-b74a.pinecone.io"
INSTANCE_ID = "default"
CLIENT_ID = "computer-kg"


def _post(url, body, headers):
    r = SESSION.post(
        url, json=body, timeout=180,
        headers={"content-type": "application/json", **headers},
    )
    if r.status_code >= 300:
        raise RuntimeError(f"{url} -> {r.status_code}: {r.text[:400]}")
    return r.json()


def _decode(b64):
    raw = base64.b64decode(b64)
    ints = [b - 256 if b > 127 else b for b in raw]
    out = [0.0] * DIMS
    for i in range(DIMS):
        out[i] = (ints[i] / 127) if i < len(ints) else 0.0
    return out


def embed_many(texts):
    """Embed a list of strings -> list of 2560-dim float vectors."""
    norm = [t if isinstance(t, str) and t.strip() else " " for t in texts]
    results = [None] * len(norm)
    for i in range(0, len(norm), MAX_BATCH):
        chunk = norm[i:i + MAX_BATCH]
        resp = _post(
            PPLX_URL,
            {"model": MODEL, "input": chunk, "encoding_format": "base64_int8"},
            {"authorization": "Bearer x"},  # injected by the credential proxy
        )
        for item in resp.get("data", []):
            results[i + item.get("index", 0)] = _decode(item["embedding"])
    return results


def derive_id(item):
    """Byte-identical to amber-id's deriveId()."""
    if item.get("id"):
        return str(item["id"])
    base = json.dumps(
        {
            "did": DID,
            "person": item.get("personId") or None,
            "kind": item.get("kind") or None,
            "text": item.get("text") or "",
            "createdAt": item.get("createdAt") or None,
        },
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return hashlib.sha256(base.encode()).hexdigest()[:32]


def _now():
    return datetime.datetime.now(datetime.timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%S.") + f"{datetime.datetime.now(datetime.timezone.utc).microsecond // 1000:03d}Z"


def build_records(items):
    vectors = embed_many([it["text"] for it in items])
    now = _now()
    records = []
    for it, vec in zip(items, vectors):
        meta = {
            "did": DID,
            "instance_id": INSTANCE_ID,
            "client_id": CLIENT_ID,
            "source": it.get("source", "knowledge-graph"),
            "kind": it.get("kind", "episode"),
            "visibility": it.get("visibility", "private"),
            "trust": it.get("trust", 0.9),
            "text": it["text"][:4000],
            "created_at": it.get("createdAt") or now,
            "ingested_at": now,
            "dimension": DIMS,
        }
        for k in ("personId", "personName", "healthDimension"):
            if it.get(k):
                meta[{"personId": "person_id", "personName": "person_name",
                      "healthDimension": "health_dimension"}[k]] = it[k]
        for k, v in (it.get("extra") or {}).items():
            if v is None:
                continue
            meta[k] = json.dumps(v) if isinstance(v, dict) else v
        records.append({"id": derive_id(it), "values": vec, "metadata": meta})
    return records


def upsert(items):
    records = build_records(items)
    total = 0
    for i in range(0, len(records), 100):
        resp = _post(
            PINECONE_HOST + "/vectors/upsert",
            {"vectors": records[i:i + 100], "namespace": NAMESPACE},
            {"Api-Key": "x", "X-Pinecone-API-Version": "2025-04"},
        )
        total += resp.get("upsertedCount", 0)
    return {"upserted": total, "namespace": NAMESPACE,
            "ids": [r["id"] for r in records]}


def query(text, top_k=10, flt=None):
    vec = embed_many([text])[0]
    body = {"vector": vec, "topK": top_k, "namespace": NAMESPACE,
            "includeMetadata": True}
    if flt:
        body["filter"] = flt
    return _post(
        PINECONE_HOST + "/query", body,
        {"Api-Key": "x", "X-Pinecone-API-Version": "2025-04"},
    )
