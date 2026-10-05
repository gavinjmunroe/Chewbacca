"""engine <id>: a live panel over an open source engine running on this Mac,
declared in data/surfaces/engines.json instead of written as code.

An engine spec names the repo it comes from, how to tell it is installed,
one read that returns JSON, and which keys of that JSON become a row's title,
subtitle and detail. Adding Ollama's model list or Tailscale's peers to the
glass is a JSON entry; nothing here changes.

THE SECURITY LINE, the same bar as files.py's allowlist:

- The spec file is the only source of anything that runs. A command is the
  detected binary (an absolute path from the spec's own list, nothing from
  PATH) plus the spec's fixed `args`. Nothing from the glass, from a fetched
  row, or from the engine's own output is ever put into a command or a URL.
- HTTP goes only to 127.0.0.1, ::1 or localhost, plain http, no userinfo, no
  proxy from the environment and no redirect followed, because a redirect is
  the engine choosing where the next request goes.
- An entry whose repo is not in data/oss-apps/apps.json, or is there but is
  not remixable (GPL, AGPL, no license, source-available), is refused when the
  file is loaded and never runs. So is any key this file does not know.
- Output is capped before it is parsed, and every string bound for the HUD has
  control and bidi characters stripped, because an engine's data (a peer's
  host name, a repo description) was written by someone else.
- A surface has no actions. It reads; it never installs, starts, stops or
  sends. An engine that is not installed shows its install hint as words.
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

from . import Bind, Context, Provider, SurfaceError, ago, clip, comp, note_for, parse_time

REPO = Path(__file__).resolve().parents[3]
SPECS = REPO / "data" / "surfaces" / "engines.json"
APPS = REPO / "data" / "oss-apps" / "apps.json"

ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,31}$")
LOCAL_HOSTS = {"127.0.0.1", "::1", "localhost"}
# Ollama's /api/tags with 7 models was 4.1 KB on 2026-10-05; tailscale status
# --json for a small tailnet is tens of KB. 1 MB is room for both with three
# orders of magnitude to spare, and small enough to parse on every refresh.
MOST_BYTES = 1 << 20
# Twelve is the most rows kyber-genui lets one surface show (KYBER-SURFACES.md);
# the same ceiling here keeps an engine panel from outgrowing its column.
MOST_ROWS = 12
# guessed, never measured: a local HTTP answer slower than this means the
# engine is wedged, and a refresh must not hold the daemon's worker for it.
HTTP_TIMEOUT = 3.0
# A detect probe runs for every engine on every oss refresh, so it gets less.
# guessed, never measured.
PROBE_TIMEOUT = 1.0
MOST_ARGS = 16
FIELDS = ("title", "subtitle", "detail")
FORMATS = {"bytes", "ago"}
SPEC_KEYS = {"id", "title", "repo", "replaces", "detect", "read", "rows", "row", "labels", "format",
             "install", "refresh"}

# C0 and C1 controls, DEL, and the bidi overrides and isolates that can make a
# host name read as something else on the glass.
CONTROL = re.compile("[\x00-\x1f\x7f-\x9f‎‏‪-‮⁦-⁩]")


def clean(text, limit: int = 80) -> str:
    """A string from someone else, made safe to draw: no controls, one line, clipped."""
    return clip(CONTROL.sub(" ", str(text if text is not None else "")), limit)


def local_url(url: str) -> bool:
    """Plain http to this machine and nowhere else."""
    if not isinstance(url, str) or any(c in url for c in "\x00\r\n\t "):
        return False
    try:
        parsed = urlparse(url)
        port = parsed.port
    except ValueError:
        return False
    return (parsed.scheme == "http" and (parsed.hostname or "") in LOCAL_HOSTS
            and parsed.username is None and parsed.password is None and (port is None or 0 < port < 65536))


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # noqa: ANN002, ANN003
        return None


def local_get(url: str, timeout: float = HTTP_TIMEOUT, cap: int = MOST_BYTES) -> tuple[int, bytes]:
    """GET a local URL. Raises SurfaceError with a readable line on any failure."""
    if not local_url(url):
        raise SurfaceError("That engine's URL isn't on this Mac, so it isn't read.")
    # An empty ProxyHandler ignores http_proxy from the environment: a proxy
    # would carry a "local" request off the machine.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
    try:
        with opener.open(urllib.request.Request(url, headers={"Accept": "application/json"}), timeout=timeout) as r:
            body = r.read(cap + 1)
            status = r.status
    except urllib.error.HTTPError as err:
        raise SurfaceError(f"It answered {err.code}.") from None
    except (urllib.error.URLError, OSError) as err:
        reason = getattr(err, "reason", err)
        raise SurfaceError(f"Not answering on {urlparse(url).port or 80} ({clean(reason, 60)}).") from None
    if len(body) > cap:
        raise SurfaceError(f"It answered with more than {cap >> 20} MB, so it wasn't read.")
    return status, body


def http_for(ctx: Context):
    """Tests hang a fake on the Context; the daemon's Context has none."""
    return getattr(ctx, "http_get", None) or local_get


def _remix_verdict(app: dict | None) -> str | None:
    """None when the repo may be built on; otherwise why not, in words."""
    if app is None:
        return "its repo isn't in data/oss-apps/apps.json"
    if app.get("remixable") is True or app.get("remixable_with_caveat") is True:
        return None
    return f"{app.get('license') or 'no'} license isn't remixable"


def _strs(value, most: int) -> bool:
    return (isinstance(value, list) and 0 < len(value) <= most
            and all(isinstance(v, str) and v and "\x00" not in v for v in value))


def check_spec(spec, apps_by_id: dict) -> str | None:
    """None for a spec that may run; otherwise the reason it is refused."""
    if not isinstance(spec, dict):
        return "an entry isn't an object"
    unknown = set(spec) - SPEC_KEYS
    if unknown:
        return f"unknown key {sorted(unknown)[0]!r}"
    if not isinstance(spec.get("id"), str) or not ID.match(spec["id"]):
        return "id must be 1 to 32 of a-z, 0-9 and -"
    for key in ("title", "repo", "rows"):
        if not isinstance(spec.get(key), str) or not spec[key].strip():
            return f"{key} is missing"
    why = _remix_verdict(apps_by_id.get(spec["repo"].casefold()))
    if why:
        return why
    detect, read = spec.get("detect"), spec.get("read")
    if not isinstance(detect, dict) or len(detect) != 1 or not ({"bin", "url"} & set(detect)):
        return "detect needs exactly one of bin or url"
    if "bin" in detect:
        if not _strs(detect["bin"], 8) or not all(os.path.isabs(b) for b in detect["bin"]):
            return "detect.bin must be a list of absolute paths"
    elif not local_url(detect["url"]):
        return "detect.url must be http on 127.0.0.1, ::1 or localhost"
    if not isinstance(read, dict) or len(read) != 1 or not ({"args", "url"} & set(read)):
        return "read needs exactly one of args or url"
    if "args" in read:
        if "bin" not in detect:
            return "a command read needs a detect.bin to run"
        if not _strs(read["args"], MOST_ARGS):
            return f"read.args must be 1 to {MOST_ARGS} strings"
    elif not local_url(read["url"]):
        return "read.url must be http on 127.0.0.1, ::1 or localhost"
    row = spec.get("row")
    if not isinstance(row, dict) or not isinstance(row.get("title"), str) or set(row) - set(FIELDS):
        return "row needs a title path, and only title, subtitle, detail"
    if not all(isinstance(v, str) and v for v in row.values()):
        return "row paths must be strings"
    labels = spec.get("labels", {})
    if not isinstance(labels, dict) or set(labels) - set(FIELDS) or not all(isinstance(v, str) for v in labels.values()):
        return "labels may only name title, subtitle, detail"
    fmt = spec.get("format", {})
    if not isinstance(fmt, dict) or set(fmt) - set(FIELDS) or not set(fmt.values()) <= FORMATS:
        return f"format may only set title, subtitle, detail to {sorted(FORMATS)}"
    for key in ("install", "replaces"):
        if key in spec and (not isinstance(spec[key], str) or len(spec[key]) > 120):
            return f"{key} must be a short string"
    if "refresh" in spec and (not isinstance(spec["refresh"], (int, float)) or isinstance(spec["refresh"], bool)):
        return "refresh must be seconds"
    return None


def load_apps(ctx: Context | None = None) -> list[dict]:
    from . import oss  # noqa: PLC0415  shared loader, one copy in memory

    return oss.registry(ctx)["apps"]


def load_specs(ctx: Context | None = None, apps: list[dict] | None = None) -> tuple[list[dict], list[dict]]:
    """(engines that may run, refused entries with their reason). A missing
    spec file is no engines, not an error."""
    env = ctx.env if ctx is not None else os.environ
    path = Path(env.get("KYBER_SURFACES_ENGINES") or SPECS)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return [], []
    except (OSError, json.JSONDecodeError) as err:
        raise SurfaceError(f"{path.name} can't be read: {clean(err, 80)}") from None
    entries = raw.get("engines") if isinstance(raw, dict) else None
    if not isinstance(entries, list):
        raise SurfaceError(f"{path.name} has no engines list.")
    by_id = {a["id"].casefold(): a for a in (apps if apps is not None else load_apps(ctx))}
    good, refused, seen = [], [], set()
    for spec in entries:
        why = check_spec(spec, by_id)
        sid = spec.get("id") if isinstance(spec, dict) and isinstance(spec.get("id"), str) else "?"
        if why is None and sid in seen:
            why = "that id is used twice"
        if why:
            refused.append({"id": clean(sid, 32), "why": why,
                            "repo": clean(spec.get("repo", ""), 60) if isinstance(spec, dict) else ""})
            continue
        seen.add(sid)
        good.append(spec)
    return good, refused


def find_spec(ctx: Context, engine_id: str) -> dict:
    specs, refused = load_specs(ctx)
    for spec in specs:
        if spec["id"] == engine_id:
            return spec
    for r in refused:
        if r["id"] == engine_id:
            raise SurfaceError(f"{engine_id} is refused: {r['why']}.")
    names = ", ".join(s["id"] for s in specs) or "none yet"
    raise SurfaceError(f"No engine called {engine_id}. There's {names}.")


def detected_bin(spec: dict) -> str | None:
    """The first candidate that is an executable regular file."""
    for path in spec["detect"].get("bin", []):
        if os.path.isfile(path) and os.access(path, os.X_OK):
            return path
    return None


def status(ctx: Context, spec: dict) -> dict:
    """{"installed": bool, "line": words}. Never installs or starts anything."""
    if "bin" in spec["detect"]:
        found = detected_bin(spec)
        if found:
            return {"installed": True, "line": "installed"}
    else:
        try:
            http_for(ctx)(spec["detect"]["url"], timeout=PROBE_TIMEOUT, cap=64 << 10)
            return {"installed": True, "line": "running"}
        except SurfaceError:
            pass
    hint = spec.get("install") or "see its repo"
    return {"installed": False, "line": f"not installed: {hint}"}


def read(ctx: Context, spec: dict):
    """The engine's JSON. Raises SurfaceError for not installed, failed or not JSON."""
    if "args" in spec["read"]:
        binary = detected_bin(spec)
        if binary is None:
            raise SurfaceError(f"Not installed. {spec.get('install') or ''}".strip())
        code, out, err = ctx.run([binary] + list(spec["read"]["args"]))
        if code != 0:
            first = (err or out or "no output").strip().splitlines() or ["no output"]
            raise SurfaceError(f"It said: {clean(first[0], 100)}")
        body = (out or "").encode("utf-8", "replace")
        if len(body) > MOST_BYTES:
            raise SurfaceError(f"It answered with more than {MOST_BYTES >> 20} MB, so it wasn't read.")
    else:
        # A bin-detected engine that is not installed is never polled: on this
        # Mac port 3000 is whatever dev server is up, not Gitea.
        if "bin" in spec["detect"] and detected_bin(spec) is None:
            raise SurfaceError(f"Not installed. {spec.get('install') or ''}".strip())
        _, body = http_for(ctx)(spec["read"]["url"])
    try:
        return json.loads(body.decode("utf-8", "replace") if isinstance(body, bytes) else body)
    except (json.JSONDecodeError, ValueError):
        raise SurfaceError("It answered with something that isn't JSON.") from None


def walk(value, path: str):
    """A dotted path into JSON. `*` is every item of a list or every value of
    an object; a number indexes a list. Missing is None, never an error."""
    current = [value]
    for seg in [s for s in path.split(".") if s]:
        nxt = []
        for v in current:
            if seg == "*":
                nxt.extend(v.values() if isinstance(v, dict) else v if isinstance(v, list) else [])
            elif isinstance(v, dict) and seg in v:
                nxt.append(v[seg])
            elif isinstance(v, list) and seg.isdigit() and int(seg) < len(v):
                nxt.append(v[int(seg)])
        current = nxt
        if not current:
            return None
    return current if "*" in path.split(".") else current[0]


def size_text(n) -> str:
    if isinstance(n, bool):
        return ""
    try:
        n = float(n)
    except (TypeError, ValueError):
        return ""
    for unit, step in (("GB", 1 << 30), ("MB", 1 << 20), ("KB", 1 << 10)):
        if n >= step:
            return f"{n / step:.1f} {unit}".replace(".0 ", " ")
    return f"{int(n)} B"


def field_text(value, fmt: str | None, now: datetime) -> str:
    if value is None:
        return ""
    if fmt == "bytes":
        return size_text(value)
    if fmt == "ago":
        moment = parse_time(value) if isinstance(value, str) else None
        if moment is not None:
            return ago(moment, now) if moment <= now else clean(moment.strftime("%-I:%M %p"), 20)
        return clean(value, 40)
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, (dict, list)):
        return clean(json.dumps(value, ensure_ascii=False, separators=(",", ":")), 60)
    return clean(value, 60)


def rows_of(spec: dict, payload, now: datetime) -> tuple[list[dict], int]:
    """(rows to draw, how many the engine returned)."""
    found = walk(payload, spec["rows"])
    if isinstance(found, dict):
        found = list(found.values())
    if not isinstance(found, list):
        raise SurfaceError(f"Its answer has no {spec['rows']} list.")
    fmt = spec.get("format", {})
    out = []
    for i, item in enumerate(found[:MOST_ROWS]):
        row = {"id": f"r{i}"}
        for f in FIELDS:
            path = spec["row"].get(f)
            row[f] = field_text(walk(item, path), fmt.get(f), now) if path else ""
        row["title"] = row["title"] or "(unnamed)"
        out.append(row)
    return out, len(found)


class EngineSurface(Provider):
    region = "topRight"
    width = 400
    refresh = 60.0

    def __init__(self, engine_id: str = "") -> None:
        super().__init__()
        # The name is a pointer and component prefix, so it is cut to the
        # same alphabet as a spec id whatever was asked for.
        slug = re.sub(r"[^a-z0-9-]", "", (engine_id or "").strip().lower())[:32] or "unknown"
        self.engine_id = slug
        self.name = f"engine-{slug}"
        self.title = slug.replace("-", " ").upper()
        self.replaces = "an app with an open source engine underneath"
        # No actions. This panel reads.
        self.actions = {}

    def fetch(self, ctx: Context) -> dict:
        spec = find_spec(ctx, self.engine_id)
        self.title = clean(spec["title"], 40).upper()
        self.replaces = clean(spec.get("replaces") or spec["title"], 60)
        self.refresh = float(min(max(spec.get("refresh", 60), 10), 600))
        payload = read(ctx, spec)
        rows, total = rows_of(spec, payload, ctx.now())
        labels = spec.get("labels", {})
        columns = [{"field": f, "label": labels.get(f, f.capitalize())} for f in FIELDS
                   if f in spec["row"]]
        return {"rows": rows, "total": total, "columns": columns, "title": clean(spec["title"], 40),
                "repo": spec["repo"]}

    def layout(self) -> list[str]:
        return [
            comp(self.cid("s"), "Screen", title=self.title),
            comp(self.cid("note"), "Text", value=Bind(self.p("note")), tone="muted"),
            comp(self.cid("table"), "Table", columns=Bind(self.p("columns")), rows=Bind(self.p("rows"))),
            comp(self.cid("from"), "Text", value=Bind(self.p("from")), tone="muted"),
            f"> {self.cid('s')} {self.cid('note')} {self.cid('table')} {self.cid('from')}",
            f"r {self.cid('s')}",
        ]

    def model(self, data, error, values, ctx) -> dict:
        if data is None:
            return {self.p("note"): note_for(None, error, ""), self.p("rows"): [],
                    self.p("columns"): [], self.p("from"): ""}
        rows, total = data["rows"], data["total"]
        empty = "" if rows else "It answered with nothing to show."
        note = note_for(data, error, empty, data.get("_at"))
        if not error and total > len(rows):
            note = f"{len(rows)} of {total}"
        return {self.p("note"): note,
                self.p("rows"): [{k: r[k] for k in ("id",) + FIELDS} for r in rows],
                self.p("columns"): data["columns"],
                self.p("from"): f"{data['title']}, from {data['repo']}. Read only."}
