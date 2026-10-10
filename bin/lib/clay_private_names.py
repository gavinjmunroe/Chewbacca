"""Every name this Mac knows that a person typed into Clay or the GTM store.

Read at run time only, never written anywhere: the clay CLI listing
(tables, columns, campaigns, workflows, workbooks, folders, audiences,
users) cached in the private crawl folder, and the gtm-memory store
(clients, campaigns, experiments, Clay tables and columns, contact and
account keys such as names, emails and domains). Used by the tests that
prove none of it reaches the committed Clay map, and when the fixed UI word
list is reviewed.
"""
from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path

PRIVATE = Path(os.environ.get("CLAY_PRIVATE_DIR", Path.home() / "Library/Caches/chewbacca-clay"))
GTM_DB = Path(os.environ.get("GTM_MEMORY_DB", Path.home() / ".chewbacca/gtm/memory.db"))


def names() -> set[str]:
    out: set[str] = set()
    try:
        out |= set(json.loads((PRIVATE / "workspace-names.json").read_text()))
    except (OSError, ValueError):
        pass
    if GTM_DB.exists():
        try:
            db = sqlite3.connect(f"file:{GTM_DB}?mode=ro", uri=True)
            for table, col in (("clients", "name"), ("campaigns", "name"), ("experiments", "name"),
                               ("clay_workspaces", "name"), ("clay_tables", "name"), ("clay_columns", "name"),
                               ("employment", "title"), ("contact_keys", "value"), ("account_keys", "value")):
                try:
                    out |= {str(r[0]) for r in db.execute(f"SELECT {col} FROM {table}") if r[0]}
                except sqlite3.Error:
                    continue
            db.close()
        except sqlite3.Error:
            pass
    return {n.strip() for n in out if n and len(n.strip()) >= 3}
