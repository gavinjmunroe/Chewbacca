#!/usr/bin/env python3
"""A GitHub repo or profile as one card on the glass, with no model and no browser.

docs/plans/NO-APPS.md, build 6: about 700 github.com visits in the measured window
were looks at a repo or a person's profile. "show me owner/repo", or a pasted
github.com URL, draws a card instead:

    repo      description, stars, license bucket, last push, the README's
              first lines, and one primary action
    profile   name and the pinned repos, each row a press that draws that
              repo's card in place (surface rule 5: rows are nodes)

The one action (surface rule 4) is "Open in tree" when the repo is already
under ~/code, which points the HUD's file panel at it, and "Clone to ~/code"
when it is not. A clone runs only on that press, never because a card was
drawn, and never over a folder that exists.

The card closes with its own X (`e closed repo-card`), Escape (the display
resets the glass and sends `x`), or by voice ("close the repo card", and
"close it" while it is up). A click elsewhere on the glass cannot close it:
the overlay is click-through outside its panels by design (hud/CLAUDE.md),
so no click-away event exists to listen for.

Everything a repo's author wrote (description, README, pinned descriptions)
is control-stripped and goes out only inside a JSON string on a `d` line,
so it is drawn as text and never read for instructions
(.claude/rules/untrusted-content.md). A press acts on the card this module
drew, never on a value carried in the event.

`parse` reads and never acts, so `fast_path` in hud-listen can replay a
logged sentence through it. `Board.answer` and `Board.event` act.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from importlib.machinery import SourceFileLoader
from importlib.util import module_from_spec, spec_from_loader
from pathlib import Path
from typing import Callable

REPO_ROOT = Path(__file__).resolve().parents[2]
SURFACE = "repo-card"
# Measured 2026-10-09: `gh api repos/...` 1.17 s, the raw README 0.41 s, the
# pinned-repos GraphQL query 1.18 s. Ten only fires on a hung gh or a dead
# network, and the card says which call it was.
GH_TIMEOUT_S = 10.0
# Guessed, never measured: a shallow repo clones in seconds, a large one in
# a minute or two. Past this the card says the clone did not finish.
CLONE_TIMEOUT_S = 300.0
# GitHub caps pinned items at six.
PINNED_MAX = 6
# The README's first screen: four prose lines, then clipped. Surface rule 2,
# the glance first; the repo is one press away for the rest.
README_LINES = 4
README_CHARS = 360

# GitHub's own rules: a login is 1 to 39 letters, digits or single hyphens; a
# repo name is letters, digits, `.`, `_` and `-`.
LOGIN = r"[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}"
NAME = r"[A-Za-z0-9_.-]{1,100}"
# First path segments on github.com that are pages, not people. A wrong card
# for "github.com/settings" is worse than letting the model have the sentence.
RESERVED = {
    "about", "account", "apps", "codespaces", "collections", "contact", "customer-stories", "dashboard",
    "enterprise", "events", "explore", "features", "gist", "issues", "login", "marketplace",
    "new", "notifications", "orgs", "organizations", "pricing", "pulls", "search", "security", "settings",
    "signup", "site", "sponsors", "team", "topics", "trending", "users",
}

# The 13 rules' rule 11: assume someone else can see the glass. Nothing here
# reads private data beyond what `gh` already returns to its own user.

VERBS = (r"(?:show me|show|pull up|bring up|open|look at|let me see|card for|what(?:'s| is))")
URL = rf"(?:https?://)?(?:www\.)?github\.com/(?P<owner>{LOGIN})(?:/(?P<repo>{NAME}))?/?(?:[#?]\S*)?"
SLUG = rf"(?P<sowner>{LOGIN})\s*(?:/|\bslash\b)\s*(?P<srepo>{NAME})"
TAIL = r"(?:\s+(?:on|from) github)?(?:\s+repo(?:sitory)?)?"
LEAD = r"(?:(?:ok|okay|hey|so|now|please|can you|could you)\s+)*"
REPO_WORD = r"(?:(?:the|this|that)\s+)?(?:(?:github|gh)\s+)?(?:repo(?:sitory)?\s+|project\s+)?"

PASTED = re.compile(rf"^\s*{URL}\s*$", re.I)
ASKED_URL = re.compile(rf"^\s*{LEAD}{VERBS}\s+{REPO_WORD}{URL}{TAIL}\s*[.!?]?\s*$", re.I)
ASKED_SLUG = re.compile(rf"^\s*{LEAD}{VERBS}\s+{REPO_WORD}{SLUG}{TAIL}\s*[.!?]?\s*$", re.I)
ASKED_PROFILE = re.compile(
    rf"^\s*{LEAD}{VERBS}\s+(?:(?:the\s+)?(?:github|gh)\s+(?:profile|user|account)\s+(?:for\s+|of\s+)?(?P<a>{LOGIN})"
    rf"|(?P<b>{LOGIN})(?:'s)?\s+(?:on\s+github|github(?:\s+profile)?))\s*[.!?]?\s*$", re.I)
# Said while the card is up: the generic words count only then, so "close it"
# with no card goes wherever it went before this module existed.
CLOSE_NAMED = re.compile(
    r"^\s*(?:close|hide|dismiss|take down|get rid of)\s+(?:the\s+|that\s+|this\s+)?(?:repo|repository|github)"
    r"(?:\s+card)?\s*[.!]?\s*$", re.I)
CLOSE_GENERIC = re.compile(
    r"^\s*(?:close|hide|dismiss|take down|get rid of)\s+(?:it|that|this|the card|that card|this card)"
    r"(?:\s+down)?\s*[.!]?\s*$|^\s*(?:got it|done with (?:it|that))\s*[.!]?\s*$", re.I)


@dataclass
class Ask:
    kind: str            # "repo", "profile" or "close"
    owner: str = ""
    repo: str = ""

    @property
    def slug(self) -> str:
        return f"{self.owner}/{self.repo}" if self.repo else self.owner


@dataclass
class Outcome:
    ok: bool
    line: str


def _repo_name(raw: str | None) -> str:
    # A sentence's own full stop is not part of the name: "show me x/y."
    name = (raw or "").strip().rstrip(".")
    if name.lower().endswith(".git"):
        name = name[:-4]
    return name


def parse(said: str, card_open: bool = False) -> Ask | None:
    """What a sentence asks this module for, or None. Whole sentences only:
    "summarize the README of github.com/x/y and compare it to z" is a task and
    goes to the model."""
    text = " ".join(str(said or "").replace("’", "'").split())
    if not text or len(text) > 300:
        return None
    if CLOSE_NAMED.match(text) or (card_open and CLOSE_GENERIC.match(text)):
        return Ask("close")
    m = PASTED.match(text) or ASKED_URL.match(text)
    if m:
        owner, repo = m.group("owner"), _repo_name(m.group("repo"))
        if owner.lower() in RESERVED:
            return None
        if repo in ("", ".", ".."):
            return Ask("profile", owner)
        return Ask("repo", owner, repo)
    m = ASKED_SLUG.match(text)
    if m:
        repo = _repo_name(m.group("srepo"))
        if repo in ("", ".", "..") or m.group("sowner").lower() in RESERVED:
            return None
        # "show me 2/3" is a fraction; no repo is worth stealing arithmetic for.
        if m.group("sowner").isdigit() and repo.isdigit():
            return None
        return Ask("repo", m.group("sowner"), repo)
    m = ASKED_PROFILE.match(text)
    if m:
        owner = m.group("a") or m.group("b")
        if owner.lower() in RESERVED or owner.lower() in ("my", "the", "a"):
            return None
        return Ask("profile", owner)
    return None


# --- reading GitHub ------------------------------------------------------------

Runner = Callable[[list, float], "tuple[int, str, str]"]


def run_cli(argv: list, timeout: float) -> tuple[int, str, str]:
    try:
        done = subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError:
        return 127, "", f"{argv[0]} is not installed"
    except subprocess.TimeoutExpired:
        return 124, "", f"took longer than {timeout:.0f}s"
    except OSError as err:
        return 126, "", str(err)
    return done.returncode, done.stdout, done.stderr


CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f  \u0085​-‏‪-‮⁦-⁩]")


def clean(text, limit: int) -> str:
    """Author text made safe to draw: no control or bidi characters, one line,
    clipped."""
    text = " ".join(CONTROL.sub(" ", str(text or "")).split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def gh_error(what: str, code: int, err: str) -> str:
    low = (err or "").lower()
    if code == 127:
        return "gh isn't installed, so GitHub can't be read."
    if code == 124:
        return f"GitHub didn't answer the {what} in {GH_TIMEOUT_S:.0f}s."
    if "not found" in low or "404" in low or "could not resolve to" in low:
        return f"GitHub has no {what} by that name, or it is private to someone else."
    if "auth" in low or "401" in low or "gh auth login" in low:
        return "gh isn't signed in to GitHub."
    first = (err or "no output").strip().splitlines()[0] if (err or "").strip() else "no output"
    return f"GitHub {what} failed: {clean(first, 100)}"


def readme_lines(raw: str, repo: str = "") -> str:
    """The README's first few prose lines, with badges, images, HTML and
    markdown markup taken out. A title that only repeats the repo name goes."""
    out: list[str] = []
    in_fence = False
    in_comment = False
    for line in (raw or "").splitlines():
        s = line.strip()
        if s.startswith("```") or s.startswith("~~~"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        if in_comment:
            if "-->" in s:
                in_comment = False
            continue
        if s.startswith("<!--"):
            in_comment = "-->" not in s
            continue
        if not s or s.startswith(("<", "[![", "![", "|", "---", "===", "***", "> [!")):
            continue
        s = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", s)               # images
        s = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", s)            # links -> their text
        s = re.sub(r"<[^>]+>", "", s)                             # inline html
        heading = bool(re.match(r"^#{1,6}\s", s))
        s = re.sub(r"^#{1,6}\s*", "", s)
        s = re.sub(r"^[-*+]\s+", "", s)
        s = s.replace("**", "").replace("__", "").replace("`", "")
        s = s.strip()
        if not s:
            continue
        if not out and repo and s.casefold().replace(" ", "-") == repo.casefold():
            continue
        # A heading run into the next line reads as one broken sentence.
        if heading and s[-1] not in ".:!?":
            s += "."
        out.append(s)
        if len(out) >= README_LINES:
            break
    return clean(" ".join(out), README_CHARS)


_build_tool = None


def _license_verdict(spdx: str) -> tuple[bool, bool]:
    """(remixable, with_caveat) from tools/oss_apps_build.py's own PERMISSIVE
    list, so this card and the oss registry never disagree on a license."""
    global _build_tool
    if _build_tool is None:
        loader = SourceFileLoader("oss_apps_build_for_repo_card", str(REPO_ROOT / "tools" / "oss_apps_build.py"))
        mod = module_from_spec(spec_from_loader(loader.name, loader))
        loader.exec_module(mod)
        _build_tool = mod
    remixable, caveat = _build_tool.license_verdict(spdx)
    return bool(remixable), caveat is not None


def registry_entry(slug: str) -> dict | None:
    """The oss registry's entry for this repo, which carries a person's read
    of open core and MPL caveats that GitHub's SPDX id cannot."""
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from surfaces import oss  # noqa: PLC0415  heavy, and only needed for a card
        apps = oss.registry(None)["apps"]
    except Exception:  # noqa: BLE001  no registry means GitHub's id alone decides
        return None
    key = slug.casefold()
    return next((a for a in apps if str(a.get("id", "")).casefold() == key), None)


def license_bucket(slug: str, spdx: str | None) -> tuple[str, str]:
    """(bucket, caveat). The oss surface's four buckets: remixable, caveat,
    copyleft, none."""
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from surfaces import oss  # noqa: PLC0415
    except Exception:  # noqa: BLE001
        oss = None
    entry = registry_entry(slug)
    if entry is not None and oss is not None:
        return oss.bucket(entry), str(entry.get("remix_caveat") or "")
    spdx = (spdx or "").strip()
    if not spdx or spdx == "NOASSERTION":
        return "none", ""
    try:
        remixable, caveat = _license_verdict(spdx)
    except Exception:  # noqa: BLE001
        remixable, caveat = False, False
    app = {"license": spdx, "remixable": remixable, "remixable_with_caveat": caveat}
    if oss is not None:
        return oss.bucket(app), ("edited MPL files stay MPL; new files are yours" if caveat else "")
    return ("remixable" if remixable else "caveat" if caveat else "none"), ""


BUCKET_LINE = {
    "remixable": "remixable: build on it and ship it, keep the notice",
    "caveat": "usable with care",
    "copyleft": "copyleft: GPL family, a shipped derivative carries the same license",
    "none": "no license file GitHub could classify",
}


def ago(stamp: str | None, now: datetime) -> str:
    if not stamp:
        return "unknown"
    try:
        moment = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
    except ValueError:
        return "unknown"
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    secs = max(0.0, (now - moment).total_seconds())
    if secs < 3600:
        return f"{max(1, int(secs // 60))}m ago"
    if secs < 86400:
        return f"{int(secs // 3600)}h ago"
    if secs < 45 * 86400:
        return f"{int(secs // 86400)}d ago"
    return moment.astimezone().strftime("%b %-d, %Y")


def stars(n) -> str:
    try:
        n = int(n)
    except (TypeError, ValueError):
        return "?"
    if n >= 1000:
        return f"{n / 1000:.1f}k".replace(".0k", "k")
    return str(n)


def fetch_repo(owner: str, repo: str, run: Runner = run_cli, now: datetime | None = None) -> dict:
    """One card's data: the repo call and the README call in parallel."""
    now = now or datetime.now(timezone.utc)
    slug = f"{owner}/{repo}"
    with ThreadPoolExecutor(max_workers=3) as pool:
        meta_f = pool.submit(run, ["gh", "api", f"repos/{slug}"], GH_TIMEOUT_S)
        readme_f = pool.submit(run, ["gh", "api", "-H", "Accept: application/vnd.github.raw",
                                     f"repos/{slug}/readme"], GH_TIMEOUT_S)
        # The registry (1.6 MB of JSON) and the license list load while gh
        # waits on the network: 0.41 s cold on 2026-10-09, otherwise serial.
        pool.submit(license_bucket, slug, "MIT")
        code, out, err = meta_f.result()
        rcode, rout, rerr = readme_f.result()
    if code != 0:
        return {"kind": "repo", "slug": slug, "error": gh_error("repo", code, err or out)}
    try:
        meta = json.loads(out or "null")
    except json.JSONDecodeError:
        return {"kind": "repo", "slug": slug, "error": "GitHub answered with something that is not JSON."}
    if not isinstance(meta, dict):
        return {"kind": "repo", "slug": slug, "error": "GitHub answered with something that is not a repo."}
    full = str(meta.get("full_name") or slug)
    lic = meta.get("license") if isinstance(meta.get("license"), dict) else {}
    spdx = str(lic.get("spdx_id") or "") if lic else ""
    bucket, caveat = license_bucket(full, spdx)
    if rcode == 0:
        readme = readme_lines(rout, str(meta.get("name") or repo)) or "The README has no prose at the top."
    elif "not found" in (rerr or "").lower() or "404" in (rerr or ""):
        readme = "No README."
    else:
        readme = f"README: {gh_error('README', rcode, rerr)}"
    return {
        "kind": "repo", "slug": clean(full, 140), "owner": clean(full.split("/")[0], 39),
        "name": clean(full.split("/")[-1], 100),
        "description": clean(meta.get("description") or "No description.", 220),
        "stars": stars(meta.get("stargazers_count")),
        "license": clean(spdx if spdx and spdx != "NOASSERTION" else ("other" if lic else "none"), 24),
        "bucket": bucket, "caveat": clean(caveat, 120),
        "pushed": ago(meta.get("pushed_at"), now),
        "private": bool(meta.get("private")), "archived": bool(meta.get("archived")),
        "fork": bool(meta.get("fork")),
        "readme": readme,
    }


PINNED_QUERY = (
    "query($l:String!){repositoryOwner(login:$l){login __typename "
    "... on ProfileOwner{name pinnedItems(first:6,types:REPOSITORY){nodes{... on Repository{"
    "nameWithOwner description stargazerCount pushedAt licenseInfo{spdxId}}}}}}}"
)


def fetch_profile(owner: str, run: Runner = run_cli, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    code, out, err = run(["gh", "api", "graphql", "-f", f"query={PINNED_QUERY}", "-f", f"l={owner}"],
                         GH_TIMEOUT_S)
    if code != 0:
        return {"kind": "profile", "slug": owner, "error": gh_error("profile", code, err or out)}
    try:
        body = json.loads(out or "null")
    except json.JSONDecodeError:
        return {"kind": "profile", "slug": owner, "error": "GitHub answered with something that is not JSON."}
    who = ((body or {}).get("data") or {}).get("repositoryOwner") if isinstance(body, dict) else None
    if not isinstance(who, dict):
        return {"kind": "profile", "slug": owner, "error": gh_error("profile", 1, "not found")}
    nodes = ((who.get("pinnedItems") or {}).get("nodes") or [])[:PINNED_MAX]
    pinned = []
    for node in nodes:
        if not isinstance(node, dict) or not node.get("nameWithOwner"):
            continue
        full = str(node["nameWithOwner"])
        if not re.fullmatch(rf"{LOGIN}/{NAME}", full):
            continue
        spdx = str(((node.get("licenseInfo") or {}).get("spdxId")) or "")
        bucket, _ = license_bucket(full, spdx)
        pinned.append({"id": full, "repo": clean(full.split("/", 1)[1] if full.split("/")[0].casefold()
                                                 == owner.casefold() else full, 40),
                       "stars": stars(node.get("stargazerCount")), "license": bucket,
                       "pushed": ago(node.get("pushedAt"), now),
                       "about": clean(node.get("description") or "", 70)})
    login = clean(who.get("login") or owner, 39)
    return {"kind": "profile", "slug": login, "name": clean(who.get("name") or "", 60),
            "type": "organization" if who.get("__typename") == "Organization" else "user", "pinned": pinned}


# --- what is on disk -----------------------------------------------------------

def code_root(env: dict | None = None) -> Path:
    env = os.environ if env is None else env
    return Path(env.get("KYBER_CODE_ROOT") or Path.home() / "code").expanduser()


REMOTE = re.compile(r"url\s*=\s*\S*github\.com[:/]+([^/\s]+)/([^/\s]+?)(?:\.git)?/?\s*$", re.I | re.M)


def local_path(slug: str, root: Path) -> Path | None:
    """The checkout of this repo under ~/code (one or two levels down, the
    layout code.py reads), matched on the remote URL in .git/config, never on
    the folder's name: two forks share a name."""
    want = slug.casefold()
    try:
        top = sorted(root.iterdir())
    except OSError:
        return None
    dirs: list[Path] = []
    for child in top:
        if child.name.startswith(".") or child.is_symlink() or not child.is_dir():
            continue
        if (child / ".git").is_dir():
            dirs.append(child)
            continue
        try:
            dirs.extend(p for p in sorted(child.iterdir())
                        if not p.name.startswith(".") and not p.is_symlink() and (p / ".git").is_dir())
        except OSError:
            continue
    for repo in dirs:
        try:
            config = (repo / ".git" / "config").read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for owner, name in REMOTE.findall(config):
            if f"{owner}/{name}".casefold() == want:
                return repo
    return None


# --- drawing -------------------------------------------------------------------

def cid(key: str) -> str:
    return f"{SURFACE}-{key}"


def p(key: str) -> str:
    return f"/{SURFACE}/{key}"


def data(pointer: str, value) -> str:
    # json.dumps escapes \n and \r, and ensure_ascii=True escapes U+2028 and
    # friends, so nothing an author wrote can start a second socket line.
    return f"d {pointer} {json.dumps(value, separators=(',', ':'))}"


def comp(key: str, kind: str, **props) -> str:
    parts = ["c", cid(key), kind]
    for name, value in props.items():
        parts.append(f"{name}=@{value[1:]}" if isinstance(value, str) and value.startswith("@/") else
                     f"{name}={json.dumps(value, separators=(',', ':'))}")
    return " ".join(parts)


def loading_lines(ask: Ask) -> list[str]:
    """Drawn before the fetch, so the card is never blank (surface rule 6)."""
    return [
        f"@ {SURFACE} at=right w=440",
        f"glance {SURFACE}",
        comp("s", "Screen", title=clean(ask.slug, 60).upper()),
        comp("note", "Text", value="@" + p("note"), tone="muted"),
        f"> {cid('s')} {cid('note')}",
        f"r {cid('s')}",
        data(p("note"), "Loading…"),
    ]


def card_lines(card: dict, action_label: str = "") -> list[str]:
    """The whole card. Author text only ever travels in `d` lines."""
    title = clean(card.get("slug") or "", 60).upper()
    head = [f"@ {SURFACE} at=right w=440", f"glance {SURFACE}", comp("s", "Screen", title=title)]
    if card.get("error"):
        return head + [
            comp("note", "Text", value="@" + p("note"), tone="muted"),
            f"> {cid('s')} {cid('note')}",
            f"r {cid('s')}",
            data(p("note"), card["error"]),
        ]
    if card["kind"] == "profile":
        pinned = card.get("pinned") or []
        who = card.get("name") or card["slug"]
        sub = f"{who}, {card.get('type', 'user')}. " + (
            f"{len(pinned)} pinned repo{'s' if len(pinned) != 1 else ''}." if pinned else "Nothing pinned.")
        return head + [
            comp("note", "Text", value="@" + p("note"), tone="muted"),
            comp("pinned", "Table", columns=[{"field": "repo", "label": "Pinned"},
                                             {"field": "stars", "label": "Stars"},
                                             {"field": "license", "label": "License"},
                                             {"field": "pushed", "label": "Pushed"}],
                 rows="@" + p("pinned"), action="repo-show", actionLabel="Show"),
            comp("status", "Text", value="@" + p("status"), tone="muted"),
            f"> {cid('s')} {cid('note')} {cid('pinned')} {cid('status')}",
            f"r {cid('s')}",
            data(p("note"), sub),
            data(p("pinned"), [{k: r[k] for k in ("id", "repo", "stars", "license", "pushed")} for r in pinned]),
            data(p("status"), ""),
        ]
    flags = [w for w, on in (("private", card.get("private")), ("archived", card.get("archived")),
                             ("fork", card.get("fork"))) if on]
    bucket = card.get("bucket", "none")
    lic_line = f"{card.get('license', 'none')} is " + BUCKET_LINE.get(bucket, BUCKET_LINE["none"])
    if bucket == "caveat" and card.get("caveat"):
        lic_line += f": {card['caveat']}"
    lines = head + [
        comp("desc", "Text", value="@" + p("desc")),
        comp("facts", "Stack", direction="grid", cols=3, gap=3),
        comp("stars", "Metric", label="Stars", value="@" + p("stars")),
        comp("license", "Metric", label="License", value="@" + p("license")),
        comp("pushed", "Metric", label="Last push", value="@" + p("pushed")),
        comp("bucket", "Text", value="@" + p("bucket"), tone="muted"),
        comp("readme-h", "Heading", text="README", level=3),
        comp("readme", "Text", value="@" + p("readme")),
        comp("go", "Button", label=action_label or "Open", action="repo-go", variant="primary"),
        comp("status", "Text", value="@" + p("status"), tone="muted"),
        f"> {cid('facts')} {cid('stars')} {cid('license')} {cid('pushed')}",
        f"> {cid('s')} {cid('desc')} {cid('facts')} {cid('bucket')} {cid('readme-h')} {cid('readme')} "
        f"{cid('go')} {cid('status')}",
        f"r {cid('s')}",
        data(p("desc"), card["description"] + (f" ({', '.join(flags)})" if flags else "")),
        data(p("stars"), card["stars"]),
        data(p("license"), card.get("license", "none")),
        data(p("pushed"), card["pushed"]),
        data(p("bucket"), lic_line),
        data(p("readme"), card["readme"]),
        data(p("status"), ""),
    ]
    return lines


# --- the card that is up -------------------------------------------------------

Send = Callable[[str], None]


@dataclass
class Board:
    """The one repo card on the glass, held by the listener that drew it, so a
    press acts on what was drawn and not on anything in the event line."""
    run: Runner = run_cli
    env: dict = field(default_factory=lambda: dict(os.environ))
    now: Callable[[], datetime] = lambda: datetime.now(timezone.utc)
    card: dict | None = None
    local: Path | None = None
    busy: bool = False
    lock: threading.Lock = field(default_factory=threading.Lock)

    def is_open(self) -> bool:
        return self.card is not None

    def forget(self) -> None:
        """Escape reset the glass: the card is gone, so nothing may act on it."""
        with self.lock:
            self.card, self.local = None, None

    def close(self, send: Send) -> Outcome:
        was = self.card is not None
        self.forget()
        send(f"- {SURFACE}")
        return Outcome(True, "Closed." if was else "No repo card is up.")

    def answer(self, ask: Ask, send: Send) -> Outcome:
        if ask.kind == "close":
            return self.close(send)
        for line in loading_lines(ask):
            send(line)
        return self.show(ask, send)

    def show(self, ask: Ask, send: Send) -> Outcome:
        if ask.kind == "profile":
            card = fetch_profile(ask.owner, self.run, self.now())
            local = None
        else:
            with ThreadPoolExecutor(max_workers=1) as pool:
                guess = pool.submit(local_path, ask.slug, code_root(self.env))
                card = fetch_repo(ask.owner, ask.repo, self.run, self.now())
                local = guess.result()
            if card.get("error"):
                local = None
            elif card["slug"].casefold() != ask.slug.casefold():
                # GitHub redirected a renamed repo; the remote may carry either name.
                local = local or local_path(card["slug"], code_root(self.env))
        with self.lock:
            self.card, self.local = card, local
        label = "Open in tree" if local else "Clone to ~/code"
        for line in card_lines(card, label):
            send(line)
        if card.get("error"):
            return Outcome(False, card["error"])
        if card["kind"] == "profile":
            n = len(card.get("pinned") or [])
            return Outcome(True, f"{card['slug']}: {n} pinned." if n else f"{card['slug']} has nothing pinned.")
        return Outcome(True, f"{card['name']}: {card['stars']} stars, {card['license']}, {card['bucket']}.")

    @staticmethod
    def owns(action: str, component: str) -> bool:
        """The `e` lines that are this card's: its button, its rows, its X."""
        return (action == "repo-go" or (action == "action" and component == "repo-show")
                or (action == "closed" and component == SURFACE))

    def event(self, line: str, send: Send) -> Outcome | None:
        """Act on a press. The event names only which control; what it acts on
        is the card this board drew."""
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import hud_events  # noqa: PLC0415
        ev = hud_events.event(line)
        if ev is None:
            return None
        if ev["name"] == "closed" and ev["component"] == SURFACE:
            self.forget()
            return Outcome(True, "Closed.")
        card = self.card
        if card is None or card.get("error"):
            return Outcome(False, "That card is gone.")
        if ev["name"] == "repo-show":
            row = str(ev.get("row") or "")
            allowed = {r["id"] for r in card.get("pinned") or []}
            if card["kind"] != "profile" or row not in allowed:
                return Outcome(False, "That repo isn't on this card.")
            owner, repo = row.split("/", 1)
            return self.answer(Ask("repo", owner, repo), send)
        if ev["name"] == "repo-go" and card["kind"] == "repo":
            return self.go(card, send)
        return None

    def status(self, send: Send, text: str) -> None:
        send(data(p("status"), text))

    def go(self, card: dict, send: Send) -> Outcome:
        if self.local is not None:
            send("files " + json.dumps(str(self.local)))
            out = Outcome(True, f"{card['name']} is open in the tree.")
            self.status(send, out.line)
            return out
        with self.lock:
            if self.busy:
                return Outcome(False, "Already cloning.")
            self.busy = True
        try:
            return self.clone(card, send)
        finally:
            self.busy = False

    def clone(self, card: dict, send: Send) -> Outcome:
        slug, name = card["slug"], card["name"]
        if not re.fullmatch(rf"{LOGIN}/{NAME}", slug) or name.startswith(".") or "/" in name:
            out = Outcome(False, "That repo name can't be a folder.")
            self.status(send, out.line)
            return out
        root = code_root(self.env)
        dest = root / name
        if dest.exists():
            found = local_path(slug, root)
            out = Outcome(False, f"~/code/{name} already exists and isn't {slug}. Nothing was cloned."
                          if found is None else f"Already cloned at {found}.")
            if found is not None:
                self.local = found
                send(comp("go", "Button", label="Open in tree", action="repo-go", variant="primary"))
            self.status(send, out.line)
            return out
        self.status(send, f"Cloning {slug} into ~/code…")
        started = time.monotonic()
        code, _, err = self.run(["gh", "repo", "clone", slug, str(dest), "--", "--quiet"], CLONE_TIMEOUT_S)
        if code != 0:
            out = Outcome(False, f"The clone failed: {clean((err or '').strip().splitlines()[-1] if (err or '').strip() else 'no output', 100)}")
            self.status(send, out.line)
            return out
        self.local = dest
        send(comp("go", "Button", label="Open in tree", action="repo-go", variant="primary"))
        send("files " + json.dumps(str(dest)))
        out = Outcome(True, f"Cloned to ~/code/{name} in {time.monotonic() - started:.0f}s.")
        self.status(send, out.line)
        return out


BOARD = Board()


def main(argv: list[str]) -> int:
    """`repo_card.py "<sentence or URL>"`: parse, fetch and print the lines
    the card would draw, with the wall time. Draws nothing on the glass."""
    if len(argv) != 1:
        print('usage: repo_card.py "show me owner/repo" | <github URL>', file=sys.stderr)
        return 2
    ask = parse(argv[0])
    if ask is None or ask.kind == "close":
        print(f"not a repo card: {argv[0]!r}", file=sys.stderr)
        return 1
    started = time.monotonic()
    lines: list[str] = []
    out = Board().answer(ask, lines.append)
    wall = time.monotonic() - started
    print("\n".join(lines))
    print(f"# {out.line}  ({wall * 1000:.0f} ms wall)")
    return 0 if out.ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
