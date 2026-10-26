#!/usr/bin/env python3
"""Count how often Caleb had to steer an agent on one day.

    python3 tools/steering_rate.py                 today
    python3 tools/steering_rate.py --day 2026-10-17
    python3 tools/steering_rate.py --day 2026-10-17 --list     every message with its class
    python3 tools/steering_rate.py --json

Reads every Claude Code transcript (~/.claude/projects/*/*.jsonl) and Codex
rollout (~/.codex/sessions/**) touched that day, keeps only messages he typed
(hook injections, other sessions' messages, skill bodies and programmatic
prompts are dropped), and labels each one by pattern:

    steer:<cluster>   a correction, a push, a rule he had to state
    poll              "We good?", "?": he had to ask where things stood
    task              everything else: a new ask, an answer, a pasted transcript

The number to beat is steering per active agent hour. Active hours sum each
session's gaps between consecutive transcript rows, each gap capped at 10
minutes, so a tab left open over lunch doesn't count as work.

The patterns are written from his 2026-10-16 messages, hand-labelled in
team/memory/feedback_caleb_steering_2026_10_16.md. A pattern list misses new
wordings, so read --list before trusting a drop.
"""
from __future__ import annotations

import argparse
import datetime as dt
import glob
import json
import os
import re
import sys
from collections import Counter, defaultdict
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "bin", "lib"))
import transcript_rows  # noqa: E402  # mid-turn messages ride in attachment rows

LA = ZoneInfo("America/Los_Angeles")
# A gap over 10 minutes between rows is a tab sitting idle, not work. Guessed,
# never measured: 10/16's longest real tool run seen was about 8 minutes.
GAP_CAP_S = 600

REMINDER = re.compile(r"<system-reminder>.*?</system-reminder>", re.S)
NOT_HIM = (
    "Another Claude session sent", "<cross-session-message", "Stop hook feedback",
    "Review this change for security", "<task-notification>", "Base directory for this skill",
    "You previously flagged", "You run outbound for a client", "Task (from the session",
    "Background (from the session", "Your response above was", "[Request interrupted",
    "<command-", "<local-command", "Caveat:", "This session is being continued",
    "<side-sessions-event>", "<ci-monitor-event>", "# AGENTS.md instructions",
    "<environment_context>", "<user_instructions>", "Answer with exactly",
)

# Ordered: the first cluster that matches wins.
CLUSTERS = [
    ("learn_ritual", r"learn and remember|save everything needed to pick|so i can pick ?(it )?up .* (next time|diff tab)"),
    ("stopped_early", r"\block (tf )?in\b|are you done|did you do all|no more work|noting more|nothing more you could"
                      r"|still way too much work|do everything (we|you) (can|should)|any other work|don't stop doing"
                      r"|incomplete|never take no for an answer"),
    ("silent_progress", r"where'?s the reply|what have you been doing|\d+ mins doing what"),
    ("not_managing", r"haven'?t been managing|tell the \w+ tab|i just ch\w*ked in|self sustaining|monkey see"),
    ("missed_capability", r"why can'?t you do it|jev browser|reverse engineered|we have graph engineering"
                          r"|should i go to vscode|u hv jev|where tf is the|not understanding what to do|what do i do to each row"),
    ("unchecked_claim", r"where did u get|was my pitch even accurate|why are there \d+|perplexity\?|i don'?t use either"
                        r"|is \S+% actually|was slop|how is it still"),
    ("permission_ask", r"^i approve\b|^approve\b|asking for permission|never ask for permission|feel free to deploy"
                       r"|^yes,? (verify|force|do it)\b|so we never have to do it|confused by the ask|^do wtv is best"),
    ("not_reusable", r"repeatable|productiz|computer being open|on a loop|for anyone that uses"),
    ("be_smarter", r"be innovative|clay wizard|never have to tell you|actually smart|absolutely killer|be efficient"
                   r"|not so narrow"),
    ("quality_slop", r"\bslop\b|too much text|\bawful\b|not as goated|doesn'?t aura|more aura|unorganized"
                     r"|not impressive|looks? impressive|be methodical|brute forced|sounds awful"),
]
POLL = re.compile(r"^(we good|good to send|\?+|all good|status|almost done)\??\s*$|^roughly how long till", re.I)


def classify(text: str) -> str:
    low = text.lower().strip()
    if POLL.match(low):
        return "poll"
    if low.startswith("<pasted_content"):
        return "task"
    for name, pat in CLUSTERS:
        if re.search(pat, low, re.M):
            return "steer:" + name
    return "task"


def _his_words(text: str) -> str | None:
    t = REMINDER.sub("", text).strip()
    if not t or t.startswith(NOT_HIM):
        return None
    if "\n\n(Say " in t and len(t) < 300:      # onboarding eval prompts
        return None
    return t


def _ts(raw: str) -> dt.datetime | None:
    try:
        return dt.datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        return None


def collect(day: str, claude_glob: str, codex_glob: str) -> tuple[list[dict], dict[str, float]]:
    start = dt.datetime.fromisoformat(day).replace(tzinfo=LA)
    end = start + dt.timedelta(days=1)
    msgs: list[dict] = []
    active: dict[str, float] = defaultdict(float)

    def track(sid: str, stamps: list[dt.datetime]) -> None:
        stamps.sort()
        for a, b in zip(stamps, stamps[1:]):
            active[sid] += min((b - a).total_seconds(), GAP_CAP_S)

    for path in glob.glob(os.path.expanduser(claude_glob)):
        if os.path.getmtime(path) < start.timestamp():
            continue
        stamps: list[dt.datetime] = []
        sid = os.path.basename(path)[:-6]
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                t = _ts(row.get("timestamp", ""))
                if not t or not (start <= t < end):
                    continue
                stamps.append(t)
                row = transcript_rows.as_user_row(row)
                if row.get("type") != "user" or row.get("isMeta") or row.get("isSidechain"):
                    continue
                content = (row.get("message") or {}).get("content")
                if isinstance(content, list):
                    if any(isinstance(b, dict) and b.get("type") == "tool_result" for b in content):
                        continue
                    content = " ".join(b.get("text", "") for b in content
                                       if isinstance(b, dict) and b.get("type") == "text")
                if isinstance(content, str) and (words := _his_words(content)):
                    msgs.append({"runtime": "claude", "session": sid, "t": t, "text": words})
        track(sid, stamps)

    for path in glob.glob(os.path.expanduser(codex_glob), recursive=True):
        if os.path.getmtime(path) < start.timestamp():
            continue
        stamps = []
        sid = "codex-" + os.path.basename(path)[-42:-6]
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                t = _ts(row.get("timestamp", ""))
                if not t or not (start <= t < end):
                    continue
                stamps.append(t)
                p = row.get("payload") or {}
                if p.get("type") == "message" and p.get("role") == "user":
                    words = " ".join(b.get("text", "") for b in p.get("content") or [] if isinstance(b, dict))
                    if (words := _his_words(words)) and not words.startswith("<"):
                        msgs.append({"runtime": "codex", "session": sid, "t": t, "text": words})
        track(sid, stamps)

    seen, out = set(), []
    for m in sorted(msgs, key=lambda m: m["t"]):
        key = (m["session"], m["text"][:200])
        if key not in seen:
            seen.add(key)
            m["label"] = classify(m["text"])
            out.append(m)
    return out, dict(active)


def summarize(msgs: list[dict], active: dict[str, float]) -> dict:
    labels = Counter(m["label"] for m in msgs)
    steer = [m for m in msgs if m["label"].startswith("steer:")]
    talked = {m["session"] for m in msgs}
    hours = sum(active.get(s, 0) for s in talked) / 3600
    return {
        "messages": len(msgs),
        "sessions_he_typed_in": len(talked),
        "active_agent_hours": round(hours, 1),
        "steering": len(steer),
        "polls": labels.get("poll", 0),
        "steering_per_active_hour": round(len(steer) / hours, 2) if hours else None,
        "steering_per_session": round(len(steer) / len(talked), 2) if talked else None,
        "clusters": dict(Counter(m["label"][6:] for m in steer).most_common()),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--day", default=dt.datetime.now(LA).strftime("%Y-%m-%d"))
    ap.add_argument("--list", action="store_true", help="print every message with its label")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--claude-glob", default="~/.claude/projects/*/*.jsonl")
    ap.add_argument("--codex-glob", default="~/.codex/sessions/**/*.jsonl")
    a = ap.parse_args()
    msgs, active = collect(a.day, a.claude_glob, a.codex_glob)
    if a.list:
        for m in msgs:
            print(f"{m['t'].astimezone(LA):%H:%M} {m['session'][:8]} {m['label']:<24} {m['text'][:110]!r}")
    s = summarize(msgs, active)
    if a.json:
        print(json.dumps({"day": a.day, **s}, indent=1))
    else:
        print(f"{a.day}: {s['steering']} steering messages in {s['active_agent_hours']} active agent hours "
              f"= {s['steering_per_active_hour']}/hour, {s['steering_per_session']}/session "
              f"({s['sessions_he_typed_in']} sessions, {s['messages']} messages, {s['polls']} status polls)")
        for k, v in s["clusters"].items():
            print(f"  {v:>3}  {k}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
