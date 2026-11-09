#!/usr/bin/env python3
"""Before a repo goes public: every piece of personal content in it and in its
history, listed by file and commit so the owner can decide. Read only.

    python3 tools/public_scan.py [--repo <path>] [--out <dir>] [--names <file>]
                                 [--owner "<your name>"] [--people-db <path>] [--json]

It changes nothing: no file in the repo, no commit, no ref, no visibility. The
findings hold the very content they warn about, so they go to a private folder
outside the repo (default ~/.chewbacca/public-scan/, made 0700), never into it.

What counts as personal, and where each signal comes from:
  person       a real person's full name, from the user's own people store
               (~/.chewbacca/people/people.db) and --names; the owner's own
               name is counted apart, since a public author is expected
  phone        a number in the people store (exact digits), or phone-shaped
  email        an address in the people store, or any address that isn't a
               noreply, example or test one
  health       diagnosis, hospital, medication and leave words
  school       course codes from the user's coursework ledger, school
               systems (Brightspace, syllabus), and .edu addresses
  texts        files that read like a message dump: several store phones or
               emails, or message-database fields
  brain        notes in the second-brain shape: memory frontmatter
               (type: user / feedback / project), or a memory/ path
  secret       key-shaped strings (AWS, GitHub, Anthropic, OpenAI, Slack, PEM)
  author       every commit author's name and address (they go public too),
               and the same checks over every commit message

Scope: the files at the tip of origin/main, and every other version of every
file on origin's branches (what GitHub would serve once public). Branches that
exist only on this Mac are not scanned unless --all-refs.

Exit codes: 0 scanned (hits or not), 2 usage, 1 git failed.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Dict, Iterable, Iterator, List, Optional, Set, Tuple

ROOT = Path(__file__).resolve().parent.parent
# Larger blobs are listed as skipped, not read: the 10/13 scan of this repo
# found its biggest text files (generated indexes) under 4 MB; 5 MB is a
# guessed ceiling above that.
MAX_BLOB = 5 * 1024 * 1024

PHONE_RE = re.compile(r"(?<![\w.])(?:\+?1[\s.-]?)?(?:\(([2-9]\d{2})\)\s?|([2-9]\d{2})[\s.-])(\d{3})[\s.-](\d{4})(?![\w])")
# Ten or eleven bare digits: everywhere in ids and timestamps, so a hit only
# when the number is in the people store. 941 of 1,170 store phones are
# written this way (review, 10/13), and a dump of the store looks like this.
BARE_PHONE_RE = re.compile(r"(?<![\w.])\+?1?([2-9]\d{9})(?!\d)")
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
NOT_PERSONAL_EMAIL = re.compile(
    r"(noreply|no-reply|example\.(com|org|net)|@test\.|@localhost|\.invalid$|\.test$|@users\.noreply\.github\.com"
    r"|@email\.com$|@domain\.com$|@company\.com$|@acme\.|@anthropic\.com$|@openai\.com$|@sentry|@[a-z0-9-]+\.local$"
    r"|^git@|@2x\.|@[0-9.]+$|^[a-z0-9.-]+@[0-9])", re.I)
HEALTH_RE = re.compile(
    r"\b(bipolar|hospitali[sz]ed|hospitali[sz]ation|psychiatr\w*|manic|mania|depress(ion|ive)|anxiety disorder"
    r"|diagnos(ed|is)|medication|lithium|lamotrigine|seroquel|adderall|therap(y|ist)|medical leave|leave of absence"
    r"|autis(m|tic)|adhd|suicid\w*|OSAS|accommodation letter)\b", re.I)
SCHOOL_WORDS = re.compile(r"\b(brightspace|syllabus|syllabi|transcript of records|GPA|midterm|final exam|office hours)\b", re.I)
EDU_EMAIL = re.compile(r"@[A-Za-z0-9.-]+\.edu\b", re.I)
TEXT_FIELDS = re.compile(r"\b(is_from_me|handle_id|chat_identifier|attributedBody|cache_roomnames)\b")
BRAIN_FRONTMATTER = re.compile(r"^\s*type:\s*(user|feedback|project|reference)\s*$", re.M)
SECRET_RE = re.compile(
    r"(AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36,}|sk-ant-[A-Za-z0-9_-]{20,}|sk-(proj-)?[A-Za-z0-9]{32,}"
    r"|xox[abpr]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)")
WORD = re.compile(r"[A-Z][a-z'’-]+")


def git(repo: Path, *args: str, text: bool = True) -> str:
    done = subprocess.run(["git", "-C", str(repo)] + list(args), capture_output=True, text=text)
    if done.returncode != 0:
        raise RuntimeError(f"git {' '.join(args[:3])} failed: {(done.stderr or '')[:200]}")
    return done.stdout


# ── who counts as a real person ─────────────────────────────────────────────

def people_from_db(path: Path) -> Tuple[Set[str], Set[str], Set[str]]:
    """Full names, phone digit strings (last 10) and emails from the people
    store. Opened immutable: read only, and no lock on a live WAL database."""
    names: Set[str] = set()
    phones: Set[str] = set()
    emails: Set[str] = set()
    if not path.is_file():
        return names, phones, emails
    try:
        con = sqlite3.connect(f"file:{path}?immutable=1", uri=True)
        rows = con.execute("select name, phone, email from people where deleted_at is null").fetchall()
        con.close()
    except sqlite3.Error:
        return names, phones, emails
    for name, phone, email in rows:
        full = full_name(name or "")
        if full:
            names.add(full)
        # Split only between numbers: "+1 310 555 0142" is one number, and a
        # whitespace split made four pieces and loaded none (3 rows, 10/13).
        for raw in re.split(r"[,;/]+", phone or ""):
            d = re.sub(r"\D", "", raw)[-10:]
            if len(d) == 10:
                phones.add(d)
        for e in EMAIL_RE.findall(email or ""):
            emails.add(e.lower())
    return names, phones, emails


def full_name(name: str) -> Optional[str]:
    """'Sagar Tiwari' -> 'Sagar Tiwari'; a single word, a handle, a company or
    a name with digits is not a full name and would only make noise."""
    parts = name.strip().split()
    if not 2 <= len(parts) <= 3:
        return None
    if not all(WORD.fullmatch(p) and len(p) >= 2 for p in parts):
        return None
    return " ".join(parts)


def owner_names(repo: Path) -> Set[str]:
    """The repo owner's own name, from git config: counted, not listed."""
    out = set()
    for key in ("user.name",):
        try:
            v = git(repo, "config", key).strip()
        except RuntimeError:
            continue
        if full_name(v):
            out.add(full_name(v))
    return out


def course_codes(ledger: Path) -> Set[str]:
    """Course codes from the coursework ledger's folder names (ACAD 185)."""
    codes = set()
    courses = ledger / "courses"
    if courses.is_dir():
        for p in courses.iterdir():
            m = re.match(r"([A-Za-z]{2,5})[-_ ]?(\d{3}[A-Za-z]?)", p.name)
            if m:
                codes.add(f"{m.group(1).upper()} {m.group(2).upper()}")
    return codes


# ── reading the repo ────────────────────────────────────────────────────────

UNSCANNED: List[str] = []


def pr_heads(repo: Path) -> List[str]:
    """GitHub also serves refs/pull/*: a deleted branch stays readable there
    after fetch.prune drops it here. The ones whose commits are on this Mac
    are scanned; the rest are counted as not scanned, never guessed at.
    Read only: ls-remote writes no ref."""
    try:
        out = subprocess.run(["git", "-C", str(repo), "ls-remote", "origin", "refs/pull/*"],
                             capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        UNSCANNED.append("refs/pull/* (ls-remote failed)")
        return []
    have = []
    for line in out.stdout.splitlines():
        sha, _, ref = line.partition("\t")
        ok = subprocess.run(["git", "-C", str(repo), "cat-file", "-e", sha + "^{commit}"],
                            capture_output=True).returncode == 0
        (have if ok else UNSCANNED).append(sha if ok else ref)
    return have


def head_files(repo: Path, rev: str) -> Dict[str, str]:
    """path -> blob at rev."""
    out = {}
    for line in git(repo, "ls-tree", "-r", "--full-tree", rev).splitlines():
        meta, _, path = line.partition("\t")
        parts = meta.split()
        if len(parts) == 3 and parts[1] == "blob":
            out[path] = parts[2]
    return out


def history_blobs(repo: Path, refs: List[str]) -> Dict[str, Tuple[str, str]]:
    """blob -> (path, oldest commit that wrote it), over every commit on refs."""
    seen: Dict[str, Tuple[str, str]] = {}
    # -m: a merge that resolved a conflict holds the only copy of the
    # resolved file, and plain --raw lists no merge at all (review, 10/13:
    # 159 merges on origin/main).
    log = git(repo, "log", "-m", "--raw", "--no-renames", "--no-abbrev", "--reverse", "--format=commit %H", *refs)
    commit = ""
    for line in log.splitlines():
        if line.startswith("commit "):
            commit = line[7:].strip()
            continue
        if not line.startswith(":"):
            continue
        meta, _, path = line.partition("\t")
        parts = meta.split()
        if len(parts) < 5 or parts[4].startswith("D"):
            continue
        blob = parts[3]
        if blob not in seen and set(blob) != {"0"}:
            seen[blob] = (path, commit)
    return seen


def read_blobs(repo: Path, blobs: Iterable[str]) -> Iterator[Tuple[str, Optional[bytes], int]]:
    """(blob, bytes or None when skipped, size), through one cat-file process."""
    blobs = list(blobs)
    proc = subprocess.Popen(["git", "-C", str(repo), "cat-file", "--batch"], stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE)
    assert proc.stdin and proc.stdout

    def feed():
        for b in blobs:
            proc.stdin.write((b + "\n").encode())
        proc.stdin.close()
    import threading  # noqa: PLC0415
    threading.Thread(target=feed, daemon=True).start()
    for _ in blobs:
        header = proc.stdout.readline().decode().split()
        if len(header) < 3:
            continue
        sha, _kind, size = header[0], header[1], int(header[2])
        data = proc.stdout.read(size)
        proc.stdout.read(1)
        yield sha, (data if size <= MAX_BLOB else None), size
    proc.wait()


# ── what counts as a hit ────────────────────────────────────────────────────

class Signals:
    def __init__(self, names: Set[str], phones: Set[str], emails: Set[str], owner: Set[str],
                 codes: Set[str]):
        self.names = names
        self.phones = phones
        self.emails = emails
        self.owner = owner
        self.codes = codes
        self.firsts = {n.split()[0] for n in names | owner}
        self.code_re = re.compile(r"\b(" + "|".join(re.escape(c).replace(r"\ ", r"[ -]?") for c in sorted(codes))
                                  + r")\b") if codes else None


def mask(s: str) -> str:
    """Enough to recognise, not enough to copy: a@b.com -> a***@b.com, digits
    keep the last four."""
    if "@" in s:
        user, _, dom = s.partition("@")
        return (user[:1] + "***@" + dom) if user else s
    d = re.sub(r"\D", "", s)
    return "***-***-" + d[-4:] if len(d) >= 7 else s


def scan_text(text: str, path: str, sig: Signals) -> List[dict]:
    hits: List[dict] = []
    lowered_path = path.lower()

    def add(kind, line_no, found, severity="review", why=""):
        hits.append({"kind": kind, "line": line_no, "found": found, "severity": severity, "why": why})

    if BRAIN_FRONTMATTER.search(text[:600]) or "/memory/" in "/" + lowered_path:
        add("brain", 1, path, "high", "memory-note shape (frontmatter type or a memory/ path)")
    store_contacts = 0
    for i, line in enumerate(text.splitlines(), 1):
        if len(line) > 4000:
            line = line[:4000]
        for m in PHONE_RE.finditer(line):
            d = "".join(g for g in m.groups() if g)
            if d in sig.phones:
                store_contacts += 1
                add("phone", i, mask(m.group(0)), "high", "a number in your people store")
            elif not re.search(r"\d{4}-\d{2}-\d{2}|\b(sha|0x|v\d)", line, re.I):
                add("phone", i, mask(m.group(0)), "review", "phone-shaped")
        for m in BARE_PHONE_RE.finditer(line):
            if m.group(1) in sig.phones:
                store_contacts += 1
                add("phone", i, mask(m.group(0)), "high", "a number in your people store, digits only")
        for e in EMAIL_RE.findall(line):
            el = e.lower()
            if el in sig.emails:
                store_contacts += 1
                add("email", i, mask(e), "high", "an address in your people store")
            elif EDU_EMAIL.search(e):
                add("school", i, mask(e), "high", "a school address")
            elif not NOT_PERSONAL_EMAIL.search(e):
                add("email", i, mask(e), "review", "an address")
        words = WORD.findall(line) if sig.firsts else []
        if words and not sig.firsts.isdisjoint(words):
            for n in (2, 3):
                for j in range(len(words) - n + 1):
                    cand = " ".join(words[j:j + n])
                    if cand in sig.owner:
                        add("owner", i, cand, "info", "your own name")
                    elif cand in sig.names:
                        add("person", i, cand, "high", "a full name in your people store")
        for m in HEALTH_RE.finditer(line):
            add("health", i, m.group(0), "high")
        for m in SCHOOL_WORDS.finditer(line):
            add("school", i, m.group(0), "review")
        if sig.code_re:
            for m in sig.code_re.finditer(line):
                add("school", i, m.group(0), "high", "a course code from your ledger")
        if TEXT_FIELDS.search(line):
            add("texts", i, TEXT_FIELDS.search(line).group(0), "review", "message-database field")
        for m in SECRET_RE.finditer(line):
            add("secret", i, m.group(0)[:8] + "...", "high", "key-shaped")
    if store_contacts >= 5:
        add("texts", 1, path, "high", f"{store_contacts} contacts from your people store in one file")
    return hits


# ── the run ─────────────────────────────────────────────────────────────────

def scan(repo: Path, sig: Signals, refs: List[str], tip: str, log=print) -> dict:
    files = head_files(repo, tip)
    in_tip = {b for b in files.values()}
    history = history_blobs(repo, refs)
    old = {b: pc for b, pc in history.items() if b not in in_tip}
    log(f"public_scan: {len(files)} files at {tip}, {len(old)} older versions on {' '.join(refs)}")
    where: Dict[str, List[Tuple[str, Optional[str]]]] = defaultdict(list)
    for path, b in files.items():
        where[b].append((path, None))
    for b, (path, commit) in old.items():
        where[b].append((path, commit))
    hits: List[dict] = []
    skipped: List[dict] = []
    for blob, data, size in read_blobs(repo, list(where)):
        if data is None:
            for path, commit in where[blob]:
                skipped.append({"path": path, "commit": commit, "bytes": size})
            continue
        if b"\0" in data[:8000]:
            continue
        text = data.decode("utf-8", "replace")
        for path, commit in where[blob]:
            for h in scan_text(text, path, sig):
                hits.append({**h, "path": path, "commit": commit, "where": "tip" if commit is None else "history"})
    # Commit messages and author addresses go public with the history too.
    authors: Counter = Counter()
    log = git(repo, "log", "--format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%B%x01", *refs)
    for rec in log.split("\x01"):
        parts = rec.strip("\n").split("\x00")
        if len(parts) < 6:
            continue
        sha, body = parts[0].strip(), parts[5]
        # The committer goes public too: a rebase or cherry-pick of someone
        # else's commit leaves your address there.
        authors[(parts[1], parts[2])] += 1
        authors[(parts[3], parts[4])] += 1
        for h in scan_text(body, "(commit message)", sig):
            if h["kind"] != "brain":
                hits.append({**h, "path": "(commit message)", "commit": sha, "where": "history"})
    for (name, email), n in authors.items():
        if email and not NOT_PERSONAL_EMAIL.search(email):
            hits.append({"kind": "author", "line": 0, "found": f"{name} <{mask(email)}>", "severity": "review",
                         "why": f"author or committer of {n} commit(s); public with the history", "path": "(commit author)",
                         "commit": None, "where": "history"})
    return {"tip": tip, "refs": refs, "files": len(files), "older_versions": len(old), "hits": hits,
            "skipped": skipped}


def summary(result: dict) -> str:
    hits = result["hits"]
    by_kind = Counter(h["kind"] for h in hits)
    lines = [f"# Public-readiness scan, {time.strftime('%Y-%m-%d %H:%M')}", "",
             "Read only: nothing was changed, committed or made public. Each hit names the file, and for an",
             "older version the commit that wrote it, so you can decide. The owner's own name is counted, not listed.",
             "", f"Scanned {result['files']} files at {result['tip']} and {result['older_versions']} older versions"
             f" on {' '.join(result['refs'])}.", ""]
    lines.append("| kind | hits | files |")
    lines.append("| --- | --- | --- |")
    for kind in ("person", "phone", "email", "health", "school", "texts", "brain", "secret", "author", "owner"):
        hs = [h for h in hits if h["kind"] == kind]
        lines.append(f"| {kind} | {len(hs)} | {len({(h['path'], h['commit']) for h in hs})} |")
    lines.append("")
    for kind in ("secret", "phone", "email", "health", "texts", "brain", "person", "school", "author"):
        hs = [h for h in hits if h["kind"] == kind and h["severity"] != "info"]
        if not hs:
            continue
        lines += [f"## {kind} ({by_kind[kind]})", ""]
        groups: Dict[Tuple[str, Optional[str]], List[dict]] = defaultdict(list)
        for h in hs:
            groups[(h["path"], h["commit"])].append(h)
        ranked = sorted(groups.items(), key=lambda kv: (-sum(x["severity"] == "high" for x in kv[1]), -len(kv[1])))
        for (path, commit), group in ranked[:60]:
            sample = sorted({g["found"] for g in group})[:6]
            at = f"line {group[0]['line']}" if commit is None else f"commit {commit[:10]}"
            high = sum(g["severity"] == "high" for g in group)
            lines.append(f"- `{path}` ({at}): {len(group)} hit(s), {high} high: " + ", ".join(sample))
        if len(ranked) > 60:
            lines.append(f"- ... {len(ranked) - 60} more files, all in hits.jsonl")
        lines.append("")
    if UNSCANNED:
        lines += ["## Not scanned (on GitHub, not on this Mac)", ""] + [f"- `{u}`" for u in UNSCANNED[:40]] + [""]
    if result["skipped"]:
        lines += ["## Not read (over 5 MB)", ""] + [f"- `{s['path']}` ({s['bytes']:,} bytes)" for s in result["skipped"][:30]]
    return "\n".join(lines) + "\n"


def main(argv: List[str]) -> int:
    ap = argparse.ArgumentParser(description="Personal content in a repo and its history, read only.")
    ap.add_argument("--repo", default=str(ROOT))
    ap.add_argument("--out", default=str(Path.home() / ".chewbacca" / "public-scan"))
    ap.add_argument("--people-db", default=str(Path.home() / ".chewbacca" / "people" / "people.db"))
    ap.add_argument("--names", help="extra full names, one per line")
    ap.add_argument("--owner", action="append", default=[],
                    help="the owner's own full name (repeatable); git's user.name is used when it is one")
    ap.add_argument("--coursework", default=os.environ.get("COURSEWORK_DIR", str(Path.home() / "coursework")))
    ap.add_argument("--all-refs", action="store_true", help="also branches only on this Mac")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    repo = Path(args.repo).resolve()
    out = Path(args.out).expanduser().resolve()
    if out == repo or repo in out.parents:
        print("public_scan: --out must be outside the repo; the findings hold the content", file=sys.stderr)
        return 2
    ours = {"hits.jsonl", "SUMMARY.md"}
    if out.exists() and any(p.name not in ours for p in out.iterdir()):
        print(f"public_scan: {out} holds other files; pick an empty folder for the findings", file=sys.stderr)
        return 2
    names, phones, emails = people_from_db(Path(args.people_db).expanduser())
    if args.names:
        names |= {n for n in (full_name(x) for x in Path(args.names).read_text().splitlines()) if n}
    owner = owner_names(repo) | {n for n in (full_name(x) for x in args.owner) if n}
    names -= owner
    sig = Signals(names, phones, emails, owner, course_codes(Path(args.coursework).expanduser()))
    refs = ["--all"] if args.all_refs else ["--remotes=origin", "--tags"] + pr_heads(repo)
    try:
        tip = git(repo, "rev-parse", "--short", "origin/main").strip()
        result = scan(repo, sig, refs, "origin/main", log=lambda s: print(s, file=sys.stderr))
    except RuntimeError as err:
        print(f"public_scan: {err}", file=sys.stderr)
        return 1
    result["tip"] = tip
    out.mkdir(parents=True, exist_ok=True)
    os.chmod(out, 0o700)
    with open(out / "hits.jsonl", "w", encoding="utf-8") as f:
        for h in result["hits"]:
            f.write(json.dumps(h) + "\n")
    (out / "SUMMARY.md").write_text(summary(result))
    for p in (out / "hits.jsonl", out / "SUMMARY.md"):
        os.chmod(p, 0o600)
    counts = Counter(h["kind"] for h in result["hits"])
    report = {"tip": tip, "files": result["files"], "older_versions": result["older_versions"],
              "hits": dict(counts), "out": str(out)}
    print(json.dumps(report) if args.json else
          f"public_scan: {sum(counts.values())} hits ({', '.join(f'{k} {v}' for k, v in counts.most_common())}); "
          f"see {out / 'SUMMARY.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
