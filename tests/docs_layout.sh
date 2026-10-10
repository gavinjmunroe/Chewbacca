#!/bin/bash
# docs/ holds three folders and one index. On 2026-10-09 it held 76 flat files:
# install guides next to dated plans next to specs, and nothing said which was
# which, so a reader opened the longest one or grepped and hoped. They were
# sorted into guide/, reference/ and plans/, with docs/README.md as the index.
#
# This fails when that drifts back:
#   1. a markdown file directly in docs/ other than README.md
#   2. a doc in guide/, reference/ or plans/ that docs/README.md never links
#   3. a relative markdown link anywhere under docs/ that points at nothing
#
#   tests/docs_layout.sh [root]         check the repo
#   tests/docs_layout.sh [root] mutant  prove each rule refuses a bad tree
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
MODE="${2:-check}"

check_tree() {
  python3 - "$1" <<'PY'
import pathlib, re, sys
root = pathlib.Path(sys.argv[1])
docs = root / "docs"
bad = []
for p in sorted(docs.glob("*.md")):
    if p.name != "README.md":
        bad.append(f"docs/{p.name} sits at the top of docs/; move it into guide/, reference/ or plans/")
index = (docs / "README.md").read_text(encoding="utf-8") if (docs / "README.md").is_file() else ""
linked = {m.split("#")[0] for m in re.findall(r"\]\(([^)\s]+)\)", index)}
for folder in ("guide", "reference", "plans"):
    for p in sorted((docs / folder).glob("*.md")):
        if f"{folder}/{p.name}" not in linked:
            bad.append(f"docs/{folder}/{p.name} is missing from docs/README.md")
skip = re.compile(r"^(https?:|#|mailto:|/|~)")
for md in sorted(docs.rglob("*.md")):
    fenced = False
    for n, line in enumerate(md.read_text(encoding="utf-8", errors="ignore").split("\n"), 1):
        if line.lstrip().startswith("```"):
            fenced = not fenced
            continue
        if fenced:
            continue
        for target in re.findall(r"\]\(([^)\s]+)\)", line):
            path = target.split("#")[0]
            if path and not skip.match(path) and not (md.parent / path).exists():
                bad.append(f"{md.relative_to(root)}:{n} links {target}, which does not exist")
for b in bad:
    print(f"  FAIL {b}")
if bad:
    sys.exit(1)
print("  ok   docs/ is sorted, indexed, and every relative link resolves")
PY
}

if [ "$MODE" = "mutant" ]; then
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  mkdir -p "$tmp/docs/guide" "$tmp/docs/reference" "$tmp/docs/plans"
  echo "[A](guide/A.md)" > "$tmp/docs/README.md"
  echo "# A" > "$tmp/docs/guide/A.md"
  check_tree "$tmp" >/dev/null || { echo "  FAIL a clean tree was refused"; exit 1; }
  echo "# stray" > "$tmp/docs/STRAY.md"
  check_tree "$tmp" >/dev/null && { echo "  FAIL a stray top-level doc passed"; exit 1; }
  rm "$tmp/docs/STRAY.md"
  echo "# B" > "$tmp/docs/plans/B.md"
  check_tree "$tmp" >/dev/null && { echo "  FAIL an unindexed doc passed"; exit 1; }
  rm "$tmp/docs/plans/B.md"
  echo "[gone](../reference/GONE.md)" >> "$tmp/docs/guide/A.md"
  check_tree "$tmp" >/dev/null && { echo "  FAIL a broken relative link passed"; exit 1; }
  echo "  ok   each rule refuses its bad tree"
  exit 0
fi
check_tree "$ROOT"
