#!/usr/bin/env python3
"""Write the student's USC sign-in cookies for bin/lib/usc_card.mjs, and print
the file's path. The file is 0600 in a fresh private temp dir, and the .mjs
deletes it as soon as it has read it.

USCard eAccounts (usc-sp.transactcampus.com) signs in through Shibboleth and
login.usc.edu, so those hosts come along, plus the narrowed Entra set the
other USC sign-ins use (bin/chewbacca-api PROFILE_LOGIN_SITES). The profile is
whichever Chrome profile used shibboleth.usc.edu most recently, because a
student who never opened eAccounts on the web has no transactcampus cookie
to vote with (the first Mac this ran on, 2026-10-13).
"""
import hashlib
import importlib.machinery
import importlib.util
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HOSTS = {"usc-sp.transactcampus.com": None, "shibboleth.usc.edu": None, "login.usc.edu": None,
         "login.microsoftonline.com": ("ests", "buid", "fpc", "esctx", "x-ms-gateway-slice",
                                       "stsservicecookie", "ccstate", "signinstatecookie", "aadsso")}
VOTERS = ("shibboleth.usc.edu", "login.usc.edu", "usc-sp.transactcampus.com")


def brightspace():
    loader = importlib.machinery.SourceFileLoader("brightspace_reader", str(ROOT / "bin" / "brightspace"))
    spec = importlib.util.spec_from_loader("brightspace_reader", loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


def rows(db):
    with tempfile.TemporaryDirectory() as tmp:
        copy = Path(tmp) / "Cookies"
        shutil.copy(db, copy)
        con = sqlite3.connect(copy)
        out = []
        for host, prefixes in HOSTS.items():
            for r in con.execute("select host_key, name, encrypted_value, path, is_secure, is_httponly, last_access_utc"
                                 " from cookies where host_key = ? or host_key = ?", (host, "." + host)):
                if prefixes is None or r[1].lower().startswith(prefixes):
                    out.append(r)
        return out


def main():
    bs = brightspace()
    chrome = bs.CHROME_DIR
    named = os.environ.get("CHEWIE_CHROME_PROFILE")
    dbs = [chrome / named / "Cookies"] if named else sorted(chrome.glob("*/Cookies"))
    best, picked = -1, []
    for db in dbs:
        try:
            found = rows(db)
        except (OSError, sqlite3.Error):
            continue
        seen = max((r[6] for r in found if r[0].lstrip(".") in VOTERS), default=-1)
        if seen > best:
            best, picked = seen, found
    if best < 0:
        sys.exit("no USC sign-in in any Chrome profile; sign in to any USC NetID page in Chrome once")
    secret = (os.environ.get("CHEWBACCA_CHROME_SAFE_KEY", "").encode() or subprocess.check_output(
        ["security", "find-generic-password", "-w", "-s", "Chrome Safe Storage"]).strip())
    key = hashlib.pbkdf2_hmac("sha1", secret, b"saltysalt", 1003, 16)
    jar = []
    for host, name, blob, path, secure, httponly, _ in picked:
        raw = bs.aes_cbc_decrypt(key, blob[3:])
        raw = raw[: -raw[-1]]
        try:
            raw[:32].decode()
            value = raw.decode()
        except UnicodeDecodeError:
            value = raw[32:].decode()
        jar.append({"name": name, "value": value, "domain": host, "path": path or "/",
                    "secure": bool(secure), "httpOnly": bool(httponly), "expires": int(time.time()) + 3600})
    d = tempfile.mkdtemp(prefix="usc-card-")
    os.chmod(d, 0o700)
    out = os.path.join(d, "jar.json")
    fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(jar, f)
    print(out)


if __name__ == "__main__":
    main()
