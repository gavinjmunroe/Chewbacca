#!/usr/bin/env python3
"""live_glass: a background agent may not draw over the person's work. Run: python3 tests/test_live_glass.py"""
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "bin" / "lib"))
import live_glass as lg  # noqa: E402

failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


agent = {"CLAUDECODE": "1"}
check("an agent is refused while the person is typing", lg.refusal(agent, idle=5.0) is not None)
check("and told how to check offscreen", "HUD_LINES_FILE" in (lg.refusal(agent, idle=5.0) or ""))
check("an agent may draw on an idle Mac", lg.refusal(agent, idle=lg.IDLE_S + 1) is None)
check("the person asking (KYBER_LIVE_OK) lets it draw", lg.refusal({**agent, "KYBER_LIVE_OK": "1"}, idle=1.0) is None)
check("anything that is not an agent is never refused", lg.refusal({}, idle=0.0) is None)
check("the voice assistant marks its model as asked-for",
      'os.environ["KYBER_LIVE_OK"] = "1"' in (Path(__file__).resolve().parent.parent / "bin" / "hud-listen").read_text())
print("all passed" if not failed else f"{failed} failed")
sys.exit(1 if failed else 0)
