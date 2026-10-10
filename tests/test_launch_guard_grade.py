"""launch-guard.sh refuses a launch, resume or add-leads without a signed, fresh
gtme-grade pass bound to that exact action, campaign, workspace and inputs.

The pre-send receipt is valid in every case unless a case says otherwise, so the
grade half decides (tests/launch-guard-test.py covers the pre-send half). Every
id, key and file is synthetic; Clay is never read: the live campaign state
comes from GTME_GRADE_CLAY_FIXTURE_DIR in the hook's own environment.
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
H = os.path.join(ROOT, ".claude", "hooks", "launch-guard.sh")
TOOLS = os.path.join(ROOT, "tools")
WS = "1372623"
NOW = int(time.time())

MAKE = r"""
import json, sys, time
sys.path.insert(0, sys.argv[1])
import gtme_grade as G
spec = json.loads(sys.argv[2])
class Passed:
    n = 1
    passed = True
camp = {"name": "t", "raw": json.load(open(spec["state"]))}
dest = G.write_receipt(spec["ws"], spec["cid"], spec["action"], camp, [Passed()], spec["inputs"])
if spec.get("age"):
    body = json.load(open(dest))
    body.pop("mac")
    body["time"] -= spec["age"]
    body["expires"] -= spec["age"]
    body["mac"] = G.sign(body, G.load_key(False))
    json.dump(body, open(dest, "w"))
if spec.get("rename_to"):
    import os
    os.replace(dest, G.receipt_file(spec["ws"], spec["rename_to"], spec["action"]))
"""


class Env:
    def __init__(self):
        # resolved: macOS temp dirs sit behind the /var -> /private/var symlink
        self.home = os.path.realpath(tempfile.mkdtemp())
        self.state = os.path.join(self.home, ".chewbacca", "state")
        os.makedirs(self.state)
        self.fixtures = os.path.join(self.home, "clay")
        os.makedirs(self.fixtures)
        self.key = os.path.join(self.home, "keys", "gtme-grade.key")
        self.inputs = os.path.join(self.home, "leads.csv")
        with open(self.inputs, "w") as fh:
            fh.write("email\nann@fund.example.test\n")
        self.env = dict(os.environ, HOME=self.home, GTME_GRADE_KEY_FILE=self.key,
                        GTME_GRADE_CLAY_FIXTURE_DIR=self.fixtures, CHEWBACCA_ROOT=ROOT)

    def presend(self):
        lst = os.path.join(self.home, "list.csv")
        with open(lst, "w") as fh:
            fh.write("email\n")
        with open(os.path.join(self.state, "send-gate-receipt.json"), "w") as fh:
            json.dump({"time": NOW, "full": True,
                       "hashes": {lst: hashlib.sha256(b"email\n").hexdigest()}}, fh)

    def campaign(self, cid, body="hello"):
        with open(os.path.join(self.fixtures, f"{cid}.json"), "w") as fh:
            json.dump({"id": cid, "status": "draft", "sequence": [{"body": body}],
                       "settings": {"senderAccountIds": ["s1"]}}, fh)

    def grade(self, cid, action, ws=WS, age=0, rename_to=None):
        self.campaign(cid)
        spec = {"ws": ws, "cid": cid, "action": action, "inputs": [self.inputs], "age": age,
                "state": os.path.join(self.fixtures, f"{cid}.json"), "rename_to": rename_to}
        subprocess.run([sys.executable, "-c", MAKE, TOOLS, json.dumps(spec)], env=self.env,
                       check=True, timeout=30)

    def run(self, tool, tool_input, last_url=None, hook=H, path=None, raw=None):
        if last_url:
            with open(os.path.join(self.state, "launch-guard-last-url"), "w") as fh:
                fh.write(last_url)
        env = dict(self.env)
        if path is not None:
            env["PATH"] = path
        payload = raw if raw is not None else json.dumps({"tool_name": tool, "tool_input": tool_input})
        p = subprocess.run(["/bin/bash", hook], input=payload, capture_output=True, text=True,
                           env=env, timeout=30)
        return p.returncode, p.stderr


def bin_without(*missing):
    """A PATH holding every tool the hook calls except the ones named."""
    d = tempfile.mkdtemp()
    for t in ("bash", "jq", "grep", "tr", "cat", "sed", "sort", "wc", "date", "awk", "shasum",
              "dirname", "head", "mkdir", "basename", "python3", "perl", "env", "printf", "ls",
              "sleep", "pgrep", "tail", "mv"):
        if t in missing:
            continue
        src = shutil.which(t)
        if src:
            os.symlink(src, os.path.join(d, t))
    return d


LAUNCH = {"command": "clay campaigns update cam_alpha --status active"}
RESUME = {"command": "clay campaigns resume cam_alpha"}
CLAY_A = "https://app.clay.com/workspaces/1372623/campaigns/cam_alpha"
results = []
# A refusal must be for the reason the case is about, not an incidental one.
WHY = {
    "no grade at all refuses": "no gtme-grade pass",
    "a launch grade does not unlock a resume": "no gtme-grade pass for resume",
    "a resume grade does not unlock a launch": "no gtme-grade pass for launch",
    "cam_beta's receipt copied to cam_alpha's name is refused": "not launch on cam_alpha",
    "a pass for another campaign does not unlock this one": "no gtme-grade pass for launch on cam_alpha",
    "a grade in another workspace does not unlock this one": "in workspace 1372623",
    "an unlabeled click on a graded campaign page refuses": "can't be tied",
    "a launch with no campaign id refuses even with grades on file": "no cam_ id",
    "a list edited after grading refuses": "leads.csv changed",
    "a list deleted after grading refuses": "leads.csv vanished",
    "campaign copy changed in Clay after grading refuses": "changed after gtme-grade passed",
    "a campaign that cannot be re-read refuses": "could not re-read",
    "a grade over 12 hours old refuses": "over 12 hours",
    "an unparsable receipt refuses": "unreadable",
    "a verification that hangs past the hook's timeout refuses": "did not answer",
    "a payload jq cannot parse, mentioning a launch, refuses": "not JSON",
    "jq missing refuses a launch": "jq is missing",
    "python3 missing refuses a launch": "python3 is missing",
    "a grade pass alone, without the pre-send gate, refuses": "pre-send gate receipt",
    "a receipt edited by hand (extended expiry) refuses": "signature does not verify",
    "an unsigned hand-written receipt refuses": "no signature",
    "a receipt signed with another key refuses": "signature does not verify",
    "a key file readable by others refuses": "not 0600",
    "a missing key refuses": "no grade key",
    "touching the key from the shell refuses": "its key",
    "writing a receipt from the shell refuses": "grade receipt",
}


def case(name, want, setup, tool="Bash", ti=LAUNCH, **kw):
    e = Env()
    e.presend()
    setup(e)
    got, err = e.run(tool, ti, **kw)
    ok = got == want and WHY.get(name, "") in err
    results.append(ok)
    print(f"{'ok  ' if ok else 'FAIL'} {name}: want {want} got {got}" + ("" if ok else f"\n    {err[:500]}"))


def nothing(e):
    pass


# allowed
case("a signed launch grade lets that launch through", 0, lambda e: e.grade("cam_alpha", "launch"))
case("a signed resume grade lets that resume through", 0, lambda e: e.grade("cam_alpha", "resume"),
     ti=RESUME)
case("running gtme-grade itself is not a launch", 0, nothing,
     ti={"command": "gtme-grade --campaign cam_alpha --action launch --leads l.csv"})

# 1. binding: action, campaign, workspace
case("no grade at all refuses", 2, nothing)
case("a launch grade does not unlock a resume", 2, lambda e: e.grade("cam_alpha", "launch"), ti=RESUME)
case("a resume grade does not unlock a launch", 2, lambda e: e.grade("cam_alpha", "resume"))
case("cam_beta's receipt copied to cam_alpha's name is refused", 2,
     lambda e: (e.campaign("cam_alpha"), e.grade("cam_beta", "launch", rename_to="cam_alpha")))
case("a pass for another campaign does not unlock this one", 2, lambda e: e.grade("cam_beta", "launch"))
case("a grade in another workspace does not unlock this one", 2,
     lambda e: e.grade("cam_alpha", "launch", ws="999"),
     ti={"command": "clay campaigns update cam_alpha --status active --ws 1372623"})
case("an unlabeled click on a graded campaign page refuses", 2,
     lambda e: e.grade("cam_alpha", "launch"), tool="mcp__chrome-devtools__click", ti={"uid": "1"},
     last_url=CLAY_A)
case("a launch with no campaign id refuses even with grades on file", 2,
     lambda e: e.grade("cam_alpha", "launch"), ti={"command": 'chewie web click "Launch"'})


# 2. inputs and live state re-hashed at launch time
def edited(e):
    e.grade("cam_alpha", "launch")
    with open(e.inputs, "a") as fh:
        fh.write("added@after.example.test\n")


def deleted(e):
    e.grade("cam_alpha", "launch")
    os.remove(e.inputs)


def copy_changed(e):
    e.grade("cam_alpha", "launch")
    e.campaign("cam_alpha", body="different copy")


def state_unreadable(e):
    e.grade("cam_alpha", "launch")
    os.remove(os.path.join(e.fixtures, "cam_alpha.json"))


def status_only(e):
    e.grade("cam_alpha", "launch")
    p = os.path.join(e.fixtures, "cam_alpha.json")
    d = json.load(open(p))
    d["status"] = "active"
    d["updatedAt"] = "later"
    json.dump(d, open(p, "w"))


case("a list edited after grading refuses", 2, edited)
case("a list deleted after grading refuses", 2, deleted)
case("campaign copy changed in Clay after grading refuses", 2, copy_changed)
case("a campaign that cannot be re-read refuses", 2, state_unreadable)
case("status and updatedAt changing alone still passes", 0, status_only)
case("a grade over 12 hours old refuses", 2, lambda e: e.grade("cam_alpha", "launch", age=13 * 3600))


# 3. fail closed
def garbage(e):
    e.grade("cam_alpha", "launch")
    for f in os.listdir(os.path.join(e.state, "gtme-grade")):
        with open(os.path.join(e.state, "gtme-grade", f), "w") as fh:
            fh.write("{not json")


case("an unparsable receipt refuses", 2, garbage)


def hangs(e):
    # The live re-read never answers (a FIFO nobody writes), so the watchdog
    # fires; the hook must refuse, not exit 0 as lib.sh's watchdog does.
    e.grade("cam_alpha", "launch")
    p = os.path.join(e.fixtures, "cam_alpha.json")
    os.remove(p)
    os.mkfifo(p)


case("a verification that hangs past the hook's timeout refuses", 2, hangs)
case("a payload jq cannot parse, mentioning a launch, refuses", 2, nothing, raw="launch cam_alpha {{{")
case("jq missing refuses a launch", 2, lambda e: e.grade("cam_alpha", "launch"),
     path=bin_without("jq"))
case("python3 missing refuses a launch", 2, lambda e: e.grade("cam_alpha", "launch"),
     path=bin_without("python3"))


def no_grader(e):
    e.grade("cam_alpha", "launch")
    d = tempfile.mkdtemp()
    os.makedirs(os.path.join(d, ".claude", "hooks"))
    shutil.copy(H, os.path.join(d, ".claude", "hooks", "launch-guard.sh"))
    e.lone_hook = os.path.join(d, ".claude", "hooks", "launch-guard.sh")
    e.env["CHEWBACCA_ROOT"] = os.path.join(d, "nowhere")


e = Env()
e.presend()
no_grader(e)
got, err = e.run("Bash", LAUNCH, hook=e.lone_hook)
results.append(got == 2)
print(f"{'ok  ' if got == 2 else 'FAIL'} gtme-grade missing refuses: want 2 got {got}")
case("a grade pass alone, without the pre-send gate, refuses", 2,
     lambda e: (os.remove(os.path.join(e.state, "send-gate-receipt.json")), e.grade("cam_alpha", "launch")))


# 4. tamper evidence
def forged(e):
    e.grade("cam_alpha", "launch")
    gdir = os.path.join(e.state, "gtme-grade")
    for f in os.listdir(gdir):
        p = os.path.join(gdir, f)
        body = json.load(open(p))
        body["time"] = int(time.time())
        body["expires"] = body["time"] + 10 ** 6
        json.dump(body, open(p, "w"))


def unsigned(e):
    e.grade("cam_beta", "launch")  # so the key exists and only the signature is missing
    e.campaign("cam_alpha")
    gdir = os.path.join(e.state, "gtme-grade")
    # 0600 like a real one, so the missing signature is what refuses
    fd = os.open(os.path.join(gdir, f"{WS}-cam_alpha-launch.json"), os.O_WRONLY | os.O_CREAT, 0o600)
    os.write(fd, json.dumps({"workspace": WS, "campaign": "cam_alpha", "action": "launch", "pass": True,
                             "time": NOW, "expires": NOW + 3600, "inputs": {}}).encode())
    os.close(fd)


def other_key(e):
    e.grade("cam_alpha", "launch")
    os.remove(e.key)
    fd = os.open(e.key, os.O_WRONLY | os.O_CREAT, 0o600)
    os.write(fd, os.urandom(32).hex().encode())
    os.close(fd)


def loose_key(e):
    e.grade("cam_alpha", "launch")
    os.chmod(e.key, 0o644)


def no_key(e):
    e.grade("cam_alpha", "launch")
    os.remove(e.key)


case("a receipt edited by hand (extended expiry) refuses", 2, forged)
case("an unsigned hand-written receipt refuses", 2, unsigned)
case("a receipt signed with another key refuses", 2, other_key)
case("a key file readable by others refuses", 2, loose_key)
case("a missing key refuses", 2, no_key)
case("touching the key from the shell refuses", 2, nothing,
     ti={"command": "cat ~/Library/Application\\ Support/chewbacca/gtme-grade.key"})
case("writing a receipt from the shell refuses", 2, nothing,
     ti={"command": "echo '{}' > ~/.chewbacca/state/gtme-grade/1372623-cam_alpha-launch.json"})



# Second review, 2026-10-10. (a) attribution: derive from what runs, refuse
# anything that can't be attributed. Each case below has cam_alpha graded.
def both(e):
    e.grade("cam_alpha", "launch")
    e.grade("cam_beta", "launch")


ATTRIB = [
    ("a chained second launch refuses", both,
     "clay campaigns update cam_alpha --status active && clay campaigns update cam_beta --status active",
     "chains"),
    ("an env-prefixed launch refuses", lambda e: e.grade("cam_alpha", "launch"),
     "X=1 clay campaigns update cam_alpha --status active", "env prefix"),
    ("a heredoc launch refuses", lambda e: e.grade("cam_alpha", "launch"),
     "clay campaigns update cam_alpha --status active <<EOF", "chains"),
    ("a comment naming the graded campaign refuses", lambda e: e.grade("cam_alpha", "launch"),
     "clay campaigns update cam_beta --status active # cam_alpha", "chains"),
    ("a bash -c wrapper refuses", lambda e: e.grade("cam_alpha", "launch"),
     "bash -c 'clay campaigns update cam_alpha --status active'", "wrapper"),
    ("one command with two actions refuses", lambda e: (e.grade("cam_alpha", "launch"),
                                                        e.grade("cam_alpha", "resume")),
     "clay campaigns resume cam_alpha --status active", "more than one of"),
    ("one command with two campaigns refuses", both,
     "clay campaigns update cam_alpha cam_beta --status active", "more than one campaign"),
    ("a page script refuses", lambda e: e.grade("cam_alpha", "launch"),
     "chewie web eval launchCampaign('cam_alpha')", "page script"),
]
for name, setup, cmd, need in ATTRIB:
    WHY[name] = need
    case(name, 2, setup, ti={"command": cmd})

WHY["a description naming the graded campaign does not cover the command"] = "cam_beta"
case("a description naming the graded campaign does not cover the command", 2,
     lambda e: (e.campaign("cam_beta"), e.grade("cam_alpha", "launch")),
     ti={"command": "clay campaigns update cam_beta --status active",
         "description": "launch cam_alpha"})
WHY["a labeled screen click refuses even when graded"] = "can't be tied"
case("a labeled screen click refuses even when graded", 2, lambda e: e.grade("cam_alpha", "launch"),
     tool="mcp__peekaboo__click", ti={"query": "Launch cam_alpha"})


# (b) integrity: canonical signature over every field, constant-time compare,
# the key never re-minted by a check
def resign(e, mutate, sign=True, after=None):
    e.grade("cam_alpha", "launch")
    gdir = os.path.join(e.state, "gtme-grade")
    p = os.path.join(gdir, os.listdir(gdir)[0])
    body = json.load(open(p))
    body.pop("mac")
    mutate(body)
    if after:  # signed first, changed after: the signature must not cover the change
        resign_body = dict(body)
        code = ("import json,sys; sys.path.insert(0, sys.argv[1]); import gtme_grade as G; "
                "b = json.loads(sys.argv[2]); print(G.sign(b, G.load_key(False)))")
        mac = subprocess.run([sys.executable, "-c", code, TOOLS, json.dumps(resign_body)], env=e.env,
                             capture_output=True, text=True).stdout.strip()
        after(body)
        body["mac"] = mac
        fd = os.open(p + ".new", os.O_WRONLY | os.O_CREAT, 0o600)
        os.write(fd, json.dumps(body).encode())
        os.close(fd)
        os.replace(p + ".new", p)
        return
    if sign:
        code = ("import json,sys; sys.path.insert(0, sys.argv[1]); import gtme_grade as G; "
                "b = json.loads(sys.argv[2]); print(G.sign(b, G.load_key(False)))")
        mac = subprocess.run([sys.executable, "-c", code, TOOLS, json.dumps(body)], env=e.env,
                             capture_output=True, text=True).stdout.strip()
    else:
        mac = ""
    body["mac"] = mac
    fd = os.open(p + ".new", os.O_WRONLY | os.O_CREAT, 0o600)
    os.write(fd, json.dumps(body).encode())
    os.close(fd)
    os.replace(p + ".new", p)


INTEGRITY = [
    ("an empty signature refuses", lambda e: resign(e, lambda b: None, sign=False), "no signature"),
    ("an extra unsigned field refuses", lambda e: resign(e, lambda b: b.update(note="x")),
     "fields differ"),
    ("a receipt claiming another key id refuses",
     lambda e: resign(e, lambda b: b.update(key_id="0" * 16)), "different key"),
    ("a float slipped into a signed body refuses",
     lambda e: resign(e, lambda b: None, after=lambda b: b.update(time=b["time"] + 0.0)),
     "signature does not verify"),
    ("a field changed after signing refuses",
     lambda e: resign(e, lambda b: None, after=lambda b: b.update(campaign_state="0" * 64)),
     "signature does not verify"),
    ("an expiry stretched past 12 hours refuses even if re-signed",
     lambda e: resign(e, lambda b: b.update(expires=b["expires"] + 3600)), "12 hours"),
]
for name, setup, need in INTEGRITY:
    WHY[name] = need
    case(name, 2, setup)


def empty_key(e):
    e.grade("cam_alpha", "launch")
    with open(e.key, "w") as fh:
        fh.write("")


def symlink_key(e):
    e.grade("cam_alpha", "launch")
    real = e.key + ".real"
    os.replace(e.key, real)
    os.symlink(real, e.key)


WHY["an empty key refuses"] = "empty or malformed"
case("an empty key refuses", 2, empty_key)
WHY["a symlinked key refuses"] = "symlink"
case("a symlinked key refuses", 2, symlink_key)

e = Env()
e.presend()
e.grade("cam_alpha", "launch")
os.remove(e.key)
got, err = e.run("Bash", LAUNCH)
ok = got == 2 and "no grade key" in err and not os.path.exists(e.key)
results.append(ok)
print(f"{'ok  ' if ok else 'FAIL'} a deleted key is never re-minted by the check: got {got}, "
      f"key exists {os.path.exists(e.key)}")


# (c) untrusted verifier inputs: fixed receipt place, validated ids, inputs
# resolved under an allowed root, no symlinks
def receipt_symlink(e):
    e.grade("cam_alpha", "launch")
    gdir = os.path.join(e.state, "gtme-grade")
    p = os.path.join(gdir, os.listdir(gdir)[0])
    elsewhere = os.path.join(e.home, "elsewhere.json")
    os.replace(p, elsewhere)
    os.symlink(elsewhere, p)


def loose_receipt(e):
    e.grade("cam_alpha", "launch")
    gdir = os.path.join(e.state, "gtme-grade")
    os.chmod(os.path.join(gdir, os.listdir(gdir)[0]), 0o644)


def input_symlink(e):
    e.grade("cam_alpha", "launch")
    copy = e.inputs + ".copy"
    shutil.copy(e.inputs, copy)
    os.remove(e.inputs)
    os.symlink(copy, e.inputs)


def outside_root(e):
    e.grade("cam_alpha", "launch")
    e.env["GTME_GRADE_INPUT_ROOTS"] = tempfile.mkdtemp()


for name, setup, need in [
        ("a receipt that is a symlink refuses", receipt_symlink, "symlink"),
        ("a receipt readable by others refuses", loose_receipt, "0600"),
        ("a graded input swapped for a symlink refuses", input_symlink, "symlink"),
        ("a graded input outside the allowed roots refuses", outside_root, "outside the allowed")]:
    WHY[name] = need
    case(name, 2, setup)

e = Env()
e.grade("cam_alpha", "launch")
bad = subprocess.run([sys.executable, os.path.join(TOOLS, "gtme_grade.py"), "--verify", "--ws", "1372623",
                      "--campaign", "../../keys/x", "--action", "launch"], env=e.env,
                     capture_output=True, text=True, timeout=30)
ok = bad.returncode == 2 and "refusing a receipt name" in bad.stderr
results.append(ok)
print(f"{'ok  ' if ok else 'FAIL'} --verify refuses a path-shaped campaign id: {bad.stderr.strip()[:120]}")

print(f"\n{sum(results)}/{len(results)} passed")
raise SystemExit(0 if all(results) else 1)
