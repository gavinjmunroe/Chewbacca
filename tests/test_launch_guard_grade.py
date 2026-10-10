"""The send path and the shell guard, after the 2026-10-10 redesign.

1. `chewbacca clay` refuses a campaign START or add-leads, in code and after a
   person approves, unless `gtme-grade --verify` passes for that request's own
   workspace, campaign and action (and a full pre-send receipt exists). These
   cases call bin/chewbacca-clay directly, so they hold with the hook bypassed.
2. launch-guard.sh is an allowlist: a Bash command that mentions Clay runs only
   if it is exactly a known read with no shell syntax. Every bypass shape from
   three security reviews is refused here.
3. A browser or screen click on a Clay page is refused.

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
        payload = raw if raw is not None else json.dumps({"tool_name": tool, "tool_input": tool_input})
        p = subprocess.run(["/bin/bash", HOOK], input=payload, capture_output=True, text=True, env=env, timeout=30)
        return p.returncode, p.stderr


# 1. The send path checks the grade in code.

START = ["campaign-status", "campaign=cam_alpha", "status=START", "--allow-writes"]


def sends(code, out):
    return code == 0 and out.get("ok") is True


def refused(code, out, needle):
    return code != 0 and out.get("ok") is False and needle.lower() in json.dumps(out).lower()


e = Env()
e.presend()
e.campaign("cam_alpha")
code, out = e.clay(*START, answer="campaign-status")
check("START with a person's approval but no grade is refused in code", refused(code, out, "no passing grade"), out)

e = Env()
e.presend()
e.grade("cam_alpha", "launch")
open(os.path.join(e.clay_fx, "api-anything", "setCampaignStatus.json"), "w").write(json.dumps(SENT))
code, out = e.clay(*START, answer="campaign-status")
check("START of a graded draft sends after the person approves", sends(code, out), out)
code, out = e.clay(*START)
check("a graded START still needs the person", refused(code, out, "did not approve"), out)

e = Env()
e.presend()
e.grade("cam_alpha", "launch", status="paused")
code, out = e.clay(*START, answer="campaign-status")
check("a launch grade does not unlock resuming a paused campaign", refused(code, out, "resume on cam_alpha"), out)

e = Env()
e.presend()
e.grade("cam_beta", "launch")
e.campaign("cam_alpha")
code, out = e.clay(*START, answer="campaign-status")
check("another campaign's grade does not unlock this one", refused(code, out, "no gtme-grade pass"), out)

e = Env()
e.grade("cam_alpha", "launch")
code, out = e.clay(*START, answer="campaign-status")
check("a grade without the pre-send gate is refused", refused(code, out, "pre-send gate receipt"), out)

e = Env()
e.presend()
e.grade("cam_alpha", "launch", status="active")
code, out = e.clay(*START, answer="campaign-status")
check("START on a campaign that is already active is refused", refused(code, out, "not a draft or paused"), out)

e = Env()
open(os.path.join(e.clay_fx, "api-anything", "setCampaignStatus.json"), "w").write(json.dumps(SENT))
code, out = e.clay("campaign-status", "campaign=cam_alpha", "status=PAUSED", "--allow-writes", answer="campaign-status")
check("PAUSED needs no grade (stopping mail is always allowed)", sends(code, out), out)

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

# 2. The shell allowlist.

ALLOWED = [
    "chewbacca clay campaigns",
    "chewbacca clay campaign campaign=cam_x",
    "chewbacca clay campaign-variants ws=1372623 campaign=cam_x --surface api-anything",
    "chewbacca clay ops",
    "chewbacca gtm funnel --client Zeutara",
    "gtme-grade --campaign cam_x --action launch --leads leads.csv",
    "clay campaigns list",
    "clay campaigns analytics cam_x",
    "clay whoami",
    "grep -n campaign tools/gtme_grade.py",
    "git add bin/chewbacca-clay",
    "echo nothing to do with it",
]
REFUSED = [
    ("a write op", "chewbacca clay campaign-status campaign=cam_x status=START --allow-writes"),
    ("--allow-writes on a read", "chewbacca clay campaigns --allow-writes"),
    ("route to a write", "chewbacca clay route campaign-status"),
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
    ("command", "command clay campaigns list"),
    ("exec", "exec clay campaigns list"),
    ("absolute path to clay", "/usr/local/bin/clay campaigns list"),
    ("relative path", "bin/chewbacca-clay campaigns"),
    ("bash wrapper", "bash bin/chewbacca clay campaigns"),
    ("python with requests", "python3 -c \"import requests; requests.patch('https://api.clay.com/v3/x')\""),
    ("curl", "curl -X PATCH https://api.clay.com/v3/workspaces/1/clay-sequencer/campaigns/cam_x/status"),
    ("wget", "wget https://api.clay.com/v3/workspaces/1"),
    ("node", "node -e \"fetch('https://api.clay.com/v3')\""),
    ("osascript", "osascript -e 'open location \"https://app.clay.com\"'"),
    ("the clay CLI writing", "clay campaigns update cam_x --status active"),
    ("the clay CLI changing an audience", "clay audiences update seg_x --filter x"),
    ("uppercase name", "CLAY campaigns update cam_x"),
    ("chewie click on a campaign", 'chewie web click "Launch campaign"'),
    ("a redirect", "chewbacca clay campaigns > out.json"),
    ("command substitution", "chewbacca clay campaign campaign=$(cat id)"),
    ("forging a grade receipt", "echo x > ~/.chewbacca/state/gtme-grade/1372623-cam_x-launch.json"),
    ("reading the grade key", "cat ~/Library/Application\\ Support/chewbacca/gtme-grade.key"),
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

# 3. Clicks.

code, err = e.hook("mcp__chrome-devtools__click", {"uid": "1"},
                   last_url="https://app.clay.com/workspaces/1372623/campaigns/cam_x")
check("a browser click on a Clay page refuses", code == 2, err)
code, err = e.hook("mcp__peekaboo__click", {"query": "Launch"})
check("a labeled screen click refuses", code == 2, err)
code, err = e.hook("mcp__chrome-devtools__navigate_page", {"url": "https://app.clay.com/x"})
check("navigating to Clay is allowed", code == 0, err)

print(f"\n{sum(results)}/{len(results)} passed")
raise SystemExit(0 if all(results) else 1)
