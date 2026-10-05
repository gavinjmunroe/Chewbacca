"""files: the newest things in Downloads, one of them open on the glass.

Replaces opening Finder to find the thing that just downloaded. The newest
file is previewed in a File component (PDF, image or text, drawn by Kyber
itself); "Preview" picks another, and Open hands it to its own app.

Open never runs something. A downloaded .app, installer or script is revealed
in Finder instead, so a press on the glass cannot execute a file a website or a
sender chose the name of.
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path

from . import ACTION_PREFIX, Bind, Context, Provider, Result, SurfaceError, ago, clip, comp, note_for

MOST_FILES = 7
# Files Open reveals rather than opens: anything that runs when opened.
RUNNABLE = {".app", ".command", ".sh", ".pkg", ".mpkg", ".dmg", ".tool", ".workflow", ".scpt",
            ".applescript", ".terminal", ".jar", ".py", ".rb", ".pl", ".exe", ".bat"}
# Still being written by a browser.
PARTIAL = {".crdownload", ".download", ".part", ".partial"}


def size_label(n: int) -> str:
    for unit, step in (("GB", 1 << 30), ("MB", 1 << 20), ("KB", 1 << 10)):
        if n >= step:
            return f"{n / step:.1f} {unit}".replace(".0 ", " ")
    return f"{n} B"


class Files(Provider):
    name = "files"
    title = "DOWNLOADS"
    region = "bottomLeft"
    width = 380
    refresh = 20.0
    replaces = "Finder (Downloads)"

    def __init__(self) -> None:
        super().__init__()
        self.actions = {f"{ACTION_PREFIX}open": self.open}

    def folder(self, ctx: Context) -> Path:
        return Path(ctx.env.get("KYBER_SURFACES_DOWNLOADS") or ctx.home / "Downloads")

    def fetch(self, ctx: Context) -> dict:
        root = self.folder(ctx)
        try:
            entries = [p for p in root.iterdir() if not p.name.startswith(".") and p.suffix.lower() not in PARTIAL]
        except OSError as err:
            raise SurfaceError(f"Can't read {root.name}: {err.strerror or err}") from None
        rows = []
        for p in entries:
            try:
                st = p.stat()
            except OSError:
                continue
            rows.append({"path": str(p), "name": p.name, "mtime": st.st_mtime,
                         "size": 0 if p.is_dir() else st.st_size, "dir": p.is_dir()})
        rows.sort(key=lambda r: r["mtime"], reverse=True)
        rows = rows[:MOST_FILES]
        for i, r in enumerate(rows):
            r["label"] = clip(r["name"], 48)
            if any(x["label"] == r["label"] for x in rows[:i]):
                r["label"] += f" ({i + 1})"
        return {"rows": rows}

    def layout(self) -> list[str]:
        return [
            comp(self.cid("s"), "Screen", title=self.title),
            comp(self.cid("note"), "Text", value=Bind(self.p("note")), tone="muted"),
            comp(self.cid("table"), "Table", columns=Bind(self.p("columns")), rows=Bind(self.p("rows"))),
            comp(self.cid("pick"), "Select", label="Preview", options=Bind(self.p("names")), value=Bind(self.p("pick"))),
            comp(self.cid("file"), "File", path=Bind(self.p("path"))),
            comp(self.cid("open"), "Button", label="Open", action=f"{ACTION_PREFIX}open", variant="primary"),
            comp(self.cid("status"), "Text", value=Bind(self.p("status")), tone="muted"),
            f"> {self.cid('s')} {self.cid('note')} {self.cid('table')} {self.cid('pick')} "
            f"{self.cid('file')} {self.cid('open')} {self.cid('status')}",
            f"r {self.cid('s')}",
        ]

    def initial(self) -> dict:
        return {self.p("pick"): "", self.p("status"): "",
                self.p("columns"): [{"field": "name", "label": "Name"}, {"field": "age", "label": "Added"},
                                    {"field": "size", "label": "Size"}]}

    def picked(self, data, values: dict) -> dict | None:
        rows = (data or {}).get("rows") or []
        label = values.get(self.p("pick"))
        return next((r for r in rows if r["label"] == label), rows[0] if rows else None)

    def model(self, data, error, values, ctx) -> dict:
        if data is None:
            return {self.p("note"): note_for(None, error, ""), self.p("rows"): [], self.p("names"): [],
                    self.p("path"): ""}
        now = ctx.now()
        rows = data["rows"]
        table = [{"name": clip(r["name"], 34),
                  "age": ago(datetime.fromtimestamp(r["mtime"]).astimezone(), now),
                  "size": "folder" if r["dir"] else size_label(r["size"])} for r in rows]
        chosen = self.picked(data, values)
        out = {
            self.p("note"): note_for(data, error, "" if rows else "Downloads is empty.", data.get("_at")),
            self.p("rows"): table,
            self.p("names"): [r["label"] for r in rows],
            # A folder has nothing to preview; File gets an empty path and draws nothing.
            self.p("path"): chosen["path"] if chosen and not chosen["dir"] else "",
        }
        if not values.get(self.p("pick")) and chosen:
            out[self.p("pick")] = chosen["label"]
        return out

    def open(self, ctx: Context, data, values: dict) -> Result:
        row = self.picked(data, values)
        if row is None:
            return Result(False, "Nothing to open.")
        path = Path(row["path"])
        if path.parent != self.folder(ctx):
            return Result(False, "That file isn't in Downloads any more.")
        if path.suffix.lower() in RUNNABLE:
            code, _, err = ctx.run(["open", "-R", str(path)])
            return Result(code == 0, f"{row['label']} runs when opened, so it's shown in Finder instead."
                          if code == 0 else f"Couldn't show it: {clip(err, 80)}")
        code, _, err = ctx.run(["open", str(path)])
        return Result(code == 0, f"Opened {row['label']}." if code == 0 else f"Couldn't open it: {clip(err, 80)}")
