"""Tests for tools/inventory.py frontmatter parsing and house-style normalising.

Both cases here are bugs that shipped into docs/reference/REFERENCE.md, which is a public
file, on 2026-09-16 when Cap's two skills were installed.

    python3 tests/test_inventory.py
"""

import importlib.util
import pathlib
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("inventory", ROOT / "tools" / "inventory.py")
inv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inv)

PASSED = FAILED = 0


def check(name, condition, detail=""):
    global PASSED, FAILED
    if condition:
        PASSED += 1
        print(f"  pass  {name}")
    else:
        FAILED += 1
        print(f"  FAIL  {name}  {detail}")


def frontmatter(text):
    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as fh:
        fh.write(text)
    return inv.read_frontmatter(pathlib.Path(fh.name))


# ── YAML block scalars ───────────────────────────────────────────────────────
#
# The parser handled a bare "|" and ">" and nothing else. Cap writes
# `description: >-`, so the marker became the value and the folded lines were
# appended behind it. docs/reference/REFERENCE.md published ">- Always use Cap's CLI...".

for marker in ("|", ">", "|-", ">-", "|+", ">+", "|2", ">2"):
    fm = frontmatter(f"---\nname: x\ndescription: {marker}\n  the real text here\n---\n\nbody\n")
    check(
        f"block scalar '{marker}' does not leak into the value",
        fm.get("description") == "the real text here",
        repr(fm.get("description")),
    )

fm = frontmatter("---\nname: x\ndescription: a plain one-line value\n---\n")
check(
    "a plain scalar is untouched",
    fm.get("description") == "a plain one-line value",
    repr(fm.get("description")),
)

# A value that merely starts with > is not a block scalar.
fm = frontmatter("---\nname: x\ndescription: '>= 3 files'\n---\n")
check(
    "a value that only looks like a marker survives",
    ">= 3 files" in (fm.get("description") or ""),
    repr(fm.get("description")),
)


# ── house style on vendored text ─────────────────────────────────────────────
#
# Vendored descriptions ship verbatim into README.md and docs/reference/REFERENCE.md,
# where this repo's writing rules ban em dashes outright. Cap's cap-demo
# description put one straight into the generated table.

check(
    "a spaced em dash becomes a colon",
    inv.house_style("Generate a demo — scouts the page") == "Generate a demo: scouts the page",
    inv.house_style("Generate a demo — scouts the page"),
)
check(
    "an unspaced em dash becomes a comma",
    inv.house_style("zoom—on click") == "zoom, on click",
    inv.house_style("zoom—on click"),
)
check("text without an em dash is unchanged", inv.house_style("plain text") == "plain text")
check("a non-string passes through", inv.house_style(None) is None)

fm = frontmatter("---\nname: x\ndescription: >-\n  a demo — with a dash\n---\n")
check(
    "frontmatter is normalised on the way out",
    "—" not in (fm.get("description") or ""),
    repr(fm.get("description")),
)


# ── skill packs whose skills are not under skills/ ───────────────────────────

# gtm-engineer-skills (2026-09-23) keeps its skills at the repo root. The
# generated loop hardcoded "$PACK_DIR"/skills/*/, which would have linked
# nothing and logged "0 skills linked" as if that were success.
root_pack = {"name": "p", "url": "https://x/p", "skip": [], "subdir": ".", "note": []}
nested_pack = {"name": "q", "url": "https://x/q", "skip": [], "subdir": "skills", "note": ["hello"]}
block = inv.cli_block({}, [root_pack, nested_pack])
check("a root-level pack loops over the clone root", '"$PACK_DIR"/./*/' in block, block)
check("a nested pack still loops over skills/", '"$PACK_DIR"/skills/*/' in block, block)
check("a pack's note becomes a comment", "# hello" in block, block)

# coldoutboundskills keeps skills under skills/ and skills/playbooks/, and
# goose-skills under skills/<category>/<kind>/ (2026-10-09). A one-level glob
# links none of the playbooks and none of goose's skills.
deep_pack = {"name": "d", "url": "https://x/d", "skip": [], "subdir": "skills",
             "depth": 4, "only": ["a"], "note": []}
block = inv.cli_block({}, [deep_pack])
check("a deep pack walks with find to its depth",
      'find "$PACK_DIR/skills" -mindepth 2 -maxdepth 4 -name SKILL.md' in block, block)
check("a deep pack feeds the loop by process substitution, so PACK_N survives",
      "done < <(find" in block and "| while" not in block, block)

import subprocess, tempfile, os
with tempfile.TemporaryDirectory() as tmp:
    for rel in ("skills/a", "skills/cat/kind/a2", "skills/playbooks/a"):
        os.makedirs(f"{tmp}/pack/{rel}")
        open(f"{tmp}/pack/{rel}/SKILL.md", "w").close()
    os.makedirs(f"{tmp}/home/.claude/skills")
    os.makedirs(f"{tmp}/pack/.git")
    deep_pack["only"] = ["a2", "a"]
    body = inv.cli_block({}, [deep_pack])
    body = body[body.index("# Skill pack:"):].replace('"$HOME/Projects/d"', f'"{tmp}/pack"')
    script = 'GLOBAL_CLAUDE="$HOME/.claude"; log(){ echo "$*"; }; warn(){ echo "$*"; }\n' + body
    out = subprocess.run(["bash", "-c", script], capture_output=True, text=True,
                         env={**os.environ, "HOME": f"{tmp}/home"}).stdout
    linked = sorted(os.listdir(f"{tmp}/home/.claude/skills"))
    check("a deep pack links nested skills and counts them", linked == ["a", "a2"] and "d: 2 skills linked" in out, (linked, out))

# A pack with a rev is fetched at that commit, never at a moving HEAD
# (security review of 788edb6b, 2026-10-09: unpinned third-party code).
pinned = {"name": "r", "url": "https://x/r", "skip": [], "subdir": "skills",
          "rev": "0123456789abcdef0123456789abcdef01234567", "note": []}
block = inv.cli_block({}, [pinned])
check("a pinned pack fetches its rev", "fetch -q --depth 1 \"https://x/r.git\" 0123456789abcdef" in block, block)
check("a pinned pack never clones HEAD", "git clone" not in block[block.index("# Skill pack:"):], block)
check("a pinned pack warns when an existing clone is elsewhere", "not at the vetted commit" in block, block)


# ── the generated files themselves ───────────────────────────────────────────

for rel in ("docs/reference/REFERENCE.md", "README.md", "config/settings/toolkit.json"):
    p = ROOT / rel
    if not p.is_file():
        continue
    body = p.read_text(encoding="utf-8")
    check(f"{rel} carries no em dash", "—" not in body)
    check(f"{rel} carries no leaked scalar marker", ">- " not in body and "| >-" not in body)

# ── a refused write still names its caller (backlog 515) ─────────────────────
#
# The 10/06 rewrite was never attributed. The guard added on 10/09 refused
# worktree and suite runs but logged only successful writes, so a refused
# writer left no trace. This runs main() under CHEWBACCA_SUITE with the log
# pointed at a temp dir and checks the refusal landed with a parent process.

if __name__ == "__main__":
    import json as _json
    import os as _os

    with tempfile.TemporaryDirectory() as logdir:
        saved = {k: _os.environ.get(k) for k in ("CHEWBACCA_SUITE", "CHEWBACCA_LOG_DIR")}
        _os.environ["CHEWBACCA_SUITE"] = "1"
        _os.environ["CHEWBACCA_LOG_DIR"] = logdir
        try:
            rc = inv.main()
        finally:
            for k, v in saved.items():
                if v is None:
                    _os.environ.pop(k, None)
                else:
                    _os.environ[k] = v
        logfile = pathlib.Path(logdir) / "inventory-writes.log"
        rows = [_json.loads(l) for l in logfile.read_text().splitlines()] if logfile.exists() else []
        check("a suite run is refused", rc == 2, f"rc={rc}")
        check("the refusal is logged", len(rows) == 1 and str(rows[0].get("changed", "")).startswith("refused:"), rows)
        check("the refusal names a parent process", bool(rows and rows[0].get("parent")), rows)

# ── a thin machine can't shrink the catalog, and --help doesn't write ───────
#
# Break-it, 2026-10-19: in a full clone, a home with one plugin and no skills
# ran `inventory.py --help`, and it wrote anyway: 719 lines out of setup.sh,
# toolkit.json and REFERENCE.md, all 8 upstream skills among them.

if __name__ == "__main__":
    import subprocess as _sp
    with tempfile.TemporaryDirectory() as td:
        clone = pathlib.Path(td) / "clone"
        _sp.run(["git", "clone", "-q", "--shared", str(ROOT), str(clone)], check=True)
        # The generator under test is this checkout's, which may not be committed yet.
        (clone / "tools/inventory.py").write_bytes((ROOT / "tools/inventory.py").read_bytes())
        _sp.run(["git", "-C", str(clone), "update-index", "--assume-unchanged", "tools/inventory.py"], check=True)
        home = pathlib.Path(td) / "home"
        (home / ".claude").mkdir(parents=True)
        (home / ".claude" / "settings.json").write_text('{"enabledPlugins": {"x@y": true}}')
        env = dict(os.environ if "os" in dir() else __import__("os").environ, HOME=str(home))
        env.pop("CHEWBACCA_SUITE", None)
        r = _sp.run([sys.executable, str(clone / "tools/inventory.py"), "--help"], env=env, capture_output=True, text=True)
        dirty = _sp.run(["git", "-C", str(clone), "status", "--porcelain"], capture_output=True, text=True).stdout
        check("--help prints help and writes nothing", r.returncode == 0 and not dirty, (r.returncode, dirty[:200]))
        r = _sp.run([sys.executable, str(clone / "tools/inventory.py")], env=env, capture_output=True, text=True)
        dirty = _sp.run(["git", "-C", str(clone), "status", "--porcelain"], capture_output=True, text=True).stdout
        check("a thin home is refused instead of shrinking the catalog", r.returncode == 2 and not dirty,
              (r.returncode, r.stderr[-300:], dirty[:200]))

# Guarded because the filename matches pytest's discovery pattern. Without
# this, importing the module to collect it runs sys.exit and pytest aborts the
# whole session with INTERNALERROR, taking every other test file down with it.
if __name__ == "__main__":
    print(f"\n{PASSED} passed, {FAILED} failed.")
    sys.exit(1 if FAILED else 0)
