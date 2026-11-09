#!/usr/bin/env python3
"""Which tracked markdown files anything actually uses.

Two signals per file: inbound references from other tracked files, and reads
or Skill invocations in the last N days of Claude Code transcripts. Read-only.
Baseline on 2026-10-14: 1,261 md files, 152,356 lines, 104 read in 30 days.
"""
import argparse, collections, glob, json, os, re, subprocess, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RX_SKILL = re.compile(r'"name":"Skill","input":\{"skill":"([^"]+)"')
RX_CMD = re.compile(r'<command-name>/?([^<]+)</command-name>')
RX_READ = re.compile(r'(?:code/chewbacca|\.chewbacca/skills|\.chewbacca/kit/current|wt-[^/"]+)/([A-Za-z0-9_./ -]+?\.md)')


def tracked():
    out = subprocess.run(["git", "-C", ROOT, "ls-files"], capture_output=True, text=True).stdout
    return [f for f in out.splitlines() if os.path.isfile(os.path.join(ROOT, f))]


def references(files):
    blob = {}
    for f in files:
        p = os.path.join(ROOT, f)
        if os.path.getsize(p) < 3_000_000:
            blob[f] = open(p, errors="ignore").read()
    refs = {}
    for f in (f for f in files if f.endswith(".md")):
        base, d = os.path.basename(f), os.path.dirname(f)
        keys = {f, f[:-3]}
        if base not in ("README.md", "SKILL.md", "CLAUDE.md", "AGENTS.md", "index.md"):
            keys.add(base)
        if d and base in ("SKILL.md", "README.md"):
            keys.add(d)
        refs[f] = sum(1 for g, s in blob.items() if g != f and any(k in s for k in keys))
    return refs, blob


def usage(days):
    cut = time.time() - days * 86400
    skill, cmds, reads = collections.Counter(), collections.Counter(), collections.Counter()
    for p in glob.glob(os.path.expanduser("~/.claude/projects/**/*.jsonl"), recursive=True):
        try:
            if os.path.getmtime(p) < cut:
                continue
            for line in open(p, errors="ignore"):
                if '"tool_use"' not in line and "command-name" not in line:
                    continue
                skill.update(RX_SKILL.findall(line))
                cmds.update(c.strip() for c in RX_CMD.findall(line))
                reads.update(m.strip() for m in RX_READ.findall(line))
        except OSError:
            continue
    return skill, cmds, reads


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    files = tracked()
    refs, blob = references(files)
    skill, cmds, reads = usage(a.days)
    rows = []
    for f, r in refs.items():
        hits = sum(c for p, c in reads.items() if p.endswith(f))
        parts = f.split("/")
        if parts[0] == "skills" and parts[-1] == "SKILL.md":
            hits += skill.get(parts[1], 0)
        if parts[0] == ".claude" and parts[1] == "commands":
            hits += cmds.get(parts[-1][:-3], 0)
        rows.append({"file": f, "refs": r, "used": hits, "lines": blob.get(f, "").count("\n")})
    if a.json:
        print(json.dumps(rows, indent=1))
        return
    groups = collections.defaultdict(lambda: [0, 0, 0])
    for row in rows:
        g = "/".join(row["file"].split("/")[:2]) if row["file"].count("/") > 1 else row["file"]
        groups[g][0] += 1
        groups[g][1] += row["used"] > 0
        groups[g][2] += row["lines"]
    print(f"{'group':32} used/files  lines")
    for g, (n, u, l) in sorted(groups.items(), key=lambda kv: -kv[1][2])[:40]:
        print(f"{g:32} {u:4}/{n:<5} {l}")
    print(f"TOTAL {sum(r['used'] > 0 for r in rows)}/{len(rows)} used in {a.days}d, "
          f"{sum(r['lines'] for r in rows)} lines")


if __name__ == "__main__":
    main()
