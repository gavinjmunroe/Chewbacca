#!/usr/bin/env python3
"""The press on a recipe, end to end, with the code on a captured fake screen.

A code can't go anywhere a shell test could read it (send_approval's rule), so
this drives run_recipe in process, the same way test_send_approval.py does.
"""
import contextlib
import importlib.util
import io
import json
import os
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
scratch = tempfile.TemporaryDirectory()
T = Path(scratch.name)
os.environ["HOME"] = str(T / "home")
os.environ["CHEWBACCA_SEND_APPROVALS"] = str(T / "approvals")
os.environ.pop("CHEWBACCA_SEND_CODE", None)
os.environ.pop("CHEWBACCA_NO_SEND", None)
(T / "home/.chewbacca/policy").mkdir(parents=True)
(T / "approvals").mkdir()

spec = importlib.util.spec_from_file_location("recipe", ROOT / "tools/recipe.py")
recipe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recipe)

FAILS = []
shown = []


def check(name, cond, detail=""):
    print(("ok   " if cond else "FAIL ") + name + ("" if cond else ": " + str(detail)))
    if not cond:
        FAILS.append(name)


def fake_screen(code, what):
    shown.append((code, what))
    return True


def go(path, params, code=None, chain=None):
    out = io.StringIO()
    env = {"CHEWBACCA_SEND_CODE": code} if code else {}
    with contextlib.redirect_stdout(out):
        rc = recipe.run_recipe(str(path), params, show=fake_screen, tty=lambda *_a: None, env=env,
                               chain=[] if chain is None else chain)
    return rc, out.getvalue()


def test_press():
    path = T / "press.json"
    path.write_text(json.dumps({
        "version": 1, "title": "Press", "description": "x",
        "parameters": [{"key": "n", "type": "string"}],
        "steps": [
            {"id": "read", "run": ["printf", "read\n"]},
            {"id": "act", "gate": "writes the marker", "run": ["touch", str(T / "pressed-{{n}}")]},
        ],
    }))

    rc, out = go(path, {"n": "one"})
    check("no press stops the run", rc == 3, (rc, out))
    check("the read step before it did not run", "read: exit" not in out, out)
    check("the marker was not written", not (T / "pressed-one").exists())
    check("the output shows the exact command", "pressed-one" in out, out)
    check("a code reached the screen", len(shown) == 1, shown)
    code = shown[-1][0]
    check("the screen shows the command", "pressed-one" in shown[-1][1], shown)

    rc, _ = go(path, {"n": "two"}, code=code)
    check("the code for other values is refused", rc == 3)
    check("other values ran nothing", not (T / "pressed-two").exists())
    rc, _ = go(path, {"n": "one"}, code="000000" if code != "000000" else "000001")
    check("a wrong code is refused", rc == 3)
    check("a wrong code ran nothing", not (T / "pressed-one").exists())

    rc, out = go(path, {"n": "one"}, code=code)
    check("the right code runs it", rc == 0, out)
    check("the pressed step ran", (T / "pressed-one").exists())
    check("it reports the press", "press: code" in out, out)
    check("the steps ran in order", out.index("read: exit 0") < out.index("act: exit 0"), out)
    (T / "pressed-one").unlink()

    rc, _ = go(path, {"n": "one"}, code=code)
    check("a press works once", rc == 3)
    check("a spent code ran nothing", not (T / "pressed-one").exists())

    # A code bound to one recipe file doesn't carry to an edited copy that runs the
    # same command: the file's hash is in what the press covers.
    before = len(shown)
    go(path, {"n": "three"})
    code3 = shown[-1][0]
    check("a fresh code is drawn", len(shown) == before + 1)
    edited = json.loads(path.read_text())
    edited["description"] = "edited after the press"
    path.write_text(json.dumps(edited))
    rc, _ = go(path, {"n": "three"}, code=code3)
    check("an edited file voids the press", rc == 3)
    check("the edited file ran nothing", not (T / "pressed-three").exists())

    # Agent send mode waives a press for texts. It doesn't waive this.
    (T / "approvals/mode").write_text("agent\n")
    rc, _ = go(path, {"n": "four"})
    check("agent send mode does not waive the press", rc == 3)
    check("agent mode ran nothing", not (T / "pressed-four").exists())
    (T / "approvals/mode").write_text("press\n")

    # A toast can't hide a second step past its cut.
    long_path = T / "long.json"
    long_path.write_text(json.dumps({
        "version": 1, "title": "Long", "description": "x", "parameters": [],
        "steps": [
            {"id": "benign", "run": ["touch", "/tmp/" + "a" * 200]},
            {"id": "nasty", "run": ["rm", "-rf", str(T / "x")]},
        ],
    }))
    go(long_path, {})
    check("a long press says there's more", "more chars" in shown[-1][1], shown[-1])
    check("the toast fits what's drawn", len(shown[-1][1]) <= 140, len(shown[-1][1]))

    # The hold beats a real code, and offers none.
    good = len(shown)
    go(path, {"n": "five"})
    code5 = shown[-1][0]
    (T / "home/.chewbacca/policy/send-hold").write_text("")
    drawn = len(shown)
    rc, out = go(path, {"n": "five"}, code=code5)
    check("the send hold beats a real code", rc == 4, (rc, out))
    check("the hold ran nothing", not (T / "pressed-five").exists())
    check("the hold drew no code", len(shown) == drawn)
    (T / "home/.chewbacca/policy/send-hold").unlink()

    # A press module that can't load means no press, never a run.
    real = recipe._send_approval
    recipe._send_approval = lambda: (_ for _ in ()).throw(RuntimeError("gone"))
    rc, out = go(path, {"n": "six"})
    recipe._send_approval = real
    check("a press module that won't load refuses", rc == 3, (rc, out))
    check("it ran nothing", not (T / "pressed-six").exists())
    assert not FAILS, FAILS


if __name__ == "__main__":
    test_press()
