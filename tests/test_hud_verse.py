"""The hourly verse: one per quarter hour, stable inside it, and every line safe to draw."""

from __future__ import annotations

import importlib.util
import sys
from importlib.machinery import SourceFileLoader
from pathlib import Path

BIN = Path(__file__).resolve().parent.parent / "bin" / "hud-verse"
failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'} {name} {detail}".rstrip())
    if not ok:
        failures.append(name)


def main() -> int:
    spec = importlib.util.spec_from_file_location("hud_verse", BIN, loader=SourceFileLoader("hud_verse", str(BIN)))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)

    # Landed 100644 on 2026-10-16, so `hud-verse` on PATH said permission denied.
    import os
    check("the script is executable", os.access(BIN, os.X_OK))

    base = 1_800_000_000.0
    q = m.SLOT_SECONDS
    check("two runs in one quarter hour agree", m.verse_for(base) == m.verse_for(base + 59))
    check("the next quarter hour moves on", m.verse_for(base) != m.verse_for(base + q))
    waking = (24 - len(m.QUIET_HOURS)) * 3600 // q
    day = {m.verse_for(base + i * q) for i in range(waking)}
    check("a waking day never repeats a verse", len(day) == waking, f"{len(day)} of {waking}")
    refs = [r for r, _ in m.VERSES]
    check("no verse listed twice", len(refs) == len(set(refs)))
    # The Kyber Lines parser ends a value at the next double quote.
    bad = [r for r, t in m.VERSES if '"' in t or '"' in r or "\n" in t]
    check("no double quote or newline in a verse", not bad, ", ".join(bad))
    p = m.payload(*m.VERSES[0])
    check("payload stays until he closes it", "life=" not in p and p.startswith("@ verse "))
    check("payload never breaks through a hidden display", "urgency=ambient" in p)
    ref, text = m.VERSES[1]
    p = m.payload(ref, text)
    ask = f'ask="Let\'s talk abt {ref}: {text}"'
    check("a double-click asks the chat abt this verse", ask in p.splitlines()[1], p.splitlines()[1][:80])
    check("the ask carries no stray quote", p.splitlines()[1].count('"') == 4)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
