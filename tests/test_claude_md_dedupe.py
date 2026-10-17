"""tools/claude_md_dedupe.py excludes only the kit files ~/.claude already loads."""
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
import claude_md_dedupe as cd  # noqa: E402


def build(tmp):
    root, home = Path(tmp, "kit"), Path(tmp, "home")
    (root / ".claude" / "rules").mkdir(parents=True)
    (home / ".claude" / "rules").mkdir(parents=True)
    (root / "CLAUDE.md").write_text("# Kit\nPray first.\n")
    (home / ".claude" / "CLAUDE.md").write_text("# Kit\nPray first.\n\n# Yours\nCaleb's own rules.\n")
    for name in ("naming.md", "git.md"):
        (root / ".claude" / "rules" / name).write_text("same")
        (home / ".claude" / "rules" / name).write_text("same")
    (root / ".claude" / "rules" / "git.md").write_text("newer in the repo")     # drifted: keep loading
    (root / ".claude" / "rules" / "brand-new.md").write_text("only here")      # no twin: keep loading
    return root, home


def test_only_true_duplicates_are_excluded():
    with tempfile.TemporaryDirectory() as tmp:
        root, home = build(tmp)
        assert cd.kit_duplicates(root, home) == ["CLAUDE.md", ".claude/rules/naming.md"]


def test_a_kit_claude_md_the_global_lacks_keeps_loading():
    with tempfile.TemporaryDirectory() as tmp:
        root, home = build(tmp)
        (root / "CLAUDE.md").write_text("# Kit\nPray first.\nA new rule from today.\n")
        assert "CLAUDE.md" not in cd.kit_duplicates(root, home)


def test_apply_keeps_other_excludes_and_is_idempotent():
    with tempfile.TemporaryDirectory() as tmp:
        root, home = build(tmp)
        s = home / ".claude" / "settings.json"
        s.write_text(json.dumps({"claudeMdExcludes": ["/elsewhere/CLAUDE.md"], "hooks": {"Stop": []}}))
        pats = cd.patterns(root, cd.kit_duplicates(root, home))
        cd.apply(s, pats, root)
        cd.apply(s, pats, root)
        got = json.loads(s.read_text())
        assert got["hooks"] == {"Stop": []}
        assert got["claudeMdExcludes"][0] == "/elsewhere/CLAUDE.md"
        assert got["claudeMdExcludes"].count(f"{root}/CLAUDE.md") == 1
        assert f"{root}/.claude/worktrees/*/.claude/rules/naming.md" in got["claudeMdExcludes"]


if __name__ == "__main__":
    test_only_true_duplicates_are_excluded()
    test_a_kit_claude_md_the_global_lacks_keeps_loading()
    test_apply_keeps_other_excludes_and_is_idempotent()
    print("claude_md_dedupe: all passed")
