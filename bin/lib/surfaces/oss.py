"""oss: "what replaces Notion", answered on the glass from the open source
registry, with each answer's license said plainly.

Rows come from data/oss-apps/apps.json through tools/oss_apps.py's own
functions (replaces first, search when nothing replaces it by name), so the
glass and the `oss-apps` CLI can never disagree. Each row carries one of four
license buckets:

    remixable   a permissive license GitHub detected itself (MIT, Apache, BSD...)
    caveat      MPL-2.0 or open core a person read and recorded; build with care
    copyleft    GPL, AGPL, LGPL and friends: usable, not remixable into a product
    none        no license, source-available, or one GitHub could not classify

"More" on a row shows that one entry in full. Under the list sit the engines
from data/surfaces/engines.json: running, installed, or not installed with the
install hint as words. "Show" on an installed engine opens its own panel.

Read only. Nothing here opens a URL, clones a repo or installs anything. A
repo's description was written by its author, so it is control-stripped and
drawn as text, never read for instructions.
"""
from __future__ import annotations

import os
from importlib.machinery import SourceFileLoader
from importlib.util import module_from_spec, spec_from_loader
from pathlib import Path

from . import ACTION_PREFIX, Bind, Context, Provider, Result, SurfaceError, comp, note_for
from . import engine as E

REPO = Path(__file__).resolve().parents[3]
TOOL = REPO / "tools" / "oss_apps.py"
# Miller's ceiling in this repo's UX check: no more than 9 items in a list.
MOST_ROWS = 9
MOST_ENGINES = 9
COPYLEFT = ("GPL", "AGPL", "LGPL", "EUPL", "OSL", "CC-BY-SA", "MPL-1", "EPL", "CDDL", "SSPL")

_tool = None
# (path, mtime) -> registry, so a refresh does not re-parse 1,465 apps (about
# 1.6 MB of JSON) unless the file actually changed.
_cache: dict = {}


def tool():
    """tools/oss_apps.py, imported, not shelled out to."""
    global _tool
    if _tool is None:
        loader = SourceFileLoader("oss_apps_for_surfaces", str(TOOL))
        mod = module_from_spec(spec_from_loader(loader.name, loader))
        loader.exec_module(mod)
        _tool = mod
    return _tool


def registry(ctx: Context | None = None) -> dict:
    env = ctx.env if ctx is not None else os.environ
    path = Path(env.get("OSS_APPS_DATA") or REPO / "data" / "oss-apps" / "apps.json")
    try:
        key = (str(path), path.stat().st_mtime_ns)
    except OSError as err:
        raise SurfaceError(f"The open source registry is missing ({err.strerror}). `oss-apps build` makes it.") from None
    if key not in _cache:
        try:
            data = tool().load(path)
        except (OSError, ValueError) as err:
            raise SurfaceError(f"The open source registry can't be read: {E.clean(err, 80)}") from None
        _cache.clear()
        _cache[key] = data
    return _cache[key]


def bucket(app: dict) -> str:
    if app.get("remixable") is True:
        return "remixable"
    if app.get("remixable_with_caveat") is True:
        return "caveat"
    lic = str(app.get("license") or "").upper()
    if any(lic.startswith(c) for c in COPYLEFT):
        return "copyleft"
    return "none"


def lookup(apps: list[dict], query: str) -> list[dict]:
    """What replaces it by name, else anything that mentions it."""
    t = tool()
    q = " ".join(str(query or "").split())[:60]
    if not q:
        return []
    return t.replaces(apps, q) or t.search(apps, q)


def stars(n) -> str:
    return tool().fmt_stars(n) if n is not None else ""


class Oss(Provider):
    name = "oss"
    title = "OPEN SOURCE"
    region = "topLeft"
    width = 440
    # The registry changes when `oss-apps build` runs, not by the minute; an
    # engine's state is the only thing a refresh can find new.
    refresh = 120.0
    replaces = "searching for an alternative in a browser"

    def __init__(self, query: str = "") -> None:
        super().__init__()
        self.query = " ".join(str(query or "").split())[:60]
        self.actions = {f"{ACTION_PREFIX}drill": self.drill, f"{ACTION_PREFIX}engine": self.engine}

    def fetch(self, ctx: Context) -> dict:
        apps = registry(ctx)["apps"]
        specs, refused = E.load_specs(ctx, apps)
        engines = []
        for spec in specs:
            st = E.status(ctx, spec)
            engines.append({"id": spec["id"], "title": E.clean(spec["title"], 40), "repo": spec["repo"],
                            "installed": st["installed"], "line": st["line"]})
        for r in refused:
            engines.append({"id": r["id"], "title": r["id"], "repo": r["repo"], "installed": False,
                            "line": f"refused: {r['why']}"})
        return {"apps": apps, "engines": engines}

    def layout(self) -> list[str]:
        ids = ("s", "q", "note", "table", "name", "detail", "engines", "status")
        return [
            comp(self.cid("s"), "Screen", title=self.title),
            comp(self.cid("q"), "Field", label="What replaces", placeholder="An app, like Notion",
                 value=Bind(self.p("q"))),
            comp(self.cid("note"), "Text", value=Bind(self.p("note")), tone="muted"),
            comp(self.cid("table"), "Table", columns=Bind(self.p("columns")), rows=Bind(self.p("rows")),
                 action=f"{ACTION_PREFIX}drill", actionLabel="More"),
            comp(self.cid("name"), "Heading", text=Bind(self.p("name")), level=3),
            comp(self.cid("detail"), "List", items=Bind(self.p("detail"))),
            comp(self.cid("engines"), "List", items=Bind(self.p("engines")),
                 action=f"{ACTION_PREFIX}engine", actionLabel="Show"),
            comp(self.cid("status"), "Text", value=Bind(self.p("status")), tone="muted"),
            "> " + " ".join(self.cid(i) for i in ids),
            f"r {self.cid('s')}",
        ]

    def initial(self) -> dict:
        return {self.p("q"): self.query, self.p("pick"): "", self.p("status"): "",
                self.p("columns"): [{"field": "name", "label": "App"}, {"field": "license", "label": "License"},
                                    {"field": "stack", "label": "Stack"}, {"field": "stars", "label": "Stars"}]}

    def hits(self, data, values: dict) -> list[dict]:
        if not data:
            return []
        return lookup(data["apps"], values.get(self.p("q"), self.query))

    def detail(self, app: dict, engines: list[dict]) -> list[str]:
        lines = [E.clean(app.get("description") or "No description.", 140),
                 f"License: {E.clean(app.get('license'), 30)} ({bucket(app)})"]
        if app.get("remix_caveat"):
            lines.append(f"Caveat: {E.clean(app['remix_caveat'], 120)}")
        if app.get("replaces"):
            lines.append("Replaces: " + E.clean(", ".join(app["replaces"][:6]), 120))
        lines.append(f"Stack: {E.clean(app.get('stack') or 'unknown', 40)}"
                     + (f", {stars(app.get('stars'))} stars" if app.get("stars") is not None else ""))
        if app.get("archived"):
            lines.append("Archived: no longer maintained.")
        lines.append(E.clean(app.get("repo"), 100))
        for eng in engines:
            if eng["repo"].casefold() == str(app.get("id", "")).casefold():
                lines.append(f"On the glass as `engine {eng['id']}`: {eng['line']}")
        return lines

    def model(self, data, error, values, ctx) -> dict:
        if data is None:
            return {self.p("note"): note_for(None, error, ""), self.p("rows"): [], self.p("name"): "",
                    self.p("detail"): [], self.p("engines"): []}
        query = str(values.get(self.p("q"), self.query) or "").strip()
        hits = self.hits(data, values)
        rows = [{"id": a["id"], "name": E.clean(a["name"], 28), "license": bucket(a),
                 "stack": E.clean(a.get("stack") or "", 20), "stars": stars(a.get("stars"))}
                for a in hits[:MOST_ROWS]]
        if not query:
            empty = f"{len(data['apps'])} open source apps. Type an app to see what replaces it."
        elif not hits:
            empty = f"Nothing in the registry replaces {E.clean(query, 40)}."
        else:
            empty = f"{len(rows)} of {len(hits)} for {E.clean(query, 40)}" if len(hits) > len(rows) else ""
        picked = next((a for a in data["apps"] if a["id"] == values.get(self.p("pick"))), None)
        engines = data.get("engines", [])
        return {
            self.p("note"): note_for(data, error, empty, data.get("_at")),
            self.p("rows"): rows,
            self.p("name"): E.clean(picked["name"], 40) if picked else "",
            self.p("detail"): self.detail(picked, engines) if picked else [],
            self.p("engines"): [{"id": e["id"], "text": f"{e['title']}: {e['line']}"}
                                for e in engines[:MOST_ENGINES]],
        }

    def drill(self, ctx: Context, data, values: dict) -> Result:
        """Show one entry. The row id must be an app in the registry."""
        app_id = str(values.get("row") or "")
        app = next((a for a in (data or {}).get("apps", []) if a["id"] == app_id), None)
        if app is None:
            return Result(False, "That app isn't in the registry any more.")
        return Result(True, f"{E.clean(app['name'], 40)}, {bucket(app)}.", updates={self.p("pick"): app["id"]})

    def engine(self, ctx: Context, data, values: dict) -> Result:
        """Open an engine's panel: only an id the spec file declared, loaded
        clean, and found installed at the last fetch. Never installs."""
        eid = str(values.get("row") or "")
        eng = next((e for e in (data or {}).get("engines", []) if e["id"] == eid), None)
        if eng is None:
            return Result(False, "That engine isn't in engines.json any more.")
        if not eng["installed"]:
            return Result(False, f"{eng['title']} is {eng['line']}. Nothing was installed.")
        return Result(True, f"Opened {eng['title']}.", opens="engine", opens_arg=eng["id"])
