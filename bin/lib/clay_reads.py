"""What clay-build reads from Clay itself, through `chewbacca clay`.

Every figure on a clay-build card comes from here or from Clay's own control
text, never from arithmetic beyond subtracting two balances. Progress and found
emails come from one rows read: the CLI reports each cell's status
(`clay tables rows list --help`, CLI 2.25.0), and `table-status` has no CLI
surface, so it cannot answer on a machine where only the CLI is signed in.

Everything Clay returns is untrusted. Names of missed rows are cleaned and
capped before they can reach a card.
"""
from __future__ import annotations

import json
import re
import subprocess
import unicodedata
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# `clay tables rows list` takes 1 to 100.
PAGE = 100

# clay-build caps a run at 500 rows, five pages of 100. Ten leaves room for
# rows added mid-read without letting a cursor that never ends loop forever.
MAX_PAGES = 10

# Measured 2026-10-09 on the reference machine (library/clay-api/measured.json):
# the slowest read, cli credits balance, took 2.3 s. Thirty is that with room
# for a cold CLI start; guessed past that.
TIMEOUT_S = 30

EMAIL_COLUMN = "Find work email"
NAME_COLUMNS = ("Full Name", "Name")
CAP = 80

DONE = {"success", "succeeded", "complete", "completed"}
RUNNING = {"running", "retry", "rate_limited", "awaiting_callback"}
QUEUED = {"queued", "pending"}
ERRORS = {"error", "failed"}

_EMAIL = re.compile(r"[^@\s]+@[^@\s]+\.[a-z]{2,}", re.IGNORECASE)


class ReadError(Exception):
    pass


class AutoRunUnknown(ReadError):
    """No surface that answered reports the auto-run setting. Never read as
    off: the hard line is that nothing runs while it might be on."""


@dataclass(frozen=True)
class Progress:
    rows: int
    done: int
    running: int
    queued: int
    errors: int

    @property
    def settled(self) -> bool:
        return self.running + self.queued == 0


@dataclass(frozen=True)
class Tally:
    rows: int
    ran: int
    found: int
    missing_names: tuple[str, ...]


def has_email(value, depth: int = 0) -> bool:
    if depth > 6:
        return False
    if isinstance(value, str):
        return bool(_EMAIL.search(value))
    if isinstance(value, dict):
        return any(has_email(v, depth + 1) for v in value.values())
    if isinstance(value, list):
        return any(has_email(v, depth + 1) for v in value)
    return False


def ids_from_href(href: str) -> tuple[str | None, str | None]:
    ws = re.search(r"/workspaces/(\d+)(?:/|$)", href or "")
    table = re.search(r"/tables/(t_[A-Za-z0-9]+)", href or "")
    return (ws.group(1) if ws else None, table.group(1) if table else None)


def _clean(text) -> str:
    """Control, format and bidi characters out, whitespace collapsed, capped."""
    if not isinstance(text, str):
        return ""
    kept = "".join(" " if ch.isspace() else ch for ch in text
                   if ch.isspace() or unicodedata.category(ch) not in ("Cc", "Cf"))
    return " ".join(kept.split())[:CAP]


def _status(cell) -> str:
    return str(cell.get("status") or "").lower() if isinstance(cell, dict) else ""


def _cells(row: dict) -> dict:
    cells = row.get("cells")
    return cells if isinstance(cells, dict) else {}


def _value(cell):
    return cell.get("value") if isinstance(cell, dict) else None


def _found(cell) -> bool:
    # Only a value Clay computed counts: an error message can quote an address.
    return _status(cell) in DONE and has_email([cell.get("value"), cell.get("fields")])


class Reads:
    def __init__(self, run=subprocess.run, root: Path = ROOT):
        self.run = run
        self.root = Path(root)

    def _call(self, op: str, **args) -> dict:
        argv = ["node", str(self.root / "bin" / "chewbacca-clay"), op,
                *(f"{k}={v}" for k, v in args.items() if v is not None)]
        try:
            proc = self.run(argv, capture_output=True, text=True, timeout=TIMEOUT_S)
        except subprocess.TimeoutExpired:
            raise ReadError(f"Clay took longer than {TIMEOUT_S} seconds to answer.") from None
        lines = [line for line in (proc.stdout or "").splitlines() if line.strip()]
        try:
            answer = json.loads(lines[-1]) if lines else None
        except ValueError:
            answer = None
        if not isinstance(answer, dict):
            raise ReadError((proc.stderr or "").strip()[:200] or "Clay did not answer.")
        if not answer.get("ok"):
            raise ReadError(str(answer.get("reason") or "Clay refused the read.")[:200])
        return answer

    def credits(self, ws: str) -> float:
        data = self._call("credits", ws=ws).get("data")
        balance = data.get("balance") if isinstance(data, dict) else None
        if isinstance(balance, bool) or not isinstance(balance, (int, float)):
            raise ReadError("Clay did not return a credit balance.")
        return float(balance)

    def auto_run(self, table: str) -> bool:
        data = self._call("table", table=table).get("data")
        settings = data.get("tableSettings") if isinstance(data, dict) else None
        if not isinstance(settings, dict) or "AUTO_RUN_ON" not in settings:
            raise AutoRunUnknown("Clay did not say whether table auto-run is on.")
        return bool(settings["AUTO_RUN_ON"])

    def _columns(self, table: str) -> list[dict]:
        data = self._call("columns", table=table).get("data")
        return [c for c in data if isinstance(c, dict) and not c.get("system")] if isinstance(data, list) else []

    def email_field(self, table: str) -> str:
        columns = self._columns(table)
        exact = [c for c in columns if c.get("name") == EMAIL_COLUMN]
        loose = [c for c in columns if "work email" in str(c.get("name", "")).lower()]
        pick = (exact or loose or [None])[0]
        if not pick or not pick.get("id"):
            raise ReadError("The table has no work email column.")
        return str(pick["id"])

    def name_field(self, table: str) -> str | None:
        columns = self._columns(table)
        for want in NAME_COLUMNS:
            for column in columns:
                if column.get("name") == want and column.get("id"):
                    return str(column["id"])
        return None

    def _rows(self, ws: str, table: str) -> list[dict]:
        rows, cursor, seen = [], None, set()
        for _ in range(MAX_PAGES):
            answer = self._call("rows", ws=ws, table=table, limit=PAGE, cursor=cursor)
            page = answer.get("data")
            rows.extend(r for r in (page if isinstance(page, list) else []) if isinstance(r, dict))
            cursor = answer.get("cursor")
            if not cursor:
                return rows
            if cursor in seen:
                raise ReadError("Clay kept returning the same page of rows.")
            seen.add(cursor)
        raise ReadError(f"The table has more than {MAX_PAGES * PAGE} rows, more than clay-build reads.")

    def progress(self, ws: str, table: str, field: str) -> Progress:
        statuses = [_status(_cells(r).get(field)) for r in self._rows(ws, table)]
        return Progress(rows=len(statuses),
                        done=sum(s in DONE for s in statuses),
                        running=sum(s in RUNNING for s in statuses),
                        queued=sum(s in QUEUED for s in statuses),
                        errors=sum(s in ERRORS for s in statuses))

    def emails(self, ws: str, table: str, field: str) -> Tally:
        rows = self._rows(ws, table)
        name = self.name_field(table)
        ran = found = 0
        missing = []
        for row in rows:
            cells = _cells(row)
            cell = cells.get(field)
            if _status(cell) in ("", "empty"):
                continue
            ran += 1
            if _found(cell):
                found += 1
            else:
                label = _clean(_value(cells.get(name))) if name else ""
                missing.append(label or "Unnamed row")
        return Tally(rows=len(rows), ran=ran, found=found, missing_names=tuple(missing))
