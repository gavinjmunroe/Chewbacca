#!/usr/bin/env python3
"""Where Dough is, for the kit's gtme front doors.

Dough (calebnewtonusc/dough) owns the gtme engine: its code, tests, client config and
the gtm-engineering skill. The kit keeps the Mac layer (Jev, the Clay front door, the
Gmail draft helper, the people store, the HUD) and these front doors, so
`chewbacca gtme ...`, `python3 <kit>/tools/gtme_ready.py` and
`sys.path.insert(0, <kit>/tools); import gtme_presend` all keep working: each one runs
Dough's engine/ copy. Nothing of the engine is left in the kit.

Dough is found, in order, at:
    $DOUGH_HOME                  a Dough checkout, for working on the engine
    ~/.chewbacca/dough/current   the snapshot the kit installs (tools/kit_runtime.py
                                 dough-update, run by setup.sh and every kit update),
                                 a detached worktree of Dough's origin/main nobody edits
The second is also tried under the account's real home, so a test or the golden check
that runs under a throwaway HOME still finds it. A working checkout like ~/code/dough
is never used on its own: whatever branch it holds would change what the kit sends.

    python3 tools/dough_home.py path      the Dough root, or exit 1 with why
    python3 tools/dough_home.py status    JSON: root, commit, and whether it's current
"""
from __future__ import annotations

import importlib.util
import json
import os
import pwd
import runpy
import subprocess
import sys
from pathlib import Path

KIT = Path(__file__).resolve().parent.parent
MARK = "gtme-front-door"


class DoughMissing(RuntimeError):
    pass


def _ok(p: Path) -> bool:
    return (p / "engine" / "tools" / "gtme_solo.py").is_file()


def installed() -> Path:
    """The kit-installed snapshot path, ~/.chewbacca/dough/current."""
    return Path(os.environ.get("CHEWBACCA_DOUGH_RUNTIME") or Path.home() / ".chewbacca" / "dough") / "current"


def root() -> Path:
    given = os.environ.get("DOUGH_HOME")
    if given:
        p = Path(os.path.expanduser(given))
        if not _ok(p):
            raise DoughMissing(f"DOUGH_HOME is {given}, which has no engine/tools/gtme_solo.py")
        return p
    tried = [installed()]
    try:
        real = Path(pwd.getpwuid(os.getuid()).pw_dir) / ".chewbacca" / "dough" / "current"
        if real not in tried:
            tried.append(real)
    except (KeyError, OSError):
        pass
    for p in tried:
        if _ok(p):
            return p
    raise DoughMissing("the gtme engine lives in Dough, and Dough isn't installed here "
                       f"(looked at {', '.join(map(str, tried))}). `chewbacca update` installs it; "
                       "it needs read access to github.com/calebnewtonusc/dough")


def engine() -> Path:
    return root() / "engine"


def _point_back() -> None:
    # Dough reaches the kit's Mac layer through engine/tools/chewbacca_kit.py, which reads
    # CHEWBACCA_ROOT first. Set it to the kit this front door belongs to, so a run that
    # started in a checkout talks back to that checkout and not to whatever is on PATH.
    os.environ.setdefault("CHEWBACCA_ROOT", str(KIT))


def become(g: dict) -> None:
    """Make the calling front door (tools/<name>.py) be Dough's engine/tools/<name>.py.

    As a script it runs Dough's file as __main__. As an import it loads Dough's module
    under the same name and puts it in sys.modules, so the importer gets the real module
    (patches, attributes and siblings all land on it)."""
    name = Path(g["__file__"]).stem
    try:
        real = engine() / "tools" / f"{name}.py"
    except DoughMissing as e:
        if g.get("__name__") == "__main__":
            sys.exit(f"chewbacca: {e}")
        raise ImportError(str(e)) from None
    _point_back()
    if g.get("__name__") == "__main__":
        if sys.path and os.path.realpath(sys.path[0]) == os.path.realpath(str(KIT / "tools")):
            sys.path[0] = str(real.parent)
        else:
            sys.path.insert(0, str(real.parent))
        sys.argv[0] = str(real)
        runpy.run_path(str(real), run_name="__main__")
        sys.exit(0)
    modname = g["__name__"]
    spec = importlib.util.spec_from_file_location(modname, real)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[modname] = mod
    try:
        spec.loader.exec_module(mod)
    except BaseException:
        sys.modules.pop(modname, None)
        raise
    # A caller that loaded the front door by path holds this module object, not Dough's.
    g.update({k: v for k, v in vars(mod).items() if not (k.startswith("__") and k.endswith("__"))})


def exec_bin(name: str) -> None:
    """Replace this process with Dough's engine/bin/<name>, same arguments."""
    try:
        target = engine() / "bin" / name
    except DoughMissing as e:
        sys.exit(f"chewbacca: {e}")
    if not target.is_file():
        sys.exit(f"chewbacca: Dough at {root()} has no engine/bin/{name}")
    _point_back()
    os.execv(str(target), [str(target)] + sys.argv[1:])


def status() -> dict:
    out = {"installed": str(installed())}
    try:
        r = root()
    except DoughMissing as e:
        out.update({"ok": False, "error": str(e)})
        return out
    out.update({"ok": True, "root": str(r), "from": "DOUGH_HOME" if os.environ.get("DOUGH_HOME") else "kit"})
    head = subprocess.run(["git", "-C", str(r), "rev-parse", "HEAD"], capture_output=True, text=True)
    out["commit"] = head.stdout.strip() or None
    main = subprocess.run(["git", "-C", str(r), "rev-parse", "--verify", "--quiet", "origin/main"],
                          capture_output=True, text=True)
    out["origin_main"] = main.stdout.strip() or None
    out["current"] = bool(out["commit"]) and out["commit"] == out["origin_main"]
    return out


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    cmd = argv[0] if argv else "path"
    if cmd == "path":
        try:
            print(root())
        except DoughMissing as e:
            print(e, file=sys.stderr)
            return 1
        return 0
    if cmd == "status":
        s = status()
        print(json.dumps(s, indent=1))
        return 0 if s.get("ok") else 1
    print(__doc__.strip().splitlines()[0], file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
