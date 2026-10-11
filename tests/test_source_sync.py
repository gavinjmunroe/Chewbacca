"""source_sync catches the install checkout up without losing anyone's work.

2026-10-11: setup installed hooks from a checkout 62 commits behind main, and
essay-gate never registered. Its six "dirty" files were all copies of things
already on main. These cases pin which copies are safe to clear and which are
real work that must be left exactly as it is.
"""
import subprocess
import sys
from pathlib import Path

import pytest

TOOL = Path(__file__).resolve().parent.parent / "tools" / "source_sync.py"


def run(*args, cwd=None):
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


def commit(repo, files, msg):
    for name, text in files.items():
        p = repo / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
        run("git", "add", name, cwd=repo)
    run("git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", msg, cwd=repo)
    return run("git", "rev-parse", "HEAD", cwd=repo)


@pytest.fixture
def repo(tmp_path):
    r = tmp_path / "src"
    r.mkdir()
    run("git", "init", "-q", cwd=r)
    base = commit(r, {"index.md": "a\n", "other.md": "x\n"}, "base")
    mid = commit(r, {"index.md": "a\nb\n"}, "mid")
    top = commit(r, {"index.md": "a\nb\nc\n", "new.md": "n\n"}, "top")
    run("git", "checkout", "-q", base, cwd=r)
    return r, base, mid, top


def sync(r, target):
    p = subprocess.run([sys.executable, str(TOOL), str(r), target], capture_output=True, text=True)
    return p.returncode, p.stdout


def head(r):
    return run("git", "rev-parse", "HEAD", cwd=r)


def test_clean_checkout_catches_up(repo):
    r, _, _, top = repo
    assert sync(r, top)[0] == 0 and head(r) == top


def test_copy_of_main_is_cleared(repo):
    r, _, _, top = repo
    (r / "index.md").write_text("a\nb\nc\n")
    assert sync(r, top)[0] == 0 and head(r) == top


def test_older_main_version_is_cleared(repo):
    r, _, _, top = repo
    (r / "index.md").write_text("a\nb\n")
    assert sync(r, top)[0] == 0 and head(r) == top


def test_untracked_copy_of_main_is_cleared(repo):
    r, _, _, top = repo
    (r / "new.md").write_text("n\n")
    assert sync(r, top)[0] == 0 and head(r) == top


def test_real_edit_is_left_alone(repo):
    r, base, _, top = repo
    (r / "index.md").write_text("a\nsomebody's real work\n")
    rc, out = sync(r, top)
    assert rc == 1 and "real local work" in out
    assert head(r) == base
    assert (r / "index.md").read_text() == "a\nsomebody's real work\n"


def test_unrelated_dirty_file_survives_catch_up(repo):
    r, _, _, top = repo
    (r / "other.md").write_text("x\nwip\n")
    assert sync(r, top)[0] == 0 and head(r) == top
    assert (r / "other.md").read_text() == "x\nwip\n"


def test_local_commits_are_left_alone(repo):
    r, base, _, top = repo
    run("git", "checkout", "-q", "-b", "mine", cwd=r)
    mine = commit(r, {"other.md": "local\n"}, "local")
    rc, out = sync(r, top)
    assert rc == 1 and head(r) == mine
