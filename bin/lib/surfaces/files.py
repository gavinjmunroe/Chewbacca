"""files: the newest things in Downloads, one of them previewed on the glass.

Replaces opening Finder to find the thing that just downloaded. The newest
file is previewed in a File component (PDF, image or text, drawn by Kyber
itself); "Preview" picks another.

AN ALLOWLIST, NOT A DENYLIST. The first version refused a list of runnable
extensions and opened everything else, which a security review on 2026-10-04
broke six ways: .terminal, .webloc, .inetloc and .fileloc all run or navigate
when opened, a symlink can point anywhere, and an app bundle is a directory
whose name can end in anything. Now only passive documents the HUD can draw
itself (PDF, images, plain text, Markdown, CSV) are previewed or opened, and
only when the resolved path is a regular file inside Downloads. Everything
else gets "Reveal in Finder" and nothing more: a press on the glass never
launches a file a website or a sender chose the name of.
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path

from . import ACTION_PREFIX, Bind, Context, Provider, Result, SurfaceError, ago, clip, comp, note_for

MOST_FILES = 7
# Passive documents: Kyber's File component draws them, and macOS opens them
# in a viewer (Preview, TextEdit), never as a program.
PASSIVE = {".pdf", ".png", ".jpg", ".jpeg", ".gif", ".heic", ".webp", ".tiff", ".bmp",
           ".txt", ".md", ".markdown", ".csv"}
# Still being written by a browser.
PARTIAL = {".crdownload", ".download", ".part", ".partial"}


def size_label(n: int) -> str:
    for unit, step in (("GB", 1 << 30), ("MB", 1 << 20), ("KB", 1 << 10)):
        if n >= step:
            return f"{n / step:.1f} {unit}".replace(".0 ", " ")
    return f"{n} B"


def passive(path: Path, folder: Path) -> bool:
    """True only for a regular file, not a link, with a passive extension,
    whose fully resolved path is still directly inside `folder`."""
    try:
        if path.is_symlink():
            return False
        real = path.resolve(strict=True)
        root = folder.resolve(strict=True)
    except (OSError, RuntimeError):
        return False
    return real.parent == root and real.is_file() and real.suffix.lower() in PASSIVE


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
                st = p.lstat()
            except OSError:
                continue
            rows.append({"path": str(p), "name": p.name, "mtime": st.st_mtime,
                         "size": 0 if p.is_dir() else st.st_size, "dir": p.is_dir(),
                         "passive": passive(p, root)})
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
            comp(self.cid("open"), "Button", label=Bind(self.p("go")), action=f"{ACTION_PREFIX}open",
                 variant="primary"),
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
        """For display: the picked row, else the newest."""
        rows = (data or {}).get("rows") or []
        return self.chosen(data, values) or (rows[0] if rows else None)

    def chosen(self, data, values: dict) -> dict | None:
        """For a press: exactly the picked row, never a default."""
        rows = (data or {}).get("rows") or []
        label = values.get(self.p("pick"))
        matches = [r for r in rows if r["label"] == label]
        return matches[0] if len(matches) == 1 else None

    def model(self, data, error, values, ctx) -> dict:
        if data is None:
            return {self.p("note"): note_for(None, error, ""), self.p("rows"): [], self.p("names"): [],
                    self.p("path"): "", self.p("go"): "Open"}
        now = ctx.now()
        rows = data["rows"]
        table = [{"name": clip(r["name"], 34),
                  "age": ago(datetime.fromtimestamp(r["mtime"]).astimezone(), now),
                  "size": "folder" if r["dir"] else size_label(r["size"])} for r in rows]
        shown = self.picked(data, values)
        out = {
            self.p("note"): note_for(data, error, "" if rows else "Downloads is empty.", data.get("_at")),
            self.p("rows"): table,
            self.p("names"): [r["label"] for r in rows],
            # Only a passive file reaches the File component; anything else
            # draws nothing rather than handing Kyber a path to interpret.
            self.p("path"): shown["path"] if shown and shown["passive"] else "",
            self.p("go"): "Open" if shown and shown["passive"] else "Reveal in Finder",
        }
        if not values.get(self.p("pick")) and shown:
            out[self.p("pick")] = shown["label"]
        return out

    def open(self, ctx: Context, data, values: dict) -> Result:
        row = self.chosen(data, values)
        if row is None:
            return Result(False, "That file isn't on the list any more. Pick it again.")
        folder = self.folder(ctx)
        path = Path(row["path"])
        if path.parent != folder or path.name in ("", ".", ".."):
            return Result(False, "That file isn't in Downloads any more.")
        # Re-checked at press time: the file may have been swapped for a link
        # or an app since the list was drawn.
        if passive(path, folder):
            code, _, err = ctx.run(["open", str(path.resolve())])
            return Result(code == 0, f"Opened {row['label']}." if code == 0 else f"Couldn't open it: {clip(err, 80)}")
        code, _, err = ctx.run(["open", "-R", str(path)])
        return Result(code == 0, f"{row['label']} is shown in Finder; only documents open from here."
                      if code == 0 else f"Couldn't show it: {clip(err, 80)}")
