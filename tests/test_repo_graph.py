#!/usr/bin/env python3
"""bin/repo-graph: a 3-line list builds the right nodes and edges with no network.

A fake gh answers the GraphQL batch: old/thing was renamed to Fresh/Thing, and
gone/repo is a 404. The graph has to merge the rename into one node, keep the
404 as a missing node, read the verdict words, and find use in an install line
and a SKILL.md.

Run: python3 tests/test_repo_graph.py
"""
import json
import os
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOST = "gi" + "thub.com"
failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


FAKE_GH = r'''#!/usr/bin/env python3
import json, re, sys
query = next(a[len("query="):] for a in sys.argv if a.startswith("query="))
renames = {"old/thing": "Fresh/Thing"}
data = {}
for alias, owner, name in re.findall(r'(r\d+):repository\(owner:"([^"]+)",name:"([^"]+)"\)', query):
    key = f"{owner}/{name}"
    if key == "gone/repo":
        data[alias] = None
        continue
    data[alias] = {"nameWithOwner": renames.get(key, key), "stargazerCount": 42,
                   "pushedAt": "2026-10-01T00:00:00Z", "isArchived": False, "description": "d",
                   "licenseInfo": {"spdxId": "MIT"}, "primaryLanguage": {"name": "Swift"}}
print(json.dumps({"data": data}))
'''


def main() -> int:
    tmp = Path(tempfile.mkdtemp())
    gh = tmp / "gh"
    gh.write_text(FAKE_GH)
    gh.chmod(gh.stat().st_mode | stat.S_IEXEC)

    lst = tmp / "links.md"
    lst.write_text(
        f"- [old/thing](https://{HOST}/old/thing) (2026-10-01): **rejected**, too narrow.\n"
        f"- [acme/widget](https://{HOST}/acme/widget.git) and [Fresh/Thing](https://{HOST}/Fresh/Thing)\n"
        f"- [gone/repo](https://{HOST}/gone/repo): **later**, waiting on a task.\n")

    kit = tmp / "kit"
    (kit / "skills" / "demo").mkdir(parents=True)
    (kit / "setup.sh").write_text("brew install widget &>/dev/null || warn 'no widget'\n")
    (kit / "skills" / "demo" / "SKILL.md").write_text("Built on fresh/thing's parser.\n")
    (kit / "docs").mkdir()
    (kit / "docs" / "notes.md").write_text("We looked at gone/repo once.\n")

    out = tmp / "graph.jsonl"
    env = dict(os.environ, REPO_GRAPH_GH=str(gh))
    p = subprocess.run([sys.executable, str(ROOT / "bin" / "repo-graph"), "--list", str(lst),
                        "--root", str(kit), "--out", str(out), "--no-cache"],
                       capture_output=True, text=True, env=env, timeout=60)
    check("build exits 0", p.returncode == 0, p.stderr)
    recs = [json.loads(l) for l in out.read_text().splitlines()]
    meta = recs[0]
    nodes = {r["id"]: r for r in recs if r["type"] == "node"}
    edges = [r for r in recs if r["type"] == "edge"]

    check("meta counts 4 raw links", meta.get("raw_links") == 4, meta)
    check("four listed ids collapse to three repos", sorted(nodes) == ["acme/widget", "fresh/thing", "gone/repo"], sorted(nodes))
    check("rename kept as an alias", nodes["fresh/thing"]["aliases"] == ["old/thing"], nodes["fresh/thing"]["aliases"])
    check("canonical name keeps GitHub's casing", nodes["fresh/thing"]["canonical"] == "Fresh/Thing")
    check("404 is kept and marked missing", nodes["gone/repo"]["missing"] is True)
    check("metadata lands on the node", nodes["acme/widget"]["stars"] == 42 and nodes["acme/widget"]["license"] == "MIT")

    def has(kind, src, **kw):
        return any(e["kind"] == kind and e["src"] == src and all(e.get(k) == v for k, v in kw.items()) for e in edges)

    check("LISTED_IN carries the line", has("LISTED_IN", "fresh/thing", line=1) and has("LISTED_IN", "fresh/thing", line=2))
    check("rejection follows the rename", has("REJECTED_IN", "fresh/thing", line=1))
    check("later is a DEFERRED_IN edge", has("DEFERRED_IN", "gone/repo", line=3))
    check("install token is USED_BY setup.sh", has("USED_BY", "acme/widget", file="setup.sh", use="installed"))
    check("SKILL.md citation is USED_BY", has("USED_BY", "fresh/thing", file="skills/demo/SKILL.md", use="skill"))
    check("a doc mention is not use", has("MENTIONED_IN", "gone/repo", file="docs/notes.md")
          and not has("USED_BY", "gone/repo"))
    check("every edge has provenance", all(e.get("file") and e.get("line") and e.get("via") for e in edges))
    check("status: use beats rejection", nodes["fresh/thing"]["status"] == "used")
    check("status: deferred stays untriaged", nodes["gone/repo"]["status"] == "untriaged")

    # A graph written inside the kit is committed, so a list from outside the
    # kit (the second brain) must not reach it.
    inside = kit / "data" / "graph.jsonl"
    inside.parent.mkdir()
    q = subprocess.run([sys.executable, str(ROOT / "bin" / "repo-graph"), "--list", str(lst),
                        "--root", str(kit), "--out", str(inside), "--no-cache"],
                       capture_output=True, text=True, env=env, timeout=60)
    irecs = [json.loads(l) for l in inside.read_text().splitlines()] if inside.exists() else []
    check("a private list never lands in a graph inside the kit",
          q.returncode == 0 and "skipped private lists" in q.stderr
          and not any(r.get("kind") == "LISTED_IN" for r in irecs), q.stderr)

    s = subprocess.run([sys.executable, str(ROOT / "bin" / "repo-graph"), "stats", "--out", str(out)],
                       capture_output=True, text=True, timeout=30)
    check("stats prints the overlap matrix", s.returncode == 0 and "overlap matrix" in s.stdout, s.stdout + s.stderr)

    print(f"\n{'all passed' if not failed else f'{failed} failed'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
