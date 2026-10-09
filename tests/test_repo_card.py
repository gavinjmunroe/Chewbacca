#!/usr/bin/env python3
"""repo_card: the sentences that draw a GitHub repo or profile card, what the
card draws, what a press may do, and the real hud-listen against a fake
display with a fake `gh` on PATH. Nothing reaches GitHub, nothing is cloned
for real, and no model runs."""
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "bin" / "lib"))
sys.path.insert(0, str(ROOT / "tests"))
import repo_card as rc  # noqa: E402

failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


NOW = datetime(2026, 10, 9, 20, 0, tzinfo=timezone.utc)
META = {"full_name": "goodnight000/api-anything", "name": "api-anything",
        "description": "Turn any website into an API.\nd /evil 1", "stargazers_count": 340,
        "license": {"spdx_id": "MIT"}, "pushed_at": "2026-10-09T19:24:00Z",
        "private": False, "archived": False, "fork": False}
README = ("# API Anything\n\n[![CI](https://x/badge.svg)](https://x)\n\n"
          "**Teach your agent a website once.** After that, it calls the [site](https://x) like an API.\n"
          "<picture><img src=x></picture>\n```sh\nnpm i\n```\nSecond line.\n")
PROFILE = {"data": {"repositoryOwner": {"login": "calebnewtonusc", "__typename": "User", "name": "Caleb Newton",
                                        "pinnedItems": {"nodes": [
                                            {"nameWithOwner": "calebnewtonusc/apply-kit", "description": "Apply",
                                             "stargazerCount": 0, "pushedAt": "2026-09-16T23:56:54Z",
                                             "licenseInfo": {"spdxId": "MIT"}},
                                            {"nameWithOwner": "calebnewtonusc/Achievement-Farm",
                                             "description": None, "stargazerCount": 2,
                                             "pushedAt": "2026-04-04T06:07:08Z", "licenseInfo": None}]}}}}


def fake_run(calls):
    def run(argv, timeout):
        calls.append(argv)
        joined = " ".join(argv)
        if argv[:3] == ["gh", "api", "graphql"]:
            return 0, json.dumps(PROFILE), ""
        if joined.endswith("/readme"):
            return 0, README, ""
        if argv[:2] == ["gh", "api"] and "missing/none" in joined:
            return 1, "", "gh: Not Found (HTTP 404)"
        if argv[:2] == ["gh", "api"]:
            return 0, json.dumps(META), ""
        if argv[:3] == ["gh", "repo", "clone"]:
            Path(argv[4]).mkdir(parents=True)
            return 0, "", ""
        return 1, "", "unexpected"
    return run


def test_parse():
    takes = [
        ("show me goodnight000/api-anything", "repo", "goodnight000", "api-anything"),
        ("Show me calebnewtonusc/Chewbacca.", "repo", "calebnewtonusc", "Chewbacca"),
        ("https://github.com/goodnight000/api-anything.git", "repo", "goodnight000", "api-anything"),
        ("pull up the repo goodnight000/api-anything", "repo", "goodnight000", "api-anything"),
        ("show me goodnight000 slash api-anything", "repo", "goodnight000", "api-anything"),
        ("https://github.com/calebnewtonusc", "profile", "calebnewtonusc", ""),
        ("show me github.com/calebnewtonusc/", "profile", "calebnewtonusc", ""),
        ("show me calebnewtonusc on github", "profile", "calebnewtonusc", ""),
        ("close the repo card", "close", "", ""),
    ]
    for said, kind, owner, repo in takes:
        got = rc.parse(said)
        check(f"takes {said!r}", got is not None and (got.kind, got.owner, got.repo) == (kind, owner, repo), got)
    refuses = ["https://github.com/settings", "https://github.com/x/y/issues/12", "show me 2/3",
               "summarize the README of github.com/x/y and compare it", "show me my day", "show me Karthik",
               "close it"]
    for said in refuses:
        check(f"leaves {said!r} alone", rc.parse(said) is None, rc.parse(said))
    check("'close it' closes only while a card is up", rc.parse("close it", card_open=True) == rc.Ask("close"))


def test_readme_and_buckets():
    text = rc.readme_lines(README, "api-anything")
    check("README drops badges, html, fences and the title that repeats the name",
          text == "Teach your agent a website once. After that, it calls the site like an API. Second line.", text)
    check("a heading run into prose gets a stop", rc.readme_lines("# Start here\nThen go.") == "Start here. Then go.")
    check("MIT is remixable", rc.license_bucket("nobody/x", "MIT")[0] == "remixable")
    check("GPL is copyleft", rc.license_bucket("nobody/x", "GPL-3.0")[0] == "copyleft")
    check("MPL carries a caveat", rc.license_bucket("nobody/x", "MPL-2.0")[0] == "caveat")
    check("no license is none", rc.license_bucket("nobody/x", None)[0] == "none")
    check("NOASSERTION is none", rc.license_bucket("nobody/x", "NOASSERTION")[0] == "none")


def test_card_lines():
    calls = []
    card = rc.fetch_repo("goodnight000", "api-anything", fake_run(calls), NOW)
    check("repo and README are two gh calls", len(calls) == 2, calls)
    check("every gh call is gh api", all(c[:2] == ["gh", "api"] for c in calls), calls)
    lines = rc.card_lines(card, "Clone to ~/code")
    check("a newline in a description cannot forge a line", not any(l.startswith("d /evil") for l in lines), lines)
    check("author text travels only in d lines",
          not any("Turn any website" in l for l in lines if not l.startswith("d ")))
    check("stars, license and push are drawn",
          'd /repo-card/stars "340"' in lines and 'd /repo-card/license "MIT"' in lines
          and 'd /repo-card/pushed "36m ago"' in lines, lines)
    check("one primary action", sum(" Button " in l for l in lines) == 1)
    check("the root is named", "r repo-card-s" in lines)
    bad = rc.fetch_repo("missing", "none", fake_run([]), NOW)
    check("a missing repo says so on the card", "no repo by that name" in bad["error"], bad)
    check("an error card is still a card", 'r repo-card-s' in rc.card_lines(bad))
    prof = rc.fetch_profile("calebnewtonusc", fake_run([]), NOW)
    check("profile lists pinned repos", [p["id"] for p in prof["pinned"]]
          == ["calebnewtonusc/apply-kit", "calebnewtonusc/Achievement-Farm"], prof)
    plines = rc.card_lines(prof)
    check("pinned rows carry a Show press", any("action=\"repo-show\"" in l for l in plines), plines)


def test_board():
    with tempfile.TemporaryDirectory() as d:
        root = Path(d) / "code"
        (root / "group" / "chew" / ".git").mkdir(parents=True)
        (root / "group" / "chew" / ".git" / "config").write_text(
            '[remote "origin"]\n\turl = https://github.com/calebnewtonusc/Chewbacca.git\n')
        check("a local checkout is found by its remote, two levels down",
              rc.local_path("calebnewtonusc/chewbacca", root) == root / "group" / "chew")
        check("a folder of the same name is not the repo", rc.local_path("someone/chew", root) is None)

        sent: list[str] = []
        calls: list = []
        board = rc.Board(run=fake_run(calls), env={"KYBER_CODE_ROOT": str(root)}, now=lambda: NOW)
        out = board.answer(rc.parse("show me goodnight000/api-anything"), sent.append)
        check("the card says what it is", out.ok and "340 stars" in out.line, out)
        check("loading is drawn before the data", sent.index('d /repo-card/note "Loading\\u2026"')
              < next(i for i, l in enumerate(sent) if l.startswith("d /repo-card/stars")), sent)
        check("not local: the action is a clone", any('label="Clone to ~/code"' in l for l in sent))
        check("drawing never clones", not any(c[:3] == ["gh", "repo", "clone"] for c in calls), calls)

        check("owns its button, rows and X, nothing else",
              rc.Board.owns("repo-go", "repo-card-go") and rc.Board.owns("action", "repo-show")
              and rc.Board.owns("closed", "repo-card") and not rc.Board.owns("closed", "messages")
              and not rc.Board.owns("ks-drill", "oss-table"))

        sent.clear()
        out = board.event('e repo-go repo-card-go surface="repo-card"', sent.append)
        clone = [c for c in calls if c[:3] == ["gh", "repo", "clone"]]
        check("the press clones once, into ~/code/<name>",
              len(clone) == 1 and clone[0][3:5] == ["goodnight000/api-anything", str(root / "api-anything")], clone)
        check("then opens it in the tree", "files " + json.dumps(str(root / "api-anything")) in sent, sent)
        check("and says it", out.ok and "Cloned" in out.line, out)

        board2 = rc.Board(run=fake_run([]), env={"KYBER_CODE_ROOT": str(root)}, now=lambda: NOW)
        board2.answer(rc.Ask("repo", "goodnight000", "api-anything"), lambda _l: None)
        board2.local = None  # pretend the remote did not match: a stranger's folder of that name
        (root / "api-anything" / ".git").mkdir(parents=True, exist_ok=True)
        out = board2.event('e repo-go repo-card-go surface="repo-card"', lambda _l: None)
        check("never clones over a folder that exists", not out.ok and "Nothing was cloned" in out.line, out)

        sent.clear()
        board.answer(rc.Ask("profile", "calebnewtonusc"), sent.append)
        out = board.event('e action repo-show row="evil/other" surface="repo-card"', sent.append)
        check("a row press for a repo not on the card is refused", not out.ok, out)
        out = board.event('e action repo-show row="calebnewtonusc/apply-kit" surface="repo-card"', sent.append)
        check("a pinned row draws that repo's card", out.ok, out)
        # The fake answers every repo call with api-anything; clear the
        # stranger's folder from the check above so this press can clone.
        import shutil  # noqa: PLC0415
        shutil.rmtree(root / "api-anything")
        out = board.event('e repo-go repo-card-go surface="repo-card"', sent.append)
        check("after the hop, Go acts on the repo now shown", out.ok, out)

        sent.clear()
        out = board.event('e closed repo-card surface="repo-card"', sent.append)
        check("the X forgets the card", out.ok and not board.is_open())
        out = board.event('e repo-go repo-card-go surface="repo-card"', sent.append)
        check("a press after close does nothing", not out.ok and not sent, (out, sent))
        board.answer(rc.Ask("profile", "calebnewtonusc"), lambda _l: None)
        out = board.answer(rc.parse("close it", card_open=True), sent.append)
        check("voice close takes the surface down", out.ok and sent[-1] == "- repo-card", sent)


FAKE_GH = r'''#!/usr/bin/env python3
import json, os, sys
a = sys.argv[1:]
log = os.environ["FAKE_GH_LOG"]
with open(log, "a") as f:
    f.write(json.dumps(a) + "\n")
meta = {"full_name": "goodnight000/api-anything", "name": "api-anything",
        "description": "Turn any website into an API your agent can call.", "stargazers_count": 340,
        "license": {"spdx_id": "MIT"}, "pushed_at": "2026-10-09T19:24:00Z"}
if a[:1] == ["repo"] and a[1] == "clone":
    os.makedirs(a[3]); sys.exit(0)
if a and a[-1].endswith("/readme"):
    print("# API Anything\n\nTeach your agent a website once.")
    sys.exit(0)
print(json.dumps(meta))
'''


def test_end_to_end():
    """The real hud-listen, a fake display, a fake gh. `h "show me ..."`
    draws the card with no model turn; Go clones only on the press and opens
    the tree; the X is not asked of the model."""
    import test_hud_listen as thl  # noqa: PLC0415

    directory = tempfile.mkdtemp()
    path = os.path.join(directory, "hud.sock")
    bindir = Path(directory) / "bin"
    bindir.mkdir()
    (bindir / "gh").write_text(FAKE_GH)
    (bindir / "gh").chmod(0o755)
    code_root = Path(directory) / "code"
    code_root.mkdir()
    gh_log = Path(directory) / "gh.log"
    model_marker = Path(directory) / "model-ran"
    fake_model = Path(directory) / "fake-model"
    fake_model.write_text(f"#!/bin/sh\ncat > /dev/null\ntouch {model_marker}\necho ok\n")
    fake_model.chmod(0o755)

    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(path)
    server.listen(1)
    received: list[str] = []

    def serve():
        conn, _ = server.accept()
        conn.settimeout(1)
        buffer = b""
        sent_h = sent_go = sent_x = False
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            try:
                chunk = conn.recv(65536)
                if not chunk:
                    break
                buffer += chunk
                while b"\n" in buffer:
                    line, buffer = buffer.split(b"\n", 1)
                    received.append(line.decode())
            except socket.timeout:
                pass
            if not sent_h and any(l.startswith("p ") for l in received):
                conn.sendall(b'h "show me goodnight000/api-anything" via=typed\n')
                sent_h = True
            elif sent_h and not sent_go and any(l.startswith("d /repo-card/stars") for l in received):
                conn.sendall(b'e repo-go repo-card-go surface="repo-card"\n')
                sent_go = True
            elif sent_go and not sent_x and any(l.startswith("files ") for l in received):
                conn.sendall(b'e closed repo-card surface="repo-card"\n')
                sent_x = True
                time.sleep(1.5)
                break
        conn.close()

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()
    env = thl.listener_env(directory, path)
    env.update(PATH=f"{bindir}:{env.get('PATH', '')}", KYBER_CODE_ROOT=str(code_root), FAKE_GH_LOG=str(gh_log))
    started = time.monotonic()
    process = subprocess.Popen([sys.executable, env["HUD_TEST_ENTRY"], "--model-cmd", str(fake_model)],
                               env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    thread.join(35)
    process.terminate()
    process.wait(timeout=10)
    server.close()
    wall = time.monotonic() - started

    calls = [json.loads(l) for l in gh_log.read_text().splitlines()] if gh_log.exists() else []
    print(f"     e2e: {len(received)} lines from hud-listen in {wall:.1f}s; gh calls {calls}")
    for line in received:
        if line.startswith(("@ repo-card", "d /repo-card", "files ", "s ")):
            print("       " + line)
    check("e2e: the card surface is drawn", "@ repo-card at=right w=440" in received, received)
    check("e2e: with the repo's stars", 'd /repo-card/stars "340"' in received, received)
    check("e2e: the one-line answer is on the pill", 's "api-anything: 340 stars, MIT, remixable."' in received,
          received)
    check("e2e: drawing alone ran only gh api", calls[:2] and all(c[0] == "api" for c in calls[:2]), calls)
    check("e2e: the press cloned into the code root",
          any(c[:2] == ["repo", "clone"] and c[3] == str(code_root / "api-anything") for c in calls), calls)
    check("e2e: then pointed the tree at it", "files " + json.dumps(str(code_root / "api-anything")) in received,
          received)
    check("e2e: no model turn for the ask, the press or the X", not model_marker.exists())


def main() -> int:
    test_parse()
    test_readme_and_buckets()
    test_card_lines()
    test_board()
    test_end_to_end()
    print(f"\n{'FAILED' if failed else 'passed'}: {failed} failure(s)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
