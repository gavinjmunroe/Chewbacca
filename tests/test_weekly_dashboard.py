#!/usr/bin/env python3
"""bin/lib/weekly-dashboard.js: the week's numbers come from files, not guesses.

A temp repo, application tracker, people store and settings stand in for the
real ones, and WEEKLY_NOW pins the clock to Thursday 2026-10-08 so the week is
Monday 10-05 onward. What is checked is what a wrong number would hide:
  - commits are counted by git, not read off a capped list (the cap once hid
    every one of the user's own commits behind the team's 300 newest)
  - "new this week" counts rows first seen applied after tracking began, never
    the ones already applied on the first run
  - a coffee chat counts only inside the week
"""
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOL = ROOT / "bin" / "lib" / "weekly-dashboard.js"
failures = 0


def check(name, ok, detail=""):
    global failures
    print(f"  {'ok  ' if ok else 'FAIL'} {name}" + (f": {detail}" if detail and not ok else ""))
    if not ok:
        failures += 1


def git(repo, *args, when=None, who=None):
    env = dict(os.environ)
    if when:
        env["GIT_AUTHOR_DATE"] = env["GIT_COMMITTER_DATE"] = when
    name, email = who or ("Caleb", "caleb@example.com")
    env.update(GIT_AUTHOR_NAME=name, GIT_AUTHOR_EMAIL=email, GIT_COMMITTER_NAME=name, GIT_COMMITTER_EMAIL=email)
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, env=env)


def snapshot(env):
    out = subprocess.run(["node", str(TOOL), "--json"], capture_output=True, text=True, env=env)
    return json.loads(out.stdout)


def main():
    if subprocess.run(["node", "-e", "require('node:sqlite')"], capture_output=True).returncode != 0:
        print("  skip  node:sqlite needs Node 22.5 or newer")
        return 0
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        repo = tmp / "repo"
        repo.mkdir()
        git(repo, "init", "-q")
        git(repo, "commit", "-q", "--allow-empty", "-m", "last week", when="2026-09-30T12:00:00")
        for n in range(5):
            git(repo, "commit", "-q", "--allow-empty", "-m", f"team {n}", when=f"2026-10-0{6 + n % 2}T12:00:00")
        git(repo, "commit", "-q", "--allow-empty", "-m", "mine", when="2026-10-07T09:00:00", who=("Me", "me@example.com"))

        weekly = tmp / "weekly"
        weekly.mkdir()
        (weekly / "config.json").write_text(json.dumps({
            "me": ["me@example.com"], "applications_file": str(tmp / "master.json"),
        }))
        (weekly / "gmail.json").write_text(json.dumps({
            "account": "a@example.com", "week_start": "2026-10-05", "threads_sent": 4, "people_emailed": 3,
        }))
        rows = {
            "a": {"key": "a", "company": "A", "role": "x", "status": "applied", "deadline": "2026-10-20"},
            "b": {"key": "b", "company": "B", "role": "y", "status": "staged", "deadline": "2026-10-12"},
            "c": {"key": "c", "company": "C", "role": "z", "status": "new", "deadline": ""},
        }
        (tmp / "master.json").write_text(json.dumps({"rows": rows}))

        people = tmp / "people"
        people.mkdir()
        db = sqlite3.connect(people / "people.db")
        db.executescript("""
            create table people (id text primary key, name text, company text, created_at text, deleted_at text,
                                 muted_at text, next_check_at text, next_check_reason text);
            create table interactions (id text, person_id text, channel text, note text, happened_at text);
            insert into people values ('1','Jane Doe','Google','2026-10-06 18:00:00',null,null,'2026-11-01 09:00:00','catch up');
            insert into people values ('2','Old Friend','Acme','2026-01-01 00:00:00',null,null,null,null);
            insert into interactions values ('i1','1','in person','coffee','2026-10-06 18:00:00');
            insert into interactions values ('i2','2','in person','coffee','2026-09-20 18:00:00');
            insert into interactions values ('i3','2','call','call','2026-10-06 18:00:00');
        """)
        db.commit()
        db.close()

        env = dict(os.environ, WEEKLY_DIR=str(weekly), CHEWBACCA_ROOT=str(repo), PEOPLE_DIR=str(people),
                   WEEKLY_NOW="2026-10-08T12:00:00", WEEKLY_SKIP_SYSTEM="1")
        first = snapshot(env)
        check("the week starts on Monday", first["week"]["start"] == "2026-10-05", str(first["week"]))
        check("commits are counted from git, last week excluded", first["repo"]["total"] == 6, str(first["repo"]["total"]))
        check("your commits are found by email", first["repo"]["mine"] == 1 and first["repo"]["yours"][0]["subject"] == "mine", str(first["repo"]))
        check("applied and staged are counted from rows", first["applications"]["applied"] == 1 and first["applications"]["staged"] == 1, str(first["applications"]))
        check("rows already applied on the first run are not new", first["applications"]["newThisWeek"] == 0, str(first["applications"]))
        check("ready rows closing within 14 days are counted", first["applications"]["closingSoon"] == 1, str(first["applications"]))
        check("only this week's coffee chat counts", first["networking"]["coffeeChats"] == 1, str(first["networking"]))
        check("a follow-up due inside 30 days is listed", len(first["networking"]["followUps"]) == 1, str(first["networking"]))
        check("email counts carry their source and are current", first["emails"]["current"] and first["emails"]["people_emailed"] == 3, str(first["emails"]))

        rows["b"]["status"] = "applied"
        (tmp / "master.json").write_text(json.dumps({"rows": rows}))
        second = snapshot(env)
        check("a row that becomes applied after tracking is new this week", second["applications"]["newThisWeek"] == 1, str(second["applications"]))

        (weekly / "gmail.json").write_text(json.dumps({"account": "a@example.com", "week_start": "2026-09-28", "threads_sent": 9, "people_emailed": 9}))
        stale = snapshot(env)
        check("last week's email counts are marked stale", stale["emails"]["current"] is False, str(stale["emails"]))


        # The home-folder scan once walked Library and the cloud mounts and took
        # over two minutes on a real machine, freezing the server it ran in.
        fake_home = tmp / "home"
        (fake_home / "Library" / "Mobile" / "libkit").mkdir(parents=True)
        (fake_home / "Library" / "Mobile" / "libkit" / ".kit").write_text("")
        (fake_home / "dev" / "devkit").mkdir(parents=True)
        (fake_home / "dev" / "devkit" / ".kit").write_text("")
        out = subprocess.run(["node", str(ROOT / "bin" / "lib" / "chewbacca-hud.js"), "--json"], capture_output=True,
                             text=True, env=dict(env, HOME=str(fake_home)))
        kits = json.loads(out.stdout).get("kits", [])
        check("the kit scan finds kits under dev", "devkit" in kits, str(kits))
        check("the kit scan never walks Library", "libkit" not in kits, str(kits))


        # The dashboard serves private numbers on loopback. A hostile page can
        # point its own name at 127.0.0.1 and read them from the browser, and
        # whatever else holds a taken port must not be opened as the dashboard.
        import hashlib
        import hmac
        import http.client
        import socket

        def free_port():
            probe = socket.socket()
            probe.bind(("127.0.0.1", 0))
            number = probe.getsockname()[1]
            probe.close()
            return number

        hud = str(ROOT / "bin" / "lib" / "chewbacca-hud.js")
        home = tmp / "sechome"
        home.mkdir()
        senv = dict(env, HOME=str(home))

        def serve_code(number):
            return 'require("' + hud + '").serve({port:' + str(number) + ',onReady:()=>console.log("READY")})'

        port = free_port()
        server = subprocess.Popen(["node", "-e", serve_code(port)], env=senv, stdout=subprocess.PIPE, text=True)
        try:
            server.stdout.readline()

            def get(path, headers=None, host=None):
                conn = http.client.HTTPConnection("127.0.0.1", port, timeout=15)
                conn.request("GET", path, headers={"Host": host or f"localhost:{port}", **(headers or {})})
                reply = conn.getresponse()
                body = reply.read()
                conn.close()
                return reply.status, body

            check("a request naming this machine is served", get("/week")[0] == 200)
            check("a request naming another host is refused", get("/api/week", host="evil.example")[0] == 403)
            check("a cross-site fetch is refused", get("/api/state", headers={"Sec-Fetch-Site": "cross-site"})[0] == 403)
            nonce = "abcdef0123456789"
            status, body = get(f"/healthz?n={nonce}")
            token = (home / ".chewbacca" / "hud.token").read_text().strip()
            want = hmac.new(token.encode(), nonce.encode(), hashlib.sha256).hexdigest()
            check("the server proves who it is with the user's own secret", status == 200 and json.loads(body)["proof"] == want)
            check("the secret file is private to the user", oct((home / ".chewbacca" / "hud.token").stat().st_mode & 0o777) == "0o600")
            again = subprocess.run(["node", "-e", serve_code(port)], env=senv, capture_output=True, text=True, timeout=30)
            check("a second open reuses the running dashboard", again.returncode == 0 and "READY" in again.stdout, again.stderr)
        finally:
            server.terminate()
            server.wait(timeout=10)

        squatter = socket.socket()
        squatter.bind(("127.0.0.1", 0))
        squatter.listen(5)
        taken = squatter.getsockname()[1]
        stranger = subprocess.run(["node", "-e", serve_code(taken)], env=senv, capture_output=True, text=True, timeout=30)
        squatter.close()
        check("a port held by something else is not taken for the dashboard",
              stranger.returncode != 0 and "READY" not in stranger.stdout, stranger.stdout + stranger.stderr)

    print("\nall passed" if not failures else f"\n{failures} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
