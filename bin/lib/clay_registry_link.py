"""Link a crawled request to the `chewbacca clay` op that makes the same call.

library/clay-api/clay.json names each api-anything operation with its method
and URL; registry.json says which kit op uses which operation. A crawled
request matches when the method is equal and the path has the same segments,
with every id, number or placeholder segment treated as one wildcard.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

WILD = re.compile(r"^(\{[a-z_]+\}|\d+|[a-z]{1,8}_[A-Za-z0-9]+|[0-9a-f]{8}-[0-9a-f-]{27,})$")


def shape(method: str, path: str) -> tuple:
    path = re.sub(r"^https://api\.clay\.com", "", str(path)).split("?")[0].rstrip("/")
    segs = tuple("*" if WILD.match(s) else s for s in path.split("/"))
    return str(method).upper(), segs


def index(root: Path) -> dict[tuple, list[str]]:
    api = root / "library/clay-api"
    try:
        spec = json.loads((api / "clay.json").read_text())
        reg = json.loads((api / "registry.json").read_text())
    except (OSError, ValueError):
        return {}
    by_api_op: dict[str, list[str]] = {}
    for op in reg.get("ops", []):
        for surf in op.get("surfaces", []):
            if surf.get("type") == "api-anything":
                by_api_op.setdefault(surf.get("op"), []).append(op["name"])
    out: dict[tuple, list[str]] = {}
    for o in spec.get("operations", []):
        req = o.get("request", {})
        names = by_api_op.get(o.get("name"), [])
        if names:
            out.setdefault(shape(req.get("method", ""), req.get("url", "")), [])
            out[shape(req.get("method", ""), req.get("url", ""))] += [n for n in names
                                                                     if n not in out[shape(req.get("method", ""), req.get("url", ""))]]
    return out


def annotate(m: dict, endpoints: dict, idx: dict) -> int:
    """Add `op` to every stored request and `registry_ops` to every endpoint
    that matches. Returns how many endpoints matched."""
    def ops_for(r):
        return idx.get(shape(r.get("method", ""), r.get("path", "")), [])
    for st in m["states"].values():
        for r in st.get("load_requests", []):
            if ops_for(r):
                r["op"] = ops_for(r)
        for e in st["elements"]:
            for r in e.get("requests", []):
                if ops_for(r):
                    r["op"] = ops_for(r)
    hit = 0
    for ep in endpoints.values():
        ops = ops_for(ep)
        if ops:
            ep["registry_ops"] = ops
            hit += 1
    return hit
