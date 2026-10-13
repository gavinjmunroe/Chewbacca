#!/usr/bin/env python3
"""chewbacca gtme ready: the one command that says whether a launch is ready.

THE FAILURE THIS EXISTS FOR. On 2026-10-12 an agent told Caleb a Zeutara launch
was good "until Jonah responds", with only a footer address missing. In fact
the new copy existed only as local files (the live Clay drafts still graded 25
to 67 against the 85 bar), nobody had read it as a recipient, 104 of 746 firm
names carried legal suffixes the first line would print, 1 of 14 campaigns had
been graded, gates 3 to 5 were NOT CHECKED, the pre-send gate receipt had
expired and no START had ever been sent. Caleb: "DONT TELL ME UR READY IF THIS
SHIT IS HAPPENING? FIX CHEWBS BRO UR SUPPOSED TO BE A GTME".

    chewbacca gtme ready --client Zeutara --drafts zeutara-data/monday-2026-10-12/drafts.json
    chewbacca gtme ready --client Zeutara --check      exit 0 only on a signed READY under 2 hours old

For every campaign in the drafts file (a JSON list of {company, tier,
campaign, segment, leads, ...}) this runs the full `gtme-grade --campaign <id>
--action launch` with every input the grader takes, found from the drafts
entry, then the client's `ready` block in clients.json, then the files beside
the drafts file. An input it cannot find is named in the table and its gate
stays NOT CHECKED, which counts as a blocker: a skipped rule never passes.
Then it checks the pre-send gate receipt is fresh and that nobody is owed a
reply (`chewbacca gtme done`).

The last line is READY only when every campaign passes every gate and both
checks pass; otherwise NOT READY and the number of blockers. Exit 0 only on
READY, 1 on NOT READY, 2 on bad arguments. The result is written, signed with
gtme-grade's key, to ~/.chewbacca/state/gtme-ready/<client>.json; the Stop hook
ready-guard.sh refuses a readiness claim without a READY one under 2 hours old.

Reads Clay through gtme-grade (`chewbacca clay campaign`, a read). Never sends,
never starts, never edits a campaign.
"""
import argparse
import concurrent.futures
import glob
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
import gtme_grade  # noqa: E402

CID = re.compile(r"cam_[A-Za-z0-9]{1,64}")
GATES = ("list", "copy", "read", "render", "start")
# Two hours: a READY from the morning says nothing about copy pushed at noon.
# Set by the 2026-10-12 brief ("a READY pass from the last 2 hours"), not measured.
READY_MAX_AGE_S = 2 * 3600
# gtme-grade reads two Clay endpoints per campaign; four at once kept 14
# campaigns under two minutes without stacking reads. Guessed, never measured.
WORKERS = 4
GRADE_TIMEOUT_S = 240
DONE_TIMEOUT_S = 360


def state_dir():
    return Path(os.path.expanduser(os.environ.get("CHEWBACCA_STATE_DIR", "~/.chewbacca/state"))) / "gtme-ready"


def slug(name):
    return "".join(c if c.isalnum() else "-" for c in (name or "").lower())


def result_path(client):
    return state_dir() / (slug(client) + ".json")


def clients_file():
    return os.path.expanduser(os.environ.get("GTME_CLIENTS")
                              or os.environ.get("CHEWBACCA_GTM_CLIENTS") or "~/.chewbacca/gtm/clients.json")


def client_config(name):
    try:
        doc = json.loads(Path(clients_file()).read_text())
    except (OSError, ValueError):
        return None
    for c in doc.get("clients", []):
        if c.get("name", "").lower() == (name or "").lower():
            return c
    return None


def git_blob(data):
    """The id git gives these bytes (`git hash-object`), with no repo needed."""
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def drafts_identity(path):
    data = Path(path).read_bytes()
    out = {"path": str(Path(path).resolve()), "git_blob": git_blob(data),
           "sha256": hashlib.sha256(data).hexdigest(), "commit": ""}
    try:
        p = subprocess.run(["git", "-C", str(Path(path).resolve().parent), "log", "-1", "--format=%H", "--",
                            Path(path).name], capture_output=True, text=True, timeout=10)
        out["commit"] = p.stdout.strip() if p.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        pass
    return out


# ------------------------------------------------------------ input finding

def first_file(candidates):
    for c in candidates:
        if c and os.path.isfile(c):
            return c
    return None


def newest(pattern_list):
    hits = [p for pat in pattern_list for p in glob.glob(pat) if os.path.isfile(p)]
    return max(hits, key=os.path.getmtime) if hits else None


def resolve(entry, ddir, ready, entries):
    """(gtme-grade argv for this campaign, [missing input lines])."""
    cid = entry.get("campaign", "")
    company, tier = entry.get("company", ""), str(entry.get("tier", ""))
    up = os.path.dirname(ddir)
    missing, argv = [], []

    def pick(key):
        v = entry.get(key)
        if v in (None, ""):
            v = ready.get(key)
        return v

    def path_of(key):
        v = pick(key)
        if isinstance(v, str) and v:
            return os.path.join(ddir, os.path.expanduser(v)) if not os.path.isabs(os.path.expanduser(v)) \
                else os.path.expanduser(v)
        return None

    # The send list for this one draft. A tier file is the whole tier, which is
    # this draft's list only when no other draft shares the company and tier:
    # on 2026-10-12 the signal split put Ivy tier A in two drafts of 37 and 34.
    leads = path_of("leads_file") or first_file([os.path.join(ddir, "leads", cid + ".csv"),
                                                  os.path.join(ddir, cid + ".csv")])
    if not leads:
        twins = [e for e in entries if e.get("company") == company and str(e.get("tier", "")) == tier]
        tier_file = os.path.join(ddir, f"{slug(company).split('-')[0]}-tier{tier}-final.csv")
        if len(twins) == 1 and os.path.isfile(tier_file):
            leads = tier_file
        elif os.path.isfile(tier_file):
            missing.append(f"leads: {os.path.basename(tier_file)} is all of {company} tier {tier}, which is "
                           f"split across {len(twins)} drafts; write leads/{cid}.csv")
        else:
            missing.append(f"leads: no leads/{cid}.csv, {cid}.csv or leads_file")
    if leads:
        argv += ["--leads", leads]

    ver = path_of("verification") or first_file([os.path.join(ddir, n) for n in ("verdicts.csv", "verification.csv")])
    if ver:
        argv += ["--verification", ver]
    sup = path_of("suppress") or newest([os.path.join(ddir, "suppress*.csv"), os.path.join(up, "suppress*.csv")])
    if sup:
        argv += ["--suppress", sup]
    else:
        missing.append("suppress: no suppress*.csv beside the drafts and none in clients.json ready.suppress")
    senders = path_of("senders") or first_file([os.path.join(d, n) for d in (ddir, up)
                                                for n in ("senders.json", "sender-accounts.json")])
    if senders:
        argv += ["--senders", senders]
    else:
        missing.append("senders: no senders.json or sender-accounts.json beside the drafts")
    review = path_of("review") or first_file([os.path.join(ddir, "reviews", cid + ".json"),
                                              os.path.join(ddir, cid + ".review.json")]
                                             + glob.glob(os.path.join(ddir, "*", cid + ".review.json")))
    if review:
        argv += ["--review", review]
    else:
        missing.append(f"recipient read: no reviews/{cid}.json recording a read as the recipient")
    if pick("warmup_start"):
        argv += ["--warmup-start", str(pick("warmup_start"))]
    for key, flag in (("icp_titles", "--icp-titles"), ("icp_fit_column", "--icp-fit-column"),
                      ("offer", "--offer"), ("signal", "--signal"), ("sender_name", "--sender-name"),
                      ("sender_company", "--sender-company")):
        v = pick(key)
        if v:
            argv += [flag, ",".join(v) if isinstance(v, list) else str(v)]
    fm = pick("field_map") or {}
    for field, column in (fm.items() if isinstance(fm, dict) else (p.split("=", 1) for p in fm)):
        argv += ["--field-map", f"{field}={column}"]
    return argv, missing


# ------------------------------------------------------------------ grading

def status_of(gate):
    if gate.get("pass"):
        return "PASS", ""
    if gate.get("fails"):
        return "FAIL", gate["fails"][0]
    if gate.get("not_checked"):
        return "NOT CHECKED", gate["not_checked"][0]
    return "FAIL", "the gate did not pass and named no reason"


def grade_one(entry, extra, client, ws):
    cid = entry.get("campaign", "")
    argv = [sys.executable, str(HERE / "gtme_grade.py"), "--client", client, "--ws", str(ws),
            "--action", "launch", "--json"]
    fixtures = os.environ.get("GTME_READY_CAMPAIGN_DIR")  # test seam: saved campaign answers
    argv += ["--campaign-json", os.path.join(fixtures, cid + ".json")] if fixtures else ["--campaign", cid]
    argv += extra
    try:
        p = subprocess.run(argv, capture_output=True, text=True, timeout=GRADE_TIMEOUT_S)
        doc = json.loads(p.stdout)
    except subprocess.TimeoutExpired:
        return {"error": f"gtme-grade took over {GRADE_TIMEOUT_S} s"}
    except (OSError, ValueError):
        return {"error": "gtme-grade answered no JSON: " + (p.stderr.strip()[-200:] or "no output")}
    return doc


def run_campaigns(entries, ddir, ready, client, ws):
    out = []
    jobs = {}
    # Mint the signing key here, once: on a first run four graders each tried
    # to create it with O_EXCL and all but one died on "File exists".
    try:
        gtme_grade.load_key(create=True)
    except (OSError, PermissionError):
        pass  # each grade then reports its own key error as NOT CHECKED
    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for e in entries:
            extra, missing = resolve(e, ddir, ready, entries)
            if CID.fullmatch(str(e.get("campaign", ""))):
                jobs[pool.submit(grade_one, e, extra, client, ws)] = (e, missing)
        done = {id(e): ({}, resolve(e, ddir, ready, entries)[1]) for e in entries}
        for fut in concurrent.futures.as_completed(jobs):
            done[id(jobs[fut][0])] = (fut.result(), jobs[fut][1])
    for e in entries:
        doc, missing = done[id(e)]
        row = {"campaign": e.get("campaign", ""), "company": e.get("company", ""), "tier": str(e.get("tier", "")),
               "leads": e.get("leads") if isinstance(e.get("leads"), int) else None,
               "missing_inputs": missing, "gates": [], "receipt": None}
        if not CID.fullmatch(row["campaign"]):
            row["gates"] = [{"gate": i + 1, "title": g, "status": "NOT CHECKED",
                             "first": "the drafts entry names no Clay campaign id"} for i, g in enumerate(GATES)]
        elif "error" in doc:
            row["gates"] = [{"gate": i + 1, "title": g, "status": "NOT CHECKED", "first": doc["error"]}
                            for i, g in enumerate(GATES)]
        else:
            for g in doc.get("gates", []):
                st, first = status_of(g)
                row["gates"].append({"gate": g.get("gate"), "title": g.get("title"), "status": st, "first": first,
                                     "fails": len(g.get("fails") or []), "not_checked": len(g.get("not_checked") or [])})
            row["receipt"] = doc.get("receipt")
            if len(row["gates"]) != len(GATES):
                row["gates"] += [{"gate": i + 1, "title": GATES[i], "status": "NOT CHECKED",
                                  "first": "gtme-grade returned no verdict for this gate"}
                                 for i in range(len(row["gates"]), len(GATES))]
        bad = [g for g in row["gates"] if g["status"] != "PASS"]
        row["status"] = "PASS" if not bad else ("FAIL" if any(g["status"] == "FAIL" for g in bad) else "NOT CHECKED")
        # A real FAIL first: it is what a recipient would see. Then the input
        # that was never found, then whatever else went unchecked.
        failed = [g for g in bad if g["status"] == "FAIL"]
        row["first_reason"] = (failed[0]["first"] if failed else missing[0] if missing and bad
                               else bad[0]["first"] if bad else "")
        out.append(row)
    return out


def check_presend(client):
    why = gtme_grade.presend_ok(client, allow_no_lines=True)
    return {"name": "pre-send gate receipt", "status": "FAIL" if why else "PASS", "first": why}


def check_owed(client, inbox=None, slack=None):
    argv = [sys.executable, str(HERE / "gtme_done.py"), "--client", client, "--json"]
    if inbox:
        argv += ["--inbox", inbox]
    if slack:
        argv += ["--slack", slack]
    row = {"name": "owed replies (gtme done)"}
    try:
        p = subprocess.run(argv, capture_output=True, text=True, timeout=DONE_TIMEOUT_S)
        rep = json.loads(p.stdout)
    except subprocess.TimeoutExpired:
        return dict(row, status="NOT CHECKED", first=f"gtme done took over {DONE_TIMEOUT_S} s")
    except (OSError, ValueError):
        return dict(row, status="NOT CHECKED", first="gtme done answered no JSON: " + (p.stderr.strip()[-160:] or "?"))
    owed = rep.get("replies_owed") or []
    unread = rep.get("client_unanswered") or []
    if owed or unread:
        first = (f"{owed[0][0]} wrote {owed[0][2]} ({owed[0][1]}) and has no answer" if owed
                 else f"{len(unread)} client message(s) nobody answered")
        return dict(row, status="FAIL", first=f"{len(owed) + len(unread)} open: {first}")
    if rep.get("not_run"):
        return dict(row, status="NOT CHECKED", first=rep["not_run"][0])
    if rep.get("skipped"):
        return dict(row, status="NOT CHECKED", first=rep["skipped"][0])
    return dict(row, status="PASS", first="")


# ------------------------------------------------------------------- output

def blockers(rows, checks):
    n = sum(1 for r in rows for g in r["gates"] if g["status"] != "PASS")
    return n + sum(1 for c in checks if c["status"] != "PASS")


def table(client, ident, rows, checks, n_block):
    lines = [f"chewbacca gtme ready: {client}, {len(rows)} campaigns from {ident['path']} "
             f"(git blob {ident['git_blob'][:10]})", ""]
    head = f"  {'campaign':<26}{'company / tier':<28}" + "".join(f"{g:<13}" for g in GATES) + "first reason"
    lines.append(head)
    for r in rows:
        who = f"{r['company']} {r['tier']}" + (f" ({r['leads']})" if r["leads"] is not None else "")
        cells = "".join(f"{g['status']:<13}" for g in r["gates"])
        lines.append(f"  {r['campaign']:<26}{who[:27]:<28}{cells}{(r['first_reason'] or '')[:110]}")
    lines.append("")
    for c in checks:
        lines.append(f"  {c['name']:<50}{c['status']:<13}{(c['first'] or '')[:110]}")
    missing = sorted({m.split(':')[0] for r in rows for m in r["missing_inputs"]})
    if missing:
        lines.append("")
        lines.append(f"  inputs not found for some campaigns: {', '.join(missing)} (each keeps its gate NOT CHECKED)")
    lines.append("")
    passing = sum(1 for r in rows if r["status"] == "PASS")
    if n_block == 0 and rows:
        lines.append(f"READY: all {len(rows)} campaigns pass all five gates, the pre-send gate is fresh "
                     f"and nobody is owed a reply.")
    else:
        lines.append(f"NOT READY: {n_block} blockers ({passing} of {len(rows)} campaigns pass every gate). "
                     f"Report this list as it stands; nothing here is ready to start.")
    return "\n".join(lines)


def write_result(client, body):
    key = gtme_grade.load_key(create=True)
    body = dict(body, key_id=gtme_grade.key_id(key))
    body["mac"] = gtme_grade.sign(body, key)
    d = state_dir()
    d.mkdir(parents=True, exist_ok=True, mode=0o700)
    dest = result_path(client)
    tmp = dest.with_name(f".{dest.name}.{os.getpid()}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        fh.write(json.dumps(body, indent=1))
    os.replace(tmp, dest)
    return dest


def check_result(client, max_age=READY_MAX_AGE_S):
    """'' when a signed READY for this client is under max_age seconds old and
    its drafts file is unchanged; else why not."""
    import hmac
    path = result_path(client)
    try:
        body = json.loads(path.read_text())
        key = gtme_grade.load_key(create=False)
    except (OSError, ValueError, PermissionError) as exc:
        return f"no gtme ready result for {client} ({exc.__class__.__name__})"
    if not isinstance(body, dict):
        return "the gtme ready result is not an object"
    mac = body.pop("mac", None)
    try:
        good = isinstance(mac, str) and hmac.compare_digest(mac, gtme_grade.sign(body, key))
    except ValueError:
        good = False
    if not good:
        return "the gtme ready result's signature does not verify (not written by gtme ready)"
    if body.get("verdict") != "READY" or body.get("blockers") != 0:
        return f"the last gtme ready for {client} was NOT READY with {body.get('blockers')} blockers"
    t = body.get("time")
    if not isinstance(t, int) or not (0 <= time.time() - t < max_age):
        return f"the last READY for {client} is over {max_age // 3600} hours old"
    d = body.get("drafts") or {}
    try:
        if hashlib.sha256(Path(d.get("path", "")).read_bytes()).hexdigest() != d.get("sha256"):
            return "the drafts file changed after gtme ready passed"
    except OSError:
        return "the drafts file gtme ready graded is gone"
    return ""


def main(argv=None):
    ap = argparse.ArgumentParser(prog="chewbacca gtme ready", description=__doc__.splitlines()[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    ap.add_argument("--client", required=True)
    ap.add_argument("--drafts", help="JSON list of {company, tier, campaign, segment, leads, ...}; "
                                     "else clients.json ready.drafts")
    ap.add_argument("--check", action="store_true",
                    help="only verify the stored result: exit 0 on a signed READY under 2 hours old")
    ap.add_argument("--inbox", help="a saved clay-inbox JSON for the owed-replies check")
    ap.add_argument("--slack", help="a saved {channel: [messages]} JSON for the owed-replies check")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)

    if a.check:
        why = check_result(a.client)
        print(f"gtme ready: {why}" if why else f"gtme ready: READY for {a.client} is fresh and signed")
        return 1 if why else 0

    cfg = client_config(a.client)
    if cfg is None:
        print(f"chewbacca gtme ready: no client named {a.client} in {clients_file()}", file=sys.stderr)
        return 2
    ready = cfg.get("ready") or {}
    drafts = a.drafts or (os.path.expanduser(ready["drafts"]) if ready.get("drafts") else None)
    if not drafts:
        print("chewbacca gtme ready: name the --drafts file (or set ready.drafts in clients.json)", file=sys.stderr)
        return 2
    try:
        entries = json.loads(Path(drafts).read_text())
        ident = drafts_identity(drafts)
    except (OSError, ValueError) as exc:
        print(f"chewbacca gtme ready: cannot read {drafts}: {exc}", file=sys.stderr)
        return 2
    if not isinstance(entries, list) or not all(isinstance(e, dict) for e in entries):
        print(f"chewbacca gtme ready: {drafts} is not a JSON list of campaign objects", file=sys.stderr)
        return 2
    # The client's one workspace, never a built-in id: until 2026-10-13 a client
    # with none was graded in Zeutara's Clay workspace.
    import gtme_config
    ws, why = gtme_config.workspace_of(cfg)
    if not ws:
        print(f"chewbacca gtme ready: {why}", file=sys.stderr)
        return 2
    rows = run_campaigns(entries, str(Path(drafts).resolve().parent), ready, cfg["name"], ws)
    checks = [check_presend(cfg["name"]), check_owed(cfg["name"], a.inbox, a.slack)]
    if not entries:
        checks.append({"name": "campaigns", "status": "FAIL", "first": "the drafts file lists no campaigns"})
    n_block = blockers(rows, checks)
    verdict = "READY" if n_block == 0 else "NOT READY"
    body = {"v": 1, "client": cfg["name"], "time": int(time.time()), "verdict": verdict, "blockers": n_block,
            "drafts": ident, "checks": checks,
            "campaigns": [{k: r[k] for k in ("campaign", "company", "tier", "status", "first_reason",
                                             "missing_inputs", "receipt")}
                          | {"gates": [{"gate": g["gate"], "status": g["status"], "first": g["first"]}
                                       for g in r["gates"]]}
                          for r in rows]}
    try:
        dest = write_result(cfg["name"], body)
    except (OSError, ValueError, PermissionError) as exc:
        print(f"chewbacca gtme ready: could not record the result: {exc}", file=sys.stderr)
        dest = None
    if a.json:
        print(json.dumps(dict(body, result=str(dest) if dest else None), indent=1))
    else:
        print(table(cfg["name"], ident, rows, checks, n_block))
        if dest:
            print(f"Recorded in {dest}.")
    return 0 if verdict == "READY" else 1


if __name__ == "__main__":
    sys.exit(main())
