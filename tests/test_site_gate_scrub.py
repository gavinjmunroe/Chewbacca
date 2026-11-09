"""site-gate scrub's verdict, offline. On the Firm Foundation hero (2026-11-01) a
shadowed-variable crash showed only in the console, and course names sat 10px from
a phone's edge. scrub_fails decides from the frames; this pins what it refuses."""
import importlib.machinery
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
loader = importlib.machinery.SourceFileLoader("site_gate", str(ROOT / "bin" / "site-gate"))
spec = importlib.util.spec_from_loader("site_gate", loader)
sg = importlib.util.module_from_spec(spec)
loader.exec_module(sg)


def main():
    failures = 0

    def check(name, cond):
        nonlocal failures
        print(f"  {'ok  ' if cond else 'FAIL'}  {name}")
        failures += not cond

    clean = {"width": 390, "step": 0.5, "errors": [], "edge": []}
    check("a clean frame passes", sg.scrub_fails([clean]) == [])
    crash = dict(clean, errors=["TypeError: out.push is not a function"])
    f = sg.scrub_fails([crash])
    check("a console error fails with its text", len(f) == 1 and "out.push" in f[0])
    edge = dict(clean, edge=[{"text": "WEBSITE", "left": 10, "right": 300}])
    f = sg.scrub_fails([edge])
    check("text 10px from the left fails", len(f) == 1 and "10px from the left" in f[0])
    right = dict(clean, edge=[{"text": "BACK END", "left": 300, "right": 4}])
    check("text 4px from the right names the right side", "4px from the right" in sg.scrub_fails([right])[0])
    check("the probe skips faint and hidden text", "a < 0.3" in sg.SCRUB_PROBE and "visibility" in sg.SCRUB_PROBE)
    check("the gutter is 16px", sg.GUTTER_PX == 16)
    print(f"site-gate scrub: {failures} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
