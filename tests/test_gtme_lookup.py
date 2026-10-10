"""gtme-lookup: ZoomInfo's free searches and Fireflies meetings, hermetic.

A local HTTP server plays ZoomInfo and Fireflies, a throwaway RSA key plays
the credential, and a JSON file stands in for the keychain. Nothing reaches
api.zoominfo.com, api.fireflies.ai or the real keychain. Every name is made up.
"""
import base64
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOL = ROOT / "bin" / "gtme-lookup"
CHECKS = 0
SEEN = []
STATE = {"auth_429": 0, "ff_mode": "ok"}


def ok(cond, msg=""):
    global CHECKS
    assert cond, msg
    CHECKS += 1


def b64d(s):
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


class Fake(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def reply(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(n) or b"{}")
        auth = self.headers.get("Authorization", "")
        SEEN.append({"path": self.path, "auth": auth, "body": body})
        if self.path == "/zi/authenticate":
            if STATE["auth_429"] > 0:
                STATE["auth_429"] -= 1
                return self.reply(429, {})
            parts = auth.removeprefix("Bearer ").split(".")
            payload = json.loads(b64d(parts[1]))
            if payload.get("aud") != "enterprise_api" or payload.get("username") != "zi-user" or len(parts) != 3:
                return self.reply(401, {})
            return self.reply(200, {"jwt": "server.jwt.token"})
        if self.path.startswith("/zi/search/") and auth != "Bearer server.jwt.token":
            return self.reply(401, {})
        if self.path == "/zi/search/company":
            return self.reply(200, {"data": [{"id": 101, "name": "Example Co", "website": "example.com"}, {"name": "no id"}]})
        if self.path == "/zi/search/contact":
            return self.reply(200, {"contacts": [{"id": 7, "firstName": "Pat", "lastName": "Example", "hasEmail": 1,
                                                  "contactAccuracyScore": 92}]})
        if self.path == "/ff":
            if STATE["ff_mode"] == "error":
                return self.reply(200, {"errors": [{"message": "bad key"}]})
            now = int(time.time() * 1000)
            return self.reply(200, {"data": {"transcripts": [
                {"id": "a", "title": "Recent call", "date": now - 86400000, "participants": ["x@example.com", "x@example.com"],
                 "summary": {"overview": "o", "action_items": "one\n\ntwo"}},
                {"id": "b", "title": "Old call", "date": now - 200 * 86400000, "participants": []}]}})
        self.reply(404, {})


def run(args, secrets, extra=None):
    env = dict(os.environ, GTME_LOOKUP_TEST="1", GTME_LOOKUP_SECRETS_FILE=secrets,
               GTME_LOOKUP_ZOOMINFO_BASE=f"{BASE}/zi", GTME_LOOKUP_FIREFLIES_URL=f"{BASE}/ff", **(extra or {}))
    p = subprocess.run(["node", str(TOOL), *args], capture_output=True, text=True, env=env, timeout=60)
    return p.returncode, (json.loads(p.stdout) if p.stdout.strip().startswith("{") else p.stdout), p.stderr


def main():
    global BASE
    srv = HTTPServer(("127.0.0.1", 0), Fake)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    BASE = f"http://127.0.0.1:{srv.server_port}"
    with tempfile.TemporaryDirectory() as d:
        key = subprocess.run(["node", "-e", "const {generateKeyPairSync}=require('crypto');"
                              "process.stdout.write(generateKeyPairSync('rsa',{modulusLength:2048}).privateKey"
                              ".export({type:'pkcs8',format:'pem'}))"], capture_output=True, text=True, check=True).stdout
        full = Path(d) / "s.json"
        # The key arrives the way env vars carry it: literal \n between lines.
        full.write_text(json.dumps({"chewbacca-zoominfo-username": "zi-user", "chewbacca-zoominfo-client-id": "cid",
                                    "chewbacca-zoominfo-private-key": key.replace("\n", "\\n"),
                                    "chewbacca-fireflies-api-key": "ff-key"}))
        empty = Path(d) / "e.json"
        empty.write_text("{}")

        code, out, _ = run(["zoominfo", "company-search", "--name", "Example", "--website", "https://www.example.com/x", "--max", "99"], str(full))
        ok(code == 0 and out["count"] == 1 and out["data"][0]["companyId"] == "101" and out["credits"] == 0, f"company search: {out}")
        body = SEEN[-1]["body"]
        ok(body == {"companyName": "Example", "rpp": 25, "page": 1, "companyWebsite": "http://www.example.com"},
           f"body is Togari's: rpp capped at 25, website normalized: {body}")
        code, out, _ = run(["zoominfo", "person-search", "--company", "Example", "--title", "CEO", "--title", "Founder",
                            "--min-confidence", "85"], str(full))
        ok(code == 0 and out["data"][0]["fullName"] == "Pat Example" and out["data"][0]["hasEmail"] is True, f"person search: {out}")
        ok(SEEN[-1]["body"]["jobTitle"] == "CEO OR Founder" and SEEN[-1]["body"]["contactAccuracyScoreMin"] == "85", "titles OR-joined")
        code, out, _ = run(["zoominfo", "person-search", "--company", "Example", "--min-confidence", "50"], str(full))
        ok(code == 2 and out["class"] == "usage", "confidence outside 70 to 99 is refused before any call")
        STATE["auth_429"] = 1
        code, out, _ = run(["zoominfo", "company-search", "--name", "Example"], str(full))
        ok(code == 0, "a 429 on authenticate is retried")
        for sub in ("company-enrich", "person-enrich", "similar-companies"):
            n = len(SEEN)
            code, out, _ = run(["zoominfo", sub], str(full))
            ok(code == 3 and out["gate"] == "write:spends-credits" and len(SEEN) == n, f"{sub} spends credits: refused, no call")
        code, out, _ = run(["zoominfo", "company-search", "--name", "Example"], str(empty))
        ok(code == 3 and out["class"] == "not_configured" and "chewbacca-zoominfo-username" in out["missing"], "missing keys say which")

        code, out, _ = run(["fireflies", "meetings", "--since-days", "30"], str(full))
        ok(code == 0 and out["fetched"] == 1 and out["data"][0]["actionItems"] == ["one", "two"]
           and out["data"][0]["attendees"] == ["x@example.com"], f"fireflies: window, dedupe, action items: {out}")
        ok(SEEN[-1]["auth"] == "Bearer ff-key" and SEEN[-1]["body"]["variables"] == {"limit": 12}, "bearer key, default limit")
        STATE["ff_mode"] = "error"
        code, out, _ = run(["fireflies", "meetings"], str(full))
        ok(code == 1 and "bad key" in out["reason"], "a GraphQL error is an error, not an empty list")

        code, out, _ = run(["status"], str(full))
        text = json.dumps(out)
        ok(code == 0 and out["present"]["fireflies"]["chewbacca-fireflies-api-key"] is True
           and "ff-key" not in text and "PRIVATE KEY" not in text, "status names items and never prints a value")
        # The test seams are dead without GTME_LOOKUP_TEST=1: no env var can point a real key elsewhere.
        src = (ROOT / "tools" / "gtme_lookup.js").read_text()
        ok("TEST && process.env.GTME_LOOKUP_FIREFLIES_URL" in src and "TEST && process.env.GTME_LOOKUP_SECRETS_FILE" in src,
           "every seam is gated on GTME_LOOKUP_TEST")
    srv.shutdown()
    print(f"gtme-lookup: {CHECKS} checks passed")


if __name__ == "__main__":
    main()
