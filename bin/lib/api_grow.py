"""api-grow: every site the agent browses either becomes an API or gets a reason.

Caleb, 2026-10-11: "Whenever chewbs tries a new site, it should reverse
engineer an api so moving forward it gets more and more cracked." The engine
(api-anything) already turns a site's own frontend request into a replayable
op. What was missing was the moment: agents browsed a site, got the answer,
and the next tab paid the same 10 to 40 seconds of clicking again.

So the hooks call this on every browse:

- before a browse to a host with taught ops, the agent is told which ops exist,
  so it calls them instead of driving a page;
- after a browse to a host with none, the visit is recorded and the agent is
  told, once per session, to teach one read-only op for what it just pulled,
  or to record why the site is not worth one (`api-grow skip`).

Nothing here captures, teaches or sends. It reads spec files and writes one
JSON ledger under ~/.chewbacca/api-grow.
"""
import json
import os
import re
import time
from pathlib import Path
from typing import Dict, List, Optional
from urllib.parse import urlparse

HOME = Path(os.environ.get("HOME", "~")).expanduser()
STATE_DIR = Path(os.environ.get("API_GROW_DIR", str(HOME / ".chewbacca" / "api-grow")))
ENGINE_HOME = Path(os.environ.get("API_ANYTHING_HOME", str(HOME / ".api-anything")))

# Hosts that already have a better door, are his own, or hold an account where
# a replayed session costs more than it saves. LinkedIn is here because
# signed-in Voyager replay revoked both of his Chrome sessions on 2026-10-10;
# its public jobs are already taught as linkedin-jobs.
NEVER_TEACH = (
    "localhost", "127.0.0.1", "0.0.0.0", ".local",
    "claude.ai", "anthropic.com", "claude.com",
    "github.com", "api.github.com", "raw.githubusercontent.com", "gist.github.com",
    "docs.google.com", "drive.google.com", "mail.google.com", "calendar.google.com",
    "sheets.google.com", "slides.google.com", "accounts.google.com",
    "clay.com", "app.clay.com",
    "linkedin.com",
    "railway.app", "railway.com", "vercel.app", "vercel.com",
    "paypal.com", "venmo.com", "stripe.com", "chase.com", "bankofamerica.com",
    "wellsfargo.com", "zellepay.com", "apple.com", "icloud.com",
    "login.microsoftonline.com", "okta.com", "duosecurity.com",
    "usctts.com", "calebnewton.me",
)
AUTH_HOST = re.compile(r"^(login|auth|sso|accounts?|signin|id|oauth)\.")
# A URL in a shell command ends at `$` or a backtick: 2026-10-12, a loop's
# curl "https://www.uselemma.ai$p" filed a host named "uselemma.ai$p".
URL_RE = re.compile(r"https?://[^\s'\"<>()\\$`]+")


def host_of(url: str) -> str:
    try:
        h = (urlparse(url).hostname or "").lower()
    except ValueError:
        return ""
    return h[4:] if h.startswith("www.") else h


def never_teach(host: str) -> Optional[str]:
    if not host or "." not in host:
        return "not a public host"
    if re.match(r"^\d+\.\d+\.\d+\.\d+$", host):
        return "a bare IP"
    for d in NEVER_TEACH:
        if d.startswith("."):
            if host.endswith(d):
                return "local"
        elif host == d or host.endswith("." + d):
            return "has its own door or holds an account"
    if AUTH_HOST.match(host):
        return "a sign-in page"
    return None


def _spec_dirs() -> List[Path]:
    dirs = [ENGINE_HOME / "sites"]
    extra = os.environ.get("API_GROW_BUNDLED")
    if extra:
        dirs.append(Path(extra))
    else:
        # The engine's bundled specs sit next to its dist/ in the npm install.
        for node_root in sorted((HOME / ".nvm" / "versions" / "node").glob("*/lib/node_modules/api-anything/sites")):
            dirs.append(node_root)
        dirs.append(Path("/opt/homebrew/lib/node_modules/api-anything/sites"))
        dirs.append(Path("/usr/local/lib/node_modules/api-anything/sites"))
    return [d for d in dirs if d.is_dir()]


def taught_index() -> Dict[str, Dict[str, List[str]]]:
    """host -> {site: [op, ...]} from every spec the engine can call."""
    index: Dict[str, Dict[str, List[str]]] = {}
    for d in _spec_dirs():
        for f in sorted(d.glob("*.json")):
            try:
                spec = json.loads(f.read_text())
            except (OSError, ValueError):
                continue
            if not isinstance(spec, dict):
                continue
            site = str(spec.get("name") or f.stem)
            ops = [o for o in spec.get("operations") or [] if isinstance(o, dict)]
            names = [str(o.get("name")) for o in ops if o.get("name")]
            hosts = {host_of(str(spec.get("baseUrl") or ""))}
            for o in ops:
                hosts.add(host_of(str((o.get("trigger") or {}).get("url") or "")))
                hosts.add(host_of(str((o.get("request") or {}).get("url") or "")))
                hosts.add(re.sub(r"^www\.", "", str((o.get("match") or {}).get("host") or "").lower()))
            for h in hosts:
                if h:
                    index.setdefault(h, {}).setdefault(site, [])
                    for n in names:
                        if n not in index[h][site]:
                            index[h][site].append(n)
    return index


def _ledger_path() -> Path:
    return STATE_DIR / "visits.json"


def load() -> dict:
    try:
        data = json.loads(_ledger_path().read_text())
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save(data: dict) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = _ledger_path().with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=1, sort_keys=True))
    tmp.replace(_ledger_path())


def urls_from_hook(payload: dict) -> List[str]:
    tool = str(payload.get("tool_name") or "")
    ti = payload.get("tool_input") or {}
    if not isinstance(ti, dict):
        return []
    if tool == "Bash":
        cmd = str(ti.get("command") or "")
        if not re.search(r"(^|[;&|\s/])(chewie web|jev-browse|scrape|curl|browser-bridge|web-record|summarize|chrome-js|wget)(\s|$)", cmd):
            return []
        return URL_RE.findall(cmd)[:3]
    for key in ("url", "uri", "href"):
        v = ti.get(key)
        if isinstance(v, str) and v.startswith("http"):
            return [v]
    return []


def lookup(host: str, index: Optional[dict] = None) -> Dict[str, List[str]]:
    index = taught_index() if index is None else index
    return index.get(host, {})


def taught_line(host: str, sites: Dict[str, List[str]]) -> str:
    parts = ["%s (%s)" % (s, ", ".join(ops[:8])) for s, ops in sorted(sites.items())]
    return ("api-grow: %s is already an API: %s. If one of these answers what you need, "
            "`chewbacca api call <site> <op> k=v` (or the api-anything MCP call_operation) in about "
            "a second instead of driving the page; `chewbacca api ops <site>` lists params and caveats. "
            "If you need something none of them return, browse, then teach that op too." % (host, "; ".join(parts)))


def teach_line(host: str, count: int, url: str) -> str:
    return ("api-grow: %s has no API yet (browsed %d time%s, this one %s). Once the user's task is "
            "answered, make the next visit a call instead of a browse: teach one read-only op for the "
            "data you just pulled, per the web-apis skill (`api-anything capture <page> --example k=v "
            "--outline`, then `add` with two examples, call it with a third input, check one value "
            "against the page). Public, logged-out reads only, never a write, never a CAPTCHA. If it's "
            "a one-off page with no repeatable question (a docs article, a single news story), run "
            "`api-grow skip %s \"<why>\"` so no tab asks again."
            % (host, count, "" if count == 1 else "s", url[:120], host))


def handle(payload: dict, now: Optional[float] = None) -> Optional[str]:
    """Return the additionalContext line for one hook event, or None."""
    event = str(payload.get("hook_event_name") or "PostToolUse")
    urls = urls_from_hook(payload)
    if not urls:
        return None
    now = time.time() if now is None else now
    session = str(payload.get("session_id") or "")
    index = taught_index()
    data = load()
    hosts = data.setdefault("hosts", {})
    lines = []
    changed = False
    for url in urls:
        host = host_of(url)
        if never_teach(host):
            continue
        sites = lookup(host, index)
        row = hosts.get(host) or {}
        if event == "PreToolUse":
            if sites and session not in row.get("pointed", []):
                row.setdefault("pointed", []).append(session)
                row["pointed"] = row["pointed"][-20:]
                hosts[host] = row
                changed = True
                lines.append(taught_line(host, sites))
            continue
        row["count"] = int(row.get("count") or 0) + 1
        row.setdefault("first", int(now))
        row["last"] = int(now)
        row["last_url"] = url[:300]
        row["tool"] = str(payload.get("tool_name") or "")
        hosts[host] = row
        changed = True
        if sites or row.get("skip"):
            continue
        if session in row.get("nudged", []):
            continue
        row.setdefault("nudged", []).append(session)
        row["nudged"] = row["nudged"][-20:]
        lines.append(teach_line(host, row["count"], url))
    if changed:
        save(data)
    return "\n".join(lines) or None


def skip(host: str, why: str) -> dict:
    host = host_of(host if "://" in host else "https://" + host)
    data = load()
    row = data.setdefault("hosts", {}).setdefault(host, {})
    row["skip"] = why or "skipped"
    save(data)
    return {"host": host, "skip": row["skip"]}


def status() -> dict:
    index = taught_index()
    hosts = load().get("hosts", {})
    queue, skipped, grown = [], [], []
    for h, row in hosts.items():
        if lookup(h, index):
            grown.append({"host": h, "visits": row.get("count", 0), "sites": sorted(lookup(h, index))})
        elif row.get("skip"):
            skipped.append({"host": h, "why": row["skip"]})
        elif row.get("count"):
            queue.append({"host": h, "visits": row["count"], "last_url": row.get("last_url", "")})
    queue.sort(key=lambda r: -r["visits"])
    return {"taught_hosts": len(index), "untaught": queue, "skipped": skipped, "browsed_and_taught": grown}
