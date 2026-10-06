#!/usr/bin/env python3
"""bin/chewbacca-permissions and the Swift card in mac/permission-guide.

Hermetic: every TCC database here is a temp file shaped like the real ones,
both apps are temp bundles holding only an Info.plist, and the helper is only
ever asked to `describe`, `status` and `list`, which draw nothing and open
nothing. No grant is read from or written to this Mac, and System Settings is
never opened.
"""

from __future__ import annotations

import importlib.machinery
import importlib.util
import json
import os
import plistlib
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CLI = ROOT / "bin" / "chewbacca-permissions"
PACKAGE = ROOT / "mac" / "permission-guide"
HELPER = PACKAGE / ".build" / "release" / "permission-guide"

loader = importlib.machinery.SourceFileLoader("chewbacca_permissions", str(CLI))
spec = importlib.util.spec_from_loader("chewbacca_permissions", loader)
perms = importlib.util.module_from_spec(spec)
loader.exec_module(perms)

failures = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global failures
    print(f"  {'ok  ' if ok else 'FAIL'} {name}" + (f": {detail}" if detail and not ok else ""))
    if not ok:
        failures += 1


def fake_app(root: Path, name: str, bundle_id: str) -> Path:
    app = root / f"{name}.app"
    (app / "Contents").mkdir(parents=True)
    with open(app / "Contents" / "Info.plist", "wb") as handle:
        plistlib.dump({"CFBundleIdentifier": bundle_id, "CFBundleName": name}, handle)
    return app


def tcc_db(path: Path, rows: list[tuple[str, str, int]]) -> Path:
    """A database with the columns the CLI, the helper and axgrant all read."""
    con = sqlite3.connect(path)
    con.execute("create table access (service text, client text, client_type int, auth_value int, "
                "csreq blob, indirect_object_identifier text)")
    for service, client, auth in rows:
        con.execute("insert into access values (?, ?, 0, ?, null, 'UNUSED')", (service, client, auth))
    con.commit()
    con.close()
    return path


def run(args: list[str], env: dict[str, str]) -> subprocess.CompletedProcess:
    return subprocess.run(args, capture_output=True, text=True, timeout=60, env={**os.environ, **env})


def main() -> int:
    work = Path(tempfile.mkdtemp())
    try:
        kyber = fake_app(work, "Kyber", "dev.bobthebuilder.hud")
        host = fake_app(work, "Visual Studio Code", "com.microsoft.VSCode")
        everything = [
            ("kTCCServiceAccessibility", "dev.bobthebuilder.hud", 2),
            ("kTCCServiceScreenCapture", "dev.bobthebuilder.hud", 2),
            ("kTCCServiceSystemPolicyAllFiles", "com.microsoft.VSCode", 2),
        ]
        system = tcc_db(work / "system.db", everything)
        user = tcc_db(work / "user.db", [("kTCCServiceMicrophone", "dev.bobthebuilder.hud", 2)])
        env = {"CHEWBACCA_KYBER_APP": str(kyber), "CHEWBACCA_HOST_APP": str(host),
               "CHEWBACCA_TCC_SYSTEM_DB": str(system), "CHEWBACCA_TCC_USER_DB": str(user)}

        def plan(extra: dict[str, str] | None = None) -> dict:
            out = run([sys.executable, str(CLI), "plan"], {**env, **(extra or {})})
            return json.loads(out.stdout)

        report = plan()
        ids = [need["id"] for need in report["needs"]]
        check("plan names exactly what Chewbacca needs, Full Disk Access first",
              ids == ["host.full-disk-access", "kyber.accessibility",
                      "kyber.screen-recording-and-system-audio", "kyber.microphone"], str(ids))
        check("plan reads every grant as granted from the fixture databases",
              report["missing"] == [], str(report["missing"]))
        check("plan names the host from the env override", report["host"]["detected_by"] == "env")
        check("the row label is the Finder name, not CFBundleName",
              report["needs"][0]["app_name"] == "Visual Studio Code")

        # Switched off in the list: the row exists with auth_value 0.
        off = tcc_db(work / "user-off.db", [("kTCCServiceMicrophone", "dev.bobthebuilder.hud", 0)])
        report = plan({"CHEWBACCA_TCC_USER_DB": str(off)})
        check("a switched-off microphone is missing and nothing else is",
              report["missing"] == ["kyber.microphone"], str(report["missing"]))

        # Neither database readable: the state of a fresh Mac before Full Disk
        # Access. Unknown must never be reported as granted.
        report = plan({"CHEWBACCA_TCC_SYSTEM_DB": str(work / "absent-1.db"),
                       "CHEWBACCA_TCC_USER_DB": str(work / "absent-2.db")})
        statuses = {need["status"] for need in report["needs"]}
        check("unreadable databases read as unknown, not granted or denied",
              statuses == {"unknown"}, str(statuses))
        check("and unknown grants are listed as missing", len(report["missing"]) == 4)

        report = plan({"CHEWBACCA_KYBER_APP": str(work / "Nowhere.app")})
        kyber_states = {n["status"] for n in report["needs"] if n["target"] == "kyber"}
        check("an uninstalled Kyber is app-missing, never granted", kyber_states == {"app-missing"})

        check("check exits 0 for a granted grant",
              run([sys.executable, str(CLI), "check", "--app", str(kyber), "--permission", "microphone"],
                  env).returncode == 0)
        check("check exits 1 for a switched-off grant",
              run([sys.executable, str(CLI), "check", "--app", str(kyber), "--permission", "microphone"],
                  {**env, "CHEWBACCA_TCC_USER_DB": str(off)}).returncode == 1)
        check("check exits 2 when it cannot tell",
              run([sys.executable, str(CLI), "check", "--app", str(kyber), "--permission", "microphone"],
                  {**env, "CHEWBACCA_TCC_USER_DB": str(work / "absent.db"),
                   "CHEWBACCA_TCC_SYSTEM_DB": str(work / "absent.db")}).returncode == 2)
        check("check refuses an unknown permission",
              run([sys.executable, str(CLI), "check", "--app", str(kyber), "--permission", "camera"],
                  env).returncode == 2)
        check("guide --only refuses a permission Chewbacca does not need",
              run([sys.executable, str(CLI), "guide", "--only", "camera"], env).returncode == 2)
        check("guide refuses a non-positive timeout",
              run([sys.executable, str(CLI), "guide", "--timeout", "0"], env).returncode == 2)
        check("guide with nothing missing opens nothing and says so",
              "already allowed" in run([sys.executable, str(CLI), "guide"], env).stdout)

        # Meeting capture's grants belong to the host, not Kyber, and stay out
        # of the default walk.
        capture = json.loads(run([sys.executable, str(CLI), "plan", "--for", "capture"], env).stdout)
        check("plan --for capture names the host's screen and mic, screen first",
              [n["id"] for n in capture["needs"]] == ["host.screen-recording-and-system-audio", "host.microphone"],
              str([n["id"] for n in capture["needs"]]))
        check("the host has neither in the fixtures, so both are missing",
              capture["missing"] == ["host.screen-recording-and-system-audio", "host.microphone"],
              str(capture["missing"]))
        granted = tcc_db(work / "system-capture.db", everything + [
            ("kTCCServiceScreenCapture", "com.microsoft.VSCode", 2)])
        mic = tcc_db(work / "user-capture.db", [("kTCCServiceMicrophone", "com.microsoft.VSCode", 2)])
        capture = json.loads(run([sys.executable, str(CLI), "plan", "--for", "capture"],
                                 {**env, "CHEWBACCA_TCC_SYSTEM_DB": str(granted),
                                  "CHEWBACCA_TCC_USER_DB": str(mic)}).stdout)
        check("and once the host has both, nothing is missing", capture["missing"] == [], str(capture["missing"]))
        check("guide --for capture --only refuses a grant capture does not need",
              run([sys.executable, str(CLI), "guide", "--for", "capture", "--only", "accessibility"],
                  env).returncode == 2)

        check("a helper inside a bundle belongs to the outermost app",
              perms.outermost_app("/Applications/Visual Studio Code.app/Contents/Frameworks/"
                                  "Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)")
              == Path("/Applications/Visual Studio Code.app"))
        check("a bare binary belongs to no app", perms.outermost_app("/bin/zsh") is None)

        if shutil.which("swift") is None:
            print("  skip helper build and argument checks (no swift on this machine)")
        else:
            built = subprocess.run(["swift", "build", "-c", "release", "--package-path", str(PACKAGE)],
                                   capture_output=True, text=True, timeout=900)
            check("the helper builds", built.returncode == 0 and HELPER.exists(), built.stderr[-400:])
            if HELPER.exists():
                helper_checks(env, kyber, host, off)
    finally:
        shutil.rmtree(work, ignore_errors=True)

    print(f"\n{'FAILED' if failures else 'passed'}: {failures} failure(s)")
    return 1 if failures else 0


def helper_checks(env: dict[str, str], kyber: Path, host: Path, off: Path) -> None:
    listed = json.loads(run([str(HELPER), "list"], env).stdout)["permissions"]
    swift_table = {p["id"]: (p["pane"], p["service"]) for p in listed}
    check("the helper and the CLI agree on every id, pane and TCC service",
          swift_table == perms.PERMISSIONS, str(set(swift_table.items()) ^ set(perms.PERMISSIONS.items())))

    described = json.loads(run([str(HELPER), "describe", "--app", str(kyber),
                                "--permission", "accessibility"], env).stdout)
    check("describe carries Anarlog's card copy",
          described["title"] == "Allow Accessibility"
          and described["subtitle"] == "Drag the app below into the list above.", str(described))
    check("describe opens the exact Privacy pane",
          described["settings_url"].endswith("PrivacySecurity.extension?Privacy_Accessibility"))
    toggled = json.loads(run([str(HELPER), "describe", "--app", str(kyber),
                              "--permission", "microphone"], env).stdout)
    check("a toggle pane points at the switch, not a drop",
          toggled["mode"] == "toggle" and toggled["subtitle"] == "Switch Kyber on in the list above.")

    def status(extra: dict[str, str], *flags: str) -> str:
        out = run([str(HELPER), "status", "--app", str(kyber), "--permission", "microphone", *flags],
                  {**env, **extra})
        return json.loads(out.stdout)["status"]

    check("the helper reads a granted row", status({}) == "granted")
    check("the helper reads a switched-off row as denied",
          status({"CHEWBACCA_TCC_USER_DB": str(off)}) == "denied")
    check("the helper reads unreadable databases as unknown",
          status({"CHEWBACCA_TCC_USER_DB": "/nonexistent/a.db",
                  "CHEWBACCA_TCC_SYSTEM_DB": "/nonexistent/b.db"}) == "unknown")
    check("a check command overrides the databases",
          status({}, "--check-command", "exit 1") == "denied"
          and status({}, "--check-command", "exit 2") == "unknown")

    bad = [
        (["status"], "no --permission"),
        (["status", "--permission", "accessibility"], "no --app"),
        (["status", "--app", str(kyber), "--permission", "camera"], "an unknown permission"),
        (["status", "--app", "/tmp", "--permission", "accessibility"], "a path that is not an app"),
        (["status", "--app", str(kyber), "--permission", "accessibility", "--bogus"], "an unknown flag"),
        (["guide", "--app", str(kyber), "--permission", "accessibility", "--timeout", "-5"],
         "a negative timeout"),
        (["guide", "--app", str(kyber), "--permission", "accessibility", "--timeout"], "a flag with no value"),
        (["status", "--app", str(kyber), "--permission", "accessibility",
          "--automation-target", "com.apple.mail"], "an automation target on another permission"),
        (["launch"], "an unknown command"),
    ]
    for args, what in bad:
        code = run([str(HELPER), *args], env).returncode
        check(f"the helper exits 2 on {what}", code == 2, f"exit {code}")
    check("the helper prints help and exits 0", run([str(HELPER), "--help"], env).returncode == 0)


if __name__ == "__main__":
    sys.exit(main())
