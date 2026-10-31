#!/usr/bin/env python3
"""Measure the skill routers the hooks run, on real labeled prompts, train and held-out apart.

    skill_route_eval.py extract [--days 7] [--out FILE]   candidate prompts from local transcripts
    skill_route_eval.py run [--labels FILE] [--split held|train|all] [--set K=V ...] [--json] [--misses]

`extract` pulls user-turn text from ~/.claude/projects transcripts: Caleb's typed prompts,
briefs other sessions sent, and machine notifications (task-notification, cross-session-message,
side-sessions-event, stop-hook feedback). Each row is then labeled by hand with the skill that
should have been named, or NONE.

`run` feeds every labeled prompt to the real .claude/hooks/skill-route.sh with a throwaway state
dir, so the numbers are the shipped behaviour and its latency, not a reimplementation. For the
route a prompt gets (the first skill shown) it reports:

  precision        shown skill == label, over prompts where something was shown
  recall           shown skill == label, over prompts whose label is a skill
  false fire       something shown on a NONE prompt, typed and notification apart
  gate armed       prompts that armed skill-gate's graph-engineering requirement, and how many
                   of those were labeled graph-engineering or big work
  p50 / p95        wall time of one hook run

The labels hold Caleb's prompts, so they live in the private second brain, never in this repo.

This is also the sealed eval for tools/skill_route_phrases.py: it learns trigger phrases from the
train split only, and this scores them on held-out (SKILL_ROUTE_PHRASES=off is the control arm).
"""
import argparse
import glob
import json
import os
import re
import statistics
import subprocess
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "bin", "lib"))
import transcript_rows  # noqa: E402  # mid-turn messages ride in attachment rows
HOOK = os.path.join(ROOT, ".claude", "hooks", "skill-route.sh")
LABELS = os.path.expanduser("~/second-brain/systems/skill-route-eval.jsonl")

NOTIFY = ("<task-notification", "<cross-session-message", "<side-sessions-event", "Stop hook feedback",
          "<ci-monitor-event", "SYSTEM NOTIFICATION")


def kind_of(text):
    if any(m in text[:400] for m in NOTIFY):
        return "notification"
    if "Background (from the session that started this one)" in text or text.startswith("Manager tab"):
        return "brief"
    return "typed"


def user_texts(path):
    with open(path, errors="replace") as f:
        for line in f:
            try:
                row = transcript_rows.as_user_row(json.loads(line))
            except ValueError:
                continue
            if row.get("type") != "user" or row.get("isMeta"):
                continue
            content = (row.get("message") or {}).get("content")
            if isinstance(content, list):
                if any(isinstance(c, dict) and c.get("type") == "tool_result" for c in content):
                    continue
                content = "\n".join(c.get("text", "") for c in content
                                    if isinstance(c, dict) and c.get("type") == "text")
            if not isinstance(content, str):
                continue
            text = content.strip()
            # Harness-injected turns, not something anyone typed or a tool sent.
            if not text or text.startswith(("<command-", "<local-command", "Caveat:", "[Request interrupted")):
                continue
            yield row.get("timestamp", ""), text


def extract(days, out):
    cutoff = time.time() - days * 86400
    seen, rows = set(), []
    for path in glob.glob(os.path.expanduser("~/.claude/projects/*/*.jsonl")):
        if os.path.getmtime(path) < cutoff:
            continue
        for ts, text in user_texts(path):
            key = re.sub(r"\s+", " ", text)[:300]
            if key in seen:
                continue
            seen.add(key)
            rows.append({"ts": ts, "kind": kind_of(text), "text": text[:4000],
                         "session": os.path.basename(path)[:-6]})
    rows.sort(key=lambda r: r["ts"])
    with open(out, "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    counts = {}
    for r in rows:
        counts[r["kind"]] = counts.get(r["kind"], 0) + 1
    print(json.dumps({"rows": len(rows), "by_kind": counts, "out": out}))


def route_once(text, env):
    payload = json.dumps({"prompt": text, "session_id": "routeeval", "cwd": ROOT})
    t0 = time.perf_counter()
    try:
        out = subprocess.run(["bash", HOOK], input=payload, capture_output=True, text=True, env=env, timeout=30)
    except subprocess.TimeoutExpired:
        # A stalled run is counted as silent and slow, never dropped: the hook's own watchdog
        # kills it at 5s in real use, so it said nothing there either.
        out = subprocess.CompletedProcess([], 124, "", "")
    ms = (time.perf_counter() - t0) * 1000
    try:
        context = json.loads(out.stdout)["hookSpecificOutput"]["additionalContext"]
    except (ValueError, KeyError, TypeError):
        context = ""
    shown = re.findall(r"^  (\S+)  \(", context, re.M)
    marker = os.path.join(env["CHEWBACCA_HOME"], "state", "skill-required-routeeval")
    required = []
    if os.path.exists(marker):
        with open(marker) as f:
            required = f.read().split()
        os.remove(marker)
    # The hook's own shadow row: top candidates with scores and the big-work probe's p, so a
    # threshold can be swept on train without rerunning the hook.
    shadow = {}
    try:
        with open(env["ROUTE_SHADOW_LOG"]) as f:
            lines = f.read().splitlines()
        shadow = json.loads(lines[-1]) if lines else {}
        os.remove(env["ROUTE_SHADOW_LOG"])
    except (OSError, ValueError):
        pass
    return {"shown": shown, "required": required, "ms": ms, "chars": len(context), "candidates": shadow.get("candidates") or [],
            "bigwork_p": shadow.get("bigwork_p"), "gate": shadow.get("gate"), "method": shadow.get("method")}


def pct(n, d):
    return round(100.0 * n / d, 1) if d else None


def score(rows):
    """Precision, false fires, nudge tokens and latency come from the random sample only, the real
    mix of traffic; rows sampled because they looked skill-shaped ("sample": "targeted") would
    inflate them. Recall uses every positive, random and targeted."""
    rand = [r for r in rows if r.get("sample", "random") == "random"]
    shown = [r for r in rand if r["got"]["shown"]]
    correct = [r for r in shown if r["got"]["shown"][0] == r["label"]]
    positives = [r for r in rows if r["label"] != "NONE"]
    found = [r for r in positives if r["got"]["shown"] and r["got"]["shown"][0] == r["label"]]
    typed_none = [r for r in rand if r["label"] == "NONE" and r["kind"] not in ("notification", "machine")]
    # Machine traffic: harness notifications, cross-session messages, and prompts a tool sends
    # (commit security review, sidebar titles), none of which anyone typed.
    notes = [r for r in rand if r["kind"] in ("notification", "machine")]
    gated = [r for r in rand if r["got"]["required"]]
    big = [r for r in rand if r.get("big")]
    ms = sorted(r["got"]["ms"] for r in rand)
    return {
        "n": len(rows), "random": len(rand), "positives": len(positives), "shown": len(shown),
        "correct": len(correct), "precision": pct(len(correct), len(shown)),
        "recall": pct(len(found), len(positives)),
        "false_fire_none_typed": pct(len([r for r in typed_none if r["got"]["shown"]]), len(typed_none)),
        "false_fire_notification": pct(len([r for r in notes if r["got"]["shown"] or r["got"]["required"]]),
                                       len(notes)),
        # Characters of injected nudge text / 4, a rough token count, per 100 random prompts.
        "nudge_tokens_per_100": round(sum(r["got"].get("chars", 0) for r in rand) / 4 * 100 / len(rand))
        if rand else None,
        "gate_armed": len(gated),
        "gate_big": len([r for r in gated if r.get("big")]),
        "gate_precision": pct(len([r for r in gated if r.get("big")]), len(gated)),
        "gate_recall": pct(len([r for r in big if r["got"]["required"]]), len(big)),
        "p50_ms": round(statistics.median(ms)) if ms else None,
        "p95_ms": round(ms[int(0.95 * (len(ms) - 1))]) if ms else None,
    }


def load(labels, split):
    with open(labels) as f:
        rows = [json.loads(line) for line in f if line.strip()]
    return [r for r in rows if r.get("label") and (split == "all" or r.get("split") == split)]


def hook_env(overrides=()):
    home = tempfile.mkdtemp(prefix="routeeval-")
    os.makedirs(os.path.join(home, "state"))
    # The catalog's vector cache lives under CHEWBACCA_HOME; point at the real one so a run
    # doesn't re-embed 200 skills, and keep state (markers, loaded lists) in the temp dir.
    real = os.path.expanduser(os.environ.get("CHEWBACCA_HOME", "~/.chewbacca"))
    for sub in ("cache", "skills"):
        os.symlink(os.path.join(real, sub), os.path.join(home, sub))
    env = dict(os.environ, CHEWBACCA_HOME=home, CHEWBACCA_VERDICTS="0",
               ROUTE_SHADOW_LOG=os.path.join(home, "shadow.jsonl"))
    for kv in overrides or ():
        k, _, v = kv.partition("=")
        env[k] = v
    return env


def run(labels, split, overrides=(), as_json=False, show_misses=False, dump=None):
    rows = load(labels, split)
    env = hook_env(overrides)
    for r in rows:
        r["got"] = route_once(r["text"], env)
    result = score(rows)
    if dump:
        with open(dump, "w") as f:
            for r in rows:
                f.write(json.dumps(r) + "\n")
    if show_misses:
        for r in rows:
            got = r["got"]["shown"][0] if r["got"]["shown"] else "-"
            want = r["label"] if r["label"] != "NONE" else "-"
            if got != want or r["got"]["required"]:
                gate = " GATE" if r["got"]["required"] else ""
                print(f"  {r['kind'][:5]:5}  want {want:<22} got {got:<22}{gate} {r['text'][:70]!r}",
                      file=sys.stderr)
    print(json.dumps(result) if as_json else "\n".join(f"{k:>24}  {v}" for k, v in result.items()))
    return result


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("extract")
    e.add_argument("--days", type=float, default=7)
    e.add_argument("--out", default=os.path.expanduser("~/.chewbacca/state/skill-route-candidates.jsonl"))
    r = sub.add_parser("run")
    r.add_argument("--labels", default=LABELS)
    r.add_argument("--split", default="held", choices=["held", "train", "all"])
    r.add_argument("--set", action="append", help="env override for the hook, e.g. SKILL_ROUTE_VEC_MIN=0.5")
    r.add_argument("--json", action="store_true")
    r.add_argument("--misses", action="store_true")
    r.add_argument("--dump", help="write each row with what the hook did, for a sweep (holds prompts: keep private)")
    a = ap.parse_args(argv)
    if a.cmd == "extract":
        return extract(a.days, a.out)
    return run(a.labels, a.split, a.set, a.json, a.misses, a.dump)


if __name__ == "__main__":
    main()
