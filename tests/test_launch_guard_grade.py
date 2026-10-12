"""The send path and the shell guard, after the 2026-10-10 redesign.

1. `chewbacca clay` never sends a campaign START (launch or resume): with or
   without a grade receipt, with or without a person at the terminal, as a dry
   run, and with either of its two refusals (registry, code) removed. Starting
   is a click Caleb makes in Clay after he runs gtme-grade.
2. add-leads, the one write that changes who a live campaign emails, is refused
   in code after the person approves unless `gtme-grade --verify` passes for
   add-leads on that campaign and the audience is its own base segment. These
   cases call bin/chewbacca-clay directly, so they hold with the hook bypassed.
3. launch-guard.sh is an allowlist: a Bash command that mentions Clay runs only
   if it is a known command with no shell syntax (the kit's front door, reads,
   git, local inspect tools, test runners, the kit's own checks). Every bypass
   shape from three security reviews is refused.
4. A browser or screen click on a Clay page is refused.

Hermetic: fixture mode for chewbacca clay, synthetic ids, temp HOME and key.
Run: python3 tests/test_launch_guard_grade.py
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOOK = os.path.join(ROOT, ".claude", "hooks", "launch-guard.sh")
CLAY = os.path.join(ROOT, "bin", "chewbacca-clay")
TOOLS = os.path.join(ROOT, "tools")
WS = "1372623"
SENT = {"ok": True, "class": "ok", "tier": 1, "ms": 200, "data": {"ok": True}}
results = []


def check(name, cond, detail=""):
    results.append(bool(cond))
    print(f"{'ok  ' if cond else 'FAIL'} {name}" + ("" if cond else f"\n    {str(detail)[:600]}"))


MAKE = r"""
import json, sys
sys.path.insert(0, sys.argv[1])
import gtme_grade as G
spec = json.loads(sys.argv[2])
class Passed:
    n = 1
    passed = True
G.write_receipt(spec["ws"], spec["cid"], spec["action"], {"name": "t", "raw": json.load(open(spec["state"]))},
                [Passed()], spec["inputs"])
"""


class Env:
    def __init__(self):
        self.home = os.path.realpath(tempfile.mkdtemp())
        self.state = os.path.join(self.home, ".chewbacca", "state")
        os.makedirs(self.state)
        self.grade_fx = os.path.join(self.home, "clay-state")
        os.makedirs(self.grade_fx)
        self.clay_fx = os.path.join(self.home, "clay-fx")
        os.makedirs(os.path.join(self.clay_fx, "api-anything"))
        os.makedirs(os.path.join(self.clay_fx, "cli"))
        self.inputs = os.path.join(self.home, "leads.csv")
        with open(self.inputs, "w") as fh:
            fh.write("email\nann@fund.example.test\n")
        self.env = dict(os.environ, HOME=self.home,
                        GTME_GRADE_KEY_FILE=os.path.join(self.home, "keys", "gtme-grade.key"),
                        GTME_GRADE_CLAY_FIXTURE_DIR=self.grade_fx, CHEWBACCA_ROOT=ROOT,
                        CHEWBACCA_CLAY_FIXTURES=self.clay_fx, CLAY_WORKSPACE_ID=WS,
                        API_ANYTHING_HOME=os.path.join(self.home, "engine"),
                        CHEWBACCA_CLAY_MEASURED=os.path.join(self.home, "measured.json"),
                        GTM_CONFIG=os.path.join(self.home, "no-clients.json"))
        self.env.pop("CHEWBACCA_NO_SEND", None)
        with open(self.env["CHEWBACCA_CLAY_MEASURED"], "w") as fh:
            fh.write("{}")

    def presend(self):
        lst = os.path.join(self.home, "list.csv")
        with open(lst, "w") as fh:
            fh.write("email\n")
        with open(os.path.join(self.state, "send-gate-receipt.json"), "w") as fh:
            json.dump({"time": int(time.time()), "full": True,
                       "hashes": {lst: hashlib.sha256(b"email\n").hexdigest()}}, fh)

    def campaign(self, cid, status="draft", segment="audseg_one"):
        with open(os.path.join(self.grade_fx, f"{cid}.json"), "w") as fh:
            json.dump({"id": cid, "status": status, "leadBaseSegmentId": segment,
                       "sequence": [{"body": "hello"}], "settings": {"senderAccountIds": ["s1"]}}, fh)

    def grade(self, cid, action, status="draft", segment="audseg_one"):
        self.campaign(cid, status, segment)
        spec = {"ws": WS, "cid": cid, "action": action, "inputs": [self.inputs],
                "state": os.path.join(self.grade_fx, f"{cid}.json")}
        subprocess.run([sys.executable, "-c", MAKE, TOOLS, json.dumps(spec)], env=self.env, check=True, timeout=30)

    def clay(self, *args, answer=None):
        env = dict(self.env)
        if answer:
            env["CHEWBACCA_CLAY_TTY_ANSWER"] = answer
        p = subprocess.run(["node", CLAY, *args], capture_output=True, text=True, env=env, timeout=90)
        try:
            return p.returncode, json.loads(p.stdout)
        except ValueError:
            return p.returncode, {"raw": p.stdout + p.stderr}

    def hook(self, tool, tool_input, raw=None, path=None, last_url=None):
        if last_url:
            with open(os.path.join(self.state, "launch-guard-last-url"), "w") as fh:
                fh.write(last_url)
        env = dict(self.env)
        if path is not None:
            env["PATH"] = path
        payload = raw if raw is not None else json.dumps({"tool_name": tool, "tool_input": tool_input,
                                                          "cwd": ROOT})
        p = subprocess.run(["/bin/bash", HOOK], input=payload, capture_output=True, text=True, env=env, timeout=30)
        return p.returncode, p.stderr


# 1. A campaign START is never sent from here.

START = ["campaign-status", "campaign=cam_alpha", "status=START"]


def sends(code, out):
    return code == 0 and out.get("ok") is True


def refused(code, out, needle):
    return code != 0 and out.get("ok") is False and needle.lower() in json.dumps(out).lower()


# Since 2026-10-12 the agent sends a START itself (Caleb: "Never tell anyone to
# press anything in clay themselves"), but only to a draft, only with a passing
# launch grade and pre-send gate, and only with a person's ok.
for graded in (False, True):
    for person in (False, True):
        e = Env()
        e.presend()
        e.campaign("cam_alpha")
        if graded:
            e.grade("cam_alpha", "launch")
        open(os.path.join(e.clay_fx, "api-anything", "setCampaignStatus.json"), "w").write(json.dumps(SENT))
        code, out = e.clay(*START, "--allow-writes", answer="campaign-status" if person else None)
        name = (f"START {'sent' if graded and person else 'refused'} ({'with' if graded else 'without'} a receipt, "
                f"{'with' if person else 'without'} a person's ok)")
        if graded and person:
            check(name, sends(code, out), out)
        elif not person:
            check(name, refused(code, out, "did not approve"), out)
        else:
            check(name, refused(code, out, "no passing grade"), out)
# A resume grade never covers a START, and a START never reaches a paused campaign.
e = Env()
e.presend()
e.grade("cam_alpha", "resume", status="paused")
open(os.path.join(e.clay_fx, "api-anything", "setCampaignStatus.json"), "w").write(json.dumps(SENT))
e.env["CHEWBACCA_CLAY_TEST_CAMPAIGN_STATUS"] = "paused"
code, out = e.clay(*START, "--allow-writes", answer="campaign-status")
check("START refused on a paused campaign (that would be a resume)", refused(code, out, "never a resume"), out)
# A lying status read (a doctored `clay` on PATH says draft) still can't resume:
# the grade's own scrubbed read sees the campaign is paused (review of 0e45ca41).
e = Env()
e.presend()
e.grade("cam_alpha", "launch")
e.campaign("cam_alpha", status="paused")
open(os.path.join(e.clay_fx, "api-anything", "setCampaignStatus.json"), "w").write(json.dumps(SENT))
e.env["CHEWBACCA_CLAY_TEST_CAMPAIGN_STATUS"] = "draft"
code, out = e.clay(*START, "--allow-writes", answer="campaign-status")
check("START refused when only the front door's status read says draft", refused(code, out, "never a resume"), out)
# Spellings Clay was never meant to get, and a grade for another workspace.
for bad in ("status=start", "status= START", "status=Start"):
    e = Env()
    e.presend()
    e.grade("cam_alpha", "launch")
    code, out = e.clay("campaign-status", "campaign=cam_alpha", bad, "--allow-writes", answer="campaign-status")
    check(f"START spelled {bad!r} refused", code != 0 and out.get("ok") is False, out)
e = Env()
e.presend()
e.grade("cam_alpha", "launch")
open(os.path.join(e.clay_fx, "api-anything", "setCampaignStatus.json"), "w").write(json.dumps(SENT))
code, out = e.clay("campaign-status", "ws=9999999", "campaign=cam_alpha", "status=START", "--allow-writes",
                   answer="campaign-status")
check("a launch grade on one workspace does not start the campaign in another", code != 0 and out.get("ok") is False, out)
# A no-lines pre-send pass covers a launch, never add-leads.
e = Env()
e.presend()
r = json.load(open(os.path.join(e.state, "send-gate-receipt.json")))
r.pop("full")
r["full_but_lines"] = True
json.dump(r, open(os.path.join(e.state, "send-gate-receipt.json"), "w"))
e.grade("cam_alpha", "add-leads")
v = subprocess.run([sys.executable, os.path.join(TOOLS, "gtme_grade.py"), "--verify", "--ws", WS, "--campaign", "cam_alpha",
                    "--action", "add-leads", "--audience", "audseg_one"], capture_output=True, text=True, env=e.env, timeout=60)
check("a no-lines pre-send pass does not cover add-leads", v.returncode != 0 and "skipped a check" in v.stderr, v.stderr)
e.grade("cam_alpha", "launch")
v = subprocess.run([sys.executable, os.path.join(TOOLS, "gtme_grade.py"), "--verify", "--ws", WS, "--campaign", "cam_alpha",
                    "--action", "launch"], capture_output=True, text=True, env=e.env, timeout=60)
check("a no-lines pre-send pass covers a launch of a draft", v.returncode == 0, v.stderr)
# No pre-send gate receipt: the launch grade alone is not enough.
e = Env()
e.grade("cam_alpha", "launch")
open(os.path.join(e.clay_fx, "api-anything", "setCampaignStatus.json"), "w").write(json.dumps(SENT))
code, out = e.clay(*START, "--allow-writes", answer="campaign-status")
check("START refused without a pre-send gate receipt", refused(code, out, "pre-send gate"), out)
e = Env()
code, out = e.clay(*START, "--dry-run")
check("a START dry run shows the request and sends nothing", code == 0 and out.get("sent") is False, out)
check("the repo spec allows START, PAUSED or STOPPED",
      '"pattern": "START|PAUSED|STOPPED"' in open(os.path.join(ROOT, "library", "clay-api", "clay.json")).read())

e = Env()
open(os.path.join(e.clay_fx, "api-anything", "setCampaignStatus.json"), "w").write(json.dumps(SENT))
code, out = e.clay("campaign-status", "campaign=cam_alpha", "status=PAUSED", "--allow-writes", answer="campaign-status")
check("PAUSED still sends with a person's approval (stopping mail needs no grade)", sends(code, out), out)

# 2. add-leads is checked against a grade in code.

ADD = ["add-leads", "audience=audseg_one", 'filter={"type":"GroupOp","combinationMode":"And","items":[]}', "--allow-writes"]
e = Env()
e.presend()
code, out = e.clay(*ADD, answer="add-leads")
check("add-leads without campaign= is refused in code", refused(code, out, "campaign=cam_"), out)

e = Env()
e.presend()
e.grade("cam_alpha", "add-leads")
open(os.path.join(e.clay_fx, "cli", "add-leads.json"), "w").write(json.dumps({"exit": 0, "stdout": "{}", "stderr": ""}))
code, out = e.clay(*ADD, "campaign=cam_alpha", answer="add-leads")
check("add-leads on the graded campaign's own segment sends", sends(code, out), out)

e = Env()
e.presend()
e.grade("cam_alpha", "add-leads", segment="audseg_other")
code, out = e.clay(*ADD, "campaign=cam_alpha", answer="add-leads")
check("add-leads on an audience that is not that campaign's segment is refused",
      refused(code, out, "not campaign cam_alpha's base segment"), out)

e = Env()
e.presend()
e.grade("cam_alpha", "launch")
code, out = e.clay(*ADD, "campaign=cam_alpha", answer="add-leads")
check("a launch grade does not unlock add-leads", refused(code, out, "no gtme-grade pass for add-leads"), out)

# 3. The shell allowlist.

KIT = ROOT
ALLOWED = [
    # reads and the gated front door, in every spelling of its path
    "chewbacca clay campaigns",
    "chewbacca clay campaign campaign=cam_x",
    "chewbacca clay campaign-variants ws=1372623 campaign=cam_x --surface api-anything",
    "chewbacca clay ops",
    "chewbacca clay campaign-status campaign=cam_x status=PAUSED --allow-writes",
    "chewbacca clay route campaign-status",
    "chewbacca gtm funnel --client Zeutara",
    "gtme-grade --campaign cam_x --action launch --leads leads.csv",
    "bin/chewbacca-clay --help",
    "node bin/chewbacca-clay ops",
    f"{KIT}/bin/chewbacca-clay ops",
    "bash bin/chewbacca clay ops",
    "clay campaigns list",
    "clay campaigns analytics cam_x",
    "clay whoami",
    # git, local inspect tools
    "git add bin/chewbacca-clay",
    "git commit -F msg.txt -- library/clay-api/registry.json",
    "git log --oneline -- bin/chewbacca-clay",
    "git -C library/clay-api status",
    "grep -n campaign tools/gtme_grade.py",
    "rg clay",
    "ls library/clay-api",
    "cat library/clay-api/registry.json",
    "head -20 bin/chewbacca-clay",
    "tail -5 bin/chewbacca-clay",
    "sed -n 1,40p bin/clay-inbox",
    "wc -l bin/chewbacca-clay",
    "diff library/clay-api/registry.json library/clay-api/registry.json",
    "jq .ops library/clay-api/registry.json",
    "python3 -m json.tool library/clay-api/registry.json",
    "file bin/chewbacca-clay",
    "stat bin/chewbacca-clay",
    'find library/clay-api -name "*.json"',
    # test runners and the kit's checks
    "python3 tests/test_chewbacca_clay.py",
    "CHEWBACCA_NO_SEND=1 python3 tests/test_chewbacca_clay.py",
    "bash tests/run.sh gtme",
    'bash tests/run.sh "chewbacca CLI"',
    "bash tests/clay_native_guard.sh",
    "pytest tests/test_chewbacca_clay.py -q",
    "python3 tools/counts.py --check",
    "python3 tools/checksums.py",
    "code-slop --issues",
    "slop-check library/clay-api --issues",
    "echo nothing to do with it",
    # reads chained or piped with other reads (2026-10-11)
    "grep -n campaign tools/gtme_grade.py | head -5",
    "git status --short && git log --oneline -1 -- bin/chewbacca-clay",
    "grep -c clay bin/chewbacca-clay 2>/dev/null",
    "chewbacca clay ops | jq .ok; ls library/clay-api",
]
REFUSED = [
    ("a campaign START through the front door", "chewbacca clay campaign-status campaign=cam_x status=START --allow-writes | cat"),
    ("quoted command name", '"chewbacca" clay campaigns'),
    ("split quoting", 'ch""ewbacca clay campaigns'),
    ("ANSI-C quoting", "$'\\x63lay' campaigns update cam_x --status active"),
    ("backslash in the name", "c\\lay campaigns update cam_x --status active"),
    ("eval", "eval clay campaigns update cam_x --status active"),
    ("xargs", "echo cam_x | xargs clay campaigns update --status active"),
    ("an alias", "alias c=clay; c campaigns update cam_x --status active"),
    ("IFS trick", "IFS=,; clay${IFS}campaigns,update,cam_x"),
    ("newline-separated commands", "clay campaigns list\nclay campaigns update cam_x --status active"),
    ("env", "env clay campaigns update cam_x --status active"),
    ("env prefix", "X=1 chewbacca clay campaigns"),
    ("env prefix on a test", "FOO=1 python3 tests/test_chewbacca_clay.py"),
    ("CHEWBACCA_NO_SEND in front of curl", "CHEWBACCA_NO_SEND=1 curl https://api.clay.com/v3"),
    ("command", "command clay campaigns list"),
    ("exec", "exec clay campaigns list"),
    ("absolute path to clay", "/usr/local/bin/clay campaigns list"),
    ("a fake front door outside the kit", "/tmp/fake/bin/chewbacca-clay ops"),
    ("bash -c wrapper", "bash -c 'chewbacca clay campaigns'"),
    ("a test path escaping tests/", "python3 tests/../evil_clay.py"),
    ("python with requests", "python3 -c \"import requests; requests.patch('https://api.clay.com/v3/x')\""),
    ("curl", "curl -X PATCH https://api.clay.com/v3/workspaces/1/clay-sequencer/campaigns/cam_x/status"),
    ("wget", "wget https://api.clay.com/v3/workspaces/1"),
    ("node -e", "node -e \"fetch('https://api.clay.com/v3')\""),
    ("osascript", "osascript -e 'open location \"https://app.clay.com\"'"),
    ("the clay CLI writing", "clay campaigns update cam_x --status active"),
    ("the clay CLI changing an audience", "clay audiences update seg_x --filter x"),
    ("uppercase name", "CLAY campaigns update cam_x"),
    ("chewie click on a campaign", 'chewie web click "Launch campaign"'),
    ("a redirect", "chewbacca clay campaigns > out.json"),
    ("command substitution", "chewbacca clay campaign campaign=$(cat id)"),
    ("git config alias", "git config alias.c '!clay campaigns update cam_x'"),
    ("git -c", "git -c core.pager=clay log"),
    ("git rebase --exec", "git rebase --exec 'clay campaigns update cam_x' main"),
    ("rg --pre", "rg --pre clay campaign ."),
    ("find -delete", "find library/clay-api -delete"),
    ("find -exec", "find library/clay-api -exec rm x"),
    ("sed that writes", "sed -n 'w out' bin/clay-inbox"),
    ("forging a grade receipt", "echo x > ~/.chewbacca/state/gtme-grade/1372623-cam_x-launch.json"),
    ("reading the grade key", "cat ~/Library/Application\\ Support/chewbacca/gtme-grade.key"),
    # compound commands: every piece must be a known read on its own
    ("a read piped into a shell", "grep clay bin/clay-inbox | sh"),
    ("a read chained to curl", "chewbacca clay campaigns && curl https://api.clay.com/v3"),
    ("cd into a fake kit", "cd /tmp/fake && bin/chewbacca-clay ops"),
    ("a write inside a pipeline", "grep x y | chewbacca clay campaign-status campaign=cam_x status=PAUSED --allow-writes"),
    ("a background job", "grep clay x & curl https://api.clay.com/v3"),
    ("a redirect to a file in a chain", "chewbacca clay campaigns > out.json; ls"),
    ("python in a chain", "ls && python3 -c \"print('clay')\""),
]
e = Env()
for cmd in ALLOWED:
    code, err = e.hook("Bash", {"command": cmd})
    check(f"allowed: {cmd}", code == 0, err)
for name, cmd in REFUSED:
    code, err = e.hook("Bash", {"command": cmd})
    check(f"refused: {name}", code == 2, err)


def bin_without(*missing):
    d = tempfile.mkdtemp()
    for t in ("bash", "jq", "grep", "tr", "cat", "sed", "sort", "wc", "date", "awk", "shasum", "dirname",
              "head", "mkdir", "basename", "python3", "perl", "env", "printf", "ls", "sleep", "pgrep", "tail", "mv"):
        if t not in missing and shutil.which(t):
            os.symlink(shutil.which(t), os.path.join(d, t))
    return d


code, err = e.hook("Bash", {"command": "chewbacca clay campaigns"}, path=bin_without("jq"))
check("jq missing refuses a command that mentions Clay", code == 2 and "jq is missing" in err, err)
code, err = e.hook("Bash", {"command": "chewbacca clay campaigns"}, path=bin_without("python3"))
check("python3 missing refuses a command that mentions Clay", code == 2 and "python3 is missing" in err, err)
code, err = e.hook("Bash", None, raw="clay campaigns update cam_x {{{")
check("an unparsable payload that mentions Clay refuses", code == 2 and "not JSON" in err, err)
code, err = e.hook("Bash", {"command": "chewbacca clay campaign campaign=cam_x", "description": "x"})
check("a read with a description beside it still runs", code == 0, err)

# 4. Clicks.

code, err = e.hook("mcp__chrome-devtools__click", {"uid": "1"},
                   last_url="https://app.clay.com/workspaces/1372623/campaigns/cam_x")
check("a browser click on a Clay page refuses", code == 2, err)
code, err = e.hook("mcp__peekaboo__click", {"query": "Launch"})
check("a labeled screen click refuses", code == 2, err)
code, err = e.hook("mcp__chrome-devtools__navigate_page", {"url": "https://app.clay.com/x"})
check("navigating to Clay is allowed", code == 0, err)

print(f"\n{sum(results)}/{len(results)} passed")
raise SystemExit(0 if all(results) else 1)
