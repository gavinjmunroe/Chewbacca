"""The hourly verse: one per hour, stable inside the hour, and every line safe to draw."""

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

    base = 1_800_000_000.0
    check("two runs in one hour agree", m.verse_for(base) == m.verse_for(base + 59))
    check("the next hour moves on", m.verse_for(base) != m.verse_for(base + 3600))
    day = {m.verse_for(base + h * 3600) for h in range(24)}
    check("a day never repeats a verse", len(day) == 24, f"{len(day)} of 24")
    refs = [r for r, _ in m.VERSES]
    check("no verse listed twice", len(refs) == len(set(refs)))
    # The Kyber Lines parser ends a value at the next double quote.
    bad = [r for r, t in m.VERSES if '"' in t or '"' in r or "\n" in t]
    check("no double quote or newline in a verse", not bad, ", ".join(bad))
    p = m.payload(*m.VERSES[0])
    check("payload takes itself down", "life=" in p and p.startswith("@ verse "))
    check("payload never breaks through a hidden display", "urgency=ambient" in p)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
