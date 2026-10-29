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

OWN-INBOX BATCHES. A drafts entry of {"batch": "<id>"} names a frozen
`chewbacca gtme batch` in the client's own ledger instead of a Clay campaign.
Until 2026-10-29 a client that sends from its own Gmail (Firm Foundation) could
not be graded at all: ready exited "names no Clay workspace", so "ready" for
that path meant whatever the agent said. A batch is graded on the same five
gates from the ledger: list (every address on leads.csv, unsuppressed, never
emailed, with a valid verifier verdict and a source link for its line), copy
(no batch problem, and a Jev verdict at or over the plan's bar logged when the
batch was built), read (reviews/<id>.json beside the drafts), render (name,
mailing address, opt-out and a non-.edu sending address that is signed in) and
start (the batch is unedited, under 2 hours old and inside today's cap). The
pre-send receipt is a Clay-list gate, so a batch-only run skips it: the list
gate carries the same verifier rule per address.
"""
import argparse
import concurrent.futures
import csv
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
            if e.get("batch"):
                continue
            extra, missing = resolve(e, ddir, ready, entries)
            if CID.fullmatch(str(e.get("campaign", ""))):
                jobs[pool.submit(grade_one, e, extra, client, ws)] = (e, missing)
        done = {id(e): ({}, [] if e.get("batch") else resolve(e, ddir, ready, entries)[1]) for e in entries}
        for fut in concurrent.futures.as_completed(jobs):
            done[id(jobs[fut][0])] = (fut.result(), jobs[fut][1])
    for e in entries:
        doc, missing = done[id(e)]
        row = {"campaign": e.get("campaign", ""), "company": e.get("company", ""), "tier": str(e.get("tier", "")),
               "leads": e.get("leads") if isinstance(e.get("leads"), int) else None,
               "missing_inputs": missing, "gates": [], "receipt": None}
        if e.get("batch"):
            row["campaign"] = f"batch {e['batch']}"
            row["company"] = row["company"] or client
            row["gates"], row["leads"] = grade_batch(e, ddir, client)
        elif not CID.fullmatch(row["campaign"]):
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
        # A grader that never ran is the reason, never the missing input beside
        # it. On 2026-10-17 gtme-grade died on "--field-map names firm, which
        # the leads file lacks" for all 8 Zeutara drafts, every gate went NOT
        # CHECKED, and this column said "recipient read missing" all day.
        crashed = "error" in doc if isinstance(doc, dict) else False
        row["first_reason"] = (f"gtme-grade did not run: {doc['error']}" if crashed
                               else failed[0]["first"] if failed else missing[0] if missing and bad
                               else bad[0]["first"] if bad else "")
        out.append(row)
    return out


# Twelve minutes covers a batch of 20 at Jev's slowest observed answer
# (about 30 s an email on 2026-10-18), so a verdict this close before the
# batch's made_at belongs to that build. Guessed from that one night.
JEV_WINDOW_S = 12 * 60


def _gate(n, status, first=""):
    return {"gate": n, "title": GATES[n - 1], "status": status, "first": first}


def grade_batch(entry, ddir, client):
    """The five gates for one own-inbox batch, read from the client's ledger."""
    import gtme_solo
    import treg_client
    bid = str(entry.get("batch", ""))
    d = gtme_solo.cdir(client)
    try:
        batch = json.loads((d / "batches" / f"{bid}.json").read_text())
        plan = gtme_solo.plan_of(client)
    except (OSError, ValueError, gtme_solo.Refused) as exc:
        why = f"no batch {bid} in {d / 'batches'} ({exc.__class__.__name__})"
        return [_gate(i + 1, "NOT CHECKED", why) for i in range(len(GATES))], 0
    mails = batch.get("mails") or []
    gates = []

    leads = {}
    try:
        with (d / "leads.csv").open() as fh:
            leads = {(r.get("email") or "").lower(): r for r in csv.DictReader(fh)}
    except OSError:
        pass
    off = gtme_solo.suppressed(client)
    sent = {(r.get("email"), r.get("step")) for r in gtme_solo.jsonl(d / "sent.jsonl")}
    fails = []
    for m in mails:
        to, step = m.get("to", ""), m.get("step")
        row = leads.get(to.lower())
        if row is None:
            fails.append(f"{to} is not on leads.csv")
        elif (row.get("email_verdict") or "").strip() != treg_client.SENDABLE:
            fails.append(f"{to} has no valid verifier verdict ({row.get('email_verdict') or 'none'})")
        if to.lower() in off:
            fails.append(f"{to} is suppressed")
        if (to, step) in sent:
            fails.append(f"{to} already got email {step}")
        if step == 1 and not re.match(r"https://", m.get("line_source") or ""):
            fails.append(f"{to}'s first line has no https source")
    if not mails:
        fails.append("the batch has no emails")
    gates.append(_gate(1, "FAIL" if fails else "PASS", fails[0] if fails else ""))

    fails = [f"{m.get('to')}: {p}" for m in mails for p in gtme_solo.problems(m)]
    bar = plan.get("min_grade")
    if not plan.get("jev_checks") or not isinstance(bar, (int, float)) or bar < 85:
        fails.append(f"the plan has no Jev grade bar of 85 or more (jev_checks {plan.get('jev_checks')}, "
                     f"min_grade {bar})")
    else:
        made = gtme_solo.op.parse_time(batch.get("made_at", ""))
        graded = {}
        for r in gtme_solo.jsonl(d / "jev.jsonl"):
            try:
                age = (made - gtme_solo.op.parse_time(r["at"])).total_seconds()
            except (KeyError, TypeError, ValueError):
                continue
            if 0 <= age <= JEV_WINDOW_S:
                graded[(r.get("to"), r.get("step"))] = r
        for m in mails:
            v = graded.get((m.get("to"), m.get("step")))
            if v is None:
                fails.append(f"{m.get('to')} has no Jev verdict from this batch's build")
            elif v.get("held"):
                fails.append(f"{m.get('to')} was held by Jev: {'; '.join(v.get('why') or [])}")
    gates.append(_gate(2, "FAIL" if fails else "PASS", fails[0] if fails else ""))

    review = entry.get("review") or os.path.join(ddir, "reviews", f"{bid}.json")
    review = review if os.path.isabs(review) else os.path.join(ddir, review)
    try:
        rv = json.loads(Path(review).read_text())
        ok = isinstance(rv, dict) and rv.get("batch") == bid and rv.get("read_as_recipient") is True
        gates.append(_gate(3, "PASS" if ok else "FAIL",
                           "" if ok else f"{os.path.basename(review)} does not record a read of batch {bid}"))
    except (OSError, ValueError):
        gates.append(_gate(3, "NOT CHECKED", f"recipient read: no reviews/{bid}.json recording a read"))

    sender = plan.get("sender") or {}
    inbox = batch.get("inbox") or sender.get("inbox") or ""
    fails = []
    for key in ("name", "address", "email"):
        if not (sender.get(key) or "").strip():
            fails.append(f"the plan's sender has no {key}")
    if inbox.lower().endswith(".edu") or (sender.get("email") or "").lower().endswith(".edu"):
        fails.append("the sending address is a .edu")
    if sender.get("email") and inbox and sender["email"].lower() != inbox.lower():
        fails.append(f"the batch sends from {inbox}, not the plan's sender {sender['email']}")
    if not fails:
        foot = gtme_solo.footer(sender)
        fails += [f"{m.get('to')}'s body does not end with the sender footer" for m in mails
                  if not (m.get("body") or "").rstrip().endswith(foot)]
        try:
            who = gtme_solo.gws(["gmail", "users", "getProfile", "--params", '{"userId":"me"}'], inbox)
            if (who.get("emailAddress") or "").lower() != inbox.lower():
                fails.append(f"{inbox} is signed in as {who.get('emailAddress')}")
        except (OSError, RuntimeError, ValueError, subprocess.TimeoutExpired) as exc:
            fails.append(f"{inbox} is not signed in ({str(exc)[:80]}): chewbacca email add {inbox}")
    gates.append(_gate(4, "FAIL" if fails else "PASS", fails[0] if fails else ""))

    fails = []
    frozen = json.dumps([{k: m[k] for k in ("to", "step", "subject", "body")} for m in mails], sort_keys=True)
    if hashlib.sha256(frozen.encode()).hexdigest()[:10] != bid:
        fails.append(f"batch {bid} was edited after it was built")
    try:
        age = (gtme_solo.op.utc_now() - gtme_solo.op.parse_time(batch.get("made_at", ""))).total_seconds()
    except (TypeError, ValueError):
        age = None
    if age is None or not 0 <= age < gtme_solo.BATCH_TTL.total_seconds():
        fails.append(f"batch {bid} is over {int(gtme_solo.BATCH_TTL.total_seconds() // 3600)} hours old; rebuild it")
    room = gtme_solo.today_cap(client) - gtme_solo.sent_today(client)
    if len(mails) > room:
        fails.append(f"{len(mails)} emails, over today's room of {room}")
    gates.append(_gate(5, "FAIL" if fails else "PASS", fails[0] if fails else ""))
    return gates, len(mails)


def check_presend(client):
    why = gtme_grade.presend_ok(client, allow_no_lines=True)
    return {"name": "pre-send gate receipt", "status": "FAIL" if why else "PASS", "first": why}


def check_owed(client, inbox=None, slack=None, no_client=""):
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
    # A company running its own outbound (Firm Foundation) has no outside client
    # to answer, so a missing client_slack is no gap when clients.json says why.
    skipped = [s for s in rep.get("skipped") or []
               if not (no_client and s.startswith("client messages:"))]
    if skipped:
        return dict(row, status="NOT CHECKED", first=skipped[0])
    return dict(row, status="PASS", first="")


# ------------------------------------------------------------------- output

def causes(rows, checks):
    """Distinct reasons behind the blockers, most cells first. The blocker count
    is gate cells: 8 drafts with one shared crash read 41 on 2026-10-17, the
    same number as a different week's 41 catch-alls, so the count alone hid
    that the cause had changed."""
    tally = {}
    for r in rows:
        for g in r["gates"]:
            if g["status"] != "PASS":
                key = re.sub(r"cam_[A-Za-z0-9]+", "cam_*", r["first_reason"] if "did not run" in r["first_reason"]
                             else g["first"] or "no reason given")
                key = re.sub(r"\b\d+ of \d+\b", "N of M", key)
                tally[key] = tally.get(key, 0) + 1
    for c in checks:
        if c["status"] != "PASS":
            tally[f"{c['name']}: {c['first']}"] = tally.get(f"{c['name']}: {c['first']}", 0) + 1
    return sorted(tally.items(), key=lambda kv: -kv[1])


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
    found = causes(rows, checks)
    if found:
        lines.append(f"  {n_block} blockers come from {len(found)} cause{'s' if len(found) != 1 else ''}:")
        for why, n in found[:8]:
            lines.append(f"    {n:>3}  {why[:120]}")
        lines.append("")
    if n_block == 0 and rows:
        gate = ", the pre-send gate is fresh" if any(c["name"].startswith("pre-send") for c in checks) else ""
        lines.append(f"READY: all {len(rows)} campaigns pass all five gates{gate} and nobody is owed a reply.")
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
    only_batches = bool(entries) and all(e.get("batch") for e in entries)
    ws, why = gtme_config.workspace_of(cfg)
    if not ws and not only_batches:
        print(f"chewbacca gtme ready: {why}", file=sys.stderr)
        return 2
    rows = run_campaigns(entries, str(Path(drafts).resolve().parent), ready, cfg["name"], ws)
    checks = ([] if only_batches else [check_presend(cfg["name"])]) + [check_owed(cfg["name"], a.inbox, a.slack,
                                                                             str(cfg.get("no_client") or ""))]
    if not entries:
        checks.append({"name": "campaigns", "status": "FAIL", "first": "the drafts file lists no campaigns"})
    n_block = blockers(rows, checks)
    verdict = "READY" if n_block == 0 else "NOT READY"
    # A path in clients.json outlives the week it was set for. On 2026-10-17 the
    # 10-19 drafts were graded against the 10-12 verdicts and suppression files
    # pinned there, so 42 freshly verified people read as unverified.
    ddir = str(Path(drafts).resolve().parent)
    stale = [f"{key} comes from clients.json ({ready[key]}), outside this drafts folder; "
             f"set it on the drafts entries if this week's file differs"
             for key in ("verification", "suppress", "senders")
             if isinstance(ready.get(key), str) and not any(e.get(key) for e in entries)
             and os.path.dirname(os.path.expanduser(ready[key])) != ddir]
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
        for w in stale:
            print(f"  warn  {w}")
        if dest:
            print(f"Recorded in {dest}.")
    return 0 if verdict == "READY" else 1


if __name__ == "__main__":
    sys.exit(main())
