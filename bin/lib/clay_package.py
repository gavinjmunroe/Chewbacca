"""Build library/learning/clay-navigation/package.json from three sources.

1. The hand-written edges of the earlier revisions (the AI-column procedure,
   Find People, the 10-06 campaign flow), kept with their ids so old receipts
   still match. Every one that saves, runs, creates, sends or starts is now a
   forbidden gate: the planner never routes through it.
2. routes.json: the curated screens, each one router hop from `any-page`, and
   their click steps.
3. elements.json: every crawled state and every element edge. Explored and
   link edges are observed; gates point at the `gate-held` sink, forbidden.

Costs are seconds. Measured edges carry their measured time; hand-written
edges keep 1.0, which was never measured.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

# Legacy edges that write, spend, send or start something.
LEGACY_GATES = {
    "save-without-run", "test-research-five", "configure-native-copy", "test-copy-five", "choose-csv", "complete-import",
    "use-sculptor", "send-campaign", "open-people-search", "chat-icp", "choose-table", "add-work-email", "open-launch",
    "confirm-launch", "unstick-enrollment", "insert-row-token", "research-argon", "disable-auto-run",
}
# A router hop priced before any measurement: the median page settle across
# 32 pages on 2026-10-09 was ~0.7 s. Replaced by hop_ms where the crawl has one.
DEFAULT_HOP_S = 0.7


def _eid(*parts: str) -> str:
    # Letters only, so a digit run in the package always means a leak.
    return "e-" + hashlib.sha1("|".join(parts).encode()).hexdigest()[:10].translate(str.maketrans("0123456789", "ghijklmnop"))


def _clean(text: str, limit: int = 160) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    return text[:limit] or "(no label)"


def build(pkg_dir: Path, legacy: dict) -> dict:
    routes = json.loads((pkg_dir / "routes.json").read_text())
    elements_path = pkg_dir / "elements.json"
    crawl = json.loads(elements_path.read_text()) if elements_path.exists() else {"states": {}, "hop_ms": {}}
    if crawl["states"]:
        import clay_sanitize  # the same gate the crawl writes through
        crawl = clay_sanitize.Sanitizer().map(crawl)
    hop_ms = crawl.get("hop_ms", {})

    states: dict[str, str] = {}
    edges: list[dict] = []

    def state(sid: str, label: str) -> None:
        states.setdefault(sid, _clean(label))

    for s in legacy["states"]:
        state(s["id"], s["label"])
    for e in legacy["edges"]:
        e = dict(e)
        if e["id"] in LEGACY_GATES and not e["forbidden"]:
            e["forbidden"] = True
            e["action"] = "GATE, recorded, never pressed by an agent: " + e["action"]
        e["cost"] = float(e["cost"])
        edges.append(e)

    state("any-page", "Any signed-in Clay workspace page (one router hop from every curated screen)")
    state("gate-held", "Gate: a control that saves, runs, sends, spends, creates or deletes; recorded, never pressed")

    # Curated screens.
    curated_base = {}
    for sid, st in routes["states"].items():
        where = st.get("url") or f"after {st['parent']}"
        state(sid, f"{sid}: {where}; arrive on {json.dumps(st['arrive'][0])}")
        edges.append({"id": _eid("leave", sid), "from": sid, "to": "any-page", "action": "Already on a Clay page",
                      "postcondition": "Sidebar visible", "status": "observed", "cost": 0.0, "forbidden": False})
        if "url" in st:
            base = st["url"].split("?")[0] if "?tab=" not in st["url"] else st["url"]
            curated_base[re.sub(r"\{[a-z_]+\}", "{}", base)] = sid
            cost = (hop_ms.get(st["url"]) or DEFAULT_HOP_S * 1000) / 1000
            edges.append({"id": _eid("hop", sid), "from": "any-page", "to": sid,
                          "action": f"clay-go {sid}: push {st['url']} through Clay's router",
                          "postcondition": "Arrival check passes: " + json.dumps(st["arrive"][0]),
                          "status": "observed", "cost": round(cost, 3), "forbidden": False})
        else:
            steps = "; then ".join(f"press {json.dumps(c['click'])}" for c in st.get("steps", []))
            edges.append({"id": _eid("click", sid), "from": st["parent"], "to": sid, "action": _clean(steps, 400),
                          "postcondition": "Arrival check passes: " + json.dumps(st["arrive"][0]),
                          "status": "observed", "cost": 0.3, "forbidden": False})
        for g in st.get("gates", []):
            edges.append({"id": _eid("gate", sid, g), "from": sid, "to": "gate-held", "action": "GATE, never pressed: " + _clean(g),
                          "postcondition": "Not pressed by an agent", "status": "documented", "cost": 1.0, "forbidden": True})

    # Crawled states and element edges.
    def crawl_id(cs: dict) -> str:
        if not cs["chain"]:
            key = re.sub(r"\{[a-z_]+\}", "{}", cs["base"])
            if key in curated_base:
                return curated_base[key]
        return "x." + cs["id"]

    ids = {sid: crawl_id(cs) for sid, cs in crawl["states"].items()}
    for sid, cs in crawl["states"].items():
        opener = " > ".join(f"{c['role']}:{c['label']}" for c in cs["chain"]) or "page"
        state(ids[sid], f"{cs['base']} [{cs['kind']}] via {opener}")
        if not cs["chain"]:
            edges.append({"id": _eid("xleave", sid), "from": ids[sid], "to": "any-page", "action": "Already on a Clay page",
                          "postcondition": "Sidebar visible", "status": "observed", "cost": 0.0, "forbidden": False})
            if ids[sid].startswith("x."):
                cost = (hop_ms.get(cs["base"]) or DEFAULT_HOP_S * 1000) / 1000
                edges.append({"id": _eid("xhop", sid), "from": "any-page", "to": ids[sid],
                              "action": f"Push the {cs['base']} URL through Clay's router", "postcondition": "Path matches",
                              "status": "observed", "cost": round(cost, 3), "forbidden": False})
    for sid, cs in crawl["states"].items():
        for e in cs["elements"]:
            label = f"{e['role']}:{e['label']}" + (f" [{e['testid']}]" if e.get("testid") else "")
            if e["disposition"] == "gate":
                edges.append({"id": _eid("xg", sid, e["struct"], label), "from": ids[sid], "to": "gate-held",
                              "action": "GATE, never pressed: " + _clean(label) + (f" ({e['reason']})" if e.get("reason") else ""),
                              "postcondition": "Not pressed by an agent", "status": "observed", "cost": 1.0, "forbidden": True})
            elif e["disposition"] in ("explored", "link") and e.get("to") in ids:
                # A link costs the page it opens; a press with no recorded
                # first-change time costs its quiet time, else a hop's guess.
                if e["disposition"] == "link":
                    ms = hop_ms.get(crawl["states"][e["to"]]["base"]) or DEFAULT_HOP_S * 1000
                else:
                    ms = e.get("ms") or e.get("quiet_ms") or DEFAULT_HOP_S * 1000
                edges.append({"id": _eid("xe", sid, e["struct"], label), "from": ids[sid], "to": ids[e["to"]],
                              "action": ("Follow link " if e["disposition"] == "link" else "Press ") + _clean(label),
                              "postcondition": f"{e.get('kind', 'page')} opens; {e.get('unlocked', 0)} new controls",
                              "status": "observed", "cost": round(ms / 1000, 3), "forbidden": False})
    # Element struct + label can repeat inside one state; keep the first.
    seen, unique = set(), []
    for e in edges:
        if e["id"] not in seen:
            seen.add(e["id"])
            unique.append(e)
    return {
        "schema_version": 1, "package_id": "clay-navigation", "revision": routes["revision"],
        "title": "Clay: every screen, element and gate, with router hops",
        "cost_unit": "seconds",
        "notes": ("Revision 2026-10-09: curated screens from routes.json (one router hop each from any-page), every state and "
                  "element edge from the read-only crawl in elements.json, and the earlier hand-written edges kept by id. "
                  "Every control that saves, runs, sends, spends, creates, deletes or starts is a forbidden edge into "
                  "gate-held: recorded, never routed through. Hand-written edges cost 1.0, never measured; crawled and "
                  "curated costs are measured seconds in a background tab. Observed means seen by the crawler or the "
                  "operator, not independently replayed; no mastery claim."),
        "states": [{"id": k, "label": v} for k, v in states.items()],
        "edges": unique,
    }
