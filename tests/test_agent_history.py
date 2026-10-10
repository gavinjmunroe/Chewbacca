#!/usr/bin/env python3
"""agent-history against built transcripts, never the real ones.
Run: python3 tests/test_agent_history.py

Every secret below is fake: made-up keys in the right shape, a reserved
555-01xx phone number and example.com addresses.
"""
import importlib.machinery
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
TOOL = ROOT / "bin" / "agent-history"
ah = importlib.machinery.SourceFileLoader("agent_history", str(TOOL)).load_module()

PASSED = 0
FAILED = 0


def check(name, ok, detail=""):
    global PASSED, FAILED
    if ok:
        PASSED += 1
        print(f"  pass  {name}")
    else:
        FAILED += 1
        print(f"  FAIL  {name}  {detail}")


# Fake secrets, assembled so this file itself never holds a scannable key.
FAKE = {
    "openai": "sk-" + "proj-" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4",
    "anthropic": "sk-" + "ant-" + "api03-ZZfakefakefake0123456789",
    "github": "gh" + "p_" + "abcdefghijklmnopqrstuvwxyz0123456789",
    "aws": "AK" + "IA" + "ABCDEFGHIJKLMNOP",
    "slack": "xo" + "xb-" + "1234567890-fakefakefake",
    "bearer_value": "eyFAKEtoken0123456789abcdef",
    "jwt": "eyJ" + "hbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r",
    "hex": "0123456789abcdef0123456789abcdef01234567",
    "blob": "QWxhZGRpbjpvcGVuIHNlc2FtZQ9xYz3Kq8LmNnOpRsTuVwXy",
    "email": "jane.doe@example.com",
    "phone": "+1 310 555 0142",
    "password_value": "hunter2hunter2",
}

# ------------------------------------------------------------- redact() unit

print("redaction")
samples = {
    "openai key": f"export OPENAI_API_KEY={FAKE['openai']}",
    "anthropic key": f"using {FAKE['anthropic']} here",
    "github token": f"remote https://{FAKE['github']}@github.com/x/y",
    "aws key": f"aws id {FAKE['aws']} ok",
    "slack token": f"slack {FAKE['slack']}",
    "bearer header": f"curl -H 'Authorization: Bearer {FAKE['bearer_value']}'",
    "jwt": f"cookie {FAKE['jwt']}",
    "long hex": f"digest {FAKE['hex']}",
    "base64 blob": f"payload {FAKE['blob']}",
    "email": f"mail {FAKE['email']} today",
    "phone": f"call {FAKE['phone']} now",
    "password kv": f"password = \"{FAKE['password_value']}\"",
}
secret_of = {
    "openai key": FAKE["openai"], "anthropic key": FAKE["anthropic"], "github token": FAKE["github"],
    "aws key": FAKE["aws"], "slack token": FAKE["slack"], "bearer header": FAKE["bearer_value"],
    "jwt": FAKE["jwt"], "long hex": FAKE["hex"], "base64 blob": FAKE["blob"], "email": FAKE["email"],
    "phone": FAKE["phone"], "password kv": FAKE["password_value"],
}
for name, text in samples.items():
    out = ah.redact(text)
    check(f"redacts {name}", secret_of[name] not in out and "[" in out, out)

key = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ\n-----END OPENSSH PRIVATE KEY-----"
check("redacts a private key block", "b3BlbnNz" not in ah.redact(f"key:\n{key}\ndone"))

plain = ("Fixed the snippet window in /Users/someone/code/chewbacca/bin/agent-history at commit "
         "c5ac91ba, the line count went from 4096 to 8192 and the session-search-covers-every-runtime test passes.")
check("leaves ordinary prose, paths and short shas alone", ah.redact(plain) == plain, ah.redact(plain))

# A secret sitting right where the window edge falls must not print in part.
long_text = ("x " * 400) + FAKE["openai"] + (" y" * 400) + " needle " + (" z" * 50)
pos = long_text.find("needle")
snip = ah.snippet(long_text, pos, 40)
check("snippet carries the match", "needle" in snip, snip)
edge_text = ("a" * 10) + " " + FAKE["github"] + " needle tail"
snip2 = ah.snippet(edge_text, edge_text.find("needle"), 20)
check("snippet never prints a cut secret", FAKE["github"][:12] not in snip2, snip2)

# URL userinfo: every scheme a credential rides in on.
for url, host in [
    ("postgres://admin:FakePw0rd123@db.example.com:5432/app", "db.example.com"),
    ("postgresql://svc:fake-pass@10.0.0.5/app", "10.0.0.5"),
    ("mysql://root:notreal99@mysql.example.com/x", "mysql.example.com"),
    ("redis://default:redisfakepw@cache.example.com:6379", "cache.example.com"),
    ("mongodb+srv://mongo:fakeMongoPw@cluster0.example.net/db", "cluster0.example.net"),
    ("amqp://guest:fakeguestpw@mq.example.com:5672/", "mq.example.com"),
    ("https://deploy:fakehttpspw@example.com/repo.git", "example.com"),
    ("git://bot:fakegitpw@git.example.com/repo.git", "git.example.com"),
    ("ssh://git:fakesshpw@git.example.com/repo.git", "git.example.com"),
]:
    scheme = url.split("://")[0]
    out = ah.redact(f"connect with {url} now")
    password = url.split("://")[1].split("@")[0].split(":")[1]
    check(f"redacts {scheme} URL credentials", password not in out and f"{scheme}://[REDACTED]@{host}" in out, out)

# Bypass routes: a key name cut off by the window edge, and a query that
# lands inside the secret itself, must still come out redacted.
pad = "word " * 2000
cut_kv = pad + "password = FakeKvSecretValue77" + " filler" * 20 + " needle here"
s = ah.snippet(cut_kv, cut_kv.find("needle"), 300)
check("snippet redacts a key=value whose key the window would cut", "FakeKvSecretValue77" not in s, s)
cut_url = pad + "x" * 3 + " postgres://u:FakeUrlPw42@h.example.com/db" + " more" * 5 + " needle"
s = ah.snippet(cut_url, cut_url.find("needle"), 60)
check("snippet redacts a URL credential near the window edge", "FakeUrlPw42" not in s, s)
inside = "token here " + FAKE["openai"] + " end"
s = ah.snippet(inside, inside.find(FAKE["openai"][6:14]), 30)
check("a query that matches inside a secret still prints it redacted", FAKE["openai"][6:14] not in s and FAKE["openai"] not in s, s)
check("render() redacts every output field, not only the snippet",
      FAKE["email"] not in json.dumps(ah.render({"runtime": "claude-code", "session": FAKE["email"], "time": "",
                                                "repo": f"repo-{FAKE['github']}", "role": "user", "snippet": "x",
                                                "file": f"/tmp/{FAKE['email']}.jsonl"})))

# Encodings and splits a secret hides behind.
import base64 as _b64
import io
enc_cases = {
    "a key=value split across a newline": ("password:\n    FakeNlSecret88", "FakeNlSecret88"),
    "an Authorization header split across a newline": ("Authorization:\n  Bearer FakeNlBearer1234567", "FakeNlBearer1234567"),
    "a JSON-escaped key=value (backslash quotes)": ('{\\"api_key\\": \\"FakeEscKey12345\\"}', "FakeEscKey12345"),
    "a double-escaped bearer in tool output": ('{\\\\"Authorization\\\\": \\\\"Bearer FakeDblEsc0987654\\\\"}', "FakeDblEsc0987654"),
    "a \\u-escaped key": ("\\u0073k-proj-" + "FakeUnicodeEsc0123456789", "FakeUnicodeEsc0123456789"),
    "a URL-encoded password": ("body=user%3Djane%26password%3DFakePctPw999", "FakePctPw999"),
    "a URL-encoded connection string": ("dsn=postgres%3A%2F%2Fapp%3AFakePctDsn77%40db.example.com", "FakePctDsn77"),
    "a base64-encoded secret too short for the blob rule":
        ("hdr " + _b64.b64encode(b"password=FakeB64Pw42").decode(), "FakeB64Pw42"),
    "a secret used as a JSON field name": ('{"' + FAKE["openai"] + '": true}', FAKE["openai"]),
}
for name, (text, secret) in enc_cases.items():
    out = ah.redact(text)
    b64_hidden = secret == "FakeB64Pw42" and _b64.b64encode(b"password=FakeB64Pw42").decode() not in out
    check(f"redacts {name}", secret not in out and (secret != "FakeB64Pw42" or b64_hidden), out)

buf = io.StringIO()
ah.emit(f"stderr line with {FAKE['github']} and {FAKE['email']}", buf)
check("emit redacts a plain line (the stderr route)", FAKE["github"] not in buf.getvalue() and FAKE["email"] not in buf.getvalue(), buf.getvalue())
buf = io.StringIO()
ah.emit({"repo": f"/Users/x/{FAKE['openai']}", FAKE["aws"]: "v", "snippet": 'say \\"password\\": \\"FakeJsonPw555\\"'}, buf)
line = buf.getvalue()
try:
    json.loads(line)
    valid = True
except ValueError:
    valid = False
check("emit redacts a dict's keys and values and keeps it valid JSON",
      valid and FAKE["openai"] not in line and FAKE["aws"] not in line and "FakeJsonPw555" not in line, line)

# Linear time: text planted in a transcript must not be able to stall the
# redactor. Each 1 MB input targets one pattern's worst case; each runs in a
# child process with a hard timeout so a regression fails instead of hanging.
MB = 1_000_000
ADVERSARIAL = {
    "URL scheme over a long letter run": "a" * MB,
    "URL userinfo, :// with no host": "a://" * (MB // 4),
    "URL userinfo, colons and no @": "x://" + "a:" * (MB // 2),
    "URL userinfo, @ inside a password run": "x://u:" + "p@" * (MB // 2),
    "URL userinfo, no @ at all": "x://" + "a" * MB,
    "email, a@a@a@": "a@" * (MB // 2),
    "email, dotted local part": "a." * (MB // 2),
    "email, domain labels with no end": "a@" + "b." * (MB // 2),
    "secret keyword, kebab run": "a-" * (MB // 2),
    "secret keyword, password then spaces": "password" + " " * MB,
    "secret keyword, repeated password=": "password=" * (MB // 9),
    "secret keyword, a=b=c= chain": "ab=" * (MB // 3),
    "any-syntax key rule, every word a name": "word " * (MB // 5),
    "any-syntax key rule, every word a keyword": "token " * (MB // 6),
    "any-syntax key rule, flags": "--token x " * (MB // 10),
    "entropy rule, many short runs": ("Ab1+" * 6 + " ") * (MB // 25),
    "entropy rule, one megabyte run": "aZ9_" * (MB // 4),
    "secret keyword, one megabyte name": "api_key" * (MB // 7) + "=value123",
    "URL userinfo, @ run with no delimiter": "x://" + "@" * MB,
    "unterminated OSC sequences": "\x1b]0;" * (MB // 4),
    "CSI with endless parameters": "\x1b[" + "1;" * (MB // 2),
    "private key header with no end": "-----BEGIN " + "A" * MB,
    "bearer then whitespace": "bearer" + " " * MB,
    "bearer repeated": "bearer " * (MB // 7),
    "authorization then spaces": "authorization" + " " * MB,
    "JWT prefix then a run": "eyJ" + "a" * MB,
    "JWT prefix after every dash": "eyJ-" * (MB // 4),
    "JWT with two segments, repeated": "eyJaaaaaaaaa.bbbbbbbbbb-" * (MB // 24),
    "email with a megabyte local part": "a" * MB + "@b.example",
    "email, many addresses in a run": "a@b.cc" * (MB // 6),
    "API key prefix repeated": "sk-" * (MB // 3),
    "hex run with a bad end": "0" * MB + "g",
    "phone digits": "1" * MB,
    "base64 blob": "A1b" * (MB // 3),
    "base64 short tokens": ("Ab1+" * 5 + " ") * (MB // 21),
    "JSON escapes, backslash run": "\\" * MB,
    "unicode escapes": "\\u0041" * (MB // 6),
    "percent escapes": "%41" * (MB // 3),
}
TIMING = (
    "import importlib.machinery,sys,time\n"
    "sys.dont_write_bytecode=True\n"
    f"ah=importlib.machinery.SourceFileLoader('a',{str(TOOL)!r}).load_module()\n"
    "s=sys.stdin.read();t=time.process_time();ah.redact(s);print(time.process_time()-t)\n"
)
for name, text in ADVERSARIAL.items():
    try:
        p = subprocess.run([sys.executable, "-c", TIMING], input=text, capture_output=True, text=True, timeout=5)
        took = float(p.stdout.strip() or "99")
    except subprocess.TimeoutExpired:
        took = 99.0
    check(f"1 MB adversarial input redacts in under 1s: {name}", took < 1.0, f"{took:.2f}s")

jwt_after_dash = ah.redact("token-" + FAKE["jwt"] + " and dir-" + FAKE["openai"])
check("a JWT or key right after a dash is still redacted",
      FAKE["jwt"] not in jwt_after_dash and FAKE["openai"] not in jwt_after_dash, jwt_after_dash)
long_local = ah.redact("x" * 200 + "@mail.example.com")
check("a long email local part is redacted whole", "x" not in long_local, long_local)
big = ah.redact("x" * (3 * MB) + " " + FAKE["openai"])
check("redact caps its input instead of scanning without limit", len(big) < 2 * MB, len(big))

# Regression (a): the cap drops what is past it; it never prints it, and a
# secret on the cap boundary is not printed in part.
past = ah.redact("x " * (ah.MAX_REDACT // 2 + 10) + FAKE["github"])
check("a secret past the cap is dropped, not printed", FAKE["github"] not in past and "[TRUNCATED" in past, past[-80:])
edge = "y " * ((ah.MAX_REDACT - 10) // 2) + FAKE["openai"] + " tail"
cut = ah.redact(edge)
check("a secret straddling the cap is not printed in part", FAKE["openai"][:8] not in cut[-200:], cut[-120:])

# Regression (b): no upper bound lets a long secret through.
long_cases = {
    "a 400-character URL password": ("postgres://u:" + "P4ss" * 100 + "@db.example.com/x", "P4ss" * 100),
    "a URL password with more than 16 @": ("redis://u:" + "p@" * 40 + "Tail99@cache.example.com", "Tail99"),
    "a 5000-character JWT": ("eyJ" + "a1B2" * 1250 + "." + "c3D4" * 1250 + "." + "e5F6" * 1250, "a1B2" * 50),
    "a 10,000-character base64 token": ("blob " + "Zm9v" * 1000 + "QmFy9x" * 1000, "QmFy9x" * 20),
    "a long GitHub token": ("t " + "gh" + "p_" + "Ab3" * 300, "Ab3" * 50),
    "a key name longer than 64 characters": ("MY_" + "VERY_" * 20 + "LONG_API_KEY=FakeLongKeyName123", "FakeLongKeyName123"),
    "a value 2000 characters long": ("password=" + "Zz9" * 700, "Zz9" * 50),
    "a PEM block with a long header": ("-----BEGIN " + "ENCRYPTED " * 10 + "PRIVATE KEY-----\nMIIfakebody\n-----END "
                                        + "ENCRYPTED " * 10 + "PRIVATE KEY-----", "MIIfakebody"),
    "an email with a 70-character label": ("mail jane@" + "d" * 70 + ".example.com", "jane@"),
    "an email with ten domain labels": ("mail jane@" + "a." * 10 + "example.com", "jane@"),
}
for name, (text, secret) in long_cases.items():
    out = ah.redact(text)
    check(f"redacts {name}", secret not in out, out[:160])

# Regression (c): a control character or escape inside a secret cannot split
# it so the rule misses it and the rest prints.
split_cases = {
    "a key split by an ANSI color code": "sk-" + "proj-AbCdEfGh\x1b[0mIjKlMnOpQrStUv12",
    "a key split by an OSC sequence": "gh" + "p_abcdefghij\x1b]0;x\x07klmnopqrstuvwxyz0123",
    "a key split by a raw C1 CSI": "sk-" + "proj-AbCdEfGh\x9b0mIjKlMnOpQrStUv12",
    "a key split by an escaped ESC": "sk-" + "proj-AbCdEfGh\\u001b[0mIjKlMnOpQrStUv12",
    "a URL password split by a NUL": "mysql://root:FakeNul\x00Split77@db.example.com/x",
}
for name, text in split_cases.items():
    out = ah.redact(text)
    check(f"redacts {name}", not any(part in out for part in ("IjKlMnOp", "klmnopqr", "Split77", "FakeNul")), repr(out))

# Terminal control sequences: printed escaped, never raw.
nasty = "ok \x1b[31mred\x1b[0m \x1b]0;pwned title\x07 \x9b2J \x00\x08\x7f \u202e evil \x85 end\tTAB\nNL"
buf = io.StringIO()
ah.emit(nasty, buf)
out_txt = buf.getvalue()
raw_ctrl = [c for c in out_txt if (ord(c) < 32 and c not in "\n\t") or 0x7f <= ord(c) <= 0x9f or c == "\u202e"]
check("text emit prints no raw C0/C1 control, DEL or bidi override", not raw_ctrl, repr(out_txt))
check("text emit drops the sequences whole, keeps the words, tab and newline",
      "red" in out_txt and "evil" in out_txt and "[31m" not in out_txt and "pwned title" not in out_txt
      and "\t" in out_txt and "\n" in out_txt, repr(out_txt))
buf = io.StringIO()
ah.emit({"snippet": nasty, nasty: "key"}, buf)
out_js = buf.getvalue()
raw_ctrl = [c for c in out_js.rstrip("\n") if ord(c) < 32 or 0x7f <= ord(c) <= 0x9f or c == "\u202e"]
check("JSON emit has no raw control characters, C1 included", not raw_ctrl, repr(out_js))
check("JSON emit stays valid and round-trips the text", json.loads(out_js)["snippet"].startswith("ok "), out_js)

# ------------------------------------------------------------- fuzz
# Mutated fake secrets: random shapes, under every secret-ish key spelled in
# random case, in every syntax, split by every control the redactor strips,
# wrapped in every encoding it decodes. Seeded, so a failure reproduces.
import random
import urllib.parse

print("fuzz")
rng = random.Random(20261010)
KEYWORDS = ["key", "token", "secret", "password", "passwd", "pwd", "auth", "credential", "session",
            "cookie", "bearer", "api", "private", "signature", "sig", "access", "refresh", "client_secret",
            "api_key", "ACCESS_TOKEN", "x-api-key", "db_password"]


def fake_secret():
    shape = rng.choice(["mixed", "mixed", "hex", "lowernum", "upper", "b64", "urlsafe", "short"])
    n = rng.randint(20, 48)
    pools = {
        "mixed": "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789",
        "hex": "0123456789abcdef",
        "lowernum": "abcdefghijkmnopqrstuvwxyz0123456789",
        "upper": "ABCDEFGHJKLMNPQRSTUVWXYZ23456789",
        "b64": "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789+/",
        "urlsafe": "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_",
        "short": "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789",
    }
    if shape == "short":
        n = rng.randint(8, 14)
    return "".join(rng.choice(pools[shape]) for _ in range(n)), shape


def rand_case(word):
    return "".join(c.upper() if rng.random() < 0.5 else c.lower() for c in word)


def syntaxes(kw, s):
    return [f"{kw}={s}", f"{kw}: {s}", f"{kw}:{s}", f'"{kw}": "{s}"', f"'{kw}': '{s}'", f"{kw} = \"{s}\"",
            f"{kw} {s}", f"--{kw} {s}", f"--{kw}={s}", f"-p {s}", f"X-{kw}: {s}", f"{kw}:\n    {s}",
            f"export {kw.upper()}={s}", f"<{kw}>{s}</{kw}>", f"{kw}\t{s}", f"?{kw}={s}&next=1"]


SPLITS = ["", "\x1b[0m", "\x1b]0;t\x07", "\x9b1m", "\x00", "‮"]


def encodings(text):
    yield "plain", text
    yield "json", json.dumps(text)[1:-1]
    yield "double-json", json.dumps(json.dumps(text))[1:-1]
    yield "percent", urllib.parse.quote(text, safe="")
    yield "base64", _b64.b64encode(text.encode()).decode()


fuzz_total = fuzz_pass = 0
fuzz_fail = []
for _ in range(400):
    secret, shape = fake_secret()
    kw = rand_case(rng.choice(KEYWORDS))
    syntax = rng.choice(syntaxes(kw, secret))
    split = rng.choice(SPLITS)
    if split:
        cut_at = rng.randint(3, len(secret) - 3)
        syntax = syntax.replace(secret, secret[:cut_at] + split + secret[cut_at:])
    for enc, text in encodings(f"see {syntax} done"):
        out = ah.redact(text)
        fuzz_total += 1
        probe = secret[len(secret) // 4: len(secret) // 4 + 6]
        leaked = secret in out or probe in out or (enc == "base64" and text in out)
        if leaked:
            fuzz_fail.append((shape, enc, repr(text[:70]), repr(out[:90])))
        else:
            fuzz_pass += 1
    # The bare secret too, no key at all: the entropy rule's job.
    if shape != "short":
        out = ah.redact(f"value {secret} end")
        fuzz_total += 1
        if secret in out or secret[len(secret) // 4: len(secret) // 4 + 6] in out:
            fuzz_fail.append((shape, "bare", secret, repr(out[:90])))
        else:
            fuzz_pass += 1
rate = 100.0 * fuzz_pass / fuzz_total
print(f"  fuzz: {fuzz_pass}/{fuzz_total} redacted ({rate:.2f}%)")
for f in fuzz_fail[:12]:
    print("        leak:", *f)
check("fuzz: every mutated fake secret is redacted", not fuzz_fail, f"{len(fuzz_fail)} leaks")

# Ordinary text survives the catch-all: words, paths, ids and prose.
for plain_text in ["the agent-history search covers every runtime", "/Users/someone/code/chewbacca/bin/agent-history",
                   "85cdc205-ed5a-4893-88cb-4d732737169d", "useScrollNav and CLAUDE_CODE_EXECPATH in python3",
                   "api.github.com/repos/calebnewtonusc/Chewbacca"]:
    check(f"catch-all leaves ordinary text alone: {plain_text[:40]}", ah.redact(plain_text) == plain_text, ah.redact(plain_text))

# ------------------------------------------------------------- fixtures

tmp = Path(tempfile.mkdtemp(prefix="agent-history-test-"))
claude_root = tmp / "claude" / "projects"
codex_root = tmp / "codex" / "sessions"
proj = claude_root / "-Users-someone-code-chewbacca"
wt = claude_root / "-Users-someone-code-chewbacca--claude-worktrees-agent-x"
other = claude_root / "-Users-someone-code-otherrepo"
for d in (proj, wt, other):
    d.mkdir(parents=True)

now = time.time()
iso = lambda t: time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(t))


def write(path, entries, mtime):
    with open(path, "w") as fh:
        for e in entries:
            fh.write(json.dumps(e) + "\n")
    os.utime(path, (mtime, mtime))


write(proj / "11111111-1111-1111-1111-111111111111.jsonl", [
    {"type": "summary", "summary": "zebrafish summary line"},
    {"type": "user", "sessionId": "11111111-1111-1111-1111-111111111111", "cwd": "/Users/someone/code/chewbacca",
     "timestamp": iso(now - 3600), "message": {"role": "user", "content": f"deploy the zebrafish service, key {FAKE['openai']}"}},
    {"type": "assistant", "sessionId": "11111111-1111-1111-1111-111111111111", "cwd": "/Users/someone/code/chewbacca",
     "timestamp": iso(now - 3500), "message": {"role": "assistant", "content": [
         {"type": "thinking", "thinking": "zebrafish private reasoning"},
         {"type": "text", "text": f"Emailing {FAKE['email']} about the zebrafish rollout."},
         {"type": "tool_use", "name": "Bash", "input": {"command": f"curl -H 'Authorization: Bearer {FAKE['bearer_value']}' zebrafish.test"}}]}},
    {"type": "user", "sessionId": "11111111-1111-1111-1111-111111111111", "cwd": "/Users/someone/code/chewbacca",
     "timestamp": iso(now - 3400), "message": {"role": "user", "content": [
         {"type": "tool_result", "content": [{"type": "text", "text": f"zebrafish ok, call {FAKE['phone']}"}]}]}},
], now - 3400)

write(wt / "22222222-2222-2222-2222-222222222222.jsonl", [
    {"type": "user", "sessionId": "22222222-2222-2222-2222-222222222222",
     "cwd": "/Users/someone/code/chewbacca/.claude/worktrees/agent-x",
     "timestamp": iso(now - 600), "message": {"role": "user", "content": "worktree zebrafish \"quoted\" check"}},
], now - 600)

write(other / "33333333-3333-3333-3333-333333333333.jsonl", [
    {"type": "user", "sessionId": "33333333-3333-3333-3333-333333333333", "cwd": "/Users/someone/code/otherrepo",
     "timestamp": iso(now - 30 * 86400), "message": {"role": "user", "content": "old zebrafish note from last month"}},
], now - 30 * 86400)

leaky = claude_root / f"-Users-someone-code-{FAKE['openai']}"
leaky.mkdir(parents=True)
write(leaky / f"{FAKE['email']}.jsonl", [
    {"type": "user", "sessionId": FAKE["email"], "cwd": f"/Users/someone/code/{FAKE['openai']}",
     "timestamp": iso(now - 900), "message": {"role": "user", "content": "platypus in a leaky place"}},
], now - 900)

cday = codex_root / "2026" / "10" / "09"
cday.mkdir(parents=True)
write(cday / "rollout-2026-10-09T10-00-00-44444444-4444-4444-4444-444444444444.jsonl", [
    {"timestamp": iso(now - 7200), "type": "session_meta", "payload": {"id": "44444444-4444-4444-4444-444444444444",
     "cwd": "/Users/someone/code/chewbacca", "base_instructions": {"text": "zebrafish in the system prompt"}}},
    {"timestamp": iso(now - 7100), "type": "response_item", "payload": {"type": "message", "role": "developer",
     "content": [{"type": "input_text", "text": "zebrafish developer prompt"}]}},
    {"timestamp": iso(now - 7000), "type": "response_item", "payload": {"type": "message", "role": "user",
     "content": [{"type": "input_text", "text": f"codex zebrafish task with {FAKE['github']}"}]}},
    {"timestamp": iso(now - 6900), "type": "response_item", "payload": {"type": "reasoning",
     "summary": [{"type": "summary_text", "text": "zebrafish reasoning"}]}},
    {"timestamp": iso(now - 6800), "type": "response_item", "payload": {"type": "function_call", "name": "shell",
     "arguments": json.dumps({"cmd": f"echo zebrafish {FAKE['aws']}"})}},
    {"timestamp": iso(now - 6700), "type": "response_item", "payload": {"type": "function_call_output",
     "output": "zebrafish done"}},
    {"timestamp": iso(now - 6700), "type": "event_msg", "payload": {"type": "user_message", "message": "zebrafish dup"}},
], now - 6700)

env = dict(os.environ, AGENT_HISTORY_CLAUDE_DIRS=str(claude_root), AGENT_HISTORY_CODEX_DIR=str(codex_root))


def run(*args, use_rg=True):
    e = dict(env)
    if not use_rg:
        e["AGENT_HISTORY_NO_RG"] = "1"  # the pure-Python prefilter path
    p = subprocess.run([sys.executable, str(TOOL), *args], capture_output=True, text=True, env=e, timeout=60)
    return p.returncode, p.stdout, p.stderr


def hits(*args, use_rg=True):
    rc, out, err = run(*args, "--json", use_rg=use_rg)
    return rc, [json.loads(l) for l in out.splitlines() if l.strip()], out + err


# ------------------------------------------------------------- search

print("search")
before = sorted((str(p), p.stat().st_mtime, p.stat().st_size) for p in tmp.rglob("*"))
for use_rg in (True, False):
    label = "rg" if use_rg else "no-rg"
    rc, hs, raw = hits("search", "zebrafish", "--limit", "100", use_rg=use_rg)
    check(f"[{label}] finds hits in both runtimes", {h["runtime"] for h in hs} == {"claude-code", "codex"}, raw[-300:])
    roles = {(h["runtime"], h["role"]) for h in hs}
    check(f"[{label}] every role: user, assistant, tool_use, tool",
          {("claude-code", "user"), ("claude-code", "assistant"), ("claude-code", "tool_use"),
           ("claude-code", "tool"), ("codex", "user"), ("codex", "tool_use"), ("codex", "tool")} <= roles, roles)
    check(f"[{label}] skips thinking, reasoning, summaries, system and developer prompts, event dups",
          not any(w in raw for w in ("private reasoning", "zebrafish reasoning", "summary line",
                                     "system prompt", "developer prompt", "zebrafish dup")), raw)
    check(f"[{label}] no fake secret survives in output",
          not any(v in raw for v in FAKE.values()), [v for v in FAKE.values() if v in raw])
    check(f"[{label}] worktree session reports its repo", any(h["repo"] == "chewbacca" and h["session"].startswith("2222") for h in hs))
    check(f"[{label}] codex session id comes from the rollout name", any(h["session"] == "44444444-4444-4444-4444-444444444444" for h in hs))

rc, hs, raw = hits("search", "zebrafish", "--runtime", "codex")
check("--runtime codex returns only codex", hs and all(h["runtime"] == "codex" for h in hs), raw[-200:])
rc, hs, raw = hits("search", "zebrafish", "--since", "7d")
check("--since 7d drops the month-old session", hs and not any(h["session"].startswith("3333") for h in hs))
rc, hs, raw = hits("search", "zebrafish", "--repo", "otherrepo")
check("--repo narrows to one repo", hs and all(h["repo"] == "otherrepo" for h in hs), raw[-200:])
rc, hs, raw = hits("search", "zebrafish", "--role", "user")
check("--role user keeps only user turns", hs and all(h["role"] == "user" for h in hs))
rc, hs, raw = hits("search", "zebrafish", "rollout")
check("several words must all appear in one message", len(hs) == 1 and hs[0]["role"] == "assistant", raw[-300:])
rc, hs, raw = hits("search", "zebrafish \"quoted\"", "--phrase")
check("--phrase matches text with a quote in it", len(hs) == 1 and hs[0]["session"].startswith("2222"), raw[-300:])
rc, hs, raw = hits("search", "zebrafish", "--limit", "2")
check("--limit caps the hits", len(hs) == 2)
rc, out, err = run("search", "nosuchwordanywhere")
check("no match exits 1 with a count on stderr", rc == 1 and "0 matches" in err, err)
rc, out, err = run("search", "zebrafish")
check("text output has time, runtime, repo, session and role", "claude-code" in out and "chewbacca" in out and "11111111"[:8] in out, out[:300])
after = sorted((str(p), p.stat().st_mtime, p.stat().st_size) for p in tmp.rglob("*"))
check("writes nothing: fixture tree unchanged", before == after)
rc, out, err = run("search", "zebrafish", "--since", "yesterdayish")
check("a bad --since is refused, not ignored", rc != 0 and "--since" in err, err)

leak_vals = (FAKE["openai"], FAKE["email"])
rc, out, err = run("search", "platypus")
check("text stdout redacts repo, session and path fields", rc == 0 and "platypus" in out and not any(v in out + err for v in leak_vals), out)
rc, out, err = run("search", "platypus", "--json")
check("JSON stdout redacts every field and stays JSON",
      rc == 0 and not any(v in out for v in leak_vals) and all(json.loads(l) for l in out.splitlines() if l), out)
rc, out, err = run("search", "zebrafish", "--since", FAKE["github"])
check("the --since error path redacts what it echoes", rc == 2 and "--since" in err and FAKE["github"] not in err, err)
rc, out, err = run("search", "zebrafish", "--runtime", FAKE["aws"])
check("argparse's own error echo is redacted", rc == 2 and FAKE["aws"] not in err and "invalid choice" in err, err)
rc, out, err = run("search", FAKE["slack"])
check("the stderr summary never carries the query's secret", FAKE["slack"] not in err + out, err)

p = subprocess.run([sys.executable, str(TOOL), "redact"], input=f"key {FAKE['openai']}", capture_output=True, text=True)
check("redact subcommand works as a pipe", FAKE["openai"] not in p.stdout and "[API_KEY]" in p.stdout, p.stdout)

subprocess.run(["rm", "-rf", str(tmp)])
print(f"\n{PASSED} passed, {FAILED} failed")
sys.exit(1 if FAILED else 0)
