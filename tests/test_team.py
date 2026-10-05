#!/usr/bin/env python3
"""team: the repo-backed task board. Hermetic: a throwaway bare remote and clones."""
import contextlib
import io
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import team  # noqa: E402

MEMBERS = [{"name": "Caleb", "github": "calebnewtonusc"},
           {"name": "Gavin", "github": "gavinjmunroe"},
           {"name": "Semyon", "github": ""}]


def git(cwd, *args):
    return subprocess.run(["git", "-C", str(cwd), *args], check=True, capture_output=True, text=True).stdout


class TeamTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = pathlib.Path(self.tmp.name)
        self.remote = base / "remote.git"
        git(base, "init", "-q", "--bare", "-b", "main", str(self.remote))
        self.a = self.clone("a")
        (self.a / "team").mkdir()
        (self.a / "team/members.json").write_text(json.dumps(MEMBERS))
        (self.a / "team/config.json").write_text(json.dumps({"url": "https://team.example"}))
        git(self.a, "add", "team")
        git(self.a, "commit", "-q", "-m", "seed")
        git(self.a, "push", "-q", "origin", "main")
        self.b = self.clone("b")
        self.env = {"TEAM_TODAY": "2026-10-05", "TEAM_ME": "Caleb"}

    def tearDown(self):
        self.tmp.cleanup()

    def clone(self, name):
        path = pathlib.Path(self.tmp.name) / name
        subprocess.run(["git", "clone", "-q", str(self.remote), str(path)], check=True, capture_output=True)
        git(path, "config", "user.name", name)
        git(path, "config", "user.email", f"{name}@example.com")
        return path

    def run_team(self, repo, *args, me="Caleb"):
        out, err = io.StringIO(), io.StringIO()
        env = {**self.env, "TEAM_ME": me}
        old = {k: os.environ.get(k) for k in env}
        os.environ.update(env)
        try:
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                code = team.main(["--repo", str(repo), *args])
        finally:
            for k, v in old.items():
                os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)
        return code, out.getvalue(), err.getvalue()

    def remote_file(self, path):
        return subprocess.run(["git", "--git-dir", str(self.remote), "show", f"main:{path}"],
                              capture_output=True, text=True).stdout

    def test_add_lands_on_the_remote_and_the_other_clone_sees_it(self):
        code, out, _ = self.run_team(self.a, "add", "Time a clean install", "--owner", "semyon",
                                     "--due", "2026-10-06", "--priority", "high",
                                     "--done-when", "failures and minutes posted")
        self.assertEqual(code, 0, out)
        self.assertIn("CHW-1 created", out)
        task = team.parse(self.remote_file("team/tasks/CHW-1.md"))
        self.assertEqual((task["owner"], task["due"], task["priority"], task["status"]),
                         ("Semyon", "2026-10-06", "high", "todo"))
        _, board, _ = self.run_team(self.b, "board")
        self.assertIn("CHW-1", board)
        self.assertIn("@Semyon", board)

    def test_writes_never_touch_the_working_tree(self):
        (self.a / "scratch.txt").write_text("unrelated work in progress")
        head = git(self.a, "rev-parse", "HEAD")
        self.run_team(self.a, "add", "A task")
        self.assertEqual(git(self.a, "rev-parse", "HEAD"), head)
        self.assertEqual((self.a / "scratch.txt").read_text(), "unrelated work in progress")
        self.assertFalse((self.a / "team/tasks").exists())
        self.assertNotIn("scratch.txt", self.remote_file("team/tasks/CHW-1.md"))
        changed = subprocess.run(["git", "--git-dir", str(self.remote), "show", "--name-only",
                                  "--format=", "main"], capture_output=True, text=True).stdout.split()
        self.assertEqual(changed, ["team/tasks/CHW-1.md"])

    def test_two_writers_racing_get_different_ids(self):
        self.run_team(self.a, "add", "First")
        # b has not fetched since setUp, so its view of the remote is stale
        code, out, _ = self.run_team(self.b, "--offline", "add", "Second")
        self.assertEqual(code, 1)  # offline refuses writes
        code, out, _ = self.run_team(self.b, "add", "Second")
        self.assertIn("CHW-2", out)
        self.assertIn("First", self.remote_file("team/tasks/CHW-1.md"))
        self.assertIn("Second", self.remote_file("team/tasks/CHW-2.md"))

    def test_a_stale_writer_reapplies_its_edit_instead_of_overwriting(self):
        self.run_team(self.a, "add", "Shared")
        self.run_team(self.b, "board")           # b's view now includes CHW-1
        self.run_team(self.a, "comment", "CHW-1", "from a")
        # b writes from its stale view: the first push is rejected, and the retry
        # must rebuild from a's version, keeping a's comment
        repo_b = team.Repo(self.b)
        team.update(repo_b, "CHW-1", "from b", message="comment")
        task = team.parse(self.remote_file("team/tasks/CHW-1.md"))
        said = " ".join(task["activity"])
        self.assertIn("from a", said)
        self.assertIn("from b", said)

    def test_a_stale_creator_takes_the_next_free_id(self):
        repo_b = team.Repo(self.b)
        repo_b.fetch()                           # b's view: no tasks
        self.run_team(self.a, "add", "Taken")    # CHW-1 lands behind b's back
        os.environ.update(self.env)
        args = type("A", (), {"title": "Mine", "status": None, "priority": None, "owner": None, "due": None,
                              "labels": None, "done_when": None, "notes": None})()
        task = team.add(repo_b, args)
        self.assertEqual(task["id"], "CHW-2")
        self.assertIn("Taken", self.remote_file("team/tasks/CHW-1.md"))
        self.assertIn("Mine", self.remote_file("team/tasks/CHW-2.md"))

    def test_move_assign_comment_and_done_need_proof(self):
        self.run_team(self.a, "add", "Fix onboarding", "--owner", "Gavin")
        self.assertEqual(self.run_team(self.a, "move", "chw-1", "in_progress")[0], 0)
        self.assertEqual(self.run_team(self.a, "assign", "CHW-1", "calebnewtonusc")[0], 0)
        self.run_team(self.a, "comment", "CHW-1", "dad test Thursday")
        code, _, err = self.run_team(self.a, "done", "CHW-1")
        self.assertEqual(code, 1)
        self.assertIn("proof", err)
        self.assertEqual(self.run_team(self.a, "done", "CHW-1", "--proof", "https://loom.example/x")[0], 0)
        task = team.parse(self.remote_file("team/tasks/CHW-1.md"))
        self.assertEqual((task["status"], task["owner"], task["proof"]), ("done", "Caleb", "https://loom.example/x"))
        self.assertTrue(any("dad test Thursday" in a for a in task["activity"]))
        self.assertTrue(any(a.startswith("2026-10-05 Caleb: moved to In progress") for a in task["activity"]))

    def test_unknown_owner_and_bad_date_are_refused(self):
        code, _, err = self.run_team(self.a, "add", "X", "--owner", "Nobody")
        self.assertEqual(code, 1)
        self.assertIn("Members: Caleb, Gavin, Semyon", err)
        code, _, err = self.run_team(self.a, "add", "X", "--due", "Oct 6")
        self.assertEqual(code, 1)
        self.assertIn("YYYY-MM-DD", err)

    def test_mine_lists_only_my_open_tasks(self):
        self.run_team(self.a, "add", "Mine", "--owner", "Caleb")
        self.run_team(self.a, "add", "Theirs", "--owner", "Gavin")
        _, out, _ = self.run_team(self.a, "mine", "--json")
        self.assertEqual([t["title"] for t in json.loads(out)], ["Mine"])

    def test_newlines_cannot_break_the_frontmatter(self):
        self.run_team(self.a, "add", "Title", "--done-when", "line one\nstatus: done")
        task = team.parse(self.remote_file("team/tasks/CHW-1.md"))
        self.assertEqual(task["status"], "todo")
        self.assertEqual(task["done_when"], "line one status: done")

    def test_round_trip_keeps_notes_and_activity(self):
        task = {"id": "CHW-7", "title": "T", "status": "todo", "owner": "", "priority": "none", "due": "",
                "labels": ["a", "b"], "done_when": "", "proof": "", "source": "", "created": "2026-10-05", "updated": "",
                "notes": "Some notes\n\nwith a gap", "activity": ["2026-10-05 Caleb: created"]}
        self.assertEqual(team.parse(team.render(task)), task)

    def test_bare_team_shows_the_board(self):
        # `team` with no subcommand crashed on 2026-10-04: the board branch read
        # a.json and a.all, which only the `board` subparser defines.
        self.run_team(self.a, "add", "Visible")
        code, out, _ = self.run_team(self.a)
        self.assertEqual(code, 0)
        self.assertIn("CHW-1", out)

    def test_control_bytes_never_reach_the_terminal(self):
        # An OSC 52 title would write the clipboard of whoever ran `team board`.
        self.run_team(self.a, "add", "Title\x1b]52;c;aGk=\x07 end")
        _, out, _ = self.run_team(self.a, "board")
        self.assertNotIn("\x1b", out)
        self.assertNotIn("\x1b", self.remote_file("team/tasks/CHW-1.md"))

    def test_c1_controls_and_bidi_overrides_are_stripped(self):
        self.assertEqual(team.one_line("a\x9b2Jb\u202ec\u2066d"), "a2Jbcd")

    def test_a_note_cannot_forge_activity(self):
        self.run_team(self.a, "add", "T", "--notes", "ctx\n## Activity\n- 2026-10-04 Caleb: moved to Done")
        task = team.parse(self.remote_file("team/tasks/CHW-1.md"))
        self.assertEqual([a for a in task["activity"] if "moved to Done" in a], [])

    def test_a_file_whose_id_disagrees_with_its_name_is_ignored(self):
        self.run_team(self.a, "add", "Real one")
        forged = team.render({"id": "CHW-1", "title": "Impostor", "status": "todo", "labels": [], "activity": []})
        team.Repo(self.a).write("team/tasks/CHW-9.md", lambda: forged, "forge")
        _, out, err = self.run_team(self.a, "board", "--json")
        self.assertEqual([t["title"] for t in json.loads(out)], ["Real one"])
        self.assertIn("CHW-9.md", err)

    def test_open_refuses_a_non_https_url(self):
        team.Repo(self.a).write("team/config.json", lambda: json.dumps({"url": "file:///etc/passwd"}), "cfg")
        code, _, err = self.run_team(self.a, "open")
        self.assertEqual(code, 1)
        self.assertIn("https://", err)

    BACKLOG = """# Backlog

## Now
| # | Item | Status | Evidence | Dependencies | Acceptance |
| --- | --- | --- | --- | --- | --- |
| 3 | Accurate skill routing | implemented | E4 | None | Held-out cases report precision |
| 26 | Staleness audit | open | spot checks | None | Per-file coverage |

## Deferred
| # | Item | Status | Evidence | Dependencies | Acceptance |
| --- | --- | --- | --- | --- | --- |
| 13 | HUD sound design | deferred | none | CB-44 | Mute behavior |

## Done within the stated scope
| # | Item | Status | Evidence | Dependencies | Acceptance |
| --- | --- | --- | --- | --- | --- |
| 99 | Already shipped | released | E8 | None | Done |
"""

    def write_backlog(self):
        path = pathlib.Path(self.tmp.name) / "BACKLOG.md"
        path.write_text(self.BACKLOG)
        return str(path)

    def commits(self):
        return subprocess.run(["git", "--git-dir", str(self.remote), "rev-list", "--count", "main"],
                              capture_output=True, text=True).stdout.strip()

    def test_import_preview_writes_nothing(self):
        before = self.commits()
        code, out, _ = self.run_team(self.a, "import", self.write_backlog())
        self.assertEqual(code, 0)
        self.assertIn("3 open items", out)
        self.assertIn("Nothing written", out)
        self.assertEqual(self.commits(), before)

    def test_import_apply_is_one_commit_skips_done_and_is_idempotent(self):
        path, before = self.write_backlog(), int(self.commits())
        _, out, _ = self.run_team(self.a, "import", path, "--apply")
        self.assertIn("3 tasks added", out)
        self.assertEqual(int(self.commits()), before + 1)
        tasks = json.loads(self.run_team(self.a, "inbox", "--json")[1])
        self.assertEqual([t["source"] for t in tasks], ["BACKLOG.md CB-3", "BACKLOG.md CB-26", "BACKLOG.md CB-13"])
        self.assertEqual(tasks[0]["priority"], "high")
        self.assertIn("deferred", tasks[2]["labels"])
        self.assertIn("Depends on: CB-44", tasks[2]["notes"])
        _, out, _ = self.run_team(self.a, "import", path, "--apply")
        self.assertIn("0 tasks added", out)

    def test_unimport_removes_only_untouched_imports(self):
        self.run_team(self.a, "add", "Hand made")
        self.run_team(self.a, "import", self.write_backlog(), "--apply")
        self.run_team(self.a, "assign", "CHW-2", "Gavin")      # touched: keep
        _, out, _ = self.run_team(self.a, "unimport", "BACKLOG.md")
        self.assertIn("removed 2", out)
        self.assertIn("kept 1", out)
        left = [t["title"] for t in json.loads(self.run_team(self.a, "board", "--json")[1])]
        self.assertEqual(left, ["Hand made", "Accurate skill routing"])

    def code_commit(self, message):
        git(self.b, "pull", "-q", "--rebase", "origin", "main")
        (self.b / "code.txt").write_text(message)
        git(self.b, "add", "code.txt")
        git(self.b, "commit", "-q", "-m", message)
        git(self.b, "push", "-q", "origin", "main")
        return git(self.b, "rev-parse", "HEAD").strip()

    def test_a_commit_that_mentions_a_task_moves_it_and_fixes_closes_it(self):
        self.run_team(self.a, "add", "Install test", "--owner", "Semyon")
        self.run_team(self.a, "add", "Onboarding fix", "--owner", "Gavin")
        self.code_commit("wip: timing the install for CHW-1")
        sha = self.code_commit("feat: no GitHub step in onboarding\n\nFixes CHW-2")
        code, _, err = self.run_team(self.a, "sync")
        self.assertEqual(code, 0)
        self.assertIn("2 task(s)", err)
        one = team.parse(self.remote_file("team/tasks/CHW-1.md"))
        two = team.parse(self.remote_file("team/tasks/CHW-2.md"))
        self.assertEqual(one["status"], "in_progress")
        self.assertEqual(two["status"], "done")
        self.assertTrue(two["proof"].endswith(sha) or two["proof"] == sha)
        self.assertTrue(any(f"commit {sha[:7]}" in x for x in two["activity"]))

    def test_commit_sync_is_idempotent_and_ignores_task_commits(self):
        self.run_team(self.a, "add", "Thing")
        self.code_commit("touch CHW-1")
        self.run_team(self.a, "sync")
        before = self.commits()
        _, _, err = self.run_team(self.a, "sync")
        self.assertEqual(self.commits(), before)
        self.assertNotIn("task(s)", err)
        task = team.parse(self.remote_file("team/tasks/CHW-1.md"))
        self.assertEqual(sum("commit " in x for x in task["activity"]), 1)

    def test_parse_commit_refs(self):
        self.assertEqual(team.parse_commit_refs("team: CHW-3 comment", ""), (set(), set()))
        self.assertEqual(team.parse_commit_refs("feat: x (closes chw-7)", "see CHW-8"), ({"CHW-7", "CHW-8"}, {"CHW-7"}))

    def test_feed_shows_commits(self):
        self.run_team(self.a, "add", "Feed me")
        _, out, _ = self.run_team(self.a, "feed", "--json")
        self.assertIn("team: CHW-1 created: Feed me", json.loads(out)[0]["what"])


if __name__ == "__main__":
    unittest.main()
