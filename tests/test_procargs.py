#!/usr/bin/env python3
"""Process identity without `ps`: procargs reads argv and env from the kernel.

On 10/13 the stranger rig ran `realm-ui start` under sandbox-exec, where the
setuid `ps` may not run: identity came back false, start waited 10 s and said
the page server "did not come up" while it was serving. Codex runs commands in
the same kind of sandbox. This runs the identity checks inside sandbox-exec
and shows they still know their own processes.
Run: python3 tests/test_procargs.py
"""
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "bin" / "lib"))
import procargs  # noqa: E402

failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


me = procargs.args(os.getpid())
check("this process: its own script in argv, PATH in env",
      me is not None and any(a.endswith("test_procargs.py") for a in me[0]) and "PATH" in me[1], me and me[0][:2])
check("a bad pid is None, not a crash", procargs.args(-1) is None and procargs.args(0) is None)

tmp = Path(tempfile.mkdtemp(prefix="procargs-"))
home = tmp / "realm home"
home.mkdir()
fake = tmp / "dist" / "main.js"
fake.parent.mkdir()
fake.write_text("import time\ntime.sleep(20)\n")
server = tmp / "realm_ui" / "server.mjs"
server.parent.mkdir()
server.write_text("import time\ntime.sleep(20)\n")
py = sys.executable
child = subprocess.Popen([py, str(fake)], env={"REALM_HOME": str(home), "PATH": "/usr/bin:/bin"})
page = subprocess.Popen([py, str(server)], env={"PATH": "/usr/bin:/bin"})
try:
    time.sleep(0.4)
    got = procargs.args(child.pid)
    check("a child: its script in argv and REALM_HOME in env",
          got is not None and got[0][-1] == str(fake) and got[1].get("REALM_HOME") == str(home), got)

    probe = (f"import sys; sys.path.insert(0, {str(ROOT / 'bin' / 'lib')!r}); "
             "import realm_client, realm_ui, subprocess\n"
             "try:\n    subprocess.run(['ps', '-p', '1'], capture_output=True); ps = 'ran'\n"
             "except OSError:\n    ps = 'refused'\n"
             f"print(ps, realm_client.is_realm_server({child.pid}, __import__('pathlib').Path({str(home)!r})),"
             f" realm_client.is_realm_server({child.pid}, __import__('pathlib').Path('/elsewhere')),"
             f" realm_ui._is_ours({page.pid}), realm_ui._is_ours({child.pid}))\n")
    sb = shutil.which("sandbox-exec")
    if sys.platform != "darwin" or not sb:
        print("skip the sandbox half: no sandbox-exec here")
    else:
        prof = tmp / "p.sb"
        prof.write_text("(version 1)\n(allow default)\n")
        out = subprocess.run([sb, "-f", str(prof), py, "-c", probe], capture_output=True, text=True,
                             env={"PATH": "/usr/bin:/bin", "HOME": str(tmp)}, timeout=30)
        words = out.stdout.split()
        check("inside the sandbox ps can't run (the condition this fixes)", words[:1] == ["refused"], out.stdout + out.stderr)
        check("and the engine is still known as the engine on its own home", words[1:2] == ["True"], out.stdout + out.stderr[-300:])
        check("but not on another home", words[2:3] == ["False"], out.stdout)
        check("and the page server is known as the page server", words[3:4] == ["True"], out.stdout)
        check("and the engine isn't mistaken for the page server", words[4:5] == ["False"], out.stdout)
finally:
    child.kill()
    page.kill()
    shutil.rmtree(tmp, ignore_errors=True)

print(f"\n{'all passed' if not failed else f'{failed} failed'}")
sys.exit(1 if failed else 0)
